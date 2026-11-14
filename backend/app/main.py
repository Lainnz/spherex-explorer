"""The API the website talks to.

Run locally (from the backend folder):  uvicorn app.main:app --reload --port 8000
Try it in a browser: http://localhost:8000/docs
"""
import json
from typing import Literal

import numpy as np
from astropy.time import Time
from fastapi import FastAPI, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .config import load_datasets, load_targets
from .frames import FrameOptions, frame_stream
from .irsa import IrsaUnavailable
from .observations import find_observations
from .products import STACK_METHODS, difference, load_product, product_id, products_dir, save_product
from .random_target import random_target
from .render import percent_stretch, stretch_to_unit, to_f32, to_fits, to_png
from .resolve import ResolverUnavailable, resolve
from .settings import settings

app = FastAPI(title="SPHEREx Xplorer API", version=__version__)

# Browsers block calls to another website unless that website says it's allowed (CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Products never change once made, so browsers may keep them for a day.
IMMUTABLE = {"Cache-Control": "public, max-age=86400"}


def friendly_error(status: int, error: str, message: str) -> JSONResponse:
    """Errors the website can show as-is: {"error": "no_coverage", "message": "..."}."""
    return JSONResponse(status_code=status, content={"error": error, "message": message})


IRSA_DOWN = (503, "irsa_unavailable", "NASA's image archive (IRSA) isn't answering right now. Please try again in a few minutes.")
SIMBAD_DOWN = (503, "resolver_unavailable", "The star-name service (SIMBAD) isn't answering right now. Try typing coordinates instead.")
NO_COVERAGE = (404, "no_coverage", "SPHEREx hasn't observed this spot yet in the chosen releases and dates.")


@app.get("/api/health")
def health() -> dict:
    """The website calls this to choose between live data and demo mode."""
    return {
        "status": "ok",
        "version": __version__,
        "releases": load_datasets()["default_releases"],
    }


@app.get("/api/config")
def config() -> dict:
    """The shared settings file, so the website and server always agree."""
    return load_datasets()


@app.get("/api/resolve")
async def resolve_name(name: str = Query(min_length=1, max_length=100)):
    """A star or object name → coordinates, proper motion and type."""
    try:
        # SIMBAD lookups block while waiting, so run them off the main thread.
        result = await run_in_threadpool(resolve, name)
    except ResolverUnavailable:
        return friendly_error(*SIMBAD_DOWN)
    if result is None:
        return friendly_error(404, "not_found", f"We couldn't find '{name}'. Check the spelling or type coordinates.")
    return result


@app.get("/api/random")
def random_position() -> dict:
    """A random sky position (sometimes a famous one) for the Randomize button."""
    targets = load_targets()
    default_fov = load_datasets()["limits"]["default_fov_arcsec"]
    return random_target(targets["interesting"], targets["targets"], default_fov)


# ---------- shared checks for /api/observations and /api/frames ----------

def _split(text: str | None) -> list[str] | None:
    return None if text is None else [part.strip() for part in text.split(",") if part.strip()]


async def prepare_search(
    *, ra, dec, target, fov, releases, detectors, tmin, tmax, max_images
) -> dict | JSONResponse:
    """Check and complete a search request. Returns the arguments for find_observations
    (plus "motion"), or a friendly error response."""
    datasets = load_datasets()
    limits = datasets["limits"]

    motion = None
    if target:
        try:
            found = await run_in_threadpool(resolve, target)
        except ResolverUnavailable:
            return friendly_error(*SIMBAD_DOWN)
        if found is None:
            return friendly_error(404, "not_found", f"We couldn't find '{target}'.")
        motion = found["motion"]
        if ra is None or dec is None:
            ra, dec = found["ra"], found["dec"]
    if ra is None or dec is None:
        return friendly_error(400, "missing_position", "Give a position (ra and dec in degrees) or a target name.")
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        return friendly_error(400, "bad_position", "RA must be 0–360° and Dec −90–90°.")

    fov = fov if fov is not None else limits["default_fov_arcsec"]
    if not limits["min_fov_arcsec"] <= fov <= min(limits["max_fov_arcsec"], settings.max_fov_arcsec):
        return friendly_error(
            400, "bad_fov", f"Field of view must be {limits['min_fov_arcsec']}–{limits['max_fov_arcsec']} arcseconds."
        )
    release_ids = list(datasets["default_releases"]) if not releases else releases
    if any(r not in datasets["releases"] for r in release_ids):
        return friendly_error(400, "bad_release", f"Releases must be from: {', '.join(datasets['releases'])}.")
    try:
        detector_ids = [1, 2, 3, 4, 5, 6] if not detectors else [int(d) for d in detectors]
    except ValueError:
        detector_ids = [0]
    if any(d not in range(1, 7) for d in detector_ids):
        return friendly_error(400, "bad_detectors", "Detectors must be numbers from 1 to 6, e.g. 1,2,3.")
    try:
        tmin_mjd, tmax_mjd = _parse_date(tmin), _parse_date(tmax)
    except ValueError:
        return friendly_error(400, "bad_date", "Dates must look like 2026-03-14.")

    return {
        "ra": ra,
        "dec": dec,
        "fov_arcsec": fov,
        "release_ids": release_ids,
        "detectors": detector_ids,
        "tmin_mjd": tmin_mjd,
        "tmax_mjd": tmax_mjd,
        "max_images": min(max_images or limits["max_images_default"], settings.max_images),
        "motion": motion,
        "datasets": datasets,
    }


def _parse_date(text: str | None) -> float | None:
    """ "2026-03-14" or an MJD number → MJD."""
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return Time(text, format="iso", scale="utc").mjd


@app.get("/api/observations")
async def observations(
    ra: float | None = Query(None),
    dec: float | None = Query(None),
    target: str | None = Query(None, max_length=100),
    fov: float | None = Query(None, description="Field of view in arcseconds"),
    releases: str | None = Query(None, description="e.g. dr1,qr3"),
    detectors: str | None = Query(None, description="e.g. 1,2,3"),
    tmin: str | None = Query(None, description="Earliest date, e.g. 2025-09-01 or an MJD"),
    tmax: str | None = Query(None, description="Latest date"),
    max_images: int | None = Query(None, ge=1),
):
    """The SPHEREx images covering a position, grouped into visits (PLAN.md §7.2).

    Give `ra` and `dec`, or a `target` name, or both (coordinates win; the target still
    supplies proper motion). The first search of a spot can take ~3 minutes.
    """
    search = await prepare_search(
        ra=ra, dec=dec, target=target, fov=fov, releases=_split(releases), detectors=_split(detectors),
        tmin=tmin, tmax=tmax, max_images=max_images,
    )
    if isinstance(search, JSONResponse):
        return search
    try:
        result = await find_observations(**search)
    except IrsaUnavailable:
        return friendly_error(*IRSA_DOWN)
    if result["total_available"] == 0:
        return friendly_error(*NO_COVERAGE)
    return result


# ---------- frames and products ----------

class FramesRequest(BaseModel):
    ra: float | None = None
    dec: float | None = None
    target: str | None = Field(None, max_length=100)
    fov_arcsec: float | None = None
    releases: list[str] | None = None
    detectors: list[int] | None = None
    tmin: str | None = None
    tmax: str | None = None
    max_images: int | None = Field(None, ge=1)
    mode: Literal["epoch", "white", "exposure"] = "epoch"
    zodi_subtract: bool = True
    background_subtract: bool = True
    exclude_flags: list[str] | None = Field(None, description="Flag names; default = the bad-pixel list")
    fill_flagged: bool = Field(True, description="Fill pixels flagged in every image (e.g. saturated star cores)")
    trim: float = Field(99.5, gt=50, le=100)
    softening: float = Field(1.0, gt=0)


@app.post("/api/frames")
async def frames(request: FramesRequest):
    """Make the frames of the time sequence. The answer streams as NDJSON (one JSON
    object per line): "start", then "frame" and "progress" messages, then "done".
    The first request for a target downloads cutouts (~4 MB each) and can take minutes.
    """
    search = await prepare_search(
        ra=request.ra, dec=request.dec, target=request.target, fov=request.fov_arcsec,
        releases=request.releases, detectors=request.detectors, tmin=request.tmin, tmax=request.tmax,
        max_images=request.max_images,
    )
    if isinstance(search, JSONResponse):
        return search
    try:
        found = await find_observations(**search)
    except IrsaUnavailable:
        return friendly_error(*IRSA_DOWN)
    if found["total_available"] == 0:
        return friendly_error(*NO_COVERAGE)

    datasets = search["datasets"]
    options = FrameOptions(
        mode=request.mode,
        zodi_subtract=request.zodi_subtract,
        background_subtract=request.background_subtract,
        exclude_flags=request.exclude_flags if request.exclude_flags is not None else datasets["flags_default_exclude"],
        fill_flagged=request.fill_flagged,
        trim=request.trim,
        softening=request.softening,
    )

    async def lines():
        try:
            async for message in frame_stream(
                found, ra=search["ra"], dec=search["dec"], fov_arcsec=search["fov_arcsec"],
                motion=search["motion"], options=options, datasets=datasets,
            ):
                yield json.dumps(message) + "\n"
        except IrsaUnavailable:
            yield json.dumps({"type": "error", "error": IRSA_DOWN[1], "message": IRSA_DOWN[2]}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@app.get("/api/product/{name}")
async def product(
    name: str,
    vmin: float | None = None,
    vmax: float | None = None,
    softening: float = Query(1.0, gt=0),
    trim: float = Query(99.5, gt=50, le=100),
):
    """A product as `<id>.png` (quick-look picture), `<id>.f32` (raw numbers) or `<id>.fits`."""
    pid, _, ext = name.partition(".")
    if not pid.isalnum():
        return friendly_error(404, "unknown_product", "That image doesn't exist.")
    if ext == "png" and (products_dir() / f"{pid}.rgb.png").exists():
        return Response((products_dir() / f"{pid}.rgb.png").read_bytes(), media_type="image/png", headers=IMMUTABLE)
    try:
        image, _, meta = await run_in_threadpool(load_product, pid)
    except (FileNotFoundError, OSError):
        return friendly_error(404, "unknown_product", "That image doesn't exist (any more). Reload the sequence.")
    if ext == "png":
        if vmin is None or vmax is None or vmax <= vmin:
            vmin, vmax = percent_stretch([image], trim)
        return Response(to_png(stretch_to_unit(image, vmin, vmax, softening)), media_type="image/png", headers=IMMUTABLE)
    if ext == "f32":
        return Response(to_f32(image), media_type="application/octet-stream", headers=IMMUTABLE)
    if ext == "fits":
        return Response(to_fits(image, meta["wcs"], meta), media_type="application/fits", headers=IMMUTABLE)
    return friendly_error(404, "unknown_format", "Use .png, .f32 or .fits.")


def _load_matching(ids: list[str]) -> list[tuple] | JSONResponse:
    """Load products that must share one pixel grid (to add or subtract them)."""
    try:
        loaded = [load_product(pid) for pid in ids]
    except (FileNotFoundError, OSError):
        return friendly_error(404, "unknown_product", "One of those images doesn't exist (any more).")
    grids = {json.dumps(meta["wcs"], sort_keys=True) for _, _, meta in loaded}
    if len(grids) > 1:
        return friendly_error(400, "different_grids", "Those images cover different patches of sky.")
    return loaded


def _result_message(pid: str, meta: dict, image) -> dict:
    vmin, vmax = percent_stretch([image])
    return {
        "frame_id": pid, "label": meta["label"], "width": meta["width"], "height": meta["height"],
        "unit": meta["unit"], "vmin": vmin, "vmax": vmax,
        "png_url": f"/api/product/{pid}.png?vmin={vmin:.6g}&vmax={vmax:.6g}",
        "f32_url": f"/api/product/{pid}.f32", "fits_url": f"/api/product/{pid}.fits",
    }


class StackRequest(BaseModel):
    frame_ids: list[str] = Field(min_length=2, max_length=500)
    method: Literal["ivw_mean", "median", "sum"] = "ivw_mean"


@app.post("/api/stack")
async def stack(request: StackRequest):
    """Add frames together. "median" of all visits = a still-sky template where moving things vanish."""
    loaded = await run_in_threadpool(_load_matching, request.frame_ids)
    if isinstance(loaded, JSONResponse):
        return loaded
    image, variance = STACK_METHODS[request.method]([l[0] for l in loaded], [l[1] for l in loaded])
    first = loaded[0][2]
    pid = product_id({"kind": "stack", "method": request.method, "ids": sorted(request.frame_ids)})
    meta = {
        **{k: first[k] for k in ("width", "height", "wcs", "unit")},
        "label": f"Stack ({request.method.replace('_', ' ')}) of {len(loaded)} frames",
        "detectors": sorted({d for l in loaded for d in l[2].get("detectors", [])}),
        "t_mid": sum(l[2]["t_mid"] for l in loaded) / len(loaded),
    }
    await run_in_threadpool(save_product, pid, image, variance, meta)
    return _result_message(pid, meta, image)


class DifferenceRequest(BaseModel):
    a: str
    b: str
    normalize: bool = True


@app.post("/api/difference")
async def make_difference(request: DifferenceRequest):
    """A − B: moving objects become black/white pairs, changing stars a single spot."""
    loaded = await run_in_threadpool(_load_matching, [request.a, request.b])
    if isinstance(loaded, JSONResponse):
        return loaded
    (image_a, var_a, meta_a), (image_b, var_b, meta_b) = loaded
    image, variance = difference(image_a, var_a, image_b, var_b, request.normalize)
    pid = product_id({"kind": "difference", "a": request.a, "b": request.b, "normalize": request.normalize})
    meta = {
        **{k: meta_a[k] for k in ("width", "height", "wcs", "unit")},
        "label": f"{meta_a['label']} − {meta_b['label']}",
        "detectors": sorted(set(meta_a.get("detectors", [])) | set(meta_b.get("detectors", []))),
        "t_mid": meta_a["t_mid"],
    }
    await run_in_threadpool(save_product, pid, image, variance, meta)
    return _result_message(pid, meta, image)


class CompositeRequest(BaseModel):
    red: str
    green: str
    blue: str
    trim: float = Field(99.5, gt=50, le=100)
    softening: float = Field(1.0, gt=0)


@app.post("/api/composite")
async def composite(request: CompositeRequest):
    """A colour picture from three frames (default idea: D1 → blue, D3 → green, D5 → red)."""
    loaded = await run_in_threadpool(_load_matching, [request.red, request.green, request.blue])
    if isinstance(loaded, JSONResponse):
        return loaded
    channels = []
    for image, _, _ in loaded:
        vmin, vmax = percent_stretch([image], request.trim)
        channels.append(stretch_to_unit(image, vmin, vmax, request.softening))
    pid = product_id({"kind": "composite", **request.model_dump()})
    png = to_png(np.dstack(channels))
    (products_dir() / f"{pid}.rgb.png").write_bytes(png)
    labels = [meta["label"] for _, _, meta in loaded]
    return {"frame_id": pid, "label": "Colour: " + " / ".join(labels), "png_url": f"/api/product/{pid}.png"}
