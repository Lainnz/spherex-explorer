/**
 * The Layers tab (PLAN.md §8.3, parts 1 and 7): background sky map (SPHEREx false colour by
 * default, from Elaine's demo), the 102-colour
 * wavelength slider for the SPHEREx cube, an overlay map with see-through slider,
 * SPHEREx coverage and image outlines, and Gaia / AllWISE catalogue markers.
 */
import { BLANK_PLANES, CUBE_WAVELENGTHS, describePlane, planeForWavelength } from '../shared/wavelength.js';
import { CATALOGUE_LAYERS, SKY_MAPS } from './sky-view.js';

const DEFAULT_WAVELENGTH_UM = 2.2; // near-infrared "K band": stars stand out well

/**
 * @param {{root: HTMLElement, sky: object, state: object, home: object,
 *          onChange: () => void}} options  state is updated in place (base, wl, overlay, opacity, cat)
 */
export function setupLayers({ root, sky, state, home, onChange }) {
  const baseSelect = root.querySelector('#base-map');
  const wavelengthRow = root.querySelector('[data-wavelength-row]');
  const wavelengthSlider = root.querySelector('#wavelength');
  const wavelengthLabel = root.querySelector('[data-wavelength]');
  const overlaySelect = root.querySelector('#overlay-map');
  const opacitySlider = root.querySelector('#overlay-opacity');
  const toggles = {
    coverage: root.querySelector('#show-coverage'),
    footprints: root.querySelector('#show-footprints'),
    gaia: root.querySelector('#show-gaia'),
    allwise: root.querySelector('#show-allwise'),
  };

  const mapNote = root.querySelector('[data-map-note]');
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

  async function applyBase() {
    baseSelect.value = state.base;
    const isCube = Boolean(SKY_MAPS[state.base].cube);
    wavelengthRow.hidden = !isCube;
    if (mapNote) mapNote.textContent = SKY_MAPS[state.base].note ?? '';
    await sky.setBaseMap(state.base, isCube ? plane : undefined);
  }

  baseSelect.addEventListener('change', () => {
    state.base = baseSelect.value;
    applyBase();
    onChange();
  });
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
    opacitySlider.disabled = !state.overlay;
    sky.setOverlayMap(state.overlay, state.opacity);
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
  const catalogueArea = () => ({ ra: home.ra, dec: home.dec, radiusDeg: Math.max(sky.fovDeg() / 2, 0.05) });
  for (const key of Object.keys(CATALOGUE_LAYERS)) {
    toggles[key].addEventListener('change', () => {
      state.cat = Object.keys(CATALOGUE_LAYERS).filter((k) => toggles[k].checked);
      sky.showCatalogue(key, toggles[key].checked, catalogueArea());
      onChange();
    });
  }

  // --- Start from the URL state -----------------------------------------------------------
  showPlane();
  applyBase();
  if (state.overlay) {
    overlaySelect.value = state.overlay;
    sky.setOverlayMap(state.overlay, state.opacity);
  }
  opacitySlider.value = String(state.opacity);
  opacitySlider.disabled = !state.overlay;
  for (const key of state.cat ?? []) {
    toggles[key].checked = true;
    sky.showCatalogue(key, true, catalogueArea());
  }

  return {
    /** After "set as new coordinate": reload catalogues around the new spot. */
    refreshCatalogues() {
      for (const key of state.cat ?? []) sky.showCatalogue(key, true, catalogueArea());
    },
  };
}
