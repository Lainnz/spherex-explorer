"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { getA, type AladinGraphicOverlay, type AladinImageLayer, type AladinInstance } from "@/lib/aladin";
import { removeSpherexLayer } from "@/lib/spherexLayer";
import TimeMachine from "./TimeMachine";
import SpherexGuide from "./SpherexGuide";
import CompareTool from "./CompareTool";
import SpectrumPanel, { type SpectrumTarget } from "./SpectrumPanel";
import {
  absoluteBackendUrl,
  BackendError,
  getCutout,
  searchObservations,
  type CutoutInfo,
  type CutoutShape,
  type Observation,
  type ObservationSearch,
} from "@/lib/backend";

const LAYER_NAME = "spherex";
const BANDS = ["SPHEREx-D1", "SPHEREx-D2", "SPHEREx-D3", "SPHEREx-D4", "SPHEREx-D5", "SPHEREx-D6"];
const SIZE_CHOICES = [0.1, 0.25, 0.5, 1.0];
type Mode = "single" | "time" | "compare" | "spectrum";

type Props = {
  aladinRef: RefObject<AladinInstance | null>;
  viewerReady: boolean;
  ra: number; // the page's coordinate (from the link)
  dec: number;
  suggestedSize: number; // degrees
  spectrumRequest?: (SpectrumTarget & { n: number }) | null; // set by "SPHEREx spectrum of this source"
  onObservationShown?: (wavelengthUm: number | null) => void; // lets the sky map match this wavelength
  playerSlot?: HTMLElement | null; // place above the sky map for the time-machine player
};

// "POLYGON ICRS ra1 dec1 ra2 dec2 …" → [[ra1, dec1], …] (the closing repeat of the first corner is dropped)
function parsePolygon(region: string | null | undefined): [number, number][] | null {
  if (!region || !/^\s*polygon/i.test(region)) return null;
  const numbers = (region.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  if (points.length > 3 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop();
  return points.length >= 3 ? points : null;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return iso.replace("T", " ").replace(/\.\d+/, "").replace("Z", "") + " UTC";
}

function nearestSize(deg: number) {
  return SIZE_CHOICES.reduce((best, s) => (Math.abs(s - deg) < Math.abs(best - deg) ? s : best));
}

// Small "term + explanation" row for the metadata panel
function Row({ term, help, children }: { term: string; help: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-3 border-b border-white/5 py-1.5">
      <dt className="text-white/55">
        {term}
        <span
          className="ml-1 cursor-help text-violet-300/80"
          title={help}
          aria-label={`What is ${term}? ${help}`}
          tabIndex={0}
        >
          ⓘ
        </span>
      </dt>
      <dd className="font-mono text-white/85">{children}</dd>
    </div>
  );
}

export default function SpherexPanel({
  aladinRef,
  viewerReady,
  ra,
  dec,
  suggestedSize,
  spectrumRequest,
  onObservationShown,
  playerSlot = null,
}: Props) {
  const [search, setSearch] = useState<ObservationSearch | null>(null);
  const [searchState, setSearchState] = useState<"loading" | "done" | "error">("loading");
  const [searchError, setSearchError] = useState<BackendError | null>(null);
  const [band, setBand] = useState("SPHEREx-D2");
  const [obsId, setObsId] = useState<string>("");
  const [size, setSize] = useState(() => nearestSize(Math.min(suggestedSize, 0.5)));
  const [smooth, setSmooth] = useState(false);
  const [shape, setShape] = useState<CutoutShape>("circle");
  const [matchBackground, setMatchBackground] = useState(true);
  const [hideTimeMachine, setHideTimeMachine] = useState(0); // bump to hide time-machine frames
  const [cutout, setCutout] = useState<CutoutInfo | null>(null);
  const [cutoutState, setCutoutState] = useState<"idle" | "loading" | "shown" | "hidden" | "error">("idle");
  const [cutoutError, setCutoutError] = useState<string>("");
  const [opacity, setOpacity] = useState(1);
  const layerRef = useRef<AladinImageLayer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>("single");
  const [showFootprints, setShowFootprints] = useState(false);
  const footprintRef = useRef<AladinGraphicOverlay | null>(null);
  const pageTarget: SpectrumTarget = { ra, dec, label: "The page's coordinate (centre of the view when you arrived)" };
  const [spectrumTarget, setSpectrumTarget] = useState<SpectrumTarget>(pageTarget);
  const panelRef = useRef<HTMLElement | null>(null);

  // A spectrum request from the object panel: switch to the Spectrum tab and measure there
  useEffect(() => {
    if (!spectrumRequest) return;
    setSpectrumTarget({ ra: spectrumRequest.ra, dec: spectrumRequest.dec, label: spectrumRequest.label, note: spectrumRequest.note });
    removeSpherexLayer(aladinRef.current);
    layerRef.current = null;
    setMode("spectrum");
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrumRequest?.n]);

  useEffect(() => {
    setSpectrumTarget({ ra, dec, label: "The page's coordinate (centre of the view when you arrived)" });
  }, [ra, dec]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (next === "compare") setHideTimeMachine((n) => n + 1);
    removeSpherexLayer(aladinRef.current);
    layerRef.current = null;
    setCutoutState(cutout ? "hidden" : "idle");
    setMode(next);
  }

  // Search the archive whenever the page's coordinate changes
  useEffect(() => {
    let cancelled = false;
    setSearchState("loading");
    setSearchError(null);
    setCutout(null);
    setCutoutState("idle");
    try {
      aladinRef.current?.removeImageLayer(LAYER_NAME);
    } catch {
      /* layer may not exist yet */
    }
    searchObservations(ra, dec)
      .then((result) => {
        if (cancelled) return;
        setSearch(result);
        setSearchState("done");
      })
      .catch((error: BackendError) => {
        if (cancelled) return;
        setSearchError(error);
        setSearchState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ra, dec, attempt, aladinRef]);

  const byBand = useMemo(() => {
    const groups: Record<string, Observation[]> = {};
    for (const o of search?.observations ?? []) (groups[o.band] ??= []).push(o);
    return groups;
  }, [search]);

  const bandObservations = byBand[band] ?? [];
  const selected = bandObservations.find((o) => o.id === obsId) ?? bandObservations[0];

  // Outlines of this detector's images on the sky map
  useEffect(() => {
    const aladin = aladinRef.current;
    const A = getA();
    if (!aladin || !A || !viewerReady) return;
    if (!footprintRef.current) {
      footprintRef.current = A.graphicOverlay({ name: "SPHEREx image outlines", color: "#5eead4", lineWidth: 1.5 });
      aladin.addOverlay(footprintRef.current);
    }
    const overlay = footprintRef.current;
    overlay.removeAll();
    if (!showFootprints) return;
    for (const o of bandObservations) {
      const points = parsePolygon(o.s_region);
      if (points) overlay.add(A.polygon(points, { color: "#5eead4", lineWidth: 1.5 }));
    }
    overlay.show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFootprints, band, search, viewerReady]);

  const footprintCount = bandObservations.filter((o) => parsePolygon(o.s_region)).length;

  const visitDays = useMemo(() => {
    const days = new Set((search?.observations ?? []).map((o) => o.time_utc?.slice(0, 10)));
    return [...days].filter(Boolean).sort() as string[];
  }, [search]);

  function showLayer(info: CutoutInfo) {
    const aladin = aladinRef.current;
    if (!aladin) return;
    aladin.displayFITS(
      absoluteBackendUrl(info.fits_url),
      {
        minCut: info.image.display_min ?? undefined,
        maxCut: info.image.display_max ?? undefined,
        colormap: "grayscale",
      },
      (_ra, _dec, _fov, image) => {
        // Don't move the view; just style the layer
        layerRef.current = image;
        image.setColormap?.("grayscale", { stretch: "asinh" });
        image.setOpacity?.(opacity);
        setCutoutState("shown");
      },
      (error) => {
        console.error("[SPHEREx Xplorer] Aladin could not display the FITS cutout", error);
        setCutoutError("The viewer could not display this FITS image.");
        setCutoutState("error");
      },
      LAYER_NAME,
    );
  }

  async function loadObservation() {
    if (!selected) return;
    setHideTimeMachine((n) => n + 1); // the single observation takes over the map
    setCutoutState("loading");
    setCutoutError("");
    try {
      const info = await getCutout(selected, ra, dec, size, smooth, shape);
      setCutout(info);
      showLayer(info);
      if (matchBackground) onObservationShown?.(info.target.wavelength_um ?? null);
    } catch (error) {
      setCutoutError(error instanceof Error ? error.message : String(error));
      setCutoutState("error");
    }
  }

  function toggleVisible() {
    if (!cutout) return;
    if (cutoutState === "shown") {
      aladinRef.current?.removeImageLayer(LAYER_NAME);
      layerRef.current = null;
      setCutoutState("hidden");
    } else {
      showLayer(cutout);
    }
  }

  function changeOpacity(value: number) {
    setOpacity(value);
    layerRef.current?.setOpacity?.(value);
  }

  const buttonClass =
    "rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/85 transition hover:border-violet-300/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section ref={panelRef} aria-labelledby="spherex-heading" className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="spherex-heading" className="text-lg font-semibold">
          Real SPHEREx observations
        </h2>
        <p className="text-xs text-white/45">From NASA/IPAC IRSA · {search?.collection_name ?? "SPHEREx Data Release 1"}</p>
      </div>

      {/* Search status */}
      {searchState === "loading" && (
        <p className="mt-3 animate-pulse text-sm text-white/60 motion-reduce:animate-none">
          Asking the IRSA archive which SPHEREx images cover this spot…
        </p>
      )}

      {searchState === "error" && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm">
          <p className="text-rose-200">{searchError?.message}</p>
          {searchError?.offline && (
            <p className="mt-2 text-white/65">
              Start it in a second PowerShell window:{" "}
              <code className="rounded bg-black/50 px-1.5 py-0.5 text-xs">
                cd D:\Projects\SPHEREx-Xplorer\backend; conda activate spherex; uvicorn app.main:app --reload --port 8000
              </code>
            </p>
          )}
          <button className={`${buttonClass} mt-3`} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {searchState === "done" && search && search.count === 0 && (
        <p className="mt-3 text-sm text-white/65">
          The archive has no SPHEREx images covering this exact position in this data release. Nothing is
          shown rather than substituting other data.
        </p>
      )}

      {searchState === "done" && search && search.count > 0 && (
        <>
          <p className="mt-3 text-sm text-white/75">
            <strong className="text-white">{search.count}</strong> SPHEREx images cover this spot, taken on{" "}
            <strong className="text-white">{visitDays.length}</strong> different days between {visitDays[0]} and{" "}
            {visitDays.at(-1)}.
          </p>

          {/* Tool tabs (kept near the top so they are always easy to reach) */}
          <div role="tablist" aria-label="View mode" className="mt-3 flex gap-1 overflow-x-auto border-b border-white/10">
            {(
              [
                ["single", "Observation"],
                ["time", "Time machine"],
                ["compare", "Compare"],
                ["spectrum", "Spectrum"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={mode === value}
                onClick={() => switchMode(value)}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm transition ${
                  mode === value ? "border-violet-400 text-white" : "border-transparent text-white/55 hover:text-white/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>



          {/* Detector and display settings (not needed for spectra, which use all detectors) */}
          {mode !== "spectrum" && (
            <>
          {/* Detector choice */}
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="SPHEREx detector">
            {BANDS.map((b) => {
              const list = byBand[b] ?? [];
              const first = list[0];
              return (
                <button
                  key={b}
                  role="radio"
                  aria-checked={band === b}
                  disabled={list.length === 0}
                  onClick={() => {
                    setBand(b);
                    setObsId("");
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-30 ${
                    band === b ? "border-violet-400 bg-violet-600/30" : "border-white/15 hover:bg-white/5"
                  }`}
                >
                  <span className="block font-semibold text-white">{b.replace("SPHEREx-", "Detector ")}</span>
                  <span className="text-white/55">
                    {first?.wavelength_min_um?.toFixed(2)}–{first?.wavelength_max_um?.toFixed(2)} µm · {list.length}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm" title="Draws the edge of every image from this detector that covers your spot">
            <input
              type="checkbox"
              className="accent-teal-400"
              checked={showFootprints}
              onChange={(e) => setShowFootprints(e.target.checked)}
              disabled={!viewerReady}
            />
            <span className="text-white/75">
              Outline these images on the map{" "}
              <span className="text-white/45">
                ({footprintCount} outlines, {band.replace("SPHEREx-", "")} · each image covers about 3.5° × 3.5°; zoom out to see them)
              </span>
            </span>
          </label>

          {/* Display settings shared by both modes */}
          <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-white/60">Cutout size</span>
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
              >
                {SIZE_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {s}° ({Math.round(s * 60)}′) · ~{s >= 1 ? 10 : s >= 0.5 ? 5.5 : 4} MB each
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/60">Shape</span>
              <select
                value={shape}
                onChange={(e) => setShape(e.target.value as CutoutShape)}
                className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
                title="Circle hides the corners of the square image so it blends into the map around it"
              >
                <option value="circle">Circle</option>
                <option value="square">Square (whole cutout)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1.5" title="Blends SPHEREx's large pixels smoothly for display. It does not add real detail.">
              <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} className="accent-violet-500" />
              <span className="text-white/75">Smooth pixels (display only)</span>
            </label>
          </div>
          <p className="mt-1 text-xs text-white/45">
            SPHEREx pixels are about 6″ wide (it maps the whole sky in 102 colours rather than taking sharp close-ups),
            so zoomed-in views look blocky. Smoothing hides the blocks but cannot add detail that was never recorded.
          </p>
            </>
          )}


          {mode === "spectrum" && (
            <SpectrumPanel
              target={spectrumTarget}
              onResetTarget={
                spectrumTarget.ra !== ra || spectrumTarget.dec !== dec ? () => setSpectrumTarget(pageTarget) : undefined
              }
            />
          )}

          {mode === "compare" && (
            <CompareTool aladinRef={aladinRef} viewerReady={viewerReady} ra={ra} dec={dec} band={band} sizeDeg={size} smooth={smooth} />
          )}

          {/* Always running: its player sits above the sky map; settings show on the Time machine tab */}
          <TimeMachine
            aladinRef={aladinRef}
            viewerReady={viewerReady}
            ra={ra}
            dec={dec}
            band={band}
            sizeDeg={size}
            smooth={smooth}
            shape={shape}
            playerSlot={playerSlot}
            showSettings={mode === "time"}
            hideSignal={hideTimeMachine}
            onActivate={() => {
              // the time machine took over the map, so the single observation is no longer shown
              layerRef.current = null;
              setCutoutState((st) => (st === "shown" ? "hidden" : st));
            }}
          />

          {mode === "single" && (
            <>
          {/* Observation + size */}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-white/60">Observation (date)</span>
              <select
                value={selected?.id ?? ""}
                onChange={(e) => setObsId(e.target.value)}
                className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
              >
                {bandObservations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {formatDate(o.time_utc)} · {o.obs_id}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={`${buttonClass} border-violet-400/60 bg-violet-600/40`}
              onClick={loadObservation}
              disabled={!viewerReady || !selected || cutoutState === "loading"}
            >
              {cutoutState === "loading" ? "Downloading cutout…" : "Show on the sky map"}
            </button>
            <label
              className="flex items-center gap-2 text-sm"
              title="Switches the background to SPHEREx's all-sky map at this observation's wavelength, so the sharp patch blends into a full view"
            >
              <input
                type="checkbox"
                className="accent-teal-400"
                checked={matchBackground}
                onChange={(e) => setMatchBackground(e.target.checked)}
              />
              <span className="text-white/70">Match the background to this wavelength</span>
            </label>
            {cutout && (cutoutState === "shown" || cutoutState === "hidden") && (
              <button className={buttonClass} onClick={toggleVisible}>
                {cutoutState === "shown" ? "Hide SPHEREx layer" : "Show SPHEREx layer"}
              </button>
            )}
            {cutoutState === "shown" && (
              <label className="flex items-center gap-2 text-sm text-white/65">
                Opacity
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => changeOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </div>

          {cutoutState === "loading" && (
            <p className="mt-2 text-xs text-white/50">
              Downloading a small piece of this image from IRSA (about 4 MB; later views of the same cutout come from
              the local cache).
            </p>
          )}
          {cutoutState === "error" && (
            <p role="alert" className="mt-2 text-sm text-rose-200">
              {cutoutError}
            </p>
          )}

          {/* Metadata */}
          {cutout && (
            <details open className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-white/85">
                Observation details · {cutout.observation.obs_id}
              </summary>
              <p className="mt-2 text-xs text-amber-200/80">
                Real SPHEREx data: a {cutout.provenance.cutout_size_deg}° cutout drawn in grey on top of the
                background map. Pixels with serious quality flags are left blank.
              </p>
              <dl className="mt-2 text-xs sm:text-sm">
                <Row term="Observed" help="When SPHEREx took this exposure (start time, UTC).">
                  {formatDate(cutout.observation.date_obs_utc)}
                </Row>
                <Row term="Data release" help="Which public batch of SPHEREx data this file belongs to.">
                  {selected?.collection ?? "—"} · pipeline {cutout.observation.pipeline_version ?? "—"}
                </Row>
                <Row
                  term="Detector"
                  help="SPHEREx has six detector arrays. 1–3 see shorter infrared wavelengths, 4–6 longer ones."
                >
                  D{cutout.observation.detector} · {selected?.wavelength_min_um}–{selected?.wavelength_max_um} µm
                </Row>
                <Row
                  term="Wavelength here"
                  help="SPHEREx's filters change colour across each detector, so every pixel sees a slightly different wavelength. This is the wavelength at your target."
                >
                  {cutout.target.wavelength_um != null
                    ? `${cutout.target.wavelength_um} µm (± ${(cutout.target.bandwidth_um ?? 0) / 2} µm)`
                    : cutout.target.wavelength_note ?? "unavailable"}
                </Row>
                <Row term="Brightness here" help="Surface brightness at your target pixel, in mega-janskys per steradian, with its 1-sigma uncertainty from the VARIANCE layer. Includes zodiacal light (see next row).">
                  {cutout.target.surface_brightness != null
                    ? `${cutout.target.surface_brightness} ± ${cutout.target.uncertainty ?? "?"} ${cutout.observation.units}`
                    : "unavailable"}
                </Row>
                <Row term="Zodiacal light model" help="Sunlight scattered by dust in our Solar System adds a smooth glow. The pipeline provides a model of it (not subtracted from the image).">
                  {cutout.target.zodi_model ?? "—"} {cutout.observation.units}
                </Row>
                <Row term="Flags at target" help="Quality warnings the pipeline attached to your target pixel. 'SOURCE' just means a known star or galaxy is there.">
                  {cutout.target.flags.length ? cutout.target.flags.join(", ") : "none"}
                </Row>
                <Row term="Pixel scale" help="How much sky one pixel covers. SPHEREx pixels are large (~6 arcseconds) because it surveys the whole sky.">
                  {cutout.image.pixel_scale_arcsec.map((s) => s?.toFixed(2)).join(" × ")}″ · {cutout.image.width}×
                  {cutout.image.height} px
                </Row>
                <Row term="Image sharpness (PSF)" help="Typical width of a star's image (full width at half maximum).">
                  {cutout.observation.psf_fwhm_arcsec ?? "—"}″
                </Row>
                <Row term="Exposure" help="How long the detector collected light for this image.">
                  {cutout.observation.exposure_s ?? "—"} s
                </Row>
                <Row term="Hidden pixels" help={`Share of pixels blanked because of these flags: ${cutout.quality.hidden_flag_names.join(", ")}.`}>
                  {((cutout.image.masked_fraction ?? 0) * 100).toFixed(1)}%
                </Row>
                <Row term="Source" help="The exact file this cutout came from at NASA/IPAC IRSA.">
                  <a
                    href={cutout.provenance.cutout_url}
                    className="break-all text-violet-300 underline hover:text-violet-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download this cutout (FITS)
                  </a>
                </Row>
              </dl>
              <details className="mt-2 text-xs text-white/50">
                <summary className="cursor-pointer">All quality-flag counts in this cutout</summary>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
                  {Object.entries(cutout.quality.flag_counts)
                    .filter(([, n]) => n > 0)
                    .map(([name, n]) => (
                      <li key={name} className="font-mono">
                        {name}: {n}
                      </li>
                    ))}
                </ul>
              </details>
            </details>
          )}
            </>
          )}
        </>
      )}

      <SpherexGuide />
    </section>
  );
}
