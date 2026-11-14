"""SPHEREx pixel quality flags (PLAN.md §7.8).

Each pixel of the FLAGS image is a number whose bits are yes/no flags. The FLAGS header
names each bit: MSKNnnnn = name of bit n, MSKDnnnn = its description. Names are read
from every image instead of hard-coded, so a new release can add or move flags.
"""
from astropy.io.fits import Header


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
