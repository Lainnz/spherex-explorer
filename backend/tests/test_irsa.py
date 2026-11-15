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


def test_request_limit_works_across_event_loops(monkeypatch):
    """Scripts and tests run each request in a new event loop; the limiter must cope,
    even when requests have to wait their turn."""
    monkeypatch.setattr(irsa.settings, "irsa_concurrency", 1)

    async def busy():
        async def one():
            async with irsa._limit():
                await asyncio.sleep(0.01)
        await asyncio.gather(*(one() for _ in range(3)))

    asyncio.run(busy())
    asyncio.run(busy())  # failed before: "bound to a different event loop"


def test_identical_searches_at_the_same_time_share_one_irsa_request(monkeypatch):
    calls = []

    async def slow_fetch(collection, ra, dec, radius_deg):
        calls.append(collection)
        await asyncio.sleep(0.05)
        return fixture_bytes("sia_barnard_spherex_dr1.xml")

    monkeypatch.setattr(irsa, "fetch_sia", slow_fetch)

    async def two_at_once():
        return await asyncio.gather(
            irsa.search_collection("spherex_dr1", "dr1", "wide", 269.452, 4.693, 0.01),
            irsa.search_collection("spherex_dr1", "dr1", "wide", 269.452, 4.693, 0.01),
        )

    first, second = asyncio.run(two_at_once())
    assert calls == ["spherex_dr1"]
    assert first == second and len(first) == 31


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
