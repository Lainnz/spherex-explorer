// Draws a SPHEREx FITS cutout (from our backend) as a layer in Aladin Lite.

import type { AladinImageLayer, AladinInstance } from "@/lib/aladin";
import { absoluteBackendUrl, type CutoutInfo } from "@/lib/backend";

export const SPHEREX_LAYER = "spherex";

export type DisplayScale = { min: number | null; max: number | null };

export function showSpherexLayer(
  aladin: AladinInstance,
  info: CutoutInfo,
  scale: DisplayScale,
  opacity = 1,
  layerName = SPHEREX_LAYER,
): Promise<AladinImageLayer> {
  return new Promise((resolve, reject) => {
    aladin.displayFITS(
      absoluteBackendUrl(info.fits_url),
      {
        minCut: scale.min ?? undefined,
        maxCut: scale.max ?? undefined,
        colormap: "grayscale",
      },
      (_ra, _dec, _fov, image) => {
        // Keep the user's view where it is; just style the layer
        image.setColormap?.("grayscale", { stretch: "asinh" });
        image.setOpacity?.(opacity);
        resolve(image);
      },
      (error) => reject(error ?? new Error("The viewer could not display this FITS image.")),
      layerName,
    );
  });
}

export function removeSpherexLayer(aladin: AladinInstance | null, layerName = SPHEREX_LAYER) {
  try {
    aladin?.removeImageLayer(layerName);
  } catch {
    /* nothing to remove */
  }
}
