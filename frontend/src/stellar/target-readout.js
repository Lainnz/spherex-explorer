/**
 * Two time-bar additions from Elaine's time machine:
 * - "At target": the frame's brightness right at your coordinate (3×3 median), so you can
 *   watch a star brighten or fade as the frames play.
 * - "Same colour": play only frames that saw the target at the same SPHEREx colour (within
 *   half a channel), so a change in brightness isn't just a change in wavelength.
 */
import { positionAt } from '../shared/motion.js';
import { BLANK_PLANES, CUBE_WAVELENGTHS } from '../shared/wavelength.js';
import { valueAt } from './frame-geometry.js';
import { channelTolerance } from './timeline.js';

const format = (value) => (Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(3));

/**
 * @param {{root: HTMLElement, sequence: object, home: {ra: number, dec: number},
 *          motion?: object, toast: (text: string, kind?: string) => void}} options
 */
export function setupTargetReadout({ root, sequence, home, motion, toast }) {
  const output = root.querySelector('[data-target-value]');
  const sameColour = root.querySelector('[data-same-colour]');

  function showValue() {
    const frame = sequence.current();
    if (!frame || (frame.kind && frame.kind !== 'significance') || !frame.data) {
      output.textContent = '';
      return;
    }
    // Follow a moving star to where it was when this frame was taken.
    const where = motion && Number.isFinite(frame.t_mid) ? positionAt(motion, frame.t_mid) : home;
    const value = valueAt(frame, where.ra, where.dec);
    if (value === null) {
      output.textContent = 'At target: no data';
      return;
    }
    if (frame.kind === 'significance') output.textContent = `Change at target: ${value >= 0 ? '+' : ''}${value.toFixed(1)}σ${Math.abs(value) > 5 ? ' (real)' : ' (within noise)'}`;
    else if (frame.unit === 'MJy/sr') output.textContent = `At target: ${format(value)} MJy/sr`;
    else output.textContent = `At target: ${format(value)} σ above the background`;
  }

  function showLock() {
    const lock = sequence.wavelengthLock();
    sameColour.setAttribute('aria-pressed', String(Boolean(lock)));
    sameColour.textContent = lock ? `Only ${lock.um.toFixed(2)} µm` : 'Same colour';
  }

  sameColour.addEventListener('click', () => {
    if (sequence.wavelengthLock()) {
      sequence.setWavelengthLock(null);
    } else {
      const frame = sequence.current();
      const um = frame && !frame.kind ? frame.wavelength_um : null;
      if (!Number.isFinite(um)) {
        toast('Pick a single-detector frame first: merged frames mix several colours.', 'warning');
        return;
      }
      sequence.setWavelengthLock({ um, tolerance: channelTolerance(um, CUBE_WAVELENGTHS, BLANK_PLANES) });
      const count = sequence.playlist().length;
      toast(count > 1
        ? `Playing the ${count} frames at ${um.toFixed(2)} µm, so changes are in the object, not the colour.`
        : `Only this frame saw ${um.toFixed(2)} µm here. Try another frame or detector.`, count > 1 ? 'info' : 'warning');
    }
    showLock();
  });

  sequence.onChange((what) => {
    if (what === 'reset' && sequence.wavelengthLock()) sequence.setWavelengthLock(null);
    showLock();
    showValue();
  });
  showLock();
}
