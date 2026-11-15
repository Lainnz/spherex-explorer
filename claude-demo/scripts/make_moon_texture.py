"""
Build a DECORATIVE Moon texture (equirectangular, 2:1) procedurally.

Grey surface with soft noise, a few dark "maria" (lava plains) and many
craters with bright rims. Invented for looks; not a real lunar map.

Usage:
  python make_moon_texture.py <moon.jpg>
"""

import sys

import numpy as np
from PIL import Image
from scipy import ndimage

W, H = 1024, 512
rng = np.random.default_rng(1969)

lat = np.radians(np.linspace(90, -90, H))[:, None]
lon = np.radians(np.linspace(-180, 180, W))[None, :]
P = np.stack(
    [np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat) * np.ones_like(lon)],
    axis=-1,
)  # unit vector for every pixel


def random_unit_vectors(n):
    v = rng.normal(size=(n, 3))
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def angular_distance(center):
    return np.arccos(np.clip(P @ center, -1, 1))


# Base brightness with gentle large-scale variation
base = rng.random((H // 16, W // 16))
base = ndimage.zoom(base, 16, order=3)[:H, :W]
surface = 0.62 + 0.08 * (base - 0.5)

# Maria: big, soft dark patches, mostly on one hemisphere (like the real near side)
for c in random_unit_vectors(9):
    c[0] = abs(c[0])  # bias toward lon ~ 0
    r = rng.uniform(0.15, 0.45)
    d = angular_distance(c)
    surface -= 0.26 * np.clip(1 - d / r, 0, 1) ** 0.6

# Craters: many small, few large (power-law sizes)
for c in random_unit_vectors(420):
    r = 0.012 * rng.pareto(1.6) + 0.008
    r = min(r, 0.18)
    d = angular_distance(c) / r
    floor = np.clip(1 - d, 0, 1)
    rim = np.exp(-((d - 1.0) / 0.18) ** 2)
    surface += -0.10 * floor ** 0.5 + 0.07 * rim

# Fine grain
grain = ndimage.gaussian_filter(rng.random((H, W)), 0.8)
surface += 0.05 * (grain - 0.5)

img = np.clip(surface, 0, 1)
rgb = np.stack([img * 0.98, img * 0.97, img * 0.95], axis=-1)  # very slightly warm grey
Image.fromarray((rgb * 255).astype(np.uint8)).save(sys.argv[1], quality=90)
print("saved", sys.argv[1])
