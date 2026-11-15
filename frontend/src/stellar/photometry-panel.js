/**
 * The Spectrum and Light curve tabs (PLAN.md §7.7, §8.3 part 7): brightness of an object
 * in every SPHEREx image, streamed in point by point.
 * - Spectrum: brightness vs wavelength, coloured by detector (or by visit), optional
 *   binning into the 102 channels, flagged points hidden unless asked for, CSV.
 * - Light curve: brightness vs date within a wavelength window (like with like), CSV.
 *   For stars too bright for SPHEREx, the relative curve from the outer glow is offered.
 */
import { API_BASE, FriendlyError } from '../shared/api.js';
import { FEATURE_COLOURS, SPECTRAL_FEATURES } from '../shared/spectral-features.js';
import { CUBE_WAVELENGTHS, detectorOfPlane } from '../shared/wavelength.js';
import { createScatter, DETECTOR_COLOURS, visitColour } from './charts.js';
import { readLines } from './frames-source.js';
import { binSpectrum, defaultWindow, downloadText, inWindow, measurable, toCsv } from './photometry-math.js';
import { mjdToDate } from './timeline.js';

const CSV_COLUMNS = ['obs_id', 'release', 'survey', 'detector', 'visit', 't_mid', 't_mid_date', 'wavelength_um',
  'bandwidth_um', 'flux_ujy', 'err_ujy', 'flagged', 'saturated', 'bad_flags_in_aperture', 'wing_mjy_sr', 'wing_err_mjy_sr'];

const errorPoint = (x, y, err, extra) => ({ x, y, yMin: y - err, yMax: y + err, ...extra });

/**
 * @param {{spectrumTab: HTMLElement, curveTab: HTMLElement, state: object, live: boolean,
 *          getDemo: () => Promise<object|null>}} options
 */
export function setupPhotometry({ spectrumTab, curveTab, state, live, getDemo }) {
  const $s = (selector) => spectrumTab.querySelector(selector);
  const $c = (selector) => curveTab.querySelector(selector);
  let subject = null; // {name, ra, dec, target?, isDemoTarget}
  let points = [];
  let done = null;
  let controller = null;
  let spectrumChart = null;
  let curveChart = null;
  let drawQueued = false;
  let windowTouched = false;
  const listeners = new Set(); // told about new points (chemistry check, Milestone 3)
  let failure = null;
  const tell = () => listeners.forEach((fn) => fn({ subject, points, done, error: failure }));

  const status = (text) => {
    $s('[data-photometry-status]').textContent = text;
    $c('[data-photometry-status]').textContent = text;
  };

  // --- Drawing ---------------------------------------------------------------------------
  async function ensureCharts() {
    spectrumChart ??= await createScatter($s('canvas'), {
      xLabel: 'Wavelength (µm)',
      yLabel: 'Brightness (µJy)',
      features: SPECTRAL_FEATURES.map((f) => ({ um: f.um, label: f.label, colour: FEATURE_COLOURS[f.kind] })),
      tooltip: (p) => `${p.label}: ${p.y.toFixed(1)} ± ${((p.yMax - p.yMin) / 2).toFixed(1)} µJy at ${p.x.toFixed(3)} µm`,
    });
    curveChart ??= await createScatter($c('canvas'), {
      xLabel: 'Date (UTC)',
      yLabel: 'Brightness (µJy)',
      xTicks: (value) => mjdToDate(value),
      tooltip: (p) => `${p.label}: ${p.y.toFixed(p.relative ? 2 : 1)}${p.relative ? '×' : ' µJy'}`,
    });
  }

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(async () => {
      drawQueued = false;
      await ensureCharts();
      drawSpectrum();
      drawCurve();
    });
  }

  function drawSpectrum() {
    const showFlagged = $s('#show-flagged').checked;
    const colourBy = $s('#colour-by').value;
    const usable = measurable(points).filter((p) => showFlagged || !p.flagged);
    let datasets;
    if ($s('#bin-channels').checked) {
      const binned = binSpectrum(usable.filter((p) => !p.flagged), CUBE_WAVELENGTHS);
      datasets = [{
        label: 'Binned into SPHEREx channels',
        data: binned.map((b) => errorPoint(b.wavelength_um, b.flux_ujy, b.err_ujy, { label: `${b.n_points} points` })),
        backgroundColor: '#00B5BC', borderColor: '#00B5BC', errorBarColor: '#00B5BC',
      }];
    } else {
      const groups = new Map();
      for (const p of usable) {
        const key = colourBy === 'visit' ? `Visit ${p.visit}` : `D${p.detector}`;
        if (!groups.has(key)) groups.set(key, { colour: colourBy === 'visit' ? visitColour(p.visit) : DETECTOR_COLOURS[p.detector - 1], items: [] });
        groups.get(key).items.push(p);
      }
      datasets = [...groups.entries()].sort().map(([label, group]) => ({
        label,
        data: group.items.map((p) => errorPoint(p.wavelength_um, p.flux_ujy, p.err_ujy, { label: `${label} · ${p.t_mid_date}` })),
        borderColor: group.colour,
        errorBarColor: group.colour,
        // Flagged points are hollow.
        backgroundColor: group.items.map((p) => (p.flagged ? 'transparent' : group.colour)),
        pointRadius: 3,
      }));
    }
    spectrumChart.data.datasets = datasets;
    spectrumChart.options.plugins.featureLines.show = $s('#show-features').checked;
    spectrumChart.update('none');
    drawTable();
    const clean = measurable(points).filter((p) => !p.flagged).length;
    $s('[data-spectrum-summary]').textContent = points.length
      ? `${points.length} measurements · ${clean} clean${done?.saturated ? ` · ${done.saturated} saturated` : ''}`
      : '';
  }

  /** Elaine's table view: the clean points averaged per SPHEREx channel (only when open). */
  function drawTable() {
    const details = $s('[data-spectrum-table]');
    if (!details?.open) return;
    const binned = binSpectrum(measurable(points).filter((p) => !p.flagged), CUBE_WAVELENGTHS);
    details.querySelector('tbody').replaceChildren(...binned.map((b) => {
      const row = document.createElement('tr');
      for (const text of [b.wavelength_um.toFixed(3), b.flux_ujy.toFixed(1), b.err_ujy.toFixed(1), String(b.n_points), `D${detectorOfPlane(b.channel)}`]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    }));
    details.querySelector('[data-table-empty]').hidden = binned.length > 0;
  }

  function drawCurve() {
    const relative = $c('#curve-relative').checked;
    const minInput = $c('#window-min');
    const maxInput = $c('#window-max');
    if (!windowTouched) {
      const window = defaultWindow(points);
      if (window) {
        minInput.value = window[0].toFixed(2);
        maxInput.value = window[1].toFixed(2);
      }
    }
    const range = [Number(minInput.value) || 0, Number(maxInput.value) || 10];
    let datasets;
    if (relative) {
      const curve = (done?.relative_light_curve ?? []).filter((p) => p.wavelength_um >= range[0] && p.wavelength_um <= range[1]);
      const byDetector = groupBy(curve, (p) => p.detector);
      datasets = [...byDetector.entries()].map(([detector, items]) => ({
        label: `D${detector} (relative)`,
        data: items.map((p) => errorPoint(p.t_mid, p.relative, p.relative_err, { label: `D${detector} · ${mjdToDate(p.t_mid)}`, relative: true })),
        backgroundColor: DETECTOR_COLOURS[detector - 1], borderColor: DETECTOR_COLOURS[detector - 1], errorBarColor: DETECTOR_COLOURS[detector - 1],
      }));
      curveChart.options.scales.y.title.text = 'Relative brightness (1 = typical)';
    } else {
      const usable = inWindow(measurable(points), range).filter((p) => !p.flagged);
      const byDetector = groupBy(usable, (p) => p.detector);
      datasets = [...byDetector.entries()].map(([detector, items]) => ({
        label: `D${detector}`,
        data: items.map((p) => errorPoint(p.t_mid, p.flux_ujy, p.err_ujy, { label: `D${detector} · ${p.wavelength_um.toFixed(2)} µm · ${p.t_mid_date}` })),
        backgroundColor: DETECTOR_COLOURS[detector - 1], borderColor: DETECTOR_COLOURS[detector - 1], errorBarColor: DETECTOR_COLOURS[detector - 1],
      }));
      curveChart.options.scales.y.title.text = 'Brightness (µJy)';
    }
    curveChart.data.datasets = datasets;
    curveChart.update('none');
  }

  const groupBy = (items, key) => items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) ?? []), item]), new Map());

  // --- Measuring -----------------------------------------------------------------------------
  /**
   * Measure an object: the page's target, or something clicked on the sky.
   * @param {{name: string, ra: number, dec: number, target?: string, isDemoTarget?: boolean}} next
   */
  async function measure(next) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    subject = next;
    points = [];
    done = null;
    failure = null;
    windowTouched = false;
    $s('[data-subject]').textContent = subject.name;
    $c('[data-subject]').textContent = subject.name;
    $s('[data-warning]').hidden = true;
    queueDraw();

    try {
      let messages;
      if (live) {
        status('Measuring brightness in every SPHEREx image… (new spots can take a few minutes)');
        const body = { ra: subject.ra, dec: subject.dec, fov_arcsec: state.fov };
        if (subject.target) body.target = subject.target;
        if (state.release) body.releases = state.release;
        const response = await fetch(`${API_BASE}/api/photometry`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new FriendlyError(error.message || "The data server couldn't measure this.");
        }
        messages = readLines(response);
      } else {
        const demo = subject.isDemoTarget ? await getDemo() : null;
        if (!demo) throw new FriendlyError('Measuring other objects needs the live data server, which is asleep. The featured targets have saved measurements.');
        messages = demo.photometry_stream;
      }
      for await (const message of messages) {
        if (signal.aborted) return;
        if (message.type === 'start') $s('[data-method]').textContent = message.method;
        if (message.type === 'point') {
          points.push(message);
          status(`${points.length} measurements so far…`);
          queueDraw();
          tell();
        }
        if (message.type === 'done') {
          done = message;
          status(`${message.points} measurements${message.skipped ? ` (${message.skipped} images couldn't be measured)` : ''}${live ? '' : ' · saved demo data'}`);
          if (message.warning) {
            $s('[data-warning]').hidden = false;
            $s('[data-warning]').textContent = message.warning;
          }
          // Too bright for SPHEREx: the relative curve is the useful one.
          $c('#curve-relative').checked = Boolean(message.use_wing_light_curve);
          queueDraw();
          tell();
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        status(error.message);
        failure = error.message;
        tell();
      }
    }
  }

  // --- Controls --------------------------------------------------------------------------------
  for (const control of ['#show-flagged', '#bin-channels', '#colour-by', '#show-features']) $s(control).addEventListener('change', queueDraw);
  $s('[data-spectrum-table]').addEventListener('toggle', drawTable);
  $c('#curve-relative').addEventListener('change', queueDraw);
  for (const input of [$c('#window-min'), $c('#window-max')]) {
    input.addEventListener('change', () => {
      windowTouched = true;
      queueDraw();
    });
  }
  const filename = (kind) => `${(subject?.name ?? 'spherex').replace(/[^a-z0-9]+/gi, '_')}_${kind}.csv`;
  $s('[data-csv]').addEventListener('click', () => downloadText(toCsv(points, CSV_COLUMNS), filename('spectrum')));
  $c('[data-csv]').addEventListener('click', () => downloadText(toCsv(points, CSV_COLUMNS), filename('light_curve')));

  return {
    measure,
    /** Draw the charts now (a tab just became visible, so it has a size). */
    refresh: queueDraw,
    subject: () => subject,
    /** The measurements so far and whether they're finished. */
    current: () => ({ subject, points, done, error: failure }),
    /** Be told as measurements arrive: fn({subject, points, done}). */
    onUpdate(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
