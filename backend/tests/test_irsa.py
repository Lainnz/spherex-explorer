import asyncio

import pytest

from app import irsa
from conftest import fixture_bytes


def test_parse_real_dr1_answer():
    rows = irsa.parse_sia(fixture_bytes("sia_barnard_spherex_dr1.xml"), "dr1", "wide")
    assert len(rows) == 31
    first = rows[0]
    # Values checked by hand against the saved answer.
    assert first["obs_id"] == "2025W33_2C_0321_1"
    assert first["detector"] == 6
    assert first["bandpass"] == "SPHEREx-D6"
    assert first["processing_version"] == "l2b-v27-2026-228"
    assert first["em_min_um"] == pytest.approx(4.4115)
    assert first["em_max_um"] == pytest.approx(5.0096)
    assert first["t_start"] < first["t_mid"] < first["t_end"]
    assert first["access_url"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/")
    assert {row["detector"] for row in rows} <= {1, 2, 3, 4, 5, 6}
    assert all(row["release"] == "dr1" and row["survey"] == "wide" for row in rows)


def test_parse_empty_answer_means_no_images():
    assert irsa.parse_sia(fixture_bytes("sia_empty.xml"), "dr1", "deep") == []


def test_parse_error_answer_raises():
    text = fixture_bytes("sia_empty.xml").decode().replace('value="OK"', 'value="ERROR"')
    with pytest.raises(irsa.IrsaUnavailable):
        irsa.parse_sia(text.encode(), "dr1", "wide")


def test_search_uses_every_collection_once_then_cache(fake_irsa):
    releases = {
        "dr1": {"sia_collections": {"wide": "spherex_dr1", "deep": "spherex_dr1_deep"}},
        "qr3": {"sia_collections": {"wide": "spherex_qr3", "deep": "spherex_qr3_deep"}},
    }
    rows = asyncio.run(irsa.search_releases(releases, 269.452, 4.693, 0.01))
    assert len(rows) == 31 + 15
    assert sorted(fake_irsa) == ["spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep"]

    asyncio.run(irsa.search_releases(releases, 269.452, 4.693, 0.01))
    assert len(fake_irsa) == 4, "second search should come from the cache"
