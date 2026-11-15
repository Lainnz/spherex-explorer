"""Scientifically careful comparison of two SPHEREx observations.

Steps (in order):
  1. Check the pair is comparable: same detector, and the wavelength seen at
     the target agrees within half the channel bandwidth.
  2. For each image: subtract the pipeline's zodiacal-light model (it changes
     with the time of year) and blank pixels with serious quality flags.
  3. Reproject both images onto one common, north-up grid with SPHEREx's
     native pixel size (6.15"), centred on the target (reproject, bilinear).
  4. Combine with uncertainty propagation:
       difference   D = B - A,          sigma_D = sqrt(var_A + var_B)
       significance S = D / sigma_D     ("how many sigma did it change?")
       combined     C = inverse-variance weighted mean of A and B
  5. Save FITS files (for the sky viewer) and PNG pictures (for the page).

Caveats reported to the user: interpolation correlates neighbouring pixels,
so per-pixel uncertainties are approximate; the two images' PSFs are not
matched; moving objects (asteroids) appear as +/- pairs.
"""

import hashlib
import json
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from . import config

NATIVE_PIXEL_ARCSEC = 6.15


class NotComparable(ValueError):
    """The two observations should not be compared directly."""


class MissingPackage(RuntimeError):
    """reproject / pillow not installed yet."""


def _require_packages():
    """Import the Milestone 7 packages only when needed, with a clear message if missing."""
    try:
        from PIL import Image  # noqa: F401
        from reproject import reproject_interp  # noqa: F401
    except ImportError as error:
        raise MissingPackage(
            "Comparison needs two extra packages. In the backend window run: "
            "pip install reproject pillow  (then the server reloads by itself)."
        ) from error


def _load(path: Path):
    """Read the layers we need from a cutout: (data-zodi, variance, bad-mask, wcs, header)."""
    with fits.open(path) as hdul:
        header = hdul["IMAGE"].header
        data = np.asarray(hdul["IMAGE"].data, dtype=np.float64)
        variance = np.asarray(hdul["VARIANCE"].data, dtype=np.float64)
        zodi = np.asarray(hdul["ZODI"].data, dtype=np.float64)
        flags = np.asarray(hdul["FLAGS"].data, dtype=np.int64)
        flag_header = hdul["FLAGS"].header
        bad_bits = 0
        for n in range(64):
            name_key, bit_key = f"MSKN{n:04d}", f"MSKM{n:04d}"
            if name_key in flag_header and str(flag_header[name_key]).strip() in config.BAD_FLAG_NAMES:
                bad_bits |= int(flag_header[bit_key])
        bad = ((flags & bad_bits) != 0) | ~np.isfinite(data) | ~np.isfinite(variance) | (variance <= 0)
        clean = data - zodi
        clean[bad] = np.nan
        variance = variance.copy()
        variance[bad] = np.nan
        return clean, variance, bad.astype(np.float64), WCS(header), header.copy()


def _common_grid(ra: float, dec: float, size_deg: float) -> tuple[WCS, tuple[int, int]]:
    """North-up TAN grid centred on the target at SPHEREx's native pixel size."""
    scale = NATIVE_PIXEL_ARCSEC / 3600
    n = int(round(size_deg / scale))
    n += 1 - n % 2  # odd, so the target sits in the centre pixel
    grid = WCS(naxis=2)
    grid.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    grid.wcs.crval = [ra, dec]
    grid.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    grid.wcs.cd = [[-scale, 0.0], [0.0, scale]]  # east left, north up
    grid.wcs.radesys = "ICRS"
    return grid, (n, n)


def _to_grid(array, wcs_in, grid, shape):
    from reproject import reproject_interp

    out, footprint = reproject_interp((array, wcs_in), grid, shape_out=shape, order="bilinear")
    out[footprint == 0] = np.nan
    return out


# ---- pictures ---------------------------------------------------------------

def _png(rgb: np.ndarray, valid: np.ndarray, path: Path):
    """Save an RGB image (float 0..1) as PNG; invalid pixels transparent; north up."""
    from PIL import Image

    rgba = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    Image.fromarray(np.flipud(rgba), "RGBA").save(path)  # FITS row 0 is the bottom


def _gray(image, low, high):
    scaled = np.clip((image - low) / (high - low), 0, 1)
    stretched = np.arcsinh(scaled * 10) / np.arcsinh(10)  # asinh stretch
    stretched = np.nan_to_num(stretched)
    return np.repeat(stretched[..., None], 3, axis=2)


def _diverging(image, limit):
    """Black for no change, blue for fainter, orange-red for brighter."""
    t = np.nan_to_num(np.clip(image / limit, -1, 1))
    blue = np.array([0.30, 0.62, 1.00])
    red = np.array([1.00, 0.45, 0.20])
    pos = np.clip(t, 0, 1)[..., None]
    neg = np.clip(-t, 0, 1)[..., None]
    return pos * red + neg * blue


def _num(value, digits=4):
    if value is None:
        return None
    value = float(value)
    return round(value, digits) if np.isfinite(value) else None


def _robust_std(values):
    values = values[np.isfinite(values)]
    if values.size < 10:
        return None
    return 1.4826 * float(np.median(np.abs(values - np.median(values))))


# ---- main entry point --------------------------------------------------------

def compare(path_a: Path, meta_a: dict, path_b: Path, meta_b: dict, ra: float, dec: float, size_deg: float) -> dict:
    _require_packages()

    # 1. Comparable?
    det_a, det_b = meta_a["observation"]["detector"], meta_b["observation"]["detector"]
    if det_a != det_b:
        raise NotComparable(f"Different detectors (D{det_a} vs D{det_b}) see different wavelengths.")
    wl_a, wl_b = meta_a["target"]["wavelength_um"], meta_b["target"]["wavelength_um"]
    bw = min(meta_a["target"]["bandwidth_um"] or 0, meta_b["target"]["bandwidth_um"] or 0)
    if wl_a is None or wl_b is None:
        raise NotComparable("The wavelength at the target is unknown for one of the images.")
    if abs(wl_a - wl_b) > 0.5 * bw:
        raise NotComparable(
            f"Wavelengths at the target differ too much ({wl_a} vs {wl_b} µm; allowed ±{0.5 * bw:.4f} µm)."
        )

    key = hashlib.sha1(f"v2|{path_a.name}|{path_b.name}|{ra:.5f}|{dec:.5f}|{size_deg}".encode()).hexdigest()[:20]
    out_dir = config.CACHE_DIR / "compare"
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_file = out_dir / f"{key}.json"
    if summary_file.exists():
        return json.loads(summary_file.read_text())

    # 2. Clean each image
    clean_a, var_a, bad_a, wcs_a, _ = _load(path_a)
    clean_b, var_b, bad_b, wcs_b, _ = _load(path_b)

    # 3. Common grid
    grid, shape = _common_grid(ra, dec, size_deg)
    A = _to_grid(clean_a, wcs_a, grid, shape)
    B = _to_grid(clean_b, wcs_b, grid, shape)
    VA = _to_grid(var_a, wcs_a, grid, shape)
    VB = _to_grid(var_b, wcs_b, grid, shape)
    # A pixel touched by any bad input pixel stays bad
    badA = _to_grid(bad_a, wcs_a, grid, shape)
    badB = _to_grid(bad_b, wcs_b, grid, shape)
    valid = (
        np.isfinite(A) & np.isfinite(B) & np.isfinite(VA) & np.isfinite(VB)
        & (VA > 0) & (VB > 0) & (badA < 0.01) & (badB < 0.01)
    )
    for arr in (A, B, VA, VB):
        arr[~valid] = np.nan

    # 4. Results with uncertainty
    D = B - A
    sigma_D = np.sqrt(VA + VB)  # pixel noise only
    S_stat = D / sigma_D
    # Add a systematic term proportional to brightness (see config.SYSTEMATIC_FRACTION)
    f = config.SYSTEMATIC_FRACTION
    sigma_total = np.sqrt(VA + VB + (f * np.fmax(np.abs(A), np.abs(B))) ** 2)
    S = D / sigma_total
    w_a, w_b = 1 / VA, 1 / VB
    C = (A * w_a + B * w_b) / (w_a + w_b)
    sigma_C = np.sqrt(1 / (w_a + w_b))

    # Statistics
    centre = shape[0] // 2
    finite_D = D[valid]
    robust_S = _robust_std(S_stat[valid])
    strong = valid & (np.abs(S) > 5)
    candidates = []
    if strong.any():
        ys, xs = np.nonzero(strong)
        order = np.argsort(-np.abs(S[ys, xs]))[:8]
        world = grid.pixel_to_world(xs[order], ys[order])
        for i, idx in enumerate(order):
            candidates.append(
                {
                    "ra": _num(world[i].ra.deg, 6),
                    "dec": _num(world[i].dec.deg, 6),
                    "significance": _num(S[ys[idx], xs[idx]], 2),
                    "difference": _num(D[ys[idx], xs[idx]], 4),
                }
            )

    # 5. Files
    header = grid.to_header()
    header["BUNIT"] = "MJy / sr"
    files = {}
    products = {
        "a": (A, "Observation A, zodiacal light subtracted, on common grid"),
        "b": (B, "Observation B, zodiacal light subtracted, on common grid"),
        "diff": (D, "Difference B - A (MJy/sr)"),
        "signif": (S, "Significance (B - A) / sqrt(var_A + var_B + (f*max(A,B))^2)"),
        "combined": (C, "Inverse-variance weighted mean of A and B"),
    }
    for name, (array, comment) in products.items():
        h = header.copy()
        h["COMMENT"] = comment
        if name == "signif":
            h["BUNIT"] = "sigma"
        fits.PrimaryHDU(array.astype(np.float32), h).writeto(out_dir / f"{key}_{name}.fits", overwrite=True)
        files[f"{name}_fits"] = f"/api/spherex/compare-file/{key}_{name}.fits"

    both = np.concatenate([A[valid], B[valid]])
    low, high = (np.percentile(both, [1.0, 99.5]) if both.size else (0.0, 1.0))
    diff_limit = 5 * (_robust_std(finite_D) or (float(np.nanstd(finite_D)) if finite_D.size else 1.0) or 1.0)
    _png(_gray(A, low, high), valid, out_dir / f"{key}_a.png")
    _png(_gray(B, low, high), valid, out_dir / f"{key}_b.png")
    _png(_gray(C, low, high), valid, out_dir / f"{key}_combined.png")
    _png(_diverging(D, diff_limit), valid, out_dir / f"{key}_diff.png")
    _png(_diverging(S, 5.0), valid, out_dir / f"{key}_signif.png")
    for name in ("a", "b", "combined", "diff", "signif"):
        files[f"{name}_png"] = f"/api/spherex/compare-file/{key}_{name}.png"

    def at_centre(array):
        return _num(array[centre, centre], 4)

    summary = {
        "key": key,
        "files": files,
        "grid": {
            "size_px": shape[0],
            "pixel_arcsec": NATIVE_PIXEL_ARCSEC,
            "orientation": "north up, east left",
            "centre": [ra, dec],
        },
        "pair": {
            "a": {
                "obs_id": meta_a["observation"]["obs_id"],
                "date_utc": meta_a["observation"]["date_obs_utc"],
                "mjd": meta_a["observation"]["mjd_avg"],
                "wavelength_um": wl_a,
                "psf_fwhm_arcsec": meta_a["observation"]["psf_fwhm_arcsec"],
            },
            "b": {
                "obs_id": meta_b["observation"]["obs_id"],
                "date_utc": meta_b["observation"]["date_obs_utc"],
                "mjd": meta_b["observation"]["mjd_avg"],
                "wavelength_um": wl_b,
                "psf_fwhm_arcsec": meta_b["observation"]["psf_fwhm_arcsec"],
            },
            "detector": det_a,
            "delta_wavelength_um": _num(wl_b - wl_a, 4),
            "allowed_delta_um": _num(0.5 * bw, 4),
            "delta_days": _num((meta_b["observation"]["mjd_avg"] or 0) - (meta_a["observation"]["mjd_avg"] or 0), 3),
        },
        "display": {
            "gray_min": _num(low, 4),
            "gray_max": _num(high, 4),
            "diff_limit": _num(diff_limit, 4),
            "signif_limit": 5.0,
        },
        "target": {
            "a": at_centre(A),
            "a_sigma": at_centre(np.sqrt(VA)),
            "b": at_centre(B),
            "b_sigma": at_centre(np.sqrt(VB)),
            "difference": at_centre(D),
            "difference_sigma": at_centre(sigma_D),
            "significance_noise_only": at_centre(S_stat),
            "difference_sigma_total": at_centre(sigma_total),
            "significance": at_centre(S),
            "combined": at_centre(C),
            "combined_sigma": at_centre(sigma_C),
        },
        "statistics": {
            "valid_fraction": _num(valid.mean(), 4),
            "median_difference": _num(np.median(finite_D), 5) if finite_D.size else None,
            "robust_std_significance": _num(robust_S, 3),
            "pixels_beyond_5_sigma": int(strong.sum()),
            "pixels_beyond_5_sigma_noise_only": int((valid & (np.abs(S_stat) > 5)).sum()),
            "systematic_fraction": f,
            "candidates": candidates,
        },
        "method": [
            "Pair checked: same detector and same wavelength at the target (within half the bandwidth).",
            "Zodiacal light model subtracted from each image (it changes with the time of year).",
            "Pixels with serious quality flags masked (" + ", ".join(sorted(config.BAD_FLAG_NAMES)) + ").",
            f"Both images reprojected onto one north-up grid at {NATIVE_PIXEL_ARCSEC}\" per pixel (reproject, bilinear).",
            "Uncertainty propagated from each image's VARIANCE layer: sigma = sqrt(var_A + var_B).",
            f"Significance map also includes a {int(config.SYSTEMATIC_FRACTION * 100)}% systematic term (of local brightness) for star-shape and alignment effects.",
        ],
        "caveats": [
            "Interpolation makes neighbouring pixels' noise correlated, so per-pixel uncertainties are approximate.",
            "SPHEREx pixels are about as large as a star's blur, so stars change shape with their position on the pixel grid; with unmatched PSFs this leaves +/- residuals on most stars (handled by the systematic term, not removed).",
            "Moving objects such as asteroids appear as a bright/dark pair; real variable sources appear as one spot.",
        ],
    }
    summary_file.write_text(json.dumps(summary))
    return summary
