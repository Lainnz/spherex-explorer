/**
 * The fly-away after a search (PLAN.md §8.2), as a pure timeline:
 *   1. the Earth spins faster (0–0.8 s),
 *   2. the camera pulls away and turns toward the target while stars streak (0.8–2.6 s),
 *   3. the streaks settle and the screen fades to the night-sky colour (2.6–3.2 s).
 * The scene asks "where are we at time t?" each frame. With reduced motion it's a short fade.
 */
export const FULL_DURATION = 3.2;
export const REDUCED_DURATION = 0.35;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeIn = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** 0 → 1 → 0 over the interval, peaking in the middle. */
const bump = (x) => Math.sin(Math.PI * clamp01(x));

/**
 * @param {number} t seconds since the search was confirmed
 * @param {{reducedMotion?: boolean}} [options]
 * @returns {{spinBoost: number, travel: number, turn: number, warp: number, fade: number, done: boolean}}
 *   spinBoost: Earth spin multiplier (1 = normal) · travel/turn: camera progress 0–1 ·
 *   warp: star streak strength 0–1 · fade: screen fade 0–1 · done: time to open the Stellar View
 */
export function transitionState(t, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    return { spinBoost: 1, travel: 0, turn: 0, warp: 0, fade: clamp01(t / REDUCED_DURATION), done: t >= REDUCED_DURATION };
  }
  const spin = clamp01(t / 0.8);
  const fly = clamp01((t - 0.8) / 1.8);
  const settle = clamp01((t - 2.6) / 0.6);
  return {
    spinBoost: 1 + 39 * easeIn(spin),
    travel: easeInOut(fly),
    turn: easeInOut(clamp01((t - 0.6) / 1.8)),
    warp: bump(clamp01((t - 0.9) / 2.1)),
    fade: easeIn(settle),
    done: t >= FULL_DURATION,
  };
}
