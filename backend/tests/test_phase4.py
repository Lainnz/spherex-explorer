import io
import json
import math

import numpy as np
import pytest
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from fastapi.testclient import TestClient
from PIL import Image

from app import objects
from app.config import load_datasets
from app.flags import flag_definitions
from app.main import app
from app.photometry import aperture_weights, bin_spectrum, measure
from conftest import fixture_bytes

client = TestClient(app)
CUTOUT = fixture_bytes("cutout_barnard_dr1_d3.fits")
BAD_FLAGS = load_datasets()["flags_default_exclude"]
MEASURE = {"aperture_px": 2.0, "annulus_px": (4.0, 7.0), "exclude_flags": BAD_FLAGS, "pixel_scale_arcsec": 6.15}


def brightest_unflagged_star():
    """Sky position of the brightest clean star in the fixture cutout (away from the edges)."""
    with fits.open(io.BytesIO(CUTOUT)) as hdul:
        image = hdul["IMAGE"].data - hdul["ZODI"].data
        inner = np.full(image.shape, -np.inf)
        inner[10:-10, 10:-10] = image[10:-10, 10:-10]
        y, x = np.unravel_index(np.argmax(inner), image.shape)
        ra, dec = WCS(hdul["IMAGE"].header).pixel_to_world_values(x, y)
    return float(ra), float(dec)


def test_aperture_weights_cover_the_circle_area():
    weights = aperture_weights((21, 21), 10.3, 9.8, 2.0)
    assert weights.sum() == pytest.approx(math.pi * 4, rel=0.03)
    assert weights[10, 10] == 1.0 and weights[0, 0] == 0.0


def test_measure_a_real_star():
    ra, dec = brightest_unflagged_star()
    point = measure(CUTOUT, ra, dec, **MEASURE)
    assert point["flux_ujy"] > 10 * point["err_ujy"] > 0  # clearly detected
    assert 1.63 < point["wavelength_um"] < 2.44  # inside detector D3's range
    assert point["bandwidth_um"] > 0


def synthetic_cutout(star_total: float, star_xy=(29.3, 30.6), psf_sigma=1.0, sky=0.1, noise=0.01, seed=3):
    """The real cutout's headers and WCS, with a flat noisy sky and one Gaussian star of
    known total brightness (in MJy/sr × pixels). (The real field is too crowded to have a
    guaranteed-empty spot: 13% of its pixels sit on stars.)"""
    rng = np.random.default_rng(seed)
    with fits.open(io.BytesIO(CUTOUT)) as hdul:
        shape = hdul["IMAGE"].data.shape
        rows, cols = np.indices(shape)
        star = star_total * np.exp(-((cols - star_xy[0]) ** 2 + (rows - star_xy[1]) ** 2) / (2 * psf_sigma**2))
        star /= 2 * np.pi * psf_sigma**2
        hdul["IMAGE"].data = (sky + star + rng.normal(0, noise, shape)).astype(np.float32)
        hdul["ZODI"].data = np.zeros(shape, np.float32)
        hdul["VARIANCE"].data = np.full(shape, noise**2, np.float32)
        hdul["FLAGS"].data = np.zeros(shape, np.int32)
        buffer = io.BytesIO()
        hdul.writeto(buffer)
        wcs = WCS(hdul["IMAGE"].header)
    ra, dec = wcs.pixel_to_world_values(*star_xy)
    return buffer.getvalue(), float(ra), float(dec), star


def test_measure_recovers_a_known_star():
    content, ra, dec, star = synthetic_cutout(star_total=50.0)
    point = measure(content, ra, dec, **MEASURE)
    to_ujy = (6.15 / 206264.806) ** 2 * 1e12
    # The light of the fake star that falls inside the same 2-pixel circle (~86%).
    expected = float(np.sum(aperture_weights(star.shape, 29.3, 30.6, 2.0) * star)) * to_ujy
    assert expected == pytest.approx(50.0 * (1 - math.exp(-2)) * to_ujy, rel=0.05)
    assert abs(point["flux_ujy"] - expected) < 3 * point["err_ujy"]


def test_missing_pixels_outside_the_circle_dont_spoil_the_measurement():
    content, ra, dec, _ = synthetic_cutout(star_total=50.0)
    with fits.open(io.BytesIO(content)) as hdul:
        hdul["IMAGE"].data[0:3, :] = np.nan  # e.g. the edge of a cutout
        hdul["VARIANCE"].data[0:3, :] = np.nan
        buffer = io.BytesIO()
        hdul.writeto(buffer)
    point = measure(buffer.getvalue(), ra, dec, **MEASURE)
    assert math.isfinite(point["flux_ujy"]) and math.isfinite(point["err_ujy"])
    assert not point["flagged"]


def test_saturated_star_reports_no_value():
    content, ra, dec, _ = synthetic_cutout(star_total=50.0)
    with fits.open(io.BytesIO(content)) as hdul:
        overflow = 1 << flag_definitions(hdul["FLAGS"].header)["OVERFLOW"]["bit"]
        hdul["FLAGS"].data[30:32, 28:31] = overflow  # the star's centre overflowed
        buffer = io.BytesIO()
        hdul.writeto(buffer)
    point = measure(buffer.getvalue(), ra, dec, **MEASURE)
    assert point["saturated"] and point["flagged"]
    assert point["flux_ujy"] is None and point["err_ujy"] is None
    assert "OVERFLOW" in point["bad_flags_in_aperture"]


def saturated_star(total: float, seed: int) -> tuple[bytes, float, float]:
    """A bright star with broad wings (two Gaussians) whose centre overflowed."""
    content, ra, dec, _ = synthetic_cutout(star_total=0.0, seed=seed)
    with fits.open(io.BytesIO(content)) as hdul:
        rows, cols = np.indices(hdul["IMAGE"].data.shape)
        r2 = (cols - 29.3) ** 2 + (rows - 30.6) ** 2
        core = 0.9 * np.exp(-r2 / 2) / (2 * np.pi)
        wings = 0.1 * np.exp(-r2 / (2 * 3.0**2)) / (2 * np.pi * 9)
        hdul["IMAGE"].data = hdul["IMAGE"].data + (total * (core + wings)).astype(np.float32)
        overflow = 1 << flag_definitions(hdul["FLAGS"].header)["OVERFLOW"]["bit"]
        hdul["FLAGS"].data[r2 <= 2.5**2] = overflow  # a brighter star would overflow more, too
        buffer = io.BytesIO()
        hdul.writeto(buffer)
    return buffer.getvalue(), ra, dec


def test_wing_level_tracks_brightness_of_a_saturated_star():
    faint, ra, dec = saturated_star(total=5000.0, seed=1)
    bright, _, _ = saturated_star(total=10000.0, seed=2)
    a, b = measure(faint, ra, dec, **MEASURE), measure(bright, ra, dec, **MEASURE)
    assert a["saturated"] and a["flux_ujy"] is None
    assert b["wing_mjy_sr"] / a["wing_mjy_sr"] == pytest.approx(2.0, rel=0.03)


def test_relative_light_curve_normalises_per_detector():
    from app.photometry import relative_light_curve

    points = [
        {"detector": 1, "t_mid": 1.0, "wing_mjy_sr": 2.0, "wing_err_mjy_sr": 0.1},
        {"detector": 1, "t_mid": 2.0, "wing_mjy_sr": 4.0, "wing_err_mjy_sr": 0.1},
        {"detector": 1, "t_mid": 3.0, "wing_mjy_sr": 3.0, "wing_err_mjy_sr": 0.1},
        {"detector": 6, "t_mid": 1.5, "wing_mjy_sr": 100.0, "wing_err_mjy_sr": 1.0},
        {"detector": 6, "t_mid": 2.5, "wing_mjy_sr": None, "wing_err_mjy_sr": None},
    ]
    curve = relative_light_curve(points)
    assert [round(c["relative"], 3) for c in curve if c["detector"] == 1] == [0.667, 1.333, 1.0]
    assert [c["relative"] for c in curve if c["detector"] == 6] == [1.0]


def test_relative_light_curve_removes_the_colour_trend_of_a_steady_star():
    from app.photometry import relative_light_curve

    # A steady red star: brighter at longer wavelengths only, never in time.
    points = [{"detector": 1, "t_mid": float(i), "wavelength_um": wl, "wing_mjy_sr": 2.0 * math.exp(4 * wl),
               "wing_err_mjy_sr": 0.01} for i, wl in enumerate([0.75, 0.80, 0.85, 0.95, 1.00, 1.05])]
    curve = relative_light_curve(points)
    assert all(c["colour_corrected"] for c in curve)
    assert all(c["relative"] == pytest.approx(1.0, abs=1e-6) for c in curve)


def test_measure_empty_sky_is_about_zero():
    content, ra, dec, _ = synthetic_cutout(star_total=0.0)
    point = measure(content, ra, dec, **MEASURE)
    assert abs(point["flux_ujy"]) < 3 * point["err_ujy"]
    assert not point["flagged"]


def test_measure_off_the_cutout_returns_none():
    assert measure(CUTOUT, 269.452, 5.5, **MEASURE) is None


def test_bin_spectrum_averages_by_channel():
    points = [
        {"wavelength_um": 1.001, "flux_ujy": 10.0, "err_ujy": 1.0},
        {"wavelength_um": 1.003, "flux_ujy": 20.0, "err_ujy": 1.0},
        {"wavelength_um": 2.000, "flux_ujy": 5.0, "err_ujy": 2.0},
    ]
    channels = load_datasets()["allsky_cube"]["wavelengths_um"]
    binned = bin_spectrum(points, channels)
    assert len(binned) == 2
    assert binned[0]["flux_ujy"] == pytest.approx(15.0) and binned[0]["n_points"] == 2
    assert binned[0]["err_ujy"] == pytest.approx(1 / math.sqrt(2))


def test_photometry_stream(fake_cutouts):
    ra, dec = brightest_unflagged_star()
    response = client.post("/api/photometry", json={"ra": ra, "dec": dec, "fov_arcsec": 300, "detectors": [3]})
    messages = [json.loads(line) for line in response.text.splitlines()]
    assert messages[0]["type"] == "start" and "approximate" in messages[0]["method"]
    points = [m for m in messages if m["type"] == "point"]
    assert points and messages[-1]["points"] == len(points) and messages[-1]["skipped"] == 0
    assert all(p["detector"] == 3 and p["flux_ujy"] > 0 for p in points)
    assert all("saturated" in p and "bad_flags_in_aperture" in p for p in points)
    assert messages[-1]["saturated"] == sum(p["saturated"] for p in points)
    assert isinstance(messages[-1]["relative_light_curve"], list)


def test_photometry_rejects_bad_apertures():
    response = client.post("/api/photometry", json={"ra": 1, "dec": 1, "aperture_px": 5, "annulus_px": [4, 7]})
    assert response.json()["error"] == "bad_aperture"


# ---------- click-to-identify ----------

BARNARD_SIMBAD = {
    "oid": 1, "main_id": "NAME Barnard's star", "ra": 269.452077, "dec": 4.693365, "otype": "BY*",
    "sp_type": "M4V", "pmra": -801.551, "pmdec": 10362.394, "plx_value": 546.9759, "plx_err": 0.0401,
    "rvz_radvel": -110.11, "type_name": "BY Dra Variable", "V": 9.511, "G": 8.19, "J": 5.24, "K": 4.52,
}
BARNARD_SIMBAD["motion"] = {"ra": 269.452077, "dec": 4.693365, "epoch": 2000.0, "pmra": -801.551,
                            "pmdec": 10362.394, "parallax": 546.9759, "rv": -110.11}
MJD_2026 = Time(2026.0, format="jyear").mjd


def test_clean_name():
    assert objects.clean_name("NAME Barnard's star") == "Barnard's star"
    assert objects.clean_name("V* R Dra") == "R Dra"
    assert objects.clean_name("*  eps Ind B") == "eps Ind B"
    assert objects.clean_name("Gaia DR3 123") == "Gaia DR3 123"


def test_fast_mover_is_found_at_its_viewing_date_position():
    ra_2026, dec_2026 = objects.position_at(BARNARD_SIMBAD["motion"], MJD_2026)
    found = objects.nearest([BARNARD_SIMBAD], ra_2026, dec_2026, MJD_2026, 10)
    assert found and found["separation_arcsec"] < 0.5
    # Without moving it, the catalogue spot is ~270″ away and wouldn't match.
    assert objects.separation_arcsec(ra_2026, dec_2026, BARNARD_SIMBAD["ra"], BARNARD_SIMBAD["dec"]) > 250


def test_distance_light_years():
    assert objects.distance_light_years(546.9759, 0.0401)["value"] == pytest.approx(5.96, abs=0.01)
    assert objects.distance_light_years(1.0, 0.5) is None  # too uncertain
    assert objects.distance_light_years(None, None) is None


def test_identify_combines_simbad_and_gaia(monkeypatch):
    ra, dec = objects.position_at(BARNARD_SIMBAD["motion"], MJD_2026)
    gaia_row = {"source_id": 4472832130942575872, "ra": 269.44850, "dec": 4.73942, "ref_epoch": 2016.0,
                "phot_g_mean_mag": 8.19, "bp_rp": 2.83, "parallax": 546.98, "parallax_error": 0.04,
                "pm": 10393.3, "pmra": -801.55, "pmdec": 10362.39, "radial_velocity": -110.47}
    gaia_row["motion"] = {"ra": gaia_row["ra"], "dec": gaia_row["dec"], "epoch": 2016.0, "pmra": -801.55,
                          "pmdec": 10362.39, "parallax": 546.98, "rv": -110.47}
    monkeypatch.setattr(objects, "simbad_candidates", lambda *a: [BARNARD_SIMBAD])
    monkeypatch.setattr(objects, "gaia_candidates", lambda *a: [gaia_row])
    monkeypatch.setattr(objects, "simbad_other_names", lambda oid: ["Barnard's star", "GJ 699", "V2500 Oph"])
    monkeypatch.setattr(objects, "simbad_gaia_id", lambda oid: 4472832130942575872)
    answer = objects.identify(ra, dec, 10, MJD_2026)
    assert answer["name"] == "Barnard's star"
    assert answer["other_names"] == ["GJ 699", "V2500 Oph"]
    assert answer["distance_ly"]["value"] == pytest.approx(5.96, abs=0.01)
    assert answer["proper_motion_arcsec_per_year"] == pytest.approx(10.393, abs=0.01)
    assert "starspots" in answer["what_is_this"]
    assert answer["sources"] == ["SIMBAD", "Gaia DR3"]


def test_identify_never_pairs_simbad_object_with_a_different_gaia_star(monkeypatch):
    # WISE 0855 is invisible to Gaia; an unrelated background star sits a few arcsec away.
    wise = {**BARNARD_SIMBAD, "oid": 2, "main_id": "WISEA J085510.74-071442.5", "otype": "BD*",
            "type_name": "Brown Dwarf", "plx_value": 439.0, "plx_err": 2.4}
    wise["motion"] = {**BARNARD_SIMBAD["motion"]}
    ra, dec = objects.position_at(wise["motion"], MJD_2026)
    background = {"source_id": 999, "ra": ra + 0.8 / 3600, "dec": dec, "ref_epoch": 2016.0,
                  "phot_g_mean_mag": 16.3, "bp_rp": 1.0, "parallax": 0.29, "parallax_error": 0.05,
                  "pm": 6.0, "pmra": 5.0, "pmdec": 3.0, "radial_velocity": None}
    # 0.8″ away (close enough to fool a position-only match) but moving completely differently.
    background["motion"] = {"ra": ra + 0.8 / 3600 - 5.0 / 1000 / 3600 * 10, "dec": dec - 3.0 / 1000 / 3600 * 10,
                            "epoch": 2016.0, "pmra": 5.0, "pmdec": 3.0, "parallax": 0.29, "rv": None}
    monkeypatch.setattr(objects, "simbad_candidates", lambda *a: [wise])
    monkeypatch.setattr(objects, "gaia_candidates", lambda *a: [background])
    monkeypatch.setattr(objects, "simbad_other_names", lambda oid: ["WISE J085510.83-071442.5"])
    monkeypatch.setattr(objects, "simbad_gaia_id", lambda oid: None)
    answer = objects.identify(ra, dec, 10, MJD_2026)
    assert answer["sources"] == ["SIMBAD"]
    assert answer["distance_ly"]["value"] == pytest.approx(7.43, abs=0.01)  # from SIMBAD's parallax


def test_identify_accepts_a_gaia_star_that_moves_like_the_simbad_object(monkeypatch):
    # Like RW Aur: SIMBAD lists no Gaia DR3 id, but Gaia has it 0.5″ away with the same motion.
    rw = {"oid": 3, "main_id": "V* RW Aur", "ra": 76.956526, "dec": 30.401438, "otype": "TT*",
          "sp_type": "K1/5e+K5e", "pmra": 7.23, "pmdec": -20.33, "plx_value": 15.42, "plx_err": 3.69,
          "rvz_radvel": 15.0, "type_name": "T Tauri Star", "V": 9.6, "G": None, "J": None, "K": None}
    rw["motion"] = {"ra": rw["ra"], "dec": rw["dec"], "epoch": 2000.0, "pmra": 7.23, "pmdec": -20.33,
                    "parallax": 15.42, "rv": 15.0}
    ra, dec = objects.position_at(rw["motion"], MJD_2026)
    gaia_rw = {"source_id": 156, "ra": ra, "dec": dec + 0.5 / 3600, "ref_epoch": 2016.0,
               "phot_g_mean_mag": 13.04, "bp_rp": 1.5, "parallax": 5.45, "parallax_error": 0.33,
               "pm": 22.0, "pmra": 8.0, "pmdec": -20.5, "radial_velocity": None}
    gaia_rw["motion"] = {"ra": ra, "dec": dec + 0.5 / 3600, "epoch": 2026.0, "pmra": 8.0, "pmdec": -20.5,
                         "parallax": 5.45, "rv": None}
    monkeypatch.setattr(objects, "simbad_candidates", lambda *a: [rw])
    monkeypatch.setattr(objects, "gaia_candidates", lambda *a: [gaia_rw])
    monkeypatch.setattr(objects, "simbad_other_names", lambda oid: [])
    monkeypatch.setattr(objects, "simbad_gaia_id", lambda oid: None)
    answer = objects.identify(ra, dec, 10, MJD_2026)
    assert answer["sources"] == ["SIMBAD", "Gaia DR3"]
    assert answer["distance_ly"]["value"] == pytest.approx(598, abs=1)  # Gaia's parallax


def test_motions_agree():
    slow = {"pmra": 7.23, "pmdec": -20.33}
    assert objects.motions_agree(slow, {"pmra": 8.0, "pmdec": -20.5})
    assert not objects.motions_agree({"pmra": -8123.7, "pmdec": 673.2}, {"pmra": 5.0, "pmdec": 3.0})
    assert objects.motions_agree({"pmra": None, "pmdec": None}, {"pmra": 1.0, "pmdec": 1.0})


def test_identify_nothing_there(monkeypatch):
    monkeypatch.setattr(objects, "simbad_candidates", lambda *a: [])
    monkeypatch.setattr(objects, "gaia_candidates", lambda *a: [])
    assert objects.identify(10.0, 10.0, 5, MJD_2026)["found"] is False


def test_identify_when_catalogues_are_down(monkeypatch):
    def down(*args):
        raise objects.ResolverUnavailable("down")

    monkeypatch.setattr(objects, "simbad_candidates", down)
    monkeypatch.setattr(objects, "gaia_candidates", down)
    response = client.get("/api/object", params={"ra": 10, "dec": 10})
    assert response.status_code == 503


# ---------- flags and metadata ----------

def test_flags_and_meta_for_a_listed_image(fake_cutouts):
    listing = client.get("/api/observations", params={"ra": 269.452, "dec": 4.693, "detectors": "3"}).json()
    image = listing["observations"][0]
    params = {"detector": 3, "ra": 269.452, "dec": 4.693, "fov_arcsec": 300}

    flags = client.get(f"/api/flags/{image['obs_id']}", params=params).json()
    assert flags["quality"] in ("Good", "Use with care", "Poor")
    by_name = {f["name"]: f for f in flags["flags"]}
    assert by_name["FULLSAMPLE"]["info_only"] and not by_name["FULLSAMPLE"]["is_bad_pixel_flag"]
    assert by_name["HOT"]["label"].startswith("Hot pixel")
    mask = client.get(by_name["SOURCE"]["mask_url"])
    assert mask.status_code == 200 and Image.open(io.BytesIO(mask.content)).mode == "RGBA"

    meta = client.get(f"/api/meta/{image['obs_id']}", params=params).json()
    assert meta["release"] == image["release"] and meta["pipeline_version"] == "7.0.5"
    assert meta["exposure_s"] > 0
    assert ["IMAGE", "DETECTOR", 3] == [c for c in meta["header"] if c[1] == "DETECTOR"][0][:3]


def test_flags_for_an_unlisted_image():
    response = client.get("/api/flags/NOT_AN_IMAGE", params={"detector": 1})
    assert response.status_code == 404 and response.json()["error"] == "unknown_image"
