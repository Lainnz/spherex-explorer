/**
 * The image sequence's shared state (PLAN.md §8.3, parts 4–6): frames, which ones play,
 * the current time, display settings, pictures made once and reused, and operation
 * results. Screen modules subscribe with onChange() and read from here.
 */
import { percentRange, symmetricRange } from './render-math.js';
import { buildPlaylist, frameAt, timeSpan } from './timeline.js';
import { compositeBitmap, renderBitmap } from './worker-client.js';

/** Frames sharing a brightness range: the same detector, or all "white light" merges. */
const groupOf = (frame) => (frame.unit?.startsWith('signal') ? 'white' : `D${frame.detectors?.[0]}`);

export function createSequence(initialDisplay) {
  const frames = []; // time-sequence frames, in arrival order
  const results = []; // operation results (stack, difference, colour)
  let visits = [];
  let grid = null; // the frames' grid centre and size (from the "start" message)
  let band = 'all';
  let lock = null; // {um, tolerance}: only frames at this SPHEREx colour (timeline.js)
  let time = null;
  let pinned = null; // an operation result shown instead of the time sequence
  let display = { ...initialDisplay }; // {cmap, stretch, trim, linear, fixedMin, fixedMax}
  let ranges = new Map(); // group → [vmin, vmax] for "percent" stretch
  let bitmaps = new Map(); // frame id → ImageBitmap for the current display settings
  const listeners = new Set();
  const notify = (what) => listeners.forEach((fn) => fn(what));

  function playlist() {
    return buildPlaylist(frames, band, lock);
  }

  function rangeFor(frame) {
    if (frame.kind === 'difference' || frame.kind === 'significance') return symmetricRange(frame.data, display.trim);
    if (frame.kind) return percentRange([frame.data], display.trim); // other results: own range
    if (display.stretch === 'fixed' && Number.isFinite(display.fixedMin) && display.fixedMax > display.fixedMin) {
      return [display.fixedMin, display.fixedMax];
    }
    if (display.stretch === 'auto') return percentRange([frame.data], display.trim);
    const group = groupOf(frame);
    if (!ranges.has(group)) {
      ranges.set(group, percentRange(frames.filter((f) => groupOf(f) === group).map((f) => f.data), display.trim));
    }
    return ranges.get(group);
  }

  /** The picture for a frame with the current settings (made once, then reused). */
  async function bitmapFor(frame) {
    if (bitmaps.has(frame.id)) return bitmaps.get(frame.id);
    const settings = display;
    let bitmap;
    if (frame.kind === 'composite') {
      bitmap = await compositeBitmap(frame.channels, frame.width, frame.height, {
        trim: settings.trim, softening: settings.linear,
      });
    } else {
      const [vmin, vmax] = rangeFor(frame);
      bitmap = await renderBitmap(frame.data, frame.width, frame.height, {
        vmin, vmax, softening: settings.linear, cmap: frame.kind === 'difference' || frame.kind === 'significance' ? 'gray' : settings.cmap,
      });
    }
    if (settings !== display) return bitmapFor(frame); // settings changed meanwhile
    bitmaps.set(frame.id, bitmap);
    return bitmap;
  }

  return {
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      frames.length = 0;
      results.length = 0;
      visits = [];
      time = null;
      pinned = null;
      ranges = new Map();
      bitmaps.forEach((b) => b.close?.());
      bitmaps = new Map();
      notify('reset');
    },
    setVisits(next) {
      visits = next;
      notify('visits');
    },
    visits: () => visits,
    /** Grid centre/size of the frames; /api/flags and /api/meta use it to line up. */
    setGrid(next) {
      grid = next;
    },
    grid: () => grid,
    addFrame(frame) {
      frames.push(frame);
      ranges.delete(groupOf(frame)); // its group's shared range now includes this frame
      for (const other of frames) if (groupOf(other) === groupOf(frame)) bitmaps.delete(other.id);
      if (time === null) time = frame.t_mid;
      notify('frames');
    },
    /** Swap in a whole new set of frames (the sharper ones), keeping the time and any results. */
    replaceFrames(next) {
      frames.splice(0, frames.length, ...next);
      ranges = new Map();
      bitmaps = new Map(); // not closed: the picture on screen may still be using one
      const list = playlist();
      if (list.length && time !== null) time = frameAt(list, time).t_mid;
      else time = list[0]?.t_mid ?? null;
      notify('frames');
    },
    frames: () => frames,
    results: () => results,
    addResult(result) {
      results.push(result);
      pinned = result;
      notify('results');
    },
    playlist,
    span: () => timeSpan(playlist()),
    band: () => band,
    setBand(next) {
      band = next;
      const list = playlist();
      if (list.length && time !== null) time = frameAt(list, time).t_mid;
      notify('band');
    },
    wavelengthLock: () => lock,
    /** Play only frames at this colour (null = all colours). */
    setWavelengthLock(next) {
      lock = next;
      const list = playlist();
      if (list.length && time !== null) time = frameAt(list, time).t_mid;
      notify('band');
    },
    time: () => time,
    setTime(t, { unpin = true } = {}) {
      time = t;
      if (unpin) pinned = null;
      notify('time');
    },
    /** What to show now: an operation result if one is pinned, else the frame nearest in time. */
    current() {
      if (pinned) return pinned;
      const list = playlist();
      return list.length && time !== null ? frameAt(list, time) : null;
    },
    pin(result) {
      pinned = result;
      notify('time');
    },
    pinned: () => pinned,
    display: () => display,
    setDisplay(changes) {
      display = { ...display, ...changes };
      ranges = new Map();
      bitmaps.forEach((b) => b.close?.());
      bitmaps = new Map();
      notify('display');
    },
    /** The current shared range of a frame (for showing numbers in the panel). */
    rangeFor,
    bitmapFor,
    /** Make every frame's picture in the background, so playback never waits. */
    async prepareAll() {
      for (const frame of playlist()) {
        try {
          await bitmapFor(frame);
        } catch {
          // one bad frame shouldn't stop the others
        }
      }
    },
  };
}
