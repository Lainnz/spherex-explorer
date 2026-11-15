"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AladinInstance } from "@/lib/aladin";
import { BackendError } from "@/lib/backend";
import {
  getMosaicChannels,
  MOSAIC_NOTE,
  nearestFrame,
  PRESETS,
  rgbUrl,
  singleFrameUrl,
  type MosaicChannel,
} from "@/lib/spherexMosaic";

type Props = {
  aladinRef: RefObject<AladinInstance | null>;
  viewerReady: boolean;
  mode: "single" | "rgb";
  onLabel: (label: string) => void; // short description of what the background now shows
  onUnavailable?: () => void; // the backend couldn't provide the mosaic
  wavelengthRequest?: { um: number; n: number } | null; // jump the single-wavelength map to this wavelength
};

const DETECTOR_COLOURS = ["#7aa7ff", "#6fd3c1", "#9be37a", "#f5d76e", "#f5a25d", "#f07a7a"]; // decorative chips only

function label(c: MosaicChannel | undefined) {
  return c ? `${c.wavelength_um.toFixed(3)} µm (detector ${c.detector})` : "—";
}

export default function MosaicControls({ aladinRef, viewerReady, mode, onLabel, onUnavailable, wavelengthRequest }: Props) {
  const [channels, setChannels] = useState<MosaicChannel[] | null>(null);
  const [error, setError] = useState<BackendError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState(62); // shown frame (single mode)
  const [pending, setPending] = useState(62); // slider position while dragging
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [custom, setCustom] = useState<[number, number, number] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false); // details collapsed by default to keep the map visible

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getMosaicChannels()
      .then((r) => !cancelled && setChannels(r.channels))
      .catch((e: BackendError) => {
        if (cancelled) return;
        setError(e);
        onUnavailable?.();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Another part of the page asked for a particular wavelength (e.g. a loaded observation's)
  useEffect(() => {
    if (!wavelengthRequest || !channels) return;
    const f = nearestFrame(channels, wavelengthRequest.um);
    setPending(f);
    setFrame(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wavelengthRequest?.n, channels]);

  const usable = useMemo(() => (channels ?? []).filter((c) => !c.blank), [channels]);
  const preset = PRESETS.find((p) => p.id === presetId);
  const rgbFrames: [number, number, number] | null = useMemo(() => {
    if (!channels) return null;
    if (presetId === "custom" && custom) return custom;
    const p = preset ?? PRESETS[0];
    return [nearestFrame(channels, p.red), nearestFrame(channels, p.green), nearestFrame(channels, p.blue)];
  }, [channels, presetId, custom, preset]);

  // Apply the chosen map to the viewer
  useEffect(() => {
    const aladin = aladinRef.current;
    if (!aladin || !viewerReady || !channels) return;
    if (mode === "single") {
      // a new layer object each time, so Aladin doesn't reuse an old colour setting
      aladin.setBaseImageLayer(aladin.newImageSurvey(singleFrameUrl(frame), { name: `SPHEREx ${frame}`, colormap: "grayscale" }));
      onLabel(`SPHEREx all-sky mosaic at ${label(channels[frame])}`);
    } else if (rgbFrames) {
      aladin.setBaseImageLayer(
        aladin.newImageSurvey(rgbUrl(rgbFrames), { name: `SPHEREx RGB ${rgbFrames.join("-")}`, colormap: "native" }),
      );
      onLabel(
        `SPHEREx false colour — red ${channels[rgbFrames[0]].wavelength_um.toFixed(2)} µm, green ${channels[
          rgbFrames[1]
        ].wavelength_um.toFixed(2)} µm, blue ${channels[rgbFrames[2]].wavelength_um.toFixed(2)} µm`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, frame, rgbFrames?.join("-"), channels, viewerReady]);

  // Slider: update the label immediately, load the new map once the user pauses
  function onSlide(value: number) {
    setPending(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFrame(value), 350);
  }

  function setCustomColour(index: 0 | 1 | 2, value: number) {
    const base = rgbFrames ?? [62, 46, 22];
    const next = [...base] as [number, number, number];
    next[index] = value;
    setCustom(next);
    setPresetId("custom");
  }

  if (error) {
    return (
      <div role="alert" className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm">
        <p className="text-rose-200">The SPHEREx mosaic is unavailable: {error.message}</p>
        <button
          className="mt-2 rounded-md border border-white/15 px-3 py-1 text-sm text-white/85 hover:bg-white/10"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!channels) {
    return <p className="mb-3 animate-pulse text-sm text-white/60 motion-reduce:animate-none">Loading the SPHEREx channel list…</p>;
  }

  const sliderIndex = Math.max(0, usable.findIndex((c) => c.frame === pending));
  const shown = channels[pending];
  const detailsId = `mosaic-details-${mode}`;
  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-controls={detailsId}
      className="shrink-0 rounded-md px-2 py-1 text-xs text-teal-200/80 transition hover:bg-white/10"
    >
      {open ? "Less ▴" : "Details ▾"}
    </button>
  );

  return (
    <div className="mb-3 rounded-xl border border-teal-300/25 bg-teal-500/[0.05] px-3 py-2 text-sm">
      {mode === "single" ? (
        <>
          <div className="flex items-center gap-3">
            <label htmlFor="mosaic-wavelength" className="shrink-0 font-medium text-white">
              <span className="font-mono">{shown.wavelength_um.toFixed(3)} µm</span>
              <span className="ml-2 rounded px-1.5 py-0.5 text-[11px] text-black" style={{ background: DETECTOR_COLOURS[shown.detector - 1] }}>
                D{shown.detector}
              </span>
            </label>
            <input
              id="mosaic-wavelength"
              type="range"
              min={0}
              max={usable.length - 1}
              step={1}
              value={sliderIndex}
              onChange={(e) => onSlide(usable[Number(e.target.value)].frame)}
              className="min-w-0 flex-1 accent-teal-400"
              aria-valuetext={`${shown.wavelength_um.toFixed(3)} micrometres, detector ${shown.detector}`}
              title="Slide through SPHEREx's colours (wavelengths)"
            />
            {toggle}
          </div>
          {open && (
            <div id={detailsId} className="mt-2 space-y-1 text-xs text-white/60">
              <p>
                Channel {sliderIndex + 1} of {usable.length}, from {usable[0].wavelength_um.toFixed(2)} µm (bluest) to{" "}
                {usable.at(-1)!.wavelength_um.toFixed(2)} µm (reddest). Each step is a separate all-sky map: dust clouds, gas and
                stars brighten and fade at different wavelengths.
              </p>
              <p className="text-white/45">{MOSAIC_NOTE}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Recipes as buttons: always visible, one click to switch */}
            <div role="radiogroup" aria-label="False-colour recipe" className="flex flex-wrap overflow-hidden rounded-md border border-white/15 text-xs">
              {[...PRESETS.map((p) => ({ id: p.id, label: p.short })), { id: "custom", label: "Custom" }].map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={presetId === option.id}
                  onClick={() => {
                    setPresetId(option.id);
                    if (option.id !== "custom") setCustom(null);
                  }}
                  className={`px-2.5 py-1.5 transition ${
                    presetId === option.id ? "bg-teal-500/30 text-white" : "text-white/70 hover:bg-white/10"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {rgbFrames && presetId !== "custom" && (
              <span className="font-mono text-xs text-white/70" aria-label="Wavelength shown in each colour">
                <span className="text-rose-300">R</span> {channels[rgbFrames[0]].wavelength_um.toFixed(2)} ·{" "}
                <span className="text-emerald-300">G</span> {channels[rgbFrames[1]].wavelength_um.toFixed(2)} ·{" "}
                <span className="text-sky-300">B</span> {channels[rgbFrames[2]].wavelength_um.toFixed(2)} µm
              </span>
            )}
            {rgbFrames && presetId === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                {(["R", "G", "B"] as const).map((name, i) => (
                  <label key={name} className="flex items-center gap-1 text-xs">
                    <span className={i === 0 ? "text-rose-300" : i === 1 ? "text-emerald-300" : "text-sky-300"}>{name}</span>
                    <select
                      value={rgbFrames[i]}
                      onChange={(e) => setCustomColour(i as 0 | 1 | 2, Number(e.target.value))}
                      className="rounded-md border border-white/15 bg-black px-1.5 py-1 font-mono text-xs text-white"
                      aria-label={`${name === "R" ? "Red" : name === "G" ? "Green" : "Blue"} wavelength`}
                    >
                      {usable.map((c) => (
                        <option key={c.frame} value={c.frame}>
                          {c.wavelength_um.toFixed(3)} µm · D{c.detector}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <span className="ml-auto">{toggle}</span>
          </div>
          <p className="mt-1 text-xs text-amber-200/75">
            False colour: invisible infrared wavelengths shown as red, green and blue.
          </p>
          {open && (
            <div id={detailsId} className="mt-2 space-y-2 text-xs text-white/65">
              <p>
                {presetId === "custom"
                  ? "Your own choice: each colour shows one SPHEREx channel. Keep red for the longest wavelength to read it like a rainbow."
                  : preset?.explain}
              </p>
              <p className="text-white/50">
                Each colour is one SPHEREx channel; nothing is averaged across detectors. A new colour map takes a few seconds
                the first time.
              </p>
              <p className="text-white/45">{MOSAIC_NOTE}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
