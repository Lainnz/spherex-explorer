// Loads the Aladin Lite v3 sky viewer from its official site (CDS, Strasbourg)
// and describes the small part of its API that we use.
// Docs: https://cds-astro.github.io/aladin-lite/

export type PositionEvent = { ra: number; dec: number; dragging?: boolean };
export type ClickEvent = { ra: number; dec: number; x: number; y: number; isDragging: boolean };

// A catalogue layer drawn on the sky (markers)
export type AladinCatalog = {
  addSources(sources: unknown[]): void;
  removeAll(): void;
  hide(): void;
  show(): void;
};
export type MouseMoveEvent = { ra?: number; dec?: number; x: number; y: number };

// The image object Aladin hands back after displaying a FITS file
export type AladinImageLayer = {
  setColormap?: (name: string, options?: { stretch?: string; reversed?: boolean }) => void;
  setOpacity?: (opacity: number) => void;
};

export type AladinInstance = {
  displayFITS(
    url: string,
    options?: Record<string, unknown>,
    success?: (ra: number, dec: number, fov: number, image: AladinImageLayer) => void,
    error?: (e: unknown) => void,
    layer?: string,
  ): void;
  removeImageLayer(layer: string): void;
  gotoRaDec(ra: number, dec: number): void;
  getRaDec(): [number, number];
  setFoV(fovDegrees: number): void;
  getFov(): [number, number];
  setRotation(degrees: number): void;
  getRotation(): number;
  setBaseImageLayer(hipsIdOrUrlOrLayer: string | AladinHips): void;
  newImageSurvey(url: string, options?: Record<string, unknown>): AladinHips;
  addOverlay(overlay: AladinGraphicOverlay): void;
  on(event: "positionChanged", cb: (p: PositionEvent) => void): void;
  on(event: "mouseMove", cb: (p: MouseMoveEvent) => void): void;
  on(event: "zoomChanged" | "rotationChanged", cb: () => void): void;
  on(event: "click", cb: (p: ClickEvent) => void): void;
  addCatalog(catalog: AladinCatalog): void;
};

// A HiPS image layer (tiled all-sky map)
export type AladinHips = {
  setColormap?: (name: string, options?: { stretch?: string; reversed?: boolean }) => void;
};

// Lines and shapes drawn on the sky (e.g. image footprints)
export type AladinGraphicOverlay = {
  add(shape: unknown): void;
  removeAll(): void;
  show(): void;
  hide(): void;
};

type AladinGlobal = {
  graphicOverlay(options: { name?: string; color?: string; lineWidth?: number }): AladinGraphicOverlay;
  polygon(raDecPoints: [number, number][], options?: { color?: string; lineWidth?: number }): unknown;
  init: Promise<void>;
  aladin(selector: string, options?: Record<string, unknown>): AladinInstance;
  catalog(options: { name: string; color?: string; sourceSize?: number; shape?: string }): AladinCatalog;
  source(ra: number, dec: number, data?: Record<string, unknown>): unknown;
};

export function getA(): AladinGlobal | undefined {
  return typeof window === "undefined" ? undefined : window.A;
}

declare global {
  interface Window {
    A?: AladinGlobal;
  }
}

// Pinned version (the Aladin team recommends a fixed version).
// 1st choice: the official npm package, served as a JavaScript module by jsDelivr.
// Backup: the classic script from the CDS website (it sets window.A itself).
const ALADIN_VERSION = "3.8.1";
const MODULE_URL = `https://cdn.jsdelivr.net/npm/aladin-lite@${ALADIN_VERSION}/dist/aladin.js`;
const CLASSIC_URL = `https://aladin.cds.unistra.fr/AladinLite/api/v3/${ALADIN_VERSION}/aladin.js`;

// Loads the module through a small <script type="module"> so Next.js's bundler
// doesn't try to process a file from another website.
function loadModule(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onFailed = (event: Event) => {
      cleanup();
      reject(new Error(`Could not load ${url}: ${(event as CustomEvent).detail}`));
    };
    const cleanup = () => {
      window.removeEventListener("aladin-loaded", onLoaded);
      window.removeEventListener("aladin-failed", onFailed);
      script.remove();
    };
    window.addEventListener("aladin-loaded", onLoaded);
    window.addEventListener("aladin-failed", onFailed);

    const script = document.createElement("script");
    script.type = "module";
    script.textContent = `
      import(${JSON.stringify(url)})
        .then((m) => { window.A = m.default; window.dispatchEvent(new Event("aladin-loaded")); })
        .catch((e) => window.dispatchEvent(new CustomEvent("aladin-failed", { detail: String(e) })));
    `;
    document.head.appendChild(script);
  });
}

function loadClassicScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.charset = "utf-8";
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
}

let loading: Promise<AladinGlobal> | null = null;

// Loads Aladin Lite once per page visit, no matter how many times it's asked for.
export function loadAladin(): Promise<AladinGlobal> {
  if (!loading) {
    loading = (async () => {
      let lastError: unknown;
      for (const load of [() => loadModule(MODULE_URL), () => loadClassicScript(CLASSIC_URL)]) {
        if (window.A) break;
        try {
          await load();
        } catch (error) {
          lastError = error;
          console.warn("[SPHEREx Xplorer]", error);
        }
      }
      if (!window.A) throw lastError ?? new Error("Aladin Lite did not load");
      await window.A.init; // starts its WebAssembly engine
      return window.A;
    })().catch((error) => {
      loading = null; // allow a retry later
      throw error;
    });
  }
  return loading;
}
