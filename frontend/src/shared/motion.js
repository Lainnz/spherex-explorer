/**
 * Where a moving star is on a date, and where to point the view for it.
 *
 * Catalogue positions are for a fixed date (SIMBAD: 2000; the team's WISE 0855
 * coordinates: about 2010). Fast movers are minutes of arc away by 2025–26, so the view
 * centres on the predicted position in the middle of the SPHEREx mission so far.
 * (On 2026-11-15 Barnard's Star's frames were drawn entirely off-screen, ~4.5′ north
 * of a view centred on its 2000 position.)
 */
const DEG = Math.PI / 180;
const MJD_J2000 = 51544.5;
const DAYS_PER_YEAR = 365.25;

/** 2026.0, the middle of SPHEREx's DR1 + QR3 data (2025-04 → 2026-10). */
export const VIEW_EPOCH_MJD = MJD_J2000 + 26 * DAYS_PER_YEAR;
/** Below this, motion over a few years is too small to matter for pointing (mas/yr). */
const NOTICEABLE_MAS_PER_YEAR = 50;

/**
 * Straight-line motion; for these short spans the error is well under an arcsecond.
 * @param {{ra: number, dec: number, epoch: number, pmra: number, pmdec: number}} motion
 *   epoch in Julian years (e.g. 2000.0), pm in mas/yr (pmra already × cos dec)
 * @param {number} mjd
 */
export function positionAt(motion, mjd) {
  const years = (mjd - MJD_J2000) / DAYS_PER_YEAR + 2000 - motion.epoch;
  const dec = motion.dec + (motion.pmdec * years) / 3.6e6;
  const ra = motion.ra + (motion.pmra * years) / 3.6e6 / Math.cos(motion.dec * DEG);
  return { ra: ((ra % 360) + 360) % 360, dec };
}

/**
 * Where to point the view for an object: its predicted 2026 position if it moves
 * noticeably, otherwise the given position unchanged.
 * @param {{ra: number, dec: number, motion?: object}} object
 */
export function viewPosition({ ra, dec, motion }) {
  if (!motion || motion.pmra == null || motion.pmdec == null) return { ra, dec };
  if (Math.hypot(motion.pmra, motion.pmdec) < NOTICEABLE_MAS_PER_YEAR) return { ra, dec };
  return positionAt(motion, VIEW_EPOCH_MJD);
}
