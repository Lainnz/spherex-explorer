/**
 * The 102 wavelengths of the SPHEREx DR1 all-sky cube (config/datasets.json, read from
 * IRSA's HiPS properties). Plane index = 17 × (detector − 1) + (channel − 1).
 * Planes 50 and 51 are blank (the dichroic channels where two detectors overlap).
 */
import datasets from './config.js';

export const CUBE_WAVELENGTHS = datasets.allsky_cube.wavelengths_um;
export const BLANK_PLANES = new Set(datasets.allsky_cube.blank_planes);
const CHANNELS_PER_DETECTOR = 17;

/** Detector (1–6) that a cube plane comes from. */
export const detectorOfPlane = (plane) => Math.floor(plane / CHANNELS_PER_DETECTOR) + 1;

/**
 * The nearest non-blank plane to a wavelength in µm.
 * @param {number} wavelength
 * @param {number[]} [wavelengths]
 */
export function planeForWavelength(wavelength, wavelengths = CUBE_WAVELENGTHS) {
  let best = -1;
  let bestGap = Infinity;
  wavelengths.forEach((value, plane) => {
    const gap = Math.abs(value - wavelength);
    if (!BLANK_PLANES.has(plane) && gap < bestGap) {
      best = plane;
      bestGap = gap;
    }
  });
  return best;
}

/** "1.43 µm · D2 channel 5" */
export function describePlane(plane) {
  const detector = detectorOfPlane(plane);
  const channel = (plane % CHANNELS_PER_DETECTOR) + 1;
  return `${CUBE_WAVELENGTHS[plane].toFixed(2)} µm · D${detector} channel ${channel}`;
}
