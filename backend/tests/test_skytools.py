"""Elaine's sky tools (app/skytools) are served by the merged app without clashing with ours.

Only requests that are rejected before any network call are made here, so these tests
stay offline like the rest of the suite.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_sky_tool_routes_are_registered():
    paths = {route.path for route in app.routes}
    for path in [
        "/api/hips/spherex/channels",
        "/api/hips/spherex-rgb/{frames}/properties",
        "/api/hips/spherex-rgb/{frames}/{path:path}",
        "/api/spherex/timeline",
        "/api/spherex/spectrum",
        "/api/spherex/compare",
        "/api/catalogs/{name}",
        "/api/identify",
    ]:
        assert path in paths, path


def test_no_two_routes_share_an_address():
    seen = [(route.path, tuple(sorted(getattr(route, "methods", None) or []))) for route in app.routes]
    assert len(seen) == len(set(seen))


def test_false_colour_map_needs_three_frames():
    assert client.get("/api/hips/spherex-rgb/90-46/properties").status_code == 404
    assert client.get("/api/hips/spherex-rgb/90-46-999/properties").status_code == 404


def test_unknown_catalogue_is_refused():
    response = client.get("/api/catalogs/hubble", params={"ra": 10, "dec": 20})
    assert response.status_code == 404


def test_sky_tools_reject_impossible_coordinates():
    response = client.get("/api/identify", params={"ra": 400, "dec": 0})
    assert response.status_code == 422
