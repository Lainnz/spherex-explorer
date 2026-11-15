"""Turning number arrays into things a browser can show (PLAN.md §7.5, §8.3).

- PNG: a quick-look greyscale picture with a fixed stretch. Colour maps and live
  stretch changes happen in the browser (Phase 8) using the Float32 data.
- .f32: the raw numbers as little-endian 32-bit floats, row 0 = top (north), like the PNG.
- FITS: the image with its sky coordinates, for overlaying in Aladin Lite.

FITS stores row 0 at the bottom, so arrays are flipped for PNG and .f32.
"""
import io

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image


def percent_stretch(images: list[np.ndarray], trim: float = 99.5) -> tuple[float, float]:
    """(vmin, vmax) from percentiles of all finite pixels in `images`.

    Using the same range for every frame in a sequence makes blinking fair: a star that
    looks brighter really is brighter. `trim` clips the brightest pixels, like WiseView's
    "Trim Bright".
    """
    values = np.concatenate([image[np.isfinite(image)].ravel() for image in images] or [np.array([])])
    if values.size == 0:
        return 0.0, 1.0
    low, high = np.percentile(values, [100 - trim, trim])
    if high <= low:
        high = low + 1.0
    return float(low), float(high)


def stretch_to_unit(image: np.ndarray, vmin: float, vmax: float, softening: float = 0.1) -> np.ndarray:
    """Scale to 0..1 with an asinh curve (WiseView's "Linear" slider).

    Small `softening` brings out faint things without burning out bright stars;
    large `softening` (≥ 10) is almost a straight line.
    """
    scaled = np.clip((image - vmin) / (vmax - vmin), 0, 1)
    return np.arcsinh(scaled / softening) / np.arcsinh(1 / softening)


def to_png(unit_image: np.ndarray) -> bytes:
    """0..1 greyscale (or H×W×3 colour) → PNG bytes, north up. NaN shows as black."""
    pixels = np.round(np.nan_to_num(unit_image, nan=0.0) * 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(np.flipud(pixels)).save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def to_f32(image: np.ndarray) -> bytes:
    """Raw little-endian float32, row 0 = north (top), NaN kept."""
    return np.flipud(image).astype("<f4").tobytes()


def ascii_only(text: str) -> str:
    """FITS headers allow plain ASCII only: "Visit 1 · A → B" → "Visit 1 - A to B"."""
    for fancy, plain in (("·", "-"), ("→", "to"), ("−", "-"), ("″", '"'), ("′", "'"), ("µ", "u"), ("σ", "sigma")):
        text = text.replace(fancy, plain)
    return text.encode("ascii", "ignore").decode()


def to_fits(image: np.ndarray, wcs_cards: dict, meta: dict) -> bytes:
    """A single-HDU FITS file with sky coordinates and a few descriptive keywords."""
    header = WCS(fits.Header(wcs_cards)).to_header()
    header["BUNIT"] = meta.get("unit", "MJy/sr")
    header["ORIGIN"] = "SPHEREx Xplorer"
    header["LABEL"] = ascii_only(str(meta.get("label", "")))[:68]
    if meta.get("t_mid") is not None:
        header["MJD-AVG"] = meta["t_mid"]
    buffer = io.BytesIO()
    fits.PrimaryHDU(image.astype(np.float32), header=header).writeto(buffer)
    return buffer.getvalue()
