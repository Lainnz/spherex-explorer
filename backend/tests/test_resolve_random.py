import numpy as np

from app import resolve as resolve_module
from app.config import load_targets
from app.random_target import random_target, uniform_sky_position
from app.resolve import find_featured, normalize, resolve


def test_normalize_ignores_case_spaces_and_punctuation():
    assert normalize("Barnard's Star") == normalize("barnards-star") == normalize(" BARNARDS STAR ")


def test_featured_targets_resolve_without_simbad(monkeypatch):
    def no_network(name):
        raise AssertionError("featured targets must not call SIMBAD")

    monkeypatch.setattr(resolve_module, "simbad_lookup", no_network)
    for name in ["Barnard's Star", "barnards-star", "eps Ind B", "WISE 0855", "RW Aur", "r-draconis"]:
        assert resolve(name)["source"] == "featured", name


def test_wise_0855_keeps_team_coordinates_and_simbad_motion():
    target = find_featured("WISE 0855")
    # 08h55m10.831s −07d14m42.53s, exactly as the team gave it.
    assert target["ra"] == round((8 + 55 / 60 + 10.831 / 3600) * 15, 7)
    assert target["dec"] == round(-(7 + 14 / 60 + 42.53 / 3600), 7)
    assert target["motion"]["epoch"] == 2000.0
    assert target["motion"]["pmra"] < -8000  # moves fast, westward


def test_unknown_names_go_to_simbad_and_are_cached(monkeypatch):
    calls = []

    def fake_lookup(name):
        calls.append(name)
        return None

    monkeypatch.setattr(resolve_module, "simbad_lookup", fake_lookup)
    assert resolve("Not A Real Star") is None
    assert resolve("not a real star") is None
    assert calls == ["Not A Real Star"]


def test_uniform_positions_cover_the_sphere_evenly():
    rng = np.random.default_rng(42)
    decs = np.array([uniform_sky_position(rng)[1] for _ in range(20000)])
    # Half the sky's area lies within 30° of the equator (sin 30° = 0.5).
    assert abs(np.mean(np.abs(decs) < 30) - 0.5) < 0.02
    assert decs.min() >= -90 and decs.max() <= 90


def test_random_target_sometimes_picks_interesting_spots():
    targets = load_targets()
    rng = np.random.default_rng(7)
    picks = [random_target(targets["interesting"], targets["targets"], 600, rng) for _ in range(400)]
    share = np.mean([p["source"] == "interesting" for p in picks])
    assert 0.18 < share < 0.32
    for pick in picks:
        assert 0 <= pick["ra"] < 360 and -90 <= pick["dec"] <= 90 and pick["fov_arcsec"] > 0
