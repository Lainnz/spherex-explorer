/**
 * Where frames and moving stars are on the sky (pure maths, testable).
 *
 * Frames come with the server's grid WCS: a TAN (gnomonic) projection, north up, no
 * rotation (backend/app/grid.py). The images we draw have row 0 at the top (north),
 * the opposite of FITS, so image row r is FITS row (height − 1 − r).
 */
const DEG = Math.PI / 180;

/**
 * Sky position of a FITS pixel (0-based x, y) in a TAN grid.
 * @param {{CRVAL1: number, CRVAL2: number, CRPIX1: number, CRPIX2: number, CDELT1: number, CDELT2: number}} wcs
 */
export function tanPixelToSky(wcs, x, y) {
  // Standard coordinates on the tangent plane (radians); xi points east, eta north.
  // CDELT1 is negative, so pixels further right (larger x) are further west.
  const xi = (x + 1 - wcs.CRPIX1) * wcs.CDELT1 * DEG;
  const eta = (y + 1 - wcs.CRPIX2) * wcs.CDELT2 * DEG;
  const ra0 = wcs.CRVAL1 * DEG;
  const dec0 = wcs.CRVAL2 * DEG;
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0);
  const ra = ra0 + Math.atan2(xi, denominator);
  const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(xi, denominator));
  return { ra: (((ra / DEG) % 360) + 360) % 360, dec: dec / DEG };
}

/**
 * FITS pixel (0-based x, y) of a sky position in a TAN grid: the inverse of tanPixelToSky.
 * Returns null for positions on the far side of the sky from the grid.
 */
export function skyToTanPixel(wcs, raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const ra0 = wcs.CRVAL1 * DEG;
  const dec0 = wcs.CRVAL2 * DEG;
  const cosC = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  if (cosC <= 0) return null;
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosC;
  const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosC;
  return { x: xi / (wcs.CDELT1 * DEG) + wcs.CRPIX1 - 1, y: eta / (wcs.CDELT2 * DEG) + wcs.CRPIX2 - 1 };
}

/**
 * A frame's value at a sky position: the median of the 3×3 pixels around it (so one bad
 * or noisy pixel can't decide it), or null if the spot is outside the frame or blank.
 * Frame pictures have row 0 at the top (north), so FITS row y is image row height − 1 − y.
 * @param {{data: Float32Array|number[], width: number, height: number, wcs: object}} frame
 */
export function valueAt(frame, raDeg, decDeg) {
  if (!frame?.wcs || !frame.data) return null;
  const pixel = skyToTanPixel(frame.wcs, raDeg, decDeg);
  if (!pixel) return null;
  const column = Math.round(pixel.x);
  const row = frame.height - 1 - Math.round(pixel.y);
  if (column < 0 || row < 0 || column >= frame.width || row >= frame.height) return null;
  const values = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= frame.width || r >= frame.height) continue;
      const value = frame.data[r * frame.width + c];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/**
 * Sky positions of the outer corners of a frame's top-left, top-right and bottom-left
 * pixels (as drawn, north up): enough to map the picture onto the screen.
 */
export function frameCorners(wcs, width, height) {
  return {
    topLeft: tanPixelToSky(wcs, -0.5, height - 0.5),
    topRight: tanPixelToSky(wcs, width - 0.5, height - 0.5),
    bottomLeft: tanPixelToSky(wcs, -0.5, -0.5),
  };
}

/**
 * The 2D canvas transform (a, b, c, d, e, f) that puts image pixel (0, 0) at `topLeft`,
 * (width, 0) at `topRight` and (0, height) at `bottomLeft` (screen points {x, y}).
 */
export function imageTransform(topLeft, topRight, bottomLeft, width, height) {
  return [
    (topRight.x - topLeft.x) / width,
    (topRight.y - topLeft.y) / width,
    (bottomLeft.x - topLeft.x) / height,
    (bottomLeft.y - topLeft.y) / height,
    topLeft.x,
    topLeft.y,
  ];
}

export { positionAt } from '../shared/motion.js';
