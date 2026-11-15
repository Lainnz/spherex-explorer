/**
 * The "Randomize" button: somewhere to explore without a coordinate in mind.
 * Live: the data server picks (sometimes a famous sight). Demo: a featured target or
 * a famous sight from config/targets.json.
 */
import { getJson } from '../shared/api.js';
import { featuredTargets, interestingSpots } from '../shared/targets.js';

/**
 * @param {{live: boolean, random?: () => number}} options
 * @returns {Promise<import('./search.js').Destination>}
 */
export async function randomDestination({ live, random = Math.random }) {
  if (live) {
    try {
      const pick = await getJson('/api/random', {}, { timeoutMs: 8000 });
      return { ra: pick.ra, dec: pick.dec, fov: pick.fov_arcsec, name: pick.name || 'A random patch of sky', target: pick.slug };
    } catch {
      // fall through to an offline pick
    }
  }
  const spots = [
    ...featuredTargets.map((t) => ({ ra: t.ra, dec: t.dec, fov: t.demo?.fov_arcsec, name: t.name, target: t.slug })),
    ...interestingSpots.map((s) => ({ ra: s.ra, dec: s.dec, fov: s.fov_arcsec, name: s.name })),
  ];
  return spots[Math.floor(random() * spots.length)];
}
