"""One wavelength of the official SPHEREx DR1 all-sky HiPS cube, served as a plain HiPS.

IRSA publishes the SPHEREx DR1 all-sky mosaic as a HiPS *cube*:
  https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube
with 102 frames, one per SPHEREx spectral channel (ascending wavelength). Frame 0
tiles are named NpixN.png and frame k > 0 tiles NpixN_k.png (checked on the server).

Aladin Lite 3.8 can open HiPS cubes, but it picks frames by frequency on a
linear scale, which does not match this cube's channel order (tested: asking for
slice 62 fetched frame 8). So the backend presents each frame as an ordinary
2-D HiPS: /api/hips/spherex/<frame>/... -> the matching tile of that frame.
Tiles are cached on disk. Nothing is changed in the pixels.

These PNG tiles are IRSA's *display* version (8-bit, asinh stretch, ~12.9"
pixels). They are real SPHEREx data but not calibrated for measurements.
"""

import re

import httpx

from . import config

CUBE_URL = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube"
DEPTH = 102
BLANK_FRAMES = {50, 51}  # dichroic channels, blank according to the cube's own description
TILE_PATH = re.compile(r"^(Norder\d{1,2}/(?:Dir\d+/Npix\d+|Allsky))\.png$")
_properties_cache: dict[str, str] = {}


class HipsError(Exception):
    pass


def cube_properties() -> dict[str, str]:
    """The cube's own properties file, parsed (cached in memory)."""
    if not _properties_cache:
        response = httpx.get(f"{CUBE_URL}/properties", timeout=config.HTTP_TIMEOUT)
        response.raise_for_status()
        for line in response.text.splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                _properties_cache[key.strip()] = value.strip()
    return _properties_cache


def channels() -> list[dict]:
    """Wavelength of every frame, from the cube's properties (data_cube_crval3_arr)."""
    props = cube_properties()
    waves = [float(v) for v in props["data_cube_crval3_arr"].split()]
    return [
        {
            "frame": i,
            "wavelength_um": w,
            "detector": i // 17 + 1,  # "frame index = 17*(band-1) + (channel-1)" (cube description)
            "channel": i % 17 + 1,
            "blank": i in BLANK_FRAMES,
        }
        for i, w in enumerate(waves)
    ]


def frame_properties(frame: int) -> str:
    """A properties file describing one frame as a normal 2-D HiPS."""
    props = cube_properties()
    wave = channels()[frame]["wavelength_um"]
    keep = [
        "hips_version", "hips_release_date", "hips_frame", "hips_order", "hips_order_min",
        "hips_tile_width", "hips_tile_format", "hips_pixel_scale", "obs_regime",
        "hips_creator", "hips_copyright", "obs_copyright", "obs_collection", "moc_sky_fraction",
    ]
    lines = [f"{k} = {props[k]}" for k in keep if k in props]
    lines += [
        f"creator_did = {props.get('creator_did', 'ivo://IPAC/P/SPHEREx/DR1/cube')}/frame{frame}",
        f"obs_title = SPHEREx DR1 all-sky mosaic at {wave:.3f} um (frame {frame} of the IRSA HiPS cube)",
        "dataproduct_type = image",
        f"em_min = {wave * 1e-6:.4e}",
        f"em_max = {wave * 1e-6:.4e}",
        f"obs_description = Frame {frame} of {CUBE_URL}, served unchanged by SPHEREx Xplorer",
    ]
    return "\n".join(lines) + "\n"


def tile(frame: int, path: str) -> bytes:
    """One PNG tile of one frame, from the disk cache or IRSA."""
    match = TILE_PATH.match(path)
    if not match or not 0 <= frame < DEPTH:
        raise HipsError("Not a HiPS tile path")
    stem = match.group(1)
    remote = f"{CUBE_URL}/{stem}{'' if frame == 0 else f'_{frame}'}.png"
    cache_file = config.CACHE_DIR / "hips" / f"f{frame}" / f"{stem}.png"
    if cache_file.exists():
        return cache_file.read_bytes()
    response = httpx.get(remote, timeout=config.HTTP_TIMEOUT)
    if response.status_code == 404:
        raise FileNotFoundError(remote)
    response.raise_for_status()
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(response.content)
    return response.content


def rgb_tile(frames: tuple[int, int, int], path: str) -> bytes:
    """False-colour tile: three frames' grey tiles placed in the red, green and blue channels.

    Each frame keeps IRSA's own display stretch; nothing else is adjusted. Pixels that
    are transparent (no data) in any of the three stay transparent.
    """
    import io

    from PIL import Image, ImageChops  # lazy import: only needed for false colour

    match = TILE_PATH.match(path)
    if not match or not all(0 <= f < DEPTH for f in frames):
        raise HipsError("Not a HiPS tile path")
    stem = match.group(1)
    cache_file = config.CACHE_DIR / "hips" / "rgb" / f"{frames[0]}-{frames[1]}-{frames[2]}" / f"{stem}.png"
    if cache_file.exists():
        return cache_file.read_bytes()
    # "LA" = grey + alpha; PNG tiles mark missing data as transparent (tRNS)
    layers = [Image.open(io.BytesIO(tile(f, path))).convert("LA") for f in frames]
    if len({im.size for im in layers}) != 1:
        raise HipsError("Tiles of different sizes")
    rgb = Image.merge("RGB", [im.getchannel("L") for im in layers])
    alpha = layers[0].getchannel("A")
    for im in layers[1:]:
        alpha = ImageChops.darker(alpha, im.getchannel("A"))
    rgb.putalpha(alpha)
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG", optimize=False)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(buffer.getvalue())
    return buffer.getvalue()


def rgb_properties(frames: tuple[int, int, int]) -> str:
    waves = [channels()[f]["wavelength_um"] for f in frames]
    base = frame_properties(frames[0]).splitlines()
    base = [l for l in base if not l.startswith(("creator_did", "obs_title", "em_min", "em_max", "obs_description"))]
    base += [
        f"creator_did = ivo://IPAC/P/SPHEREx/DR1/cube/rgb-{frames[0]}-{frames[1]}-{frames[2]}",
        f"obs_title = SPHEREx DR1 false colour: red {waves[0]:.3f} um, green {waves[1]:.3f} um, blue {waves[2]:.3f} um",
        f"em_min = {min(waves) * 1e-6:.4e}",
        f"em_max = {max(waves) * 1e-6:.4e}",
    ]
    return "\n".join(base) + "\n"
