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
import { viewPosition } from '../shared/motion.js';
import { findFeatured } from '../shared/targets.js';
import { buildStellarUrl, readStellarState, stellarParams } from '../shared/url-state.js';
import { randomDestination } from '../title/randomize.js';
import { resolveQuery } from '../title/search.js';
import { setupControlPanel } from './control-panel.js';
import { setupDisplayPanel } from './display-panel.js';
import { setupSharing } from './embed.js';
import { createFrameOverlay } from './frame-overlay.js';
import { setupFlagsPanel } from './flags-panel.js';
import { setupFramePlayer } from './frame-player.js';
import { loadFrames } from './frames-source.js';
import { setupInfoPanel } from './info-panel.js';
import { setupLayers } from './layers.js';
import { setupListsMenu } from './lists-menu.js';
import { parseRegion } from './nav-math.js';
import { setupNavTools } from './nav-tools.js';
import { setupObjectPopup } from './object-popup.js';
import { setupOperations } from './operations.js';
import { setupPhotometry } from './photometry-panel.js';
import { setupTabs } from './tabs.js';
import { setupTargetReadout } from './target-readout.js';
import { setupChemistryPanel } from './chemistry-panel.js';
import { createSequence } from './sequence.js';
import { createSkyView, NO_SERVER_MAP, SKY_MAPS } from './sky-view.js';
import { setupTimeBar } from './time-bar.js';
import { dateToMjd } from './timeline.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const limits = datasets.limits;
const START_FOV_DEG = 45; // start zoomed out, then ease in (PLAN.md §8.3)
const EASE_IN_SECONDS = 2.5;
const OBSERVATIONS_TIMEOUT_MS = 330_000; // IRSA searches take 2–3 minutes the first time
// First frames from a handful of images (~4 MB each), then the full set in the background.
const QUICK_PREVIEW_IMAGES = 24;

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

/** Show a server warning (e.g. "QR3 isn't answering") once, however many requests carry it. */
const shownWarnings = new Set();
function warnOnce(text) {
  if (!text || shownWarnings.has(text)) return;
  shownWarnings.add(text);
  toast(text, 'warning', 12);
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
// The sky map that was asked for, when the false-colour map had to wait for the data server.
// The address keeps the wanted map, so a reload shows colour once the server is back.
let wantedBase = null;

function writeUrl() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const keep = wantedBase && state.base === NO_SERVER_MAP ? { ...state, base: wantedBase } : state;
    window.history.replaceState(null, '', `?${stellarParams(keep)}`);
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
  // Fast movers: point at where they are now (shared/motion.js).
  if (featured) return { ...viewPosition(featured), name: featured.name, featured };
  if (state.target && live) {
    try {
      const found = await getJson('/api/resolve', { name: state.target });
      return { ...viewPosition(found), name: found.name, motion: found.motion };
    } catch (error) {
      toast(error.message, 'warning');
    }
  } else if (state.target) {
    toast(`"${state.target}" needs the data server, which is asleep. Showing a featured target instead.`, 'warning');
  }
  const fallback = findFeatured('barnards-star');
  if (!state.target) toast("No coordinate in the address, so here's Barnard's Star.", 'info');
  return { ...viewPosition(fallback), name: fallback.name, featured: fallback };
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
      if (observations.warning) status.textContent += ' Some data is missing for now (see message).';
      warnOnce(observations.warning);
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

// --- The image sequence (Phase 8) -----------------------------------------------------------------
/**
 * Set up the time bar, display controls, operations and frame overlay, and return a
 * function that (re)loads the frames for the current coordinate and settings.
 */
function setupSequence({ sky, place, live, home }) {
  const sequence = createSequence({ cmap: state.cmap, stretch: state.stretch, trim: state.trim, linear: state.linear });
  if (state.det?.length === 1) sequence.setBand(String(state.det[0]));
  const overlay = createFrameOverlay({ container: $('#sky'), sky, sequence, reducedMotion });
  if (import.meta.env.DEV) Object.assign(window, { __sequence: sequence, __overlay: overlay }); // debugging only
  const motion = place.featured?.motion ?? place.motion;
  if (motion) overlay.setTarget({ name: place.featured?.name ?? place.name ?? 'Target', motion });

  let operations = null;
  const timeBar = setupTimeBar({
    root: $('.time-bar'), sequence, state, onStateChange: writeUrl, getBlinkPair: () => operations?.blinkPair(),
  });
  setupDisplayPanel({ root: $('.control-panel'), sequence, state, overlay, onStateChange: writeUrl, onReload: () => load() });
  operations = setupOperations({ root: $('.control-panel'), sequence, state, toast, onStateChange: writeUrl, live });
  setupFramePlayer({ panel: $('[data-frame-player]'), toggle: $('#player-toggle'), sequence });
  setupTargetReadout({ root: $('.time-bar'), sequence, home, motion, toast });

  // The slider's date and the Band choice go into the address (not every frame of playback).
  sequence.onChange((what) => {
    if (what === 'time' && !timeBar.isPlaying()) writeUrl();
    if (what === 'band') {
      state.det = sequence.band() === 'all' ? undefined : [Number(sequence.band())];
      writeUrl();
    }
  });

  let controller = null;
  let firstLoad = true;
  let excludeFlags = null; // null = the server's default bad-pixel list (Flags tab can change it)

  async function loadMovers() {
    if (!live) {
      // Saved with the demo data (for the featured target's own field).
      const demo = place.featured ? await loadDemo(place.featured.slug) : null;
      overlay.setMovers(demo?.movers ?? []);
      return;
    }
    try {
      const radius = Math.min(0.5, Math.max(0.02, (state.fov / 3600) * 0.75));
      const { movers } = await getJson('/api/movers', { ra: home.ra, dec: home.dec, radius });
      overlay.setMovers(movers);
    } catch {
      overlay.setMovers([]); // markers are a bonus; the frames still play
    }
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    timeBar.setPlaying(false);
    sequence.reset();
    timeBar.setProgress('Getting SPHEREx images…');
    loadMovers();

    const atTarget = place.featured && home.ra === place.ra && home.dec === place.dec;
    const request = {
      ra: home.ra, dec: home.dec, fov_arcsec: state.fov, mode: state.mode,
      ...(atTarget ? { target: place.featured.slug } : {}),
      ...(state.release ? { releases: state.release } : {}),
      ...(state.det && state.det.length > 1 ? { detectors: state.det } : {}),
      ...(excludeFlags ? { exclude_flags: excludeFlags } : {}),
    };
    let demo = null;
    if (!live && atTarget) {
      demo = await loadDemo(place.featured.slug);
      if (demo && state.mode !== 'epoch') toast('Saved demo data has per-visit frames only.', 'warning');
    }

    let total = 0;
    let ready = 0;
    let imagesInPreview = 0;
    let previewed = false;
    // Live: a quick preview from a few images first, then the full set (sharpenInBackground).
    const attempt = (useLive) => loadFrames({
      live: useLive, request: useLive ? { ...request, max_images: QUICK_PREVIEW_IMAGES } : request, demo, signal,
      onStart: (start) => {
        total = start.frames_total;
        imagesInPreview = start.images_total;
        warnOnce(start.warning);
        if (start.grid) sequence.setGrid(start.grid);
        sequence.setVisits(start.visits ?? []);
        const downloads = start.images_to_download;
        timeBar.setProgress(downloads
          ? `Downloading ${downloads} image pieces (≈${Math.round(start.estimated_download_mb)} MB) from NASA… the first time can take a few minutes.`
          : `Preparing ${total} frames…`);
      },
      onFrame: (frame) => {
        sequence.addFrame(frame);
        ready += 1;
        timeBar.setProgress(`${ready} of ${total} frames ready`);
      },
      onProgress: () => {},
      onDone: (done) => {
        const failed = done.images_failed ? ` (${done.images_failed} images couldn't be used)` : '';
        timeBar.setProgress(`${ready} frames${failed} · ${demo && !useLive ? `saved demo data from ${demo.built}` : 'live from NASA IRSA'}`);
      },
    });

    try {
      try {
        await attempt(live);
        previewed = live;
      } catch (error) {
        if (signal.aborted) return;
        // Live failed: fall back to saved data for featured targets.
        if (live && atTarget && (demo ??= await loadDemo(place.featured.slug))) {
          toast(`${error.message} Showing saved demo data instead.`, 'warning', 9);
          sequence.reset();
          ready = 0;
          await attempt(false);
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      timeBar.setProgress(error.message);
      return;
    }
    if (signal.aborted) return;

    // Start where the address says, then get every picture ready for smooth playback.
    const startTime = firstLoad && state.t ? dateToMjd(state.t) : null;
    if (startTime !== null) sequence.setTime(startTime);
    else if (sequence.playlist().length) sequence.setTime(sequence.playlist()[0].t_mid);
    await sequence.prepareAll();
    if (firstLoad) {
      await operations.applyFromUrl();
      if (state.autoplay) timeBar.setPlaying(true);
    }
    firstLoad = false;
    // A preview used every image there is? Then there's nothing sharper to fetch.
    if (previewed && imagesInPreview >= QUICK_PREVIEW_IMAGES) sharpenInBackground(request, signal);
  }

  /**
   * Fetch the full set of images while the preview plays, then swap the sharper frames in
   * at once, keeping the date and band. The frames' grid doesn't depend on how many images
   * are used, so the preview's downloads are reused.
   */
  async function sharpenInBackground(request, signal) {
    const fresh = [];
    let start = null;
    try {
      await loadFrames({
        live: true, request, signal,
        onStart: (message) => {
          start = message;
          timeBar.setProgress(`${sequence.playlist().length} preview frames · getting more images for sharper frames…`);
        },
        onFrame: (frame) => {
          fresh.push(frame);
          timeBar.setProgress(`${sequence.playlist().length} preview frames · sharper frames ${fresh.length} of ${start?.frames_total ?? '?'}…`);
        },
        onProgress: () => {},
        onDone: () => {},
      });
    } catch {
      if (!signal.aborted) timeBar.setProgress(`${sequence.playlist().length} frames (preview) · live from NASA IRSA`);
      return;
    }
    if (signal.aborted || !fresh.length) return;
    if (start?.grid) sequence.setGrid(start.grid);
    sequence.setVisits(start?.visits ?? []);
    sequence.replaceFrames(fresh);
    timeBar.setProgress(`${fresh.length} frames from ${start?.images_total ?? '?'} images · live from NASA IRSA`);
    await sequence.prepareAll();
  }

  /** Flags tab: remake the frames leaving out a different set of flagged pixels. */
  function setExclude(flags) {
    if (!live) {
      toast('Remaking frames needs the live data server; saved demo frames use the standard bad-pixel list.', 'warning');
      return;
    }
    excludeFlags = flags;
    load();
  }

  return { load, setExclude, sequence, overlay };
}

// --- Start ---------------------------------------------------------------------------------------
let popup = null; // the click-to-identify popup (created once the sky is ready)

/**
 * Live RA/Dec under the mouse (from Elaine's demo). Reads the pointer on the sky's wrapper,
 * so it works in both the rotate tool (where a see-through layer covers Aladin) and the move tool.
 */
function setupCursorReadout(sky) {
  const surface = $('#sky');
  const readout = $('[data-cursor]');
  let queued = null;
  surface.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const box = surface.getBoundingClientRect();
    queued = { x: event.clientX - box.left, y: event.clientY - box.top };
    requestAnimationFrame(() => {
      if (!queued) return;
      const where = sky.pixelToSky(queued.x, queued.y);
      queued = null;
      readout.textContent = where && Number.isFinite(where.ra) && Number.isFinite(where.dec)
        ? `${formatRa(where.ra)} ${formatDec(where.dec)} · ${where.ra.toFixed(4)}°, ${where.dec >= 0 ? '+' : ''}${where.dec.toFixed(4)}°`
        : 'Off the sky';
    });
  });
  surface.addEventListener('pointerleave', () => {
    queued = null;
    readout.textContent = 'Point at the sky to read its coordinates';
  });
}

/**
 * The false-colour sky (and live data) need our data server. Say so plainly, with the
 * command to start it, and reload by itself once the server answers.
 */
function showServerBanner() {
  const banner = $('[data-server-banner]');
  banner.hidden = false;
  const timer = setInterval(async () => {
    if (await getHealth(2500)) {
      clearInterval(timer);
      banner.querySelector('p').textContent = 'The data server is back. Switching to the colour sky…';
      setTimeout(() => window.location.reload(), 800);
    }
  }, 8000);
  banner.querySelector('[data-close]').addEventListener('click', () => { banner.hidden = true; });
}

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

  // The false-colour map is made by our data server; without it, show SPHEREx's own
  // 102-colour map (still real SPHEREx data, served straight from NASA IRSA).
  if (!live && SKY_MAPS[state.base]?.server) {
    wantedBase = state.base;
    state.base = NO_SERVER_MAP;
    showServerBanner();
  }
  if (!live && SKY_MAPS[state.overlay]?.server) delete state.overlay;

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
  if (import.meta.env.DEV) window.__sky = sky; // for debugging in the browser console only

  setupCursorReadout(sky);
  const layers = setupLayers({ root: $('.drawer'), sky, state, home, live, onChange: writeUrl });
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
    onSkyClick: (click) => popup?.show(click),
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
      images.load();
    },
  });
  const images = setupSequence({ sky, place, live, home });
  // Match the sky map's colour to the frame shown (once playback settles, to spare downloads).
  const matchBox = $('#match-wavelength');
  let matchTimer = null;
  const matchNow = () => {
    clearTimeout(matchTimer);
    matchTimer = setTimeout(() => {
      const frame = images.sequence.current();
      if (matchBox.checked && frame && !frame.kind && frame.detectors?.length === 1 && Number.isFinite(frame.wavelength_um)) {
        layers.matchWavelength(frame.wavelength_um);
      }
    }, 600);
  };
  images.sequence.onChange((what) => { if (what === 'time' || what === 'band') matchNow(); });
  matchBox.addEventListener('change', matchNow);

  // --- Phase 9: clicking objects, the data tabs, favourites ----------------------------------
  const getDemo = () => (place.featured ? loadDemo(place.featured.slug) : Promise.resolve(null));
  const targetSubject = () => {
    const atTarget = Boolean(place.featured) && home.ra === place.ra && home.dec === place.dec;
    return {
      name: atTarget ? place.featured.name : (place.name ?? `${formatRa(home.ra)} ${formatDec(home.dec)}`),
      ra: home.ra,
      dec: home.dec,
      target: atTarget ? place.featured.slug : undefined,
      isDemoTarget: atTarget,
    };
  };
  setupListsMenu($('[data-lists]'));
  const photometry = setupPhotometry({ spectrumTab: $('#tab-spectrum'), curveTab: $('#tab-curve'), state, live, getDemo });
  const tabs = setupTabs($('.drawer'), {
    onShow: (panelId) => {
      if (panelId !== 'tab-spectrum' && panelId !== 'tab-curve') return;
      if (!photometry.subject()) photometry.measure(targetSubject()); // measured when first needed
      photometry.refresh();
    },
  });
  setupChemistryPanel({
    root: $('#tab-chemistry'), state, home, live, photometry, subject: targetSubject, onChange: writeUrl, toast,
  });
  if (state.find) tabs.open('tab-chemistry');
  setupInfoPanel({ root: $('#tab-info'), sequence: images.sequence, state, live, getDemo });
  setupFlagsPanel({
    root: $('#tab-flags'), sequence: images.sequence, overlay: images.overlay, state, live, getDemo,
    onExcludeChange: (flags) => images.setExclude(flags),
  });
  popup = setupObjectPopup({
    container: $('#sky'), sky, sequence: images.sequence, live, place, getDemo,
    onMeasure: (subject) => {
      tabs.open('tab-spectrum');
      photometry.measure(subject);
    },
  });
  // In move mode Aladin receives the clicks itself.
  sky.on('click', (click) => {
    if (!click.isDragging) popup.show(click);
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
  images.load();

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
