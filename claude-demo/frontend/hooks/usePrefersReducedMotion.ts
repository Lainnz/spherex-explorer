"use client";

import { useSyncExternalStore } from "react";

// True when the visitor has asked their operating system to reduce motion
// (Windows: Settings > Accessibility > Visual effects > Animation effects off).
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false, // on the server we can't know, so assume motion is fine
  );
}
