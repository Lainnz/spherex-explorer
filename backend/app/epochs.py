"""Grouping images into "visits" (PLAN.md §7.5).

SPHEREx comes back to each part of the sky about every 6 months and takes several
images over a few days. Images closer together in time than `gap_days` are one visit.

Deep Fields (near the ecliptic poles, e.g. R Draconis) are observed almost constantly,
so gaps never appear; there, `max_span_days` cuts the timeline into fixed windows.
"""
import numpy as np
from astropy.time import Time


def mjd_to_date(mjd: float) -> str:
    """MJD → "2025-08-15" (UTC)."""
    return Time(mjd, format="mjd").to_value("iso", subfmt="date")


def assign_visits(rows: list[dict], gap_days: float, max_span_days: float | None = None) -> list[dict]:
    """Sort rows by time, add a 1-based `visit` number to each, and summarise the visits.

    A new visit starts after a gap longer than `gap_days`, or (if given) once the current
    visit already spans `max_span_days`.

    Returns one summary per visit: number, start/end MJD, image count and a label like
    "Visit 2 · 2025-11-03 → 2025-11-12".
    """
    rows.sort(key=lambda row: row["t_mid"])
    visits: list[dict] = []
    for row in rows:
        if (
            not visits
            or row["t_mid"] - visits[-1]["t_end"] > gap_days
            or (max_span_days is not None and row["t_mid"] - visits[-1]["t_start"] > max_span_days)
        ):
            visits.append({"visit": len(visits) + 1, "t_start": row["t_mid"], "t_end": row["t_mid"], "n_images": 0})
        current = visits[-1]
        current["t_end"] = row["t_mid"]
        current["n_images"] += 1
        row["visit"] = current["visit"]

    for visit in visits:
        start, end = mjd_to_date(visit["t_start"]), mjd_to_date(visit["t_end"])
        dates = start if start == end else f"{start} → {end}"
        visit["label"] = f"Visit {visit['visit']} · {dates}"
    return visits


def sample_evenly(rows: list[dict], max_images: int) -> list[dict]:
    """Keep at most `max_images` rows, spread evenly in time order.

    Deep Field targets can have thousands of images; this keeps requests small while
    still covering the whole time range. Rows must already be sorted by time.
    """
    if len(rows) <= max_images:
        return rows
    picks = np.unique(np.linspace(0, len(rows) - 1, max_images).round().astype(int))
    return [rows[i] for i in picks]
