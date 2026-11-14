"""The API the website talks to.

Run locally (from the backend folder):  uvicorn app.main:app --reload --port 8000
Try it in a browser: http://localhost:8000/docs
"""
from astropy.time import Time
from fastapi import FastAPI, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import load_datasets, load_targets
from .irsa import IrsaUnavailable
from .observations import find_observations
from .random_target import random_target
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


def friendly_error(status: int, error: str, message: str) -> JSONResponse:
    """Errors the website can show as-is: {"error": "no_coverage", "message": "..."}."""
    return JSONResponse(status_code=status, content={"error": error, "message": message})


IRSA_DOWN = (503, "irsa_unavailable", "NASA's image archive (IRSA) isn't answering right now. Please try again in a few minutes.")
SIMBAD_DOWN = (503, "resolver_unavailable", "The star-name service (SIMBAD) isn't answering right now. Try typing coordinates instead.")


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


def _parse_list(text: str | None, allowed: list, convert=str) -> list | None:
    """ "1,2,3" → [1, 2, 3]; None if any item isn't allowed."""
    if not text:
        return list(allowed)
    try:
        items = [convert(part.strip()) for part in text.split(",") if part.strip()]
    except ValueError:
        return None
    return items if items and all(item in allowed for item in items) else None


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
    ra: float | None = Query(None, ge=0, lt=360),
    dec: float | None = Query(None, ge=-90, le=90),
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

    fov = fov if fov is not None else limits["default_fov_arcsec"]
    if not limits["min_fov_arcsec"] <= fov <= min(limits["max_fov_arcsec"], settings.max_fov_arcsec):
        return friendly_error(
            400, "bad_fov", f"Field of view must be {limits['min_fov_arcsec']}–{limits['max_fov_arcsec']} arcseconds."
        )
    if releases is None:
        release_ids = list(datasets["default_releases"])
    else:
        release_ids = _parse_list(releases, list(datasets["releases"]))
    if release_ids is None:
        return friendly_error(400, "bad_release", f"Releases must be from: {', '.join(datasets['releases'])}.")
    detector_ids = _parse_list(detectors, [1, 2, 3, 4, 5, 6], int)
    if detector_ids is None:
        return friendly_error(400, "bad_detectors", "Detectors must be numbers from 1 to 6, e.g. 1,2,3.")
    try:
        tmin_mjd, tmax_mjd = _parse_date(tmin), _parse_date(tmax)
    except ValueError:
        return friendly_error(400, "bad_date", "Dates must look like 2026-03-14.")

    try:
        result = await find_observations(
            ra=ra,
            dec=dec,
            fov_arcsec=fov,
            release_ids=release_ids,
            detectors=detector_ids,
            tmin_mjd=tmin_mjd,
            tmax_mjd=tmax_mjd,
            max_images=min(max_images or limits["max_images_default"], settings.max_images),
            motion=motion,
            datasets=datasets,
        )
    except IrsaUnavailable:
        return friendly_error(*IRSA_DOWN)
    if result["total_available"] == 0:
        return friendly_error(
            404, "no_coverage", "SPHEREx hasn't observed this spot yet in the chosen releases and dates."
        )
    return result
