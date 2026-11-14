from fastapi.testclient import TestClient

from app import irsa
from app.main import app
from app.observations import deduplicate

client = TestClient(app)


def test_deduplicate_prefers_dr1():
    rows = [
        {"obs_id": "A", "detector": 1, "release": "qr3"},
        {"obs_id": "A", "detector": 1, "release": "dr1"},
        {"obs_id": "A", "detector": 2, "release": "qr3"},
    ]
    kept = deduplicate(rows, {"dr1": 1, "qr3": 2})
    assert sorted((r["detector"], r["release"]) for r in kept) == [(1, "dr1"), (2, "qr3")]


def test_observations_for_barnards_star(fake_irsa):
    body = client.get("/api/observations", params={"target": "barnards-star"}).json()
    assert body["total_available"] == body["returned"] == 46
    assert body["query"]["moving_target"] is True
    assert body["estimated_download_mb"] == round(46 * 4.1, 1)

    obs = body["observations"]
    times = [o["t_mid"] for o in obs]
    assert times == sorted(times)
    assert {o["release"] for o in obs} == {"dr1", "qr3"}
    # The star moves north ~10″/yr, so later images have it further north.
    assert obs[-1]["target_dec"] > obs[0]["target_dec"]
    assert (obs[0]["target_dec"] - 4.693365) * 3600 > 250

    visits = body["visits"]
    assert sum(v["n_images"] for v in visits) == 46
    assert [v["visit"] for v in visits] == list(range(1, len(visits) + 1))


def test_observation_filters(fake_irsa):
    body = client.get(
        "/api/observations",
        params={"ra": 269.452, "dec": 4.693, "detectors": "1,2", "releases": "dr1", "max_images": 5},
    ).json()
    assert body["returned"] <= 5
    assert {o["detector"] for o in body["observations"]} <= {1, 2}
    assert {o["release"] for o in body["observations"]} == {"dr1"}
    assert body["query"]["moving_target"] is False
    assert sorted(fake_irsa) == ["spherex_dr1", "spherex_dr1_deep"]


def test_date_filter(fake_irsa):
    body = client.get("/api/observations", params={"ra": 269.452, "dec": 4.693, "tmin": "2026-06-01"}).json()
    assert {o["release"] for o in body["observations"]} == {"qr3"}


def test_friendly_errors(fake_irsa):
    cases = [
        ({}, "missing_position"),
        ({"ra": 1, "dec": 2, "fov": 5}, "bad_fov"),
        ({"ra": 1, "dec": 2, "releases": "qr2"}, "bad_release"),
        ({"ra": 1, "dec": 2, "detectors": "7"}, "bad_detectors"),
        ({"ra": 1, "dec": 2, "tmin": "last tuesday"}, "bad_date"),
    ]
    for params, error in cases:
        response = client.get("/api/observations", params=params)
        assert response.status_code == 400, params
        assert response.json()["error"] == error


def test_no_coverage(monkeypatch):
    async def nothing(*args):
        return []

    monkeypatch.setattr(irsa, "search_releases", nothing)
    response = client.get("/api/observations", params={"ra": 10, "dec": 10})
    assert response.status_code == 404
    assert response.json()["error"] == "no_coverage"


def test_irsa_down(monkeypatch):
    async def down(*args):
        raise irsa.IrsaUnavailable("502")

    monkeypatch.setattr(irsa, "search_releases", down)
    response = client.get("/api/observations", params={"ra": 10, "dec": 10})
    assert response.status_code == 503
    assert response.json()["error"] == "irsa_unavailable"


def test_resolve_and_random_endpoints():
    body = client.get("/api/resolve", params={"name": "R Dra"}).json()
    assert body["slug"] == "r-draconis" and body["source"] == "featured"
    spot = client.get("/api/random").json()
    assert 0 <= spot["ra"] < 360 and -90 <= spot["dec"] <= 90
