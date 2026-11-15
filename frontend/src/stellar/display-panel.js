/**
 * Display controls in the left panel (PLAN.md §8.3, part 5), inspired by WiseView:
 * band, colour map, stretch, Trim Bright, Linear, frame mode, and the frames' visibility
 * on the sky. Changes go to the sequence (re-colouring is instant: the numbers are
 * already in the browser) and to the URL.
 */

/** "Linear" slider position (−2…1) ↔ asinh softening (0.01…10). */
const toSoftening = (position) => 10 ** position;
const toPosition = (softening) => Math.log10(softening);

/**
 * @param {{root: HTMLElement, sequence: object, state: object, overlay: object,
 *          onStateChange: () => void, onReload: () => void}} options
 */
export function setupDisplayPanel({ root, sequence, state, overlay, onStateChange, onReload }) {
  const band = root.querySelector('#band');
  const cmap = root.querySelector('#cmap');
  const stretch = root.querySelector('#stretch');
  const fixedRow = root.querySelector('[data-fixed-row]');
  const fixedMin = root.querySelector('#fixed-min');
  const fixedMax = root.querySelector('#fixed-max');
  const trim = root.querySelector('#trim');
  const trimValue = root.querySelector('[data-trim-value]');
  const linear = root.querySelector('#linear');
  const linearValue = root.querySelector('[data-linear-value]');
  const mode = root.querySelector('#frame-mode');
  const showFrames = root.querySelector('#show-frames');
  const frameOpacity = root.querySelector('#frame-opacity');

  // Start from the URL.
  band.value = state.det?.length === 1 ? String(state.det[0]) : 'all';
  cmap.value = state.cmap;
  stretch.value = state.stretch;
  trim.value = String(state.trim);
  linear.value = String(toPosition(state.linear));
  mode.value = state.mode;

  function showValues() {
    trimValue.textContent = `${Number(trim.value).toFixed(1)}%`;
    linearValue.textContent = Number(toSoftening(Number(linear.value)).toPrecision(2)).toString();
    fixedRow.hidden = stretch.value !== 'fixed';
  }

  function apply() {
    state.cmap = cmap.value;
    state.stretch = stretch.value;
    state.trim = Number(trim.value);
    state.linear = Number(toSoftening(Number(linear.value)).toPrecision(3));
    sequence.setDisplay({
      cmap: state.cmap,
      stretch: state.stretch,
      trim: state.trim,
      linear: state.linear,
      fixedMin: Number(fixedMin.value),
      fixedMax: Number(fixedMax.value),
    });
    showValues();
    onStateChange();
  }

  band.addEventListener('change', () => {
    sequence.setBand(band.value);
    onStateChange();
  });
  stretch.addEventListener('change', () => {
    if (stretch.value === 'fixed' && !fixedMin.value) {
      // Start the typed range from what's showing now.
      const frame = sequence.current();
      if (frame) {
        const [low, high] = sequence.rangeFor(frame);
        fixedMin.value = low.toPrecision(3);
        fixedMax.value = high.toPrecision(3);
      }
    }
    apply();
  });
  for (const control of [cmap, fixedMin, fixedMax]) control.addEventListener('change', apply);
  for (const slider of [trim, linear]) {
    slider.addEventListener('input', showValues);
    slider.addEventListener('change', apply); // re-colour once the slider is let go
  }
  mode.addEventListener('change', () => {
    state.mode = mode.value;
    onStateChange();
    onReload();
  });
  showFrames.addEventListener('change', () => overlay.setFramesVisible(showFrames.checked));
  frameOpacity.addEventListener('input', () => overlay.setOpacity(Number(frameOpacity.value)));
  root.querySelector('[data-reload]').addEventListener('click', onReload);

  showValues();
  return {
    /** The detector chosen in "Band", or null for all. */
    band: () => (band.value === 'all' ? null : Number(band.value)),
  };
}
