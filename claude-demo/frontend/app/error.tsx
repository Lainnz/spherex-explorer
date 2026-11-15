"use client";

import Link from "next/link";
import { useEffect } from "react";

// Shown by Next.js if a page crashes, instead of a blank screen.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[SPHEREx Xplorer] page error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-300">Something went wrong</p>
      <h1 className="text-2xl font-semibold">This page hit an unexpected problem.</h1>
      <p className="max-w-md text-sm text-white/65">
        No data was changed. You can try again, or go back to the start. Details are in the browser console (F12).
      </p>
      <p className="max-w-md font-mono text-xs text-white/40">{error.message}</p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:brightness-110">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
