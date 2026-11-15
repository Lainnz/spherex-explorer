"""Where a moving star was at a given time (PLAN.md §2.7).

Catalogue positions are for a reference date (usually the year 2000). Fast movers such
as Barnard's Star are minutes of arc away from that spot by the time SPHEREx saw them,
so every image needs the star's position at that image's own date.
"""
import warnings

import astropy.units as u
import numpy as np
from astropy.coordinates import Distance, SkyCoord
from astropy.time import Time
from erfa import ErfaWarning


def has_motion(motion: dict | None) -> bool:
    """True if a proper motion is known (both components)."""
    return bool(motion) and motion.get("pmra") is not None and motion.get("pmdec") is not None


def propagate(motion: dict, mjd) -> tuple[np.ndarray, np.ndarray]:
    """Positions at the given dates.

    Args:
        motion: {ra, dec (deg, ICRS), epoch (Julian year, e.g. 2000.0),
                 pmra (mas/yr, already × cos dec), pmdec (mas/yr),
                 parallax (mas, optional), rv (km/s, optional)}
        mjd: one date or many dates, as Modified Julian Dates.

    Returns:
        (ra, dec) arrays in degrees.
    """
    parallax = motion.get("parallax")
    known_distance = parallax is not None and parallax > 0
    coord = SkyCoord(
        ra=motion["ra"] * u.deg,
        dec=motion["dec"] * u.deg,
        pm_ra_cosdec=motion["pmra"] * u.mas / u.yr,
        pm_dec=motion["pmdec"] * u.mas / u.yr,
        distance=Distance(parallax=parallax * u.mas) if known_distance else None,
        radial_velocity=(motion.get("rv") or 0) * u.km / u.s if known_distance else None,
        obstime=Time(motion.get("epoch", 2000.0), format="jyear"),
    )
    with warnings.catch_warnings():
        # Without a distance, ERFA assumes a very distant star and warns. The error
        # this causes is well under an arcsecond, far below a 6″ SPHEREx pixel.
        warnings.simplefilter("ignore", ErfaWarning)
        moved = coord.apply_space_motion(new_obstime=Time(np.atleast_1d(mjd), format="mjd"))
    return np.atleast_1d(moved.ra.deg), np.atleast_1d(moved.dec.deg)


def position_at(motion: dict, mjd: float) -> tuple[float, float]:
    """A single (ra, dec) at one date."""
    ra, dec = propagate(motion, mjd)
    return float(ra[0]), float(dec[0])
