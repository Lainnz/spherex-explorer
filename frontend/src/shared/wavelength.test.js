import { describe, expect, it } from 'vitest';
import { BLANK_PLANES, CUBE_WAVELENGTHS, describePlane, detectorOfPlane, planeForWavelength } from './wavelength.js';

describe('cube wavelengths', () => {
  it('has 102 planes from 0.753 to 4.988 µm', () => {
    expect(CUBE_WAVELENGTHS).toHaveLength(102);
    expect(CUBE_WAVELENGTHS[0]).toBe(0.753);
    expect(CUBE_WAVELENGTHS[101]).toBe(4.988);
  });

  it('finds the nearest plane and skips the blank ones', () => {
    expect(planeForWavelength(0.753)).toBe(0);
    expect(planeForWavelength(3.3)).toBe(CUBE_WAVELENGTHS.findIndex((w) => w === 3.293));
    // Planes 50 (2.399 µm) and 51 (2.445 µm) are blank, so nearby wavelengths go elsewhere.
    expect(BLANK_PLANES.has(planeForWavelength(2.4))).toBe(false);
    expect(BLANK_PLANES.has(planeForWavelength(2.445))).toBe(false);
  });

  it('knows which detector a plane belongs to', () => {
    expect(detectorOfPlane(0)).toBe(1);
    expect(detectorOfPlane(16)).toBe(1);
    expect(detectorOfPlane(17)).toBe(2);
    expect(detectorOfPlane(101)).toBe(6);
    expect(describePlane(17)).toBe('1.11 µm · D2 channel 1'); // plane 17 = 1.113 µm
  });
});
