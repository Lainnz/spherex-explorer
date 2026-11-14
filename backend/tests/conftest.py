"""Shared test setup: a throwaway cache, and fake IRSA answers from real saved responses.

The fixtures in tests/fixtures/ are real IRSA SIA answers for Barnard's Star
(RA 269.452, Dec 4.693, radius 0.1°) saved on 2026-11-14, trimmed to every 9th row.
"""
from pathlib import Path

import pytest

from app import irsa
from app.cache import get_cache
from app.settings import settings

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.fixture(autouse=True)
def temporary_cache(tmp_path, monkeypatch):
    """Each test gets an empty cache, so nothing leaks between tests or from real runs."""
    monkeypatch.setattr(settings, "cache_dir", tmp_path / "cache")
    get_cache.cache_clear()
    yield
    get_cache().close()
    get_cache.cache_clear()


@pytest.fixture
def fake_irsa(monkeypatch):
    """Replace the network call with saved answers; records which collections were asked for."""
    calls = []
    answers = {
        "spherex_dr1": fixture_bytes("sia_barnard_spherex_dr1.xml"),
        "spherex_qr3": fixture_bytes("sia_barnard_spherex_qr3.xml"),
    }

    async def fake_fetch(collection, ra, dec, radius_deg):
        calls.append(collection)
        return answers.get(collection, fixture_bytes("sia_empty.xml"))

    monkeypatch.setattr(irsa, "fetch_sia", fake_fetch)
    return calls
