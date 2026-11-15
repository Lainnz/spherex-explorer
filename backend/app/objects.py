"""Click a star → what is it? (GET /api/object, PLAN.md §7.2 and §8.3).

Looks around the clicked spot in SIMBAD (names and object types, CDS) and Gaia DR3
(brightness, colour, distance and motion, ESA). Catalogue positions are for a fixed date
(SIMBAD: 2000, Gaia: 2016), but the sky being viewed is from 2025–26. A fast mover like
Barnard's Star has moved minutes of arc since then, so fast movers are searched for in a
wider circle and every candidate is moved to the viewing date before picking the nearest.
"""
import math

import numpy as np
import pyvo

from .cache import DAY, get_cache
from .motion import has_motion, position_at
from .resolve import ResolverUnavailable
from .settings import settings

GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap"
# Stars faster than 1″/yr are searched for up to 5′ away (Barnard's Star: ~10″/yr).
FAST_MAS_PER_YEAR = 1000
FAST_SEARCH_ARCSEC = 300
LIGHT_YEARS_PER_PARSEC = 3.26156
# A Gaia star this close to a SIMBAD object (with matching motion) is the same object.
SAME_OBJECT_ARCSEC = 1.5
# Trust a parallax for a distance only if its error is under 20%.
MAX_PARALLAX_FRACTION_ERROR = 0.2

TYPE_PLAIN = {
    "*": "A star.",
    "PM*": "A star that moves noticeably across the sky.",
    "LM*": "A small, low-mass star.",
    "BY*": "A cool star with starspots that make its brightness wobble as it spins.",
    "Mi*": "A pulsating red giant that brightens and fades over many months.",
    "TT*": "A very young star, still gathering gas from the disk around it.",
    "Y*O": "A young star that is still forming.",
    "BD*": "A brown dwarf: bigger than a planet but too small to shine like a true star.",
    "RG*": "A red giant: an old star that has swollen up.",
    "s*r": "A red supergiant: a huge, cool, very bright star near the end of its life.",
    "C*": "A carbon star: a cool giant whose atmosphere is rich in carbon.",
    "WD*": "A white dwarf: the hot, Earth-sized core left after a star like the Sun dies.",
    "V*": "A star whose brightness changes.",
    "**": "A double star.",
    "SB*": "Two stars orbiting so closely they look like one.",
    "EB*": "Two stars that take turns blocking each other's light.",
    "Cl*": "A cluster of stars born together.",
    "OpC": "An open cluster: a loose group of young stars born together.",
    "GlC": "A globular cluster: a ball of hundreds of thousands of old stars.",
    "HII": "A glowing cloud of gas lit up by young, hot stars.",
    "PN": "A planetary nebula: gas puffed off by a dying star.",
    "SNR": "The expanding remains of an exploded star.",
    "G": "A galaxy: billions of stars far beyond the Milky Way.",
    "QSO": "A quasar: a very distant galaxy with an extremely bright centre.",
}
NAME_PREFIXES = ("NAME ", "V* ", "** ", "* ")


def clean_name(name: str | None) -> str | None:
    """SIMBAD style → readable: "NAME Barnard's star" → "Barnard's star", "V* R Dra" → "R Dra"."""
    if not name:
        return name
    name = " ".join(str(name).split())
    for prefix in NAME_PREFIXES:
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def _plain(value):
    """Table cell → Python value, with masked/NaN/empty → None."""
    if value is None or np.ma.is_masked(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, bytes):
        value = value.decode()
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str):
        return value.strip() or None
    return value


def _rows(table) -> list[dict]:
    return [{name: _plain(row[name]) for name in table.colnames} for row in table]


def _circle(ra_column: str, dec_column: str, ra: float, dec: float, radius_arcsec: float) -> str:
    return (f"CONTAINS(POINT('ICRS', {ra_column}, {dec_column}), "
            f"CIRCLE('ICRS', {ra:.7f}, {dec:.7f}, {radius_arcsec / 3600:.7f})) = 1")


def simbad_query(adql: str) -> list[dict]:
    """Run ADQL on SIMBAD, trying each mirror (see resolve.py)."""
    last_error = None
    for server in settings.simbad_server_list:
        try:
            return _rows(pyvo.dal.TAPService(f"https://{server}/simbad/sim-tap").run_sync(adql).to_table())
        except Exception as error:  # this mirror is down: try the next
            last_error = error
    raise ResolverUnavailable(str(last_error))


def simbad_candidates(ra: float, dec: float, radius_arcsec: float) -> list[dict]:
    """SIMBAD objects near the click, plus fast movers from further away."""
    select = (
        "SELECT TOP 50 b.oid, b.main_id, b.ra, b.dec, b.otype, b.sp_type, b.pmra, b.pmdec, "
        "b.plx_value, b.plx_err, b.rvz_radvel, d.description AS type_name, f.V, f.G, f.J, f.K "
        "FROM basic AS b LEFT OUTER JOIN otypedef AS d ON b.otype = d.otype "
        "LEFT OUTER JOIN allfluxes AS f ON f.oidref = b.oid WHERE "
    )
    near = simbad_query(select + _circle("b.ra", "b.dec", ra, dec, radius_arcsec))
    fast = simbad_query(
        select + _circle("b.ra", "b.dec", ra, dec, FAST_SEARCH_ARCSEC)
        + f" AND b.pmra * b.pmra + b.pmdec * b.pmdec > {FAST_MAS_PER_YEAR**2}"
    )
    unique = {row["oid"]: row for row in near + fast}
    for row in unique.values():
        row["motion"] = {"ra": row["ra"], "dec": row["dec"], "epoch": 2000.0, "pmra": row["pmra"],
                         "pmdec": row["pmdec"], "parallax": row["plx_value"], "rv": row["rvz_radvel"]}
    return list(unique.values())


def simbad_other_names(oid: int, limit: int = 12) -> list[str]:
    rows = simbad_query(f"SELECT TOP {limit} id FROM ident WHERE oidref = {int(oid)}")
    return [clean_name(row["id"]) for row in rows if row["id"]]


def simbad_gaia_id(oid: int) -> int | None:
    """The Gaia DR3 source id SIMBAD lists for an object, if it has one.

    Used to make sure a Gaia star really is the same object as the SIMBAD match. On
    2026-11-14 a WISE 0855 click got paired with an unrelated background star because
    WISE 0855 is too faint for Gaia.
    """
    rows = simbad_query(f"SELECT id FROM ident WHERE oidref = {int(oid)} AND id LIKE 'Gaia DR3 %'")
    for row in rows:
        try:
            return int(str(row["id"]).split()[-1])
        except ValueError:
            continue
    return None


def gaia_candidates(ra: float, dec: float, radius_arcsec: float) -> list[dict]:
    """Gaia DR3 sources near the click, plus fast movers from further away."""
    service = pyvo.dal.TAPService(GAIA_TAP)
    select = (
        "SELECT TOP 50 source_id, ra, dec, ref_epoch, phot_g_mean_mag, bp_rp, parallax, "
        "parallax_error, pm, pmra, pmdec, radial_velocity FROM gaiadr3.gaia_source WHERE "
    )
    near = _rows(service.run_sync(select + _circle("ra", "dec", ra, dec, radius_arcsec)).to_table())
    fast = _rows(service.run_sync(
        select + _circle("ra", "dec", ra, dec, FAST_SEARCH_ARCSEC) + f" AND pm > {FAST_MAS_PER_YEAR}"
    ).to_table())
    unique = {row["source_id"]: row for row in near + fast}
    for row in unique.values():
        row["motion"] = {"ra": row["ra"], "dec": row["dec"], "epoch": row["ref_epoch"] or 2016.0,
                         "pmra": row["pmra"], "pmdec": row["pmdec"], "parallax": row["parallax"],
                         "rv": row["radial_velocity"]}
    return list(unique.values())


def gaia_query(adql: str) -> list[dict]:
    return _rows(pyvo.dal.TAPService(GAIA_TAP).run_sync(adql).to_table())


def fast_movers(ra: float, dec: float, radius_deg: float, min_pm_mas: float) -> list[dict]:
    """Gaia DR3 stars near (ra, dec) moving faster than `min_pm_mas` per year, for the
    time slider's moving markers. Fast stars are searched up to 5′ beyond the circle,
    since by 2026 they may have moved into it (Barnard's Star: ~100″ since 2016)."""
    cache = get_cache()
    key = f"movers:{ra:.4f}:{dec:.4f}:{radius_deg:.4f}:{min_pm_mas:.0f}"
    if key in cache:
        return cache[key]
    query = (
        "SELECT TOP 200 source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, phot_g_mean_mag "
        "FROM gaiadr3.gaia_source WHERE "
        + _circle("ra", "dec", ra, dec, radius_deg * 3600 + FAST_SEARCH_ARCSEC)
        + f" AND pm > {min_pm_mas} ORDER BY phot_g_mean_mag"
    )
    movers = [
        {
            "name": f"Gaia DR3 {row['source_id']}",
            "source_id": str(row["source_id"]),
            "motion": {"ra": row["ra"], "dec": row["dec"], "epoch": row["ref_epoch"] or 2016.0,
                       "pmra": row["pmra"], "pmdec": row["pmdec"], "parallax": row["parallax"]},
            "magnitude_g": round(row["phot_g_mean_mag"], 2) if row["phot_g_mean_mag"] is not None else None,
            "pm_arcsec_per_year": round(math.hypot(row["pmra"], row["pmdec"]) / 1000, 3),
        }
        for row in gaia_query(query)
        if row["pmra"] is not None and row["pmdec"] is not None
    ]
    cache.set(key, movers, expire=30 * DAY)
    return movers


def separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Angle between two sky positions (haversine formula, fine for small angles)."""
    ra1, dec1, ra2, dec2 = map(math.radians, (ra1, dec1, ra2, dec2))
    a = math.sin((dec2 - dec1) / 2) ** 2 + math.cos(dec1) * math.cos(dec2) * math.sin((ra2 - ra1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600


def nearest(candidates: list[dict], ra: float, dec: float, mjd: float, radius_arcsec: float) -> dict | None:
    """The candidate closest to the click once moved to the viewing date, if within the radius."""
    best, best_sep = None, radius_arcsec
    for candidate in candidates:
        if has_motion(candidate["motion"]):
            cra, cdec = position_at(candidate["motion"], mjd)
        else:
            cra, cdec = candidate["ra"], candidate["dec"]
        sep = separation_arcsec(ra, dec, cra, cdec)
        if sep <= best_sep:
            best, best_sep = {**candidate, "ra_now": cra, "dec_now": cdec, "separation_arcsec": sep}, sep
    return best


def motions_agree(simbad: dict, gaia: dict) -> bool:
    """Do two catalogue entries move like the same object?

    Agreement within 30 mas/yr or 25% of SIMBAD's motion, whichever is larger. When a
    motion is missing, only slow objects (< 100 mas/yr) are accepted on position alone.
    """
    if simbad.get("pmra") is None or simbad.get("pmdec") is None:
        return True
    simbad_pm = math.hypot(simbad["pmra"], simbad["pmdec"])
    if gaia.get("pmra") is None or gaia.get("pmdec") is None:
        return simbad_pm < 100
    difference = math.hypot(simbad["pmra"] - gaia["pmra"], simbad["pmdec"] - gaia["pmdec"])
    return difference < max(30.0, 0.25 * simbad_pm)


def distance_light_years(parallax_mas: float | None, error_mas: float | None) -> dict | None:
    """Parallax → distance. None if unknown or too uncertain to be useful."""
    if not parallax_mas or parallax_mas <= 0:
        return None
    if error_mas and error_mas / parallax_mas > MAX_PARALLAX_FRACTION_ERROR:
        return None
    value = 1000 / parallax_mas * LIGHT_YEARS_PER_PARSEC
    error = value * (error_mas / parallax_mas) if error_mas else None
    # Two significant figures for the error (0.00044, not 0.0).
    return {"value": round(value, 2 if value < 100 else 0), "error": float(f"{error:.2g}") if error else None}


def describe(simbad: dict | None, gaia: dict | None, other_names: list[str]) -> dict:
    """Combine the matches into the plain-language answer the popup shows."""
    best = simbad or gaia
    # Gaia's motions are the most precise; SIMBAD fills in for objects Gaia lacks.
    motion_source = gaia if gaia and gaia.get("pmra") is not None else (simbad or {})
    pmra, pmdec = motion_source.get("pmra"), motion_source.get("pmdec")
    type_code = (simbad or {}).get("otype") or ("*" if gaia else None)
    distance = None
    if gaia:
        distance = distance_light_years(gaia.get("parallax"), gaia.get("parallax_error"))
    if distance is None and simbad:
        distance = distance_light_years(simbad.get("plx_value"), simbad.get("plx_err"))
    name = clean_name(simbad["main_id"]) if simbad else f"Gaia DR3 {gaia['source_id']}"
    return {
        "found": True,
        "name": name,
        "other_names": [n for n in other_names if n != name][:10],
        "type_code": type_code,
        "type_name": (simbad or {}).get("type_name") or ("Star" if gaia else None),
        "what_is_this": TYPE_PLAIN.get(type_code),
        "spectral_type": (simbad or {}).get("sp_type"),
        "magnitude_g": round(gaia["phot_g_mean_mag"], 2) if gaia and gaia.get("phot_g_mean_mag") else (simbad or {}).get("G"),
        "magnitude_v": (simbad or {}).get("V"),
        "magnitude_k": (simbad or {}).get("K"),
        "colour_bp_rp": round(gaia["bp_rp"], 2) if gaia and gaia.get("bp_rp") is not None else None,
        "distance_ly": distance,
        "proper_motion_arcsec_per_year": (
            round(math.hypot(pmra, pmdec) / 1000, 3) if pmra is not None and pmdec is not None else None
        ),
        "radial_velocity_km_s": (gaia or {}).get("radial_velocity") or (simbad or {}).get("rvz_radvel"),
        "ra": round(best["ra_now"], 6),
        "dec": round(best["dec_now"], 6),
        "separation_arcsec": round(best["separation_arcsec"], 2),
        "simbad_id": simbad["main_id"] if simbad else None,
        "gaia_source_id": str(gaia["source_id"]) if gaia else None,
        "sources": [s for s, m in (("SIMBAD", simbad), ("Gaia DR3", gaia)) if m],
    }


def identify(ra: float, dec: float, radius_arcsec: float, mjd: float) -> dict:
    """The answer for one click. Raises ResolverUnavailable only if both catalogues fail."""
    cache = get_cache()
    # v3: answers saved before the current Gaia same-object rules aren't reused.
    key = f"object:v3:{ra:.5f}:{dec:.5f}:{radius_arcsec:.1f}:{mjd:.0f}"
    if key in cache:
        return cache[key]

    simbad = gaia = None
    other_names: list[str] = []
    simbad_gaia = None
    failures = 0
    try:
        simbad = nearest(simbad_candidates(ra, dec, radius_arcsec), ra, dec, mjd, radius_arcsec)
        if simbad:
            other_names = simbad_other_names(simbad["oid"])
            simbad_gaia = simbad_gaia_id(simbad["oid"])
    except ResolverUnavailable:
        failures += 1
    try:
        candidates = gaia_candidates(ra, dec, radius_arcsec)
        if simbad and failures == 0:
            # Same object only: the Gaia star SIMBAD names, or (when SIMBAD names none, as
            # for RW Aur) a Gaia star right on top of it that moves the same way.
            if simbad_gaia is not None:
                matches = [c for c in candidates if c["source_id"] == simbad_gaia]
                gaia = nearest(matches, ra, dec, mjd, radius_arcsec * 3) if matches else None
            else:
                close = nearest(candidates, simbad["ra_now"], simbad["dec_now"], mjd, SAME_OBJECT_ARCSEC)
                gaia = close if close and motions_agree(simbad, close) else None
        else:
            gaia = nearest(candidates, ra, dec, mjd, radius_arcsec)
    except Exception:  # Gaia archive trouble
        failures += 1
    if failures == 2:
        raise ResolverUnavailable("SIMBAD and Gaia are both unavailable")

    if simbad or gaia:
        answer = describe(simbad, gaia, other_names)
    else:
        answer = {"found": False, "ra": ra, "dec": dec,
                  "message": "No catalogued object here. It may be too faint for SIMBAD and Gaia."}
    if failures == 0:
        cache.set(key, answer, expire=30 * DAY)
    return answer
