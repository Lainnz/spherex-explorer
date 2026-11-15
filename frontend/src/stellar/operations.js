/**
 * Operations (PLAN.md §7.6, §8.3 part 6): Stack, Difference, Colour composite and the
 * one-click "Find moving objects". They run in the browser's Web Worker on frames
 * already downloaded, so there's no waiting for the server. Results appear in the
 * filmstrip with a badge.
 */
import { mjdToDate } from './timeline.js';
import { difference, stack } from './worker-client.js';

let resultCount = 0;

/** Copy the size and sky position of a frame for a result made from it. */
const resultFrom = (frame, extra) => ({
  width: frame.width, height: frame.height, wcs: frame.wcs, detectors: frame.detectors, unit: frame.unit, ...extra,
  id: `result-${(resultCount += 1)}`,
});

/**
 * @param {{root: HTMLElement, sequence: object, state: object, toast: (text: string, kind?: string) => void,
 *          onStateChange: () => void}} options
 */
export function setupOperations({ root, sequence, state, toast, onStateChange }) {
  const buttons = [...root.querySelectorAll('[data-op]')];
  const sections = [...root.querySelectorAll('[data-op-section]')];
  const visitA = root.querySelector('#visit-a');
  const visitB = root.querySelector('#visit-b');
  const normalize = root.querySelector('#normalize');
  const stackMethod = root.querySelector('#stack-method');
  const channels = ['#red', '#green', '#blue'].map((s) => root.querySelector(s));
  const colourVisit = root.querySelector('#colour-visit');

  function choose(op) {
    state.op = op;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.op === op));
    for (const section of sections) section.hidden = section.dataset.opSection !== op;
    onStateChange();
  }
  buttons.forEach((button) => button.addEventListener('click', () => choose(button.dataset.op)));

  /** The detector to work with: the Band choice, or the current frame's detector. */
  function workingDetector() {
    const band = sequence.band();
    if (band !== 'all') return Number(band);
    return sequence.current()?.detectors?.[0] ?? sequence.frames()[0]?.detectors?.[0];
  }
  const framesOf = (detector) => sequence.frames()
    .filter((f) => f.detectors?.length === 1 && f.detectors[0] === detector)
    .sort((a, b) => a.t_mid - b.t_mid);
  const frameOfVisit = (detector, visit) => framesOf(detector).find((f) => f.visit === visit);

  /** Fill the visit menus once frames have arrived. */
  function refreshVisits() {
    const visits = sequence.visits();
    for (const select of [visitA, visitB, colourVisit]) {
      const keep = select.value;
      select.replaceChildren(...visits.map((v) => new Option(v.label, String(v.visit))));
      if (select === visitB) select.prepend(new Option('Still-sky template (median of all visits)', 'template'));
      if ([...select.options].some((o) => o.value === keep)) select.value = keep;
    }
    if (!visitA.dataset.touched && visits.length) {
      visitA.value = String(state.a ?? visits.at(-1).visit);
      visitB.value = state.b ? String(state.b) : 'template';
      colourVisit.value = String(visits.at(-1).visit);
    }
  }
  visitA.addEventListener('change', () => { visitA.dataset.touched = '1'; state.a = Number(visitA.value); onStateChange(); });
  visitB.addEventListener('change', () => { state.b = visitB.value === 'template' ? undefined : Number(visitB.value); onStateChange(); });
  sequence.onChange((what) => { if (what === 'visits' || what === 'frames') refreshVisits(); });

  // --- The operations ----------------------------------------------------------------------
  async function makeStack() {
    const detector = workingDetector();
    const frames = framesOf(detector);
    if (frames.length < 2) return toast('Stacking needs at least two frames of the same detector.', 'warning');
    const method = stackMethod.value;
    const data = await stack(frames.map((f) => f.data), method);
    sequence.addResult(resultFrom(frames[0], {
      kind: 'stack', badge: 'Stack', data,
      label: `Stack (${method}) of ${frames.length} visits · D${detector}`,
    }));
  }

  async function template(detector) {
    const frames = framesOf(detector);
    return frames.length >= 2 ? stack(frames.map((f) => f.data), 'median') : null;
  }

  async function makeDifference(aVisit, bVisit) {
    const detector = workingDetector();
    const a = frameOfVisit(detector, aVisit);
    if (!a) return toast(`There's no D${detector} frame for visit ${aVisit}.`, 'warning');
    let bData;
    let bLabel;
    if (bVisit === 'template') {
      bData = await template(detector);
      bLabel = 'still-sky template';
      if (!bData) return toast('A still-sky template needs at least two visits.', 'warning');
    } else {
      const b = frameOfVisit(detector, bVisit);
      if (!b) return toast(`There's no D${detector} frame for visit ${bVisit}.`, 'warning');
      bData = b.data;
      bLabel = `visit ${bVisit} (${mjdToDate(b.t_mid)})`;
    }
    const data = await difference(a.data, bData, normalize.checked);
    sequence.addResult(resultFrom(a, {
      kind: 'difference', badge: 'Diff', data,
      label: `Difference · D${detector}: visit ${aVisit} (${mjdToDate(a.t_mid)}) − ${bLabel}. ` +
        'Movers show as black/white pairs.',
    }));
  }

  function makeComposite() {
    const visit = Number(colourVisit.value);
    const picked = channels.map((select) => frameOfVisit(Number(select.value), visit));
    if (picked.some((f) => !f)) {
      return toast('A colour picture needs a frame from each chosen detector in that visit. Try other detectors.', 'warning');
    }
    sequence.addResult(resultFrom(picked[0], {
      kind: 'composite', badge: 'Colour', channels: picked.map((f) => f.data), detectors: [],
      label: `Colour · visit ${visit}: red D${channels[0].value}, green D${channels[1].value}, blue D${channels[2].value}`,
    }));
  }

  /** The preset: the latest visit minus the still-sky template. */
  async function findMovingObjects() {
    const detector = workingDetector();
    const frames = framesOf(detector);
    if (frames.length < 2) return toast('Finding moving objects needs at least two visits.', 'warning');
    choose('diff');
    visitA.value = String(frames.at(-1).visit);
    visitB.value = 'template';
    await makeDifference(frames.at(-1).visit, 'template');
    toast('Latest visit minus the still-sky template: anything that moved shows as a black/white pair.');
  }

  const run = (fn) => async () => {
    try {
      await fn();
    } catch (error) {
      toast(`That didn't work: ${error.message}`, 'warning');
    }
  };
  root.querySelector('[data-run="stack"]').addEventListener('click', run(makeStack));
  root.querySelector('[data-run="diff"]').addEventListener('click', run(() => makeDifference(
    Number(visitA.value), visitB.value === 'template' ? 'template' : Number(visitB.value),
  )));
  root.querySelector('[data-run="composite"]').addEventListener('click', run(makeComposite));
  root.querySelector('[data-find-movers]').addEventListener('click', run(findMovingObjects));

  choose(state.op ?? 'none');
  return {
    /** Run the operation named in the URL once all frames are in. */
    async applyFromUrl() {
      refreshVisits();
      if (state.op === 'stack') await run(makeStack)();
      if (state.op === 'diff' && state.a) await run(() => makeDifference(state.a, state.b ?? 'template'))();
      if (state.op === 'composite') run(makeComposite)();
    },
    /** For Blink: frames of visits A and B for the working detector, or first and last. */
    blinkPair() {
      const detector = workingDetector();
      const frames = framesOf(detector);
      if (frames.length < 2) return null;
      const a = frameOfVisit(detector, Number(visitA.value)) ?? frames.at(-1);
      const b = (visitB.value !== 'template' && frameOfVisit(detector, Number(visitB.value))) || frames[0];
      return a === b ? [frames[0], frames.at(-1)] : [b, a];
    },
  };
}
