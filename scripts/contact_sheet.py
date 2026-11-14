"""Phase 3 check: one "contact sheet" picture per featured target, showing every frame
plus a difference image (latest visit − earliest visit) with the predicted path marked.

Run from the repo root (with the .venv active):  python scripts/contact_sheet.py [slug ...]
Pictures go to docs/images/phase3/. The first run downloads cutouts from IRSA
(~4 MB each; the settings below keep it to a few hundred MB per target).
"""
import asyncio
import sys
import time
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import load_datasets, load_targets  # noqa: E402
from app.frames import FrameOptions, frame_stream  # noqa: E402
from app.motion import has_motion, position_at  # noqa: E402
from app.observations import find_observations  # noqa: E402
from app.products import difference, load_product  # noqa: E402
from app.render import ascii_only, percent_stretch, stretch_to_unit  # noqa: E402

OUT = ROOT / "docs" / "images" / "phase3"
# Detectors where each target is bright, and how many images to fetch at most.
PLAN = {
    "barnards-star": {"detectors": [1, 2, 3], "max_images": 60},
    "eps-indi-b": {"detectors": [2, 6], "max_images": 60},
    "wise-0855": {"detectors": [5, 6], "max_images": 80},
    "rw-aurigae": {"detectors": [1, 2, 3], "max_images": 45},
    "r-draconis": {"detectors": [1, 2, 3], "max_images": 45},
}
THUMB = 168
COLUMNS = 6
FONT = ImageFont.load_default(size=12)
TITLE_FONT = ImageFont.load_default(size=18)


def thumbnail(unit_image: np.ndarray) -> Image.Image:
    """0..1 array (FITS orientation) → north-up greyscale tile."""
    pixels = (np.nan_to_num(np.flipud(unit_image)) * 255).astype(np.uint8)
    return Image.fromarray(pixels).resize((THUMB, THUMB), Image.NEAREST).convert("RGB")


def sky_to_tile(meta: dict, ra: float, dec: float) -> tuple[float, float]:
    """Sky position → (x, y) on a north-up thumbnail."""
    x, y = WCS(fits.Header(meta["wcs"])).world_to_pixel_values(ra, dec)
    scale = THUMB / meta["width"]
    return (float(x) + 0.5) * scale, THUMB - (float(y) + 0.5) * scale


def mark(draw: ImageDraw.ImageDraw, x: float, y: float, colour: str, radius: int = 9) -> None:
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=colour, width=2)


async def sheet_for(target: dict, datasets: dict) -> str:
    plan = PLAN[target["slug"]]
    fov = target["demo"]["fov_arcsec"]
    started = time.time()
    found = await find_observations(
        ra=target["ra"], dec=target["dec"], fov_arcsec=fov, release_ids=datasets["default_releases"],
        detectors=plan["detectors"], tmin_mjd=None, tmax_mjd=None, max_images=plan["max_images"],
        motion=target["motion"], datasets=datasets,
    )
    options = FrameOptions(exclude_flags=datasets["flags_default_exclude"])
    frames, done = [], {}
    async for message in frame_stream(found, ra=target["ra"], dec=target["dec"], fov_arcsec=fov,
                                      motion=target["motion"], options=options, datasets=datasets):
        if message["type"] == "frame":
            frames.append(message)
            print(f"  {target['name']}: frame {len(frames)} · {message['label']}", flush=True)
        elif message["type"] == "done":
            done = message
    if not frames:
        return f"{target['name']}: no frames"

    tiles = []
    for frame in frames:
        image, _, _ = load_product(frame["frame_id"])
        tile = thumbnail(stretch_to_unit(image, frame["vmin"], frame["vmax"], 1.0))
        if has_motion(target["motion"]):
            mark(ImageDraw.Draw(tile), *sky_to_tile(frame, *position_at(target["motion"], frame["t_mid"])), "#00B5BC")
        tiles.append((tile, frame["label"].replace("Visit ", "V"), f"{frame['n_images']} img · {frame['wavelength_um']} µm"))

    # Difference: latest frame − earliest frame of the most common detector.
    detector = max(plan["detectors"], key=lambda d: sum(f["detectors"] == [d] for f in frames))
    same = [f for f in frames if f["detectors"] == [detector]]
    first, last = same[0], same[-1]
    image_a, var_a, meta = load_product(last["frame_id"])
    image_b, var_b, _ = load_product(first["frame_id"])
    diff, _ = difference(image_a, var_a, image_b, var_b, normalize=True)
    limit = max(abs(v) for v in percent_stretch([diff], 99.5))
    diff_tile = thumbnail(np.clip((diff + limit) / (2 * limit), 0, 1))
    draw = ImageDraw.Draw(diff_tile)
    if has_motion(target["motion"]):
        start = sky_to_tile(meta, *position_at(target["motion"], first["t_mid"]))
        end = sky_to_tile(meta, *position_at(target["motion"], last["t_mid"]))
        draw.line((*start, *end), fill="#F0B200", width=1)
        mark(draw, *start, "#E45950")  # where it was (dark spot)
        mark(draw, *end, "#00B5BC")  # where it went (bright spot)
    tiles.append((diff_tile, f"DIFFERENCE D{detector}", f"{last['label'][:22]} − first"))

    rows = -(-len(tiles) // COLUMNS)
    cell_h = THUMB + 34
    sheet = Image.new("RGB", (COLUMNS * THUMB + (COLUMNS + 1) * 6, 44 + rows * (cell_h + 6)), "#050A18")
    draw = ImageDraw.Draw(sheet)
    title = (f"{target['name']} · {len(frames)} frames from {sum(f['n_images'] for f in frames)} images · "
             f"FOV {fov}″ · D{','.join(map(str, plan['detectors']))} · north up, east left")
    draw.text((8, 12), ascii_only(title), font=TITLE_FONT, fill="#FFFFFF")
    for i, (tile, line1, line2) in enumerate(tiles):
        x = 6 + (i % COLUMNS) * (THUMB + 6)
        y = 44 + (i // COLUMNS) * (cell_h + 6)
        sheet.paste(tile, (x, y))
        # The built-in font has no → µ ″ symbols, so labels are plain ASCII here.
        draw.text((x + 2, y + THUMB + 3), ascii_only(line1)[:30], font=FONT, fill="#E8EEF7")
        draw.text((x + 2, y + THUMB + 18), ascii_only(line2)[:30], font=FONT, fill="#8FA3BF")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"contact_{target['slug']}.png"
    sheet.save(path, optimize=True)
    return (f"{target['name']}: {len(frames)} frames, {done.get('images_failed', 0)} images failed, "
            f"{time.time() - started:.0f} s → {path.relative_to(ROOT)}")


async def main(slugs: list[str]) -> None:
    datasets, targets = load_datasets(), load_targets()["targets"]
    chosen = [t for t in targets if not slugs or t["slug"] in slugs]
    for target in chosen:  # one at a time, to be polite to IRSA
        print(await sheet_for(target, datasets), flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(sys.argv[1:]))
