// Talking to our own Python backend (backend/ folder, runs on port 8000).
// The backend talks to NASA/IPAC IRSA for us: browsers are not allowed to call
// IRSA's search service directly from another website.

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export type Observation = {
  id: string;
  obs_id: string;
  band: string; // "SPHEREx-D1" … "SPHEREx-D6"
  time_mjd: number;
  time_utc: string;
  exposure_s: number | null;
  wavelength_min_um: number | null;
  wavelength_max_um: number | null;
  pixel_scale_arcsec: number | null;
  access_url: string;
  collection: string;
  s_region?: string | null; // image outline on the sky, e.g. "POLYGON ICRS ra1 dec1 ra2 dec2 …"
};

export type ObservationSearch = {
  query: { ra: number; dec: number; collection: string };
  collection_name: string;
  count: number;
  observations: Observation[];
  source: string;
  retrieved_utc: string;
  cached: boolean;
};

export type CutoutInfo = {
  fits_url: string;
  observation: {
    obs_id: string | null;
    detector: number | null;
    date_obs_utc: string | null;
    date_avg_utc: string | null;
    mjd_avg: number | null;
    exposure_s: number | null;
    psf_fwhm_arcsec: number | null;
    units: string | null;
    pipeline_version: string | null;
  };
  image: {
    width: number;
    height: number;
    pixel_scale_arcsec: (number | null)[];
    display_min: number | null;
    display_max: number | null;
    masked_fraction: number | null;
    wcs_fit_residual_arcsec: number | null;
    corners: [number, number][];
  };
  target: {
    ra: number;
    dec: number;
    inside: boolean;
    pixel: [number, number];
    surface_brightness: number | null;
    uncertainty: number | null;
    zodi_model: number | null;
    wavelength_um: number | null;
    bandwidth_um: number | null;
    wavelength_note: string | null;
    flags: string[];
  };
  quality: { flag_counts: Record<string, number>; hidden_flag_names: string[] };
  provenance: {
    source: string;
    access_url: string;
    cutout_url: string;
    cutout_size_deg: number;
    cached: boolean;
  };
  processed_utc: string;
};

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly offline = false,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(path, BACKEND_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new BackendError("The SPHEREx data server isn't running (nothing answered at " + BACKEND_URL + ").", true);
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new BackendError(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json() as Promise<T>;
}

export const getJsonPublic = getJson;

export function searchObservations(ra: number, dec: number, collection = "spherex_dr1") {
  return getJson<ObservationSearch>("/api/spherex/observations", { ra, dec, collection });
}

export type CutoutShape = "square" | "circle";

export function getCutout(
  obs: Observation,
  ra: number,
  dec: number,
  sizeDeg: number,
  smooth = false,
  shape: CutoutShape = "square",
) {
  return getJson<CutoutInfo>("/api/spherex/cutout", {
    access_url: obs.access_url,
    ra,
    dec,
    size: sizeDeg,
    smooth: String(smooth),
    shape,
  });
}

export function absoluteBackendUrl(path: string) {
  return new URL(path, BACKEND_URL).toString();
}

// ---- Time machine (Milestone 6) -------------------------------------------

export type TimelineObservation = Observation & {
  inside: boolean | null; // is the target on this image?
  detector_pixel?: [number, number];
  wavelength_um: number | null; // wavelength seen at the target
  bandwidth_um: number | null;
  error: string | null;
};

export type Channel = {
  wavelength_um: number;
  wavelength_spread_um: number;
  tolerance_um: number;
  observation_ids: string[];
  count: number;
  first_utc: string;
  last_utc: string;
  span_days: number;
};

export type Timeline = {
  query: { ra: number; dec: number; band: string; collection: string };
  collection_name: string;
  observations: TimelineObservation[];
  channels: Channel[];
  failed: number;
  method: string;
};

export function getTimeline(ra: number, dec: number, band: string) {
  return getJson<Timeline>("/api/spherex/timeline", { ra, dec, band });
}

// ---- Image comparison (Milestone 7) -----------------------------------------

type PairSide = {
  obs_id: string;
  date_utc: string;
  mjd: number;
  wavelength_um: number;
  psf_fwhm_arcsec: number | null;
};

export type Comparison = {
  key: string;
  files: Record<
    "a_png" | "b_png" | "diff_png" | "signif_png" | "combined_png" | "a_fits" | "b_fits" | "diff_fits" | "signif_fits" | "combined_fits",
    string
  >;
  grid: { size_px: number; pixel_arcsec: number; orientation: string; centre: [number, number] };
  pair: {
    a: PairSide;
    b: PairSide;
    detector: number;
    delta_wavelength_um: number;
    allowed_delta_um: number;
    delta_days: number;
  };
  display: { gray_min: number; gray_max: number; diff_limit: number; signif_limit: number };
  target: {
    a: number | null;
    a_sigma: number | null;
    b: number | null;
    b_sigma: number | null;
    difference: number | null;
    difference_sigma: number | null;
    significance_noise_only: number | null;
    difference_sigma_total: number | null;
    significance: number | null;
    combined: number | null;
    combined_sigma: number | null;
  };
  statistics: {
    valid_fraction: number;
    median_difference: number | null;
    robust_std_significance: number | null;
    pixels_beyond_5_sigma: number;
    pixels_beyond_5_sigma_noise_only: number;
    systematic_fraction: number;
    candidates: { ra: number; dec: number; significance: number; difference: number }[];
  };
  method: string[];
  caveats: string[];
};

export function getComparison(a: Observation, b: Observation, ra: number, dec: number, sizeDeg: number) {
  return getJson<Comparison>("/api/spherex/compare", { a: a.access_url, b: b.access_url, ra, dec, size: sizeDeg });
}

// ---- Catalogues and object identification (Milestone 8) ----------------------

export type CatalogName = "simbad" | "gaia" | "allwise";

export type CatalogRow = Record<string, string | number | null> & {
  ra: number;
  dec: number;
  sep_arcsec?: number;
};

export type CatalogResult = {
  catalog: CatalogName;
  service: string;
  attribution: string;
  query: { ra: number; dec: number; radius_deg: number; limit: number };
  count: number;
  truncated: boolean;
  rows: CatalogRow[];
  problems: string[];
};

export type IdentifyPart = {
  service: string | null;
  attribution: string;
  matches: CatalogRow[];
  error: string | null;
};

export type Identification = {
  query: { ra: number; dec: number; radius_arcsec: number };
  simbad: IdentifyPart;
  gaia: IdentifyPart;
  allwise: IdentifyPart;
};

export function getCatalog(name: CatalogName, ra: number, dec: number, radiusDeg: number) {
  return getJson<CatalogResult>(`/api/catalogs/${name}`, { ra, dec, radius: radiusDeg });
}

export function identifyPosition(ra: number, dec: number, radiusArcsec = 10) {
  return getJson<Identification>("/api/identify", { ra, dec, radius_arcsec: radiusArcsec });
}

// ---- Spectrum (Milestone 9) ------------------------------------------------

export type SpectrumPoint = {
  obs_id: string;
  band: string; // "SPHEREx-D1" … "SPHEREx-D6"
  time_utc: string | null;
  wavelength_um: number;
  bandwidth_um: number | null;
  flux_ujy: number; // microjansky
  flux_err_ujy: number; // statistical (VARIANCE layer + background)
  flux_err_total_ujy: number; // statistical + measured systematic scatter
  background_mjy_sr: number;
  zodi_mjy_sr: number;
  masked_fraction: number;
  flags_in_aperture: string[];
  flags_checked: boolean;
};

export type BinnedPoint = {
  wavelength_um: number;
  flux_ujy: number;
  flux_err_ujy: number;
  n: number;
  band: string;
};

export type Spectrum = {
  query: { ra: number; dec: number; collection: string };
  collection_name: string;
  points: SpectrumPoint[];
  binned: BinnedPoint[];
  attempted: number;
  available: number;
  subsampled: boolean;
  systematic_fraction: number; // extra image-to-image scatter, as a fraction of the flux
  skipped: Record<string, number>;
  skipped_flags: Record<string, number>;
  method: { aperture_radius_arcsec: number; annulus_arcsec: [number, number]; description: string[]; caveats: string[] };
};

/** Aperture photometry in every SPHEREx image covering (ra, dec). Takes ~20–60 s the first time. */
export function getSpectrum(ra: number, dec: number) {
  return getJson<Spectrum>("/api/spherex/spectrum", { ra: ra.toFixed(6), dec: dec.toFixed(6) });
}
