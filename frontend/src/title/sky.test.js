import { describe, expect, it } from 'vitest';
import { greenwichSiderealDegrees, skyDirection, sunPosition } from './sky.js';

describe('sky helpers', () => {
  it('puts the Sun at the solstice declination in late December', () => {
    const { ra, dec } = sunPosition(new Date(Date.UTC(2026, 11, 21, 12)));
    expect(dec).toBeCloseTo(-23.44, 1);
    expect(ra).toBeCloseTo(270, 0);
  });

  it('puts the Sun near RA 0 at the March equinox', () => {
    const { ra, dec } = sunPosition(new Date(Date.UTC(2026, 2, 20, 14, 46)));
    expect(Math.abs(dec)).toBeLessThan(0.1);
    expect(Math.min(ra, 360 - ra)).toBeLessThan(0.2);
  });

  it('knows the sidereal angle at the J2000 epoch', () => {
    expect(greenwichSiderealDegrees(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(280.46, 2);
  });

  it('points north for Dec +90 and toward RA 270 along −z', () => {
    expect(skyDirection(0, 90)[1]).toBeCloseTo(1, 6);
    const [x, y, z] = skyDirection(270, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });
});
