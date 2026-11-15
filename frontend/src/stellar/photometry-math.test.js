import { describe, expect, it } from 'vitest';
import { CUBE_WAVELENGTHS } from '../shared/wavelength.js';
import { binSpectrum, defaultWindow, inWindow, measurable, toCsv } from './photometry-math.js';

const point = (wavelength_um, flux_ujy, err_ujy, extra = {}) => ({ wavelength_um, flux_ujy, err_ujy, detector: 1, ...extra });

describe('spectrum binning', () => {
  it('averages points in the same channel, weighting precise ones more', () => {
    // Same numbers as the backend test (backend/tests/test_phase4.py).
    const binned = binSpectrum([point(1.001, 10, 1), point(1.003, 20, 1), point(2.0, 5, 2)], CUBE_WAVELENGTHS);
    expect(binned).toHaveLength(2);
    expect(binned[0].flux_ujy).toBeCloseTo(15);
    expect(binned[0].err_ujy).toBeCloseTo(1 / Math.sqrt(2));
    expect(binned[0].n_points).toBe(2);
  });

  it('skips saturated points (no value)', () => {
    expect(measurable([point(1, null, null, { saturated: true }), point(1, 5, 1)])).toHaveLength(1);
  });
});

describe('light-curve window', () => {
  it('picks the detector with the most clean points', () => {
    const points = [
      point(0.8, 1, 1, { detector: 1 }), point(0.9, 1, 1, { detector: 1 }),
      point(4.5, 1, 1, { detector: 6 }), point(4.6, 1, 1, { detector: 6, flagged: true }),
    ];
    expect(defaultWindow(points)).toEqual([0.8, 0.9]);
    expect(inWindow(points, [0.85, 5])).toHaveLength(3);
  });

  it('gives up gracefully with nothing measurable', () => {
    expect(defaultWindow([point(1, null, null)])).toBeNull();
  });
});

describe('CSV', () => {
  it('writes a header and quotes awkward text', () => {
    const csv = toCsv([{ name: 'a, b', flux: 1.5, flags: ['HOT', 'COLD'] }], ['name', 'flux', 'flags', 'missing']);
    expect(csv).toBe('name,flux,flags,missing\n"a, b",1.5,HOT COLD,\n');
  });
});
