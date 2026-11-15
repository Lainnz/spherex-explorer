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

## 12. Phase 4 findings
- **Photometry** (`backend/app/photometry.py`): circle of radius 2 px, sky ring 4–7 px
  (sigma-clipped median), 5×5 sub-pixel aperture weights, `IMAGE − ZODI`. MJy/sr × nominal
  pixel solid angle (6.15″)² = 8.89e-10 sr → µJy. **TODO:** DR1 per-pixel solid-angle maps
  (IRSA's source-discovery tutorial reads them from S3) would make fluxes exact; until
  then they're labelled approximate. Tested on a fake star added to the real cutout's
  WCS: recovered within 3σ of its true aperture flux, and empty sky gives ≈ 0.
- **Crowded fields.** In the Barnard's Star D3 cutout, 13% of pixels are > 3σ above the
  sky median, and the mean sky is 0.145 MJy/sr above the clipped median. Random
  apertures there average +285 µJy (about 4σ) because they catch faint stars. That's
  physics, not a bug, but expect faint-target fluxes to be biased high in crowded fields.
- **Pipeline VERSION** is in the PRIMARY header, not IMAGE. `/api/meta` returns both
  headers as `[section, key, value, comment]`.
- **SIMBAD TAP** (Harvard mirror) tables used: `basic` (oid, main_id, ra, dec, otype,
  sp_type, pmra, pmdec, plx_value, plx_err, rvz_radvel), `ident` (id, oidref), `otypedef`
  (otype, label, description, e.g. `BY*` = "BY Dra Variable"), and `allfluxes` (oidref,
  U B V G R I J H K …).
- **Gaia DR3** (`gaiadr3.gaia_source` at https://gea.esac.esa.int/tap-server/tap) has a
  total proper motion column `pm`. `pm > 10000` returns only Barnard's Star.
- **Click-to-identify vs. motion.** Catalogue epochs are 2000 (SIMBAD) and 2016 (Gaia). By
  2026, Barnard's Star sits about 270″ from its SIMBAD position and about 100″ from its
  Gaia one. `/api/object` also searches 5′ for objects moving > 1″/yr and moves all
  candidates to the viewing date before choosing the nearest.
- **Flags** get plain-English labels in `backend/app/flag_labels.json`. Quality badge:
  Good < 5% bad-flag pixels in view ≤ Use with care < 20% ≤ Poor; a bad flag on the
  target pixel caps it at "Use with care".
- **Saturation.** OVERFLOW sits inside the photometry circle in 57/57 Barnard's Star,
  53/59 RW Aurigae and 41/41 R Draconis images: these stars are too bright for SPHEREx.
  Saturated points now report `flux_ujy: null` and `saturated: true`. Skipping the
  overflowed pixels had produced meaningless values near 0. The stream's `done` message
  warns when over half the points are saturated.
- **Wing light curves for saturated stars** (`wing_level`, `relative_light_curve` in
  `photometry.py`; `scripts/wing_lightcurves.py`). Average glow 3–6 px from the centre
  (flagged pixels skipped) minus sky 10–14 px out, divided by each detector's typical
  level. A test with a fake saturated star gives a 2.00× wing ratio for a 2× brighter star.
  Within a detector, a red star's brightness rises with wavelength: Barnard's Star's D1
  wing scatter correlated +0.95 with wavelength. So a straight line in log(level) vs
  wavelength is fitted per detector and divided out. Results (2026-11-14):
  - Barnard's Star (control, steady): all detectors within 0.71–1.27, mostly ±10–20%.
    That's the method's precision.
  - **R Draconis: D1 rises from 0.53–1.05 (Sep–Nov 2025) to 1.55–2.90 (Jul–Aug 2026),
    about 3×.** Well beyond the control, with neighbouring points agreeing: the
    variability is detected. At the same wavelength (≈0.846 µm) it went from 0.40 to 2.18
    before the colour correction. Only 31 of 71 images were usable (bloom or halos often
    cover the wing or sky rings).
  - RW Aurigae: up to 0.61–1.85 in D4–D6, more than the control (plausible T Tauri
    variability, less clear-cut).
  - Correction: the Phase 3 report's eyeball reading of R Dra's contact sheet ("faint
    again by summer 2026") mixed wavelengths and detectors. The measured curve shows it
    brighter in Jul–Aug 2026 than in Sep 2025.
- **Blending (WISE 0855).** A Gaia star (G = 16.3) lies within the 2-pixel (12″) circle
  around WISE 0855's 2025–26 positions. It dominates the light below ~2 µm, and as WISE 0855
  moves past it the D3 "light curve" changes (4.85×). WISE 0855's own light shows at
  4–5 µm (~500–700 µJy, consistent with WISE W2 ≈ 14.0 mag ≈ 430 µJy). The UI should
  warn when a catalogued star sits inside the circle (Phase 9).
- **Epsilon Indi B spectrum** (46 clean points, 35 of 102 channels) shows the expected
  T-dwarf shape: peak near 4 µm, methane dips near 2.2 and 3.3 µm.
- **Same-object rule for click-to-identify.** A Gaia star is merged with the SIMBAD match
  only if SIMBAD lists its Gaia DR3 id, or (when SIMBAD lists none, e.g. RW Aur) it is
  within 1.5″ and moves the same way (within 30 mas/yr or 25%). This stops WISE 0855 being
  paired with that G = 16.3 background star.
- **Image lookup.** Images listed by `/api/observations` or `/api/frames` are remembered
  (30 days) by `obs_id` + detector, so `/api/flags/{obs_id}` and `/api/meta/{obs_id}`
  never fetch URLs supplied by a browser.

## 13. Phase 5: demo data
- `scripts/build_demo_data.py` calls the real API in-process (FastAPI TestClient) and
  saves its answers unchanged in `frontend/public/data/demo/<slug>/manifest.json`, so demo
  data has exactly the live shape. Contents: `observations`, `frames_stream` and
  `photometry_stream` (every NDJSON message, ready to replay), `flags` and `meta` for one
  image, and `objects` (the target's click answer). Picture links are rewritten to saved
  files: `frames/<id>.png|.f32|.fits` and `flags/<FLAG>.png`.
- Built 2026-11-14: **3.99 MB total** (budget 25 MB). Frames: Barnard's Star 12, Epsilon
  Indi B 15, WISE 0855 8, RW Aurigae 9, R Draconis 21; 0 failed images; 41–60
  photometry points each. Checked by `frontend/src/shared/demo-data.test.js`.
- **Bug found while building: it wasn't IRSA.** The first build lost 75 of 80 Epsilon Indi B
  images. Their failures had been silently swallowed, so it looked like an IRSA outage.
  The real cause: the IRSA request limiter (an `asyncio.Semaphore`) was shared by every
  event loop, and the build script runs each request in a new loop. Once a request had
  to wait its turn → "bound to a different event loop". Fixed with one limiter per loop.
  Also: frames now report `failure_reasons` and log every skipped image; incomplete
  frames are saved under their own id so the complete frame is retried; the build
  retries a target if more than 10% of its images fail. (The live server uses one event
  loop, so it wasn't affected.)

## 14. Phase 6: title page assets
- **NASA Earth images moved.** `eoimages.gsfc.nasa.gov` timed out (2026-11-14), and Visible
  Earth pages redirect to science.nasa.gov. Working files are on `assets.science.nasa.gov`
  (exact paths in `scripts/build_textures.py` and `docs/CREDITS.md`). Textures: desktop set
  770 KB (budget 1.5 MB), phone set 227 KB (budget 500 KB), WebP quality 85.
- **Starfield:** Gaia DR3 has 36,663 sources with G < 7.5; the brightest 28,000 are used
  (to G = 7.25). Gaia lacks some of the brightest stars (150 with G < 3 vs SIMBAD's 177
  with V < 3), so 65 stars with V < 3.5 come from SIMBAD. Star types only: SIMBAD's
  "Aquarius IV" dwarf galaxy has V = −1.9 (a total magnitude). Duplicates within 60″ are
  merged (alf Cen vs alf Cen A). 219 KB (budget 300 KB).
- **Title page JS:** about 151 KB gzipped in total (budget 250 KB); three.js is in the
  lazily loaded scene chunk (142 KB gzipped).

## 15. Phase 7: Aladin Lite 3.8.2
- **The plan's script address is dead.** `https://aladin.cds.unistra.fr/AladinLite/api/v3/3.8.2/aladin.js`
  (and `…/latest/…`) returned 404 on 2026-11-15. The npm package via jsDelivr works
  (`https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js`, 2.4 MB, CORS `*`). It
  is an **ES module** with one default export (`A`), loaded with `import()`. `A.init` is
  a promise that rejects without WebGL 2.
- **API checked in the 3.8.2 source** (`frontend/src/stellar/sky-view.js` is the only
  caller): `A.aladin(div, options)`, `A.imageHiPS(idOrUrl, options)`, `A.MOCFromURL`,
  `A.catalogFromVizieR(cat, target, radiusDeg, options)`, `A.catalog`, `A.source`,
  `A.graphicOverlay`, `A.polygon`; `aladin.gotoRaDec / getRaDec / animateToRaDec(ra, dec,
  seconds, done) / setFoV / getFov() → [width, height] in degrees / zoomToFoV(fov, seconds,
  done) / setRotation / getRotation / pix2world / setBaseImageLayer / setOverlayImageLayer
  / getOverlayImageLayer / removeImageLayer / addMOC / addOverlay / addCatalog`. Layers
  have `show / hide / setOpacity`. **`aladin.on(event, fn)` keeps one callback per event**
  (we fan out ourselves). Events: positionChanged ({ra, dec, dragging}), zoomChanged (fov),
  rotationChanged (angle), click ({ra, dec, x, y, isDragging}), and others. There's no
  `removeLayer` for catalogues (we hide them). `showGotoControl` isn't an option in 3.8.2.
- **HiPS cube:** IRSA's cube `properties` include `em_min = 7.43e-7`, `em_max = 5.009e-6`,
  `hips_cube_depth = 102`, `hips_cube_firstframe = 1`, `dataproduct_type = cube`, and per-
  slice tiles (`Norder3/Dir0/Npix0_10.png` exists). Aladin's `setSliceNumber(n)` (0-based)
  works once the layer is added. Its `obs_description` confirms "frame index =
  17*(band-1) + (channel-1)" and blank frames 50 and 51. Coverage map:
  `…/spherex_allsky_cube/Moc.fits` (CORS `*`).
- CDS's `CDS/P/SPHEREx/QR2/color` record lists `hips_service_url = https://alasky.cds.unistra.fr/SPHEREx/color`
  (`moc_sky_fraction = 0.9999`), although `…/SPHEREx/color/properties` returned 404 in
  Phase 0. To check in the browser.
- **Two Aladin quirks found with a headless Edge check (2026-11-15):**
  (1) Aladin adds `.aladin-container { position: relative }` to the element it's given,
  overriding our `position: absolute; inset: 0`. The box collapsed to height 0 and the sky
  was black. Fix: Aladin gets an inner `#aladin` box (100% × 100%) inside the positioned
  `#sky`. (2) `aladin.setRotation(0)` is refused ("Rotation angle is not valid: 0": it
  treats 0 as "no value"); `aladin.view.setRotation(deg)` accepts any angle. Also,
  Aladin's default survey (DSS via CDS) failed to load, so we pass `survey:` with our map.
- **The cube is coarse:** order 5, 512-pixel tiles → 0.0036° ≈ 13″ per HiPS pixel, so at
  a 5′ field of view you see blocky HEALPix "diamonds". Native-resolution SPHEREx frames
  come from the time slider (Phase 8).
- **Rotate tool:** a see-through layer over the sky catches drags (so Aladin doesn't pan)
  and calls `setRotation`. The sign between dragging clockwise and Aladin's angle
  (`ROTATION_SIGN` in nav-tools.js) needs the visual check.

## 16. Phase 8: image sequence in the browser
- **Drawing frames on the sky.** Frames are drawn on our own canvas over Aladin. Three
  frame corners (from the grid WCS: TAN, CRVAL/CRPIX/CDELT) go through `aladin.world2pix`
  every animation frame, giving an affine canvas transform, so frames follow pan, zoom
  and rotation. The JS gnomonic inverse matches astropy to 0.002 mas (checked at
  Dec 66.8°). `world2pix` returns a typed array `{0: x, 1: y}`.
- **Fast movers must be pointed at "now".** With the view centred on Barnard's Star's
  J2000 position, its frames (centred on the 2025–26 position) were drawn ~1,300 px above
  the screen at a 5′ field of view. Title-page search, Randomize and the Stellar View now
  centre fast movers (> 50 mas/yr) on their predicted 2026.0 position
  (`shared/motion.js viewPosition`). `config/targets.json` keeps the catalogue values and
  the team's exact WISE 0855 coordinates.
- **Stacking order:** `.sky-inner { position: relative; z-index: 0; isolation: isolate }`
  keeps Aladin's internal layers below our overlay.
- **Client maths** (`stellar/render-math.js`, in a Web Worker): viridis and inferno from
  Matt Zucker's CC0 polynomial fits (end colours within ~1% of matplotlib); cividis
  approximated from five stops. Stretches: percent (shared per detector), auto (per
  frame), fixed. Stack mean/median/sum; difference with least-squares brightness matching.
- **Checks (headless Edge, 2026-11-15):** all five featured targets load, play, and run
  "Find moving objects" in demo mode (8–21 frames). Live Barnard's Star: 364 images, 22
  frames, 208 s on first load (IRSA search + cutouts), difference pair at the predicted
  position.
- **New endpoint `/api/movers`:** Gaia DR3 stars with pm > 100 mas/yr near a position
  (searched up to 5′ beyond the circle), cached 30 days, for the moving markers. Not in
  the demo data yet.

## 17. IRSA refusing some requests (2026-11-15, morning)
- For a random spot (RA 120°, Dec +30°), `spherex_dr1` answered in 21 s (225 images) and
  `spherex_dr1_deep` in 21 s (0 images), but `spherex_qr3` and `spherex_qr3_deep` returned
  **502 Proxy Error within 0.3 s**, even one at a time. Minutes later QR3 at Barnard's Star
  answered fine while `wise_allwise` and TAP gave 502: IRSA's proxy refuses requests at
  random, as on 2026-11-14.
- Previously one failed collection failed the whole search ("NASA's image archive isn't
  answering"). Now `irsa.search_releases` returns `(rows, failed_collections)`, failures
  aren't cached, retries run ~30 s (4 tries), and answers carry
  `unavailable_collections` plus a plain-language `warning` (also in the frames `start`
  message), shown once in the Stellar View. The full error appears only if every
  collection fails; "no images" caused by failures is a 503 asking to reload, not
  "SPHEREx hasn't observed this spot".

## 18. Making loading faster (ideas, 2026-11-15)
Time for a new spot: SIA search 20 s–3 min, then cutouts (~4 MB each, ~1–2 min for 80).
- **Done:** searches are remembered per release (`search_cache_hours` in datasets.json):
  DR1 (finished) 30 days, QR3 (weekly) 6 hours.
- **To test when IRSA is healthy:** searching via TAP (`spherex.obscore` with
  `CONTAINS(POINT, s_region)`). Both tries so far hit 502 Proxy Errors.
- **Phase 10:** warm the featured targets nightly (search + cutouts) in the data-refresh job.
- **Later:** read only the needed rows of each image from NASA's AWS copy
  (`nasa-irsa-spherex`; SIA rows include `cloud_access` with bucket and key), skipping the
  3.9 MB EPSF table. Roughly 2–3× less data per image at a 5′ field, but more requests
  and more code.
- **Deployment:** host the backend in the US near IRSA/AWS (Hugging Face Spaces).

## 19. Phase 9: popups and data tabs
- `/api/meta` adds `zodi_at_target_mjy_sr` (median of ZODI in a 5 × 5 box around the
  target). Frame messages include `obs_ids`, so the Info and Flags tabs know which image
  to describe.
- Charts: Chart.js 4.6.1 + chartjs-chart-error-bars 4.4.5 (type `scatterWithErrorBars`,
  points `{x, y, yMin, yMax}`), loaded only when a chart tab opens (~70 KB gzipped).
- Demo data now saves Info/Flags for every frame plus moving Gaia stars. Barnard's Star
  and Epsilon Indi B were rebuilt (2026-11-15). The rebuild stopped at WISE 0855 when
  IRSA answered 503 for a flag mask, after the old folder had been deleted. Restored
  from git; `build_demo_data.py` now builds into a temporary folder and swaps only on
  success, and a failed mask or image detail is skipped. **To do:** rebuild WISE 0855,
  RW Aurigae and R Draconis when IRSA is healthy.
- **No ready-made image index on AWS.** `s3://nasa-irsa-spherex/` holds `dr1/`, `qr2/`,
  `qr3/` (level2 images by week plus calibration folders such as
  `solid_angle_pixel_map/`) but no catalogue of image footprints. A full-sky index would
  have to come from IRSA TAP (`spherex.obscore`), which timed out (300 s) and SIA gave
  502 on 2026-11-15.

## Sources
IRSA SIA (`https://irsa.ipac.caltech.edu/SIA`), IRSA cutouts (IBE), IRSA HiPS
properties, CDS MocServer, npm registry/jsDelivr for Aladin Lite.
