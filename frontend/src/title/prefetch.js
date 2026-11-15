/**
 * Getting the Stellar View ready while the fly-away plays, so it opens smoothly:
 * - download Aladin Lite (2.4 MB) into the browser's cache. It's only downloaded, not run,
 *   so the animation doesn't stutter;
 * - featured targets: download their saved demo data;
 * - live: ask the data server to start finding this spot's SPHEREx images (the first
 *   search takes ~3 minutes; the server keeps the answer, so the Stellar View gets it
 *   sooner). Not waited for.
 */
import { ALADIN_URL } from '../shared/aladin-url.js';
import { API_BASE } from '../shared/api.js';
import { findFeatured } from '../shared/targets.js';

const DEMO_BASE = `${import.meta.env.BASE_URL}data/demo/`;

/**
 * @param {{ra: number, dec: number, target?: string}} destination
 * @param {{live: boolean, fov?: number}} options
 * @returns {Promise<void>} resolves when the things worth waiting for are downloaded
 *   (never rejects: a failed download just means the Stellar View fetches it itself)
 */
export function prepareStellarView(destination, { live, fov }) {
  const quietly = (promise) => promise.then(() => undefined, () => undefined);
  const waitFor = [quietly(fetch(ALADIN_URL, { mode: 'cors' }).then((response) => response.arrayBuffer()))];

  const featured = destination.target ? findFeatured(destination.target) : undefined;
  if (featured) waitFor.push(quietly(fetch(`${DEMO_BASE}${featured.slug}/manifest.json`)));

  if (live) {
    const params = new URLSearchParams({ ra: String(destination.ra), dec: String(destination.dec) });
    if (fov) params.set('fov', String(fov));
    if (featured) params.set('target', featured.slug);
    // Fire and forget: this can take minutes, and the server caches the answer.
    quietly(fetch(`${API_BASE}/api/observations?${params}`, { signal: AbortSignal.timeout(330_000) }));
  }
  return Promise.all(waitFor).then(() => undefined);
}

/** Resolves with the promise's value, or `fallback` if it takes longer than `ms`. */
export function withTimeout(promise, ms, fallback = null) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}
