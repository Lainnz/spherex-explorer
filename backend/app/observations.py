"""Building the list of SPHEREx images for one patch of sky (GET /api/observations).

Steps: search IRSA → remove duplicates → filter by detector and date → keep at most
`max_images`, spread evenly in time → group into visits → work out where a moving
target was in each image.
"""
from astropy.time import Time

from . import irsa
from .cache import DAY, get_cache
from .epochs import assign_visits, mjd_to_date, sample_evenly
from .motion import has_motion, position_at, propagate

# Search a small circle so every image found actually contains the target. 0.01° (36″)
# also covers a fast mover's few-arcsecond yearly motion.
SEARCH_RADIUS_DEG = 0.01
# When a target moves, search where it was in the middle of the SPHEREx mission so far.
SEARCH_EPOCH = Time(2026.0, format="jyear").mjd


def deduplicate(rows: list[dict], priorities: dict[str, int]) -> list[dict]:
    """If the same image appears in two releases, keep the one with the best priority (DR1)."""
    best: dict[tuple[str, int], dict] = {}
    for row in rows:
        key = (row["obs_id"], row["detector"])
        kept = best.get(key)
        if kept is None or priorities[row["release"]] < priorities[kept["release"]]:
            best[key] = row
    return list(best.values())


def image_key(obs_id: str, detector: int) -> str:
    return f"image:{obs_id}:D{detector}"


def remember_images(rows: list[dict]) -> None:
    """Keep each listed image's details, so /api/flags and /api/meta can find it by
    obs_id + detector without a slow new search (and without trusting URLs from browsers)."""
    cache = get_cache()
    with cache.transact():
        for row in rows:
            cache.set(image_key(row["obs_id"], row["detector"]), row, expire=30 * DAY)


def recall_image(obs_id: str, detector: int) -> dict | None:
    return get_cache().get(image_key(obs_id, detector))


def search_position(ra: float, dec: float, motion: dict | None) -> tuple[float, float]:
    """Where to search: the target's mid-mission position if it moves, otherwise (ra, dec)."""
    if has_motion(motion):
        return position_at(motion, SEARCH_EPOCH)
    return ra, dec


async def find_observations(
    *,
    ra: float,
    dec: float,
    fov_arcsec: float,
    release_ids: list[str],
    detectors: list[int],
    tmin_mjd: float | None,
    tmax_mjd: float | None,
    max_images: int,
    motion: dict | None,
    datasets: dict,
) -> dict:
    """The images covering a position, grouped into visits. See PLAN.md §7.2."""
    releases = {rid: datasets["releases"][rid] for rid in release_ids}
    search_ra, search_dec = search_position(ra, dec, motion)
    rows = await irsa.search_releases(releases, search_ra, search_dec, SEARCH_RADIUS_DEG)

    priorities = {rid: release["priority"] for rid, release in releases.items()}
    rows = [
        row
        for row in deduplicate(rows, priorities)
        if row["detector"] in detectors
        and (tmin_mjd is None or row["t_mid"] >= tmin_mjd)
        and (tmax_mjd is None or row["t_mid"] <= tmax_mjd)
    ]
    total_available = len(rows)
    rows.sort(key=lambda row: row["t_mid"])
    rows = sample_evenly(rows, max_images)
    deep_field = any(row["survey"] == "deep" for row in rows)
    limits = datasets["limits"]
    visits = assign_visits(
        rows, limits["epoch_gap_days"], limits["deep_field_window_days"] if deep_field else None
    )

    if rows and has_motion(motion):
        target_ra, target_dec = propagate(motion, [row["t_mid"] for row in rows])
    else:
        target_ra, target_dec = [ra] * len(rows), [dec] * len(rows)
    for row, row_ra, row_dec in zip(rows, target_ra, target_dec):
        row["t_mid_date"] = mjd_to_date(row["t_mid"])
        row["target_ra"] = round(float(row_ra), 7)
        row["target_dec"] = round(float(row_dec), 7)
    remember_images(rows)

    return {
        "query": {
            "ra": ra,
            "dec": dec,
            "search_ra": round(search_ra, 7),
            "search_dec": round(search_dec, 7),
            "fov_arcsec": fov_arcsec,
            "releases": release_ids,
            "detectors": detectors,
            "moving_target": has_motion(motion),
            "deep_field": deep_field,
        },
        "total_available": total_available,
        "returned": len(rows),
        # Each cutout is about 4 MB whatever its size, because of the EPSF table.
        "estimated_download_mb": round(len(rows) * datasets["limits"]["cutout_mb_estimate"], 1),
        "visits": visits,
        "observations": rows,
    }
