/**
 * The Layers tab (PLAN.md §8.3, parts 1 and 7): background sky map (SPHEREx false colour by
 * default, from Elaine's demo), the 102-colour
 * wavelength slider for the SPHEREx cube, an overlay map with see-through slider,
 * SPHEREx coverage and image outlines, and Gaia / AllWISE catalogue markers.
 */
import { BLANK_PLANES, CUBE_WAVELENGTHS, describePlane, planeForWavelength } from '../shared/wavelength.js';
import { CATALOGUE_LAYERS, NO_SERVER_MAP, SKY_MAPS } from './sky-view.js';

const DEFAULT_WAVELENGTH_UM = 2.2; // near-infrared "K band": stars stand out well

/**
 * @param {{root: HTMLElement, sky: object, state: object, home: object, live: boolean,
 *          onChange: () => void}} options  state is updated in place (base, wl, overlay, opacity, cat)
 */
export function setupLayers({ root, sky, state, home, live, onChange }) {
  const baseSelect = root.querySelector('#base-map');
  const wavelengthRow = root.querySelector('[data-wavelength-row]');
  const wavelengthSlider = root.querySelector('#wavelength');
  const wavelengthLabel = root.querySelector('[data-wavelength]');
  const overlaySelect = root.querySelector('#overlay-map');
  const opacitySlider = root.querySelector('#overlay-opacity');
  const toggles = {
    coverage: root.querySelector('#show-coverage'),
    footprints: root.querySelector('#show-footprints'),
    simbad: root.querySelector('#show-simbad'),
    gaia: root.querySelector('#show-gaia'),
    allwise: root.querySelector('#show-allwise'),
  };
  const catalogueStatus = root.querySelector('[data-catalogue-status]');

  const mapNote = root.querySelector('[data-map-note]');
  const mapStatus = root.querySelector('[data-map-status]');
  const say = (text) => { if (mapStatus) mapStatus.textContent = text; };
  // Grouped menus, so real SPHEREx maps and other telescopes' maps are never confused.
  const groups = {};
  for (const [key, spec] of Object.entries(SKY_MAPS)) {
    for (const [name, select] of [['base', baseSelect], ['overlay', overlaySelect]]) {
      const id = `${name}:${spec.group}`;
      if (!groups[id]) {
        groups[id] = document.createElement('optgroup');
        groups[id].label = spec.group;
        select.append(groups[id]);
      }
      groups[id].append(new Option(spec.label, key));
    }
  }

  // --- Background map and wavelength ----------------------------------------------------
  wavelengthSlider.max = String(CUBE_WAVELENGTHS.length - 1);
  let plane = planeForWavelength(state.wl ?? DEFAULT_WAVELENGTH_UM);

  function showPlane() {
    wavelengthSlider.value = String(plane);
    wavelengthLabel.textContent = describePlane(plane);
  }

  let shownBase = null; // the map actually on screen, to go back to if a new one fails
  function describeBase(key) {
    const isCube = Boolean(SKY_MAPS[key].cube);
    baseSelect.value = key;
    wavelengthRow.hidden = !isCube;
    if (mapNote) mapNote.textContent = SKY_MAPS[key].note ?? '';
    return isCube;
  }
  async function applyBase() {
    const key = state.base;
    const isCube = describeBase(key);
    say(`Loading ${SKY_MAPS[key].label}…`);
    try {
      const done = await sky.setBaseMap(key, isCube ? plane : undefined);
      if (done === false) return; // another map was picked meanwhile
      shownBase = key;
      say('');
    } catch (error) {
      console.warn(error);
      if (state.base !== key) return;
      // Keep the old picture, and say so, instead of looking as if nothing happened.
      say(`⚠ ${error.message} Still showing ${shownBase ? SKY_MAPS[shownBase].label : 'the previous map'}. Try again later.`);
      if (shownBase) {
        state.base = shownBase;
        describeBase(shownBase);
        onChange();
      }
    }
  }

  baseSelect.addEventListener('change', () => {
    state.base = baseSelect.value;
    applyBase();
    onChange();
  });

  async function applyOverlay() {
    const key = state.overlay;
    opacitySlider.disabled = !key;
    if (key) say(`Loading overlay ${SKY_MAPS[key].label}…`);
    try {
      const done = await sky.setOverlayMap(key, state.opacity);
      if (done !== false) say('');
    } catch (error) {
      console.warn(error);
      if (state.overlay !== key) return;
      say(`⚠ ${error.message} Overlay turned off.`);
      state.overlay = undefined;
      overlaySelect.value = '';
      opacitySlider.disabled = true;
      onChange();
    }
  }
  wavelengthSlider.addEventListener('input', () => {
    let next = Number(wavelengthSlider.value);
    // Skip the two blank planes in the direction of travel.
    while (BLANK_PLANES.has(next)) next += next >= plane ? 1 : -1;
    plane = next;
    showPlane();
    sky.setPlane(plane);
    state.wl = CUBE_WAVELENGTHS[plane];
    onChange();
  });

  // --- Overlay map --------------------------------------------------------------------------
  overlaySelect.addEventListener('change', () => {
    state.overlay = overlaySelect.value || undefined;
    applyOverlay();
    onChange();
  });
  opacitySlider.addEventListener('input', () => {
    state.opacity = Number(opacitySlider.value);
    sky.setOverlayOpacity(state.opacity);
    onChange();
  });

  // --- Coverage, outlines, catalogues -----------------------------------------------------
  toggles.coverage.addEventListener('change', () => sky.showCoverage(toggles.coverage.checked));
  toggles.footprints.addEventListener('change', () => sky.showFootprints(toggles.footprints.checked));
  // Outlines start hidden (they cross the middle of the view); the checkbox shows them.
  sky.showFootprints(toggles.footprints.checked);
  // Search a bit wider than the view (Elaine's rule), within the server's 0.5° limit.
  const catalogueArea = () => ({ ra: home.ra, dec: home.dec, radiusDeg: Math.min(0.5, Math.max(0.02, sky.fovDeg() * 0.75)), live });
  const statusText = {};
  function showStatus() {
    catalogueStatus.textContent = Object.values(statusText).filter(Boolean).join(' · ');
  }
  async function showCatalogue(key, visible) {
    const spec = CATALOGUE_LAYERS[key];
    statusText[key] = visible ? `${spec.label}: loading…` : '';
    showStatus();
    const info = await sky.showCatalogue(key, visible, catalogueArea());
    if (!toggles[key].checked) return;
    if (!info) statusText[key] = '';
    else if (info.error) statusText[key] = `${spec.label}: ${info.error}`;
    else statusText[key] = `${spec.label}: ${info.count != null ? `${info.count.toLocaleString()}${info.truncated ? '+' : ''} shown` : 'shown'} (${info.service})`;
    showStatus();
  }
  for (const key of Object.keys(CATALOGUE_LAYERS)) {
    toggles[key].addEventListener('change', () => {
      state.cat = Object.keys(CATALOGUE_LAYERS).filter((k) => toggles[k].checked);
      showCatalogue(key, toggles[key].checked);
      onChange();
    });
  }

  // --- Start from the URL state -----------------------------------------------------------
  showPlane();
  applyBase();
  opacitySlider.value = String(state.opacity);
  opacitySlider.disabled = !state.overlay;
  if (state.overlay && SKY_MAPS[state.overlay]) {
    overlaySelect.value = state.overlay;
    applyOverlay();
  }
  for (const key of state.cat ?? []) {
    toggles[key].checked = true;
    showCatalogue(key, true);
  }

  return {
    /**
     * Elaine's "match the background to this wavelength": show the SPHEREx 102-colour map at
     * the colour a frame saw, so the sharp frame and the sky behind it are the same colour.
     */
    async matchWavelength(um) {
      const next = planeForWavelength(um);
      if (state.base === NO_SERVER_MAP && next === plane) return;
      plane = next;
      state.wl = CUBE_WAVELENGTHS[plane];
      showPlane();
      if (state.base !== NO_SERVER_MAP) {
        state.base = NO_SERVER_MAP;
        await applyBase();
      } else {
        sky.setPlane(plane);
      }
      onChange();
    },
    /** After "set as new coordinate": reload catalogues around the new spot. */
    refreshCatalogues() {
      for (const key of state.cat ?? []) showCatalogue(key, true);
    },
  };
}
