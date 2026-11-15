import { describe, expect, it } from 'vitest';
import { clampFov, formatFov, parseFov } from './fov.js';

describe('parseFov', () => {
  it('treats plain numbers as arcseconds', () => {
    expect(parseFov('600')).toBe(600);
    expect(parseFov(600)).toBe(600);
  });

  it('understands the URL suffixes s, m and d', () => {
    expect(parseFov('600s')).toBe(600);
    expect(parseFov('10m')).toBe(600);
    expect(parseFov('0.25d')).toBe(900);
  });

  it('understands symbols and words', () => {
    expect(parseFov('45″')).toBe(45);
    expect(parseFov("10'")).toBe(600);
    expect(parseFov('1°')).toBe(3600);
    expect(parseFov(' 2 arcmin ')).toBe(120);
  });

  it('rejects nonsense instead of crashing', () => {
    for (const bad of ['', 'abc', '-5', '0', '10x', '1.2.3', null, undefined, NaN]) {
      expect(parseFov(bad)).toBeNull();
    }
  });
});

describe('clampFov', () => {
  const limits = { min_fov_arcsec: 30, max_fov_arcsec: 3600 };
  it('keeps values inside the allowed range', () => {
    expect(clampFov(5, limits)).toBe(30);
    expect(clampFov(600, limits)).toBe(600);
    expect(clampFov(99999, limits)).toBe(3600);
  });
});

describe('formatFov', () => {
  it('picks a readable unit', () => {
    expect(formatFov(45)).toBe('45″');
    expect(formatFov(600)).toBe('10′');
    expect(formatFov(900)).toBe('15′');
    expect(formatFov(3600)).toBe('1°');
  });
});
