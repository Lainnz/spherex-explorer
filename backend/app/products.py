"""Combining images: co-adds, all-detector merges, stacks, differences (PLAN.md §7.5–7.6).

Every result ("product") is saved under cache/products/<id>, where the id is a hash of
everything that went into it. The same request always gives the same id, so results
are reused instead of recomputed.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from astropy.stats import sigma_clipped_stats

from .settings import settings


def product_id(recipe: dict) -> str:
    """A short, stable id for a recipe (any JSON-able description of the inputs)."""
    text = json.dumps(recipe, sort_keys=True, default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


def products_dir() -> Path:
    path = Path(settings.cache_dir) / "products"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_product(pid: str, image: np.ndarray, variance: np.ndarray, meta: dict) -> None:
    np.savez_compressed(products_dir() / f"{pid}.npz", image=image.astype(np.float32), variance=variance.astype(np.float32))
    (products_dir() / f"{pid}.json").write_text(json.dumps({**meta, "id": pid}, default=str), encoding="utf-8")


def product_exists(pid: str) -> bool:
    return (products_dir() / f"{pid}.json").exists() and (products_dir() / f"{pid}.npz").exists()


def load_product(pid: str) -> tuple[np.ndarray, np.ndarray, dict]:
    """(image, variance, meta). Raises FileNotFoundError for unknown ids."""
    if not pid.isalnum():
        raise FileNotFoundError(pid)
    meta = json.loads((products_dir() / f"{pid}.json").read_text(encoding="utf-8"))
    with np.load(products_dir() / f"{pid}.npz") as data:
        return data["image"].astype(np.float64), data["variance"].astype(np.float64), meta


def ivw_mean(images: list[np.ndarray], variances: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Inverse-variance-weighted mean: less noisy pixels count more.

    This is how several images of the same detector are "added together" to improve
    signal-to-noise. Pixels that are NaN in every image stay NaN.
    """
    image_stack, variance_stack = np.array(images), np.array(variances)
    weights = np.where(np.isfinite(image_stack) & (variance_stack > 0), 1.0 / variance_stack, 0.0)
    weights = np.nan_to_num(weights)
    total = weights.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.nansum(np.nan_to_num(image_stack) * weights, axis=0) / total
        variance = 1.0 / total
    mean[total == 0] = np.nan
    variance[total == 0] = np.nan
    return mean, variance


def median_stack(images: list[np.ndarray], variances: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Median: anything that moves between images disappears (a "still sky" template)."""
    image_stack, variance_stack = np.array(images), np.array(variances)
    count = np.isfinite(image_stack).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        median = np.nanmedian(np.where(count > 0, image_stack, 0), axis=0)
        # The median of n noisy values is about 1.25× noisier than their mean.
        variance = (np.pi / 2) * np.nanmean(variance_stack, axis=0) / np.maximum(count, 1)
    median[count == 0] = np.nan
    variance[count == 0] = np.nan
    return median, variance


def sum_stack(images: list[np.ndarray], variances: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Plain sum (NaN pixels count as missing)."""
    return np.nansum(images, axis=0), np.nansum(variances, axis=0)


STACK_METHODS = {"ivw_mean": ivw_mean, "median": median_stack, "sum": sum_stack}


def white_merge(images: list[np.ndarray], variances: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Merge co-adds from different detectors into one deep "white light" image.

    Detectors see very different brightnesses, so each is first turned into
    "signal-to-noise" units (divide by its own noise level), then they are averaged.
    The result is unitless: 1 = one standard deviation of the noise.
    """
    normalized = []
    for image in images:
        _, median, std = sigma_clipped_stats(image, mask=~np.isfinite(image), sigma=3.0)
        normalized.append((image - median) / std if std and np.isfinite(std) else image * np.nan)
    stack = np.array(normalized)
    count = np.isfinite(stack).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        merged = np.nanmean(np.where(count > 0, stack, 0), axis=0) * np.sqrt(np.maximum(count, 1))
        variance = np.ones_like(merged)
    merged[count == 0] = np.nan
    variance[count == 0] = np.nan
    return merged, variance


# Elaine's comparison rule: besides pixel noise, allow 10% of the local brightness for what
# noise doesn't capture (undersampled stars, slightly different star shapes, sub-pixel
# alignment), so every bright star doesn't look like a "significant" change.
SYSTEMATIC_FRACTION = 0.10


def significance(
    image_a: np.ndarray, variance_a: np.ndarray, image_b: np.ndarray, variance_b: np.ndarray, normalize: bool
) -> tuple[np.ndarray, dict]:
    """How many standard deviations (σ) each pixel changed between A and B, plus checks.

    Returns the σ map and a summary: usable pixels, the noise check (the spread of the σ map
    should be about 1 if the noise estimate is right), and how many pixels changed by more
    than 5σ (real changes, or movers).
    """
    diff, variance = difference(image_a, variance_a, image_b, variance_b, normalize)
    brightness = np.fmax(np.abs(image_a), np.abs(image_b))
    total = variance + (SYSTEMATIC_FRACTION * brightness) ** 2
    with np.errstate(invalid="ignore", divide="ignore"):
        sigma = np.where(total > 0, diff / np.sqrt(total), np.nan)
    good = np.isfinite(sigma)
    usable = int(good.sum())
    values = sigma[good]
    if usable:
        median = float(np.median(values))
        # Robust spread: 1.4826 × median absolute deviation equals σ for Gaussian noise.
        spread = float(1.4826 * np.median(np.abs(values - median)))
        over5 = int(np.sum(np.abs(values) > 5))
    else:
        spread, over5 = float("nan"), 0
    summary = {
        "usable_pixels": usable,
        "total_pixels": int(sigma.size),
        "noise_check": round(spread, 3) if np.isfinite(spread) else None,
        "pixels_over_5_sigma": over5,
        "fraction_over_5_sigma": round(over5 / usable, 5) if usable else None,
        "systematic_fraction": SYSTEMATIC_FRACTION,
    }
    return sigma.astype(np.float32), summary


def difference(
    image_a: np.ndarray, variance_a: np.ndarray, image_b: np.ndarray, variance_b: np.ndarray, normalize: bool
) -> tuple[np.ndarray, np.ndarray]:
    """A − B. Something that moved shows as a bright/dark pair; a star that changed
    brightness shows as a single bright or dark spot.

    `normalize` scales B to best match A first (least squares), which helps when the
    two images were taken at slightly different wavelengths.
    """
    scale = 1.0
    if normalize:
        both = np.isfinite(image_a) & np.isfinite(image_b)
        denominator = float(np.sum(image_b[both] ** 2))
        if denominator > 0:
            scale = float(np.sum(image_a[both] * image_b[both])) / denominator
    return image_a - scale * image_b, variance_a + scale**2 * variance_b
