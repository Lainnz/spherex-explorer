"""
Build a DECORATIVE daytime Earth texture from NASA's Black Marble night map.

Why this works: NASA's Black Marble (Earth at Night) image includes faint
moonlit land surface, so it already contains accurate coastlines and the
relative brightness of deserts, forests and ice. This script:
  1. finds land vs. ocean,
  2. removes city lights,
  3. recolours land by brightness and latitude (forest -> savanna -> desert,
     snow/ice near the poles),
  4. paints oceans with lighter shallow water near coasts,
  5. adds soft procedural (invented) clouds.

The coastlines come from NASA data, but the colours and clouds are an artistic
approximation, NOT a true-colour photograph. Credit accordingly.

Usage:
  python make_day_texture.py <BlackMarble.jpg> <earth-day.jpg>
"""

import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SEED = 20250311


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise_3d(x, y, z, size, rng):
    """Smooth random noise sampled at 3D points (periodic lattice)."""
    lattice = rng.random((size, size, size)).astype(np.float32)
    xi, yi, zi = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
    xf, yf, zf = x - xi, y - yi, z - zi
    u, v, w = (t * t * (3 - 2 * t) for t in (xf, yf, zf))

    def L(dx, dy, dz):
        return lattice[(xi + dx) % size, (yi + dy) % size, (zi + dz) % size]

    c00 = L(0, 0, 0) * (1 - u) + L(1, 0, 0) * u
    c10 = L(0, 1, 0) * (1 - u) + L(1, 1, 0) * u
    c01 = L(0, 0, 1) * (1 - u) + L(1, 0, 1) * u
    c11 = L(0, 1, 1) * (1 - u) + L(1, 1, 1) * u
    c0 = c00 * (1 - v) + c10 * v
    c1 = c01 * (1 - v) + c11 * v
    return c0 * (1 - w) + c1 * w


def main(src, dst):
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    lat = np.linspace(90, -90, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    lon = np.linspace(-180, 180, w, dtype=np.float32)[None, :] * np.ones((h, 1), np.float32)

    # --- 1. Land mask: ocean in Black Marble is a flat dark blue ----------
    ocean_rgb = np.median(rgb[h // 2 - 50 : h // 2 + 50, 200:400].reshape(-1, 3), axis=0)
    diff = np.abs(rgb - ocean_rgb).sum(axis=2)
    land = diff > 9
    land = ndimage.binary_opening(land, iterations=1)
    land = ndimage.binary_closing(land, iterations=1)

    # --- 2. Surface brightness with city lights removed --------------------
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    surface = B.copy()  # land reflectance shows mostly in the blue channel
    lights = (R > 0.72 * B) & (R + G + B > 55) & land
    lights = ndimage.binary_dilation(lights, iterations=2)
    opened = ndimage.grey_opening(surface, size=(9, 9))
    surface = np.where(lights, opened, surface)
    surface = ndimage.gaussian_filter(surface, 0.6)

    land_vals = surface[land]
    lo, hi = np.percentile(land_vals, 2), np.percentile(land_vals, 98)
    t = np.clip((surface - lo) / (hi - lo), 0, 1)

    # --- 3. Land colours ---------------------------------------------------
    stops = np.array([0.0, 0.25, 0.45, 0.65, 0.85, 1.0])
    colours = np.array(
        [
            [22, 46, 22],  # dense forest
            [42, 72, 34],  # forest / grassland
            [92, 98, 54],  # savanna / olive
            [150, 128, 82],  # dry steppe
            [205, 172, 118],  # desert sand
            [228, 206, 160],  # pale sand
        ],
        dtype=np.float32,
    )
    land_col = np.stack([np.interp(t, stops, colours[:, c]) for c in range(3)], axis=2)

    # Snow and ice: bright land at high latitude (Antarctica, Greenland, Arctic)
    abslat = np.abs(lat)
    snow = smoothstep(0.55, 0.85, t) * smoothstep(52, 66, abslat)
    snow = np.maximum(snow, smoothstep(-62, -66, lat) * (lat < 0))  # Antarctica
    snow = np.clip(snow, 0, 1)[..., None]
    land_col = land_col * (1 - snow) + np.array([236, 241, 246], np.float32) * snow

    # Keep fine relief detail from the original brightness
    detail = surface - ndimage.gaussian_filter(surface, 4)
    land_col *= np.clip(1 + detail[..., None] / 40, 0.8, 1.2)

    # --- 4. Oceans ---------------------------------------------------------
    dist = ndimage.distance_transform_edt(~land)
    shelf = np.exp(-dist / 7.0)[..., None]
    deep = np.array([6, 22, 58], np.float32)
    polar = np.array([16, 32, 52], np.float32)
    polar_mix = smoothstep(45, 75, abslat)[..., None]
    ocean_col = deep * (1 - polar_mix) + polar * polar_mix
    ocean_col = ocean_col * (1 - shelf * 0.7) + np.array([24, 78, 112], np.float32) * shelf * 0.7

    colour = np.where(land[..., None], land_col, ocean_col)

    # --- 5. Procedural clouds (invented, for looks only) -------------------
    rng = np.random.default_rng(SEED)
    phi = np.radians(lat)
    lam = np.radians(lon)
    px, py, pz = np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)
    pz = pz * 2.2  # squash north-south so clouds stretch east-west

    def fbm(x, y, z, octaves, base_freq):
        out = np.zeros((h, w), np.float32)
        amp, freq, total = 1.0, base_freq, 0.0
        for _ in range(octaves):
            out += amp * value_noise_3d(x * freq + 50, y * freq + 50, z * freq + 50, 128, rng)
            total += amp
            amp *= 0.55
            freq *= 2.0
        return out / total

    # Domain warping gives swirly, wispy shapes instead of round blobs
    warp = fbm(px, py, pz, 3, 2.5) - 0.5
    clouds = fbm(px + warp * 0.6, py + warp * 0.6, pz - warp * 0.6, 7, 6.0)

    # Climate-like bands: equatorial clouds, clear subtropics, stormy mid-latitudes
    belt = (
        0.30
        + 0.30 * np.exp(-((lat / 9.0) ** 2))
        + 0.40 * np.exp(-(((abslat - 55.0) / 12.0) ** 2))
    )
    cover = smoothstep(0.62, 0.80, clouds + belt * 0.28) * 0.8
    cover = cover[..., None]
    colour = colour * (1 - cover) + np.array([238, 241, 246], np.float32) * cover

    Image.fromarray(np.clip(colour, 0, 255).astype(np.uint8)).save(dst, quality=90)
    print(f"Saved {dst} ({w}x{h}); land fraction {land.mean():.2f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
