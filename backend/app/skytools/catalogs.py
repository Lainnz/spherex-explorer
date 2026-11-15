"""Astronomical catalogues: SIMBAD (named objects), Gaia DR3 (stars), AllWISE (infrared).

All three are queried with the standard TAP protocol (ADQL, a SQL dialect for
the sky). Each catalogue has an official primary service and a mirror/backup;
if one is down we try the next and report which one answered.

Tested 2026-11-14: CDS SIMBAD showed "Page unavailable" while the official
Harvard-CfA mirror worked; IRSA's catalogue service returned 502 errors.
"""

import csv
import hashlib
import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import config

# (label, TAP sync URL, table name) — tried in order
SOURCES = {
    "simbad": [
        ("SIMBAD (CDS, Strasbourg)", "https://simbad.cds.unistra.fr/simbad/sim-tap/sync", None),
        ("SIMBAD (Harvard-CfA mirror)", "https://simbad.cfa.harvard.edu/simbad/sim-tap/sync", None),
    ],
    "gaia": [
        ("Gaia DR3 via NASA/IPAC IRSA", "https://irsa.ipac.caltech.edu/TAP/sync", "gaia_dr3_source"),
        ("Gaia DR3 via ESA Gaia Archive", "https://gea.esac.esa.int/tap-server/tap/sync", "gaiadr3.gaia_source"),
    ],
    "allwise": [
        ("AllWISE via NASA/IPAC IRSA", "https://irsa.ipac.caltech.edu/TAP/sync", "allwise_p3as_psd"),
        # This service doesn't support ADQL geometry (CONTAINS/POINT), so we use a box (see _where)
        ("AllWISE via NOIRLab Astro Data Lab", "https://datalab.noirlab.edu/tap/sync", "allwise.source"),
    ],
}

ATTRIBUTION = {
    "simbad": "SIMBAD database, operated at CDS, Strasbourg, France",
    "gaia": "ESA Gaia mission, Data Release 3 (DPAC)",
    "allwise": "NASA Wide-field Infrared Survey Explorer (WISE/NEOWISE), AllWISE catalogue",
}

TEXT_COLUMNS = {"source_id", "designation", "main_id", "otype", "sp_type", "ph_qual", "var_flg", "cc_flags", "phot_variable_flag"}

MAX_RADIUS_DEG = 0.5
LIMITS = {"simbad": 1000, "gaia": 3000, "allwise": 3000}


class CatalogError(Exception):
    pass


# Services that failed recently are tried last for a while (saves long timeouts)
_failed_until: dict[str, float] = {}
FAILURE_COOLDOWN_S = 600


def _ordered_sources(name: str):
    now = time.time()
    sources = SOURCES[name]
    return sorted(sources, key=lambda s: _failed_until.get(s[1], 0) > now)  # healthy first, order kept


BOX_ONLY_SERVICES = {"https://datalab.noirlab.edu/tap/sync"}


def _cone(ra_col: str, dec_col: str, ra: float, dec: float, radius: float, box: bool = False) -> str:
    """Region condition: an ADQL circle, or (for services without ADQL geometry) an RA/Dec box
    that encloses the circle; rows outside the circle are removed afterwards in Python."""
    if not box:
        return f"CONTAINS(POINT('ICRS', {ra_col}, {dec_col}), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius:.6f})) = 1"
    dec_lo, dec_hi = max(-90.0, dec - radius), min(90.0, dec + radius)
    if dec_hi >= 89.9 or dec_lo <= -89.9:
        return f"{dec_col} BETWEEN {dec_lo:.6f} AND {dec_hi:.6f}"
    half_width = radius / max(math.cos(math.radians(max(abs(dec_lo), abs(dec_hi)))), 1e-6)
    ra_lo, ra_hi = ra - half_width, ra + half_width
    dec_part = f"{dec_col} BETWEEN {dec_lo:.6f} AND {dec_hi:.6f}"
    if ra_lo < 0:  # box crosses RA = 0
        return f"{dec_part} AND ({ra_col} >= {ra_lo + 360:.6f} OR {ra_col} <= {ra_hi:.6f})"
    if ra_hi >= 360:
        return f"{dec_part} AND ({ra_col} >= {ra_lo:.6f} OR {ra_col} <= {ra_hi - 360:.6f})"
    return f"{dec_part} AND {ra_col} BETWEEN {ra_lo:.6f} AND {ra_hi:.6f}"


def _adql(name: str, table: str | None, ra: float, dec: float, radius: float, limit: int, box: bool = False) -> str:
    if name == "simbad":
        return (
            f"SELECT TOP {limit} b.main_id, b.ra, b.dec, b.otype, o.description AS otype_description, "
            "b.sp_type, b.plx_value, b.pmra, b.pmdec, b.rvz_redshift, f.J, f.H, f.K, f.G "
            "FROM basic AS b JOIN otypedef AS o ON b.otype = o.otype "
            "LEFT JOIN allfluxes AS f ON f.oidref = b.oid "
            f"WHERE {_cone('b.ra', 'b.dec', ra, dec, radius, box)}"
        )
    if name == "gaia":
        return (
            f"SELECT TOP {limit} source_id, ra, dec, phot_g_mean_mag, bp_rp, parallax, parallax_error, "
            "pmra, pmdec, ruwe, phot_variable_flag "
            f"FROM {table} WHERE {_cone('ra', 'dec', ra, dec, radius, box)} ORDER BY phot_g_mean_mag"
        )
    if name == "allwise":
        return (
            f"SELECT TOP {limit} designation, ra, dec, w1mpro, w1sigmpro, w2mpro, w2sigmpro, "
            "w3mpro, w3sigmpro, w4mpro, w4sigmpro, ph_qual, ext_flg, var_flg, cc_flags "
            f"FROM {table} WHERE {_cone('ra', 'dec', ra, dec, radius, box)} ORDER BY w1mpro"
        )
    raise ValueError(name)


def _parse_csv(text: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        clean = {}
        for key, value in row.items():
            key = (key or "").strip().strip('"')
            value = (value or "").strip()
            if value == "":
                clean[key] = None
                continue
            if key in TEXT_COLUMNS:  # identifiers: keep exact (Gaia IDs have 19 digits)
                clean[key] = value.strip('"')
                continue
            try:
                number = float(value)
                clean[key] = number if math.isfinite(number) else None
            except ValueError:
                clean[key] = value
        rows.append(clean)
    return rows


def _separation_arcsec(ra1, dec1, ra2, dec2) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    a = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600


def query(name: str, ra: float, dec: float, radius: float, limit: int | None = None) -> dict:
    """Cone search one catalogue, trying each service until one answers."""
    if name not in SOURCES:
        raise ValueError(f"Unknown catalogue {name}")
    radius = min(radius, MAX_RADIUS_DEG)
    limit = limit or LIMITS[name]

    key = hashlib.sha1(f"{name}|{ra:.5f}|{dec:.5f}|{radius:.5f}|{limit}".encode()).hexdigest()[:20]
    folder = config.CACHE_DIR / "catalogs"
    folder.mkdir(parents=True, exist_ok=True)
    cache_file = folder / f"{key}.json"
    if cache_file.exists() and time.time() - cache_file.stat().st_mtime < 24 * 3600:
        return json.loads(cache_file.read_text())

    problems = []
    for label, url, table in _ordered_sources(name):
        box = url in BOX_ONLY_SERVICES
        params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": _adql(name, table, ra, dec, radius, limit, box)}
        try:
            response = httpx.get(url, params=params, timeout=30, follow_redirects=True)
        except httpx.HTTPError as error:
            problems.append(f"{label}: {error}")
            _failed_until[url] = time.time() + FAILURE_COOLDOWN_S
            continue
        text = response.text
        first_line = text.split("\n", 1)[0].lower()
        if response.status_code != 200 or "<html" in first_line or "<?xml" in first_line or "ra" not in first_line:
            # Keep the service's own error text (TAP errors arrive as small XML documents)
            detail = " ".join(text[:1200].split())
            info_at = detail.find('QUERY_STATUS" value="ERROR"')
            problems.append(f"{label}: HTTP {response.status_code} {detail[info_at:info_at + 400] if info_at >= 0 else detail[:160]}")
            if response.status_code >= 500 or "<html" in first_line:
                _failed_until[url] = time.time() + FAILURE_COOLDOWN_S
            continue
        rows = _parse_csv(text)
        for row in rows:
            if row.get("ra") is not None and row.get("dec") is not None:
                row["sep_arcsec"] = round(_separation_arcsec(ra, dec, row["ra"], row["dec"]), 2)
        if box:  # trim the box to the requested circle
            rows = [r for r in rows if r.get("sep_arcsec") is not None and r["sep_arcsec"] <= radius * 3600]
        result = {
            "catalog": name,
            "service": label,
            "attribution": ATTRIBUTION[name],
            "query": {"ra": ra, "dec": dec, "radius_deg": radius, "limit": limit},
            "count": len(rows),
            "truncated": len(rows) >= limit,
            "rows": rows,
            "problems": problems,
        }
        cache_file.write_text(json.dumps(result))
        return result
    raise CatalogError(f"No {name} service answered. " + " | ".join(problems))


def identify(ra: float, dec: float, radius_arcsec: float) -> dict:
    """What is at this position? Nearest entries from each catalogue (never guessed)."""
    radius = radius_arcsec / 3600
    out = {"query": {"ra": ra, "dec": dec, "radius_arcsec": radius_arcsec}}

    def one(name: str):
        try:
            result = query(name, ra, dec, radius, limit=50)
            rows = sorted(result["rows"], key=lambda r: r.get("sep_arcsec", 1e9))
            return name, {"service": result["service"], "attribution": result["attribution"], "matches": rows[:5], "error": None}
        except CatalogError as error:
            return name, {"service": None, "attribution": ATTRIBUTION[name], "matches": [], "error": str(error)}

    with ThreadPoolExecutor(max_workers=3) as pool:  # ask all three catalogues at once
        for name, part in pool.map(one, ("simbad", "gaia", "allwise")):
            out[name] = part

    gaia = out["gaia"]["matches"][0] if out["gaia"]["matches"] else None
    if gaia and gaia.get("parallax") and gaia.get("parallax_error") and gaia["parallax"] > 0:
        over_error = gaia["parallax"] / gaia["parallax_error"]
        if over_error >= 5:  # only quote a distance when the parallax is well measured
            gaia["distance_pc_estimate"] = round(1000 / gaia["parallax"], 1)
            gaia["distance_ly_estimate"] = round(1000 / gaia["parallax"] * 3.2616, 0)
        gaia["parallax_over_error"] = round(over_error, 1)
    return out
