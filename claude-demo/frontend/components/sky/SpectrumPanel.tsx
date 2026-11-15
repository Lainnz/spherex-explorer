"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BackendError, getSpectrum, type BinnedPoint, type Spectrum, type SpectrumPoint } from "@/lib/backend";
import { decToDms, raToHms } from "@/lib/coordinates";

export type SpectrumTarget = { ra: number; dec: number; label: string; note?: string };

type Props = { target: SpectrumTarget; onResetTarget?: () => void };

// Chart geometry (SVG user units; the SVG scales to the panel width)
const W = 760;
const H = 360;
const M = { top: 34, right: 18, bottom: 46, left: 70 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const X_MIN = 0.7;
const X_MAX = 5.1;
const GAP_UM = 0.15; // never draw the line across gaps wider than this

// Colours: one data series in the accent blue (dark-surface step), single images in neutral ink.
const AVERAGE = "#3987e5";
const SINGLE = "rgba(255,255,255,0.42)";

// Well-known infrared features in SPHEREx's range (rest wavelengths). Reference marks only.
const FEATURES = [
  { um: 1.282, label: "Pa β", what: "hydrogen gas (Paschen-β line)" },
  { um: 1.875, label: "Pa α", what: "hydrogen gas (Paschen-α line)" },
  { um: 3.05, label: "H₂O ice", what: "water ice absorption" },
  { um: 3.29, label: "PAH", what: "organic PAH molecules (emission band)" },
  { um: 4.05, label: "Br α", what: "hydrogen gas (Brackett-α line)" },
  { um: 4.27, label: "CO₂ ice", what: "carbon dioxide ice absorption" },
  { um: 4.67, label: "CO", what: "carbon monoxide (gas and ice)" },
];

const SKIP_TEXT: Record<string, string> = {
  "flagged pixels at the source centre": "the source's centre was flagged (most often saturated: too bright for that exposure)",
  "too many flagged pixels in the aperture": "too many flagged pixels around the source",
  "target outside this image": "the position fell just outside the image",
  "too close to the image edge": "the position was too close to the image edge",
  "background could not be measured": "the surrounding sky could not be measured",
};

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function logTicks(min: number, max: number) {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v);
    }
  }
  return ticks;
}

function formatFlux(ujy: number, unit: "µJy" | "mJy") {
  const v = unit === "mJy" ? ujy / 1000 : ujy;
  const abs = Math.abs(v);
  return abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : abs >= 1 ? v.toFixed(2) : v.toFixed(3);
}

function toCsv(spectrum: Spectrum) {
  const head = "wavelength_um,bandwidth_um,flux_uJy,flux_err_stat_uJy,flux_err_total_uJy,detector,obs_id,time_utc,flags_in_aperture";
  const rows = spectrum.points.map((p) =>
    [p.wavelength_um, p.bandwidth_um ?? "", p.flux_ujy, p.flux_err_ujy, p.flux_err_total_ujy, p.band, p.obs_id, p.time_utc ?? "", p.flags_in_aperture.join(" ")].join(","),
  );
  const note = `# SPHEREx Xplorer aperture photometry at RA=${spectrum.query.ra} Dec=${spectrum.query.dec} (${spectrum.query.collection}). Not the official IRSA Spectrophotometry Tool.`;
  return [note, head, ...rows].join("\n");
}

export default function SpectrumPanel({ target, onResetTarget }: Props) {
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<BackendError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [logScale, setLogScale] = useState(true);
  const [showSingles, setShowSingles] = useState(true);
  const [showFeatures, setShowFeatures] = useState(false);
  const [hover, setHover] = useState<{ kind: "single" | "avg"; point: SpectrumPoint | BinnedPoint } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSpectrum(null);
    setError(null);
    setHover(null);
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    getSpectrum(target.ra, target.dec)
      .then((s) => {
        if (cancelled) return;
        setSpectrum(s);
        setState("done");
      })
      .catch((e: BackendError) => {
        if (cancelled) return;
        setError(e);
        setState("error");
      })
      .finally(() => clearInterval(timer));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [target.ra, target.dec, attempt]);

  const points = spectrum?.points ?? [];
  const binned = spectrum?.binned ?? [];

  // Scales
  const scale = useMemo(() => {
    const all = [...points.map((p) => [p.flux_ujy - p.flux_err_total_ujy, p.flux_ujy + p.flux_err_total_ujy]).flat(), ...binned.map((b) => b.flux_ujy)];
    if (all.length === 0) return null;
    const maxAbs = Math.max(...all.map(Math.abs));
    const unit: "µJy" | "mJy" = maxAbs >= 2000 ? "mJy" : "µJy";
    const k = unit === "mJy" ? 1000 : 1;
    const positive = points.every((p) => p.flux_ujy > 0) && binned.every((b) => b.flux_ujy > 0);
    const canLog = positive && points.length > 0;
    const useLog = logScale && canLog;
    let lo: number, hi: number, ticks: number[];
    if (useLog) {
      const vals = [...points.map((p) => p.flux_ujy), ...binned.map((b) => b.flux_ujy)];
      lo = Math.min(...vals) / 1.4;
      hi = Math.max(...vals) * 1.4;
      ticks = logTicks(lo / k, hi / k).map((t) => t * k);
    } else {
      lo = Math.min(0, ...all);
      hi = Math.max(...all);
      const pad = (hi - lo) * 0.06 || 1;
      ticks = niceTicks((lo - (lo < 0 ? pad : 0)) / k, (hi + pad) / k).map((t) => t * k);
      lo = Math.min(lo, ticks[0]);
      hi = Math.max(hi + pad, ticks.at(-1)!);
    }
    const y = (v: number) =>
      useLog
        ? M.top + PH * (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)))
        : M.top + PH * (1 - (v - lo) / (hi - lo));
    const x = (um: number) => M.left + (PW * (um - X_MIN)) / (X_MAX - X_MIN);
    return { unit, k, useLog, canLog, ticks, y, x, lo, hi };
  }, [points, binned, logScale]);

  // Runs of averaged points with no big wavelength gap (gaps = saturated or missing images)
  const segments = useMemo(() => {
    const out: BinnedPoint[][] = [];
    for (const b of binned) {
      const last = out.at(-1)?.at(-1);
      if (last && b.wavelength_um - last.wavelength_um <= GAP_UM) out.at(-1)!.push(b);
      else out.push([b]);
    }
    return out;
  }, [binned]);

  // Wavelength coverage of each detector, from the measurements themselves
  const detectorSpans = useMemo(() => {
    const spans: Record<string, [number, number]> = {};
    for (const p of points) {
      const s = (spans[p.band] ??= [p.wavelength_um, p.wavelength_um]);
      s[0] = Math.min(s[0], p.wavelength_um);
      s[1] = Math.max(s[1], p.wavelength_um);
    }
    return Object.entries(spans).sort((a, b) => a[1][0] - b[1][0]);
  }, [points]);

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!scale || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * H;
    let best: { kind: "single" | "avg"; point: SpectrumPoint | BinnedPoint; d: number } | null = null;
    const consider = (kind: "single" | "avg", point: SpectrumPoint | BinnedPoint) => {
      const d = Math.hypot(scale.x(point.wavelength_um) - px, scale.y(point.flux_ujy) - py);
      if (d < 22 && (!best || d < best.d)) best = { kind, point, d };
    };
    binned.forEach((b) => consider("avg", b));
    if (showSingles) points.forEach((p) => consider("single", p));
    setHover(best ? { kind: (best as { kind: "single" | "avg" }).kind, point: (best as { point: SpectrumPoint | BinnedPoint }).point } : null);
  }

  function downloadCsv() {
    if (!spectrum) return;
    const blob = new Blob([toCsv(spectrum)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spherex-spectrum_${target.ra.toFixed(4)}_${target.dec.toFixed(4)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const buttonClass =
    "rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/85 transition hover:border-violet-300/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  const skippedTotal = spectrum ? Object.values(spectrum.skipped).reduce((a, b) => a + b, 0) : 0;
  const saturated = spectrum?.skipped_flags?.OVERFLOW ?? 0;

  return (
    <div className="mt-4">
      {/* Target */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/45">Spectrum position</p>
          <p className="font-medium text-white">{target.label}</p>
          <p className="font-mono text-xs text-white/45">
            RA {target.ra.toFixed(5)}°, Dec {target.dec.toFixed(5)}° · {raToHms(target.ra)} · {decToDms(target.dec)}
          </p>
          {target.note && <p className="mt-0.5 text-xs text-white/55">{target.note}</p>}
        </div>
        {onResetTarget && (
          <button className={buttonClass} onClick={onResetTarget}>
            Use the page&apos;s coordinate instead
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Tip: click a star on the sky map, then press <em>SPHEREx spectrum of this source</em> in the object panel to measure it here.
      </p>

      {state === "loading" && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm">
          <p className="animate-pulse text-white/75 motion-reduce:animate-none">
            Measuring the brightness at this spot in every SPHEREx image that covers it… {elapsed}s
          </p>
          <p className="mt-1 text-xs text-white/50">
            The first time takes about 20–60 seconds: the server reads a tiny 15×15-pixel patch from each image (a few kB
            instead of 65 MB). Results are cached, so repeating it is quick.
          </p>
        </div>
      )}

      {state === "error" && (
        <div role="alert" className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm">
          <p className="text-rose-200">The spectrum could not be measured: {error?.message}</p>
          <button className={`${buttonClass} mt-3`} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {state === "done" && spectrum && points.length === 0 && (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-100">No SPHEREx spectrum is available here.</p>
          <p className="mt-1 text-white/70">
            {spectrum.available === 0
              ? "No SPHEREx images in this data release cover this position."
              : `None of the ${spectrum.attempted} images gave a usable measurement.`}{" "}
            Nothing is drawn rather than showing a made-up spectrum.
          </p>
          {skippedTotal > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-white/60">
              {Object.entries(spectrum.skipped).map(([reason, n]) => (
                <li key={reason}>
                  {n} image{n === 1 ? "" : "s"}: {SKIP_TEXT[reason] ?? reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state === "done" && spectrum && points.length > 0 && scale && (
        <>
          <p className="mt-4 text-sm text-white/75">
            <strong className="text-white">{points.length}</strong> measurements from{" "}
            <strong className="text-white">{spectrum.attempted}</strong> SPHEREx images
            {spectrum.subsampled ? ` (an even sample of the ${spectrum.available} available)` : ""}, averaged into{" "}
            <strong className="text-white">{binned.length}</strong> wavelength points.
            {skippedTotal > 0 && ` ${skippedTotal} images were left out (see below).`}
          </p>
          {spectrum.systematic_fraction > 0 && (
            <p className="mt-1 text-xs text-white/55">
              Error bars include an extra ±{(spectrum.systematic_fraction * 100).toFixed(1)}% measured from how much images at
              neighbouring wavelengths disagree (SPHEREx&apos;s large pixels make a star&apos;s measured brightness depend slightly on
              where it falls on a pixel).
            </p>
          )}
          {saturated > 0 && (
            <p className="mt-1 text-xs text-amber-200/80">
              In {saturated} image{saturated === 1 ? "" : "s"} this source saturated the detector (it is too bright there), so those
              wavelengths are missing rather than guessed.
            </p>
          )}

          {/* Controls */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2" title={scale.canLog ? "" : "A log scale needs all fluxes to be positive"}>
              <input
                type="checkbox"
                className="accent-violet-500"
                checked={scale.useLog}
                disabled={!scale.canLog}
                onChange={(e) => setLogScale(e.target.checked)}
              />
              <span className="text-white/75">Log scale</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-violet-500" checked={showSingles} onChange={(e) => setShowSingles(e.target.checked)} />
              <span className="text-white/75">Show single images</span>
            </label>
            <label className="flex items-center gap-2" title="Dashed lines where well-known gases and ices absorb or emit light">
              <input type="checkbox" className="accent-violet-500" checked={showFeatures} onChange={(e) => setShowFeatures(e.target.checked)} />
              <span className="text-white/75">Mark known spectral features</span>
            </label>
            <button className={buttonClass} onClick={downloadCsv}>
              Download CSV
            </button>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/70" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <svg width="26" height="10">
                <line x1="1" y1="5" x2="25" y2="5" stroke={AVERAGE} strokeWidth="2" />
                <circle cx="13" cy="5" r="4" fill={AVERAGE} stroke="#0a0a0a" strokeWidth="2" />
              </svg>
              Averaged (images at the same wavelength combined)
            </span>
            {showSingles && (
              <span className="flex items-center gap-1.5">
                <svg width="12" height="10">
                  <circle cx="6" cy="5" r="3" fill={SINGLE} />
                </svg>
                Single images, with ±1σ error bars
              </span>
            )}
          </div>

          {/* Chart */}
          <div className="relative mt-2 rounded-xl border border-white/10 bg-[#0d0d10] p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full touch-none select-none"
              role="img"
              aria-label={`SPHEREx spectrum: flux in ${scale.unit} against wavelength from ${X_MIN} to ${X_MAX} micrometres, ${binned.length} averaged points. A table view is below.`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {/* Detector coverage along the top */}
              {detectorSpans.map(([band, [a, b]]) => (
                <g key={band}>
                  <line x1={scale.x(a)} x2={scale.x(b)} y1={M.top - 14} y2={M.top - 14} stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
                  <text x={(scale.x(a) + scale.x(b)) / 2} y={M.top - 20} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.5)">
                    {band.replace("SPHEREx-", "")}
                  </text>
                </g>
              ))}

              {/* Grid + y axis */}
              {scale.ticks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={W - M.right} y1={scale.y(t)} y2={scale.y(t)} stroke="rgba(255,255,255,0.08)" />
                  <text x={M.left - 8} y={scale.y(t) + 4} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.55)">
                    {formatFlux(t, scale.unit)}
                  </text>
                </g>
              ))}
              {!scale.useLog && scale.lo < 0 && (
                <line x1={M.left} x2={W - M.right} y1={scale.y(0)} y2={scale.y(0)} stroke="rgba(255,255,255,0.3)" />
              )}
              <text
                transform={`translate(16 ${M.top + PH / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize="12"
                fill="rgba(255,255,255,0.7)"
              >
                Brightness (flux density, {scale.unit})
              </text>

              {/* x axis */}
              <line x1={M.left} x2={W - M.right} y1={M.top + PH} y2={M.top + PH} stroke="rgba(255,255,255,0.3)" />
              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((t) => (
                <g key={t}>
                  <line x1={scale.x(t)} x2={scale.x(t)} y1={M.top + PH} y2={M.top + PH + 4} stroke="rgba(255,255,255,0.3)" />
                  <text x={scale.x(t)} y={M.top + PH + 18} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.55)">
                    {t}
                  </text>
                </g>
              ))}
              <text x={M.left + PW / 2} y={H - 8} textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.7)">
                Wavelength (micrometres, µm) — all of it infrared, invisible to our eyes
              </text>

              {/* Reference positions of known features */}
              {showFeatures &&
                FEATURES.map((f, i) => (
                  <g key={f.label}>
                    <line
                      x1={scale.x(f.um)}
                      x2={scale.x(f.um)}
                      y1={M.top}
                      y2={M.top + PH}
                      stroke="rgba(250,204,21,0.45)"
                      strokeDasharray="4 4"
                    />
                    <text x={scale.x(f.um) + 3} y={M.top + 12 + (i % 2) * 14} fontSize="11" fill="rgba(250,204,21,0.85)">
                      {f.label}
                    </text>
                  </g>
                ))}

              {/* Single images */}
              {showSingles &&
                points.map((p) => (
                  <g key={p.obs_id}>
                    <line
                      x1={scale.x(p.wavelength_um)}
                      x2={scale.x(p.wavelength_um)}
                      y1={scale.y(p.flux_ujy - p.flux_err_total_ujy)}
                      y2={scale.y(p.flux_ujy + p.flux_err_total_ujy)}
                      stroke={SINGLE}
                      strokeWidth="1"
                    />
                    <circle cx={scale.x(p.wavelength_um)} cy={scale.y(p.flux_ujy)} r="2.5" fill={SINGLE} />
                  </g>
                ))}

              {/* Averaged spectrum */}
              {/* The line breaks across wavelength gaps: missing data is never bridged */}
              {segments.map((seg) => (
                <polyline
                  key={seg[0].wavelength_um}
                  points={seg.map((b) => `${scale.x(b.wavelength_um)},${scale.y(b.flux_ujy)}`).join(" ")}
                  fill="none"
                  stroke={AVERAGE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              ))}
              {binned.map((b) => (
                <g key={b.wavelength_um}>
                  <line
                    x1={scale.x(b.wavelength_um)}
                    x2={scale.x(b.wavelength_um)}
                    y1={scale.y(b.flux_ujy - b.flux_err_ujy)}
                    y2={scale.y(b.flux_ujy + b.flux_err_ujy)}
                    stroke={AVERAGE}
                    strokeWidth="1.5"
                  />
                  <circle cx={scale.x(b.wavelength_um)} cy={scale.y(b.flux_ujy)} r="4" fill={AVERAGE} stroke="#0d0d10" strokeWidth="2" />
                </g>
              ))}

              {/* Hover highlight */}
              {hover && (
                <circle
                  cx={scale.x(hover.point.wavelength_um)}
                  cy={scale.y(hover.point.flux_ujy)}
                  r="7"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              )}
            </svg>

            {hover && (
              <div
                className="pointer-events-none absolute z-10 w-56 rounded-lg border border-white/15 bg-black/90 p-2 text-xs text-white/80 shadow-lg"
                style={{
                  left: `${Math.min(78, (scale.x(hover.point.wavelength_um) / W) * 100)}%`,
                  top: `${Math.max(2, (scale.y(hover.point.flux_ujy) / H) * 100 - 30)}%`,
                }}
              >
                <p className="font-medium text-white">
                  {hover.point.wavelength_um.toFixed(3)} µm · {hover.point.band.replace("SPHEREx-", "Detector ")}
                </p>
                <p className="font-mono">
                  {formatFlux(hover.point.flux_ujy, scale.unit)} ±{" "}
                  {formatFlux(
                    hover.kind === "avg" ? hover.point.flux_err_ujy : (hover.point as SpectrumPoint).flux_err_total_ujy,
                    scale.unit,
                  )}{" "}
                  {scale.unit}
                </p>
                {hover.kind === "single" && (
                  <p className="text-white/45">
                    noise alone ± {formatFlux(hover.point.flux_err_ujy, scale.unit)} {scale.unit}
                  </p>
                )}
                {hover.kind === "avg" ? (
                  <p className="text-white/55">Average of {(hover.point as BinnedPoint).n} image(s)</p>
                ) : (
                  <p className="text-white/55">
                    {(hover.point as SpectrumPoint).time_utc?.slice(0, 10)} · {(hover.point as SpectrumPoint).obs_id}
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="mt-2 text-xs text-white/50">
            Each SPHEREx image sees this spot at a slightly different infrared wavelength (its filters change colour across
            the detector), so many images together trace the spectrum. D1–D6 at the top mark which detector measured each range.
            Where the line breaks, there were no usable images at those wavelengths.
          </p>

          {showFeatures && (
            <p className="mt-1 text-xs text-yellow-200/70">
              Dashed lines mark where these features would appear (rest wavelengths):{" "}
              {FEATURES.map((f) => `${f.label} ${f.um} µm = ${f.what}`).join("; ")}. A line is only a reference: it does not
              mean the feature is present in this source. Each SPHEREx channel is a few percent of the wavelength wide (about
              0.02 µm at 0.8 µm), so narrow lines show up as small bumps rather than sharp spikes.
            </p>
          )}

          {/* Skipped images */}
          {skippedTotal > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-white/70">Why {skippedTotal} images were left out</summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-white/60">
                {Object.entries(spectrum.skipped).map(([reason, n]) => (
                  <li key={reason}>
                    {n}: {SKIP_TEXT[reason] ?? reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Table view */}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-white/70">Table of the averaged points</summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-black text-white/55">
                  <tr>
                    <th className="px-2 py-1 font-medium">Wavelength (µm)</th>
                    <th className="px-2 py-1 text-right font-medium">Flux ({scale.unit})</th>
                    <th className="px-2 py-1 text-right font-medium">± 1σ</th>
                    <th className="px-2 py-1 text-right font-medium">Images</th>
                    <th className="px-2 py-1 font-medium">Detector</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-white/80">
                  {binned.map((b) => (
                    <tr key={b.wavelength_um} className="border-t border-white/5">
                      <td className="px-2 py-1">{b.wavelength_um.toFixed(3)}</td>
                      <td className="px-2 py-1 text-right">{formatFlux(b.flux_ujy, scale.unit)}</td>
                      <td className="px-2 py-1 text-right">{formatFlux(b.flux_err_ujy, scale.unit)}</td>
                      <td className="px-2 py-1 text-right">{b.n}</td>
                      <td className="px-2 py-1">{b.band.replace("SPHEREx-", "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {/* Method */}
          <details className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-white/85">How this spectrum was measured</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/65">
              {spectrum.method.description.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs font-medium text-amber-200/85">Limitations</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-white/65">
              {spectrum.method.caveats.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-white/50">
              For research-grade spectra use IRSA&apos;s official{" "}
              <a
                className="underline decoration-white/30 hover:decoration-white"
                href="https://irsa.ipac.caltech.edu/applications/spherex/"
                target="_blank"
                rel="noreferrer"
              >
                SPHEREx tools
              </a>
              . Data: {spectrum.collection_name}, NASA/IPAC IRSA.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
