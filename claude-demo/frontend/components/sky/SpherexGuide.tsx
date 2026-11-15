"use client";

// Plain-language background for the SPHEREx tools. Facts come from the IRSA DR1
// overview, the HiPS cube description, and what our own archive queries returned.

const DETECTORS = [
  { d: 1, range: "0.75–1.10", see: "Starlight. Most stars are brightest here." },
  { d: 2, range: "1.11–1.63", see: "Stars and galaxies; light that passes through thin dust." },
  { d: 3, range: "1.66–2.40", see: "Dust-hidden stars; hydrogen gas glows at 1.88 µm (Paschen-α)." },
  { d: 4, range: "2.45–3.77", see: "Water ice absorbs near 3.05 µm; organic PAH molecules glow at 3.3 µm." },
  { d: 5, range: "3.83–4.41", see: "Hot hydrogen gas at 4.05 µm (Brackett-α); CO₂ ice absorbs near 4.27 µm." },
  { d: 6, range: "4.44–4.99", see: "Warm dust; carbon monoxide near 4.67 µm." },
];

export default function SpherexGuide() {
  return (
    <details className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-white/85">Guide: what SPHEREx sees and how to read these tools</summary>
      <div className="mt-2 space-y-3 text-xs leading-relaxed text-white/70">
        <p>
          <strong className="text-white/85">SPHEREx</strong> is a NASA mission launched in March 2025. It maps the{" "}
          <em>whole sky</em> in infrared light from 0.75 to 5.0 micrometres (µm), wavelengths too long for our eyes, split into
          102 colours. That makes it a spectrum of every point in the sky rather than a set of sharp close-ups.
        </p>
        <p>
          <strong className="text-white/85">Rainbow filters.</strong> Each of SPHEREx&apos;s six detectors sits behind a filter whose
          colour changes smoothly from one side to the other. A star near one edge is seen at a slightly different
          wavelength than near the other. As the telescope steps across the sky, the same star lands on different parts
          of the filter, and those many snapshots together build its spectrum (the <em>Spectrum</em> tab).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left">
            <thead className="text-white/50">
              <tr>
                <th className="py-1 pr-3 font-medium">Detector</th>
                <th className="py-1 pr-3 font-medium">Wavelengths (µm)</th>
                <th className="py-1 font-medium">What stands out</th>
              </tr>
            </thead>
            <tbody>
              {DETECTORS.map((row) => (
                <tr key={row.d} className="border-t border-white/5">
                  <td className="py-1 pr-3 font-mono">D{row.d}</td>
                  <td className="py-1 pr-3 font-mono">{row.range}</td>
                  <td className="py-1">{row.see}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <strong className="text-white/85">How often?</strong> Most of the sky is observed about every six months (for the Crab
          Nebula: September 2025 and March 2026). Near the ecliptic poles SPHEREx looks many more times; the North Ecliptic
          Pole has over a dozen visits per detector, which makes it the best place for the <em>Time machine</em>.
        </p>
        <p>
          <strong className="text-white/85">Pixels.</strong> One SPHEREx pixel is 6.15″ wide, about 1/300 of the Moon&apos;s width.
          Single observations keep that resolution. The all-sky mosaic is resampled to about 13″ pixels.
        </p>
        <p>
          <strong className="text-white/85">Units.</strong> Images are in MJy/sr (megajanskys per steradian): brightness per patch
          of sky. Spectra are in µJy or mJy (micro- or millijanskys): the total light from one source. A jansky is a tiny
          unit of light arriving per second per area per frequency, the standard in astronomy.
        </p>
        <p>
          <strong className="text-white/85">Zodiacal light</strong> is sunlight scattered and heat glowing from dust in our own
          solar system. It is the brightest thing SPHEREx sees almost everywhere, so the pipeline models it and our tools
          subtract that model.
        </p>
        <p>
          <strong className="text-white/85">False colour</strong> gives three invisible infrared wavelengths the visible colours
          red, green and blue. It is a way to see differences, not what your eyes would see.
        </p>
      </div>
    </details>
  );
}
