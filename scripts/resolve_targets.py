"""Look up the featured targets and "interesting" spots in SIMBAD → config/targets.json.

Run from the repo root (with the .venv active):  python scripts/resolve_targets.py
Re-run it whenever you add a target below. Positions and motions come from SIMBAD;
the descriptions are ours.
"""
import json
import sys
from datetime import date
from pathlib import Path

from astropy.coordinates import SkyCoord

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.resolve import simbad_lookup  # noqa: E402

LIGHT_YEARS_PER_PARSEC = 3.26156

FEATURED = [
    {
        "slug": "barnards-star",
        "name": "Barnard's Star",
        "simbad": "Barnard's Star",
        "aliases": ["Barnard", "Barnards", "GJ 699", "V2500 Oph"],
        "description": "A small red dwarf about 6 light-years away that crosses the sky faster than "
        "any other star: the width of the full Moon in about 175 years.",
        "demo": {"fov_arcsec": 300, "stretch": "percent", "trim": 99.5},
    },
    {
        "slug": "eps-indi-b",
        "name": "Epsilon Indi B",
        "simbad": "eps Ind B",
        "aliases": ["eps Ind B", "Epsilon Indi Ba", "Epsilon Indi Bb", "eps Ind Ba", "eps Ind Bb"],
        "description": "A pair of brown dwarfs (objects too small to shine like stars) orbiting each other "
        "and the star Epsilon Indi, about 12 light-years away.",
        "demo": {"fov_arcsec": 300, "stretch": "percent", "trim": 99.5},
    },
    {
        "slug": "wise-0855",
        "name": "WISE 0855",
        "simbad": "WISE J085510.83-071442.5",
        "aliases": ["WISE 0855-0714", "WISE J085510.83-071442.5", "WISEA J085510.74-071442.5"],
        # The team's coordinates, used exactly (PLAN.md §6.2). They are where WISE saw it
        # around 2010; SIMBAD's J2000 position and motion are kept in "motion".
        "coords": "08h55m10.831s -07d14m42.53s",
        "description": "The coldest brown dwarf known, about 7.4 light-years away, and one of the "
        "fastest-moving objects in the sky.",
        "demo": {"fov_arcsec": 180, "stretch": "percent", "trim": 99.5},
    },
    {
        "slug": "rw-aurigae",
        "name": "RW Aurigae",
        "simbad": "RW Aur",
        "aliases": ["RW Aur"],
        "description": "A young star still wrapped in the disk of gas and dust it formed from; "
        "its brightness dips and flickers unpredictably.",
        "demo": {"fov_arcsec": 600, "stretch": "percent", "trim": 99.5},
    },
    {
        "slug": "r-draconis",
        "name": "R Draconis",
        "simbad": "R Dra",
        "aliases": ["R Dra"],
        "description": "A red giant that slowly swells and shrinks, brightening and fading over about "
        "8 months. It sits in a SPHEREx Deep Field, so it has many images.",
        "demo": {"fov_arcsec": 600, "stretch": "percent", "trim": 99.5},
    },
]

# Striking spots for the Randomize button: (SIMBAD name, display name, field of view in arcsec).
INTERESTING = [
    ("M 42", "Orion Nebula", 1800),
    ("M 45", "Pleiades", 3600),
    ("M 31", "Andromeda Galaxy", 3600),
    ("M 1", "Crab Nebula", 600),
    ("M 16", "Eagle Nebula", 1800),
    ("M 8", "Lagoon Nebula", 2400),
    ("NGC 3372", "Carina Nebula", 3600),
    ("M 51", "Whirlpool Galaxy", 900),
    ("NGC 2070", "Tarantula Nebula", 1800),
    ("Sgr A*", "Centre of the Milky Way", 1200),
    ("IC 434", "Horsehead Nebula", 1800),
    ("NGC 7293", "Helix Nebula", 1200),
]


def light_years(parallax_mas: float | None) -> float | None:
    if not parallax_mas or parallax_mas <= 0:
        return None
    return round(1000 / parallax_mas * LIGHT_YEARS_PER_PARSEC, 2)


def main() -> None:
    targets = []
    for spec in FEATURED:
        found = simbad_lookup(spec["simbad"])
        if found is None:
            sys.exit(f"SIMBAD doesn't know {spec['simbad']!r}; fix the name in this script.")
        if "coords" in spec:
            coord = SkyCoord(spec["coords"], frame="icrs")
            ra, dec = coord.ra.deg, coord.dec.deg
        else:
            ra, dec = found["ra"], found["dec"]
        targets.append(
            {
                "slug": spec["slug"],
                "name": spec["name"],
                "aliases": spec["aliases"],
                "simbad_id": found["simbad_id"],
                "ra": round(ra, 7),
                "dec": round(dec, 7),
                "motion": found["motion"],
                "distance_ly": light_years(found["motion"]["parallax"]),
                "otype": found["otype"],
                "sp_type": found["sp_type"],
                "description": spec["description"],
                "demo": spec["demo"],
            }
        )
        print(f"{spec['name']:16} {found['simbad_id']:28} ra={ra:11.6f} dec={dec:+10.6f}  via {found['server']}")

    interesting = []
    for simbad_name, name, fov in INTERESTING:
        found = simbad_lookup(simbad_name)
        if found is None:
            print(f"  skipped {simbad_name!r}: not in SIMBAD")
            continue
        interesting.append(
            {"name": name, "simbad_id": found["simbad_id"], "ra": round(found["ra"], 6),
             "dec": round(found["dec"], 6), "otype": found["otype"], "fov_arcsec": fov}
        )
        print(f"  {name:24} ra={found['ra']:11.6f} dec={found['dec']:+10.6f}")

    out = {
        "_note": f"Made by scripts/resolve_targets.py on {date.today()} from SIMBAD. "
        "ra/dec = where to look; motion = catalogue position (ICRS, epoch J2000) and proper motion.",
        "targets": targets,
        "interesting": interesting,
    }
    path = ROOT / "config" / "targets.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
