"""SPHEREx pixel quality flags (PLAN.md §7.8).

Each pixel of the FLAGS image is a number whose bits are yes/no flags. The FLAGS header
names each bit: MSKNnnnn = name of bit n, MSKDnnnn = its description. Names are read
from every image instead of hard-coded, so a new release can add or move flags.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from astropy.io.fits import Header

# Quality badge thresholds: share of pixels in view carrying a bad-pixel flag.
GOOD_BELOW = 0.05
CARE_BELOW = 0.20


@lru_cache
def flag_labels() -> dict:
    """Plain-English labels (flag_labels.json)."""
    return json.loads((Path(__file__).parent / "flag_labels.json").read_text(encoding="utf-8"))


def flag_definitions(flags_header: Header) -> dict[str, dict]:
    """{"HOT": {"bit": 10, "description": "Hot pixel"}, ...} from a FLAGS header."""
    definitions = {}
    for key in flags_header["MSKN*"]:
        bit = key[4:]
        definitions[flags_header[key].strip()] = {
            "bit": int(bit),
            "description": str(flags_header.get("MSKD" + bit, "")).strip(),
        }
    return definitions


def exclusion_mask(definitions: dict[str, dict], names: list[str]) -> int:
    """One number with the bits of every named flag set. Unknown names are skipped."""
    mask = 0
    for name in names:
        if name in definitions:
            mask |= 1 << definitions[name]["bit"]
    return mask


def flag_summary(
    flags: np.ndarray, inside: np.ndarray, definitions: dict[str, dict], bad_names: list[str], target_bits: int
) -> dict:
    """Per-flag statistics for the pixels in view, plus a simple quality badge.

    Badge: "Good" if under 5% of pixels have a bad-pixel flag, "Use with care" under
    20%, otherwise "Poor". A bad flag on the target's own pixel caps it at "Use with care".
    """
    n_inside = max(int(inside.sum()), 1)
    labels = flag_labels()
    rows = []
    for name, definition in sorted(definitions.items(), key=lambda item: item[1]["bit"]):
        bit = 1 << definition["bit"]
        rows.append({
            "name": name,
            "bit": definition["bit"],
            "description": definition["description"],
            "label": labels.get(name, {}).get("label", definition["description"]),
            "info_only": bool(labels.get(name, {}).get("info", False)),
            "is_bad_pixel_flag": name in bad_names,
            "percent_of_pixels": round(100 * int(((flags & bit) != 0)[inside].sum()) / n_inside, 2),
            "at_target": bool(target_bits & bit),
        })
    bad_mask = exclusion_mask(definitions, bad_names)
    bad_fraction = int(((flags & bad_mask) != 0)[inside].sum()) / n_inside
    badge = "Good" if bad_fraction < GOOD_BELOW else "Use with care" if bad_fraction < CARE_BELOW else "Poor"
    if badge == "Good" and target_bits & bad_mask:
        badge = "Use with care"
    return {"flags": rows, "bad_pixel_percent": round(100 * bad_fraction, 2), "quality": badge}
