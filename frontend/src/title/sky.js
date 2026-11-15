/**
 * Small astronomy helpers for the title page: where the Sun is, how far the Earth has
 * turned, and converting sky coordinates to three.js directions.
 * Low-precision formulas (good to ~0.01°), plenty for a picture.
 */
const DEG = Math.PI / 180;

/** Days since 2000 January 1, 12:00 UTC (the J2000 epoch). */
export function daysSinceJ2000(date) {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

/** The Sun's RA and Dec in degrees (Astronomical Almanac low-precision formula). */
export function sunPosition(date) {
  const n = daysSinceJ2000(date);
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / DEG;
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) / DEG;
  return { ra: (ra + 360) % 360, dec };
}

/** Greenwich sidereal angle in degrees: how far the Earth has turned against the stars. */
export function greenwichSiderealDegrees(date) {
  const n = daysSinceJ2000(date);
  return (((280.46061837 + 360.98564736629 * n) % 360) + 360) % 360;
}

/**
 * A sky direction as a three.js-style unit vector [x, y, z]:
 * x = toward RA 0°, y = celestial north, z = toward RA 270° (matches starfield.js).
 */
export function skyDirection(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)];
}
