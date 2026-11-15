"""Talking to the NASA/IPAC IRSA archive.

search_images()  — asks IRSA's SIA2 service which SPHEREx images cover a sky position.
download_cutout() — downloads a small piece ("cutout") of one image.
"""

import hashlib
import io
import json
import math
import time
from pathlib import Path

import httpx
import numpy as np
from astropy.io.votable import parse_single_table
from astropy.time import Time

from . import config


class ArchiveError(Exception):
    """IRSA could not be reached or answered with an error."""


def _cache_path(kind: str, key: str, suffix: str) -> Path:
    digest = hashlib.sha1(key.encode()).hexdigest()[:20]
    folder = config.CACHE_DIR / kind
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{digest}{suffix}"


def _clean(value):
    """Turn VOTable values (numpy types, masked values, NaN) into plain JSON values."""
    if value is None or value is np.ma.masked:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, bytes):
        value = value.decode()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def search_images(ra: float, dec: float, collection: str) -> dict:
    """Return every SPHEREx image in `collection` whose footprint contains (ra, dec)."""
    key = f"v2|{collection}|{ra:.5f}|{dec:.5f}"  # v2: results include s_region (image outlines)
    cache_file = _cache_path("search", key, ".json")
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < config.SEARCH_CACHE_SECONDS:
        result = json.loads(cache_file.read_text())
        result["cached"] = True
        return result

    params = {
        "COLLECTION": collection,
        # A tiny circle (radius 0.001°) = "images that contain this point"
        "POS": f"CIRCLE {ra} {dec} 0.001",
        "RESPONSEFORMAT": "VOTable",
    }
    # IRSA's front-end proxy sometimes answers 502/503/504 for a moment: retry twice.
    for attempt in range(3):
        try:
            response = httpx.get(config.IRSA_SIA_URL, params=params, timeout=config.HTTP_TIMEOUT)
            response.raise_for_status()
            break
        except httpx.HTTPStatusError as error:
            if error.response.status_code in (502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise ArchiveError(f"IRSA image search failed: {error}") from error
        except httpx.HTTPError as error:
            raise ArchiveError(f"IRSA image search failed: {error}") from error

    # use_names_over_ids: label columns by their standard names (t_min, access_url, …)
    table = parse_single_table(io.BytesIO(response.content)).to_table(use_names_over_ids=True)
    observations = []
    for row in table:
        t_min = _clean(row["t_min"])  # MJD (days)
        em_min = _clean(row["em_min"])  # metres
        em_max = _clean(row["em_max"])
        observations.append(
            {
                "id": _clean(row["obs_publisher_did"]),
                "obs_id": _clean(row["obs_id"]),
                "band": _clean(row["energy_bandpassname"]),  # e.g. "SPHEREx-D2"
                "time_mjd": t_min,
                "time_utc": Time(t_min, format="mjd").isot[:19] + "Z" if t_min else None,
                "exposure_s": _clean(row["t_exptime"]),
                "wavelength_min_um": round(em_min * 1e6, 4) if em_min else None,
                "wavelength_max_um": round(em_max * 1e6, 4) if em_max else None,
                "pixel_scale_arcsec": _clean(row["s_pixel_scale"]),
                "access_url": _clean(row["access_url"]),
                "collection": _clean(row["obs_collection"]),
                "subtype": _clean(row["dataproduct_subtype"]),
                "s_region": _clean(row["s_region"]) if "s_region" in row.colnames else None,
            }
        )
    observations.sort(key=lambda o: (o["time_mjd"] or 0, o["band"] or ""))

    result = {
        "query": {"ra": ra, "dec": dec, "collection": collection},
        "collection_name": config.COLLECTIONS[collection],
        "count": len(observations),
        "observations": observations,
        "source": f"{response.url}",
        "retrieved_utc": Time.now().isot[:19] + "Z",
        "cached": False,
    }
    cache_file.write_text(json.dumps(result))
    return result


def download_cutout(access_url: str, ra: float, dec: float, size_deg: float) -> tuple[Path, str, bool]:
    """Download (or reuse) a cutout. Returns (file path, cutout URL, was_cached)."""
    cutout_url = f"{access_url}?center={ra:.6f},{dec:.6f}&size={size_deg:g}"
    path = _cache_path("cutouts", cutout_url, ".fits")
    if path.exists() and path.stat().st_size > 0:
        return path, cutout_url, True

    # IRSA sometimes answers "503 busy" for a moment; wait and try again (3 tries)
    for attempt in range(3):
        try:
            response = httpx.get(cutout_url, timeout=config.HTTP_TIMEOUT, follow_redirects=True)
            if response.status_code in (502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            response.raise_for_status()
            break
        except httpx.HTTPError as error:
            if attempt == 2:
                raise ArchiveError(f"IRSA cutout download failed: {error}") from error
            time.sleep(2 * (attempt + 1))

    if not response.content.startswith(b"SIMPLE  ="):
        raise ArchiveError("IRSA did not return a FITS file for this cutout.")

    tmp = path.with_suffix(".part")
    tmp.write_bytes(response.content)
    tmp.replace(path)  # only appears in the cache once complete
    return path, cutout_url, False
