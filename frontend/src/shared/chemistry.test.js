import { describe, expect, it } from 'vitest';
import { BANDS, chemistryQuery, findTargets, formatPercent, INGREDIENTS, measureFeature, TARGETS } from './chemistry.js';
import { readStellarState, stellarParams } from './url-state.js';

const CONTEXT = { limits: { min_fov_arcsec: 30, max_fov_arcsec: 3600 }, releases: ['dr1', 'qr3'], skyMaps: ['spherex_rgb'] };

describe('the curated list', () => {
  it('cites a source and gives a position (or a name to look up) for every place', () => {
    for (const target of TARGETS) {
      expect(target.references.length).toBeGreaterThan(0);
      expect((target.ra != null && target.dec != null) || Boolean(target.resolve)).toBe(true);
      for (const id of Object.keys(target.ingredients)) expect(INGREDIENTS[id]).toBeDefined();
    }
  });
});

describe('chemistryQuery (search box words)', () => {
  it('reads ingredient words', () => {
    expect(chemistryQuery('water ice')).toEqual({ ingredients: ['h2o_ice'], match: 'all' });
    expect(chemistryQuery('Carbon dioxide')).toEqual({ ingredients: ['co2_ice'], match: 'all' });
    expect(chemistryQuery('signs of pre-life').preset).toBe('prelife');
  });
  it("doesn't treat 'carbon dioxide' as organic carbon", () => {
    expect(chemistryQuery('carbon dioxide').ingredients).not.toContain('pah');
    expect(chemistryQuery('carbon').match).toBe('any');
  });
  it('leaves star names alone', () => {
    expect(chemistryQuery("Barnard's Star")).toBeNull();
    expect(chemistryQuery('M 82')).toBeNull();
  });
});

describe('findTargets', () => {
  it('lists SPHEREx results first and respects all / any', () => {
    const both = findTargets({ ingredients: ['h2o_ice', 'co2_ice'] });
    expect(both[0].spherex_result).toBe(true);
    expect(both.every((t) => t.ingredients.h2o_ice && t.ingredients.co2_ice)).toBe(true);
    const either = findTargets({ ingredients: ['ch3oh_ice', 'pah'], match: 'any' });
    expect(either.every((t) => t.ingredients.ch3oh_ice || t.ingredients.pah)).toBe(true);
  });
  it('pre-life = water ice plus organic carbon', () => {
    for (const t of findTargets({ preset: 'prelife' })) {
      expect(t.ingredients.h2o_ice).toBeDefined();
      expect(Boolean(t.ingredients.ch3oh_ice || t.ingredients.pah || t.ingredients.aliphatic)).toBe(true);
    }
  });
  it('formats published amounts', () => {
    expect(formatPercent([10, 20])).toBe('10–20%');
    expect(formatPercent(18)).toBe('18%');
    expect(formatPercent(undefined)).toBe('');
  });
});

describe('measureFeature (live SPHEREx check)', () => {
  const spectrum = (dip) => {
    const points = [];
    for (let w = 2.4; w <= 4.9; w += 0.005) {
      const inBand = w >= BANDS.h2o_ice.band[0] && w <= BANDS.h2o_ice.band[1];
      points.push({ wavelength_um: w, flux_ujy: 100 * (inBand ? 1 - dip : 1) + Math.sin(w * 97) * 2, err_ujy: 2 });
    }
    return points;
  };
  it('recovers the optical depth of a water-ice dip', () => {
    const result = measureFeature(spectrum(0.3), 'h2o_ice');
    expect(result.value).toBeCloseTo(Math.log(1 / 0.7), 1);
    expect(result.detected).toBe(true);
  });
  it("doesn't claim ice in a flat spectrum", () => {
    expect(measureFeature(spectrum(0), 'h2o_ice').detected).toBe(false);
  });
  it('says when there are too few measurements', () => {
    expect(measureFeature([], 'co2_ice').missing).toMatch(/measurement/);
    expect(measureFeature([], 'ch3oh_ice').missing).toMatch(/not measurable/);
  });
});

describe('find= in the address', () => {
  it('round-trips a chemistry search', () => {
    const { state } = readStellarState('?ra=10&dec=20&find=prelife,h2o_ice,pah&match=any', CONTEXT);
    expect(state.find).toEqual({ ingredients: ['h2o_ice', 'pah'], match: 'any', preset: 'prelife' });
    expect(stellarParams(state).get('find')).toBe('prelife,h2o_ice,pah');
    expect(stellarParams(state).get('match')).toBe('any');
  });
  it('ignores unknown ingredients with a notice', () => {
    const { state, notices } = readStellarState('?ra=10&dec=20&find=unobtainium', CONTEXT);
    expect(state.find).toBeUndefined();
    expect(notices.join(' ')).toMatch(/find/);
  });
});
