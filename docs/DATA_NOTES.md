# Data notes (Phase 0)

Live checks run on **2026-11-14** from Windows 11 with `curl.exe`. Every value
below comes from a real response, not from memory. Items still waiting on the
Python check (`scripts/scratch/phase0_checks.py`) are marked **TODO**.

## 1. Why the team's browser SIA links "failed"
- The SIA service is **up**. `wise_allwise` at Barnard's Star returned 8 rows.
- The collection names in the plan are **correct**. Search at RA 269.452, Dec 4.693, radius 0.1°:

  | Collection | Images | Search time |
  |---|---|---|
  | `spherex_dr1` | **272** | 152 s |
  | `spherex_qr3` | **132** | 179 s |
  | `spherex_dr1_deep`, `spherex_qr3_deep` | 0 in a 90 s window (timed out or empty; Barnard's Star is not a Deep Field) | — |
  | `spherex_qr2`, `spherex_qr` | 0 (retired/old) | — |
- **Cause:** IRSA's SIA searches take **2.5–3 minutes** for SPHEREx today. Browsers
  and short timeouts give up first. **Adaptation:** the backend uses a 300 s timeout,
  caches observation lists, and tries TAP as a fallback (TODO: time a TAP query).
- `RESPONSEFORMAT=CSV` and `VOTABLE` both work.

## 1b. Official collection list (source of truth)
`Irsa.list_collections(servicetype='SIA', filter='spherex')`, run 2026-11-14:

| Collection | In plan? |
|---|---|
| `spherex_dr1` | Yes (Wide) |
| `spherex_dr1_deep` | Yes (Deep) |
| `spherex_qr3` | Yes (Wide) |
| `spherex_qr3_deep` | Yes (Deep) |
| `spherex_dr1_cube` | **No, new.** Searchable through SIA. Probably the DR1 102-band cube products (DOI 10.26131/IRSA679). TODO: query it and see what one row is. |

- `spherex_qr2` / `spherex_qr` are **not listed**, which confirms they are retired.

## 2. SIA columns (51, ObsCore-style; same for DR1 and QR3)
`s_ra, s_dec, facility_name, instrument_name, dataproduct_subtype, calib_level,
dataproduct_type, energy_bandpassname, energy_emband, obs_id, s_resolution, em_min,
em_max, em_res_power, proposal_title, access_url, access_format, access_estsize,
t_exptime, s_region, obs_collection, obs_intent, algorithm_name, facility_keywords,
instrument_keywords, environment_photometric, proposal_id, proposal_pi,
proposal_project, target_name, target_type, target_standard, target_moving,
target_keywords, obs_release_date, s_xel1, s_xel2, s_pixel_scale,
position_timedependent, t_min, t_max, t_resolution, t_xel, obs_publisher_did,
s_fov, em_xel, pol_states, pol_xel, cloud_access, o_ucd, upload_row_id`

- `t_min`/`t_max` are MJD. `em_min`/`em_max` are in **metres** (×1e6 for µm).
- `energy_bandpassname` = `SPHEREx-D1` … `SPHEREx-D6`.
- **One `obs_id` is shared by all six detectors** (e.g. `2025W33_2C_0321_1`). An image's
  unique key is (`obs_id`, `energy_bandpassname`), not `obs_id` alone.
- Processing version is in the URL path/filename, e.g. `l2b-v27-2026-228`.
- `access_estsize` ≈ 62 000 (KB) per full file. Never download full files.

## 3. DR1 vs QR3 at Barnard's Star
| | DR1 | QR3 |
|---|---|---|
| Dates (`t_min`) | MJD 60902.9 → 61165.1 (2025-08-15 → 2026-05-05) | MJD 61268.6 → 61305.6 (2026-08-16 → 2026-09-22) |
| Per detector | D1 44 · D2 48 · D3 44 · D4 45 · D5 48 · D6 43 | D1 19 · D2 26 · D3 21 · D4 19 · D5 26 · D6 21 |
| URL root | `ibe/data/spherex/dr1/level2/...` | `ibe/data/spherex/qr3/level2/...` |

- **No overlap** (0 shared `obs_id`s). DR1 and QR3 cover different times here, so
  combining them gives a longer time series. Keep the de-duplicate rule (prefer DR1)
  as a safety net anyway.

## 4. Detector wavelength ranges (from `em_min`/`em_max`, DR1)
| Det | µm |
|---|---|
| D1 | 0.7455 – 1.1167 |
| D2 | 1.1033 – 1.6499 |
| D3 | 1.6301 – 2.4346 |
| D4 | 2.4027 – 3.8473 |
| D5 | 3.8113 – 4.4300 |
| D6 | 4.4115 – 5.0096 |

## 5. Cutout file (DR1, D3, 0.1° at Barnard's Star)
- Took 4.4 s. Image is only **58 × 59 px**, but the file is **4.08 MB**.
- Extensions: `IMAGE` (MJy/sr), `FLAGS`, `VARIANCE`, `ZODI`, **`EPSF`** (binary table,
  451 rows × 8752 bytes ≈ **3.9 MB**, *not* cropped), `WCS-WAVE`.
- **Plan change:** the §7.3 download estimate (`n × size² × 4 × 3`) is far too low.
  Real cost ≈ **4 MB per cutout** whatever the FOV (EPSF dominates). 272 images ≈ 1.1 GB.
  **Adaptation:** budget ~4 MB/cutout, keep `max_images` low (start ~60–100), cache
  hard, and check whether the cutout service can skip EPSF (TODO).
- Header: `DETECTOR`, `DATE-AVG`, `MJD-AVG`, `VERSION` (pipeline 7.0.5), spatial
  WCS `RA---TAN-SIP`, spectral WCS key `W` with `WAVE-TAB` lookup.
- Wavelength at centre pixel (29, 30): **2.2879 µm**, bandwidth 0.0569 µm. Corners:
  2.3005 µm at (0, 0) and 2.2758 µm at (57, 58). That's a 0.025 µm change across a 6′
  cutout, which is the linear variable filter at work.

### FLAGS (22 bits, from `MSKN*`/`MSKD*`)
| Bit | Name | Description |
|---|---|---|
| 0 | TRANSIENT | Transient detected during SUR |
| 1 | OVERFLOW | Overflow detected during SUR |
| 2 | SUR_ERROR | Error in onboard processing |
| 6 | NONFUNC | Permanently unusable |
| 7 | DICHROIC | Low efficiency due to dichroic |
| 9 | MISSING_DATA | Onboard data lost |
| 10 | HOT | Hot pixel |
| 11 | COLD | Anomalously low signal |
| 12 | FULLSAMPLE | Pixel full sample history is available |
| 14 | PHANMISS | Phantom correction was not applied |
| 15 | NONLINEAR | Nonlinearity correction cannot be applied reliably |
| 17 | PERSIST | Persistent charge above threshold |
| 19 | OUTLIER | Pixel flagged by Detect Outliers |
| 20 | CROSSTALK | Pixel affected by crosstalk |
| 21 | SOURCE | Pixel mapped to a known source |
| 22 | GHOST | Affected by a bright source inside the exposure |
| 23 | GHOST_FPA | Affected by a bright source on another detector |
| 24 | GHOST_EXT | Pixel affected by a bright source outside FOV |
| 25 | STREAK | Pixel affected by a streak |
| 26 | BLOOM | Pixel part of a bloom artifact |
| 27 | SNOWBALL | Pixel part of a snowball artifact |
| 28 | HALO | Pixel part of a transient halo |

- `FULLSAMPLE` and `SOURCE` are informational, not "bad". The default exclusion set
  must come from the Explanatory Supplement's bad-pixel list (**TODO**: read it).

## 6. IRSA DR1 all-sky cube (HiPS)
`https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube/properties`
- `creator_did = ivo://IPAC/P/SPHEREx/DR1/cube`, released 2026-11-01.
- `hips_cube_depth = 102`, `hips_order = 5`, `hips_frame = equatorial`,
  `hips_tile_format = png` (8-bit display tiles, not FITS, so fine for viewing
  but not for measuring).
- `data_cube_crval3_arr` = 102 wavelengths, 0.753 → 4.988 µm (full list saved in
  `config/datasets.json`).
- **CORS:** `Access-Control-Allow-Origin: *`. Aladin can load it straight from the browser.

## 7. CDS / other HiPS IDs (MocServer, image surveys)
- SPHEREx (QR2): `CDS/P/SPHEREx/QR2/D1` … `D6`, `CDS/P/SPHEREx/QR2/color`.
  **Plan change:** the URL `https://alasky.cds.unistra.fr/SPHEREx/color` returns
  **404**. Load by ID instead.
- AllWISE: `CDS/P/allWISE/color` (and `W1`–`W4`).
- unWISE: `CDS/P/unWISE/color-W2-W1W2-W1` (and `W1`, `W2`).
- 2MASS: `CDS/P/2MASS/color`.

## 8. CORS summary
| URL | Browser allowed? |
|---|---|
| IRSA HiPS cube | Yes (`*`) |
| IRSA cutout (`ibe/...fits?center=&size=`) | **No header**, so it must go through our backend (as planned) |
| CDS alasky | Yes (`*`) |

## 9. Aladin Lite
- npm versions: newest stable **3.8.2** (2026-03-06); newest beta 3.9.2-beta.
- **Pin 3.8.2.** Its `aladin.js` contains `setRotation`/`getRotation`,
  `setViewCenter2NorthPoleAngle`, `setSliceNumber` and `cubeDepth`, so rotation and
  HiPS-cube plane switching are both present. Confirmed by reading the source only.
  A small live test page comes in Phase 7.

## 10. Phase 2 findings (2026-11-14, afternoon)
- **IRSA outages.** From about 15:30 local time, SIA and TAP searches returned
  `502 Proxy Error`, even for `wise_allwise`. Simple TAP lookups (`TAP_SCHEMA`) came and
  went. The backend turns this into `{"error": "irsa_unavailable"}` (HTTP 503).
- **IRSA TAP tables** (`spherex` schema): `spherex.obscore` (same columns as SIA plus
  `poly`, `pt`, `ipac_gid`, `ipac_pub_date`), `spherex.observation`, `spherex.plane`,
  `spherex.artifact`, `spherex.provenance_input`, `splices`. Cone searches on
  `spherex.obscore` couldn't be tested (502), so **TAP is not used yet**; the backend uses
  SIA only. TODO: time a TAP cone search when IRSA is healthy.
- **SIA VOTables:** column IDs differ from column names. Read with
  `to_table(use_names_over_ids=True)`.
- **SIMBAD:** `simbad.cds.unistra.fr` showed a "CDS fallback" page and 404s. The page
  lists mirrors `simbad.cfa.harvard.edu` and `simbad.idia.ac.za`. astroquery 0.4.11 only
  accepts `simbad.cds.unistra.fr` and `simbad.harvard.edu`, and the Harvard one works.
  `backend/app/resolve.py` tries them in order (`SIMBAD_SERVERS` env var).
- **WISE 0855:** the team's coordinates (08h55m10.831s −07d14m42.53s) are about 85″ from
  SIMBAD's J2000 position. At its motion (−8124, +673 mas/yr) that is about 10.4 years,
  so they are its position around 2010 (WISE era). `config/targets.json` keeps the team's
  numbers as `ra`/`dec` and SIMBAD's J2000 position + proper motion as `motion`.
- **Motion check:** propagating Barnard's Star from J2000 to 2025-08-15 moves it +266″ in
  Dec and −20.5″ in RA, matching the plan's "about 4 arcminutes". Without a known distance
  the result changes by only 0.4″ (ERFA warns; the warning is silenced).
- **Random positions:** the plan's per-pick SIA coverage check isn't practical (searches
  take minutes). DR1's all-sky cube has full-sky coverage, so it is skipped.

### Observation report (`scripts/observation_report.py`, live IRSA, DR1 + QR3, all detectors)
Search radius 0.01° around each target's mid-2026 predicted position.

| Target | Images | DR1 / QR3 | Wide / Deep | Visits | Dates | Predicted motion first → last image |
|---|---|---|---|---|---|---|
| Barnard's Star | 364 | 240 / 124 | 364 / 0 | 5 | 2025-08-15 → 2026-09-22 | 11.5″ |
| Epsilon Indi B | 467 | 347 / 120 | 467 / 0 | 4 | 2025-04-24 → 2026-10-02 | 6.7″ |
| WISE 0855 | 258 | 258 / 0 | 258 / 0 | 4 | 2025-05-05 → 2026-05-14 | 8.3″ |
| RW Aurigae | 336 | 226 / 110 | 336 / 0 | 3 | 2025-09-01 → 2026-09-16 | 0.0″ |
| R Draconis | 2514 | 1655 / 859 | 548 / 1966 | 3 | 2025-04-24 → 2026-09-27 | 0.0″ |

- DR1 starts 2025-04-24 (earlier than the Barnard's Star-only check suggested).
- WISE 0855 has no QR3 images yet.
- **Deep Fields break the "visit" idea.** R Draconis is observed almost continuously, so
  the 20-day gap rule merges months into one "visit" (Visit 3 = 1793 images,
  Feb → Sep 2026). Phase 3 needs fixed time windows (e.g. 2 weeks) for Deep Field targets.
- Some "visits" are short top-ups a few weeks after a main one (Barnard's Star visits 2
  and 4 have 10 and 8 images).

## 11. Phase 3 findings (2026-11-14, evening)
- **Bad-pixel flags.** The default exclusion set is the list that sets `CONTAINS_BAD_PIXEL`
  (Explanatory Supplement Table 16), copied from IRSA's
  `spherex_source_discovery_tool_demo` tutorial: TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC,
  DICHROIC, MISSING_DATA, HOT, COLD, NONLINEAR, CROSSTALK, GHOST, GHOST_FPA, GHOST_EXT,
  STREAK, PERSIST, BLOOM, SNOWBALL, HALO, SATELLITE_HALO. (SATELLITE_HALO isn't in our DR1
  cutout's FLAGS header; unknown names are skipped.) FULLSAMPLE, PHANMISS, OUTLIER and
  SOURCE are informational. Every pixel of the test cutout has some flag set (FULLSAMPLE),
  so "any flag = bad" would blank everything.
- **Saturated star cores.** Barnard's Star's core pixels are flagged OVERFLOW / SUR_ERROR /
  TRANSIENT / BLOOM in every image, with raw values from 23 to 2000 MJy/sr (and some NaN).
  Frames fill such holes (pixels flagged in *every* co-added image) with the brightest good
  neighbour, for display only. Filled pixels keep NaN variance, and each frame reports
  `filled_pixels`. Option `fill_flagged: false` turns this off.
- **Cutout size.** No documented option drops the EPSF table, and IRSA doesn't compress
  (`Accept-Encoding: gzip` gives the same 4.04 MB). Cutouts take about 4–5 s each.
- **Spectral WCS.** The IMAGE header's SIP keywords make astropy log an "inconsistent SIP"
  notice when building the `W` (wavelength) WCS. We drop `A_*/B_*/AP_*/BP_*` from a header
  copy first, which is equivalent to IRSA's `spectral_wcs.sip = None`.
- **FITS products** need ASCII-only header text (labels use · and →, which are converted).
- **Contact sheets** (`scripts/contact_sheet.py` → `docs/images/phase3/`). WISE 0855's
  D5 difference (Apr–May 2026 minus May 2025) shows a dark/bright pair about 8″ apart along
  the predicted path. Barnard's Star's D1 difference shows its northward shift (about 11″,
  under 2 pixels) as a bright north / dark south pair.

## Sources
IRSA SIA (`https://irsa.ipac.caltech.edu/SIA`), IRSA cutouts (IBE), IRSA HiPS
properties, CDS MocServer, npm registry/jsDelivr for Aladin Lite.
