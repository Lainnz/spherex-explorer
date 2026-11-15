/**
 * Stellar View (PLAN.md §8.3): the sky around a coordinate, Stellarium-style, with
 * navigation tools, layers and a shareable address. Phases 8–9 add the SPHEREx image
 * sequence, operations and data tabs.
 */
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/stellar.css';
import { Binoculars, Code, createElement, Link, Shuffle } from 'lucide';
import { getHealth, getJson } from '../shared/api.js';
import datasets from '../shared/config.js';
import { formatDec, formatRa } from '../shared/coords.js';
import { loadDemo } from '../shared/demo.js';
import { findFeatured } from '../shared/targets.js';
import { buildStellarUrl, readStellarState, stellarParams } from '../shared/url-state.js';
import { randomDestination } from '../title/randomize.js';
import { resolveQuery } from '../title/search.js';
import { setupControlPanel } from './control-panel.js';
import { setupSharing } from './embed.js';
import { setupLayers } from './layers.js';
import { parseRegion } from './nav-math.js';
import { setupNavTools } from './nav-tools.js';
import { createSkyView, SKY_MAPS } from './sky-view.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const limits = datasets.limits;
const START_FOV_DEG = 45; // start zoomed out, then ease in (PLAN.md §8.3)
const EASE_IN_SECONDS = 2.5;
const OBSERVATIONS_TIMEOUT_MS = 330_000; // IRSA searches take 2–3 minutes the first time

const $ = (selector) => document.querySelector(selector);
const { state, notices } = readStellarState(window.location.search, {
  limits,
  releases: Object.keys(datasets.releases),
  skyMaps: Object.keys(SKY_MAPS),
});

// --- Little helpers --------------------------------------------------------------------------
function toast(text, kind = 'info', seconds = 6) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.dataset.kind = kind;
  element.textContent = text;
  $('[data-toasts]').append(element);
  setTimeout(() => element.remove(), seconds * 1000);
}

const ICONS = { binoculars: Binoculars, shuffle: Shuffle, link: Link, code: Code };
for (const element of document.querySelectorAll('[data-icon]')) {
  element.prepend(createElement(ICONS[element.dataset.icon], { 'aria-hidden': 'true' }));
}

// Help bubbles for every "?" button (written for a curious 14-year-old).
const bubble = $('[data-help-bubble]');
document.addEventListener('click', (event) => {
  const help = event.target.closest('.help');
  if (!help) {
    bubble.hidden = true;
    return;
  }
  event.preventDefault();
  const box = help.getBoundingClientRect();
  bubble.textContent = help.dataset.help;
  bubble.hidden = false;
  bubble.style.left = `${Math.min(box.left, window.innerWidth - 300)}px`;
  bubble.style.top = `${box.bottom + 6}px`;
});

// Collapsible control panel on small screens.
$('.panel-toggle').addEventListener('click', (event) => {
  const panel = $('.control-panel');
  const collapsed = panel.dataset.collapsed !== 'true';
  panel.dataset.collapsed = String(collapsed);
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
});

// --- Keeping the address up to date --------------------------------------------------------
let sharing = null;
let writeTimer = null;
function writeUrl() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    window.history.replaceState(null, '', `?${stellarParams(state)}`);
    sharing?.refreshOpenLink();
  }, 250);
}

// --- Where to look -----------------------------------------------------------------------------
/** Decide the coordinate from the URL: ra/dec, then coords, then a target name. */
async function resolvePlace(live) {
  const featured = state.target ? findFeatured(state.target) : undefined;
  if (Number.isFinite(state.ra)) {
    return { ra: state.ra, dec: state.dec, name: featured?.name ?? state.target, featured };
  }
  if (featured) return { ra: featured.ra, dec: featured.dec, name: featured.name, featured };
  if (state.target && live) {
    try {
      const found = await getJson('/api/resolve', { name: state.target });
      return { ra: found.ra, dec: found.dec, name: found.name };
    } catch (error) {
      toast(error.message, 'warning');
    }
  } else if (state.target) {
    toast(`"${state.target}" needs the data server, which is asleep. Showing a featured target instead.`, 'warning');
  }
  const fallback = findFeatured('barnards-star');
  if (!state.target) toast("No coordinate in the address, so here's Barnard's Star.", 'info');
  return { ra: fallback.ra, dec: fallback.dec, name: fallback.name, featured: fallback };
}

// --- SPHEREx image outlines (and the image list Phase 8 will play) --------------------------
let observations = null;
async function loadObservations(sky, place, live) {
  const status = $('[data-observations]');
  const show = (polygons) => sky.setFootprints(polygons);
  const fromRows = (rows) => rows.map((row) => parseRegion(row.s_region)).filter(Boolean);
  show([]);

  if (live) {
    status.textContent = 'Finding SPHEREx images of this spot… (the first search can take about 3 minutes)';
    try {
      const params = { ra: place.ra, dec: place.dec, fov: state.fov };
      if (place.featured) params.target = place.featured.slug;
      if (state.release) params.releases = state.release.join(',');
      if (state.det) params.detectors = state.det.join(',');
      observations = await getJson('/api/observations', params, { timeoutMs: OBSERVATIONS_TIMEOUT_MS });
      show(fromRows(observations.observations));
      const releases = [...new Set(observations.observations.map((o) => o.release.toUpperCase()))].join(' + ');
      status.textContent = `${observations.total_available} SPHEREx images in ${observations.visits.length} visits (${releases}).`;
      return;
    } catch (error) {
      status.textContent = error.message;
      if (!place.featured) return;
    }
  }
  const demo = place.featured ? await loadDemo(place.featured.slug) : null;
  if (demo) {
    observations = demo.observations;
    show(fromRows(observations.observations));
    status.textContent = `Saved demo data from ${demo.built}: ${observations.returned} SPHEREx images in ${observations.visits.length} visits.`;
  } else if (!live) {
    status.textContent = 'The live data server is asleep, so only the all-sky map is shown here. Featured targets have saved data.';
  }
}

// --- Start ---------------------------------------------------------------------------------------
async function main() {
  notices.forEach((notice) => toast(notice, 'warning', 9));

  const health = state.demo ? null : await getHealth();
  const live = Boolean(health);
  for (const badge of document.querySelectorAll('[data-mode], [data-mode-embed]')) {
    badge.dataset.state = live ? 'live' : 'demo';
    badge.textContent = live ? 'Live' : 'Demo';
    badge.title = live ? 'Live data from NASA IRSA' : 'Saved demo data (the live data server is asleep or demo=1)';
  }
  $('[data-release]').textContent = (state.release ?? datasets.default_releases).map((r) => r.toUpperCase()).join(' + ');

  const place = await resolvePlace(live);
  state.ra = place.ra;
  state.dec = place.dec;
  if (place.featured) state.target = place.featured.slug;
  state.fov = state.fov ?? place.featured?.demo?.fov_arcsec ?? limits.default_fov_arcsec;
  const home = { ra: place.ra, dec: place.dec, fovDeg: state.fov / 3600 };
  const name = place.name ?? `${formatRa(place.ra)} ${formatDec(place.dec)}`;
  $('[data-target-name]').textContent = name;
  $('[data-embed-label]').textContent = name;
  document.title = `${name} · Stellar View · SPHEREx Xplorer`;

  let sky;
  try {
    sky = await createSkyView($('#aladin'), {
      ra: home.ra, dec: home.dec, fovDeg: reducedMotion ? home.fovDeg : START_FOV_DEG, rotation: state.rot ?? 0,
      base: state.base,
    });
  } catch (error) {
    $('[data-sky-loading]').hidden = true;
    const message = $('[data-sky-message]');
    message.hidden = false;
    message.textContent = "Your browser can't show the interactive sky (it needs WebGL 2). " +
      'Try an up-to-date Chrome, Edge or Firefox.';
    console.warn(error);
    return;
  }
  sky.setTarget(home.ra, home.dec);

  const layers = setupLayers({ root: $('.drawer'), sky, state, home, onChange: writeUrl });
  // Lift the "Loading the sky…" cover once the map is on screen (or after 15 s regardless).
  sky.whenReady().then(() => $('[data-sky-loading]').classList.add('is-done'));
  const panel = setupControlPanel({
    panel: $('.control-panel'), sky, limits, home,
    onFovSet: (arcsec) => { state.fov = arcsec; writeUrl(); },
  });
  setupNavTools({
    sky,
    surface: $('#sky'),
    toolbar: $('[data-toolbar]'),
    movedChip: $('[data-moved-chip]'),
    home,
    reducedMotion,
    onSetHome: (here) => {
      // A new spot: it's no longer the named target.
      state.ra = here.ra;
      state.dec = here.dec;
      delete state.target;
      $('[data-target-name]').textContent = `${formatRa(here.ra)} ${formatDec(here.dec)}`;
      panel.showCoordinate();
      layers.refreshCatalogues();
      writeUrl();
      toast('New coordinate set. Loading SPHEREx images…');
      loadObservations(sky, { ra: here.ra, dec: here.dec }, live);
    },
  });
  sharing = setupSharing({
    embed: Boolean(state.embed),
    copyButton: $('#copy-link'),
    embedButton: $('#embed-button'),
    openLink: $('[data-open-full]'),
    toast,
  });

  // Zoom and rotation go into the address (the panned centre doesn't: see the move tool).
  let easing = !reducedMotion;
  sky.on('zoomChanged', () => {
    if (easing) return;
    state.fov = Math.min(limits.max_fov_arcsec, Math.max(limits.min_fov_arcsec, sky.fovDeg() * 3600));
    writeUrl();
  });
  sky.on('rotationChanged', (angle) => {
    state.rot = Math.abs(angle) < 0.05 ? undefined : angle;
    writeUrl();
  });

  // Ease in from the wide view (continuing the title page's fly-away).
  if (easing) {
    sky.setFovDeg(home.fovDeg, { animate: true, seconds: EASE_IN_SECONDS, onDone: () => { easing = false; } });
  }
  writeUrl();
  loadObservations(sky, place, live);

  // Searching from the header opens a new Stellar View.
  const searchInput = $('#header-search-input');
  $('#header-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const destination = await resolveQuery(searchInput.value, { live });
      window.location.assign(buildStellarUrl({ ...destination, embed: state.embed }));
    } catch (error) {
      toast(error.message, 'warning');
    }
  });
  $('#header-random').addEventListener('click', async () => {
    const destination = await randomDestination({ live });
    window.location.assign(buildStellarUrl(destination));
  });
}

main();
