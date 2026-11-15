"""Building the frames of the "little video" (POST /api/frames, PLAN.md §7.5).

Frame modes:
- "epoch" (default): one frame per visit × detector, an inverse-variance co-add.
- "white": one frame per visit, merging all detectors (deepest image).
- "exposure": every single image in time order (best for very fast movers, noisier).

Frames are sent one by one as soon as they're ready (NDJSON: one JSON object per line),
so the website can show progress instead of waiting for everything.
"""
import asyncio
import logging
from collections import Counter
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import numpy as np
from astropy.time import Time
from scipy.ndimage import maximum_filter

from . import irsa
from .grid import Grid, GridImage, make_grid, to_grid
from .motion import has_motion, position_at
from .observations import SEARCH_EPOCH
from .products import ivw_mean, load_product, product_exists, product_id, save_product, white_merge
from .render import percent_stretch

MODES = ("epoch", "white", "exposure")
log = logging.getLogger(__name__)


@dataclass
class FrameOptions:
    mode: str = "epoch"
    zodi_subtract: bool = True
    background_subtract: bool = True
    exclude_flags: list[str] = field(default_factory=list)
    fill_flagged: bool = True
    trim: float = 99.5
    softening: float = 1.0


@dataclass
class FrameGroup:
    """The images that make up one frame."""

    key: tuple
    rows: list[dict]
    label: str
    stretch_key: str  # frames sharing this key share one brightness range

    @property
    def t_mid(self) -> float:
        return float(np.mean([row["t_mid"] for row in self.rows]))


def grid_center(ra: float, dec: float, rows: list[dict], motion: dict | None) -> tuple[float, float]:
    """Centre the grid on a moving target's position at a fixed date (2026.0, the same as
    the search). Fixed, not the images' average date, so a quick preview and the full
    set of frames ask IRSA for identical cutouts and share the downloads."""
    if has_motion(motion) and rows:
        return position_at(motion, SEARCH_EPOCH)
    return ra, dec


def group_rows(rows: list[dict], visits: list[dict], mode: str) -> list[FrameGroup]:
    """Split the images into frames, in time order."""
    labels = {visit["visit"]: visit["label"] for visit in visits}
    groups: dict[tuple, FrameGroup] = {}
    for index, row in enumerate(rows):
        detector = row["detector"]
        if mode == "epoch":
            key = (row["visit"], detector)
            label = f"{labels[row['visit']]} · D{detector}"
            stretch_key = f"D{detector}"
        elif mode == "white":
            key = (row["visit"],)
            label = f"{labels[row['visit']]} · all detectors"
            stretch_key = "white"
        else:
            key = (index,)
            when = Time(row["t_mid"], format="mjd").to_value("iso", subfmt="date_hm")
            label = f"{when} UTC · D{detector}"
            stretch_key = f"D{detector}"
        groups.setdefault(key, FrameGroup(key, [], label, stretch_key)).rows.append(row)
    return sorted(groups.values(), key=lambda group: group.t_mid)


def frame_recipe(group: FrameGroup, grid: Grid, options: FrameOptions) -> dict:
    """Everything that decides a frame's pixels (not its display stretch)."""
    return {
        "kind": "frame",
        "mode": options.mode,
        "images": sorted(f"{row['obs_id']}/D{row['detector']}/{row['release']}" for row in group.rows),
        "grid": [round(float(v), 7) for v in (*grid.wcs.wcs.crval, grid.width, grid.wcs.wcs.cdelt[1])],
        "zodi": options.zodi_subtract,
        "background": options.background_subtract,
        "exclude": sorted(options.exclude_flags),
        "fill": "neighbour-max" if options.fill_flagged else False,
    }


FILL_PASSES = 4  # fills holes up to ~8 pixels across


def coadd(images: list[GridImage], fill_flagged: bool) -> tuple[np.ndarray, np.ndarray, int]:
    """Co-add good pixels. Returns (image, variance, number of filled pixels).

    Where every image flagged a pixel, there's a hole. Most holes are the saturated
    cores of bright stars, whose raw values are nonsense (on 2026-11-14 Barnard's Star's
    core read anywhere from 23 to 2000 MJy/sr, flagged OVERFLOW/SUR_ERROR/BLOOM). For the
    picture, `fill_flagged` gives each hole pixel the value of its brightest good
    neighbour, so a saturated star looks like a solid bright blob. Filled pixels keep a
    NaN variance, so stacks and measurements treat them as missing.
    """
    mean, variance = ivw_mean([i.image for i in images], [i.variance for i in images])
    if not fill_flagged:
        return mean, variance, 0
    inside = np.any([np.isfinite(i.raw_image) for i in images], axis=0)  # within the cutouts
    filled = 0
    for _ in range(FILL_PASSES):
        holes = np.isnan(mean) & inside
        if not holes.any():
            break
        neighbours = maximum_filter(np.where(np.isfinite(mean), mean, -np.inf), size=3)
        fill = holes & np.isfinite(neighbours)
        mean[fill] = neighbours[fill]
        filled += int(fill.sum())
    return mean, variance, filled


def combine(group: FrameGroup, images: list[GridImage], options: FrameOptions) -> tuple[np.ndarray, np.ndarray, str, int]:
    """(image, variance, unit, filled pixels) for one frame."""
    if options.mode == "white":
        per_detector = {}
        for row, image in zip(group.rows, images):
            per_detector.setdefault(row["detector"], []).append(image)
        coadds = [coadd(imgs, options.fill_flagged) for imgs in per_detector.values()]
        merged, variance = white_merge([c[0] for c in coadds], [c[1] for c in coadds])
        return merged, variance, "signal-to-noise (σ)", sum(c[2] for c in coadds)
    mean, variance, filled = coadd(images, options.fill_flagged)
    return mean, variance, "MJy/sr", filled


def frame_message(pid: str, meta: dict, vmin: float, vmax: float, softening: float) -> dict:
    """What the website receives for one frame."""
    stretch = f"vmin={vmin:.6g}&vmax={vmax:.6g}&softening={softening:g}"
    return {
        "type": "frame",
        "frame_id": pid,
        **{k: meta[k] for k in ("label", "t_mid", "t_start", "t_end", "visit", "detectors", "wavelength_um",
                                "n_images", "releases", "width", "height", "wcs", "unit")},
        "filled_pixels": meta.get("filled_pixels", 0),
        "obs_ids": meta.get("obs_ids", []),
        "vmin": vmin,
        "vmax": vmax,
        "png_url": f"/api/product/{pid}.png?{stretch}",
        "f32_url": f"/api/product/{pid}.f32",
        "fits_url": f"/api/product/{pid}.fits",
    }


async def frame_stream(
    observations: dict, *, ra: float, dec: float, fov_arcsec: float, motion: dict | None,
    options: FrameOptions, datasets: dict,
) -> AsyncIterator[dict]:
    """Yield {"type": "start" | "progress" | "frame" | "done" | "error", ...} messages."""
    rows, visits = observations["observations"], observations["visits"]
    limits = datasets["limits"]
    center_ra, center_dec = grid_center(ra, dec, rows, motion)
    grid = make_grid(center_ra, center_dec, fov_arcsec, datasets["pixel_scale_arcsec"])
    size_deg = fov_arcsec * limits["cutout_size_margin"] / 3600
    groups = group_rows(rows, visits, options.mode)
    recipes = [frame_recipe(group, grid, options) for group in groups]
    ids = [product_id(recipe) for recipe in recipes]
    to_build = [group for group, pid in zip(groups, ids) if not product_exists(pid)]
    n_downloads = sum(len(group.rows) for group in to_build)

    yield {
        "type": "start",
        "mode": options.mode,
        "frames_total": len(groups),
        "images_total": len(rows),
        "images_to_download": n_downloads,
        "estimated_download_mb": round(n_downloads * limits["cutout_mb_estimate"], 1),
        "grid": {"ra": center_ra, "dec": center_dec, "width": grid.width, "height": grid.height},
        "visits": visits,
        "warning": observations.get("warning"),
    }

    failure_reasons: Counter = Counter()

    async def load(row: dict) -> GridImage | None:
        try:
            content = await irsa.fetch_cutout(row["access_url"], center_ra, center_dec, size_deg)
            return await asyncio.to_thread(
                to_grid, content, grid, row["target_ra"], row["target_dec"], options.exclude_flags,
                options.zodi_subtract, options.background_subtract,
            )
        except Exception as error:  # one bad or missing image shouldn't stop the whole sequence
            reason = f"{type(error).__name__}: {str(error)[:120]}"
            failure_reasons[reason] += 1
            log.warning("Skipped %s D%s: %s", row["obs_id"], row["detector"], reason)
            return None

    # Start every download now, in time order; the IRSA limit keeps only a few running.
    tasks = {id(group): [asyncio.create_task(load(row)) for row in group.rows] for group in to_build}
    stretches: dict[str, tuple[float, float]] = {}
    failed = 0
    try:
        for index, (group, pid) in enumerate(zip(groups, ids), start=1):
            if id(group) in tasks:
                loaded = await asyncio.gather(*tasks[id(group)])
                good = [(row, image) for row, image in zip(group.rows, loaded) if image is not None]
                failed += len(loaded) - len(good)
                if not good:
                    yield {"type": "progress", "frames_ready": index, "frames_total": len(groups),
                           "skipped": group.label, "reason": "no usable images"}
                    continue
                used = FrameGroup(group.key, [row for row, _ in good], group.label, group.stretch_key)
                if len(good) < len(group.rows):
                    # Incomplete: save under its own id, so the complete frame is retried next time.
                    pid = product_id(frame_recipe(used, grid, options))
                image, variance, unit, filled = combine(used, [img for _, img in good], options)
                wavelengths = [img.wavelength_um for _, img in good if img.wavelength_um is not None]
                meta = {
                    "label": group.label,
                    "t_mid": used.t_mid,
                    "t_start": min(r["t_start"] for r in used.rows),
                    "t_end": max(r["t_end"] for r in used.rows),
                    "visit": used.rows[0].get("visit"),
                    "detectors": sorted({r["detector"] for r in used.rows}),
                    "wavelength_um": round(float(np.mean(wavelengths)), 4) if wavelengths else None,
                    "n_images": len(used.rows),
                    "releases": sorted({r["release"] for r in used.rows}),
                    "obs_ids": sorted({r["obs_id"] for r in used.rows}),
                    "width": grid.width,
                    "height": grid.height,
                    "wcs": grid.header_cards(),
                    "unit": unit,
                    "filled_pixels": filled,
                    "recipe": recipes[index - 1],
                }
                await asyncio.to_thread(save_product, pid, image, variance, meta)
            else:
                image, _, meta = await asyncio.to_thread(load_product, pid)

            if group.stretch_key not in stretches:
                stretches[group.stretch_key] = percent_stretch([image], options.trim)
            vmin, vmax = stretches[group.stretch_key]
            yield frame_message(pid, meta, vmin, vmax, options.softening)
            yield {"type": "progress", "frames_ready": index, "frames_total": len(groups)}
    finally:
        for group_tasks in tasks.values():
            for task in group_tasks:
                task.cancel()  # the browser went away: stop downloading

    yield {"type": "done", "frames_total": len(groups), "images_failed": failed,
           "failure_reasons": dict(failure_reasons)}
