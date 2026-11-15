/**
 * The Stellar View's sky, powered by Aladin Lite (CDS, Strasbourg). This is the only file
 * that talks to Aladin directly; method names were checked against the pinned version's
 * source (docs/DATA_NOTES.md §9 and §15).
 *
 * Aladin Lite is loaded on demand from jsDelivr (the address in PLAN.md,
 * aladin.cds.unistra.fr/AladinLite/api/v3/<version>/, returned 404 on 2026-11-15).
 */
import { ALADIN_URL } from '../shared/aladin-url.js';
import { API_BASE } from '../shared/api.js';
import datasets from '../shared/config.js';
import { planeForWavelength } from '../shared/wavelength.js';

/**
 * SPHEREx false-colour recipes (from Elaine's demo). Each colour is ONE real SPHEREx channel
 * of the DR1 all-sky cube (nothing is averaged across detectors); the wavelengths are
 * targets and the nearest real channel is used. Our data server combines the three
 * channels into colour tiles (backend/app/skytools/hips.py), because Aladin Lite can't
 * blend cube planes itself.
 */
export const FALSE_COLOUR = {
  spherex_rgb: {
    short: 'Stars & warm dust',
    rgb: [4.6, 2.2, 1.25],
    note: 'Blue = 1.25 µm, green = 2.2 µm, red = 4.6 µm. Ordinary stars look blue-white; warm dust and deeply buried young stars glow red.',
  },
  spherex_rgb_pah: {
    short: 'Organic molecules (PAH, 3.3 µm)',
    rgb: [3.29, 3.12, 1.6],
    note: 'Red is the 3.3 µm band of PAHs (soot-like carbon molecules lit by ultraviolet starlight); green is the infrared just beside it. Clouds that glow red give off extra light exactly at 3.3 µm.',
  },
  spherex_rgb_bra: {
    short: 'Hydrogen gas (Brackett-α, 4.05 µm)',
    rgb: [4.05, 4.2, 3.9],
    note: 'Red is the 4.05 µm line of hot hydrogen gas; green and blue are the infrared on either side. Glowing gas clouds look red; things bright at all three look white.',
  },
};
const MOSAIC_NOTE = 'Real SPHEREx data: the DR1 all-sky mosaic (~13″ pixels), brightness stretched for viewing, so not for measurements. Stripes near very bright gas lines are a known artefact of the mosaic.';

/** Cube planes (0–101) for a false-colour recipe, e.g. [90, 46, 22]. */
export const falseColourPlanes = (key) => FALSE_COLOUR[key].rgb.map((um) => planeForWavelength(um));

/** Sky maps the user can pick, with honest labels (PLAN.md §2.4, §8.3). `server`: needs our data server. */
export const SKY_MAPS = {
  ...Object.fromEntries(Object.entries(FALSE_COLOUR).map(([key, recipe]) => [key, {
    label: `SPHEREx false colour: ${recipe.short} (DR1)`,
    url: `${API_BASE}/api/hips/spherex-rgb/${falseColourPlanes(key).join('-')}`,
    group: 'SPHEREx false colour',
    server: true,
    colormap: 'native', // the tiles are already in colour
    note: `${recipe.note} ${MOSAIC_NOTE}`,
  }])),
  spherex_cube: {
    label: 'SPHEREx all-sky, 102 colours (DR1, IRSA)', url: datasets.allsky_cube.hips_url, cube: true, group: 'SPHEREx',
    note: 'Real SPHEREx data: one of the 102 infrared colours at a time (pick it with the slider), straight from NASA IRSA.',
  },
  spherex_color: { label: 'SPHEREx colour (QR2, via CDS)', id: datasets.hips.spherex_color_qr2, group: 'SPHEREx' },
  ...Object.fromEntries(datasets.detectors.map((d) => [
    `spherex_${d.id.toLowerCase()}`,
    { label: `SPHEREx ${d.id}, ${d.em_min_um.toFixed(2)}–${d.em_max_um.toFixed(2)} µm (QR2, via CDS)`, id: datasets.hips[`spherex_${d.id}_qr2`], group: 'SPHEREx' },
  ])),
  wise_color: { label: 'AllWISE colour (NASA)', id: datasets.hips.wise_color, group: 'Other telescopes', note: 'Not SPHEREx: NASA WISE, 3.4–22 µm.' },
  unwise: { label: 'unWISE colour (NASA WISE)', id: datasets.hips.unwise, group: 'Other telescopes', note: 'Not SPHEREx: NASA WISE, re-processed.' },
  twomass: { label: '2MASS colour (NASA/IPAC)', id: datasets.hips.twomass, group: 'Other telescopes', note: 'Not SPHEREx: 2MASS near-infrared, 1.2–2.2 µm.' },
};

/** The map to fall back to when our data server is asleep: real SPHEREx data, served by IRSA. */
export const NO_SERVER_MAP = 'spherex_cube';

/** Aladin options for one sky map. */
const hipsOptions = (spec) => ({ name: spec.label, ...(spec.colormap ? { colormap: spec.colormap } : {}) });

export const CATALOGUE_LAYERS = {
  gaia: { label: 'Gaia DR3 stars (ESA)', vizier: datasets.catalogs.gaia_dr3, color: '#F0E442' },
  allwise: { label: 'AllWISE sources (NASA)', vizier: datasets.catalogs.allwise, color: '#E69F00' },
};
const CATALOGUE_MAX_RADIUS_DEG = 0.25; // keep catalogue downloads small
const VIEW_FOV_RANGE_DEG = [30 / 3600, 180];

let aladinModule = null;

/** Load Aladin Lite once. Rejects if the browser has no WebGL2. */
export async function loadAladin() {
  if (!aladinModule) {
    aladinModule = import(/* @vite-ignore */ ALADIN_URL).then(async (module) => {
      const A = module.default;
      await A.init;
      return A;
    });
  }
  return aladinModule;
}

/** Wait until an image layer has been added to the view (some methods need it). */
function whenAdded(layer, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (layer.added || Date.now() - started > timeoutMs) resolve(layer.added === true);
      else setTimeout(check, 100);
    };
    check();
  });
}

/**
 * @param {HTMLElement} container  Aladin restyles it (position: relative), so pass an inner
 *   element that fills a positioned wrapper (see stellar.html).
 * @param {{ra: number, dec: number, fovDeg: number, rotation?: number, base?: string}} start
 */
export async function createSkyView(container, { ra, dec, fovDeg, rotation = 0, base = 'spherex_rgb' }) {
  const A = await loadAladin();
  const startMap = SKY_MAPS[base] ?? SKY_MAPS[NO_SERVER_MAP];
  const aladin = A.aladin(container, {
    target: `${ra} ${dec}`,
    fov: fovDeg,
    // Start on our map; Aladin's default (DSS from CDS) failed to load on 2026-11-15.
    survey: startMap.url ?? startMap.id,
    // Don't send Aladin's start-up usage report (page address and referrer) to CDS's
    // logger; it also failed ("Failed to fetch") on 2026-11-15.
    log: false,
    cooFrame: 'ICRS',
    projection: 'SIN',
    backgroundColor: 'rgb(5, 10, 24)',
    // Our own controls replace Aladin's built-in ones.
    showReticle: false,
    showZoomControl: false,
    showFullscreenControl: false,
    showLayersControl: false,
    showCooGridControl: false,
    showSettingsControl: false,
    showShareControl: false,
    showSimbadPointerControl: false,
    showProjectionControl: false,
    showFrame: false,
    showFov: false,
    showCooLocation: false,
    showStatusBar: false,
    showContextMenu: false,
  });
  // aladin.setRotation() ignores 0 ("Rotation angle is not valid: 0" in 3.8.2), so rotate
  // through the view object, which accepts any angle.
  const setRotation = (deg) => aladin.view.setRotation(deg);
  setRotation(rotation);

  // Aladin keeps one callback per event, so fan out to our own listeners.
  const listeners = {};
  for (const name of ['positionChanged', 'zoomChanged', 'rotationChanged', 'click']) {
    listeners[name] = [];
    aladin.on(name, (value) => listeners[name].forEach((fn) => fn(value)));
  }

  let baseLayer = null;
  let cubePlane = null;
  const catalogues = {};
  let coverage = null;
  const footprints = A.graphicOverlay({ color: '#00B5BC', lineWidth: 1, name: 'SPHEREx images' });
  aladin.addOverlay(footprints);
  const targetMarker = A.catalog({ name: 'Your coordinate', shape: 'plus', color: '#00B5BC', sourceSize: 22 });
  aladin.addCatalog(targetMarker);

  const clampFov = (deg) => Math.min(VIEW_FOV_RANGE_DEG[1], Math.max(VIEW_FOV_RANGE_DEG[0], deg));

  return {
    aladin,
    on(name, fn) {
      listeners[name].push(fn);
    },
    center() {
      const [cra, cdec] = aladin.getRaDec();
      return { ra: cra, dec: cdec };
    },
    goTo(gra, gdec, { animate = false, seconds = 1 } = {}) {
      if (animate) aladin.animateToRaDec(gra, gdec, seconds);
      else aladin.gotoRaDec(gra, gdec);
    },
    /** Field of view across the screen, in degrees. */
    fovDeg() {
      return aladin.getFov()[0];
    },
    setFovDeg(deg, { animate = false, seconds = 0.35, onDone } = {}) {
      const fov = clampFov(deg);
      if (animate) aladin.zoomToFoV(fov, seconds, onDone);
      else {
        aladin.setFoV(fov);
        onDone?.();
      }
      return fov;
    },
    rotation() {
      return aladin.getRotation();
    },
    setRotation(deg) {
      setRotation(deg);
    },
    pixelToSky(x, y) {
      const result = aladin.pix2world(x, y);
      return result ? { ra: result[0], dec: result[1] } : null;
    },
    /** Screen position (CSS pixels inside the sky) of a sky position, or null if off-view. */
    skyToPixel(sra, sdec) {
      try {
        const result = aladin.world2pix(sra, sdec);
        return result && Number.isFinite(result[0]) ? { x: result[0], y: result[1] } : null;
      } catch {
        return null; // behind the visible hemisphere
      }
    },
    setTarget(tra, tdec) {
      targetMarker.removeAll();
      targetMarker.addSources([A.source(tra, tdec)]);
    },
    /** Choose the background sky map; for the 102-colour cube, also the plane. */
    async setBaseMap(key, plane) {
      const spec = SKY_MAPS[key];
      baseLayer = A.imageHiPS(spec.url ?? spec.id, hipsOptions(spec));
      aladin.setBaseImageLayer(baseLayer);
      if (spec.cube && Number.isInteger(plane)) await this.setPlane(plane);
    },
    /** Resolves once the background map is on screen (or after a timeout). */
    async whenReady() {
      if (baseLayer) await whenAdded(baseLayer);
    },
    async setPlane(plane) {
      cubePlane = plane;
      if (!baseLayer || !(await whenAdded(baseLayer))) return;
      if (cubePlane === plane) baseLayer.setSliceNumber(plane);
    },
    setOverlayMap(key, opacity) {
      aladin.removeImageLayer('overlay');
      if (!key) return;
      const spec = SKY_MAPS[key];
      const layer = A.imageHiPS(spec.url ?? spec.id, hipsOptions(spec));
      aladin.setOverlayImageLayer(layer, 'overlay');
      layer.setOpacity(opacity);
    },
    setOverlayOpacity(opacity) {
      aladin.getOverlayImageLayer('overlay')?.setOpacity(opacity);
    },
    /** Where SPHEREx has data (the DR1 all-sky cube's coverage map). */
    showCoverage(visible) {
      if (visible && !coverage) {
        coverage = A.MOCFromURL(`${datasets.allsky_cube.hips_url}/Moc.fits`, {
          color: '#00979D', opacity: 0.12, lineWidth: 1, fill: true, perimeter: true, name: 'SPHEREx coverage',
        });
        aladin.addMOC(coverage);
      } else if (coverage) {
        if (visible) coverage.show();
        else coverage.hide();
      }
    },
    /** Outlines of the SPHEREx images covering this spot: [[ra, dec], …] per image. */
    setFootprints(polygons) {
      footprints.removeAll();
      for (const corners of polygons) footprints.add(A.polygon(corners));
    },
    showFootprints(visible) {
      if (visible) footprints.show();
      else footprints.hide();
    },
    /**
     * Catalogue markers within a circle around (ra, dec). Loaded once per centre; turning
     * it off just hides it. (This Aladin version has no way to remove a catalogue.)
     */
    showCatalogue(key, visible, { ra: cra, dec: cdec, radiusDeg }) {
      const where = `${cra.toFixed(4)} ${cdec.toFixed(4)}`;
      const existing = catalogues[key];
      if (existing && (existing.where !== where || !visible)) existing.layer.hide();
      if (!visible) return;
      if (existing?.where === where) {
        existing.layer.show();
        return;
      }
      const spec = CATALOGUE_LAYERS[key];
      const layer = A.catalogFromVizieR(spec.vizier, where, Math.min(radiusDeg, CATALOGUE_MAX_RADIUS_DEG), {
        name: spec.label, color: spec.color, sourceSize: 10, shape: 'circle',
      });
      aladin.addCatalog(layer);
      catalogues[key] = { layer, where };
    },
  };
}
