"""The API the website talks to.

Run locally (from the backend folder):  uvicorn app.main:app --reload --port 8000
Try it in a browser: http://localhost:8000/docs
"""
import io
import json
import math
from typing import Literal

import numpy as np
from astropy.io import fits
from astropy.time import Time
from fastapi import FastAPI, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__, irsa
from .config import load_datasets, load_targets
from .flags import flag_summary
from .frames import FrameOptions, frame_stream, grid_center
from .grid import make_grid, to_grid
from .irsa import IrsaUnavailable
from .objects import identify
from .observations import find_observations, recall_image
from .photometry import photometry_stream
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


def json_safe(value):
    """JSON has no NaN or Infinity: turn them into null, everywhere inside `value`."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def ndjson_line(message: dict) -> str:
    """One streamed message: a line of valid JSON."""
    return json.dumps(json_safe(message)) + "\n"


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
                yield ndjson_line(message)
        except IrsaUnavailable:
            yield ndjson_line({"type": "error", "error": IRSA_DOWN[1], "message": IRSA_DOWN[2]})

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


# ---------- photometry, objects, flags, metadata (Phase 4) ----------

class PhotometryRequest(BaseModel):
    ra: float | None = None
    dec: float | None = None
    target: str | None = Field(None, max_length=100)
    fov_arcsec: float | None = Field(None, description="Use the time slider's FOV to reuse its downloads")
    releases: list[str] | None = None
    detectors: list[int] | None = None
    tmin: str | None = None
    tmax: str | None = None
    max_images: int | None = Field(None, ge=1)
    use_proper_motion: bool = True
    aperture_px: float = Field(2.0, ge=0.5, le=5)
    annulus_px: tuple[float, float] = (4.0, 7.0)
    exclude_flags: list[str] | None = None
    zodi_subtract: bool = True


@app.post("/api/photometry")
async def photometry(request: PhotometryRequest):
    """Brightness of the target in every image → spectrum (flux vs wavelength) and light
    curve (flux vs date). Streams NDJSON: "start", one "point" per image, then "done"."""
    inner, outer = request.annulus_px
    if not request.aperture_px < inner < outer <= 15:
        return friendly_error(400, "bad_aperture", "Need aperture < sky ring inner < outer ≤ 15 pixels.")
    search = await prepare_search(
        ra=request.ra, dec=request.dec, target=request.target, fov=request.fov_arcsec,
        releases=request.releases, detectors=request.detectors, tmin=request.tmin, tmax=request.tmax,
        max_images=request.max_images,
    )
    if isinstance(search, JSONResponse):
        return search
    if not request.use_proper_motion:
        search["motion"] = None
    try:
        found = await find_observations(**search)
    except IrsaUnavailable:
        return friendly_error(*IRSA_DOWN)
    if found["total_available"] == 0:
        return friendly_error(*NO_COVERAGE)

    datasets = search["datasets"]
    rows = found["observations"]
    center_ra, center_dec = grid_center(search["ra"], search["dec"], rows, search["motion"])
    size_deg = search["fov_arcsec"] * datasets["limits"]["cutout_size_margin"] / 3600

    async def lines():
        async for message in photometry_stream(
            rows, center_ra=center_ra, center_dec=center_dec, size_deg=size_deg,
            aperture_px=request.aperture_px, annulus_px=(inner, outer),
            exclude_flags=request.exclude_flags if request.exclude_flags is not None else datasets["flags_default_exclude"],
            pixel_scale_arcsec=datasets["pixel_scale_arcsec"], zodi_subtract=request.zodi_subtract,
        ):
            yield ndjson_line(message)

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@app.get("/api/object")
async def object_info(
    ra: float = Query(ge=0, lt=360),
    dec: float = Query(ge=-90, le=90),
    radius: float = Query(10.0, gt=0, le=60, description="Search radius in arcseconds"),
    epoch: str | None = Query(None, description="Viewing date, e.g. 2026-03-14 (default 2026-01-01)"),
):
    """What is at this spot? Name, other names, type, brightness, distance in light-years
    and motion, from SIMBAD and Gaia DR3, with fast movers moved to the viewing date."""
    try:
        mjd = _parse_date(epoch) if epoch else Time(2026.0, format="jyear").mjd
    except ValueError:
        return friendly_error(400, "bad_date", "Dates must look like 2026-03-14.")
    try:
        return json_safe(await run_in_threadpool(identify, ra, dec, radius, mjd))
    except ResolverUnavailable:
        return friendly_error(503, "catalogues_unavailable", "SIMBAD and Gaia aren't answering right now. Try again soon.")


async def _image_on_grid(obs_id: str, detector: int, ra: float | None, dec: float | None, fov_arcsec: float | None):
    """Load one listed image onto the frames' grid.

    Returns (row, grid, grid_image, cutout bytes), or an error response."""
    row = recall_image(obs_id, detector)
    if row is None:
        return friendly_error(404, "unknown_image", "List this spot's images first (/api/observations or /api/frames).")
    datasets = load_datasets()
    limits = datasets["limits"]
    ra = row["target_ra"] if ra is None else ra
    dec = row["target_dec"] if dec is None else dec
    fov = fov_arcsec or limits["default_fov_arcsec"]
    if not limits["min_fov_arcsec"] <= fov <= limits["max_fov_arcsec"]:
        return friendly_error(400, "bad_fov", "Field of view out of range.")
    try:
        content = await irsa.fetch_cutout(row["access_url"], ra, dec, fov * limits["cutout_size_margin"] / 3600)
    except IrsaUnavailable:
        return friendly_error(*IRSA_DOWN)
    grid = make_grid(ra, dec, fov, datasets["pixel_scale_arcsec"])
    grid_image = await run_in_threadpool(
        to_grid, content, grid, row["target_ra"], row["target_dec"], [], False, False
    )
    return row, grid, grid_image, content


@app.get("/api/flags/{obs_id}")
async def image_flags(
    obs_id: str,
    detector: int = Query(ge=1, le=6),
    ra: float | None = Query(None, description="Grid centre (from the frames 'start' message)"),
    dec: float | None = None,
    fov_arcsec: float | None = None,
):
    """Quality flags for one image: what each flag means, how much of the view it covers,
    which flags sit on the target, a quality badge, and links to per-flag overlay masks."""
    loaded = await _image_on_grid(obs_id, detector, ra, dec, fov_arcsec)
    if isinstance(loaded, JSONResponse):
        return loaded
    row, grid, grid_image, _ = loaded
    tx, ty = (int(round(float(v))) for v in grid.wcs.world_to_pixel_values(row["target_ra"], row["target_dec"]))
    target_bits = int(grid_image.flags[ty, tx]) if 0 <= tx < grid.width and 0 <= ty < grid.height else 0
    inside = np.isfinite(grid_image.raw_image)
    summary = flag_summary(
        grid_image.flags, inside, grid_image.flag_definitions, load_datasets()["flags_default_exclude"], target_bits
    )
    fov = fov_arcsec or load_datasets()["limits"]["default_fov_arcsec"]
    query = f"detector={detector}&ra={grid.wcs.wcs.crval[0]:.6f}&dec={grid.wcs.wcs.crval[1]:.6f}&fov_arcsec={fov:g}"
    for flag in summary["flags"]:
        flag["mask_url"] = f"/api/flags/{obs_id}/mask.png?{query}&flag={flag['name']}"
    return {"obs_id": obs_id, "detector": detector, "release": row["release"], **summary}


@app.get("/api/flags/{obs_id}/mask.png")
async def flag_mask(
    obs_id: str,
    flag: str,
    detector: int = Query(ge=1, le=6),
    ra: float | None = None,
    dec: float | None = None,
    fov_arcsec: float | None = None,
):
    """A see-through PNG with the pixels carrying `flag` in amber, on the frames' grid."""
    loaded = await _image_on_grid(obs_id, detector, ra, dec, fov_arcsec)
    if isinstance(loaded, JSONResponse):
        return loaded
    _, _, grid_image, _ = loaded
    if flag not in grid_image.flag_definitions:
        return friendly_error(404, "unknown_flag", f"This image has no flag called {flag}.")
    hit = (grid_image.flags & (1 << grid_image.flag_definitions[flag]["bit"])) != 0
    rgba = np.zeros((*hit.shape, 4), dtype=np.uint8)
    rgba[hit] = (240, 178, 0, 200)  # --amber, mostly opaque
    return Response(to_png(rgba / 255.0), media_type="image/png", headers=IMMUTABLE)


@app.get("/api/meta/{obs_id}")
async def image_meta(
    obs_id: str,
    detector: int = Query(ge=1, le=6),
    ra: float | None = None,
    dec: float | None = None,
    fov_arcsec: float | None = None,
):
    """Details of one image in plain terms, plus its full FITS header."""
    loaded = await _image_on_grid(obs_id, detector, ra, dec, fov_arcsec)
    if isinstance(loaded, JSONResponse):
        return loaded
    row, _, grid_image, content = loaded
    cards = await run_in_threadpool(_image_headers, content)
    version = next((card[2] for card in cards if card[1] == "VERSION"), None)
    return json_safe({
        "obs_id": obs_id,
        "detector": detector,
        "release": row["release"],
        "survey": row["survey"],
        "wavelength_range_um": [round(row["em_min_um"], 4), round(row["em_max_um"], 4)],
        "wavelength_at_target_um": grid_image.wavelength_um,
        "bandwidth_at_target_um": grid_image.bandwidth_um,
        "start_utc": Time(row["t_start"], format="mjd").isot,
        "end_utc": Time(row["t_end"], format="mjd").isot,
        "start_mjd": row["t_start"],
        "end_mjd": row["t_end"],
        "exposure_s": round((row["t_end"] - row["t_start"]) * 86400, 1),
        "processing_version": row["processing_version"],
        "pipeline_version": version,
        "visit": row.get("visit"),
        "irsa_url": row["access_url"],
        "header": cards,
    })


def _image_headers(content: bytes) -> list[list]:
    """PRIMARY and IMAGE header cards as [section, key, value, comment], JSON-friendly.
    (The pipeline VERSION lives in PRIMARY; detector, WCS and timing in IMAGE.)"""
    cards = []
    with fits.open(io.BytesIO(content)) as hdul:
        for section in ("PRIMARY", "IMAGE"):
            for card in hdul[section].header.cards:
                if not card.keyword or card.keyword in ("COMMENT", "HISTORY"):
                    continue
                value = card.value if isinstance(card.value, (int, float, str, bool)) else str(card.value)
                cards.append([section, card.keyword, json_safe(value), card.comment])
    return cards
