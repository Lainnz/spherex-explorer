import math

import numpy as np
import pytest
from astropy.time import Time

from app.epochs import assign_visits, mjd_to_date, sample_evenly
from app.motion import has_motion, position_at, propagate

# Barnard's Star from SIMBAD (Harvard mirror), 2026-11-14.
BARNARD = {
    "ra": 269.452077, "dec": 4.693365, "epoch": 2000.0,
    "pmra": -801.551, "pmdec": 10362.394, "parallax": 546.9759, "rv": -110.11,
}


def test_barnard_has_moved_about_4_arcminutes_by_2025():
    ra, dec = position_at(BARNARD, Time("2025-08-15").mjd)
    # ~10.36″/yr north for 25.6 years ≈ 266″; RA drifts the other way, slowly.
    assert (dec - BARNARD["dec"]) * 3600 == pytest.approx(266, abs=2)
    assert (ra - BARNARD["ra"]) * 3600 * math.cos(math.radians(dec)) == pytest.approx(-20.5, abs=1)


def test_propagate_many_dates_moves_steadily():
    dates = Time(["2025-08-15", "2026-08-15"]).mjd
    _, dec = propagate(BARNARD, dates)
    assert (dec[1] - dec[0]) * 3600 == pytest.approx(10.36, abs=0.1)


def test_unknown_distance_still_works():
    no_distance = {**BARNARD, "parallax": None, "rv": None}
    _, dec = position_at(no_distance, Time("2025-08-15").mjd)
    assert (dec - BARNARD["dec"]) * 3600 == pytest.approx(266, abs=2)


def test_has_motion():
    assert has_motion(BARNARD)
    assert not has_motion(None)
    assert not has_motion({**BARNARD, "pmra": None})


def test_visits_split_on_gaps():
    # MJD 60902.5 = 2025-08-15
    rows = [{"t_mid": 60900 + t} for t in (2.5, 4.0, 5.5, 190.0, 191.0, 400.0)]
    visits = assign_visits(rows, gap_days=20)
    assert [v["n_images"] for v in visits] == [3, 2, 1]
    assert [r["visit"] for r in rows] == [1, 1, 1, 2, 2, 3]
    assert visits[0]["label"] == "Visit 1 · 2025-08-15 → 2025-08-18"
    assert visits[2]["label"] == f"Visit 3 · {mjd_to_date(61300.0)}"


def test_visits_sort_rows_first():
    rows = [{"t_mid": t} for t in (61200.0, 61000.0, 61001.0)]
    assign_visits(rows, gap_days=20)
    assert [r["t_mid"] for r in rows] == [61000.0, 61001.0, 61200.0]


def test_sample_evenly_keeps_first_last_and_count():
    rows = [{"t_mid": float(i)} for i in range(1000)]
    picked = sample_evenly(rows, 80)
    assert len(picked) == 80
    assert picked[0]["t_mid"] == 0 and picked[-1]["t_mid"] == 999
    gaps = np.diff([r["t_mid"] for r in picked])
    assert gaps.max() - gaps.min() <= 1


def test_sample_evenly_leaves_small_lists_alone():
    rows = [{"t_mid": 1.0}, {"t_mid": 2.0}]
    assert sample_evenly(rows, 80) is rows
