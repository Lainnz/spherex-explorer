import asyncio
import time

import numpy as np
from fastapi.testclient import TestClient

from app import irsa, random_pool
from app.main import app
from app.random_target import random_target

client = TestClient(app)


def test_randomize_prefers_pre_searched_spots():
    random_pool._save([{"ra": 12.3, "dec": -4.5, "images": 40, "warmed": time.time()}])
    # Only the uniform branch can use the pool, so ask with no famous spots to pick from.
    pick = random_target([], [], 600, np.random.default_rng(1), take_pooled=random_pool.take_spot)
    assert pick == {"ra": 12.3, "dec": -4.5, "fov_arcsec": 600, "name": None, "source": "pre-searched"}
    assert random_pool.pooled_spots() == []  # handed out once, so the next pick differs


def test_old_pool_spots_are_dropped():
    random_pool._save([{"ra": 1, "dec": 2, "images": 3, "warmed": time.time() - 25 * 86400}])
    assert random_pool.pooled_spots() == []


def test_empty_pool_falls_back_to_any_spot():
    pick = random_target([], [], 600, np.random.default_rng(2), take_pooled=random_pool.take_spot)
    assert pick["source"] == "uniform"


def test_keep_warm_fills_the_pool_and_backs_off_politely(monkeypatch):
    searches = []

    async def fake_search(ra, dec, motion=None):
        searches.append((ra, dec))
        if len(searches) == 2:
            raise irsa.IrsaUnavailable("502")  # IRSA misbehaves once
        return 7

    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(random_pool.pooled_spots()) >= 2:
            raise asyncio.CancelledError  # stop the endless loop for the test

    monkeypatch.setattr(random_pool, "search_spot", fake_search)
    monkeypatch.setattr(random_pool.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(random_pool, "load_targets", lambda: {"targets": [], "interesting": []})
    try:
        asyncio.run(random_pool.keep_warm(np.random.default_rng(3)))
    except asyncio.CancelledError:
        pass
    assert len(random_pool.pooled_spots()) == 2
    assert random_pool.BACKOFF_SECONDS in sleeps  # waited longer after IRSA refused
    assert all(-90 <= dec <= 90 for _, dec in searches)


def test_random_endpoint_uses_the_pool():
    random_pool._save([{"ra": 50.0, "dec": 10.0, "images": 12, "warmed": time.time()}])
    sources = {client.get("/api/random").json()["source"] for _ in range(20)}
    assert "pre-searched" in sources
