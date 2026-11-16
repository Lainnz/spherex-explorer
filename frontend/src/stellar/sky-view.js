/**
 * The Stellar View's sky, powered by Aladin Lite (CDS, Strasbourg). This is the only file
 * that talks to Aladin directly; method names were checked against the pinned version's
 * source (docs/DATA_NOTES.md §9 and §15).
 *
 * Aladin Lite is loaded on demand from jsDelivr (the address in PLAN.md,
 * aladin.cds.unistra.fr/AladinLite/api/v3/<version>/, returned 404 on 2026-11-15).
 */
import { ALADIN_URL } from '../shared/aladin-url.js';
import { API_BASE, getJson } from '../shared/api.js';
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
  spherex_color: {
    label: 'SPHEREx colour, 6 detectors (QR2, CDS)', urls: datasets.hips.spherex_color_qr2, group: 'SPHEREx',
    note: 'Real SPHEREx data, combined into colour by CDS (Strasbourg). Only on CDS servers, so it may be unavailable.',
  },
  ...Object.fromEntries(datasets.detectors.map((d) => [
    `spherex_${d.id.toLowerCase()}`,
    {
      label: `SPHEREx ${d.id}, ${d.em_min_um.toFixed(2)}–${d.em_max_um.toFixed(2)} µm (QR2, CDS)`, urls: datasets.hips[`spherex_${d.id}_qr2`], group: 'SPHEREx',
      note: 'Real SPHEREx data from one detector, prepared by CDS (Strasbourg). Only on CDS servers, so it may be unavailable.',
    },
  ])),
  // Other telescopes, shortest wavelength first. Each has a list of mirrors (config/datasets.json).
  dss2_color: {
    label: 'DSS2 colour: visible light (Palomar & UK Schmidt)', urls: datasets.hips.dss2_color, group: 'Other telescopes',
    note: 'Not SPHEREx: Digitized Sky Survey photographic plates, about 0.4–0.9 µm, roughly what a big telescope shows the eye. Dust clouds look dark here but glow in infrared.',
  },
  twomass: {
    label: '2MASS colour: near-infrared 1.2–2.2 µm', urls: datasets.hips.twomass, group: 'Other telescopes',
    note: 'Not SPHEREx: Two Micron All Sky Survey (ground-based, 1997–2001), J, H, K bands as blue, green, red. Overlaps SPHEREx\'s shortest colours.',
  },
  wise_color: {
    label: 'AllWISE colour: infrared 3.4–22 µm (NASA WISE)', urls: datasets.hips.wise_color, group: 'Other telescopes',
    note: 'Not SPHEREx: NASA WISE space telescope, W1 (3.4 µm), W2 (4.6 µm), W4 (22 µm) as blue, green, red. Warm dust glows red.',
  },
  unwise: {
    label: 'unWISE colour: 3.4 & 4.6 µm (NASA WISE, re-processed)', urls: datasets.hips.unwise, group: 'Other telescopes',
    note: 'Not SPHEREx: WISE/NEOWISE images re-processed to go deeper. Only on CDS servers, so it may be unavailable.',
  },
  iras_iris: {
    label: 'IRAS colour: far-infrared 12–100 µm (IRIS)', urls: datasets.hips.iras_iris, group: 'Other telescopes',
    note: 'Not SPHEREx: IRAS (1983), re-processed as IRIS. Shows cold dust SPHEREx can\'t see, but very blurry up close (about 4′ pixels).',
  },
};

/** The map to fall back to when our data server is asleep: real SPHEREx data, served by IRSA. */
export const NO_SERVER_MAP = 'spherex_cube';

/** Tile servers for a sky map, in the order to try them. */
export const mapSources = (spec) => (spec.url ? [spec.url] : spec.urls ?? []);

/** Aladin options for one sky map. */
const hipsOptions = (spec) => ({ name: spec.label, ...(spec.colormap ? { colormap: spec.colormap } : {}) });

/**
 * Catalogue markers. With the data server they come from /api/catalogs (Elaine's route:
 * cached for a day, with a backup service for each catalogue, because CDS was down on
 * 2026-11-14/15). Without it, Gaia and AllWISE come straight from VizieR; SIMBAD needs the server.
 */
export const CATALOGUE_LAYERS = {
  simbad: { label: 'Known objects (SIMBAD)', color: '#CC79A7', shape: 'square', size: 11, vizier: null },
  gaia: { label: 'Gaia DR3 stars (ESA)', vizier: datasets.catalogs.gaia_dr3, color: '#F0E442', shape: 'circle', size: 8 },
  allwise: { label: 'AllWISE sources (NASA)', vizier: datasets.catalogs.allwise, color: '#E69F00', shape: 'rhomb', size: 10 },
};
const CATALOGUE_MAX_RADIUS_DEG = 0.5; // the server's limit; keeps downloads small
/** A marker's name: SIMBAD name, AllWISE designation or Gaia source id. */
const rowName = (row) => row.main_id ?? row.designation ?? (row.source_id ? `Gaia DR3 ${row.source_id}` : '');
const VIEW_FOV_RANGE_DEG = [30 / 3600, 180];
const MIRROR_TIMEOUT_MS = 12000; // per tile server, before trying the next mirror

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
    survey: mapSources(startMap)[0],
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
  for (const name of ['positionChanged', 'zoomChanged', 'rotationChanged', 'click', 'mouseMove']) {
    listeners[name] = [];
    aladin.on(name, (value) => listeners[name].forEach((fn) => fn(value)));
  }

  let baseLayer = null;
  let cubePlane = null;
  const catalogues = {};
  const wanted = {}; // latest request per catalogue, so a slow download can't reappear after unticking
  let coverage = null;
  const footprints = A.graphicOverlay({ color: '#00B5BC', lineWidth: 1, name: 'SPHEREx images' });
  aladin.addOverlay(footprints);
  const targetMarker = A.catalog({ name: 'Your coordinate', shape: 'plus', color: '#00B5BC', sourceSize: 22 });
  aladin.addCatalog(targetMarker);

  /**
   * Make an image layer for a sky map, trying each mirror until one answers. Maps with one
   * address (SPHEREx from IRSA or our server) are returned at once, as before.
   * @returns {Promise<object>} the layer; rejects with a readable message if every mirror fails
   */
  async function openMap(spec) {
    const sources = mapSources(spec);
    if (sources.length === 1) return A.imageHiPS(sources[0], hipsOptions(spec));
    for (const source of sources) {
      const layer = A.imageHiPS(source, hipsOptions(spec));
      try {
        await Promise.race([
          layer.query,
          new Promise((_, reject) => { setTimeout(() => reject(new Error('timed out')), MIRROR_TIMEOUT_MS); }),
        ]);
        return layer;
      } catch (error) {
        console.warn(`Sky map "${spec.label}": ${source} did not answer.`, error);
      }
    }
    throw new Error(`Couldn't reach any server for "${spec.label}" (tried ${sources.length}).`);
  }
  let baseRequest = 0;
  let overlayRequest = 0;

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
    /** Rejects (and keeps the current map) if no mirror answers; resolves false if superseded. */
    async setBaseMap(key, plane) {
      const spec = SKY_MAPS[key];
      const request = ++baseRequest;
      const layer = await openMap(spec);
      if (request !== baseRequest) return false; // the user picked another map meanwhile
      baseLayer = layer;
      aladin.setBaseImageLayer(baseLayer);
      if (spec.cube && Number.isInteger(plane)) await this.setPlane(plane);
      return true;
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
    /** Rejects if no mirror answers (the overlay is then removed); resolves false if superseded. */
    async setOverlayMap(key, opacity) {
      const request = ++overlayRequest;
      aladin.removeImageLayer('overlay');
      if (!key) return true;
      const spec = SKY_MAPS[key];
      const layer = await openMap(spec);
      if (request !== overlayRequest) return false;
      aladin.setOverlayImageLayer(layer, 'overlay');
      layer.setOpacity(opacity);
      return true;
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
     * @returns {Promise<{count?: number, service?: string, truncated?: boolean, error?: string}|null>}
     */
    async showCatalogue(key, visible, { ra: cra, dec: cdec, radiusDeg, live }) {
      const radius = Math.min(radiusDeg, CATALOGUE_MAX_RADIUS_DEG);
      const where = `${cra.toFixed(4)} ${cdec.toFixed(4)} ${radius.toFixed(3)}`;
      wanted[key] = visible ? where : null;
      const existing = catalogues[key];
      if (existing && (existing.where !== where || !visible)) existing.layer.hide();
      if (!visible) return null;
      if (existing?.where === where) {
        existing.layer.show();
        return existing.info;
      }
      const spec = CATALOGUE_LAYERS[key];
      const style = { name: spec.label, color: spec.color, sourceSize: spec.size, shape: spec.shape };
      let layer;
      let info;
      if (live) {
        try {
          const result = await getJson(`/api/catalogs/${key}`, { ra: cra.toFixed(6), dec: cdec.toFixed(6), radius: radius.toFixed(4) }, { timeoutMs: 90000 });
          layer = A.catalog(style);
          layer.addSources(result.rows.filter((row) => row.ra != null && row.dec != null)
            .map((row) => A.source(row.ra, row.dec, { name: rowName(row) })));
          info = { count: result.count, service: result.service, truncated: result.truncated };
        } catch (error) {
          if (!spec.vizier) return { error: error.message };
        }
      }
      if (!layer) {
        if (!spec.vizier) return { error: 'SIMBAD markers need the live data server.' };
        layer = A.catalogFromVizieR(spec.vizier, `${cra.toFixed(4)} ${cdec.toFixed(4)}`, Math.min(radius, 0.25), style);
        info = { service: 'VizieR (CDS)' };
      }
      if (wanted[key] !== where) return null; // unticked or moved while downloading
      catalogues[key]?.layer.hide();
      aladin.addCatalog(layer);
      catalogues[key] = { layer, where, info };
      return info;
    },
  };
}
