/**
 * Reading and writing sky coordinates (PLAN.md §8.2).
 *
 * Accepted input (RA first, then Dec):
 *   decimal degrees      "269.452 4.693", "269.452, +4.693"
 *   hours/degrees        "08h55m10.831s -7d14m42.53s", "17h57m48.97s +04°41′36.1″"
 *   colons or spaces     "17:57:48.97 +04:41:36.1", "17 57 48.97 +04 41 36.1"
 * Anything else is treated as a name (handled by the caller).
 */

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const SIGN = '([+-]?)';
const SEP = '[\\s,:]*';

// RA as h m s (letters, colons or spaces), then Dec as ±d m s.
const SEXAGESIMAL = new RegExp(
  `^${NUMBER}\\s*[h:\\s]\\s*${NUMBER}\\s*[m:\\s]\\s*${NUMBER}\\s*s?${SEP}` +
    `${SIGN}\\s*${NUMBER}\\s*[d:\\s]\\s*${NUMBER}\\s*[m:\\s]\\s*${NUMBER}\\s*s?$`,
);
const DECIMAL = new RegExp(`^${SIGN}${NUMBER}${SEP}${SIGN}${NUMBER}$`);

/** Unify the many ways people type degree, minute and second marks and minus signs. */
function normalize(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[°º]/g, 'd')
    .replace(/[′'’]/g, 'm')
    .replace(/[″"”]/g, 's')
    .replace(/\s+/g, ' ');
}

const inRange = (ra, dec) => ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;

/**
 * Parse coordinates. Returns {ra, dec} in degrees (ICRS), or null if `text` isn't coordinates.
 * @param {string} text
 * @returns {{ra: number, dec: number} | null}
 */
export function parseCoordinates(text) {
  if (typeof text !== 'string') return null;
  const value = normalize(text);

  const decimal = value.match(DECIMAL);
  if (decimal) {
    const [, raSign, raText, decSign, decText] = decimal;
    if (raSign === '-') return null; // RA is never negative
    const ra = Number(raText);
    const dec = Number(decText) * (decSign === '-' ? -1 : 1);
    return inRange(ra, dec) ? { ra, dec } : null;
  }

  const parts = value.match(SEXAGESIMAL);
  if (parts) {
    const [h, m, s, sign, d, dm, ds] = [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4],
      Number(parts[5]), Number(parts[6]), Number(parts[7])];
    if (h >= 24 || m >= 60 || s >= 60 || d > 90 || dm >= 60 || ds >= 60) return null;
    const ra = (h + m / 60 + s / 3600) * 15;
    const dec = (d + dm / 60 + ds / 3600) * (sign === '-' ? -1 : 1);
    return inRange(ra, dec) ? { ra, dec } : null;
  }
  return null;
}

const pad = (n, width, decimals = 0) => n.toFixed(decimals).padStart(width + (decimals ? decimals + 1 : 0), '0');

/** 269.452 → "17h57m48.48s" */
export function formatRa(ra) {
  let totalSeconds = Math.round((((ra % 360) + 360) % 360) / 15 * 3600 * 100) / 100;
  if (totalSeconds >= 86400) totalSeconds -= 86400;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds - h * 3600 - m * 60;
  return `${pad(h, 2)}h${pad(m, 2)}m${pad(s, 2, 2)}s`;
}

/** 4.693 → "+04°41′34.8″" */
export function formatDec(dec) {
  const sign = dec < 0 ? '-' : '+';
  const totalSeconds = Math.round(Math.abs(dec) * 3600 * 10) / 10;
  const d = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds - d * 3600 - m * 60;
  return `${sign}${pad(d, 2)}°${pad(m, 2)}′${pad(s, 2, 1)}″`;
}
