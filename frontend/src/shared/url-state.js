/**
 * Stellar View addresses (PLAN.md §8.4): everything about the view lives in the URL so a
 * link (or an <iframe>) reopens exactly the same thing.
 *
 * readStellarState() turns URL parameters into a checked state object; bad values fall
 * back to defaults with a plain-language notice (they never break the page).
 * buildStellarUrl() / stellarParams() turn a state back into a URL, leaving out defaults.
 */
import { parseCoordinates } from './coords.js';
import { parseFov } from './fov.js';

export const MODES = ['epoch', 'white', 'exposure'];
export const OPERATIONS = ['none', 'stack', 'diff', 'composite'];
export const COLOUR_MAPS = ['gray', 'inferno', 'viridis', 'cividis'];
export const STRETCHES = ['percent', 'fixed', 'auto'];
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
export const CATALOGUES = ['simbad', 'gaia', 'allwise'];
/** Chemistry search (Milestone 3): ingredient ids from config/chemistry.json, or a preset. */
export const FIND_PRESETS = ['prelife'];
export const FIND_INGREDIENTS = ['h2o_ice', 'co2_ice', 'co_ice', 'ch3oh_ice', 'pah', 'aliphatic'];
export const DEFAULTS = {
  // SPHEREx false colour (stars vs warm dust) opens first; see stellar/sky-view.js.
  base: 'spherex_rgb',
  mode: 'epoch',
  op: 'none',
  cmap: 'gray',
  stretch: 'percent',
  trim: 99.5,
  linear: 1,
  opacity: 0.5,
  speed: 1,
};

const numberIn = (text, min, max) => {
  if (text === null || text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
};

/**
 * @param {URLSearchParams|string} search  e.g. window.location.search
 * @param {{limits: object, releases: string[], skyMaps: string[]}} context  allowed values
 * @returns {{state: object, notices: string[]}}
 */
export function readStellarState(search, { limits, releases, skyMaps }) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const notices = [];
  const state = { ...DEFAULTS };
  const bad = (name, why) => notices.push(`Ignored "${name}=${params.get(name)}": ${why}.`);

  // Where to look: ra/dec win, then coords, then the target name (resolved by the page).
  const ra = numberIn(params.get('ra'), 0, 360);
  const dec = numberIn(params.get('dec'), -90, 90);
  if (params.has('ra') || params.has('dec')) {
    if (ra === undefined || dec === undefined || ra === null || dec === null || ra === 360) {
      notices.push('Ignored ra/dec: RA must be 0–360° and Dec −90–90°, both given.');
    } else {
      Object.assign(state, { ra, dec });
    }
  }
  if (params.has('coords') && state.ra === undefined) {
    const coords = parseCoordinates(params.get('coords'));
    if (coords) Object.assign(state, coords);
    else bad('coords', 'not coordinates we can read');
  }
  if (params.get('target')) state.target = params.get('target').slice(0, 100);

  if (params.has('fov')) {
    const fov = parseFov(params.get('fov'));
    if (fov === null) bad('fov', 'use e.g. 600, 600s, 10m or 0.25d');
    else {
      state.fov = Math.min(limits.max_fov_arcsec, Math.max(limits.min_fov_arcsec, fov));
      if (state.fov !== fov) notices.push(`Field of view limited to ${limits.min_fov_arcsec}″–${limits.max_fov_arcsec}″.`);
    }
  }

  if (params.has('rot')) {
    const rot = numberIn(params.get('rot'), -360, 360);
    if (rot == null) bad('rot', 'rotation must be −360 to 360 degrees');
    else state.rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  }

  if (params.has('t')) {
    const t = params.get('t');
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`))) state.t = t;
    else bad('t', 'dates look like 2026-03-14');
  }

  if (params.has('det')) {
    const detectors = params.get('det').split(',').map(Number);
    if (detectors.length && detectors.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
      state.det = [...new Set(detectors)].sort();
    } else bad('det', 'detectors are 1 to 6, e.g. det=1,2,3');
  }

  if (params.has('wl')) {
    const wl = numberIn(params.get('wl'), 0.7, 5.1);
    if (wl == null) bad('wl', 'SPHEREx wavelengths are 0.75–5.0 µm');
    else state.wl = wl;
  }

  const pick = (name, allowed, convert = (v) => v) => {
    if (!params.has(name)) return;
    const value = convert(params.get(name));
    if (allowed.includes(value)) state[name] = value;
    else bad(name, `choose one of ${allowed.join(', ')}`);
  };
  pick('mode', MODES);
  pick('op', OPERATIONS);
  pick('cmap', COLOUR_MAPS);
  pick('stretch', STRETCHES);
  pick('speed', SPEEDS, Number);
  pick('base', skyMaps);
  if (params.has('overlay')) {
    if (params.get('overlay') === 'none') delete state.overlay;
    else pick('overlay', skyMaps);
  }

  for (const [name, min, max] of [['a', 1, 999], ['b', 1, 999]]) {
    if (!params.has(name)) continue;
    const value = numberIn(params.get(name), min, max);
    if (value == null || !Number.isInteger(value)) bad(name, 'visit numbers start at 1');
    else state[name] = value;
  }
  for (const [name, min, max] of [['trim', 50, 100], ['linear', 0.01, 100], ['opacity', 0, 1]]) {
    if (!params.has(name)) continue;
    const value = numberIn(params.get(name), min, max);
    if (value == null) bad(name, `must be between ${min} and ${max}`);
    else state[name] = value;
  }

  if (params.has('cat')) {
    const cats = params.get('cat').split(',').filter(Boolean);
    if (cats.every((c) => CATALOGUES.includes(c))) state.cat = [...new Set(cats)];
    else bad('cat', `catalogues are ${CATALOGUES.join(', ')}`);
  }
  if (params.has('release')) {
    const chosen = params.get('release').split(',').filter(Boolean);
    if (chosen.length && chosen.every((r) => releases.includes(r))) state.release = chosen;
    else bad('release', `releases are ${releases.join(', ')}`);
  }

  // find=prelife,h2o_ice (match=any for "any of them"): open the Chemistry tab with this search.
  if (params.has('find')) {
    const words = params.get('find').split(',').filter(Boolean);
    if (words.length && words.every((w) => FIND_PRESETS.includes(w) || FIND_INGREDIENTS.includes(w))) {
      state.find = {
        ingredients: words.filter((w) => FIND_INGREDIENTS.includes(w)),
        match: params.get('match') === 'any' ? 'any' : 'all',
        ...(words.find((w) => FIND_PRESETS.includes(w)) ? { preset: words.find((w) => FIND_PRESETS.includes(w)) } : {}),
      };
    } else bad('find', `search for ${[...FIND_PRESETS, ...FIND_INGREDIENTS].join(', ')}`);
  }

  for (const flag of ['autoplay', 'embed', 'demo']) {
    if (params.has(flag)) state[flag] = params.get(flag) === '1' || params.get(flag) === 'true';
  }
  return { state, notices };
}

const round = (value, digits) => String(Math.round(value * 10 ** digits) / 10 ** digits);

/**
 * URL parameters for a state, leaving out anything at its default value.
 * Order: position, target, fov, then the rest (stable, so links are tidy).
 */
export function stellarParams(state) {
  const params = new URLSearchParams();
  if (Number.isFinite(state.ra) && Number.isFinite(state.dec)) {
    params.set('ra', state.ra.toFixed(5));
    params.set('dec', state.dec.toFixed(5));
  }
  if (state.target) params.set('target', state.target);
  if (Number.isFinite(state.fov)) params.set('fov', round(state.fov, 2));
  if (state.rot) params.set('rot', round(state.rot, 1));
  if (state.t) params.set('t', state.t);
  const detectors = state.det ?? state.detectors;
  if (detectors?.length && detectors.length < 6) params.set('det', detectors.join(','));
  if (Number.isFinite(state.wl)) params.set('wl', round(state.wl, 3));
  for (const name of ['mode', 'op', 'cmap', 'stretch', 'trim', 'linear', 'base', 'opacity', 'speed']) {
    if (state[name] !== undefined && state[name] !== DEFAULTS[name]) params.set(name, String(state[name]));
  }
  if (state.op && state.op !== 'none') {
    if (state.a) params.set('a', String(state.a));
    if (state.b) params.set('b', String(state.b));
  }
  if (state.overlay) params.set('overlay', state.overlay);
  if (state.cat?.length) params.set('cat', state.cat.join(','));
  if (state.release?.length) params.set('release', state.release.join(','));
  if (state.find && (state.find.preset || state.find.ingredients?.length)) {
    params.set('find', [...(state.find.preset ? [state.find.preset] : []), ...(state.find.ingredients ?? [])].join(','));
    if (state.find.match === 'any' && state.find.ingredients?.length > 1) params.set('match', 'any');
  }
  if (state.autoplay) params.set('autoplay', '1');
  if (state.embed) params.set('embed', '1');
  if (state.demo) params.set('demo', '1');
  return params;
}

/**
 * @param {object} state  (title page passes {ra, dec, target, fov, detectors, release})
 * @returns {string} e.g. "stellar.html?ra=269.45208&dec=4.69337&target=barnards-star&fov=600"
 */
export function buildStellarUrl(state = {}) {
  return `stellar.html?${stellarParams(state)}`;
}
