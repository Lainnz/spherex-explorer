"""Confirmed exoplanets from the NASA Exoplanet Archive (Milestone 4).

One TAP query of the Planetary Systems Composite Parameters table (pscomppars: one row per
planet, best available value for each column), kept on disk for a day. If the archive
doesn't answer, the last saved copy is served and marked stale, so the Planets tab keeps
working.

Column names: https://exoplanetarchive.ipac.caltech.edu/docs/API_PSCompPars_columns.html
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .settings import settings

TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
COLUMNS = [
    "pl_name", "hostname", "ra", "dec", "sy_dist",           # name, host, position (deg), distance (pc)
    "pl_rade", "pl_bmasse", "pl_dens",                       # radius (Earth radii), mass or M·sin i (Earth masses), density (g/cm³)
    "pl_eqt", "pl_insol",                                    # equilibrium temperature (K), starlight received (Earth = 1)
    "pl_orbper", "pl_orbsmax",                               # orbital period (days), orbit size (au)
    "st_teff", "st_lum", "st_spectype",                      # star temperature (K), log10 luminosity (Sun = 0), spectral type
    "sy_snum", "sy_pnum", "disc_year", "discoverymethod",
]
QUERY = f"select {','.join(COLUMNS)} from pscomppars"
FRESH_SECONDS = 24 * 3600
TIMEOUT_S = 120


class PlanetsUnavailable(Exception):
    """The archive didn't answer and there's no saved copy yet."""


def _cache_file() -> Path:
    return Path(settings.cache_dir) / "planets" / "pscomppars.json"


def fetch_archive() -> list[list]:
    """Ask the archive for every confirmed planet; returns rows in COLUMNS order."""
    response = httpx.get(TAP_URL, params={"query": QUERY, "format": "json"}, timeout=TIMEOUT_S, follow_redirects=True)
    response.raise_for_status()
    records = response.json()
    if not isinstance(records, list):
        raise ValueError("The archive's answer wasn't a list of planets")
    return [[record.get(column) for column in COLUMNS] for record in records]


def load_planets(fetch=fetch_archive, now=time.time) -> dict:
    """{source, query, columns, rows, fetched, stale[, warning]} — from disk when fresh."""
    path = _cache_file()
    saved = json.loads(path.read_text()) if path.exists() else None
    if saved and now() - saved["fetched_unix"] < FRESH_SECONDS:
        return {**saved, "stale": False}
    try:
        rows = fetch()
    except (httpx.HTTPError, ValueError) as error:
        if saved:
            return {**saved, "stale": True,
                    "warning": f"NASA's Exoplanet Archive didn't answer ({error.__class__.__name__}); showing the copy from {saved['fetched']}."}
        raise PlanetsUnavailable("NASA's Exoplanet Archive isn't answering right now. Please try again in a few minutes.") from error
    result = {
        "source": "NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)",
        "query": QUERY,
        "columns": COLUMNS,
        "rows": rows,
        "fetched": datetime.fromtimestamp(now(), tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "fetched_unix": now(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result))
    return {**result, "stale": False}
