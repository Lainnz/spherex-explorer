/**
 * The chemistry search (Milestone 3): find places where water ice, CO₂, CO, methanol
 * and organic carbon have been detected, from the curated list in config/chemistry.json
 * (every entry cites its paper), and check a spot live with SPHEREx's own spectrum.
 *
 * Pure functions only, so they can be tested without a browser.
 */
import chemistry from '../../../config/chemistry.json';

export const INGREDIENTS = chemistry.ingredients;
export const TARGETS = chemistry.targets;
export const PRESETS = chemistry.presets;
export const TYPICAL = chemistry.typical;

/**
 * Wavelength windows (µm) for the live SPHEREx check. The continuum is fitted on both
 * sides and interpolated to the band, as in Hora et al. 2026 (τ = ln(F_continuum / F_band)).
 * Methanol and the 3.4 µm C–H band are too weak or blended at SPHEREx's resolution, so they
 * are only listed from published work.
 */
export const BANDS = {
  h2o_ice: { band: [2.95, 3.15], continuum: [[2.45, 2.65], [3.75, 3.95]], type: 'absorption' },
  co2_ice: { band: [4.24, 4.30], continuum: [[4.12, 4.2], [4.36, 4.46]], type: 'absorption' },
  co_ice: { band: [4.64, 4.70], continuum: [[4.52, 4.6], [4.76, 4.86]], type: 'absorption' },
  // Continuum at 2.77 and 3.85 µm, band 3.24–3.34 µm: Hora et al. 2026's PAH recipe.
  pah: { band: [3.24, 3.34], continuum: [[2.72, 2.82], [3.8, 3.9]], type: 'emission' },
};

/** A detection counts when the signal is at least this many standard deviations. */
export const DETECTION_SIGMA = 3;

/** The largest published amount of an ingredient, as % of water ice (null if none published). */
export function publishedPercent(target, id) {
  const value = target.ingredients[id]?.percent_of_h2o;
  if (value == null) return null;
  return Array.isArray(value) ? Math.max(...value) : value;
}

/**
 * Targets with the chosen ingredients.
 * @param {{ingredients?: string[], match?: 'all'|'any', preset?: string,
 *          minPercent?: {id: string, value: number}}} query  minPercent: at least this % of water ice
 *   (published upper value), e.g. {id: 'co2_ice', value: 15}
 * @param {object[]} [targets]
 * @returns {object[]} SPHEREx's own results first, then by how many chosen ingredients match
 */
export function findTargets({ ingredients = [], match = 'all', preset, minPercent } = {}, targets = TARGETS) {
  const has = (target, id) => Boolean(target.ingredients[id]);
  let list = targets;
  if (preset) {
    const rule = PRESETS[preset];
    list = list.filter((t) => rule.all.every((id) => has(t, id)) && rule.any.some((id) => has(t, id)));
  }
  if (ingredients.length) {
    list = list.filter((t) => (match === 'any' ? ingredients.some((id) => has(t, id)) : ingredients.every((id) => has(t, id))));
  }
  if (minPercent?.id && Number.isFinite(minPercent.value)) {
    list = list.filter((t) => (publishedPercent(t, minPercent.id) ?? -1) >= minPercent.value);
  }
  const score = (t) => (t.spherex_result ? 100 : 0) + ingredients.filter((id) => has(t, id)).length;
  return [...list].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** "18%", "10–20%" or "" for a published amount relative to water ice. */
export function formatPercent(value) {
  if (value == null) return '';
  return Array.isArray(value) ? `${value[0]}–${value[1]}%` : `${value}%`;
}

const KEYWORDS = [
  [/\bpre[- ]?life\b|\bprebiotic\b|\bbuilding blocks?\b|\bingredients? (for|of) life\b|\bsigns? of life\b/, { preset: 'prelife' }],
  [/\bwater\b|\bh2o\b|\bh₂o\b/, { ingredients: ['h2o_ice'] }],
  [/\bcarbon dioxide\b|\bco2\b|\bco₂\b|\bdry ice\b/, { ingredients: ['co2_ice'] }],
  [/\bcarbon monoxide\b|\bco ice\b/, { ingredients: ['co_ice'] }],
  [/\bmethanol\b|\bch3oh\b|\balcohol\b/, { ingredients: ['ch3oh_ice'] }],
  [/\bpahs?\b|\baromatic\b|\bsoot\b/, { ingredients: ['pah'] }],
  [/\baliphatic\b/, { ingredients: ['aliphatic'] }],
  // Generic words count only when no specific molecule was named ("carbon dioxide" ≠ organics).
  [/\borganics?\b|\bcarbon\b/, { ingredients: ['pah', 'aliphatic', 'ch3oh_ice'], match: 'any', generic: true }],
  [/\bices?\b|\bfrozen\b/, { ingredients: ['h2o_ice', 'co2_ice', 'co_ice'], match: 'any', generic: true }],
];

/**
 * Does the search text ask for ingredients rather than a star? ("water ice", "carbon",
 * "signs of pre-life"). Returns a findTargets() query, or null for ordinary searches.
 * @param {string} text
 */
export function chemistryQuery(text) {
  const query = text.trim().toLowerCase();
  if (!query) return null;
  const ingredients = new Set();
  let preset;
  let match = 'all';
  for (const [pattern, result] of KEYWORDS) {
    if (!pattern.test(query)) continue;
    if (result.preset) preset = result.preset;
    if (result.generic && ingredients.size) continue;
    if (result.match === 'any') match = 'any';
    result.ingredients?.forEach((id) => ingredients.add(id));
  }
  if (!preset && !ingredients.size) return null;
  return { ingredients: [...ingredients], match: ingredients.size > 1 ? match : 'all', ...(preset ? { preset } : {}) };
}

/** Weighted least-squares line through points ({x, y, err}); returns value and error at x0. */
function fitLine(points, x0) {
  let sw = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const p of points) {
    const w = 1 / p.err ** 2;
    const x = p.x - x0;
    sw += w; sx += w * x; sy += w * p.y; sxx += w * x * x; sxy += w * x * p.y;
  }
  const det = sw * sxx - sx * sx;
  if (!(det > 0)) return null;
  const intercept = (sxx * sy - sx * sxy) / det; // value at x0
  const slope = (sw * sxy - sx * sy) / det;
  const variance = sxx / det;
  // If the points scatter more than their error bars say, widen the error to match.
  const chi2 = points.reduce((sum, p) => sum + ((p.y - intercept - slope * (p.x - x0)) / p.err) ** 2, 0);
  const inflate = points.length > 2 ? Math.max(1, chi2 / (points.length - 2)) : 1;
  return { value: intercept, err: Math.sqrt(variance * inflate) };
}

/** Weighted mean of points ({y, err}), with the error widened by their scatter. */
function weightedMean(points) {
  let sw = 0; let swy = 0;
  for (const p of points) {
    sw += 1 / p.err ** 2;
    swy += p.y / p.err ** 2;
  }
  const mean = swy / sw;
  const chi2 = points.reduce((sum, p) => sum + ((p.y - mean) / p.err) ** 2, 0);
  const inflate = points.length > 1 ? Math.max(1, chi2 / (points.length - 1)) : 1;
  return { value: mean, err: Math.sqrt(inflate / sw) };
}

/**
 * Measure one feature in a SPHEREx spectrum (Alice's photometry points).
 * Absorption (ices): optical depth τ = ln(continuum / band); 0.1 means about 10% of the
 * light is absorbed. Emission (PAH): excess = band / continuum − 1.
 * @param {{wavelength_um: number, flux_ujy: number, err_ujy: number, flagged?: boolean}[]} points
 * @param {string} id  a key of BANDS
 * @returns {{id: string, type: string, value: number, err: number, sigma: number, detected: boolean,
 *   n_band: number, n_continuum: number} | {id: string, missing: string}}
 */
export function measureFeature(points, id) {
  const spec = BANDS[id];
  if (!spec) return { id, missing: 'not measurable with SPHEREx' };
  const usable = points
    .filter((p) => !p.flagged && Number.isFinite(p.flux_ujy) && p.err_ujy > 0 && Number.isFinite(p.wavelength_um))
    .map((p) => ({ x: p.wavelength_um, y: p.flux_ujy, err: p.err_ujy }));
  const inside = ([lo, hi]) => (p) => p.x >= lo && p.x <= hi;
  const band = usable.filter(inside(spec.band));
  const sides = spec.continuum.map((range) => usable.filter(inside(range)));
  if (band.length < 2) return { id, missing: `only ${band.length} measurement${band.length === 1 ? '' : 's'} in the band` };
  if (sides.some((side) => side.length < 2)) return { id, missing: 'not enough measurements on both sides of the band' };
  const centre = (spec.band[0] + spec.band[1]) / 2;
  const continuum = fitLine(sides.flat(), centre);
  const inBand = weightedMean(band);
  if (!continuum || continuum.value <= 0 || inBand.value <= 0) {
    return { id, missing: 'too faint here (the brightness is at or below zero)' };
  }
  const relErr = Math.hypot(continuum.err / continuum.value, inBand.err / inBand.value);
  let value;
  let err;
  if (spec.type === 'absorption') {
    value = Math.log(continuum.value / inBand.value);
    err = relErr;
  } else {
    const ratio = inBand.value / continuum.value;
    value = ratio - 1;
    err = ratio * relErr;
  }
  const sigma = value / err;
  return {
    id, type: spec.type, value, err, sigma,
    detected: sigma >= DETECTION_SIGMA,
    n_band: band.length, n_continuum: sides[0].length + sides[1].length,
  };
}
