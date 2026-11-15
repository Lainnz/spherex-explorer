"""Measuring how bright an object is in each image → spectra and light curves (PLAN.md §7.7).

For every image that covers the target: find the target's pixel (using its position on
that image's date), add up the light inside a small circle (the "aperture", 2 pixels),
subtract the sky level measured in a ring around it (4–7 pixels), and convert to
microjanskys (µJy). The image's wavelength at that pixel comes from its spectral WCS,
so all 102 SPHEREx colours are covered as the target falls on different parts of the
detectors.

This is quick-look photometry. It uses the nominal pixel area (6.15″ × 6.15″) instead of
DR1's per-pixel solid-angle maps, so absolute fluxes are approximate (a few percent).
For science-grade spectra, use IRSA's Spectrophotometry Tool.
"""
import asyncio
import io
import warnings
from collections.abc import AsyncIterator

import numpy as np
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.wcs import FITSFixedWarning, WCS

from . import irsa
from .cache import get_cache
from .flags import exclusion_mask, flag_definitions
from .grid import wavelength_at

ARCSEC_PER_RADIAN = 206264.806
# On 2026-11-14 Barnard's Star, RW Aurigae and R Draconis had OVERFLOW in their photometry
# circle in 54–60 of 60 images each: SPHEREx saturates on bright stars.
SATURATION_FLAGS = {"OVERFLOW"}
SATURATED_WARNING = 0.5  # warn when over half the measurements are saturated
SUBPIXELS = 5  # each pixel is split 5 × 5 to measure how much of it is inside the circle
METHOD_NOTE = (
    "Quick-look aperture photometry (circle radius {aperture} px, sky ring {inner}–{outer} px) "
    "using the nominal pixel area, so fluxes are approximate. For science-grade spectra, use "
    "IRSA's Spectrophotometry Tool: https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry"
)


def aperture_weights(shape: tuple[int, int], x: float, y: float, radius: float) -> np.ndarray:
    """Fraction (0–1) of each pixel that lies inside a circle centred at (x, y)."""
    offsets = (np.arange(SUBPIXELS) + 0.5) / SUBPIXELS - 0.5
    rows, cols = np.indices(shape)
    sub_x = cols[..., None, None] + offsets[None, None, None, :] - x
    sub_y = rows[..., None, None] + offsets[None, None, :, None] - y
    return (sub_x**2 + sub_y**2 <= radius**2).mean(axis=(2, 3))


def measure(
    fits_bytes: bytes,
    ra: float,
    dec: float,
    *,
    aperture_px: float,
    annulus_px: tuple[float, float],
    exclude_flags: list[str],
    pixel_scale_arcsec: float,
    zodi_subtract: bool = True,
) -> dict | None:
    """Brightness of the object at (ra, dec) in one cutout. None if it's off the cutout."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        with fits.open(io.BytesIO(fits_bytes)) as hdul:
            header = hdul["IMAGE"].header
            x, y = (float(v) for v in WCS(header).world_to_pixel_values(ra, dec))
            image = hdul["IMAGE"].data.astype(np.float64)
            zodi = hdul["ZODI"].data.astype(np.float64)
            variance = hdul["VARIANCE"].data.astype(np.float64)
            flags = hdul["FLAGS"].data.astype(np.int64)
            definitions = flag_definitions(hdul["FLAGS"].header)
            wavelength, bandwidth = wavelength_at(hdul, x, y)

    height, width = image.shape
    outer = annulus_px[1]
    if not (outer <= x < width - outer and outer <= y < height - outer):
        return None  # the circle or sky ring would run off the cutout
    if zodi_subtract:
        image = image - zodi

    bad = (flags & exclusion_mask(definitions, exclude_flags)) != 0
    distance = np.hypot(*np.subtract(np.indices(image.shape), [[[y]], [[x]]]))
    ring = (distance >= annulus_px[0]) & (distance <= outer) & ~bad & np.isfinite(image)
    if ring.sum() < 10:
        return None
    _, sky, sky_std = sigma_clipped_stats(image[ring], sigma=3.0)

    weights = aperture_weights(image.shape, x, y, aperture_px)
    inside = weights > 0
    unusable = inside & (bad | ~np.isfinite(image) | ~np.isfinite(variance))
    # Only usable pixels inside the circle count. (0 × NaN is still NaN, so pixels
    # outside the circle must be zeroed too, not just weighted by 0.) Missing pixels in the
    # circle count as sky, adding nothing, and the point is marked as flagged.
    use = inside & ~unusable
    flux = float(np.sum(np.where(use, weights * (image - sky), 0.0)))
    noise_variance = float(np.sum(np.where(use, weights**2 * variance, 0.0)))
    noise_variance += float(np.sum(weights)) ** 2 * sky_std**2 / ring.sum()

    pixel_sr = (pixel_scale_arcsec / ARCSEC_PER_RADIAN) ** 2
    to_ujy = pixel_sr * 1e12  # MJy/sr × sr = MJy; 1 MJy = 10¹² µJy
    tx, ty = int(round(x)), int(round(y))
    bits_here = int(flags[ty, tx])
    bits_in_circle = int(np.bitwise_or.reduce(flags[inside])) if inside.any() else 0
    bad_in_circle = sorted(
        name for name in exclude_flags if name in definitions and bits_in_circle & (1 << definitions[name]["bit"])
    )
    # A saturated centre is skipped as "unusable", which would leave a meaningless, far too
    # low number (R Draconis came out ≈ 0). Report no value instead.
    saturated = any(name in SATURATION_FLAGS for name in bad_in_circle)
    return {
        "flux_ujy": None if saturated else flux * to_ujy,
        "err_ujy": None if saturated else float(np.sqrt(noise_variance)) * to_ujy,
        "wavelength_um": wavelength,
        "bandwidth_um": bandwidth,
        "flags_at_target": sorted(name for name, d in definitions.items() if bits_here & (1 << d["bit"])),
        "bad_flags_in_aperture": bad_in_circle,
        # Too bright for SPHEREx: the pixel overflowed. Its brightness can't be measured here.
        "saturated": saturated,
        "n_bad_pixels": int(unusable.sum()),
        "flagged": bool(unusable.any()),
        "zodi_mjy_sr": float(zodi[ty, tx]),
        "pixel": [round(x, 2), round(y, 2)],
    }


async def photometry_stream(
    rows: list[dict],
    *,
    center_ra: float,
    center_dec: float,
    size_deg: float,
    aperture_px: float,
    annulus_px: tuple[float, float],
    exclude_flags: list[str],
    pixel_scale_arcsec: float,
    zodi_subtract: bool = True,
) -> AsyncIterator[dict]:
    """Yield {"type": "start" | "point" | "done", ...} as each image is measured.

    Cutouts are requested with the same centre and size as the frames, so images already
    downloaded for the time slider are reused.
    """
    yield {
        "type": "start",
        "images_total": len(rows),
        "method": METHOD_NOTE.format(aperture=aperture_px, inner=annulus_px[0], outer=annulus_px[1]),
    }
    cache = get_cache()
    # Bump the version when measure() changes, so old saved results aren't reused.
    settings_key = f"v4:{aperture_px}:{annulus_px}:{zodi_subtract}:{','.join(sorted(exclude_flags))}"

    async def one(row: dict) -> dict | None:
        key = f"phot:{row['access_url']}:{row['target_ra']:.6f}:{row['target_dec']:.6f}:{settings_key}"
        result = cache.get(key)
        if result is None:
            try:
                content = await irsa.fetch_cutout(row["access_url"], center_ra, center_dec, size_deg)
            except irsa.IrsaUnavailable:
                return None
            result = await asyncio.to_thread(
                measure, content, row["target_ra"], row["target_dec"], aperture_px=aperture_px,
                annulus_px=annulus_px, exclude_flags=exclude_flags, pixel_scale_arcsec=pixel_scale_arcsec,
                zodi_subtract=zodi_subtract,
            )
            cache.set(key, result or {})
        if not result:
            return None
        return {
            "type": "point",
            **{k: row[k] for k in ("obs_id", "release", "survey", "detector", "t_mid", "t_mid_date", "visit")},
            **result,
        }

    tasks = [asyncio.create_task(one(row)) for row in rows]
    measured = saturated = 0
    try:
        for next_done in asyncio.as_completed(tasks):
            point = await next_done
            if point:
                measured += 1
                saturated += bool(point.get("saturated"))
                yield point
    finally:
        for task in tasks:
            task.cancel()
    done = {"type": "done", "points": measured, "skipped": len(rows) - measured, "saturated": saturated}
    if measured and saturated / measured > SATURATED_WARNING:
        done["warning"] = (
            "This object is too bright for SPHEREx: its centre overflowed in most images, so these "
            "measurements aren't reliable. Its images still show how it looks and moves."
        )
    yield done


def bin_spectrum(points: list[dict], channel_wavelengths: list[float]) -> list[dict]:
    """Average points into SPHEREx's 102 nominal channels (inverse-variance weighted).

    Each point goes to the channel whose centre wavelength is closest.
    """
    centres = np.asarray(channel_wavelengths)
    bins: dict[int, list[dict]] = {}
    for point in points:
        if point.get("wavelength_um") is None or point.get("flux_ujy") is None or not (point.get("err_ujy") or 0) > 0:
            continue
        channel = int(np.argmin(np.abs(centres - point["wavelength_um"])))
        bins.setdefault(channel, []).append(point)
    result = []
    for channel, members in sorted(bins.items()):
        weights = np.array([1 / p["err_ujy"] ** 2 for p in members])
        fluxes = np.array([p["flux_ujy"] for p in members])
        result.append({
            "channel": channel,
            "wavelength_um": float(centres[channel]),
            "flux_ujy": float(np.sum(weights * fluxes) / np.sum(weights)),
            "err_ujy": float(1 / np.sqrt(np.sum(weights))),
            "n_points": len(members),
        })
    return result
