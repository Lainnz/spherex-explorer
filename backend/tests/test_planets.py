"""The planets list (NASA Exoplanet Archive) is cached and survives the archive being down.
No network: the archive call is replaced by a fake."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import planets
from app.main import app

ROW = ["TRAPPIST-1 e", "TRAPPIST-1", 346.6, -5.04, 12.4, 0.92, 0.69, 4.9, 250, 0.65, 6.1, 0.029, 2566, -3.26, "M8 V", 1, 7, 2017, "Transit"]


def test_fetches_once_then_serves_the_saved_copy():
    calls = []

    def fake_fetch():
        calls.append(1)
        return [ROW]

    first = planets.load_planets(fetch=fake_fetch, now=lambda: 1000.0)
    second = planets.load_planets(fetch=fake_fetch, now=lambda: 2000.0)
    assert first["rows"] == [ROW] and second["rows"] == [ROW]
    assert first["columns"] == planets.COLUMNS
    assert len(calls) == 1
    assert second["stale"] is False


def test_serves_a_stale_copy_when_the_archive_is_down():
    planets.load_planets(fetch=lambda: [ROW], now=lambda: 0.0)

    def broken():
        raise httpx.ConnectError("down")

    result = planets.load_planets(fetch=broken, now=lambda: planets.FRESH_SECONDS + 10.0)
    assert result["stale"] is True
    assert "didn't answer" in result["warning"]


def test_says_so_when_there_is_no_copy_yet():
    def broken():
        raise httpx.ConnectError("down")

    with pytest.raises(planets.PlanetsUnavailable):
        planets.load_planets(fetch=broken)


def test_api_route_returns_friendly_error_when_unavailable(monkeypatch):
    def broken():
        raise httpx.ConnectError("down")

    monkeypatch.setattr(planets, "fetch_archive", broken)
    response = TestClient(app).get("/api/planets")
    assert response.status_code == 503
    assert response.json()["error"] == "planets_unavailable"


def test_api_route_serves_rows(monkeypatch):
    monkeypatch.setattr(planets, "fetch_archive", lambda: [ROW])
    body = TestClient(app).get("/api/planets").json()
    assert body["rows"][0][0] == "TRAPPIST-1 e"
    assert body["columns"][0] == "pl_name"
