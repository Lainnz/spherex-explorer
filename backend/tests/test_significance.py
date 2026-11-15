"""Elaine's significance check, now in Alice's products (A − B in standard deviations)."""
import numpy as np

from app.products import significance


def test_pure_noise_gives_a_noise_check_near_one_and_no_5_sigma_pixels():
    rng = np.random.default_rng(1)
    shape = (60, 60)
    a, b = rng.normal(0, 1, shape), rng.normal(0, 1, shape)
    ones = np.ones(shape)
    sigma, summary = significance(a, ones, b, ones, normalize=False)
    assert sigma.shape == shape
    assert 0.85 < summary["noise_check"] < 1.1  # noise estimate is right
    assert summary["pixels_over_5_sigma"] == 0
    assert summary["usable_pixels"] == 3600


def test_a_real_brightening_stands_out():
    shape = (20, 20)
    b = np.zeros(shape)
    a = np.zeros(shape)
    a[10, 10] = 30.0  # 30 units brighter; noise per pixel is 1
    ones = np.ones(shape)
    sigma, summary = significance(a, ones, b, ones, normalize=False)
    assert sigma[10, 10] > 5
    assert summary["pixels_over_5_sigma"] == 1


def test_bright_stars_are_not_called_significant_for_small_relative_changes():
    shape = (10, 10)
    b = np.full(shape, 1000.0)
    a = b * 1.03  # 3% brighter: inside the 10% allowance for star-shape/alignment effects
    ones = np.ones(shape)
    _, summary = significance(a, ones, b, ones, normalize=False)
    assert summary["pixels_over_5_sigma"] == 0


def test_blank_pixels_are_left_out():
    a = np.array([[1.0, np.nan]])
    b = np.array([[0.0, 0.0]])
    ones = np.ones((1, 2))
    _, summary = significance(a, ones, b, ones, normalize=False)
    assert summary["usable_pixels"] == 1
