/**
 * Left control panel, part 1 (PLAN.md §8.3, part 5): the coordinate and the field of view.
 * Phase 8 adds the WiseView-style display and frame controls below these.
 */
import { formatDec, formatRa } from '../shared/coords.js';
import { formatFov, parseFov } from '../shared/fov.js';

const UNIT_FACTORS = { s: 1, m: 60, d: 3600 };

/** The unit that shows a field of view most naturally. */
function bestUnit(arcsec) {
  if (arcsec >= 3600) return 'd';
  if (arcsec >= 120) return 'm';
  return 's';
}

/**
 * @param {{panel: HTMLElement, sky: object, limits: object, home: object,
 *          onFovSet: (arcsec: number) => void}} options
 */
export function setupControlPanel({ panel, sky, limits, home, onFovSet }) {
  const raDecimal = panel.querySelector('[data-ra]');
  const decDecimal = panel.querySelector('[data-dec]');
  const sexagesimal = panel.querySelector('[data-sexagesimal]');
  const fovInput = panel.querySelector('#fov-input');
  const fovUnit = panel.querySelector('#fov-unit');
  const fovNote = panel.querySelector('[data-fov-note]');

  function showCoordinate() {
    raDecimal.textContent = `${home.ra.toFixed(5)}°`;
    decDecimal.textContent = `${home.dec >= 0 ? '+' : ''}${home.dec.toFixed(5)}°`;
    sexagesimal.textContent = `${formatRa(home.ra)} ${formatDec(home.dec)}`;
  }

  function showFov() {
    if (document.activeElement === fovInput) return; // don't fight someone typing
    const arcsec = sky.fovDeg() * 3600;
    const unit = bestUnit(arcsec);
    fovUnit.value = unit;
    fovInput.value = String(Math.round((arcsec / UNIT_FACTORS[unit]) * 100) / 100);
    fovNote.textContent = arcsec > limits.max_fov_arcsec
      ? `Wider than SPHEREx frames (up to ${formatFov(limits.max_fov_arcsec)}).`
      : '';
  }

  function applyTyped() {
    const arcsec = parseFov(`${fovInput.value}${fovUnit.value}`);
    if (arcsec === null) {
      fovNote.textContent = 'Type a number, e.g. 10 with ′ selected.';
      return;
    }
    if (arcsec < limits.min_fov_arcsec || arcsec > limits.max_fov_arcsec) {
      fovNote.textContent = `Choose ${formatFov(limits.min_fov_arcsec)} to ${formatFov(limits.max_fov_arcsec)}.`;
      return;
    }
    fovNote.textContent = '';
    sky.setFovDeg(arcsec / 3600, { animate: true });
    onFovSet(arcsec);
  }

  fovInput.addEventListener('change', applyTyped);
  fovInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyTyped();
  });
  fovUnit.addEventListener('change', () => {
    // Switching unit converts the number instead of changing the zoom.
    const arcsec = sky.fovDeg() * 3600;
    fovInput.value = String(Math.round((arcsec / UNIT_FACTORS[fovUnit.value]) * 1000) / 1000);
  });
  sky.on('zoomChanged', showFov);

  showCoordinate();
  showFov();
  return { showCoordinate, showFov };
}
