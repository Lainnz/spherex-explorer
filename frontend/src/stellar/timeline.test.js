import { describe, expect, it } from 'vitest';
import {
  advance, buildPlaylist, channelTolerance, dateToMjd, frameAt, mjdToDate, SECONDS_PER_PASS, stepFrame, timeSpan, visitTicks,
} from './timeline.js';

const frames = [
  { id: 'c', t_mid: 300, detectors: [1] },
  { id: 'a', t_mid: 100, detectors: [1] },
  { id: 'b', t_mid: 110, detectors: [2] },
  { id: 'op', label: 'Stack', detectors: [1] },
];

describe('playlist', () => {
  it('keeps the chosen detector, in time order, without operation results', () => {
    expect(buildPlaylist(frames, 'all').map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(buildPlaylist(frames, '1').map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('finds the nearest frame and steps through', () => {
    const playlist = buildPlaylist(frames, 'all');
    expect(frameAt(playlist, 104).id).toBe('a');
    expect(frameAt(playlist, 250).id).toBe('c');
    expect(stepFrame(playlist, playlist[2], 1).id).toBe('a'); // wraps around
    expect(stepFrame(playlist, playlist[0], -1).id).toBe('c');
  });

  it('spans first to last date', () => {
    expect(timeSpan(buildPlaylist(frames, 'all'))).toEqual([100, 300]);
    expect(timeSpan([{ t_mid: 50 }])).toEqual([49.5, 50.5]);
  });
});

describe('advance', () => {
  const span = [0, 80];

  it('moves at a steady rate: one pass per SECONDS_PER_PASS at 1×', () => {
    expect(advance({ t: 0, direction: 1 }, 1, 1, span, 'loop').t).toBeCloseTo(80 / SECONDS_PER_PASS);
    expect(advance({ t: 0, direction: 1 }, 1, 2, span, 'loop').t).toBeCloseTo((80 / SECONDS_PER_PASS) * 2);
  });

  it('loops back to the start', () => {
    expect(advance({ t: 79, direction: 1 }, 1, 1, span, 'loop').t).toBeCloseTo(9);
  });

  it('bounces back and forth', () => {
    const next = advance({ t: 79, direction: 1 }, 1, 1, span, 'bounce');
    expect(next.direction).toBe(-1);
    expect(next.t).toBeCloseTo(71);
  });
});

describe('dates and ticks', () => {
  it('converts MJD and dates', () => {
    expect(mjdToDate(60902.865)).toBe('2025-08-15');
    expect(mjdToDate(dateToMjd('2026-03-14'))).toBe('2026-03-14');
    expect(dateToMjd('nonsense')).toBeNull();
  });

  it('places visit ticks along the slider', () => {
    const ticks = visitTicks([{ visit: 1, t_start: 100 }, { visit: 2, t_start: 200 }], [100, 300]);
    expect(ticks.map((t) => t.position)).toEqual([0, 0.5]);
  });
});

describe('same-colour playback (wavelength lock)', () => {
  const frames = [
    { id: 'a', t_mid: 3, detectors: [3], wavelength_um: 2.19 },
    { id: 'b', t_mid: 1, detectors: [3], wavelength_um: 2.20 },
    { id: 'c', t_mid: 2, detectors: [3], wavelength_um: 1.95 },
  ];
  it('keeps only frames at the locked colour, in time order', () => {
    const list = buildPlaylist(frames, 'all', { um: 2.19, tolerance: 0.025 });
    expect(list.map((f) => f.id)).toEqual(['b', 'a']);
  });
  it('uses half a SPHEREx channel as the tolerance', () => {
    const wavelengths = [1.0, 1.1, 1.2, 1.3];
    expect(channelTolerance(1.19, wavelengths)).toBeCloseTo(0.05, 9);
    expect(channelTolerance(0.9, wavelengths)).toBeCloseTo(0.05, 9); // edge channel
  });
});
