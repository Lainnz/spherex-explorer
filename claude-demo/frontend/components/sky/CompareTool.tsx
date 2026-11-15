"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { AladinInstance } from "@/lib/aladin";
import {
  absoluteBackendUrl,
  getComparison,
  getTimeline,
  type Comparison,
  type Timeline,
  type TimelineObservation,
} from "@/lib/backend";
import { removeSpherexLayer, SPHEREX_LAYER } from "@/lib/spherexLayer";

type Props = {
  aladinRef: RefObject<AladinInstance | null>;
  viewerReady: boolean;
  ra: number;
  dec: number;
  band: string;
  sizeDeg: number;
  smooth: boolean;
};

type View = "side" | "blink" | "diff" | "signif" | "combined";

const VIEWS: [View, string][] = [
  ["side", "Side by side"],
  ["blink", "Blink"],
  ["diff", "Difference"],
  ["signif", "Significance"],
  ["combined", "Combined"],
];

const BLINK_RATES = [
  [1000, "Slow"],
  [500, "Medium"],
  [250, "Fast"],
] as const;

function fmtDate(iso?: string | null) {
  return iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—";
}

function fmt(value: number | null | undefined, digits = 3) {
  return value == null ? "—" : value.toFixed(digits);
}

// A picture of the comparison grid with a small marker at the target (centre)
function SkyImage({ src, label, smooth }: { src: string; label?: string; smooth: boolean }) {
  return (
    <figure className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={absoluteBackendUrl(src)}
        alt={label ?? "SPHEREx comparison image"}
        className="aspect-square w-full rounded-lg border border-white/10 bg-black"
        style={{ imageRendering: smooth ? "auto" : "pixelated" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/80"
      />
      <span className="absolute left-2 top-2 text-[10px] font-semibold text-white/70">N↑ E←</span>
      {label && <figcaption className="mt-1 text-xs text-white/60">{label}</figcaption>}
    </figure>
  );
}

function Legend({ left, right, unit, limit }: { left: string; right: string; unit: string; limit: number }) {
  return (
    <div className="mt-2 text-xs text-white/60">
      <div className="h-2 rounded bg-[linear-gradient(to_right,rgb(77,158,255),black,rgb(255,115,51))]" />
      <div className="mt-1 flex justify-between">
        <span>
          −{fmt(limit, 2)} {unit} · {left}
        </span>
        <span>no change</span>
        <span>
          +{fmt(limit, 2)} {unit} · {right}
        </span>
      </div>
    </div>
  );
}

export default function CompareTool({ aladinRef, viewerReady, ra, dec, band, sizeDeg, smooth }: Props) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loadError, setLoadError] = useState("");
  const [channelIndex, setChannelIndex] = useState(0);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [result, setResult] = useState<Comparison | null>(null);
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("side");
  const [blinkMs, setBlinkMs] = useState(500);
  const [blinkOn, setBlinkOn] = useState(true);
  const [showingB, setShowingB] = useState(false);
  const [onMap, setOnMap] = useState(false);

  // Timeline (same as the time machine; cached by the backend)
  useEffect(() => {
    let cancelled = false;
    setTimeline(null);
    setLoadError("");
    setResult(null);
    setState("idle");
    getTimeline(ra, dec, band)
      .then((t) => !cancelled && (setTimeline(t), setChannelIndex(0)))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [ra, dec, band]);

  const comparableChannels = useMemo(() => (timeline?.channels ?? []).filter((c) => c.count >= 2), [timeline]);
  const channel = comparableChannels[channelIndex];
  const members: TimelineObservation[] = useMemo(() => {
    if (!timeline || !channel) return [];
    const ids = new Set(channel.observation_ids);
    return timeline.observations.filter((o) => ids.has(o.id));
  }, [timeline, channel]);

  // Default pair: first and last observation in the channel
  useEffect(() => {
    setAId(members[0]?.id ?? "");
    setBId(members.at(-1)?.id ?? "");
    setResult(null);
    setState("idle");
  }, [members]);

  // Blink timer
  useEffect(() => {
    if (view !== "blink" || !blinkOn || !result) return;
    const timer = setInterval(() => setShowingB((s) => !s), blinkMs);
    return () => clearInterval(timer);
  }, [view, blinkOn, blinkMs, result]);

  // Remove the map layer when this tool goes away
  useEffect(() => () => removeSpherexLayer(aladinRef.current), [aladinRef]);

  async function runComparison() {
    const a = members.find((m) => m.id === aId);
    const b = members.find((m) => m.id === bId);
    if (!a || !b || a.id === b.id) return;
    const [early, late] = (a.time_mjd ?? 0) <= (b.time_mjd ?? 0) ? [a, b] : [b, a];
    setState("working");
    setError("");
    setOnMap(false);
    removeSpherexLayer(aladinRef.current);
    try {
      setResult(await getComparison(early, late, ra, dec, sizeDeg));
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  function toggleOnMap() {
    const aladin = aladinRef.current;
    if (!aladin || !result) return;
    if (onMap) {
      removeSpherexLayer(aladin);
      setOnMap(false);
      return;
    }
    const limit = result.display.signif_limit;
    aladin.displayFITS(
      absoluteBackendUrl(result.files.signif_fits),
      { minCut: -limit, maxCut: limit, colormap: "rdbu" },
      (_ra, _dec, _fov, image) => {
        image.setColormap?.("rdbu", { stretch: "linear", reversed: true });
        setOnMap(true);
      },
      () => setError("The viewer could not display the significance map."),
      SPHEREX_LAYER,
    );
  }

  const buttonClass =
    "rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/85 transition hover:border-violet-300/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  if (loadError) return <p role="alert" className="mt-3 text-sm text-rose-200">{loadError}</p>;
  if (!timeline)
    return (
      <p className="mt-3 animate-pulse text-sm text-white/60 motion-reduce:animate-none">
        Finding observations that can be fairly compared (same detector, same wavelength at this spot)…
      </p>
    );
  if (comparableChannels.length === 0)
    return (
      <p className="mt-3 text-sm text-white/65">
        No wavelength channel here has two observations yet, so there is no fair pair to compare. Try another detector,
        or the North Ecliptic Pole (RA 270, Dec 66.56).
      </p>
    );

  const r = result;
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-white/70">
        Only pairs with the <strong className="text-white">same wavelength at this spot</strong> are offered, so any
        difference reflects change over time — not a different colour of light.
      </p>

      {/* Pair selection */}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-white/60">Wavelength channel</span>
          <select
            value={channelIndex}
            onChange={(e) => setChannelIndex(Number(e.target.value))}
            className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
          >
            {comparableChannels.map((c, i) => (
              <option key={i} value={i}>
                {c.wavelength_um.toFixed(3)} µm · {c.count} obs
              </option>
            ))}
          </select>
        </label>
        {(["A (earlier)", "B (later)"] as const).map((label, side) => (
          <label key={label} className="flex flex-col gap-1">
            <span className="text-white/60">Observation {label}</span>
            <select
              value={side === 0 ? aId : bId}
              onChange={(e) => (side === 0 ? setAId : setBId)(e.target.value)}
              className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {fmtDate(m.time_utc)} · {m.wavelength_um} µm
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          className={`${buttonClass} border-violet-400/60 bg-violet-600/40`}
          onClick={runComparison}
          disabled={state === "working" || !aId || !bId || aId === bId}
        >
          {state === "working" ? "Aligning and comparing…" : "Compare"}
        </button>
      </div>
      {aId === bId && <p className="text-xs text-amber-200/80">Choose two different observations.</p>}
      {state === "working" && (
        <p className="text-xs text-white/55">
          Downloading both cutouts if needed, subtracting zodiacal light, aligning them on a common grid and propagating
          uncertainties. This takes a few seconds (longer for large cutouts).
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      )}

      {r && state === "done" && (
        <>
          {/* View switcher */}
          <div role="tablist" aria-label="Comparison view" className="flex flex-wrap gap-1">
            {VIEWS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  view === value ? "bg-violet-600/70 text-white" : "border border-white/15 text-white/70 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-3xl">
            {view === "side" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SkyImage src={r.files.a_png} smooth={smooth} label={`A · ${fmtDate(r.pair.a.date_utc)} · ${r.pair.a.wavelength_um} µm`} />
                <SkyImage src={r.files.b_png} smooth={smooth} label={`B · ${fmtDate(r.pair.b.date_utc)} · ${r.pair.b.wavelength_um} µm`} />
              </div>
            )}

            {view === "blink" && (
              <div className="mx-auto max-w-md">
                <SkyImage
                  src={showingB ? r.files.b_png : r.files.a_png}
                  smooth={smooth}
                  label={showingB ? `B · ${fmtDate(r.pair.b.date_utc)}` : `A · ${fmtDate(r.pair.a.date_utc)}`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button className={buttonClass} onClick={() => setBlinkOn((b) => !b)}>
                    {blinkOn ? "❚❚ Pause blink" : "▶ Blink"}
                  </button>
                  {!blinkOn && (
                    <button className={buttonClass} onClick={() => setShowingB((s) => !s)}>
                      Swap A ⇄ B
                    </button>
                  )}
                  {BLINK_RATES.map(([ms, label]) => (
                    <button
                      key={ms}
                      onClick={() => setBlinkMs(ms)}
                      className={`rounded-md px-2.5 py-1 text-sm ${blinkMs === ms ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-white/50">
                  Blinking flips between the two aligned images. Anything that jumps, appears or disappears changed between
                  the dates.
                </p>
              </div>
            )}

            {view === "diff" && (
              <div className="mx-auto max-w-md">
                <SkyImage src={r.files.diff_png} smooth={smooth} label="Difference B − A (MJy/sr)" />
                <Legend left="fainter in B" right="brighter in B" unit="MJy/sr" limit={r.display.diff_limit} />
              </div>
            )}

            {view === "signif" && (
              <div className="mx-auto max-w-md">
                <SkyImage
                  src={r.files.signif_png}
                  smooth={smooth}
                  label={`Significance: difference ÷ uncertainty (pixel noise + ${Math.round(r.statistics.systematic_fraction * 100)}% systematic)`}
                />
                <Legend left="fainter" right="brighter" unit="σ" limit={r.display.signif_limit} />
                <button className={`${buttonClass} mt-2`} onClick={toggleOnMap} disabled={!viewerReady}>
                  {onMap ? "Remove from sky map" : "Show significance map on the sky map"}
                </button>
              </div>
            )}

            {view === "combined" && (
              <div className="mx-auto max-w-md">
                <SkyImage src={r.files.combined_png} smooth={smooth} label="Combined: noise-weighted average of A and B" />
                <p className="mt-1 text-xs text-white/50">
                  Allowed here because both images see the same wavelength. Averaging lowers the noise (uncertainty at
                  the target: {fmt(r.target.combined_sigma)} vs {fmt(r.target.a_sigma)} and {fmt(r.target.b_sigma)} MJy/sr).
                </p>
              </div>
            )}
          </div>

          {/* Quality and uncertainty report */}
          <details open className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-white/85">Measurements and quality</summary>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 sm:text-sm">
              <p>
                <span className="text-white/50">Time between: </span>
                <span className="font-mono">{fmt(r.pair.delta_days, 1)} days</span>
              </p>
              <p title="Difference in the wavelength seen at the target. Must be within the allowed range.">
                <span className="text-white/50">Wavelength difference: </span>
                <span className="font-mono">
                  {fmt(r.pair.delta_wavelength_um, 4)} µm (allowed ±{fmt(r.pair.allowed_delta_um, 4)})
                </span>
              </p>
              <p title="Typical star width in each image. They are not matched, so bright stars can leave small residuals.">
                <span className="text-white/50">Sharpness (PSF) A / B: </span>
                <span className="font-mono">
                  {r.pair.a.psf_fwhm_arcsec}″ / {r.pair.b.psf_fwhm_arcsec}″
                </span>
              </p>
              <p>
                <span className="text-white/50">Usable pixels: </span>
                <span className="font-mono">{fmt((r.statistics.valid_fraction ?? 0) * 100, 1)}%</span>
              </p>
              <p title="Zodiacal-light-subtracted surface brightness at the target, with 1σ uncertainty.">
                <span className="text-white/50">At target A → B: </span>
                <span className="font-mono">
                  {fmt(r.target.a)} ± {fmt(r.target.a_sigma)} → {fmt(r.target.b)} ± {fmt(r.target.b_sigma)} MJy/sr
                </span>
              </p>
              <p title="Change at the target and its pixel-noise uncertainty. The two σ values: pixel noise only, and including the systematic term.">
                <span className="text-white/50">Change at target: </span>
                <span className="font-mono">
                  {fmt(r.target.difference)} ± {fmt(r.target.difference_sigma)} MJy/sr ·{" "}
                  {fmt(r.target.significance_noise_only, 1)}σ noise-only, {fmt(r.target.significance, 1)}σ with systematics
                </span>
              </p>
              <p title="If the uncertainties are right, the significance map's spread should be close to 1.">
                <span className="text-white/50">Noise check (should be ≈1): </span>
                <span className="font-mono">{fmt(r.statistics.robust_std_significance, 2)}</span>
              </p>
              <p title={`Counting pixel noise plus a ${Math.round(r.statistics.systematic_fraction * 100)}% systematic term for star-shape and alignment effects (noise only: ${r.statistics.pixels_beyond_5_sigma_noise_only}).`}>
                <span className="text-white/50">Pixels changed by more than 5σ: </span>
                <span className="font-mono">
                  {r.statistics.pixels_beyond_5_sigma}{" "}
                  <span className="text-white/45">(noise-only count: {r.statistics.pixels_beyond_5_sigma_noise_only})</span>
                </span>
              </p>
            </div>

            {r.statistics.candidates.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-white/55">
                  Strongest changes (could be real variability, moving objects, or artefacts — check them by blinking):
                </p>
                <ul className="mt-1 grid gap-x-4 font-mono text-xs text-white/75 sm:grid-cols-2">
                  {r.statistics.candidates.map((c) => (
                    <li key={`${c.ra},${c.dec}`}>
                      RA {c.ra.toFixed(4)}°, Dec {c.dec.toFixed(4)}° · {c.significance > 0 ? "+" : ""}
                      {c.significance}σ
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 grid gap-3 text-xs text-white/55 sm:grid-cols-2">
              <div>
                <p className="font-medium text-white/70">What was done</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {r.method.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-white/70">Limitations</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {r.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
