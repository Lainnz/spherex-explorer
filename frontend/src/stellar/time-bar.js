/**
 * The time bar (PLAN.md §8.3, part 4): play/stop at a steady speed, speed choice,
 * step ◀ ▶, loop or bounce, blink, the slider with a tick per visit, the date readout,
 * the "frames ready" counter and the filmstrip. Keys: Space play/stop, ←/→ step, B blink.
 */
import { ChevronLeft, ChevronRight, createElement, Play, Square } from 'lucide';
import { advance, mjdToDate, stepFrame, visitTicks } from './timeline.js';

const SLIDER_STEPS = 1000;
const BLINK_SECONDS = 0.6;
const DETECTOR_COLOURS = ['#0072B2', '#56B4E9', '#009E73', '#F0E442', '#E69F00', '#D55E00'];
const THUMB = 64;

/**
 * @param {{root: HTMLElement, sequence: object, state: object, onStateChange: () => void,
 *          getBlinkPair: () => [object, object] | null}} options
 */
export function setupTimeBar({ root, sequence, state, onStateChange, getBlinkPair }) {
  const playButton = root.querySelector('[data-play]');
  const slider = root.querySelector('[data-time]');
  const ticks = root.querySelector('[data-ticks]');
  const readout = root.querySelector('[data-readout]');
  const progress = root.querySelector('[data-progress]');
  const speedSelect = root.querySelector('[data-speed]');
  const repeatSelect = root.querySelector('[data-repeat]');
  const blinkButton = root.querySelector('[data-blink]');
  const filmstrip = root.querySelector('[data-filmstrip]');
  root.querySelector('[data-step="-1"]').append(createElement(ChevronLeft, { 'aria-hidden': 'true' }));
  root.querySelector('[data-step="1"]').append(createElement(ChevronRight, { 'aria-hidden': 'true' }));
  slider.max = String(SLIDER_STEPS);
  speedSelect.value = String(state.speed);

  let playing = false;
  let blinking = false;
  let position = { t: 0, direction: 1 };
  let lastTimestamp = null;
  let blinkClock = 0;
  let blinkSide = 0;

  // --- Play / stop / blink ---------------------------------------------------------------
  function showPlayButton() {
    playButton.replaceChildren(createElement(playing ? Square : Play, { 'aria-hidden': 'true' }));
    playButton.setAttribute('aria-label', playing ? 'Stop' : 'Play');
    playButton.title = playing ? 'Stop (Space)' : 'Play (Space)';
    blinkButton.setAttribute('aria-pressed', String(blinking));
  }

  function loop(timestamp) {
    if (!playing && !blinking) return;
    const dt = lastTimestamp === null ? 0 : Math.min(0.1, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    if (blinking) {
      blinkClock += dt * state.speed;
      if (blinkClock >= BLINK_SECONDS) {
        blinkClock = 0;
        blinkSide = 1 - blinkSide;
        const pair = getBlinkPair();
        if (pair) sequence.setTime(pair[blinkSide].t_mid);
      }
    } else {
      position = advance({ t: sequence.time() ?? sequence.span()[0], direction: position.direction }, dt,
        state.speed, sequence.span(), repeatSelect.value);
      sequence.setTime(position.t);
    }
    requestAnimationFrame(loop);
  }

  function setPlaying(next) {
    playing = next && sequence.playlist().length > 1;
    if (playing) blinking = false;
    state.autoplay = playing || undefined;
    lastTimestamp = null;
    showPlayButton();
    if (playing) requestAnimationFrame(loop);
    onStateChange();
  }

  function setBlinking(next) {
    const pair = getBlinkPair();
    blinking = next && Boolean(pair);
    if (blinking) {
      playing = false;
      blinkClock = 0;
      blinkSide = 0;
      sequence.setTime(pair[0].t_mid);
      lastTimestamp = null;
      requestAnimationFrame(loop);
    }
    showPlayButton();
  }

  function step(direction) {
    setPlaying(false);
    setBlinking(false);
    const next = stepFrame(sequence.playlist(), sequence.current(), direction);
    if (next) sequence.setTime(next.t_mid);
  }

  playButton.addEventListener('click', () => setPlaying(!playing));
  blinkButton.addEventListener('click', () => setBlinking(!blinking));
  root.querySelector('[data-step="-1"]').addEventListener('click', () => step(-1));
  root.querySelector('[data-step="1"]').addEventListener('click', () => step(1));
  speedSelect.addEventListener('change', () => {
    state.speed = Number(speedSelect.value);
    onStateChange();
  });
  slider.addEventListener('input', () => {
    setPlaying(false);
    setBlinking(false);
    const [first, last] = sequence.span();
    sequence.setTime(first + ((last - first) * Number(slider.value)) / SLIDER_STEPS);
  });

  window.addEventListener('keydown', (event) => {
    if (event.target.closest?.('input, select, textarea')) return;
    // Space on a focused button already presses that button.
    if (event.key === ' ' && event.target.closest?.('button')) return;
    if (event.key === ' ') {
      event.preventDefault();
      setPlaying(!playing);
    } else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key.toLowerCase() === 'b') setBlinking(!blinking);
  });

  // --- Showing where we are ---------------------------------------------------------------
  function showTime() {
    const t = sequence.time();
    const current = sequence.current();
    const [first, last] = sequence.span();
    if (t !== null && last > first) slider.value = String(Math.round(((t - first) / (last - first)) * SLIDER_STEPS));
    slider.disabled = sequence.playlist().length < 2;
    if (!current) {
      readout.textContent = '';
      return;
    }
    if (current.kind) {
      readout.textContent = current.label;
    } else {
      const visits = sequence.visits();
      const parts = [`${mjdToDate(current.t_mid)} UTC`];
      if (current.visit) parts.push(`Visit ${current.visit} of ${visits.length}`);
      if (current.detectors?.length === 1) parts.push(`D${current.detectors[0]}`);
      if (current.wavelength_um) parts.push(`${current.wavelength_um.toFixed(2)} µm`);
      parts.push(`${current.n_images} image${current.n_images === 1 ? '' : 's'}`);
      readout.textContent = parts.join(' · ');
      state.t = mjdToDate(current.t_mid);
    }
    for (const thumb of filmstrip.children) thumb.classList.toggle('is-current', thumb.dataset.id === current.id);
  }

  function showTicks() {
    const span = sequence.span();
    ticks.replaceChildren(...visitTicks(sequence.visits(), span).map((tick) => {
      const mark = document.createElement('span');
      mark.className = 'tick';
      mark.style.left = `${tick.position * 100}%`;
      mark.title = tick.label;
      return mark;
    }));
  }

  async function drawThumb(thumb, frame) {
    try {
      const bitmap = await sequence.bitmapFor(frame);
      const canvas = thumb.querySelector('canvas');
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, THUMB, THUMB);
      context.drawImage(bitmap, 0, 0, THUMB, THUMB);
    } catch {
      // leave the thumbnail empty
    }
  }

  function showFilmstrip() {
    const items = [...sequence.playlist(), ...sequence.results()];
    filmstrip.replaceChildren(...items.map((frame) => {
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'thumb';
      thumb.dataset.id = frame.id;
      thumb.title = frame.label;
      const detector = frame.detectors?.length === 1 ? frame.detectors[0] : null;
      thumb.style.borderColor = detector ? DETECTOR_COLOURS[detector - 1] : 'var(--teal)';
      const canvas = document.createElement('canvas');
      canvas.width = THUMB;
      canvas.height = THUMB;
      thumb.append(canvas);
      if (frame.kind) {
        const badge = document.createElement('span');
        badge.className = 'thumb-badge';
        badge.textContent = frame.badge;
        thumb.append(badge);
      }
      thumb.addEventListener('click', () => {
        setPlaying(false);
        setBlinking(false);
        if (frame.kind) sequence.pin(frame);
        else sequence.setTime(frame.t_mid);
      });
      drawThumb(thumb, frame);
      return thumb;
    }));
    showTime();
  }

  sequence.onChange((what) => {
    if (what === 'time') showTime();
    else if (what === 'visits') showTicks();
    else if (['frames', 'band', 'results', 'display', 'reset'].includes(what)) {
      showTicks();
      showFilmstrip();
    }
  });

  showPlayButton();
  return {
    setProgress(text) {
      progress.textContent = text;
    },
    setPlaying,
    isPlaying: () => playing,
  };
}
