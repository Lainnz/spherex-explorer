"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { getA, type AladinCatalog, type AladinInstance } from "@/lib/aladin";
import { getCatalog, type CatalogName } from "@/lib/backend";

type Props = {
  aladinRef: RefObject<AladinInstance | null>;
  viewerReady: boolean;
  center: { ra: number; dec: number };
  fov: number; // degrees across
};

type LayerState = {
  enabled: boolean;
  loading: boolean;
  count: number | null;
  truncated: boolean;
  service: string | null;
  error: string | null;
  loadedFor: { ra: number; dec: number; radius: number } | null;
};

const LAYERS: { name: CatalogName; label: string; help: string; color: string; shape: string; size: number }[] = [
  {
    name: "simbad",
    label: "Known objects (SIMBAD)",
    help: "Named and studied objects: stars, nebulae, galaxies, pulsars… from the SIMBAD database.",
    color: "#facc15",
    shape: "square",
    size: 11,
  },
  {
    name: "gaia",
    label: "Stars (Gaia DR3)",
    help: "Stars measured by ESA's Gaia satellite, with distances and motions. Brightest shown first.",
    color: "#38bdf8",
    shape: "circle",
    size: 8,
  },
  {
    name: "allwise",
    label: "Infrared sources (AllWISE)",
    help: "Sources detected by NASA's WISE infrared telescope at 3.4–22 µm. Brightest shown first.",
    color: "#f472b6",
    shape: "rhomb",
    size: 10,
  },
];

const EMPTY: LayerState = {
  enabled: false,
  loading: false,
  count: null,
  truncated: false,
  service: null,
  error: null,
  loadedFor: null,
};

function searchRadius(fov: number) {
  return Math.min(0.5, Math.max(0.02, fov * 0.75));
}

function angularDistance(a: { ra: number; dec: number }, b: { ra: number; dec: number }) {
  const r = Math.PI / 180;
  const cos =
    Math.sin(a.dec * r) * Math.sin(b.dec * r) + Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.cos((a.ra - b.ra) * r);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
}

// Toggleable catalogue markers on the sky map
export default function CatalogOverlays({ aladinRef, viewerReady, center, fov }: Props) {
  const [layers, setLayers] = useState<Record<CatalogName, LayerState>>({
    simbad: { ...EMPTY },
    gaia: { ...EMPTY },
    allwise: { ...EMPTY },
  });
  const catalogsRef = useRef(new Map<CatalogName, AladinCatalog>());

  // Viewer recreated (e.g. "Try again") → old marker layers are gone
  useEffect(() => {
    if (!viewerReady) catalogsRef.current.clear();
  }, [viewerReady]);

  function update(name: CatalogName, patch: Partial<LayerState>) {
    setLayers((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  async function load(name: CatalogName) {
    const aladin = aladinRef.current;
    const A = getA();
    if (!aladin || !A) return;
    const spec = LAYERS.find((l) => l.name === name)!;
    let catalog = catalogsRef.current.get(name);
    if (!catalog) {
      catalog = A.catalog({ name: spec.label, color: spec.color, shape: spec.shape, sourceSize: spec.size });
      aladin.addCatalog(catalog);
      catalogsRef.current.set(name, catalog);
    }
    const radius = searchRadius(fov);
    const at = { ra: center.ra, dec: center.dec, radius };
    update(name, { enabled: true, loading: true, error: null });
    try {
      const result = await getCatalog(name, at.ra, at.dec, radius);
      catalog.removeAll();
      catalog.addSources(result.rows.map((row) => A.source(row.ra, row.dec, { catalog: name })));
      catalog.show();
      update(name, {
        loading: false,
        count: result.count,
        truncated: result.truncated,
        service: result.service,
        loadedFor: at,
      });
    } catch (error) {
      update(name, { loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function toggle(name: CatalogName) {
    const state = layers[name];
    const catalog = catalogsRef.current.get(name);
    if (state.enabled) {
      catalog?.hide();
      update(name, { enabled: false });
    } else if (catalog && state.loadedFor && !isStale(state)) {
      catalog.show();
      update(name, { enabled: true });
    } else {
      load(name);
    }
  }

  function isStale(state: LayerState) {
    if (!state.loadedFor) return false;
    const moved = angularDistance(center, state.loadedFor) > state.loadedFor.radius * 0.5;
    const zoomedOut = searchRadius(fov) > state.loadedFor.radius * 1.3;
    return moved || zoomedOut;
  }

  const staleNames = LAYERS.filter((l) => layers[l.name].enabled && isStale(layers[l.name])).map((l) => l.name);

  return (
    <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-xs uppercase tracking-wider text-white/45">Catalogue overlays</span>
        {LAYERS.map((l) => {
          const state = layers[l.name];
          return (
            <label key={l.name} className="flex cursor-pointer items-center gap-2" title={l.help}>
              <input
                type="checkbox"
                checked={state.enabled}
                disabled={!viewerReady || state.loading}
                onChange={() => toggle(l.name)}
                className="accent-violet-500"
              />
              <span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: l.color }} aria-hidden />
              <span className="text-white/80">{l.label}</span>
              {state.loading && <span className="text-xs text-white/45">loading…</span>}
              {state.enabled && state.count != null && !state.loading && (
                <span className="text-xs text-white/45">
                  {state.count}
                  {state.truncated ? " (brightest)" : ""}
                </span>
              )}
            </label>
          );
        })}
        {staleNames.length > 0 && (
          <button
            onClick={() => staleNames.forEach((n) => load(n))}
            className="rounded-md border border-violet-400/50 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/20"
          >
            ↻ Update overlays for this view
          </button>
        )}
      </div>
      {LAYERS.map(
        (l) =>
          layers[l.name].error && (
            <p key={l.name} role="alert" className="mt-1 text-xs text-rose-200">
              {l.label}: {layers[l.name].error}
            </p>
          ),
      )}
      {LAYERS.some((l) => layers[l.name].enabled && layers[l.name].service) && (
        <p className="mt-1 text-[11px] text-white/40">
          Sources:{" "}
          {LAYERS.filter((l) => layers[l.name].enabled && layers[l.name].service)
            .map((l) => layers[l.name].service)
            .join(" · ")}
          . Markers show catalogue positions, not SPHEREx detections.
        </p>
      )}
    </div>
  );
}
