/**
 * Field-of-view helpers. Internally the FOV is always in arcseconds (like WiseView).
 * URL and input formats (PLAN.md §8.4): "600" or "600s" = arcsec, "10m" = arcmin,
 * "0.25d" = degrees. The symbols ″ ′ ° and words arcsec/arcmin/deg work too.
 */

const UNIT_TO_ARCSEC = {
  '': 1,
  s: 1,
  '"': 1,
  '″': 1,
  arcsec: 1,
  m: 60,
  "'": 60,
  '′': 60,
  arcmin: 60,
  d: 3600,
  '°': 3600,
  deg: 3600,
};

/**
 * Turn user or URL text into arcseconds.
 * @param {string|number} input e.g. "10m", "600", 0.25 is NOT degrees (plain numbers are arcsec)
 * @returns {number|null} arcseconds, or null if the text isn't a valid FOV
 */
export function parseFov(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  if (typeof input !== 'string') return null;
  const match = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?|\.\d+)\s*([a-z"'″′°]*)$/);
  if (!match) return null;
  const factor = UNIT_TO_ARCSEC[match[2]];
  const value = Number(match[1]) * factor;
  return factor && value > 0 ? value : null;
}

/**
 * Keep a FOV inside the allowed range from datasets.json.
 * @param {number} arcsec
 * @param {{min_fov_arcsec: number, max_fov_arcsec: number}} limits
 */
export function clampFov(arcsec, limits) {
  return Math.min(limits.max_fov_arcsec, Math.max(limits.min_fov_arcsec, arcsec));
}

/**
 * Friendly text for a FOV, using the biggest unit that gives a number of at least 1.
 * @param {number} arcsec
 * @returns {string} e.g. 600 → "10′", 45 → "45″", 3600 → "1°"
 */
export function formatFov(arcsec) {
  const round = (n) => String(Math.round(n * 100) / 100);
  if (arcsec >= 3600) return `${round(arcsec / 3600)}°`;
  if (arcsec >= 60) return `${round(arcsec / 60)}′`;
  return `${round(arcsec)}″`;
}
