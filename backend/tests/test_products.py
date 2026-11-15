import io
import json

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient
from PIL import Image

from app.config import load_datasets
from app.flags import exclusion_mask, flag_definitions
from app.grid import make_grid, to_grid
from app.main import app
from app.products import difference, ivw_mean, median_stack, white_merge
from app.render import percent_stretch, stretch_to_unit, to_f32, to_png
from conftest import fixture_bytes

client = TestClient(app)
CUTOUT = "cutout_barnard_dr1_d3.fits"  # real DR1 D3 cutout, 2025-08-15, EPSF table removed
BAD_FLAGS = load_datasets()["flags_default_exclude"]


def test_flag_definitions_from_real_header():
    with fits.open(io.BytesIO(fixture_bytes(CUTOUT))) as hdul:
        definitions = flag_definitions(hdul["FLAGS"].header)
    assert len(definitions) == 22
    assert definitions["HOT"] == {"bit": 10, "description": "Hot pixel"}
    mask = exclusion_mask(definitions, BAD_FLAGS)
    assert mask & (1 << 10)  # HOT is bad
    assert not mask & (1 << 12)  # FULLSAMPLE is information, not a problem
    assert not mask & (1 << 21)  # SOURCE just means "a known star is here"


def test_real_cutout_onto_grid():
    grid = make_grid(269.452, 4.693, 300, 6.15)
    assert grid.shape == (49, 49)
    result = to_grid(fixture_bytes(CUTOUT), grid, 269.452, 4.693, BAD_FLAGS)
    assert result.image.shape == grid.shape
    # Most pixels are good; flagged ones become NaN.
    assert 0.5 < np.isfinite(result.image).mean() <= 1.0
    assert result.wavelength_um == pytest.approx(2.288, abs=0.01)  # D3, checked in Phase 0
    assert np.nanmedian(result.image) == pytest.approx(0, abs=0.01)  # background removed


def test_ivw_mean_weights_quiet_pixels_more():
    a, b = np.full((2, 2), 1.0), np.full((2, 2), 3.0)
    mean, variance = ivw_mean([a, b], [np.full((2, 2), 1.0), np.full((2, 2), 3.0)])
    assert mean[0, 0] == pytest.approx(1.5)  # (1/1 + 3/3) / (1 + 1/3)
    assert variance[0, 0] == pytest.approx(0.75)


def test_ivw_mean_skips_nan_and_keeps_all_nan_pixels_nan():
    a = np.array([[np.nan, 2.0]])
    mean, _ = ivw_mean([a, np.array([[np.nan, 4.0]])], [np.ones((1, 2)), np.ones((1, 2))])
    assert np.isnan(mean[0, 0]) and mean[0, 1] == pytest.approx(3.0)


def test_fill_flagged_closes_holes_only_where_every_image_is_flagged():
    from app.frames import coadd
    from app.grid import GridImage

    def image(value, flagged):
        good = np.full((1, 2), value)
        masked = good.copy()
        masked[0, flagged] = np.nan  # e.g. a saturated star core
        return GridImage(masked, np.ones((1, 2)), good, np.ones((1, 2)), np.zeros((1, 2), int), None, None, {})

    images = [image(1.0, [0]), image(3.0, [0, 1])]
    mean, variance, filled = coadd(images, fill_flagged=True)
    assert filled == 1
    assert mean[0, 1] == pytest.approx(1.0)  # good pixel from image 1 only
    assert mean[0, 0] == pytest.approx(1.0)  # hole takes its brightest good neighbour
    assert np.isnan(variance[0, 0])  # ...but stays "unmeasured" for stacks and photometry
    assert np.isnan(coadd(images, fill_flagged=False)[0][0, 0])


def test_median_removes_something_that_moves():
    frames = [np.zeros((5, 5)) for _ in range(5)]
    for i, frame in enumerate(frames):
        frame[2, i] = 100.0  # a "star" moving one pixel per frame
    template, _ = median_stack(frames, [np.ones((5, 5))] * 5)
    assert np.all(template == 0)


def test_difference_gives_a_pair_for_a_mover():
    a, b = np.zeros((3, 3)), np.zeros((3, 3))
    a[1, 2], b[1, 0] = 10.0, 10.0
    diff, variance = difference(a, np.ones((3, 3)), b, np.ones((3, 3)), normalize=False)
    assert diff[1, 2] == 10 and diff[1, 0] == -10 and variance[0, 0] == 2


def test_white_merge_is_in_noise_units():
    rng = np.random.default_rng(1)
    images = [rng.normal(0, s, (50, 50)) for s in (1.0, 10.0, 100.0)]
    merged, _ = white_merge(images, [np.ones((50, 50))] * 3)
    assert np.nanstd(merged) == pytest.approx(1.0, abs=0.15)


def test_png_and_f32_are_north_up():
    image = np.zeros((4, 3))
    image[3, 0] = 1.0  # FITS row 3 = top (north)
    picture = np.array(Image.open(io.BytesIO(to_png(stretch_to_unit(image, 0, 1)))))
    assert picture.shape == (4, 3) and picture[0, 0] == 255
    raw = np.frombuffer(to_f32(image), dtype="<f4").reshape(4, 3)
    assert raw[0, 0] == 1.0


def test_percent_stretch_ignores_nan():
    vmin, vmax = percent_stretch([np.array([np.nan, 0.0, 1.0, 2.0])], trim=100)
    assert (vmin, vmax) == (0.0, 2.0)


def stream_frames(body: dict) -> list[dict]:
    response = client.post("/api/frames", json=body)
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_frames_stream_and_products(fake_cutouts):
    messages = stream_frames({"ra": 269.452, "dec": 4.693, "fov_arcsec": 300, "detectors": [3]})
    assert messages[0]["type"] == "start" and messages[-1]["type"] == "done"
    frames = [m for m in messages if m["type"] == "frame"]
    assert len(frames) == messages[0]["frames_total"] >= 2
    assert all(f["detectors"] == [3] and f["width"] == 49 for f in frames)
    assert all(f["obs_ids"] for f in frames)  # the Info tab needs to know which images
    # All D3 frames share one brightness range, so blinking is fair.
    assert len({(f["vmin"], f["vmax"]) for f in frames}) == 1

    png = client.get(frames[0]["png_url"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(png.content)).size == (49, 49)
    assert len(client.get(frames[0]["f32_url"]).content) == 49 * 49 * 4
    with fits.open(io.BytesIO(client.get(frames[0]["fits_url"]).content)) as hdul:
        assert hdul[0].header["CTYPE1"] == "RA---TAN"

    ids = [f["frame_id"] for f in frames]
    stack = client.post("/api/stack", json={"frame_ids": ids, "method": "median"}).json()
    diff = client.post("/api/difference", json={"a": ids[-1], "b": stack["frame_id"]}).json()
    assert client.get(diff["png_url"]).status_code == 200
    colour = client.post("/api/composite", json={"red": ids[0], "green": ids[1], "blue": ids[-1]}).json()
    assert Image.open(io.BytesIO(client.get(colour["png_url"]).content)).mode == "RGB"

    # Asking again reuses the saved frames: nothing new to download.
    again = stream_frames({"ra": 269.452, "dec": 4.693, "fov_arcsec": 300, "detectors": [3]})
    assert again[0]["images_to_download"] == 0
    assert [m["frame_id"] for m in again if m["type"] == "frame"] == ids


def test_failed_images_are_reported_and_retried(fake_irsa, monkeypatch):
    from app import irsa

    calls = {"n": 0}

    async def flaky_fetch(access_url, ra, dec, size_deg):
        calls["n"] += 1
        if calls["n"] % 2 == 0:
            raise irsa.IrsaUnavailable("IRSA answered HTTP 502")
        return fixture_bytes(CUTOUT)

    monkeypatch.setattr(irsa, "fetch_cutout", flaky_fetch)
    body = {"ra": 269.452, "dec": 4.693, "fov_arcsec": 300, "detectors": [3]}
    first = stream_frames(body)
    assert first[-1]["images_failed"] > 0
    assert "IrsaUnavailable: IRSA answered HTTP 502" in first[-1]["failure_reasons"]

    async def good_fetch(access_url, ra, dec, size_deg):
        return fixture_bytes(CUTOUT)

    monkeypatch.setattr(irsa, "fetch_cutout", good_fetch)
    second = stream_frames(body)
    # Incomplete frames weren't saved as complete ones, so they're rebuilt with every image.
    assert second[0]["images_to_download"] > 0 and second[-1]["images_failed"] == 0


def test_white_and_exposure_modes(fake_cutouts):
    white = [m for m in stream_frames({"ra": 269.452, "dec": 4.693, "fov_arcsec": 300, "mode": "white"})
             if m["type"] == "frame"]
    assert white and all(f["unit"].startswith("signal-to-noise") for f in white)
    exposure = stream_frames({"ra": 269.452, "dec": 4.693, "fov_arcsec": 300, "mode": "exposure",
                              "detectors": [3], "max_images": 4})
    frames = [m for m in exposure if m["type"] == "frame"]
    assert all(f["n_images"] == 1 for f in frames) and len(frames) <= 4


def test_bad_product_ids_are_refused():
    assert client.get("/api/product/..%5C..%5Csecrets.png").status_code == 404
    assert client.get("/api/product/doesnotexist.png").status_code == 404
