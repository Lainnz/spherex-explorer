"""A pool of random sky spots the server has already searched at IRSA, so the Randomize
button is instant instead of waiting minutes for a new search.

A background task (started with the server) first makes sure the featured targets and
famous sights are searched, then keeps POOL_SIZE random spots ready, one search at a
time with pauses in between, backing off when IRSA misbehaves. IRSA's answers are kept by
irsa.py's cache (DR1 for 30 days), so a pooled spot opens without a new search.
"""
import asyncio
import logging
import time

import numpy as np

from . import irsa
from .cache import DAY, get_cache
from .config import load_datasets, load_targets
from .observations import SEARCH_RADIUS_DEG, search_position
from .random_target import uniform_sky_position

POOL_KEY = "random-pool"
POOL_SIZE = 12
MAX_AGE_SECONDS = 20 * DAY  # well inside DR1's 30-day search cache
PAUSE_SECONDS = 20  # between searches: be polite to IRSA
BACKOFF_SECONDS = 300  # after IRSA refuses
log = logging.getLogger(__name__)


def pooled_spots() -> list[dict]:
    """Spots ready to go (searched recently, with SPHEREx images)."""
    now = time.time()
    return [spot for spot in get_cache().get(POOL_KEY, []) if now - spot["warmed"] < MAX_AGE_SECONDS]


def _save(spots: list[dict]) -> None:
    get_cache().set(POOL_KEY, spots)


def take_spot(rng: np.random.Generator) -> dict | None:
    """Hand out one pooled spot (and remove it, so the next Randomize differs)."""
    spots = pooled_spots()
    if not spots:
        return None
    spot = spots.pop(int(rng.integers(len(spots))))
    _save(spots)
    return spot


async def search_spot(ra: float, dec: float, motion: dict | None = None) -> int:
    """Search IRSA for a spot exactly as the Stellar View will (so the answer is cached).
    Returns how many images were found."""
    datasets = load_datasets()
    releases = {rid: datasets["releases"][rid] for rid in datasets["default_releases"]}
    search_ra, search_dec = search_position(ra, dec, motion)
    rows, _ = await irsa.search_releases(releases, search_ra, search_dec, SEARCH_RADIUS_DEG)
    return len(rows)


async def keep_warm(rng: np.random.Generator | None = None) -> None:
    """Run forever (until the server stops): famous spots first, then fill the pool."""
    rng = rng or np.random.default_rng()
    targets = load_targets()
    famous = [(t["ra"], t["dec"], t.get("motion")) for t in targets["targets"]]
    famous += [(s["ra"], s["dec"], None) for s in targets["interesting"]]
    for ra, dec, motion in famous:
        try:
            await search_spot(ra, dec, motion)
        except irsa.IrsaUnavailable:
            await asyncio.sleep(BACKOFF_SECONDS)
            continue
        await asyncio.sleep(PAUSE_SECONDS)

    while True:
        spots = pooled_spots()
        if len(spots) >= POOL_SIZE:
            await asyncio.sleep(600)
            continue
        ra, dec = uniform_sky_position(rng)
        try:
            found = await search_spot(ra, dec)
        except irsa.IrsaUnavailable as error:
            log.info("Random pool: IRSA unavailable (%s); waiting", error)
            await asyncio.sleep(BACKOFF_SECONDS)
            continue
        if found:
            spots = pooled_spots()
            spots.append({"ra": round(ra, 5), "dec": round(dec, 5), "images": found, "warmed": time.time()})
            _save(spots)
        await asyncio.sleep(PAUSE_SECONDS)
