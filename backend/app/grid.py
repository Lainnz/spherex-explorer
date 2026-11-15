"""Putting every cutout onto one shared pixel grid (PLAN.md §7.4).

SPHEREx images are tilted and distorted differently each time, so before comparing,
adding or subtracting them, each one is resampled ("reprojected") onto the same grid:
centred on the target, north up, 6.15″ pixels.
"""
import io
import math
import re
import warnings
from dataclasses import dataclass

import numpy as np
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.wcs import FITSFixedWarning, WCS
from reproject import reproject_interp

from .flags import exclusion_mask, flag_definitions

SIP_KEY = re.compile(r"^(A|B|AP|BP)_(ORDER|\d+_\d+)$")


@dataclass
class Grid:
    wcs: WCS
    width: int
    height: int

    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)

    def header_cards(self) -> dict:
        """The grid's WCS as plain values, for the website and Aladin."""
        return {key: value for key, value in self.wcs.to_header().items()}


@dataclass
class GridImage:
    """One SPHEREx image resampled onto a Grid. Pixels outside the cutout are NaN."""

    image: np.ndarray  # MJy/sr, flagged pixels NaN
    variance: np.ndarray  # (MJy/sr)²
    raw_image: np.ndarray  # the same without blanking flagged pixels (to fill holes)
    raw_variance: np.ndarray
    flags: np.ndarray  # int64 bitmask (0 outside the cutout)
    wavelength_um: float | None  # at the target
    bandwidth_um: float | None
    flag_definitions: dict


def make_grid(ra: float, dec: float, fov_arcsec: float, pixel_scale_arcsec: float) -> Grid:
    """A square TAN (gnomonic) grid, north up and east left, like a sky chart."""
    size = max(8, math.ceil(fov_arcsec / pixel_scale_arcsec))
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [ra, dec]
    wcs.wcs.crpix = [(size + 1) / 2, (size + 1) / 2]
    wcs.wcs.cdelt = [-pixel_scale_arcsec / 3600, pixel_scale_arcsec / 3600]
    wcs.wcs.cunit = ["deg", "deg"]
    return Grid(wcs=wcs, width=size, height=size)


def wavelength_at(hdul: fits.HDUList, x: float, y: float) -> tuple[float | None, float | None]:
    """Wavelength and bandwidth (µm) at an image pixel, from the spectral WCS (key "W")."""
    try:
        # The header's SIP distortion terms belong to the sky WCS, not the wavelength
        # one (IRSA's tutorial sets spectral.sip = None). Removing them first avoids
        # astropy's "inconsistent SIP" notice.
        header = hdul["IMAGE"].header.copy()
        for key in [k for k in header if SIP_KEY.match(k)]:
            del header[key]
        spectral = WCS(header=header, fobj=hdul, key="W")
        wavelength, bandwidth = spectral.pixel_to_world(x, y)
        return float(wavelength.to_value("um")), float(bandwidth.to_value("um"))
    except Exception:  # missing or unusual spectral WCS: the image is still usable
        return None, None


def to_grid(
    fits_bytes: bytes,
    grid: Grid,
    target_ra: float,
    target_dec: float,
    exclude_flags: list[str],
    zodi_subtract: bool = True,
    background_subtract: bool = True,
) -> GridImage:
    """Clean one cutout and resample it onto `grid`.

    Cleaning: subtract the zodiacal-light model (sunlight scattered by dust in the
    solar system), blank out pixels with excluded flags, optionally subtract what's
    left of the sky background. FLAGS use nearest-neighbour resampling, never
    interpolation, because averaging bit patterns makes nonsense.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        with fits.open(io.BytesIO(fits_bytes)) as hdul:
            image_hdu = hdul["IMAGE"]
            wcs_in = WCS(image_hdu.header)
            image = image_hdu.data.astype(np.float64)
            variance = hdul["VARIANCE"].data.astype(np.float64)
            flags = hdul["FLAGS"].data.astype(np.int64)
            if zodi_subtract:
                image = image - hdul["ZODI"].data
            definitions = flag_definitions(hdul["FLAGS"].header)
            bad = (flags & exclusion_mask(definitions, exclude_flags)) != 0

            x, y = wcs_in.world_to_pixel_values(target_ra, target_dec)
            wavelength, bandwidth = wavelength_at(hdul, float(x), float(y))

            def resample(data: np.ndarray, order: str = "bilinear") -> tuple[np.ndarray, np.ndarray]:
                return reproject_interp((data, wcs_in), grid.wcs, shape_out=grid.shape, order=order)

            raw_image, _ = resample(image)
            raw_variance, _ = resample(variance)
            out_image, _ = resample(np.where(bad, np.nan, image))
            out_variance, _ = resample(np.where(bad, np.nan, variance))
            out_flags, footprint = resample(flags.astype(np.float64), order="nearest-neighbor")

    out_flags = np.where(footprint > 0, np.nan_to_num(out_flags), 0).astype(np.int64)
    if background_subtract and np.isfinite(raw_image).sum() > 10:
        # Measure the leftover sky level from good pixels and remove it from both versions.
        source = out_image if np.isfinite(out_image).sum() > 10 else raw_image
        _, median, _ = sigma_clipped_stats(source, mask=~np.isfinite(source), sigma=3.0)
        out_image, raw_image = out_image - median, raw_image - median
    return GridImage(out_image, out_variance, raw_image, raw_variance, out_flags, wavelength, bandwidth, definitions)
