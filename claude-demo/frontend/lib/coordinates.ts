// Everything to do with checking and formatting sky coordinates.
// Used by both the landing page (in the browser) and the Explore page
// (on the server), so the rules are identical everywhere.

export type FieldResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export type CoordinateResult =
  | { ok: true; ra: number; dec: number }
  | { ok: false; raError?: string; decError?: string };

// A plain decimal number: optional sign, digits, optional decimal part.
// (Rejects things like "1e5", "12abc", "1,5" or an empty box.)
const DECIMAL_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function parseDecimal(raw: string | undefined, label: string): FieldResult {
  const text = (raw ?? "").trim();
  if (text === "") {
    const article = label === "RA" ? "an" : "a";
    return { ok: false, error: `Please enter ${article} ${label} value.` };
  }
  if (!DECIMAL_NUMBER.test(text)) {
    return {
      ok: false,
      error: `${label} must be a number in decimal degrees, like 83.633.`,
    };
  }
  return { ok: true, value: Number(text) };
}

export function validateRa(raw: string | undefined): FieldResult {
  const parsed = parseDecimal(raw, "RA");
  if (!parsed.ok) return parsed;
  const ra = parsed.value;
  if (ra < 0 || ra >= 360) {
    return {
      ok: false,
      error:
        ra === 360
          ? "RA must be less than 360°. (360° is the same position as 0°.)"
          : "RA must be from 0 up to (but not including) 360°.",
    };
  }
  return { ok: true, value: ra === 0 ? 0 : ra }; // turns -0 into 0
}

export function validateDec(raw: string | undefined): FieldResult {
  const parsed = parseDecimal(raw, "Dec");
  if (!parsed.ok) return parsed;
  const dec = parsed.value;
  if (dec < -90 || dec > 90) {
    return { ok: false, error: "Dec must be between −90° and +90°." };
  }
  return { ok: true, value: dec === 0 ? 0 : dec };
}

export function validateCoordinates(
  rawRa: string | undefined,
  rawDec: string | undefined,
): CoordinateResult {
  const ra = validateRa(rawRa);
  const dec = validateDec(rawDec);
  if (ra.ok && dec.ok) return { ok: true, ra: ra.value, dec: dec.value };
  return {
    ok: false,
    raError: ra.ok ? undefined : ra.error,
    decError: dec.ok ? undefined : dec.error,
  };
}

// Keep at most 6 decimal places (~0.004 arcseconds, far finer than needed)
// and drop trailing zeros, so links stay short and tidy.
export function formatDegrees(value: number): string {
  return String(Number(value.toFixed(6)));
}

// Optional view width (degrees) shown in the sky viewer.
export const MIN_FOV = 0.002; // ~7 arcseconds
export const MAX_FOV = 180;

export function buildExploreUrl(ra: number, dec: number, fov?: number): string {
  const params = new URLSearchParams({ ra: formatDegrees(ra), dec: formatDegrees(dec) });
  if (fov !== undefined) params.set("fov", String(Number(fov.toPrecision(4))));
  return `/explore?${params.toString()}`;
}

// Reads an optional ?fov= value; returns undefined if missing or invalid.
export function parseFov(raw: string | undefined): number | undefined {
  const text = (raw ?? "").trim();
  if (!DECIMAL_NUMBER.test(text)) return undefined;
  const fov = Number(text);
  return fov >= MIN_FOV && fov <= MAX_FOV ? fov : undefined;
}

// Astronomers often write RA as hours:minutes:seconds (24h = 360°)
// and Dec as degrees:arcminutes:arcseconds.
export function raToHms(ra: number): string {
  const totalCentiSeconds = Math.round((ra / 15) * 3600 * 100) % (24 * 3600 * 100);
  const h = Math.floor(totalCentiSeconds / 360000);
  const m = Math.floor((totalCentiSeconds % 360000) / 6000);
  const s = (totalCentiSeconds % 6000) / 100;
  return `${pad(h)}h ${pad(m)}m ${s.toFixed(2).padStart(5, "0")}s`;
}

export function decToDms(dec: number): string {
  const sign = dec < 0 ? "−" : "+";
  const totalDeciSeconds = Math.round(Math.abs(dec) * 3600 * 10);
  const d = Math.floor(totalDeciSeconds / 36000);
  const m = Math.floor((totalDeciSeconds % 36000) / 600);
  const s = (totalDeciSeconds % 600) / 10;
  return `${sign}${pad(d)}° ${pad(m)}′ ${s.toFixed(1).padStart(4, "0")}″`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
