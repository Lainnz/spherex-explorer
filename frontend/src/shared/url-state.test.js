import { describe, expect, it } from 'vitest';
import { buildStellarUrl } from './url-state.js';

describe('buildStellarUrl', () => {
  it('puts coordinates, field of view and target in the address', () => {
    expect(buildStellarUrl({ ra: 269.452077, dec: 4.693365, fov: 600, target: 'barnards-star' }))
      .toBe('stellar.html?ra=269.45208&dec=4.69337&target=barnards-star&fov=600');
  });

  it('only mentions detectors when not all six are chosen', () => {
    expect(buildStellarUrl({ ra: 1, dec: 2, detectors: [1, 2, 3, 4, 5, 6] })).toBe('stellar.html?ra=1.00000&dec=2.00000');
    expect(buildStellarUrl({ ra: 1, dec: 2, detectors: [5, 6] })).toContain('det=5%2C6');
  });
});
