import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import CopyLinkButton from "@/components/CopyLinkButton";
import SkyViewer from "@/components/sky/SkyViewer";
import { decToDms, formatDegrees, parseFov, raToHms, validateCoordinates } from "@/lib/coordinates";
import { findCuratedTarget, VERIFIED_ON } from "@/lib/curatedTargets";

export const metadata: Metadata = {
  title: "Stellar View · SPHEREx Xplorer",
};

// In Next.js 16, the URL's ?query values arrive as a Promise we must await.
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// A URL can contain ?ra=1&ra=2; keep only the first value.
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Stellar View page ("/explore?ra=..&dec=..").
// Reads the coordinates from the link, checks them with the same rules as the
// search box, and shows either the position or a friendly explanation.
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawRa = firstValue(params.ra);
  const rawDec = firstValue(params.dec);
  const result = validateCoordinates(rawRa, rawDec);
  const target = result.ok ? findCuratedTarget(result.ra, result.dec) : undefined;
  const nothingGiven = rawRa === undefined && rawDec === undefined;
  // View width: from the link if given, else the object's suggested size, else 1°
  const initialFov = parseFov(firstValue(params.fov)) ?? target?.fov ?? 1;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 animate-arrive px-4 py-6 xl:max-w-[1680px] motion-reduce:animate-none sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-violet-300">
          Stellar View
        </p>

        {result.ok ? (
          <>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                {target && (
                  <p className="text-lg text-white/80">{target.name}</p>
                )}
                <h1 className="text-2xl font-semibold sm:text-3xl">
                  RA {formatDegrees(result.ra)}° · Dec {formatDegrees(result.dec)}°
                </h1>
                <p
                  className="mt-1 font-mono text-sm text-white/50"
                  title="The same position written in hours/minutes/seconds (RA) and degrees/arcminutes/arcseconds (Dec)"
                >
                  {raToHms(result.ra)} · {decToDms(result.dec)}
                </p>
              </div>
              <CopyLinkButton />
            </div>

            {target && (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <p className="text-white/75">{target.blurb}</p>
                {target.spherexCoverageVerified ? (
                  <p className="mt-2 text-xs text-emerald-200/80">
                    From our curated list · {target.dr1ImageCount} SPHEREx DR1
                    images cover this spot (checked against the IRSA archive on{" "}
                    {VERIFIED_ON}).
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-200/80">
                    From our curated list. SPHEREx coverage not yet checked.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div role="alert" className="mt-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">
              {nothingGiven ? "No coordinates yet" : "This link has a problem"}
            </h1>
            {nothingGiven ? (
              <p className="mt-2 text-sm text-white/60">
                This link doesn&apos;t include RA and Dec. Go back and enter a
                sky position, or try Random Explore.
              </p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-rose-200">
                {result.raError && (
                  <li>
                    {result.raError}{" "}
                    <span className="text-white/40">(got: “{rawRa ?? ""}”)</span>
                  </li>
                )}
                {result.decError && (
                  <li>
                    {result.decError}{" "}
                    <span className="text-white/40">(got: “{rawDec ?? ""}”)</span>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {result.ok ? (
          <SkyViewer ra={result.ra} dec={result.dec} initialFov={initialFov} />
        ) : (
          <section
            aria-label="Sky viewer unavailable"
            className="mt-8 flex aspect-[16/9] w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center"
          >
            <p className="max-w-sm text-sm text-white/45">
              Fix the coordinates to view this part of the sky.
            </p>
          </section>
        )}

        <Link
          href="/"
          className="mt-8 inline-block text-sm text-violet-300 hover:text-violet-200"
        >
          ← Back to search
        </Link>
      </main>
    </div>
  );
}
