/**
 * Building Stellar View addresses (PLAN.md §8.4). Phase 7 adds reading them back.
 * Coordinates win over a target name; the name is kept so the page knows the object.
 */

/**
 * @param {{ra?: number, dec?: number, target?: string, fov?: number, detectors?: number[],
 *          release?: string[]}} state  fov in arcseconds
 * @returns {string} e.g. "stellar.html?ra=269.45208&dec=4.69337&fov=600&target=barnards-star"
 */
export function buildStellarUrl({ ra, dec, target, fov, detectors, release } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(ra) && Number.isFinite(dec)) {
    params.set('ra', ra.toFixed(5));
    params.set('dec', dec.toFixed(5));
  }
  if (target) params.set('target', target);
  if (Number.isFinite(fov)) params.set('fov', String(Math.round(fov * 100) / 100));
  if (detectors?.length && detectors.length < 6) params.set('det', detectors.join(','));
  if (release?.length) params.set('release', release.join(','));
  return `stellar.html?${params}`;
}
