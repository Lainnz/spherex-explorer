import { describe, expect, it } from 'vitest';
import { angleAround, angleDifference, formatAngle, parseRegion, separationArcsec } from './nav-math.js';

describe('rotation helpers', () => {
  it('measures angles around the centre (screen y points down)', () => {
    expect(angleAround(100, 100, 200, 100)).toBe(0);
    expect(angleAround(100, 100, 100, 200)).toBe(90);
    expect(angleAround(100, 100, 0, 100)).toBe(180);
  });

  it('takes the short way round', () => {
    expect(angleDifference(10, 350)).toBe(20);
    expect(angleDifference(350, 10)).toBe(-20);
    expect(angleDifference(-170, 170)).toBe(20);
  });
});

describe('sky distances', () => {
  it('measures arcseconds', () => {
    expect(separationArcsec(10, 0, 10, 1)).toBeCloseTo(3600, 6);
    expect(separationArcsec(10, 60, 11, 60)).toBeCloseTo(1800, 0); // cos 60° = 0.5
    expect(separationArcsec(0, 0, 0, 0)).toBe(0);
  });

  it('formats in the friendliest unit', () => {
    expect(formatAngle(45)).toBe('45″');
    expect(formatAngle(192)).toBe('3.2′');
    expect(formatAngle(5400)).toBe('1.5°');
  });
});

describe('parseRegion', () => {
  it('reads a real IRSA footprint', () => {
    // From the saved SIA answer for Barnard's Star (DR1, 2026-11-14).
    const corners = parseRegion('POLYGON ICRS 266.69818339020907 5.472469522295728 270.1773378537016 ' +
      '5.149486050441448 269.9973138381142 1.660074934294828 266.5011710028342 1.9904353173956755 ' +
      '266.69818339020907 5.472469522295728');
    expect(corners).toHaveLength(4); // the repeated closing corner is dropped
    expect(corners[0]).toEqual([266.69818339020907, 5.472469522295728]);
  });

  it('rejects anything that is not a polygon', () => {
    expect(parseRegion('CIRCLE ICRS 10 20 1')).toBeNull();
    expect(parseRegion('POLYGON 1 2 3')).toBeNull();
    expect(parseRegion(undefined)).toBeNull();
  });
});
