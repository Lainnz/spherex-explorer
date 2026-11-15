"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AladinImageLayer, AladinInstance } from "@/lib/aladin";
import {
  getCutout,
  getTimeline,
  type CutoutInfo,
  type CutoutShape,
  type Timeline,
  type TimelineObservation,
} from "@/lib/backend";
import { removeSpherexLayer, showSpherexLayer, SPHEREX_LAYER, type DisplayScale } from "@/lib/spherexLayer";

type Props = {
  aladinRef: RefObject<AladinInstance | null>;
  viewerReady: boolean;
  ra: number;
  dec: number;
  band: string; // "SPHEREx-D1" … "SPHEREx-D6"
  sizeDeg: number;
  smooth: boolean;
  shape?: CutoutShape;
  playerSlot?: HTMLElement | null; // where to show the player (above the sky map)
  showSettings?: boolean; // show the settings and details (when the Time machine tab is open)
  hideSignal?: number; // bump to hide the time-machine frames (another tool is using the map)
  onActivate?: () => void; // called when the time machine puts a frame on the map
};

type Selection = "channel" | "all";
type Pacing = "frame" | "time";

const SPEEDS = [0.5, 1, 2, 4];
const FRAME_MS = 1600; // frame-by-frame: time per frame at 1×
const MS_PER_DAY = 40; // time-proportional: real days → milliseconds at 1×
const MIN_MS = 350;
const MAX_MS = 8000;

function fmtDate(iso?: string | null) {
  return iso ? iso.replace("T", " ").replace("Z", "").slice(0, 16) + " UTC" : "—";
}

function fmtGap(days: number) {
  if (days < 1 / 24) return `${Math.round(days * 1440)} min`;
  if (days < 2) return `${(days * 24).toFixed(1)} h`;
  return `${Math.round(days)} days`;
}

// Each frame gets its own viewer layer, loaded once; playback just switches
// which layer is visible, so changing frames is instant at any speed.
const frameLayerName = (i: number) => `${SPHEREX_LAYER}-t${i}`;

export default function TimeMachine({
  aladinRef,
  viewerReady,
  ra,
  dec,
  band,
  sizeDeg,
  smooth,
  shape = "square",
  playerSlot = null,
  showSettings = true,
  hideSignal = 0,
  onActivate,
}: Props) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection>("channel");
  const [channelIndex, setChannelIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(-1); // -1 = nothing shown yet
  const [frameInfo, setFrameInfo] = useState<CutoutInfo | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pacing, setPacing] = useState<Pacing>("frame");

  const [prepared, setPrepared] = useState(0); // how many frames are loaded into the viewer

  const cutoutCache = useRef(new Map<string, Promise<CutoutInfo>>());
  const scaleRef = useRef<DisplayScale | null>(null); // same brightness scale for every frame
  const layersRef = useRef(new Map<number, Promise<{ info: CutoutInfo; layer: AladinImageLayer }>>());
  const readyLayersRef = useRef(new Map<number, AladinImageLayer>());
  const requestRef = useRef(0);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const generationRef = useRef(0); // bumps whenever the frame set changes

  // 1. Load the timeline for this detector and position
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setTimeline(null);
    setPlaying(false);
    setFrameIndex(-1);
    setFrameInfo(null);
    getTimeline(ra, dec, band)
      .then((t) => {
        if (cancelled) return;
        setTimeline(t);
        setChannelIndex(0);
        setState("ready");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ra, dec, band, aladinRef]);

  // 2. Which observations are the frames?
  const frames: TimelineObservation[] = useMemo(() => {
    if (!timeline) return [];
    const usable = timeline.observations.filter((o) => o.inside && o.wavelength_um != null);
    if (selection === "all") return usable; // already sorted by time
    const channel = timeline.channels[channelIndex];
    if (!channel) return [];
    const ids = new Set(channel.observation_ids);
    return usable.filter((o) => ids.has(o.id));
  }, [timeline, selection, channelIndex]);

  // Remove every frame layer from the viewer
  const clearFrameLayers = useCallback(() => {
    for (const index of layersRef.current.keys()) removeSpherexLayer(aladinRef.current, frameLayerName(index));
    layersRef.current.clear();
    readyLayersRef.current.clear();
  }, [aladinRef]);

  // New set of frames (or size/smoothing) → start over with a fresh brightness scale
  useEffect(() => {
    generationRef.current += 1;
    requestRef.current += 1;
    setPlaying(false);
    setFrameIndex(-1);
    setFrameInfo(null);
    setPrepared(0);
    scaleRef.current = null;
    clearFrameLayers();
    return clearFrameLayers; // also tidy up when leaving the page
  }, [frames, sizeDeg, smooth, shape, aladinRef, clearFrameLayers]);

  const fetchCutout = useCallback(
    (obs: TimelineObservation) => {
      const key = `${obs.id}|${sizeDeg}|${smooth}|${shape}`;
      let promise = cutoutCache.current.get(key);
      if (!promise) {
        promise = getCutout(obs, ra, dec, sizeDeg, smooth, shape);
        promise.catch(() => cutoutCache.current.delete(key)); // allow retry
        cutoutCache.current.set(key, promise);
      }
      return promise;
    },
    [ra, dec, sizeDeg, smooth, shape],
  );

  // Load frame `index` into its own (hidden) viewer layer, once
  const ensureLayer = useCallback(
    (index: number) => {
      let promise = layersRef.current.get(index);
      if (!promise) {
        const generation = generationRef.current;
        promise = (async () => {
          const aladin = aladinRef.current;
          const obs = frames[index];
          if (!aladin || !obs) throw new Error("Viewer not ready");
          const info = await fetchCutout(obs);
          if (!scaleRef.current) scaleRef.current = { min: info.image.display_min, max: info.image.display_max };
          const layer = await showSpherexLayer(aladin, info, scaleRef.current, 0, frameLayerName(index));
          if (generation === generationRef.current) {
            readyLayersRef.current.set(index, layer);
            setPrepared(readyLayersRef.current.size);
          }
          return { info, layer };
        })();
        promise.catch(() => layersRef.current.delete(index)); // allow retry
        layersRef.current.set(index, promise);
      }
      return promise;
    },
    [aladinRef, frames, fetchCutout],
  );

  // 3. Show one frame: make its layer visible and hide the others
  const showFrame = useCallback(
    async (index: number) => {
      if (!aladinRef.current || !frames[index]) return;
      const request = ++requestRef.current;
      setFrameLoading(true);
      setFrameError("");
      try {
        const { info } = await ensureLayer(index);
        if (request !== requestRef.current) return; // a newer request won
        removeSpherexLayer(aladinRef.current); // the time machine takes over the map
        onActivateRef.current?.();
        for (const [i, layer] of readyLayersRef.current) layer.setOpacity?.(i === index ? 1 : 0);
        setFrameIndex(index);
        setFrameInfo(info);
        // Quietly prepare the next frame so playback never waits
        if (frames.length > 1) ensureLayer((index + 1) % frames.length).catch(() => undefined);
      } catch (e) {
        setPlaying(false);
        setFrameError(e instanceof Error ? e.message : "Could not load this frame.");
      } finally {
        if (request === requestRef.current) setFrameLoading(false);
      }
    },
    [aladinRef, frames, ensureLayer],
  );

  // Load all frames in the background (one at a time, to be gentle on the archive)
  const prepareAll = useCallback(async () => {
    const generation = generationRef.current;
    for (let i = 0; i < frames.length; i++) {
      if (generation !== generationRef.current) return;
      await ensureLayer(i).catch(() => undefined);
    }
  }, [frames, ensureLayer]);

  // 4. Playback: wait, then advance (only after the current frame is on screen)
  const nextIndex = frames.length ? (frameIndex + 1) % frames.length : 0;
  const gapDays =
    frameIndex >= 0 && nextIndex > frameIndex
      ? (frames[nextIndex].time_mjd ?? 0) - (frames[frameIndex].time_mjd ?? 0)
      : 0;
  const delayMs =
    pacing === "frame" || nextIndex <= frameIndex
      ? FRAME_MS / speed
      : Math.min(MAX_MS, Math.max(MIN_MS, gapDays * MS_PER_DAY)) / speed;

  useEffect(() => {
    if (!playing || frameLoading || frames.length < 2) return;
    if (frameIndex < 0) {
      showFrame(0);
      return;
    }
    const timer = setTimeout(() => showFrame(nextIndex), delayMs);
    return () => clearTimeout(timer);
  }, [playing, frameLoading, frameIndex, nextIndex, delayMs, frames.length, showFrame]);

  // Another tool (single observation, compare) wants the map: hide our frames
  useEffect(() => {
    if (!hideSignal) return;
    requestRef.current += 1;
    setPlaying(false);
    for (const layer of readyLayersRef.current.values()) layer.setOpacity?.(0);
    setFrameIndex(-1);
    setFrameInfo(null);
  }, [hideSignal]);

  // ----- Rendering -----------------------------------------------------------
  const barClass = "mb-3 rounded-xl border border-violet-400/30 bg-violet-500/[0.06] px-3 py-2 text-sm";
  const barTitle = <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-violet-200/80">Time machine</span>;
  if (state === "loading" || state === "error" || !timeline) {
    const message =
      state === "loading" ? (
        <span className="animate-pulse text-white/60 motion-reduce:animate-none">
          Finding every {band.replace("SPHEREx-", "")} visit to this spot (a few seconds; up to a minute near the ecliptic
          poles; instant next time)…
        </span>
      ) : (
        <span role="alert" className="text-rose-200">
          {error || "Could not build the timeline."}
        </span>
      );
    const bar = (
      <div className={barClass}>
        {barTitle}
        {message}
      </div>
    );
    return <>{playerSlot ? createPortal(bar, playerSlot) : showSettings ? bar : null}</>;
  }

  const usableCount = timeline.observations.filter((o) => o.inside && o.wavelength_um != null).length;
  const t0 = frames[0]?.time_mjd ?? 0;
  const t1 = frames.at(-1)?.time_mjd ?? t0;
  const span = Math.max(t1 - t0, 1e-6);
  const current = frameIndex >= 0 ? frames[frameIndex] : null;
  const playerButtonClass =
    "px-2.5 py-1 text-sm text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  // Compact player bar: dots on a real-date track, frame slider, play controls
  const player = (
    <div className={barClass}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-violet-200/80">
          Time machine · {band.replace("SPHEREx-", "")}
        </span>
        <div className="flex overflow-hidden rounded-md border border-white/15">
          <button
            className={playerButtonClass}
            onClick={() => {
              setPlaying(false);
              showFrame(frameIndex <= 0 ? frames.length - 1 : frameIndex - 1);
            }}
            disabled={!viewerReady}
            aria-label="Previous observation"
            title="Previous observation"
          >
            ◀
          </button>
          <button
            className={`${playerButtonClass} min-w-20 bg-violet-600/50 text-white`}
            onClick={() => {
              if (!playing) prepareAll();
              setPlaying((p) => !p);
            }}
            disabled={!viewerReady || frames.length < 2}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            className={playerButtonClass}
            onClick={() => {
              setPlaying(false);
              showFrame(nextIndex);
            }}
            disabled={!viewerReady}
            aria-label="Next observation"
            title="Next observation"
          >
            ▶
          </button>
        </div>
        <div role="radiogroup" aria-label="Playback speed" className="flex overflow-hidden rounded-md border border-white/15 text-xs">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              role="radio"
              aria-checked={speed === sp}
              onClick={() => setSpeed(sp)}
              className={`px-2 py-1 ${speed === sp ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
            >
              {sp}×
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-white/80">
          {current ? `${fmtDate(current.time_utc)} · ${current.wavelength_um} µm` : "Press ▶ or pick a dot"} · {frameIndex >= 0 ? frameIndex + 1 : "–"}/
          {frames.length}
        </span>
      </div>

      {/* Dots placed at their real dates */}
      <div className="relative mt-2 h-6 rounded-md bg-white/[0.04]" aria-hidden>
        <div className="absolute inset-x-3 top-1/2 h-px bg-white/20" />
        {frames.map((f, i) => (
          <button
            key={f.id}
            tabIndex={-1}
            onClick={() => showFrame(i)}
            title={`${fmtDate(f.time_utc)} · ${f.wavelength_um} µm`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
              i === frameIndex ? "border-white bg-violet-400" : "border-violet-300/70 bg-black hover:bg-violet-500/50"
            }`}
            style={{ left: `calc(12px + (100% - 24px) * ${((f.time_mjd ?? t0) - t0) / span})` }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(frames.length - 1, 0)}
        step={1}
        value={Math.max(frameIndex, 0)}
        onChange={(e) => {
          setPlaying(false);
          showFrame(Number(e.target.value));
        }}
        disabled={!viewerReady}
        className="mt-1 w-full accent-violet-500"
        aria-label="Observation frame"
        aria-valuetext={current ? fmtDate(current.time_utc) : "No frame shown"}
      />
      <div className="flex justify-between text-[11px] text-white/45">
        <span>{frames[0]?.time_utc?.slice(0, 10)}</span>
        <span>dots placed by real date</span>
        <span>{frames.at(-1)?.time_utc?.slice(0, 10)}</span>
      </div>
        {frames.length > 0 && prepared < frames.length && (playing || frameLoading) && (
          <p className="text-xs text-white/55">
            Loading frames into the viewer: {prepared} of {frames.length} ready. The first time, each one downloads a
            cutout from IRSA; playback runs at full speed once they are loaded.
          </p>
        )}
        {frames.length > 0 && prepared === frames.length && (
          <p className="text-xs text-emerald-200/70">All {frames.length} frames loaded — playback speed is now exact.</p>
        )}
    </div>
  );

  const playerOrNote =
    frames.length > 0 ? (
      player
    ) : (
      <div className={barClass}>
        {barTitle}
        <span className="text-white/60">
          Only one {band.replace("SPHEREx-", "")} visit at this wavelength, so there is nothing to play. Pick another
          channel in the Time machine tab.
        </span>
      </div>
    );

  return (
    <>
      {playerSlot && createPortal(playerOrNote, playerSlot)}
      {showSettings && (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-white/70">
        {usableCount} observations with {band.replace("SPHEREx-", "Detector ")} cover this spot. Because each
        detector sees a different wavelength at different positions, they fall into{" "}
        <strong className="text-white">{timeline.channels.length}</strong> wavelength channels.
        {timeline.failed > 0 && ` (${timeline.failed} could not be read.)`}
      </p>

      {/* What to compare */}
      <div className="flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Which observations" className="flex overflow-hidden rounded-md border border-white/15 text-sm">
          {(
            [
              ["channel", "Same wavelength (comparable)"],
              ["all", "All wavelengths"],
            ] as [Selection, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={selection === value}
              onClick={() => setSelection(value)}
              className={`px-3 py-1.5 ${selection === value ? "bg-violet-600/70 text-white" : "text-white/70 hover:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {selection === "channel" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-white/60">Wavelength channel</span>
            <select
              value={channelIndex}
              onChange={(e) => setChannelIndex(Number(e.target.value))}
              className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-white"
            >
              {timeline.channels.map((c, i) => (
                <option key={i} value={i}>
                  {c.wavelength_um.toFixed(3)} µm · {c.count} obs · {c.first_utc.slice(0, 10)} → {c.last_utc.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {selection === "all" && (
        <p className="rounded-md border border-amber-300/30 bg-amber-400/10 p-2 text-xs text-amber-100/90">
          Mixed wavelengths: each frame shows a slightly different colour of infrared light, so brightness changes
          between frames can come from the wavelength, not from real change over time. Use “Same wavelength” to
          compare like with like.
        </p>
      )}
      {selection === "channel" && frames.length < 2 && (
        <p className="text-sm text-white/65">
          Only one observation at this wavelength, so there is nothing to compare over time yet. Try another channel,
          or the North Ecliptic Pole (RA 270, Dec 66.56), which SPHEREx revisits every few days.
        </p>
      )}

      {playerSlot && frames.length > 0 && (
        <p className="text-xs text-violet-200/70">▶ The player is above the sky map, on the left.</p>
      )}
      {!playerSlot && frames.length > 0 && player}

      {frames.length > 0 && (
        <div role="radiogroup" aria-label="Playback pacing" className="flex w-fit overflow-hidden rounded-md border border-white/15 text-sm">
          {(
            [
              ["frame", "Frame by frame"],
              ["time", "Real time gaps"],
            ] as [Pacing, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={pacing === value}
              onClick={() => setPacing(value)}
              className={`px-2.5 py-1.5 ${pacing === value ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {frames.length > 0 && (
        <p className="text-xs text-white/50">
          {pacing === "frame"
            ? "Frame by frame: every observation is shown for the same time, however far apart they were taken."
            : "Real time gaps: the wait before each frame grows with the real time between observations (1 day ≈ 0.04 s at 1×, capped at 8 s)."}
          {playing && frameIndex >= 0 && nextIndex > frameIndex && ` Next frame: ${fmtGap(gapDays)} later.`}
        </p>
      )}

      {frameError && (
        <p role="alert" className="text-sm text-rose-200">
          {frameError}
        </p>
      )}

      {/* Current frame details */}
      {current && frameInfo && (
        <div className="grid gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-white/45">Observed</p>
            <p className="font-mono text-white/90">{fmtDate(current.time_utc)}</p>
          </div>
          <div>
            <p className="text-xs text-white/45">Wavelength at target</p>
            <p className="font-mono text-white/90">{current.wavelength_um} µm</p>
          </div>
          <div>
            <p className="text-xs text-white/45">Brightness at target</p>
            <p className="font-mono text-white/90">
              {frameInfo.target.surface_brightness ?? "—"} ± {frameInfo.target.uncertainty ?? "?"}{" "}
              <span className="text-white/45">MJy/sr</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-white/45">Observation ID</p>
            <p className="font-mono text-white/90">{current.obs_id}</p>
          </div>
          <p className="text-xs text-white/45 sm:col-span-4">
            Every frame uses the same brightness scale, so a real brightening or fading would show. The square may turn
            between frames because the spacecraft was oriented differently. Only real observations are shown — no
            frames are invented to fill the gaps.
          </p>
        </div>
      )}
    </div>
      )}
    </>
  );
}
