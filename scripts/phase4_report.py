"""Phase 4 check: a spectrum and a light curve for each featured target, and live
click-to-identify answers for a few stars.

Run from the repo root (with the .venv active):  python scripts/phase4_report.py [slug ...]
Pictures go to docs/images/phase4/. The first run downloads cutouts (~4 MB each).
"""
import asyncio
import json
import sys
from pathlib import Path

import numpy as np
from astropy.time import Time
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import load_datasets, load_targets  # noqa: E402
from app.frames import grid_center  # noqa: E402
from app.motion import position_at  # noqa: E402
from app.objects import identify  # noqa: E402
from app.observations import find_observations  # noqa: E402
from app.photometry import bin_spectrum, photometry_stream  # noqa: E402

OUT = ROOT / "docs" / "images" / "phase4"
MAX_IMAGES = 60
DETECTOR_COLOURS = ["#0072B2", "#56B4E9", "#009E73", "#F0E442", "#E69F00", "#D55E00"]  # Okabe–Ito
FONT = ImageFont.load_default(size=12)
TITLE_FONT = ImageFont.load_default(size=16)
W, H, LEFT, RIGHT, TOP, BOTTOM = 560, 360, 70, 14, 34, 46


def nice_range(values: list[float]) -> tuple[float, float]:
    low, high = np.percentile(values, [1, 99]) if len(values) > 4 else (min(values), max(values))
    pad = (high - low) * 0.12 or abs(high) * 0.2 or 1.0
    return float(low - pad), float(high + pad)


def panel(points, x_of, title, x_label, x_ticks) -> Image.Image:
    """A small scatter plot with error bars; flagged points are hollow."""
    image = Image.new("RGB", (W, H), "#050A18")
    draw = ImageDraw.Draw(image)
    draw.text((LEFT, 8), title, font=TITLE_FONT, fill="#FFFFFF")
    points = measurable(points)
    if not points:
        draw.text((LEFT, H // 2 - 20), "No measurable points: the star is saturated\n"
                  "(too bright for SPHEREx) in every image.", font=TITLE_FONT, fill="#F0B200")
        return image
    good = [p for p in points if not p["flagged"]] or points
    x_low, x_high = nice_range([x_of(p) for p in points])
    y_low, y_high = nice_range([p["flux_ujy"] for p in good])

    def to_px(x, y):
        return (LEFT + (x - x_low) / (x_high - x_low) * (W - LEFT - RIGHT),
                H - BOTTOM - (y - y_low) / (y_high - y_low) * (H - TOP - BOTTOM))

    draw.rectangle((LEFT, TOP, W - RIGHT, H - BOTTOM), outline="#1E3256")
    for i in range(5):
        y = y_low + (y_high - y_low) * i / 4
        _, py = to_px(x_low, y)
        draw.line((LEFT - 4, py, LEFT, py), fill="#8FA3BF")
        draw.text((4, py - 7), f"{y:,.0f}", font=FONT, fill="#8FA3BF")
    for x, label in x_ticks(x_low, x_high):
        px, _ = to_px(x, y_low)
        draw.line((px, H - BOTTOM, px, H - BOTTOM + 4), fill="#8FA3BF")
        draw.text((px - 18, H - BOTTOM + 6), label, font=FONT, fill="#8FA3BF")
    draw.text((LEFT, H - 16), x_label, font=FONT, fill="#E8EEF7")
    draw.text((4, TOP - 16), "flux (µJy)".replace("µ", "u"), font=FONT, fill="#E8EEF7")

    for p in sorted(points, key=lambda p: not p["flagged"]):  # flagged first, underneath
        x, y = to_px(x_of(p), p["flux_ujy"])
        if not (TOP - 50 < y < H + 50):
            continue
        colour = DETECTOR_COLOURS[p["detector"] - 1]
        _, y_top = to_px(0, p["flux_ujy"] + p["err_ujy"])
        _, y_bottom = to_px(0, p["flux_ujy"] - p["err_ujy"])
        draw.line((x, y_top, x, y_bottom), fill=colour)
        box = (x - 3, y - 3, x + 3, y + 3)
        draw.ellipse(box, outline=colour) if p["flagged"] else draw.ellipse(box, fill=colour)
    return image


def wavelength_ticks(low, high):
    step = 0.5 if high - low > 1.5 else 0.25
    start = np.ceil(low / step) * step
    return [(x, f"{x:.2f}") for x in np.arange(start, high, step)]


def date_ticks(low, high):
    ticks = []
    for year in (2025, 2026, 2027):
        for month in (1, 4, 7, 10):
            mjd = Time(f"{year}-{month:02d}-01").mjd
            if low <= mjd <= high:
                ticks.append((mjd, f"{year}-{month:02d}"))
    return ticks


async def measure_target(target: dict, datasets: dict) -> list[dict]:
    fov = target["demo"]["fov_arcsec"]
    found = await find_observations(
        ra=target["ra"], dec=target["dec"], fov_arcsec=fov, release_ids=datasets["default_releases"],
        detectors=[1, 2, 3, 4, 5, 6], tmin_mjd=None, tmax_mjd=None, max_images=MAX_IMAGES,
        motion=target["motion"], datasets=datasets,
    )
    rows = found["observations"]
    center_ra, center_dec = grid_center(target["ra"], target["dec"], rows, target["motion"])
    points = []
    async for message in photometry_stream(
        rows, center_ra=center_ra, center_dec=center_dec,
        size_deg=fov * datasets["limits"]["cutout_size_margin"] / 3600, aperture_px=2.0,
        annulus_px=(4.0, 7.0), exclude_flags=datasets["flags_default_exclude"],
        pixel_scale_arcsec=datasets["pixel_scale_arcsec"],
    ):
        if message["type"] == "point" and message["wavelength_um"] is not None:
            points.append(message)
        elif message["type"] == "done" and message.get("warning"):
            print(f"  {target['name']}: {message['warning']}")
    return points


def measurable(points: list[dict]) -> list[dict]:
    """Points with a usable number (saturated ones have none)."""
    return [p for p in points if p["flux_ujy"] is not None and np.isfinite(p["flux_ujy"])
            and p["err_ujy"] is not None and np.isfinite(p["err_ujy"])]


def light_curve_detector(points: list[dict]) -> int:
    """The detector with the most clean points (light curves compare like with like)."""
    counts = {d: sum(1 for p in points if p["detector"] == d and not p["flagged"]) for d in range(1, 7)}
    return max(counts, key=counts.get)


async def main(slugs: list[str]) -> None:
    datasets, targets = load_datasets(), load_targets()["targets"]
    OUT.mkdir(parents=True, exist_ok=True)
    channels = datasets["allsky_cube"]["wavelengths_um"]
    for target in [t for t in targets if not slugs or t["slug"] in slugs]:
        points = await measure_target(target, datasets)
        clean = [p for p in points if not p["flagged"]]
        if not points:
            print(f"{target['name']}: no measurements")
            continue
        spectrum = panel(points, lambda p: p["wavelength_um"],
                         f"{target['name']}: spectrum ({len(clean)} clean / {len(points)} points)",
                         "wavelength (um)   filled = clean, hollow = flagged", wavelength_ticks)
        detector = light_curve_detector(points)
        in_detector = [p for p in points if p["detector"] == detector]
        wl = [p["wavelength_um"] for p in in_detector]
        curve = panel(in_detector, lambda p: p["t_mid"],
                      f"{target['name']}: light curve, D{detector} ({min(wl):.2f}-{max(wl):.2f} um)",
                      "date (UTC)", date_ticks)
        sheet = Image.new("RGB", (2 * W, H), "#050A18")
        sheet.paste(spectrum, (0, 0))
        sheet.paste(curve, (W, 0))
        path = OUT / f"spectrum_lightcurve_{target['slug']}.png"
        sheet.save(path, optimize=True)

        binned = bin_spectrum(clean, channels)
        fluxes = [p["flux_ujy"] for p in measurable(in_detector) if not p["flagged"]]
        swing = max(fluxes) / min(fluxes) if fluxes and min(fluxes) > 0 else float("nan")
        saturated = sum(p["saturated"] for p in points)
        print(f"{target['name']}: {len(points)} points ({len(clean)} clean, {saturated} saturated), "
              f"{len(binned)} of 102 channels, D{detector} clean brightest/faintest = {swing:.2f}× "
              f"→ {path.relative_to(ROOT)}", flush=True)

    print("\nClick-to-identify (live SIMBAD + Gaia), viewing date 2026-01-01:")
    mjd = Time(2026.0, format="jyear").mjd
    samples = {t["slug"]: t for t in targets}
    clicks = [
        ("Barnard's Star (its 2026 position)", *position_at(samples["barnards-star"]["motion"], mjd)),
        ("RW Aurigae", samples["rw-aurigae"]["ra"], samples["rw-aurigae"]["dec"]),
        ("WISE 0855 (its 2026 position)", *position_at(samples["wise-0855"]["motion"], mjd)),
        ("Empty-looking spot near R Dra", samples["r-draconis"]["ra"] + 0.05, samples["r-draconis"]["dec"] + 0.05),
    ]
    for label, ra, dec in clicks:
        answer = await asyncio.to_thread(identify, ra, dec, 10.0, mjd)
        keep = ("found", "name", "type_name", "what_is_this", "distance_ly", "proper_motion_arcsec_per_year",
                "magnitude_g", "separation_arcsec", "other_names", "sources", "message")
        print(f"- {label} @ ({ra:.5f}, {dec:+.5f}):")
        print("  " + json.dumps({k: answer.get(k) for k in keep if k in answer}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main(sys.argv[1:]))
