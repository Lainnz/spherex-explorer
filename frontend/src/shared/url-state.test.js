import { describe, expect, it } from 'vitest';
import { buildStellarUrl, readStellarState, stellarParams } from './url-state.js';

const CONTEXT = {
  limits: { min_fov_arcsec: 30, max_fov_arcsec: 3600 },
  releases: ['dr1', 'qr3'],
  skyMaps: ['spherex_cube', 'spherex_color', 'wise_color', 'unwise', 'twomass'],
};
const read = (search) => readStellarState(search, CONTEXT);

describe('buildStellarUrl', () => {
  it('puts coordinates, target and field of view first', () => {
    expect(buildStellarUrl({ ra: 269.452077, dec: 4.693365, fov: 600, target: 'barnards-star' }))
      .toBe('stellar.html?ra=269.45208&dec=4.69337&target=barnards-star&fov=600');
  });

  it('only mentions detectors when not all six are chosen', () => {
    expect(buildStellarUrl({ ra: 1, dec: 2, detectors: [1, 2, 3, 4, 5, 6] })).toBe('stellar.html?ra=1.00000&dec=2.00000');
    expect(buildStellarUrl({ ra: 1, dec: 2, detectors: [5, 6] })).toContain('det=5%2C6');
  });
});

describe('every example from PLAN.md §8.4', () => {
  it('target by slug or name', () => {
    expect(read('?target=barnards-star').state.target).toBe('barnards-star');
    expect(read("?target=Barnard's%20Star").state.target).toBe("Barnard's Star");
  });

  it('ra/dec (and they win over a target)', () => {
    const { state } = read('?ra=133.79513&dec=-7.24515&target=wise-0855');
    expect(state).toMatchObject({ ra: 133.79513, dec: -7.24515, target: 'wise-0855' });
  });

  it('coords in any format', () => {
    const { state } = read('?coords=08h55m10.831s-07d14m42.53s');
    expect(state.ra).toBeCloseTo(133.79513, 4);
    expect(state.dec).toBeCloseTo(-7.24515, 4);
  });

  it('fov in arcsec, arcmin and degrees', () => {
    expect(read('?fov=600').state.fov).toBe(600);
    expect(read('?fov=600s').state.fov).toBe(600);
    expect(read('?fov=10m').state.fov).toBe(600);
    expect(read('?fov=0.25d').state.fov).toBe(900);
  });

  it('rot, t, det, wl, mode', () => {
    const { state, notices } = read('?rot=30&t=2026-03-14&det=1,2,3&wl=3.3&mode=white');
    expect(state).toMatchObject({ rot: 30, t: '2026-03-14', det: [1, 2, 3], wl: 3.3, mode: 'white' });
    expect(notices).toEqual([]);
  });

  it('operations and display settings', () => {
    const { state } = read('?op=diff&a=3&b=1&cmap=gray&stretch=percent&trim=99.5');
    expect(state).toMatchObject({ op: 'diff', a: 3, b: 1, cmap: 'gray', stretch: 'percent', trim: 99.5 });
  });

  it('layers', () => {
    const { state } = read('?base=spherex_cube&overlay=wise_color&opacity=0.4&cat=gaia');
    expect(state).toMatchObject({ base: 'spherex_cube', overlay: 'wise_color', opacity: 0.4, cat: ['gaia'] });
  });

  it('release, autoplay, speed, embed, demo', () => {
    const { state } = read('?release=dr1,qr3&autoplay=1&speed=2&embed=1&demo=1');
    expect(state).toMatchObject({ release: ['dr1', 'qr3'], autoplay: true, speed: 2, embed: true, demo: true });
  });
});

describe('bad values fall back with a notice, never crash', () => {
  it.each([
    ['?ra=400&dec=10', /RA must be/],
    ['?ra=10', /both given/],
    ['?coords=nonsense', /coords/],
    ['?fov=big', /fov/],
    ['?t=yesterday', /2026-03-14/],
    ['?det=0,7', /1 to 6/],
    ['?wl=9', /0.75–5.0/],
    ['?mode=fast', /epoch, white, exposure/],
    ['?cmap=rainbow', /gray/],
    ['?speed=3', /0.25/],
    ['?base=hubble', /spherex_cube/],
    ['?opacity=2', /between 0 and 1/],
    ['?cat=sdss', /gaia/],
    ['?release=qr2', /dr1, qr3/],
  ])('%s', (search, pattern) => {
    const { state, notices } = read(search);
    expect(notices.join(' ')).toMatch(pattern);
    expect(state.base).toBeDefined(); // defaults are still there
  });

  it('limits the field of view', () => {
    const { state, notices } = read('?fov=5d');
    expect(state.fov).toBe(3600);
    expect(notices[0]).toMatch(/limited/);
  });
});

describe('round trip', () => {
  it('reading what we wrote gives the same state', () => {
    const original = read('?ra=269.45208&dec=4.69337&target=barnards-star&fov=300&rot=30&t=2026-03-14&det=1,2' +
      '&wl=1.43&mode=white&op=diff&a=3&b=1&cmap=inferno&trim=99&base=wise_color&overlay=spherex_cube&opacity=0.4' +
      '&cat=gaia,allwise&release=dr1&autoplay=1&speed=2&embed=1&demo=1').state;
    expect(read(`?${stellarParams(original)}`).state).toEqual(original);
  });
});
