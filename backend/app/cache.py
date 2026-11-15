"""A disk cache, so slow answers from IRSA and SIMBAD are only fetched once.

It lives on disk (not just in memory) because a SPHEREx search takes minutes and the
development server restarts every time a file is saved.
"""
from functools import lru_cache

from diskcache import Cache

from .settings import settings

HOUR = 3600
DAY = 24 * HOUR


@lru_cache
def get_cache() -> Cache:
    # When full, drop whatever was used longest ago (cutouts of old searches).
    return Cache(
        str(settings.cache_dir),
        size_limit=int(settings.cache_max_gb * 1024**3),
        eviction_policy="least-recently-used",
    )
