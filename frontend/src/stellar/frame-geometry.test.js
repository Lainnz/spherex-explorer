import { describe, expect, it } from 'vitest';
import { frameCorners, imageTransform, positionAt, skyToTanPixel, tanPixelToSky, valueAt } from './frame-geometry.js';

// A 49 × 49 grid like the server makes for Barnard's Star (6.15″ pixels, north up).
const WCS = { CRVAL1: 269.446, CRVAL2: 4.768, CRPIX1: 25, CRPIX2: 25, CDELT1: -6.15 / 3600, CDELT2: 6.15 / 3600 };

describe('tanPixelToSky', () => {
  it('puts the reference pixel at the centre', () => {
    const centre = tanPixelToSky(WCS, 24, 24); // 0-based 24 = 1-based 25
    expect(centre.ra).toBeCloseTo(269.446, 9);
    expect(centre.dec).toBeCloseTo(4.768, 9);
  });

  it('has east on the left and north up', () => {
    const left = tanPixelToSky(WCS, 0, 24);
    const up = tanPixelToSky(WCS, 24, 48);
    expect(left.ra).toBeGreaterThan(269.446); // further east = larger RA
    expect(up.dec).toBeGreaterThan(4.768);
    // 24 pixels × 6.15″ = 147.6″ north
    expect((up.dec - 4.768) * 3600).toBeCloseTo(147.6, 1);
  });
});

describe('frame placement', () => {
  it('finds the corners of the drawn picture', () => {
    const { topLeft, topRight, bottomLeft } = frameCorners(WCS, 49, 49);
    expect(topLeft.dec).toBeGreaterThan(bottomLeft.dec);
    expect(topLeft.ra).toBeGreaterThan(topRight.ra);
  });

  it('builds the canvas transform from three screen corners', () => {
    // A 10 × 20 picture drawn twice its size and shifted by (5, 7).
    const t = imageTransform({ x: 5, y: 7 }, { x: 25, y: 7 }, { x: 5, y: 47 }, 10, 20);
    expect(t).toEqual([2, 0, 0, 2, 5, 7]);
  });
});

describe('positionAt', () => {
  it("moves Barnard's Star about 266″ north by August 2025", () => {
    const barnard = { ra: 269.452077, dec: 4.693365, epoch: 2000, pmra: -801.551, pmdec: 10362.394 };
    const mjd = 60902.865; // 2025-08-15
    const { dec } = positionAt(barnard, mjd);
    expect((dec - barnard.dec) * 3600).toBeCloseTo(265.5, 0);
  });
});

describe('skyToTanPixel and valueAt (brightness at the target)', () => {
  it('undoes tanPixelToSky', () => {
    for (const [x, y] of [[0, 0], [24, 24], [48, 10], [7, 40]]) {
      const sky = tanPixelToSky(WCS, x, y);
      const pixel = skyToTanPixel(WCS, sky.ra, sky.dec);
      expect(pixel.x).toBeCloseTo(x, 6);
      expect(pixel.y).toBeCloseTo(y, 6);
    }
  });

  it('reads the 3×3 median around the spot, north up', () => {
    const data = new Float32Array(49 * 49).fill(0);
    const spot = tanPixelToSky(WCS, 10, 40); // FITS row 40 = picture row 8
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) data[(8 + dy) * 49 + 10 + dx] = 5;
    data[8 * 49 + 10] = 1000; // one hot pixel doesn't decide it
    expect(valueAt({ data, width: 49, height: 49, wcs: WCS }, spot.ra, spot.dec)).toBe(5);
  });

  it('gives null outside the frame', () => {
    const data = new Float32Array(49 * 49).fill(1);
    expect(valueAt({ data, width: 49, height: 49, wcs: WCS }, 270.5, 4.768)).toBeNull();
  });
});
