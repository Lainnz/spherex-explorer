import Image from "next/image";
import SpaceBackdrop from "@/components/space/SpaceBackdrop";
import CoordinateSearch from "@/components/CoordinateSearch";

// Landing page ("/").
// Cinematic 3D background (Milestone 2) + coordinate search (Milestone 3).
export default function HomePage() {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center overflow-hidden px-6">
      {/* Decorative 3D background: stars, comets, Earth (not real observations) */}
      <SpaceBackdrop />

      {/* Wrapper fades out during the Earth-to-sky transition */}
      <div className="launch-hide flex w-full flex-1 flex-col items-center">
        {/* Title: the horizontal logo already contains the words, so the
            text heading is kept for screen readers and search engines. */}
        <header className="flex w-full animate-fade-up flex-col items-center pt-6 motion-reduce:animate-none sm:pt-8">
          <h1 className="sr-only">SPHEREx Xplorer</h1>
          <Image
            src="/brand/logo-horizontal.png"
            alt="SPHEREx Xplorer"
            width={2172}
            height={724}
            loading="eager"
            className="h-auto w-[min(88vw,640px)]"
          />
          <p className="mt-2 max-w-md text-center text-sm text-white/60 sm:text-base">
            Explore the infrared sky with NASA&apos;s SPHEREx mission
          </p>
        </header>

        {/* Coordinate search with validation and Random Explore */}
        <section className="flex w-full flex-1 items-start justify-center pb-[24vh] pt-5 sm:pt-6">
          <CoordinateSearch />
        </section>
      </div>

      <footer className="launch-hide absolute bottom-3 w-full px-6 text-center text-[11px] leading-relaxed text-white/45">
        Earth night lights: NASA Black Marble 2016. Daytime Earth is an
        artistic map built from the same NASA data, with invented clouds.
        Stars, comets, satellites, the Moon and the flight into the sky are
        artistic effects, not real observations.
      </footer>

      {/* Black veil that closes at the end of the Earth-to-sky transition */}
      <div aria-hidden className="launch-veil fixed inset-0 z-50 bg-black" />
    </main>
  );
}
