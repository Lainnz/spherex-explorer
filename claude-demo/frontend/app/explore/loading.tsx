// Shown by Next.js while the Stellar View page is being prepared.
export default function ExploreLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-black text-white" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300 motion-reduce:animate-none" />
      <p className="text-sm text-white/65">Opening the Stellar View…</p>
    </div>
  );
}
