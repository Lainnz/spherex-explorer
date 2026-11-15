"""Building an honest time series of SPHEREx observations at one sky position.

Why this is needed: SPHEREx uses linear variable filters, so the wavelength a
pixel sees changes across each detector. Two observations of the same spot are
only directly comparable if the spot landed where the detector sees (nearly)
the same wavelength.

To find that wavelength for every observation without downloading whole
images, we download only two small pieces of each FITS file (HTTP range
requests, supported by IRSA):
  * the start of the file  -> the IMAGE header (sky coordinates, times)
  * the end of the file    -> the WCS-WAVE lookup table (wavelength per pixel)
Then Astropy converts our RA/Dec to a detector pixel and looks up the
wavelength there.
"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from statistics import median

import httpx
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
import astropy.units as u
from astropy.wcs import WCS

from . import config

BLOCK = 2880  # FITS files are organised in 2880-byte blocks
HEAD_BYTES = 49152  # enough for the primary header + IMAGE header
TAIL_BYTES = 17280  # enough for the WCS-WAVE table at the end of the file


def _get_range(client: httpx.Client, url: str, range_header: str) -> bytes:
    response = client.get(url, headers={"Range": range_header}, timeout=config.HTTP_TIMEOUT)
    response.raise_for_status()
    return response.content


def _find_hdu(data: bytes, xtension: str, extname: str) -> int:
    """Byte offset of the HDU with this XTENSION and EXTNAME inside `data`, or -1."""
    for offset in range(0, len(data) - BLOCK + 1, BLOCK):
        block = data[offset : offset + BLOCK].decode("ascii", errors="replace")
        if block.startswith(f"XTENSION= '{xtension}"):
            header_text = data[offset : offset + 10 * BLOCK].decode("ascii", errors="replace")
            end = header_text.find("END     ")
            if f"EXTNAME = '{extname}" in header_text[: end if end > 0 else None]:
                return offset
    return -1


def _header_from_bytes(data: bytes) -> fits.Header:
    """Parse FITS header cards (80 characters each) up to and including END."""
    text = data.decode("ascii", errors="replace")
    for start in range(0, len(text) - 79, 80):
        if text[start : start + 8] == "END     ":
            return fits.Header.fromstring(text[: start + 80])
    raise ValueError("Header END card not found (header larger than expected?)")


def wavelength_at_target(client: httpx.Client, access_url: str, ra: float, dec: float) -> dict:
    """Detector pixel and wavelength (µm) seen at (ra, dec) in one SPHEREx image."""
    key = hashlib.sha1(f"{access_url}|{ra:.5f}|{dec:.5f}".encode()).hexdigest()[:20]
    folder = config.CACHE_DIR / "wavelengths"
    folder.mkdir(parents=True, exist_ok=True)
    cache_file = folder / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    head = _get_range(client, access_url, f"bytes=0-{HEAD_BYTES - 1}")
    image_at = _find_hdu(head, "IMAGE", "IMAGE")
    if image_at < 0:
        raise ValueError("IMAGE header not found at the start of the file")
    header = _header_from_bytes(head[image_at:])

    tail = _get_range(client, access_url, f"bytes=-{TAIL_BYTES}")
    table_at = _find_hdu(tail, "BINTABLE", "WCS-WAVE")
    if table_at < 0:
        raise ValueError("WCS-WAVE table not found at the end of the file")
    table_hdu = fits.BinTableHDU.fromstring(tail[table_at:])

    sky_wcs = WCS(header)
    x, y = (float(v) for v in sky_wcs.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg)))
    nx, ny = int(header["NAXIS1"]), int(header["NAXIS2"])
    inside = 0 <= x <= nx - 1 and 0 <= y <= ny - 1

    wavelength = bandwidth = None
    if inside:
        wave_wcs = WCS(header, fobj=fits.HDUList([fits.PrimaryHDU(), table_hdu]), key="W")
        wl, bw = wave_wcs.pixel_to_world_values(x, y)
        if np.isfinite(wl):
            wavelength, bandwidth = round(float(wl), 4), round(float(bw), 4)

    result = {
        "detector_pixel": [round(x, 1), round(y, 1)],
        "inside": inside,
        "wavelength_um": wavelength,
        "bandwidth_um": bandwidth,
        "date_avg_utc": header.get("DATE-AVG"),
        "mjd_avg": header.get("MJD-AVG"),
    }
    cache_file.write_text(json.dumps(result))
    return result


def group_channels(observations: list[dict]) -> list[dict]:
    """Group observations whose target wavelengths agree within half a bandwidth.

    Greedy grouping in wavelength order: each group starts at its shortest
    wavelength and accepts observations within `tolerance` of that start.
    """
    usable = sorted(
        (o for o in observations if o.get("wavelength_um") is not None),
        key=lambda o: o["wavelength_um"],
    )
    channels: list[dict] = []
    for obs in usable:
        tolerance = 0.5 * (obs.get("bandwidth_um") or 0.03)
        if channels and obs["wavelength_um"] - channels[-1]["start_um"] <= channels[-1]["tolerance_um"]:
            channels[-1]["members"].append(obs)
        else:
            channels.append({"start_um": obs["wavelength_um"], "tolerance_um": tolerance, "members": [obs]})

    result = []
    for channel in channels:
        members = sorted(channel["members"], key=lambda o: o["time_mjd"] or 0)
        wavelengths = [m["wavelength_um"] for m in members]
        result.append(
            {
                "band": members[0].get("band"),
                "wavelength_um": round(median(wavelengths), 4),
                "wavelength_spread_um": round(max(wavelengths) - min(wavelengths), 4),
                "tolerance_um": round(channel["tolerance_um"], 4),
                "observation_ids": [m["id"] for m in members],
                "count": len(members),
                "first_utc": members[0]["time_utc"],
                "last_utc": members[-1]["time_utc"],
                "span_days": round((members[-1]["time_mjd"] or 0) - (members[0]["time_mjd"] or 0), 2),
            }
        )
    result.sort(key=lambda c: (-c["count"], c["wavelength_um"]))
    return result


def build_timeline(observations: list[dict], ra: float, dec: float) -> dict:
    """Add the target wavelength to each observation and group into channels."""

    def enrich(obs: dict) -> dict:
        try:
            with httpx.Client(follow_redirects=True) as client:
                info = wavelength_at_target(client, obs["access_url"], ra, dec)
            return {**obs, **info, "error": None}
        except Exception as error:  # keep going; report per observation
            return {**obs, "inside": None, "wavelength_um": None, "bandwidth_um": None, "error": str(error)}

    with ThreadPoolExecutor(max_workers=16) as pool:
        enriched = list(pool.map(enrich, observations))

    enriched.sort(key=lambda o: o["time_mjd"] or 0)

    # Channels never mix detectors: each detector has its own optics and pixel response.
    usable = [o for o in enriched if o.get("inside")]
    channels: list[dict] = []
    for band in sorted({o.get("band") for o in usable}, key=str):
        channels.extend(group_channels([o for o in usable if o.get("band") == band]))
    channels.sort(key=lambda c: (-c["count"], c["wavelength_um"]))

    return {
        "observations": enriched,
        "channels": channels,
        "failed": sum(1 for o in enriched if o["error"]),
    }
