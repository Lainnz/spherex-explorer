import { describe, expect, it } from 'vitest';
import { findFeatured } from './targets.js';
import { positionAt, VIEW_EPOCH_MJD, viewPosition } from './motion.js';

describe('viewPosition', () => {
  it("points at Barnard's Star where it is now, ~4.5′ north of its 2000 position", () => {
    const barnard = findFeatured('barnards-star');
    const now = viewPosition(barnard);
    expect((now.dec - barnard.dec) * 3600).toBeCloseTo(10.3624 * 26, 0); // 10.36″/yr × 26 yr
  });

  it('points at WISE 0855 where it is now, not where WISE saw it in 2010', () => {
    const wise = findFeatured('wise-0855');
    const now = viewPosition(wise);
    const offset = Math.hypot((now.ra - wise.ra) * Math.cos((wise.dec * Math.PI) / 180), now.dec - wise.dec) * 3600;
    expect(offset).toBeGreaterThan(100); // ~8″/yr since about 2010
    expect(offset).toBeLessThan(160);
  });

  it('leaves slow or unknown movers where they are', () => {
    expect(viewPosition({ ra: 10, dec: 20 })).toEqual({ ra: 10, dec: 20 });
    const rw = findFeatured('rw-aurigae');
    expect(viewPosition(rw)).toEqual({ ra: rw.ra, dec: rw.dec });
  });

  it('keeps RA in 0–360', () => {
    const p = positionAt({ ra: 0.0001, dec: 0, epoch: 2000, pmra: -10000, pmdec: 0 }, VIEW_EPOCH_MJD);
    expect(p.ra).toBeGreaterThan(359);
  });
});
