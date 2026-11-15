"use client";

import { useState } from "react";

const LABELS = {
  idle: "Copy link",
  copied: "Link copied ✓",
  failed: "Copy from the address bar",
} as const;

// Copies the current page address so people can share this sky position.
export default function CopyLinkButton() {
  const [state, setState] = useState<keyof typeof LABELS>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState("copied");
    } catch {
      // Some browser settings block clipboard access
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 transition hover:border-violet-300/60 hover:bg-white/5"
    >
      <span aria-live="polite">{LABELS[state]}</span>
    </button>
  );
}
