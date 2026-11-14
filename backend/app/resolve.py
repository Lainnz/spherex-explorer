"""Turning a name ("Barnard's Star", "R Dra") into coordinates and motion.

Featured targets come from config/targets.json, so they work without SIMBAD.
Anything else is looked up in SIMBAD (CDS), trying each mirror in turn: on
2026-11-14 the Strasbourg server was down and the Harvard mirror worked.
"""
import re

import numpy as np
from astroquery.simbad import Simbad

from .cache import DAY, get_cache
from .config import load_targets
from .settings import settings

SIMBAD_FIELDS = ("pmra", "pmdec", "plx_value", "plx_err", "rvz_radvel", "otype", "sp_type")


class ResolverUnavailable(Exception):
    """No SIMBAD mirror answered."""


def normalize(name: str) -> str:
    """Compare names loosely: "Barnard's Star", "barnards-star" and "BARNARDS STAR" match."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def find_featured(name: str) -> dict | None:
    """A featured target whose slug, name or alias matches `name`."""
    wanted = normalize(name)
    for target in load_targets()["targets"]:
        names = [target["slug"], target["name"], *target.get("aliases", [])]
        if wanted in {normalize(n) for n in names}:
            return target
    return None


def _value(row, column):
    """A table cell as a plain Python value, or None if SIMBAD has no value."""
    value = row[column]
    if value is None or np.ma.is_masked(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value.strip() or None if isinstance(value, str) else value


def simbad_lookup(name: str) -> dict | None:
    """Ask SIMBAD about `name`. Returns None if SIMBAD doesn't know it.

    Raises ResolverUnavailable if every mirror fails.
    """
    last_error: Exception | None = None
    for server in settings.simbad_server_list:
        simbad = Simbad()
        simbad.server = server
        try:
            # Adding fields already contacts the server, so it belongs inside the try.
            simbad.add_votable_fields(*SIMBAD_FIELDS)
            table = simbad.query_object(name)
        except Exception as error:  # network or server trouble: try the next mirror
            last_error = error
            continue
        if len(table) == 0:
            return None
        row = table[0]
        ra, dec = float(row["ra"]), float(row["dec"])
        return {
            "simbad_id": _value(row, "main_id"),
            "ra": ra,
            "dec": dec,
            "otype": _value(row, "otype"),
            "sp_type": _value(row, "sp_type"),
            # SIMBAD positions are ICRS at epoch J2000.
            "motion": {
                "ra": ra,
                "dec": dec,
                "epoch": 2000.0,
                "pmra": _value(row, "pmra"),
                "pmdec": _value(row, "pmdec"),
                "parallax": _value(row, "plx_value"),
                "parallax_err": _value(row, "plx_err"),
                "rv": _value(row, "rvz_radvel"),
            },
            "server": server,
        }
    raise ResolverUnavailable(str(last_error))


def resolve(name: str) -> dict | None:
    """Name → {name, ra, dec, motion, otype, sp_type, source, slug?}.

    `ra`/`dec` are where to search and centre the view. `motion` is the catalogue
    position, date and proper motion, used to work out where the object was in each
    image. They differ only for WISE 0855, whose featured coordinates are the team's.
    """
    featured = find_featured(name)
    if featured:
        return {
            "name": featured["name"],
            "slug": featured["slug"],
            "ra": featured["ra"],
            "dec": featured["dec"],
            "motion": featured.get("motion"),
            "otype": featured.get("otype"),
            "sp_type": featured.get("sp_type"),
            "source": "featured",
        }

    cache = get_cache()
    key = f"simbad:{normalize(name)}"
    if key in cache:
        return cache[key]
    found = simbad_lookup(name)
    result = None
    if found:
        result = {
            "name": found["simbad_id"] or name,
            "ra": found["ra"],
            "dec": found["dec"],
            "motion": found["motion"],
            "otype": found["otype"],
            "sp_type": found["sp_type"],
            "source": "simbad",
        }
    cache.set(key, result, expire=30 * DAY)
    return result
