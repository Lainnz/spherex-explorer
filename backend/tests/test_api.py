from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok_and_releases():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["releases"] == ["dr1", "qr3"]


def test_config_serves_datasets_json():
    body = client.get("/api/config").json()
    assert [d["id"] for d in body["detectors"]] == ["D1", "D2", "D3", "D4", "D5", "D6"]
    assert body["allsky_cube"]["depth"] == len(body["allsky_cube"]["wavelengths_um"]) == 102


def test_cors_allows_local_dev_site():
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_ignores_unknown_sites():
    response = client.get("/api/health", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in response.headers
