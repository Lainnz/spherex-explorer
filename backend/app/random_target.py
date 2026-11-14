"""Picking a random place in the sky for the "Randomize" button (PLAN.md §7.2).

About 1 time in 4 we pick a famous, striking spot (nebula, cluster, galaxy or a featured
target) so random exploring often shows something good.

Coverage: the plan suggested checking each random spot with a quick SIA search, but
SIA searches take minutes (docs/DATA_NOTES.md). SPHEREx DR1 covers the whole sky (its
all-sky cube has full coverage), so any position has data and no live check is needed.
"""
import math

import numpy as np

INTERESTING_CHANCE = 0.25


def uniform_sky_position(rng: np.random.Generator) -> tuple[float, float]:
    """A point picked evenly over the whole sphere.

    Picking Dec evenly would crowd points near the poles, so Dec comes from
    asin(2v − 1), which gives every patch of sky the same chance.
    """
    u, v = rng.random(2)
    return 360.0 * u, math.degrees(math.asin(2.0 * v - 1.0))


def random_target(
    interesting: list[dict], featured: list[dict], default_fov: float, rng: np.random.Generator | None = None
) -> dict:
    """{ra, dec, fov_arcsec, name, slug?, source} for the Randomize button."""
    rng = rng or np.random.default_rng()
    spots = [*interesting, *featured]
    if spots and rng.random() < INTERESTING_CHANCE:
        spot = spots[int(rng.integers(len(spots)))]
        return {
            "ra": spot["ra"],
            "dec": spot["dec"],
            "fov_arcsec": spot.get("fov_arcsec") or spot.get("demo", {}).get("fov_arcsec") or default_fov,
            "name": spot["name"],
            "slug": spot.get("slug"),
            "source": "interesting",
        }
    ra, dec = uniform_sky_position(rng)
    return {"ra": round(ra, 5), "dec": round(dec, 5), "fov_arcsec": default_fov, "name": None, "source": "uniform"}
