"""Reading a SPHEREx cutout with Astropy and preparing it for the website.

A SPHEREx "Spectral Image" cutout is a multi-extension FITS (MEF) file with:
  IMAGE     calibrated surface brightness (MJy/sr), no zodiacal light removed
  FLAGS     bit flags per pixel (names defined in this HDU's header)
  VARIANCE  uncertainty squared (MJy/sr)^2
  ZODI      model of zodiacal light (MJy/sr)
  EPSF/PSF  point spread function model
  WCS-WAVE  lookup table: the wavelength seen by each pixel
(See the SPHEREx Archive User Guide at IRSA.)

We keep the pixel values exactly as delivered. For display we only:
  * hide pixels with serious quality flags (set to blank/NaN), and
  * attach a simple TAN sky projection fitted to the image's own
    TAN-SIP coordinates (no resampling), because the browser viewer
    may not support SIP distortion terms.
"""

import hashlib
import math
from pathlib import Path

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
import astropy.units as u
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales

from . import config


def _num(value, digits=None):
    """Plain Python number, or None for NaN/inf/missing."""
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value):
        return None
    return round(value, digits) if digits is not None else value


def _fit_tan_wcs(sky_wcs: WCS, nx: int, ny: int) -> WCS:
    """Fit a plain TAN (gnomonic) WCS to an image's exact (TAN-SIP) coordinates.

    The reference point is the image centre. We project a grid of pixel
    positions onto the tangent plane there and solve for the 2x2 CD matrix by
    least squares. Over a small cutout the SIP distortion is nearly linear, so
    the fit is very close (the residual is measured and reported).
    """
    cx, cy = (nx - 1) / 2, (ny - 1) / 2  # 0-based centre pixel
    centre = sky_wcs.pixel_to_world(cx, cy)
    ra0, dec0 = centre.ra.radian, centre.dec.radian

    gx, gy = np.meshgrid(np.linspace(0, nx - 1, 10), np.linspace(0, ny - 1, 10))
    gx, gy = gx.ravel(), gy.ravel()
    world = sky_wcs.pixel_to_world(gx, gy)
    ra, dec = world.ra.radian, world.dec.radian

    # Gnomonic projection onto the plane touching the sky at the centre
    cos_c = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
    xi = np.degrees(np.cos(dec) * np.sin(ra - ra0) / cos_c)
    eta = np.degrees((np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cos_c)

    offsets = np.column_stack([gx - cx, gy - cy])
    cd_rows, *_ = np.linalg.lstsq(offsets, np.column_stack([xi, eta]), rcond=None)

    tan = WCS(naxis=2)
    tan.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    tan.wcs.crval = [centre.ra.deg, centre.dec.deg]
    tan.wcs.crpix = [cx + 1, cy + 1]  # FITS pixels start at 1
    tan.wcs.cd = cd_rows.T
    tan.wcs.radesys = "ICRS"
    return tan


def _flag_definitions(header) -> dict[str, int]:
    """Read flag names/bits from the FLAGS header, e.g. MSKN0010='HOT', MSKM0010=1024."""
    definitions = {}
    for n in range(64):
        name_key, bit_key = f"MSKN{n:04d}", f"MSKM{n:04d}"
        if name_key in header and bit_key in header:
            definitions[str(header[name_key]).strip()] = int(header[bit_key])
    return definitions


def _wavelength_at(hdul, image_header, x: float, y: float):
    """Central wavelength and bandwidth (µm) at a pixel, from the WCS-WAVE lookup table."""
    try:
        wave_wcs = WCS(image_header, fobj=hdul, key="W")
        wavelength, bandwidth = wave_wcs.pixel_to_world_values(x, y)
        return _num(wavelength, 4), _num(bandwidth, 4), None
    except Exception as error:  # report, never guess
        return None, None, f"Wavelength lookup unavailable: {error}"


def _upsample(data: np.ndarray, factor: int) -> np.ndarray:
    """Smoothly enlarge an image by `factor` with bilinear interpolation.

    For display only: it hides the blocky look but adds no real detail.
    Blank (NaN) pixels stay blank, and their neighbourhood becomes blank too.
    """
    ny, nx = data.shape
    xs = (np.arange(nx * factor) + 0.5) / factor - 0.5
    ys = (np.arange(ny * factor) + 0.5) / factor - 0.5
    rows = np.vstack([np.interp(xs, np.arange(nx), row) for row in data])
    return np.vstack([np.interp(ys, np.arange(ny), col) for col in rows.T]).T


def process_cutout(
    path: Path, ra: float, dec: float, display_dir: Path, smooth: bool = False, round_shape: bool = False
) -> dict:
    """Read a cutout, write a display-ready FITS, and return its metadata."""
    with fits.open(path) as hdul:
        names = [hdu.name for hdu in hdul]
        if "IMAGE" not in names:
            raise ValueError(f"No IMAGE extension in cutout (found: {names})")

        image_hdu = hdul["IMAGE"]
        header = image_hdu.header
        data = np.asarray(image_hdu.data, dtype=np.float32)
        ny, nx = data.shape

        flags = np.asarray(hdul["FLAGS"].data, dtype=np.int64) if "FLAGS" in names else None
        variance = np.asarray(hdul["VARIANCE"].data, dtype=np.float32) if "VARIANCE" in names else None
        zodi = np.asarray(hdul["ZODI"].data, dtype=np.float32) if "ZODI" in names else None
        flag_defs = _flag_definitions(hdul["FLAGS"].header) if "FLAGS" in names else {}
        pipeline_version = hdul[0].header.get("VERSION")

        # --- Sky coordinates (TAN-SIP from the file) -----------------------
        sky_wcs = WCS(header)  # default (celestial) WCS
        target = SkyCoord(ra * u.deg, dec * u.deg, frame="icrs")
        tx, ty = (float(v) for v in sky_wcs.world_to_pixel(target))
        ix, iy = int(round(tx)), int(round(ty))
        inside = 0 <= ix < nx and 0 <= iy < ny
        pixel_scale = proj_plane_pixel_scales(sky_wcs.celestial) * 3600  # arcsec

        # --- Quality flags ---------------------------------------------------
        bad_bits = 0
        for name in config.BAD_FLAG_NAMES:
            bad_bits |= flag_defs.get(name, 0)
        masked = ~np.isfinite(data)
        if flags is not None:
            masked |= (flags & bad_bits) != 0
        flag_counts = (
            {name: int(((flags & bit) != 0).sum()) for name, bit in flag_defs.items()}
            if flags is not None
            else {}
        )
        flags_at_target = (
            [name for name, bit in flag_defs.items() if flags[iy, ix] & bit]
            if flags is not None and inside
            else []
        )

        # --- Values at the target pixel -------------------------------------
        value = _num(data[iy, ix], 5) if inside else None
        sigma = (
            _num(math.sqrt(variance[iy, ix]), 5)
            if inside and variance is not None and np.isfinite(variance[iy, ix]) and variance[iy, ix] >= 0
            else None
        )
        zodi_value = _num(zodi[iy, ix], 5) if inside and zodi is not None else None
        wavelength, bandwidth, wave_note = (
            _wavelength_at(hdul, header, tx, ty) if inside else (None, None, "Target is outside this cutout")
        )

    # --- Display FITS: same pixels, bad ones blanked, simple TAN WCS -------
    display = data.copy()
    display[masked] = np.nan
    if round_shape:
        # Display only: blank the corners so the cutout is a circle around the target
        yy, xx = np.mgrid[0:ny, 0:nx]
        radius = min(nx, ny) / 2 - 0.5
        display[np.hypot(xx - tx, yy - ty) > radius] = np.nan
    display_wcs = _fit_tan_wcs(sky_wcs, nx, ny)
    # How far the simple projection is from the exact one (should be tiny)
    gx, gy = np.meshgrid(np.linspace(0, nx - 1, 8), np.linspace(0, ny - 1, 8))
    grid_world = sky_wcs.pixel_to_world(gx.ravel(), gy.ravel())
    check = display_wcs.pixel_to_world(gx.ravel(), gy.ravel())
    fit_residual = float(check.separation(grid_world).max().to(u.arcsec).value)

    if smooth:
        factor = config.SMOOTH_FACTOR
        display = _upsample(display, factor)
        # Same sky, finer pixel grid: reference pixel moves, pixel size shrinks
        display_wcs.wcs.crpix = (np.array(display_wcs.wcs.crpix) - 0.5) * factor + 0.5
        display_wcs.wcs.cd = np.array(display_wcs.wcs.cd) / factor

    out_header = display_wcs.to_header()
    out_header["BUNIT"] = header.get("BUNIT", "MJy / sr")
    out_header["OBSID"] = header.get("OBSID", "")
    out_header["DATE-OBS"] = header.get("DATE-OBS", "")
    out_header["COMMENT"] = "SPHEREx cutout prepared by SPHEREx Xplorer for display."
    out_header["COMMENT"] = "Pixel values unchanged; serious-quality-flag pixels set to NaN."
    if round_shape:
        out_header["COMMENT"] = "Corners outside a circle around the target set to NaN (display only)."
    if smooth:
        out_header["COMMENT"] = f"Smoothed for display: bilinear upsampling x{config.SMOOTH_FACTOR} (no new detail)."

    finite = display[np.isfinite(display)]
    if finite.size:
        low, high = np.percentile(finite, [1.0, 99.5])
    else:
        low = high = None

    key = hashlib.sha1(f"{path.name}|display|smooth={smooth}|round={round_shape}".encode()).hexdigest()[:20]
    display_dir.mkdir(parents=True, exist_ok=True)
    fits.PrimaryHDU(display.astype(np.float32), out_header).writeto(display_dir / f"{key}.fits", overwrite=True)

    corners = sky_wcs.pixel_to_world([0, nx - 1, nx - 1, 0], [0, 0, ny - 1, ny - 1])
    return {
        "display_key": key,
        "observation": {
            "obs_id": header.get("OBSID"),
            "detector": header.get("DETECTOR"),
            "date_obs_utc": header.get("DATE-OBS"),
            "date_avg_utc": header.get("DATE-AVG"),
            "mjd_avg": _num(header.get("MJD-AVG")),
            "exposure_s": _num(header.get("XPOSURE") or header.get("EXPTIME") or header.get("TELAPSE"), 2),
            "psf_fwhm_arcsec": _num(header.get("PSF_FWHM"), 2),
            "units": header.get("BUNIT"),
            "pipeline_version": pipeline_version,
        },
        "image": {
            "width": nx,
            "height": ny,
            "pixel_scale_arcsec": [_num(s, 3) for s in pixel_scale],
            "display_min": _num(low, 5),
            "display_max": _num(high, 5),
            "masked_fraction": _num(masked.mean(), 4),
            "wcs_fit_residual_arcsec": _num(fit_residual, 4),
            "corners": [[_num(c.ra.deg, 6), _num(c.dec.deg, 6)] for c in corners],
            "smoothed_for_display": smooth,
        },
        "target": {
            "ra": ra,
            "dec": dec,
            "inside": inside,
            "pixel": [_num(tx, 2), _num(ty, 2)],
            "surface_brightness": value,
            "uncertainty": sigma,
            "zodi_model": zodi_value,
            "wavelength_um": wavelength,
            "bandwidth_um": bandwidth,
            "wavelength_note": wave_note,
            "flags": flags_at_target,
        },
        "quality": {
            "flag_counts": flag_counts,
            "hidden_flag_names": sorted(n for n in config.BAD_FLAG_NAMES if n in flag_defs),
        },
        "processed_utc": Time.now().isot[:19] + "Z",
    }
