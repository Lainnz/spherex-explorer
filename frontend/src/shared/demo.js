/**
 * Saved demo data for the featured targets (made by scripts/build_demo_data.py), used when
 * the data server is asleep or with ?demo=1 (PLAN.md §8.6). Same shape as live answers.
 */
const BASE = `${import.meta.env.BASE_URL}data/demo/`;
const cache = new Map();

/**
 * The saved manifest for a featured target, or null if there isn't one.
 * File links inside it (frames/…, flags/…) are made absolute.
 * @param {string} slug
 */
export async function loadDemo(slug) {
  if (!cache.has(slug)) {
    cache.set(slug, fetch(`${BASE}${slug}/manifest.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => manifest && withAbsoluteLinks(manifest, `${BASE}${slug}/`))
      .catch(() => null));
  }
  return cache.get(slug);
}

function withAbsoluteLinks(manifest, folder) {
  const fix = (link) => (link && !/^(https?:)?\//.test(link) ? `${folder}${link}` : link);
  for (const message of manifest.frames_stream) {
    if (message.type === 'frame') {
      message.png_url = fix(message.png_url);
      message.f32_url = fix(message.f32_url);
      message.fits_url = fix(message.fits_url);
    }
  }
  for (const flags of Object.values(manifest.flags)) {
    for (const flag of flags.flags) flag.mask_url = fix(flag.mask_url);
  }
  return manifest;
}
