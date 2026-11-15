/**
 * Title page (PLAN.md §8.2): search or randomize, then fly away to the Stellar View.
 * The page works immediately; the 3D scene loads in the background and fades in.
 */
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/title.css';
import { Binoculars, createElement, Shuffle } from 'lucide';
import { getHealth } from '../shared/api.js';
import datasets from '../shared/config.js';
import { parseFov } from '../shared/fov.js';
import { featuredTargets } from '../shared/targets.js';
import { renderFooter } from '../shared/ui.js';
import { buildStellarUrl } from '../shared/url-state.js';
import { randomDestination } from './randomize.js';
import { resolveQuery } from './search.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const showFps = import.meta.env.DEV || new URLSearchParams(window.location.search).has('fps');

const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const message = document.querySelector('#search-message');
const randomButton = document.querySelector('#random-button');
const canvas = document.querySelector('#scene');
const veil = document.querySelector('.veil');
const fpsOutput = document.querySelector('#fps');
const healthLabel = document.querySelector('[data-health]');

let live = false; // is the data server awake?
let scene = null; // the 3D scene, once loaded
let busy = false;

// --- Icons (Lucide, ISC licence) -------------------------------------------------------
const ICONS = { binoculars: Binoculars, shuffle: Shuffle };
for (const button of document.querySelectorAll('[data-icon]')) {
  button.prepend(createElement(ICONS[button.dataset.icon], { 'aria-hidden': 'true' }));
}

// --- Featured-target chips and advanced options -----------------------------------------
const chips = document.querySelector('[data-chips]');
for (const target of featuredTargets) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = target.name;
  chip.title = target.description;
  chip.addEventListener('click', () => {
    input.value = target.name;
    form.requestSubmit();
  });
  chips.append(chip);
}

const detectorBox = document.querySelector('[data-detectors]');
for (let d = 1; d <= 6; d += 1) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="checkbox" value="${d}" checked /> D${d}`;
  detectorBox.append(label);
}

/** The Advanced settings, or defaults if they were left alone. */
function advancedOptions(destinationFov) {
  const details = document.querySelector('.advanced');
  const typed = parseFov(`${document.querySelector('#fov-value').value}${document.querySelector('#fov-unit').value}`);
  const limits = datasets.limits;
  const fov = details.open && typed ? Math.min(limits.max_fov_arcsec, Math.max(limits.min_fov_arcsec, typed)) : destinationFov;
  const detectors = [...detectorBox.querySelectorAll('input:checked')].map((box) => Number(box.value));
  const release = document.querySelector('#release').value.split(',');
  return {
    fov: fov ?? limits.default_fov_arcsec,
    detectors: detectors.length ? detectors : [1, 2, 3, 4, 5, 6],
    release: release.join(',') === datasets.default_releases.join(',') ? undefined : release,
  };
}

// --- Messages ---------------------------------------------------------------------------
function showMessage(text, { kind = 'info', suggestion } = {}) {
  message.dataset.kind = kind;
  message.textContent = text;
  if (suggestion) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Go to ${suggestion.name}`;
    button.addEventListener('click', () => {
      input.value = suggestion.name;
      form.requestSubmit();
    });
    message.append(' ', button);
  }
}

// --- Going somewhere ---------------------------------------------------------------------
function setBusy(value) {
  busy = value;
  for (const button of form.querySelectorAll('button')) button.disabled = value;
}

function go(destination) {
  const url = buildStellarUrl({ ...destination, ...advancedOptions(destination.fov) });
  showMessage(`Flying to ${destination.name}…`);
  if (!scene) {
    window.location.assign(url);
    return;
  }
  const skip = (event) => {
    if (event.type === 'click' || event.key === 'Escape') scene.skip();
  };
  window.addEventListener('click', skip);
  window.addEventListener('keydown', skip);
  scene.flyTo(destination, () => window.location.assign(url));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  showMessage('Looking that up…');
  try {
    go(await resolveQuery(input.value, { live }));
  } catch (error) {
    showMessage(error.message, { kind: 'error', suggestion: error.suggestion });
    setBusy(false);
  }
});

randomButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  showMessage('Picking somewhere to explore…');
  try {
    go(await randomDestination({ live }));
  } catch (error) {
    showMessage(error.message, { kind: 'error' });
    setBusy(false);
  }
});

// Coming back with the browser's Back button restores a frozen copy of the page whose 3D
// scene was already cleaned up, so start fresh.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

// --- Dialogs ------------------------------------------------------------------------------
for (const opener of document.querySelectorAll('[data-open]')) {
  opener.addEventListener('click', () => document.getElementById(opener.dataset.open).showModal());
}

// --- Data server status ------------------------------------------------------------------
renderFooter(document.querySelector('[data-footer]'));
getHealth().then((health) => {
  live = Boolean(health);
  healthLabel.dataset.state = live ? 'online' : 'offline';
  healthLabel.textContent = live
    ? `Live data · ${health.releases.map((r) => r.toUpperCase()).join(' + ')}`
    : 'Demo mode · saved data for the featured targets';
});

// --- 3D scene (loaded in the background) --------------------------------------------------
if (showFps) fpsOutput.hidden = false;

async function loadScene() {
  try {
    const { startScene } = await import('./scene.js');
    scene = await startScene(canvas, {
      reducedMotion,
      onFps: showFps ? (fps) => { fpsOutput.value = `${fps} fps`; } : undefined,
      onFade: (opacity) => { veil.style.opacity = String(opacity); },
    });
    canvas.classList.add('is-ready');
  } catch (error) {
    // No WebGL or a loading problem: the page still works with the plain starry background.
    console.warn('3D scene unavailable:', error);
  }
}
(window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200)))(loadScene);
