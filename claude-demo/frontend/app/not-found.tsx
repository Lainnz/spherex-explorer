import Link from "next/link";

// Shown for links to pages that don't exist.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-300">404</p>
      <h1 className="text-2xl font-semibold">This part of the sky isn&apos;t on our map.</h1>
      <p className="max-w-md text-sm text-white/65">The page you asked for doesn&apos;t exist. Try a coordinate search instead.</p>
      <Link href="/" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:brightness-110">
        Back to the start
      </Link>
    </main>
  );
}
