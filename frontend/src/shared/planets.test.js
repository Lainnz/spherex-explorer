import { describe, expect, it } from 'vitest';
import {
  changesSince, compareWithEarth, earthSimilarity, filterPlanets, habitableZone, inHabitableZone, insolation,
  planetSnapshot, sizeClass, toPlanet,
} from './planets.js';
import { readStellarState, stellarParams } from './url-state.js';

const COLUMNS = ['pl_name', 'hostname', 'ra', 'dec', 'sy_dist', 'pl_rade', 'pl_bmasse', 'pl_dens', 'pl_eqt', 'pl_insol',
  'pl_orbper', 'pl_orbsmax', 'st_teff', 'st_lum', 'st_spectype', 'sy_snum', 'sy_pnum', 'disc_year', 'discoverymethod'];
const twin = toPlanet(COLUMNS, ['Twin b', 'Twin', 1, 2, 3.0663, 1, 1, null, 255, 1, 365.25, 1, 5772, 0, 'G2 V', 1, 1, 2030, 'Transit']);
const hot = toPlanet(COLUMNS, ['WASP-39 b', 'WASP-39', 217.3, -3.44, 213, 14.3, 89, null, 1166, null, 4.06, 0.0486, 5400, -0.1, 'G8', 1, 1, 2011, 'Transit']);

describe('habitable zone (Kopparapu et al.)', () => {
  it('gives the published solar limits at 5780 K', () => {
    expect(habitableZone(5780)).toEqual({ inner: 1.107, outer: 0.356 });
  });
  it('only covers 2600–7200 K stars', () => {
    expect(habitableZone(2500)).toBeNull();
    expect(habitableZone(8000)).toBeNull();
  });
  it('puts an Earth twin inside and a hot Jupiter outside', () => {
    expect(inHabitableZone(twin)).toBe(true);
    expect(inHabitableZone(hot)).toBe(false);
  });
  it('works out starlight from luminosity and orbit when the archive has none', () => {
    expect(insolation(hot)).toBeCloseTo(10 ** -0.1 / 0.0486 ** 2, 6);
  });
});

describe('Earth Similarity Index', () => {
  it('is high for an Earth twin (the temperature stand-in costs a little) and low for a hot Jupiter', () => {
    expect(earthSimilarity(twin).value).toBeGreaterThan(0.9);
    expect(earthSimilarity(hot).value).toBeLessThan(0.2);
  });
  it('uses only the properties that are known', () => {
    const radiusOnly = { ...twin, mass: null, density: null };
    expect(earthSimilarity(radiusOnly).parts.map((p) => p.id)).toEqual(['radius', 'temperature']);
    expect(earthSimilarity({ ...radiusOnly, eqTemp: null })).toBeNull();
  });
});

describe('comparison with Earth', () => {
  it('finds the twin similar in everything measured', () => {
    expect(compareWithEarth(twin).every((row) => row.similar)).toBe(true);
  });
  it('explains how a hot Jupiter differs', () => {
    const rows = compareWithEarth(hot);
    expect(rows.find((r) => r.label === 'Size').similar).toBe(false);
    expect(rows.find((r) => r.label === 'Density').note).toMatch(/water, ice or gas/);
  });
  it('knows the size classes', () => {
    expect(sizeClass(1).id).toBe('earth');
    expect(sizeClass(1.5).id).toBe('super');
    expect(sizeClass(14.3).id).toBe('jupiter');
  });
});

describe('filters and saved planets', () => {
  it('filters by habitable zone and by measured molecules (published list)', () => {
    expect(filterPlanets([hot, twin], { habitable: true }).map((p) => p.name)).toEqual(['Twin b']);
    expect(filterPlanets([hot, twin], { molecule: 'so2' }).map((p) => p.name)).toEqual(['WASP-39 b']);
    expect(filterPlanets([hot, twin], {})[0].name).toBe('Twin b'); // most Earth-like first
  });
  it('reports what the archive changed since a planet was saved', () => {
    const snapshot = planetSnapshot(twin);
    expect(changesSince(snapshot, twin)).toEqual([]);
    expect(changesSince(snapshot, { ...twin, radius: 1.1 })[0]).toMatch(/Radius/);
  });
  it('keeps the open planet in the address', () => {
    const context = { limits: { min_fov_arcsec: 30, max_fov_arcsec: 3600 }, releases: ['dr1'], skyMaps: ['spherex_rgb'] };
    const { state } = readStellarState('?ra=10&dec=20&planet=K2-18%20b', context);
    expect(state.planet).toBe('K2-18 b');
    expect(stellarParams(state).get('planet')).toBe('K2-18 b');
  });
});
