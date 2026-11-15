"""Relative light curves for saturated stars, from their outer glow ("wings").

Run from the repo root (with the .venv active):  python scripts/wing_lightcurves.py
Barnard's Star is a control (should be nearly steady); R Draconis should swing a lot.
Pictures go to docs/images/phase4/wing_lightcurve_<slug>.png.
"""
import asyncio
import sys
from pathlib import Path

import numpy as np
from astropy.time import Time
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
from app.config import load_datasets, load_targets  # noqa: E402
from app.photometry import relative_light_curve  # noqa: E402
from phase4_report import DETECTOR_COLOURS, FONT, OUT, TITLE_FONT, date_ticks, measure_target  # noqa: E402

TARGETS = {"barnards-star": 60, "rw-aurigae": 60, "r-draconis": 120}
W, H, LEFT, RIGHT, TOP, BOTTOM = 900, 380, 60, 110, 36, 46


def plot(name: str, curve: list[dict], path: Path) -> None:
    image = Image.new("RGB", (W, H), "#050A18")
    draw = ImageDraw.Draw(image)
    draw.text((LEFT, 8), f"{name}: relative brightness from the outer glow (1.0 = typical for that detector)",
              font=TITLE_FONT, fill="#FFFFFF")
    t = [c["t_mid"] for c in curve]
    t_low, t_high = min(t) - 15, max(t) + 15
    y_high = max(2.0, float(np.percentile([c["relative"] for c in curve], 99)) * 1.1)

    def to_px(x, y):
        return (LEFT + (x - t_low) / (t_high - t_low) * (W - LEFT - RIGHT),
                H - BOTTOM - y / y_high * (H - TOP - BOTTOM))

    draw.rectangle((LEFT, TOP, W - RIGHT, H - BOTTOM), outline="#1E3256")
    for y in np.arange(0, y_high, 0.5):
        _, py = to_px(t_low, y)
        draw.line((LEFT, py, W - RIGHT, py), fill="#11203A" if y != 1.0 else "#1E3256")
        draw.text((18, py - 7), f"{y:.1f}", font=FONT, fill="#8FA3BF")
    for x, label in date_ticks(t_low, t_high):
        px, _ = to_px(x, 0)
        draw.text((px - 18, H - BOTTOM + 6), label, font=FONT, fill="#8FA3BF")
    for point in curve:
        x, y = to_px(point["t_mid"], point["relative"])
        _, top = to_px(0, point["relative"] + point["relative_err"])
        _, bottom = to_px(0, point["relative"] - point["relative_err"])
        colour = DETECTOR_COLOURS[point["detector"] - 1]
        draw.line((x, top, x, bottom), fill=colour)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=colour)
    for d in sorted({c["detector"] for c in curve}):
        y = TOP + 6 + (d - 1) * 18
        draw.ellipse((W - RIGHT + 14, y, W - RIGHT + 22, y + 8), fill=DETECTOR_COLOURS[d - 1])
        draw.text((W - RIGHT + 28, y - 3), f"D{d}", font=FONT, fill="#E8EEF7")
    image.save(path, optimize=True)


async def main() -> None:
    datasets = load_datasets()
    targets = {t["slug"]: t for t in load_targets()["targets"]}
    for slug, max_images in TARGETS.items():
        target = targets[slug]
        import phase4_report

        phase4_report.MAX_IMAGES = max_images
        points = await measure_target(target, datasets)
        curve = relative_light_curve(points)
        path = OUT / f"wing_lightcurve_{slug}.png"
        plot(target["name"], curve, path)
        spreads = []
        for d in sorted({c["detector"] for c in curve}):
            values = [c["relative"] for c in curve if c["detector"] == d]
            if len(values) >= 3:
                spreads.append(f"D{d}: {min(values):.2f}–{max(values):.2f} ({len(values)} pts)")
        when = Time([min(c["t_mid"] for c in curve), max(c["t_mid"] for c in curve)], format="mjd").iso
        print(f"{target['name']}: {len(curve)} of {len(points)} images usable; {when[0][:10]} → {when[1][:10]}")
        print("   " + "; ".join(spreads) + f" → {path.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
