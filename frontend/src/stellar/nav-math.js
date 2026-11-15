/** Small, testable helpers for the Stellar View's navigation tools (PLAN.md §8.3). */

const DEG = Math.PI / 180;

/** Angle (degrees, −180…180) of a screen point around a centre point. Screen y points down. */
export function angleAround(cx, cy, x, y) {
  return Math.atan2(y - cy, x - cx) / DEG;
}

/** The smallest signed difference between two angles in degrees (−180…180). */
export function angleDifference(to, from) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/** Angle between two sky positions in arcseconds (haversine formula). */
export function separationArcsec(ra1, dec1, ra2, dec2) {
  const [a1, d1, a2, d2] = [ra1, dec1, ra2, dec2].map((v) => v * DEG);
  const h = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG * 3600;
}

/** "45″", "3.2′" or "1.5°" for an angle in arcseconds. */
export function formatAngle(arcsec) {
  if (arcsec >= 3600) return `${(arcsec / 3600).toFixed(1)}°`;
  if (arcsec >= 60) return `${(arcsec / 60).toFixed(1)}′`;
  return `${Math.round(arcsec)}″`;
}

/**
 * IRSA's s_region ("POLYGON ICRS ra1 dec1 ra2 dec2 …") → [[ra, dec], …], without the
 * repeated closing corner. Returns null for anything else.
 */
export function parseRegion(sRegion) {
  const parts = String(sRegion ?? '').trim().split(/\s+/);
  if (parts[0]?.toUpperCase() !== 'POLYGON') return null;
  const numbers = parts.slice(parts[1] && Number.isNaN(Number(parts[1])) ? 2 : 1).map(Number);
  if (numbers.length < 6 || numbers.length % 2 || numbers.some(Number.isNaN)) return null;
  const corners = [];
  for (let i = 0; i < numbers.length; i += 2) corners.push([numbers[i], numbers[i + 1]]);
  const [first, last] = [corners[0], corners.at(-1)];
  if (corners.length > 3 && first[0] === last[0] && first[1] === last[1]) corners.pop();
  return corners;
}
