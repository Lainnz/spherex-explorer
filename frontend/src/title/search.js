/**
 * Turning what someone typed into a place in the sky (PLAN.md §8.2).
 * Order: coordinates → featured target → the data server's name lookup (SIMBAD).
 * Without the data server (demo mode), only coordinates and featured targets work.
 */
import { FriendlyError, getJson } from '../shared/api.js';
import { parseCoordinates } from '../shared/coords.js';
import { findFeatured, suggestFeatured } from '../shared/targets.js';

/**
 * @typedef {{ra: number, dec: number, name: string, target?: string, fov?: number}} Destination
 */

/**
 * @param {string} text what was typed
 * @param {{live: boolean}} options live = the data server is awake
 * @returns {Promise<Destination>}
 * @throws {FriendlyError} with a message (and maybe a `suggestion` target) to show
 */
export async function resolveQuery(text, { live }) {
  const query = text.trim();
  if (!query) throw new FriendlyError('Type a star name or coordinates first.');

  const coords = parseCoordinates(query);
  if (coords) return { ...coords, name: query };

  const featured = findFeatured(query);
  if (featured) {
    return { ra: featured.ra, dec: featured.dec, name: featured.name, target: featured.slug, fov: featured.demo?.fov_arcsec };
  }

  if (live) {
    try {
      const found = await getJson('/api/resolve', { name: query });
      return { ra: found.ra, dec: found.dec, name: found.name, target: query };
    } catch (error) {
      if (error.code !== 'not_found') throw error;
    }
  }

  const suggestion = suggestFeatured(query);
  const notFound = new FriendlyError(
    suggestion
      ? `We couldn't find "${query}". Did you mean ${suggestion.name}?`
      : live
        ? `We couldn't find "${query}". Check the spelling, or type coordinates like 17h57m48.97s +04d41m36.1s.`
        : `The data server is asleep, so only the featured targets and coordinates work right now.`,
    { code: 'not_found' },
  );
  notFound.suggestion = suggestion;
  throw notFound;
}
