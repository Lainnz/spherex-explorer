import { describe, expect, it } from 'vitest';
import { FULL_DURATION, transitionState } from './transition.js';

describe('transitionState', () => {
  it('starts calm and ends faded, ready to open the Stellar View', () => {
    expect(transitionState(0)).toMatchObject({ spinBoost: 1, travel: 0, warp: 0, fade: 0, done: false });
    expect(transitionState(FULL_DURATION)).toMatchObject({ travel: 1, turn: 1, fade: 1, done: true });
  });

  it('spins the Earth up first, then flies, then fades', () => {
    const early = transitionState(0.7);
    expect(early.spinBoost).toBeGreaterThan(20);
    expect(early.travel).toBe(0);
    const middle = transitionState(1.9);
    expect(middle.warp).toBeGreaterThan(0.8);
    expect(middle.fade).toBe(0);
    expect(transitionState(3.0).fade).toBeGreaterThan(0.2);
  });

  it('is a quick fade with reduced motion', () => {
    expect(transitionState(0.2, { reducedMotion: true })).toMatchObject({ spinBoost: 1, warp: 0, done: false });
    expect(transitionState(0.4, { reducedMotion: true })).toMatchObject({ fade: 1, done: true });
  });
});
