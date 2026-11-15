"use client";

import { useEffect, useState, type ReactNode } from "react";
import { identifyPosition, type CatalogRow, type Identification } from "@/lib/backend";
import { decToDms, raToHms } from "@/lib/coordinates";
import type { SpectrumTarget } from "./SpectrumPanel";

type Props = {
  position: { ra: number; dec: number };
  onClose: () => void;
  onSpectrum?: (target: SpectrumTarget) => void;
};

const RADIUS_ARCSEC = 10; // about 1.5 SPHEREx pixels

function num(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 py-1">
      <dt className="text-white/50">
        {label}
        {help && (
          <span className="ml-1 cursor-help text-violet-300/80" title={help} tabIndex={0} aria-label={help}>
            ⓘ
          </span>
        )}
      </dt>
      <dd className="text-right font-mono text-white/85">{children}</dd>
    </div>
  );
}

// WISE variability flag: one character per band W1..W4, 0–9 (higher = more likely variable), 'n' = not tested
function describeWiseVariability(flag: unknown) {
  if (typeof flag !== "string" || !flag) return "—";
  const digits = flag.split("").map((c) => (/\d/.test(c) ? Number(c) : null));
  const strongest = Math.max(...digits.map((d) => d ?? -1));
  if (strongest < 0) return `not tested (${flag})`;
  if (strongest >= 7) return `possibly variable (${flag})`;
  return `no sign of variability (${flag})`;
}

function describeGaiaVariability(flag: unknown) {
  if (flag === "VARIABLE") return "flagged variable by Gaia";
  if (flag === "NOT_AVAILABLE") return "not analysed by Gaia";
  return typeof flag === "string" ? flag : "—";
}

export default function ObjectInfo({ position, onClose, onSpectrum }: Props) {
  const [data, setData] = useState<Identification | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    identifyPosition(position.ra, position.dec, RADIUS_ARCSEC)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [position.ra, position.dec]);

  const simbad = data?.simbad.matches ?? [];
  const gaia: CatalogRow | undefined = data?.gaia.matches[0];
  const wise: CatalogRow | undefined = data?.allwise.matches[0];
  const best = simbad[0];

  let title = "Looking up catalogues…";
  let subtitle = "";
  if (data) {
    if (best) {
      title = String(best.main_id).replace(/\s+/g, " ");
      subtitle = `${best.otype_description ?? best.otype} · ${num(best.sep_arcsec, 1)}″ from your click`;
    } else if (gaia || wise) {
      title = "Unclassified source";
      subtitle = "Detected in a survey catalogue, but SIMBAD has no named or classified object here.";
    } else {
      title = "Unknown — nothing catalogued here";
      subtitle = `No object in SIMBAD, Gaia DR3 or AllWISE within ${RADIUS_ARCSEC}″ of this point.`;
    }
  }

  return (
    <section aria-label="Object information" className="mt-3 rounded-xl border border-yellow-300/25 bg-black/40 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-yellow-200/70">Object at your click</p>
          <h3 className="mt-0.5 text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-white/60">{subtitle}</p>}
          <p className="mt-1 font-mono text-xs text-white/45">
            RA {position.ra.toFixed(5)}°, Dec {position.dec.toFixed(5)}° · {raToHms(position.ra)} · {decToDms(position.dec)}
          </p>
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10" aria-label="Close object information">
          ✕
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-rose-200">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-2 animate-pulse text-white/55 motion-reduce:animate-none">Asking SIMBAD, Gaia and AllWISE…</p>}

      {data && (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {/* SIMBAD */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-yellow-200/80">SIMBAD · known objects</h4>
            {data.simbad.error && <p className="text-xs text-rose-200">{data.simbad.error}</p>}
            {!data.simbad.error && simbad.length === 0 && <p className="text-xs text-white/50">No named object within {RADIUS_ARCSEC}″.</p>}
            <ul className="mt-1 space-y-1">
              {simbad.map((row) => (
                <li key={String(row.main_id)} className="text-xs">
                  <a
                    href={`https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=${encodeURIComponent(String(row.main_id))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-white underline decoration-white/30 hover:decoration-white"
                  >
                    {String(row.main_id).replace(/\s+/g, " ")}
                  </a>{" "}
                  <span className="text-white/55">
                    · {row.otype_description ?? row.otype} · {num(row.sep_arcsec, 1)}″
                  </span>
                  {(row.J != null || row.K != null) && (
                    <span className="block text-white/45">
                      2MASS J {num(row.J)} · H {num(row.H)} · K {num(row.K)} mag
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {data.simbad.service && <p className="mt-1 text-[11px] text-white/35">{data.simbad.service}</p>}
          </div>

          {/* Gaia */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-300/80">Gaia DR3 · star measurements</h4>
            {data.gaia.error && <p className="text-xs text-rose-200">{data.gaia.error}</p>}
            {!data.gaia.error && !gaia && <p className="text-xs text-white/50">No Gaia source within {RADIUS_ARCSEC}″.</p>}
            {gaia && (
              <dl className="mt-1 text-xs">
                <Field label="Gaia DR3 ID">{String(gaia.source_id)}</Field>
                <Field label="Separation">{num(gaia.sep_arcsec, 1)}″</Field>
                <Field label="Brightness (G)" help="Visible-light magnitude. Smaller numbers are brighter; the faintest stars Gaia sees are about 21.">
                  {num(gaia.phot_g_mean_mag)} mag
                </Field>
                <Field label="Colour (BP−RP)" help="Blue minus red brightness. Larger numbers mean redder (cooler or dust-reddened).">
                  {num(gaia.bp_rp)}
                </Field>
                <Field label="Parallax" help="Tiny yearly wobble caused by Earth's orbit. Bigger parallax = closer. Measured in milli-arcseconds.">
                  {num(gaia.parallax, 3)} ± {num(gaia.parallax_error, 3)} mas
                </Field>
                <Field label="Distance (approx.)" help="1000 ÷ parallax, shown only when the parallax is at least 5× its uncertainty.">
                  {typeof gaia.distance_pc_estimate === "number"
                    ? `${Math.round(gaia.distance_pc_estimate)} pc ≈ ${Math.round(Number(gaia.distance_ly_estimate)).toLocaleString()} ly`
                    : "too uncertain"}
                </Field>
                <Field label="Motion on sky" help="Proper motion: how fast it moves across the sky, in milli-arcseconds per year (RA, Dec).">
                  {num(gaia.pmra, 1)}, {num(gaia.pmdec, 1)} mas/yr
                </Field>
                <Field label="Variability">{describeGaiaVariability(gaia.phot_variable_flag)}</Field>
              </dl>
            )}
            {data.gaia.service && <p className="mt-1 text-[11px] text-white/35">{data.gaia.service}</p>}
          </div>

          {/* AllWISE */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-pink-300/80">AllWISE · infrared</h4>
            {data.allwise.error && <p className="text-xs text-rose-200">{data.allwise.error}</p>}
            {!data.allwise.error && !wise && <p className="text-xs text-white/50">No AllWISE source within {RADIUS_ARCSEC}″.</p>}
            {wise && (
              <dl className="mt-1 text-xs">
                <Field label="AllWISE name">J{String(wise.designation).replace(/^J/, "")}</Field>
                <Field label="Separation">{num(wise.sep_arcsec, 1)}″</Field>
                <Field label="W1 (3.4 µm)" help="Infrared magnitude in WISE band 1 — inside SPHEREx's wavelength range.">
                  {num(wise.w1mpro)} ± {num(wise.w1sigmpro)}
                </Field>
                <Field label="W2 (4.6 µm)" help="WISE band 2 — also inside SPHEREx's range.">
                  {num(wise.w2mpro)} ± {num(wise.w2sigmpro)}
                </Field>
                <Field label="W3 (12 µm)">{num(wise.w3mpro)} ± {num(wise.w3sigmpro)}</Field>
                <Field label="W4 (22 µm)">{num(wise.w4mpro)} ± {num(wise.w4sigmpro)}</Field>
                <Field label="Extended?" help="0 = point-like; larger values mean the source looks spread out (e.g. a galaxy or nebula).">
                  {wise.ext_flg === 0 ? "no (point-like)" : `yes (flag ${num(wise.ext_flg, 0)})`}
                </Field>
                <Field label="Variability" help="WISE variability flag per band (W1–W4): 0–9, higher means more likely variable; n = not tested.">
                  {describeWiseVariability(wise.var_flg)}
                </Field>
                <Field label="Contamination" help="WISE artefact flags per band. 0 = clean; letters mean possible spikes, halos, ghosts or persistence.">
                  {String(wise.cc_flags ?? "—")}
                </Field>
              </dl>
            )}
            {data.allwise.service && <p className="mt-1 text-[11px] text-white/35">{data.allwise.service}</p>}
          </div>
        </div>
      )}

      {data && (
        <p className="mt-3 text-[11px] text-white/40">
          Matches are the catalogue entries nearest your click within {RADIUS_ARCSEC}″. SPHEREx pixels are ~6″, so several
          objects can share one pixel; nearby matches are not guaranteed to be the same object across catalogues.
        </p>
      )}

      {data && onSpectrum && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="rounded-md border border-violet-400/60 bg-violet-600/40 px-3 py-1.5 text-sm text-white transition hover:bg-violet-600/60"
            onClick={() => {
              const gaiaRa = typeof gaia?.ra === "number" ? gaia.ra : null;
              const gaiaDec = typeof gaia?.dec === "number" ? gaia.dec : null;
              if (gaiaRa !== null && gaiaDec !== null) {
                onSpectrum({
                  ra: gaiaRa,
                  dec: gaiaDec,
                  label: `Gaia DR3 ${String(gaia?.source_id)}`,
                  note:
                    `Centred on the Gaia DR3 position of the nearest catalogued star (${num(gaia?.sep_arcsec, 1)}″ from your click).` +
                    (best ? ` Nearest SIMBAD object: ${String(best.main_id).replace(/\s+/g, " ")}.` : ""),
                });
              } else {
                onSpectrum({
                  ra: position.ra,
                  dec: position.dec,
                  label: best ? String(best.main_id).replace(/\s+/g, " ") : "Your clicked position",
                  note: "Centred exactly on your click (no Gaia star nearby to centre on).",
                });
              }
            }}
          >
            SPHEREx spectrum of this source
          </button>
          <span className="text-xs text-white/45">Measures it in every SPHEREx image (about 20–60 s the first time).</span>
        </div>
      )}
    </section>
  );
}
