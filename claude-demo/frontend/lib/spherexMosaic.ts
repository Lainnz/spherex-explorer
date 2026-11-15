// The official SPHEREx DR1 all-sky mosaic (IRSA HiPS cube), one frame per spectral channel.
// Source: https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube
// Our backend serves each frame as a normal map (Aladin Lite can't pick this cube's
// frames correctly by itself) and builds false-colour maps from three frames.

import { BACKEND_URL, getJsonPublic } from "./backend";

export type MosaicChannel = {
  frame: number; // 0–101
  wavelength_um: number;
  detector: number; // 1–6
  channel: number; // 1–17 within the detector
  blank: boolean; // frames 50 and 51 (dichroic channels) are empty in the cube
};

export type MosaicChannels = {
  source: string;
  description: string | null;
  pixel_scale_deg: number;
  channels: MosaicChannel[];
};

export function getMosaicChannels() {
  return getJsonPublic<MosaicChannels>("/api/hips/spherex/channels", {});
}

export function singleFrameUrl(frame: number) {
  return `${BACKEND_URL}/api/hips/spherex/${frame}`;
}

export function rgbUrl(frames: [number, number, number]) {
  return `${BACKEND_URL}/api/hips/spherex-rgb/${frames.join("-")}`;
}

export function nearestFrame(channels: MosaicChannel[], wavelengthUm: number) {
  let best = channels.find((c) => !c.blank) ?? channels[0];
  for (const c of channels) {
    if (!c.blank && Math.abs(c.wavelength_um - wavelengthUm) < Math.abs(best.wavelength_um - wavelengthUm)) best = c;
  }
  return best.frame;
}

// False-colour recipes: each colour is ONE SPHEREx channel (nothing is averaged
// across detectors). Wavelengths are targets; the nearest real channel is used.
export type FalseColourPreset = {
  id: string;
  label: string;
  short: string; // button label
  red: number;
  green: number;
  blue: number;
  explain: string;
};

export const PRESETS: FalseColourPreset[] = [
  {
    id: "stars-dust",
    label: "Stars vs. warm dust",
    short: "Stars & dust",
    red: 4.6,
    green: 2.2,
    blue: 1.25,
    explain:
      "Short to long infrared wavelengths shown as blue → red. Ordinary stars are brightest at short wavelengths and look blue-white; warm dust and deeply buried young stars glow at long wavelengths and look red.",
  },
  {
    id: "pah",
    label: "Organic molecules (PAH, 3.3 µm)",
    short: "Organic molecules",
    red: 3.29,
    green: 3.12,
    blue: 1.6,
    explain:
      "Red is the 3.3 µm band of PAHs (soot-like carbon molecules lit up by ultraviolet starlight). Green is the infrared just beside it. Clouds that glow red emit extra light exactly at 3.3 µm.",
  },
  {
    id: "brackett",
    label: "Hydrogen gas (Brackett-α, 4.05 µm)",
    short: "Hydrogen gas",
    red: 4.05,
    green: 4.2,
    blue: 3.9,
    explain:
      "Red is the 4.05 µm line of hot hydrogen gas; green and blue are the infrared just on either side. Glowing gas clouds (H II regions) look red, while things that are simply bright at all three look white.",
  },
];

// Frames of the first recipe (4.600, 2.189, 1.254 µm), so the viewer can open
// directly on SPHEREx before the channel list has loaded.
export const DEFAULT_RGB_FRAMES: [number, number, number] = [90, 46, 22];

export const MOSAIC_NOTE =
  "Real SPHEREx data: IRSA's DR1 all-sky mosaic (display version, ~13″ pixels, brightness stretched for viewing, so not for measurements). Stripes near very bright gas lines are a known artefact of building the mosaic.";
