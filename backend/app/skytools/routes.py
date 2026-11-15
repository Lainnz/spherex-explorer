"""Sky tools from Elaine's demo, served under the merged SPHEREx Xplorer API.

These routes add the SPHEREx false-colour all-sky map (/api/hips/...), per-detector
timelines, cutouts, aligned comparisons with significance maps, aperture-photometry
spectra, and catalogue overlays / identification (/api/catalogs, /api/identify).
Alice's routes (/api/observations, /api/frames, ...) live in app/main.py; nothing here
uses the same address.
"""

import json
import re

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse, Response

from . import catalogs, config, hips, irsa
from .spherex_image import process_cutout
from .spherex_timeline import build_timeline
from .spectrum import build_spectrum
from .compare import MissingPackage, NotComparable, compare

router = APIRouter(tags=["sky tools"])

DISPLAY_DIR = config.CACHE_DIR / "display"


@router.get("/api/spherex/observations")
def observations(
    ra: float = Query(..., ge=0, lt=360, description="Right Ascension in degrees"),
    dec: float = Query(..., ge=-90, le=90, description="Declination in degrees"),
    collection: str = Query(config.DEFAULT_COLLECTION),
):
    """List every SPHEREx image (in one collection) that covers this sky position."""
    if collection not in config.COLLECTIONS:
        raise HTTPException(400, f"Unknown collection. Choose one of: {list(config.COLLECTIONS)}")
    try:
        return irsa.search_images(ra, dec, collection)
    except irsa.ArchiveError as error:
        raise HTTPException(502, str(error)) from error


@router.get("/api/spherex/timeline")
def timeline(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    band: str = Query(..., description="Detector, e.g. SPHEREx-D2, or 'all' for all six detectors"),
    collection: str = Query(config.DEFAULT_COLLECTION),
):
    """Every observation of one detector at this position, with the wavelength
    seen at the target, grouped into comparable 'channels' (same wavelength)."""
    if collection not in config.COLLECTIONS:
        raise HTTPException(400, f"Unknown collection. Choose one of: {list(config.COLLECTIONS)}")
    if band != "all" and not re.fullmatch(r"SPHEREx-D[1-6]", band):
        raise HTTPException(400, "band must be SPHEREx-D1 … SPHEREx-D6, or all")
    try:
        search = irsa.search_images(ra, dec, collection)
    except irsa.ArchiveError as error:
        raise HTTPException(502, str(error)) from error

    if band == "all":  # every detector: more visits, so a denser timeline
        selected = [o for o in search["observations"] if re.fullmatch(r"SPHEREx-D[1-6]", o.get("band") or "")]
    else:
        selected = [o for o in search["observations"] if o["band"] == band]
    result = build_timeline(selected, ra, dec)
    return {
        "query": {"ra": ra, "dec": dec, "band": band, "collection": collection},
        "collection_name": search["collection_name"],
        **result,
        "method": (
            "Wavelength at the target from each image's own WCS and WCS-WAVE table "
            "(read via HTTP range requests). Observations are 'comparable' when their "
            "target wavelengths agree within half the channel bandwidth."
        ),
    }


def _validate_cutout_request(access_url: str, size: float):
    if not (access_url.startswith(config.ALLOWED_DATA_PREFIX) and access_url.endswith(".fits") and "?" not in access_url):
        raise HTTPException(400, "Only SPHEREx image URLs from IRSA are allowed.")
    if not (config.MIN_CUTOUT_DEG <= size <= config.MAX_CUTOUT_DEG):
        raise HTTPException(400, f"size must be between {config.MIN_CUTOUT_DEG} and {config.MAX_CUTOUT_DEG} degrees")


def _get_cutout(access_url: str, ra: float, dec: float, size: float, smooth: bool = False, round_shape: bool = False):
    """Download (or reuse) a cutout and its metadata. Returns (path, meta, cutout_url, was_cached)."""
    _validate_cutout_request(access_url, size)
    try:
        path, cutout_url, was_cached = irsa.download_cutout(access_url, ra, dec, size)
    except irsa.ArchiveError as error:
        raise HTTPException(502, str(error)) from error

    meta_file = path.with_name(f"{path.stem}{'-smooth' if smooth else ''}{'-round' if round_shape else ''}.json")
    if meta_file.exists():
        meta = json.loads(meta_file.read_text())
    else:
        try:
            meta = process_cutout(path, ra, dec, DISPLAY_DIR, smooth=smooth, round_shape=round_shape)
        except Exception as error:
            raise HTTPException(500, f"Could not read this FITS cutout: {error}") from error
        meta_file.write_text(json.dumps(meta))
    return path, meta, cutout_url, was_cached


@router.get("/api/spherex/spectrum")
def spectrum(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    collection: str = Query(config.DEFAULT_COLLECTION),
):
    """A SPHEREx spectrum at this position: aperture photometry in every image
    that covers it, each image contributing the wavelength it sees there."""
    if collection not in config.COLLECTIONS:
        raise HTTPException(400, f"Unknown collection. Choose one of: {list(config.COLLECTIONS)}")
    try:
        search = irsa.search_images(ra, dec, collection)
    except irsa.ArchiveError as error:
        raise HTTPException(502, str(error)) from error
    observations = [
        o for o in search["observations"] if (o.get("access_url") or "").startswith(config.ALLOWED_DATA_PREFIX)
    ]
    result = build_spectrum(observations, ra, dec)
    return {
        "query": {"ra": ra, "dec": dec, "collection": collection},
        "collection_name": search["collection_name"],
        **result,
    }


@router.get("/api/hips/spherex/channels")
def hips_channels():
    """The 102 wavelengths of the official SPHEREx DR1 all-sky HiPS cube."""
    try:
        return {
            "source": hips.CUBE_URL,
            "description": hips.cube_properties().get("obs_description"),
            "pixel_scale_deg": float(hips.cube_properties().get("hips_pixel_scale", "nan")),
            "channels": hips.channels(),
        }
    except httpx.HTTPError as error:
        raise HTTPException(502, f"Could not read the SPHEREx HiPS cube description from IRSA: {error}") from error


def _rgb_frames(frames: str) -> tuple[int, int, int]:
    parts = frames.split("-")
    if len(parts) != 3 or not all(p.isdigit() and 0 <= int(p) < hips.DEPTH for p in parts):
        raise HTTPException(404, "Use three frame numbers, e.g. 62-46-22")
    return int(parts[0]), int(parts[1]), int(parts[2])


@router.get("/api/hips/spherex-rgb/{frames}/properties")
def hips_rgb_properties(frames: str):
    try:
        return PlainTextResponse(hips.rgb_properties(_rgb_frames(frames)))
    except httpx.HTTPError as error:
        raise HTTPException(502, f"IRSA unavailable: {error}") from error


@router.get("/api/hips/spherex-rgb/{frames}/{path:path}")
def hips_rgb_tile(frames: str, path: str):
    try:
        data = hips.rgb_tile(_rgb_frames(frames), path)
    except hips.HipsError as error:
        raise HTTPException(404, str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(404, "Tile not available") from error
    except ImportError as error:
        raise HTTPException(500, "False colour needs the pillow package: python -m pip install pillow") from error
    except httpx.HTTPError as error:
        raise HTTPException(502, f"IRSA unavailable: {error}") from error
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/hips/spherex/{frame}/properties")
def hips_frame_properties(frame: int):
    if not 0 <= frame < hips.DEPTH:
        raise HTTPException(404, "No such frame")
    try:
        return PlainTextResponse(hips.frame_properties(frame))
    except httpx.HTTPError as error:
        raise HTTPException(502, f"IRSA unavailable: {error}") from error


@router.get("/api/hips/spherex/{frame}/{path:path}")
def hips_frame_tile(frame: int, path: str):
    try:
        data = hips.tile(frame, path)
    except hips.HipsError as error:
        raise HTTPException(404, str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(404, "Tile not available") from error
    except httpx.HTTPError as error:
        raise HTTPException(502, f"IRSA unavailable: {error}") from error
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/spherex/cutout")
def cutout(
    access_url: str = Query(..., description="access_url of a SPHEREx image from /observations"),
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    size: float = Query(0.1, description="Cutout width in degrees"),
    smooth: bool = Query(False, description="Smooth the display image (no new detail)"),
    shape: str = Query("square", pattern="^(square|circle)$", description="Display shape (circle blanks the corners)"),
):
    """Download a small cutout of one SPHEREx image and describe it."""
    _, meta, cutout_url, was_cached = _get_cutout(access_url, ra, dec, size, smooth, shape == "circle")
    meta["fits_url"] = f"/api/spherex/display/{meta['display_key']}.fits"
    meta["provenance"] = {
        "source": "NASA/IPAC Infrared Science Archive (IRSA)",
        "access_url": access_url,
        "cutout_url": cutout_url,
        "cutout_size_deg": size,
        "cached": was_cached,
    }
    return meta


@router.get("/api/spherex/compare")
def compare_pair(
    a: str = Query(..., description="access_url of the earlier observation"),
    b: str = Query(..., description="access_url of the later observation"),
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    size: float = Query(0.25, description="Comparison area width in degrees"),
):
    """Align two comparable observations and return difference/significance/combined images."""
    path_a, meta_a, url_a, _ = _get_cutout(a, ra, dec, size)
    path_b, meta_b, url_b, _ = _get_cutout(b, ra, dec, size)
    try:
        result = compare(path_a, meta_a, path_b, meta_b, ra, dec, size)
    except NotComparable as error:
        raise HTTPException(422, f"Not comparable: {error}") from error
    except MissingPackage as error:
        raise HTTPException(503, str(error)) from error
    result["provenance"] = {"a_cutout_url": url_a, "b_cutout_url": url_b, "size_deg": size}
    return result


@router.get("/api/spherex/compare-file/{name}")
def compare_file(name: str):
    """Serve a PNG or FITS made by /compare."""
    match = re.fullmatch(r"([0-9a-f]{20})_(a|b|diff|signif|combined)\.(png|fits)", name)
    if not match:
        raise HTTPException(404, "Not found")
    path = config.CACHE_DIR / "compare" / name
    if not path.exists():
        raise HTTPException(404, "Not found")
    media = "image/png" if name.endswith(".png") else "application/fits"
    return FileResponse(path, media_type=media)


@router.get("/api/catalogs/{name}")
def catalog(
    name: str,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius: float = Query(0.1, gt=0, le=catalogs.MAX_RADIUS_DEG, description="Search radius in degrees"),
):
    """Sources from SIMBAD, Gaia DR3 or AllWISE within a circle (for map overlays)."""
    if name not in catalogs.SOURCES:
        raise HTTPException(404, f"Unknown catalogue. Choose one of: {list(catalogs.SOURCES)}")
    try:
        return catalogs.query(name, ra, dec, radius)
    except catalogs.CatalogError as error:
        raise HTTPException(502, str(error)) from error


@router.get("/api/identify")
def identify(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius_arcsec: float = Query(10.0, gt=0, le=60),
):
    """What is at this position? Nearest SIMBAD / Gaia / AllWISE entries."""
    return catalogs.identify(ra, dec, radius_arcsec)


@router.get("/api/spherex/display/{key}.fits")
def display_fits(key: str):
    """Serve a display-ready FITS file made by /cutout."""
    if not re.fullmatch(r"[0-9a-f]{20}", key):
        raise HTTPException(404, "Not found")
    path = DISPLAY_DIR / f"{key}.fits"
    if not path.exists():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="application/fits")
