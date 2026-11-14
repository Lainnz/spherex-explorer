"""Searching NASA's archive (IRSA) for SPHEREx images, using its SIA image search.

Facts this relies on were checked live on 2026-11-14 (docs/DATA_NOTES.md):
- Each search takes 2.5-3 minutes, so the timeout is long and answers are cached.
- One obs_id covers all six detectors; an image is (obs_id, detector).
- em_min/em_max are in metres; t_min/t_max are MJD.
"""
import asyncio
import io
import re

import httpx
from astropy.io.votable import parse

from .cache import HOUR, get_cache
from .settings import settings

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
USER_AGENT = "spherex-xplorer/0.1 (+https://github.com/Lainnz/spherex-explorer)"
# e.g. ".../l2b-v27-2026-228/6/level2_..." → "l2b-v27-2026-228"
VERSION_RE = re.compile(r"l2b-v\d+-\d{4}-\d{3}")
RETRIES = 3
# New QR3 data arrives weekly, so search results are only kept for 6 hours.
SEARCH_CACHE_SECONDS = 6 * HOUR

_semaphore: asyncio.Semaphore | None = None


class IrsaUnavailable(Exception):
    """IRSA didn't answer, or answered with an error."""


def _limit() -> asyncio.Semaphore:
    """Cap how many requests we send IRSA at once (be polite to a shared service)."""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(settings.irsa_concurrency)
    return _semaphore


async def fetch_sia(collection: str, ra: float, dec: float, radius_deg: float) -> bytes:
    """Run one SIA search and return the raw VOTable answer.

    Fast failures (busy server, dropped connection) are retried with growing pauses.
    A timeout is not retried: it already waited minutes.
    """
    params = {
        "COLLECTION": collection,
        "POS": f"circle {ra:.6f} {dec:.6f} {radius_deg:.6f}",
        "RESPONSEFORMAT": "VOTABLE",
    }
    headers = {"User-Agent": USER_AGENT}
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=settings.irsa_timeout_s, headers=headers) as client:
        for attempt in range(RETRIES):
            try:
                async with _limit():
                    response = await client.get(SIA_URL, params=params)
                if response.status_code < 500:
                    response.raise_for_status()
                    return response.content
                last_error = IrsaUnavailable(f"IRSA answered HTTP {response.status_code}")
            except httpx.TimeoutException as error:
                raise IrsaUnavailable(f"IRSA took longer than {settings.irsa_timeout_s:.0f} s") from error
            except httpx.TransportError as error:
                last_error = error
            await asyncio.sleep(2 * 2**attempt)
    raise IrsaUnavailable(str(last_error)) from last_error


def parse_sia(content: bytes, release: str, survey: str) -> list[dict]:
    """Turn an SIA VOTable into plain dicts with the fields the rest of the app uses."""
    votable = parse(io.BytesIO(content))
    for resource in votable.resources:
        for info in resource.infos:
            if info.name == "QUERY_STATUS" and info.value == "ERROR":
                raise IrsaUnavailable(f"IRSA reported an error: {info.content}")
    # Columns are addressed by name (s_ra, obs_id, ...); IRSA's internal IDs differ.
    table = votable.get_first_table().to_table(use_names_over_ids=True)

    rows = []
    for row in table:
        url = str(row["access_url"])
        bandpass = str(row["energy_bandpassname"])  # "SPHEREx-D3"
        version = VERSION_RE.search(url)
        t_min, t_max = float(row["t_min"]), float(row["t_max"])
        rows.append(
            {
                "obs_id": str(row["obs_id"]),
                "release": release,
                "survey": survey,
                "detector": int(bandpass.rsplit("D", 1)[1]),
                "bandpass": bandpass,
                "t_start": t_min,
                "t_end": t_max,
                "t_mid": (t_min + t_max) / 2,
                "em_min_um": float(row["em_min"]) * 1e6,
                "em_max_um": float(row["em_max"]) * 1e6,
                "processing_version": version.group(0) if version else None,
                "access_url": url,
                "s_region": str(row["s_region"]),
            }
        )
    return rows


async def search_collection(
    collection: str, release: str, survey: str, ra: float, dec: float, radius_deg: float
) -> list[dict]:
    """One collection's images around a position, from the cache when possible."""
    key = f"sia:{collection}:{ra:.4f}:{dec:.4f}:{radius_deg:.4f}"
    cache = get_cache()
    rows = cache.get(key)
    if rows is None:
        content = await fetch_sia(collection, ra, dec, radius_deg)
        rows = parse_sia(content, release, survey)
        cache.set(key, rows, expire=SEARCH_CACHE_SECONDS)
    return rows


async def search_releases(releases: dict[str, dict], ra: float, dec: float, radius_deg: float) -> list[dict]:
    """Search every wide and deep collection of the chosen releases at the same time.

    `releases` maps a release id ("dr1") to its entry in datasets.json.
    """
    jobs = [
        search_collection(collection, release_id, survey, ra, dec, radius_deg)
        for release_id, release in releases.items()
        for survey, collection in release["sia_collections"].items()
    ]
    results = await asyncio.gather(*jobs)
    return [row for rows in results for row in rows]
