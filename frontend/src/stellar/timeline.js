/**
 * The time slider's logic (PLAN.md §8.3, part 4), kept free of the page so it can be tested.
 * Times are Modified Julian Dates (MJD).
 */

/** How long one pass through all the dates takes at 1× speed. */
export const SECONDS_PER_PASS = 8;

/**
 * Frames to play: in time order, only the chosen detector ("all" = every frame).
 * Operation results (no t_mid) are never in the playlist.
 */
export function buildPlaylist(frames, band) {
  return frames
    .filter((frame) => Number.isFinite(frame.t_mid) && (band === 'all' || frame.detectors?.includes(Number(band))))
    .sort((a, b) => a.t_mid - b.t_mid);
}

/** The frame closest in time to t (or null for an empty playlist). */
export function frameAt(playlist, t) {
  let best = null;
  let bestGap = Infinity;
  for (const frame of playlist) {
    const gap = Math.abs(frame.t_mid - t);
    if (gap < bestGap) {
      best = frame;
      bestGap = gap;
    }
  }
  return best;
}

/** [first, last] times covered by the playlist; a single frame gets a one-day span. */
export function timeSpan(playlist) {
  if (!playlist.length) return [0, 1];
  const first = playlist[0].t_mid;
  const last = playlist.at(-1).t_mid;
  return last > first ? [first, last] : [first - 0.5, first + 0.5];
}

/**
 * Advance playback by `dt` seconds at `speed`. Time moves at a steady rate so that one
 * pass takes SECONDS_PER_PASS / speed seconds.
 * @param {{t: number, direction: 1|-1}} position
 * @param {[number, number]} span
 * @param {"loop"|"bounce"} repeat
 * @returns {{t: number, direction: 1|-1}}
 */
export function advance(position, dt, speed, span, repeat) {
  const [first, last] = span;
  const length = last - first;
  let t = position.t + position.direction * (length / SECONDS_PER_PASS) * speed * dt;
  let { direction } = position;
  if (repeat === 'bounce') {
    if (t > last) {
      t = last - (t - last);
      direction = -1;
    } else if (t < first) {
      t = first + (first - t);
      direction = 1;
    }
    t = Math.min(last, Math.max(first, t));
  } else if (t > last) {
    t = first + ((t - first) % length);
  }
  return { t, direction };
}

/** The next or previous frame in the playlist from the one showing now. */
export function stepFrame(playlist, current, step) {
  if (!playlist.length) return null;
  const index = Math.max(0, playlist.indexOf(current));
  return playlist[(index + step + playlist.length) % playlist.length];
}

/** Where along the slider (0–1) each visit starts, for the tick marks. */
export function visitTicks(visits, span) {
  const [first, last] = span;
  return visits.map((visit) => ({
    visit: visit.visit,
    label: visit.label,
    position: Math.min(1, Math.max(0, (visit.t_start - first) / (last - first))),
  }));
}

/** MJD → "2025-11-07". */
export function mjdToDate(mjd) {
  return new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);
}

/** "2025-11-07" → MJD (noon UTC), or null. */
export function dateToMjd(text) {
  const time = Date.parse(`${text}T12:00:00Z`);
  return Number.isNaN(time) ? null : time / 86400000 + 40587;
}
