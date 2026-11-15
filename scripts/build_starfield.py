"""Make the title page's background stars from real catalogues → frontend/public/data/starfield.bin

Run from the repo root (with the .venv active):  python scripts/build_starfield.py

Stars: the brightest 28,000 in Gaia DR3 (ESA). Gaia can't measure the very brightest
stars well (it has 150 stars brighter than G = 3, SIMBAD has 177 brighter than V = 3), so
stars brighter than V = 3.5 that Gaia lacks are added from SIMBAD (CDS).

File format, 8 bytes per star, brightest first (so showing fewer stars = drawing fewer):
  int16 x, y, z   direction on the sky × 32767 (equatorial: x = cos δ cos α,
                  y = cos δ sin α, z = sin δ)
  uint8 mag       (magnitude + 1.5) × 25, so 0 = mag −1.5 and 255 = mag 8.7
  uint8 colour    (BP − RP + 0.5) × 50, so 0 = blue-white and 255 = deep red
All little-endian. The website reads it in frontend/src/title/starfield.js.
"""
import math
from pathlib import Path

import numpy as np
import pyvo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "data" / "starfield.bin"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap"
SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap"  # Strasbourg was down on 2026-11-14
STAR_COUNT = 28_000
BRIGHT_LIMIT_V = 3.5
SAME_STAR_ARCSEC = 60  # a bright SIMBAD star this close to a Gaia star is that star
BUDGET_BYTES = 300_000  # PLAN.md §9.1
STAR_TYPES = ("*", "**", "SB*", "EB*", "V*", "Be*", "RG*", "Pu*", "BY*", "Ce*", "dS*", "El*", "a2*",
              "bC*", "WR*", "s*r", "s*b", "s*y", "sg*", "C*", "Mi*", "SR*", "LP*", "AB*", "Em*", "HS*",
              "PM*", "Ro*", "RS*", "gD*", "BS*", "HB*", "LM*", "WD*", "Y*O", "Or*", "TT*")


def filled(column, value: float) -> np.ndarray:
    """A table column as floats, with missing values replaced by `value`."""
    data = column.filled(value) if hasattr(column, "filled") else column
    return np.asarray(data, dtype=float)


def gaia_stars() -> np.ndarray:
    query = (f"SELECT TOP {STAR_COUNT} ra, dec, phot_g_mean_mag AS mag, bp_rp "
             "FROM gaiadr3.gaia_source WHERE phot_g_mean_mag IS NOT NULL ORDER BY phot_g_mean_mag")
    table = pyvo.dal.TAPService(GAIA_TAP).run_async(query, maxrec=STAR_COUNT).to_table()
    bp_rp = filled(table["bp_rp"], 1.0)  # unknown colour → Sun-like
    return np.column_stack([filled(table["ra"], np.nan), filled(table["dec"], np.nan),
                            filled(table["mag"], np.nan), bp_rp])


def simbad_bright_stars() -> np.ndarray:
    """Very bright stars by V magnitude. Colour estimated as BP−RP ≈ 1.2 × (B−V), which is
    rough but fine for picking a star's tint."""
    # Stars only: SIMBAD also lists dwarf galaxies (e.g. "Aquarius IV", V = −1.9) with very
    # bright total magnitudes spread over a big patch of sky.
    types = ", ".join(f"'{t}'" for t in STAR_TYPES)
    query = ("SELECT b.ra, b.dec, f.V, f.B FROM basic AS b JOIN allfluxes AS f ON f.oidref = b.oid "
             f"WHERE f.V < {BRIGHT_LIMIT_V} AND b.ra IS NOT NULL AND b.otype IN ({types})")
    table = pyvo.dal.TAPService(SIMBAD_TAP).run_sync(query).to_table()
    v = filled(table["V"], np.nan)
    b_v = filled(table["B"], np.nan) - v
    bp_rp = np.where(np.isfinite(b_v), 1.2 * b_v, 1.0)
    return np.column_stack([filled(table["ra"], np.nan), filled(table["dec"], np.nan), v, bp_rp])


def unit_vectors(ra_deg: np.ndarray, dec_deg: np.ndarray) -> np.ndarray:
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    return np.column_stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)])


def main() -> None:
    gaia = gaia_stars()
    bright = simbad_bright_stars()
    # Add SIMBAD stars that have no Gaia star (brighter than G = 5) nearby.
    gaia_bright = gaia[gaia[:, 2] < 5]
    cos_limit = math.cos(math.radians(SAME_STAR_ARCSEC / 3600))
    nearest = unit_vectors(bright[:, 0], bright[:, 1]) @ unit_vectors(gaia_bright[:, 0], gaia_bright[:, 1]).T
    missing = bright[nearest.max(axis=1) < cos_limit]
    # SIMBAD can list a system and its brightest member (e.g. alf Cen and alf Cen A):
    # keep only the brightest entry within SAME_STAR_ARCSEC.
    missing = missing[np.argsort(missing[:, 2])]
    vectors = unit_vectors(missing[:, 0], missing[:, 1])
    keep = [i for i in range(len(missing)) if not any(vectors[i] @ vectors[j] > cos_limit for j in range(i))]
    missing = missing[keep]
    stars = np.vstack([gaia, missing])
    stars = stars[np.argsort(stars[:, 2])]  # brightest first

    xyz = np.round(unit_vectors(stars[:, 0], stars[:, 1]) * 32767).astype("<i2")
    mag = np.clip(np.round((stars[:, 2] + 1.5) * 25), 0, 255).astype(np.uint8)
    colour = np.clip(np.round((stars[:, 3] + 0.5) * 50), 0, 255).astype(np.uint8)
    records = np.zeros(len(stars), dtype=[("xyz", "<i2", 3), ("mag", "u1"), ("colour", "u1")])
    records["xyz"], records["mag"], records["colour"] = xyz, mag, colour
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(records.tobytes())

    size = OUT.stat().st_size
    print(f"{len(gaia)} Gaia stars (to G = {gaia[-1, 2]:.2f}) + {len(missing)} bright stars from SIMBAD "
          f"= {len(stars)} stars, {size / 1024:.0f} KB → {OUT.relative_to(ROOT)}")
    if size > BUDGET_BYTES:
        raise SystemExit(f"Over the {BUDGET_BYTES / 1000:.0f} KB budget: lower STAR_COUNT.")


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8")  # Windows PowerShell can't print → otherwise
    main()
