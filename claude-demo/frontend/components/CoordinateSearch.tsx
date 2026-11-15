"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  buildExploreUrl,
  formatDegrees,
  validateCoordinates,
  validateDec,
  validateRa,
} from "@/lib/coordinates";
import { pickRandomTarget } from "@/lib/curatedTargets";
import { announceLaunch, LAUNCH_MS } from "@/lib/launch";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const inputClass =
  "rounded-lg border bg-black/40 px-3 py-2.5 text-white outline-none transition focus:ring-2";
const okBorder = "border-white/15 focus:border-violet-400 focus:ring-violet-500/40";
const errorBorder = "border-rose-400/70 focus:border-rose-400 focus:ring-rose-500/40";

// The landing-page search box: checks the coordinates in the browser before
// navigating, and offers Random Explore from our curated target list.
export default function CoordinateSearch() {
  const router = useRouter();
  const [ra, setRa] = useState("83.633");
  const [dec, setDec] = useState("22.014");
  const [raError, setRaError] = useState<string>();
  const [decError, setDecError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const reducedMotion = usePrefersReducedMotion();
  const launching = useRef(false);

  // Undo the transition state if this page is left or shown again (e.g. Back button)
  useEffect(() => {
    const reset = () => {
      delete document.body.dataset.launching;
      launching.current = false;
    };
    window.addEventListener("pageshow", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
      reset();
    };
  }, []);

  // Play the Earth-to-sky transition, then open the Stellar View page
  function go(url: string) {
    router.prefetch(url);
    if (reducedMotion || launching.current) {
      router.push(url);
      return;
    }
    launching.current = true;
    document.body.dataset.launching = "true";
    announceLaunch();
    setTimeout(() => router.push(url), LAUNCH_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // we navigate ourselves after checking
    const result = validateCoordinates(ra, dec);
    if (!result.ok) {
      setRaError(result.raError);
      setDecError(result.decError);
      // Move keyboard focus to the first box with a problem
      document.getElementById(result.raError ? "ra-input" : "dec-input")?.focus();
      return;
    }
    setStatus("Heading to your sky position…");
    go(buildExploreUrl(result.ra, result.dec));
  }

  function handleRandom() {
    const target = pickRandomTarget();
    setRa(formatDegrees(target.ra));
    setDec(formatDegrees(target.dec));
    setRaError(undefined);
    setDecError(undefined);
    setStatus(`Heading to ${target.name}…`);
    go(buildExploreUrl(target.ra, target.dec, target.fov));
  }

  return (
    // action="/explore" still works as a plain link if JavaScript is off
    <form
      action="/explore"
      method="get"
      noValidate
      onSubmit={handleSubmit}
      className="w-full max-w-xl animate-fade-up rounded-2xl border border-white/10 bg-black/35 p-6 shadow-[0_0_60px_rgba(124,58,237,0.15)] backdrop-blur-md [animation-delay:200ms] motion-reduce:animate-none sm:p-8"
    >
      <h2 className="text-lg font-semibold tracking-wide">Where in the sky?</h2>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/80">Right Ascension (RA)</span>
          <input
            id="ra-input"
            name="ra"
            value={ra}
            onChange={(e) => {
              setRa(e.target.value);
              setRaError(undefined);
            }}
            onBlur={() => {
              const r = validateRa(ra);
              setRaError(r.ok ? undefined : r.error);
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(raError)}
            aria-describedby="ra-help"
            className={`${inputClass} ${raError ? errorBorder : okBorder}`}
          />
          <span
            id="ra-help"
            className={`text-xs ${raError ? "text-rose-300" : "text-white/45"}`}
          >
            {raError ?? "degrees, 0 to 360"}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/80">Declination (Dec)</span>
          <input
            id="dec-input"
            name="dec"
            value={dec}
            onChange={(e) => {
              setDec(e.target.value);
              setDecError(undefined);
            }}
            onBlur={() => {
              const r = validateDec(dec);
              setDecError(r.ok ? undefined : r.error);
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(decError)}
            aria-describedby="dec-help"
            className={`${inputClass} ${decError ? errorBorder : okBorder}`}
          />
          <span
            id="dec-help"
            className={`text-xs ${decError ? "text-rose-300" : "text-white/45"}`}
          >
            {decError ?? "degrees, −90 to +90"}
          </span>
        </label>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr]">
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-3 font-semibold tracking-wide transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          Explore
        </button>
        <button
          type="button"
          onClick={handleRandom}
          title="Jump to a famous object from our curated list"
          className="rounded-lg border border-white/20 px-4 py-3 font-medium text-white/85 transition hover:border-violet-300/60 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          Random Explore
        </button>
      </div>

      {/* Announced by screen readers when it changes */}
      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-violet-200/90">
        {status}
      </p>

      <p className="mt-2 text-sm leading-relaxed text-white/55">
        Sky positions work like a map wrapped around Earth.{" "}
        <strong className="font-medium text-white/80">RA</strong> is like
        longitude: it goes around the sky from 0° to 360°.{" "}
        <strong className="font-medium text-white/80">Dec</strong> is like
        latitude: from −90° (south pole of the sky) to +90° (north pole). The
        example above points at the Crab Nebula.
      </p>
    </form>
  );
}
