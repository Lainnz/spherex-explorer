# SPHEREx Xplorer — Build Plan for Claude Code
### Phase A: Title Page + Stellar View
Repository: https://github.com/Lainnz/spherex-explorer
Plan version 2 — November 14, 2026 (revised from the team's Word document "JAMEA Planet X and SPHEREx")

---

## PART 1 — FOR THE TEAM (plain language, Windows 11)

### What this file is
This is a step-by-step blueprint for Claude Code. It says what to build, which NASA data to use, how the parts fit together, and the order to build them in. Claude Code builds one phase at a time and stops after each one so you can check the work.

### One-time setup on Windows 11
1. **Open PowerShell.** Press the Windows key, type `PowerShell`, and press Enter.
2. **Install the three tools Claude Code needs** (skip any you already have). Paste each line, press Enter, and wait for it to finish:
   ```
   winget install OpenJS.NodeJS.LTS
   winget install Python.Python.3.12
   winget install Git.Git
   ```
   Then **close PowerShell and open it again** so Windows notices the new tools.
3. **Check they work.** Each of these should print a version number:
   ```
   node --version
   python --version
   git --version
   ```
4. **Download the repo to your computer:**
   ```
   cd $HOME\Documents
   git clone https://github.com/Lainnz/spherex-explorer.git
   cd spherex-explorer
   ```
5. **Add this plan and the logos.** Put `PLAN.md` in the `spherex-explorer` folder, next to `README.md`. Then make a folder called `brand` inside it and put both logo files there:
   - `brand\logo-horizontal-white.png` (white "SPHEREx Xplorer" wide logo, used on the dark title page)
   - `brand\logo-stacked-navy.png` (navy stacked logo, used on light backgrounds and as the browser-tab icon)

### Starting Claude Code
1. In PowerShell, inside the `spherex-explorer` folder, type `claude` and press Enter.
2. Paste this first message:
   > Read PLAN.md carefully, all of it. I'm on Windows 11 and new to web development. Do **Phase 0 only** (Section 12). Explain what you found in plain, beginner-friendly language, tell me exactly what to type in PowerShell to try anything, and stop. Don't start Phase 1 until I say "go".
3. After each phase, check the result (Claude Code will tell you how), then type:
   > Phase N looks good. Commit it, then do Phase N+1 from PLAN.md and stop again.

   If something looks wrong, describe it in normal words ("the Earth is too small", "the search bar isn't centered") and ask for a fix before moving on.
4. **Pushing to GitHub:** Claude Code works on a separate branch called `feature/title-and-stellar-view` and asks before it pushes. When you're happy, it can open a Pull Request so teammates review it before it goes into `main`.

### How the site works, in plain words
- **The website** (what people see) is HTML, CSS and JavaScript, hosted free on **GitHub Pages**.
- **A small helper server** (Python with **Astropy**) does the heavy science work. It asks NASA's archive (IRSA) for small pieces ("cutouts") of SPHEREx images, lines them up, adds or subtracts them, and measures brightness for spectra. It sends the website small, ready-to-show results, so no one downloads huge files. It runs on a free host (Hugging Face Spaces), because GitHub Pages can't run Python.
- **Aladin Lite** (from the Strasbourg astronomy data centre, CDS) powers the Stellarium-style sky in the Stellar View.
- **Three.js** draws the 3D Earth, stars, comets and meteors on the title page.
- **Demo mode:** a few famous targets are saved inside the site, so it still works for judges if the helper server is asleep.
- **New NASA data:** one settings file (`config/datasets.json`) says which SPHEREx release to use. A weekly automatic check looks for new releases.

### Important news about the data (November 12, 2026)
NASA's archive released **SPHEREx Data Release 1 (DR1)** on November 12, 2026. The data-set names changed: the current ones are `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3` and `spherex_qr3_deep`. The older `spherex_qr2` name is probably why the earlier test links didn't work. This plan uses DR1 + QR3, and Phase 0 double-checks the names.

---

## PART 2 — INSTRUCTIONS FOR CLAUDE CODE

> **Claude Code: everything below is your specification.** Work phase by phase (Section 12). At the end of each phase, stop and summarize in plain beginner-friendly language what you built. Give the exact **PowerShell** commands to run it (the user is on Windows 11) and what the user should see, then wait for approval. Avoid jargon in summaries, and explain any technical term you must use.

---

## 1. Mission and scope

### 1.1 The challenge (NASA Space Apps — "SPHEREx Open Data")
Build a public web tool that shows SPHEREx images of a patch of sky. Users enter Right Ascension / Declination and see a series of images of that patch played like a short video, making it easy to spot moving and changing objects.

**Test targets (formal testing comes later, but use these as featured/demo targets now):** Barnard's Star; Epsilon Indi B (a pair of brown dwarfs orbiting a star); WISE 0855 (fast-moving brown dwarf, RA 08h55m10.831s, Dec −7d14m42.53s); variable stars RW Aurigae and R Draconis.

### 1.2 Grading considerations (we must satisfy ALL of these)
| # | Consideration (from the challenge) | Where it's handled |
|---|---|---|
| C1 | Easy to update with the latest SPHEREx data releases | §6 config, §10 update system |
| C2 | Creative display of the 102 infrared bands; co-add each of the six detector arrays for signal-to-noise; extra credit: spectra on the fly | §7.5, §7.7, §8.3 wavelength slider + Spectrum tab |
| C3 | Add or subtract images taken at different times | §7.6, §8.3 Operations |
| C4 | User-chosen field of view (bigger = track faster movers, slower transfer) | §7.3, zoom buttons + FOV input in arcsec/arcmin |
| C5 | Overlay data from Gaia and WISE | §8.3 Layers |
| C6 | Coordinates in the URL so the tool can be embedded | §8.4, §8.5 |
| C7 | Show metadata such as contamination flags | §7.8, §8.3 Info & Flags |
| C8 | Use public tools (Astropy, Aladin) | Backend: astropy/astroquery/reproject. Frontend: Aladin Lite v3 |

### 1.3 The team's feature list for this phase (from the "Ideas for website" tab)
Build everything in the **Title Page**, **Stellar View**, **Interfaces** and **General** sections. Sections marked with "#" in the document (**Account, Categories/Search, 3D Time Machine view, Specific objects view**) are **not** built now. See §14 for the hooks to leave for them.

**Title Page (team's words, lightly cleaned up)**
- Title: the **"SPHEREx Xplorer"** logo (`brand/logo-horizontal-white.png`), placed **center-top, above the Earth**.
- A **dark-sky 3D model of Earth** that slowly turns, **with clouds**, like a night view from orbit: blue atmosphere glow along the edge, city lights on the night side. In the background: **meteors, comets and twinkling stars**, and **a few comets flying around Earth**.
- **Only the top of the Earth shows, at the middle-bottom of the page** (a curved horizon), with **objects orbiting around it**.
- The **search bar/button is large and centered**, showing that the main feature is searching for a coordinate. The button has a **binoculars icon**. Searching takes you to the Stellar View.
- A **"Randomize" button** next to the search button, for people who want to explore without a coordinate in mind. It picks a random coordinate and takes you to the Stellar View.
- **Animation after a coordinate is entered:** (1) Earth spins faster, (2) the camera zooms out and travels away toward that sky patch, (3) it lands on the Stellar View / Exploration page.

**Stellar View (team's words, lightly cleaned up)**
- Interface like **Stellarium, but without the ground**. The viewer stands at the **center of the Earth**, with the **north (celestial) pole above**.
- Show the SPHEREx sky patch for the entered coordinate, centered on it.
- **Left-click-drag on empty sky rotates the view around the center point** (the center stays fixed).
- A **"move" tool** (cursor/hand icon): dragging pans away from the coordinate. This does **not** change the coordinate in the URL.
- A button to **return to the original coordinate**.
- A button to **set the current view center as the new coordinate** (this updates the URL).
- **Magnifying-glass zoom in / zoom out buttons**, or type the FOV in **arcseconds or arcminutes**.
- **Click a specific object** to see its information, like Stellarium, using real data. The popup shows name, data and information, plus **"Favourite"** and **"Select"** buttons.
- A **time slider** to move forward or backward in time and see objects' positions change.
- **Play / Stop** buttons that animate the slider at a steady speed, and a **speed button** (e.g. 0.5×, 1×, 2×, 4×…).
- Display observation details, contamination flags and data-quality information from SPHEREx.
- Add together or subtract images taken at different times.
- Overlay data from Gaia / WISE.
- Merge data from the six detector arrays to improve image quality.
- Generate spectra for a selected object.
- Search by sky coordinate. Coordinate-based URL.
- Use Astropy for data processing and Aladin for interactive sky visualization.

**Interfaces**
- Zooniverse (https://www.zooniverse.org/organizations/zooniverse/nasa-zooniverse-projects) is the reference for **object profiles later** ("coming soon" Specific Objects page). The overall look is **a bit more professional than Zooniverse, and loosely similar to WiseView** (the WISE motion-search tool used by Backyard Worlds; the team's screenshot shows its left control panel with RA/Dec, field of view in arcseconds, band, colour map, stretch mode, "Trim Bright", "Linear", "Speed" and "Zoom" sliders, an animated image on the right, and an "About" section).
- A **techy feel with readable fonts**, mixing technology and professionalism.
- **Exactly 3 fonts** (readable, techy, professional).
- **Colour scheme: night sky + white, with a hint of Zooniverse** (teal).
- Use inspiration only. **Do not copy Zooniverse or WiseView logos, names or code.**

**General**
- Easily import new SPHEREx data releases.

**Also from the document:** make three.js anti-lag and keep massive amounts of data small (§9). Link to the SPHEREx data services so new data appears automatically (§10).

---

## 2. Ground truth about the data
Checked on 2026-11-14. **In Phase 0, re-verify every item marked ⚠ with a live request, and record findings in `docs/DATA_NOTES.md`.** Never invent column names, flag names, collection names or URLs. Inspect real responses.

### 2.1 SPHEREx basics
- 6 detector arrays (**D1–D6**), about **0.75–5.0 µm**. Wavelength increases with array number. Each detector sits behind a **linear variable filter**, so **the wavelength changes across each image**. Each sky point is observed in 17 steps per detector, which gives **102 spectral channels** (6 × 17).
- Pixel scale about **6.15″/pixel**. Images are **2040 × 2040**, about 70 MB each, one file per detector per pointing.
- Each sky position is revisited about every 6 months. Points near the ecliptic poles (**Deep Fields**, e.g. around R Draconis) have many more images. **Plan for 0 to thousands of images per position.**

### 2.2 Releases (as of Nov 14, 2026)
- **DR1 (Data Release 1)** was released by IRSA in **November 2026**. Spectral images DOI **10.26131/IRSA678**. DR1 also includes an **all-sky spectral cube in the 102 bands**, DOI **10.26131/IRSA679**. Overview: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html
- **QR3 (Quick Release 3)** was first released in **September 2026**, DOI **10.26131/IRSA662**. QR3 data continue arriving weekly.
- **QR2** is older. IRSA's current tutorial says SPHEREx recommends QR3 and DR1 over QR2. Don't use QR2 for SPHEREx images.
- IRSA's own intro tutorial queries **DR1 + QR3 together**: `Irsa.query_sia(pos=(coord, search_radius), collection=['spherex_dr1', 'spherex_qr3'])`. ⚠ Check in Phase 0 whether the same observation can appear in both (by `obs_id` / time). If so, de-duplicate and prefer DR1. Label each frame with its release.
- Put the acknowledgement text from the overview pages and the DOIs in the footer and README.

### 2.3 IRSA access (backend)
- **SIA2 image search:** `https://irsa.ipac.caltech.edu/SIA?COLLECTION=<name>&POS=circle+<ra>+<dec>+<radius_deg>&RESPONSEFORMAT=VOTABLE`
  - Collections listed in IRSA's tutorial: `spherex_dr1` (Wide), `spherex_dr1_deep` (Deep), `spherex_qr3` (Wide), `spherex_qr3_deep` (Deep). ⚠ Confirm with `Irsa.list_collections(servicetype='SIA', filter='spherex')`. Treat this as the source of truth and save the output to `docs/DATA_NOTES.md`.
  - ⚠ Print the real column names of a result (expect ObsCore-style: `obs_id`, `access_url`, `t_min`, `t_max`, `em_min`, `em_max`, `energy_bandpassname` like `SPHEREx-D2`, `s_region`, …).
  - SIA availability lags about a day behind the weekly data ingestion. TAP queries avoid that lag.
- **TAP:** `https://irsa.ipac.caltech.edu/TAP` (tables in the `spherex` schema, e.g. `spherex.artifact`, `spherex.plane`). Copy the exact query from IRSA's official cutouts notebook in https://github.com/Caltech-IPAC/irsa-tutorials (which has been updated for DR1). ⚠ Check which table/columns separate DR1 and QR3.
- **Cutout service (key to keeping data small):** append `?center=<ra>,<dec>&size=<deg>` to an on-premises spectral-image URL (DR1 files live under `https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/...`). The returned file keeps IMAGE/FLAGS/VARIANCE/ZODI cropped, with WCS-WAVE adjusted to the cutout. **Never download full 70 MB files.**
- **DR1 file structure** (from IRSA's DR1 intro tutorial): `PRIMARY` (no data), `IMAGE` (MJy/sr; zodiacal light **not** subtracted), `FLAGS` (per-pixel bitmap), `VARIANCE` ((MJy/sr)²), `ZODI` (zodiacal model), **`EPSF`** (binary table of 441 effective PSFs, replacing the older `PSF` cube), `WCS-WAVE` (spectral lookup table).
- **Flag names come from the FLAGS header:** each `MSKNnnnn` keyword is a flag name and `MSKDnnnn` its description; the DR1 example lists **22 flags**. Read them at runtime like the tutorial does:
  ```python
  for key in flags_header['MSKN*']:
      bit = key[4:]
      name, desc = flags_header[key], flags_header['MSKD' + bit]
  ```
  ⚠ Also read the Explanatory Supplement's list of "bad pixel" flags (the DR1 tutorial update uses the supplement's `CONTAINS_BAD_PIXEL` list as the default exclusion set).
- **Wavelength at a pixel:**
  ```python
  spectral_wcs = WCS(header=hdulist["IMAGE"].header, fobj=hdulist, key="W")
  spectral_wcs.sip = None
  wl, bw = spectral_wcs.pixel_to_world(x, y)
  ```
- Be polite to IRSA: cap concurrency, retry with backoff (IRSA's tutorials retry 3 times and raise astropy's `remote_timeout` to 120 s), cache everything.
- ⚠ **CORS:** test whether IRSA allows browser requests from another website (`curl.exe -I -H "Origin: https://lainnz.github.io" <url>`; look for `Access-Control-Allow-Origin`). The architecture works either way, because the browser talks to our backend. It matters only for loading IRSA HiPS tiles directly in Aladin (§2.4).
- Docs: Archive User Guide https://caltech-ipac.github.io/spherex-archive-documentation/ · cutouts https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html · spectral calibrations https://irsa.ipac.caltech.edu/data/SPHEREx/docs/spherex_spectral_calibrations.html
- Cloud copy: AWS S3 bucket `nasa-irsa-spherex` (anonymous access). Not needed now; mention in docs as a scaling path.

### 2.4 All-sky SPHEREx maps for the Stellarium-style sky
- **IRSA DR1 all-sky HiPS cube (102 wavelength planes):** HiPS root `https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube`. `hips_cube_depth` = 102. Plane index = `17*(band-1) + (channel-1)` (0-based). Plane wavelengths come from `data_cube_crval3_arr` in the HiPS `properties` file. The tutorial notes that frames 50 and 51 are blank. ⚠ Check whether the pinned Aladin Lite version can display a HiPS **cube** and switch planes. If yes, this powers a **102-band wavelength slider** across the whole sky (a strong answer to C2). If not (or if CORS blocks it), fall back to the CDS per-detector maps below and note it.
- **CDS SPHEREx HiPS (built from QR2; still good as a background sky):** per detector `https://alasky.cds.unistra.fr/SPHEREx/D1` … `/D6` (IDs `CDS/P/SPHEREx/QR2/D1`…`D6`), and a colour composite `https://alasky.cds.unistra.fr/SPHEREx/color`. Coverage maps at `.../Moc.fits`. ⚠ Confirm IDs: `https://alasky.cds.unistra.fr/MocServer/query?ID=*SPHEREx*&get=id`
- Label background maps honestly ("All-sky SPHEREx map (DR1 cube)" or "(QR2, via CDS)"). The frame-by-frame images in the time slider always come from DR1/QR3 cutouts.

### 2.5 Gaia DR3 (ESA, NASA partner) and WISE (NASA)
- Gaia DR3 (the team's link: https://esdcdoi.esac.esa.int/doi/html/data/astronomy/gaia/DR3.html): about 1.46 billion sources with positions, parallaxes and proper motions. Browser: VizieR table `I/355/gaiadr3` via Aladin Lite. Python: `astroquery.gaia`, table `gaiadr3.gaia_source`.
- WISE imagery as HiPS: `CDS/P/allWISE/color`, unWISE (e.g. `CDS/P/unWISE/color-W2-W1W2-W1`). AllWISE catalog: VizieR `II/328/allwise`. ⚠ Verify IDs via MocServer.
- Object names and types for click popups: SIMBAD (CDS). This is a lookup/tool, not imagery.
- The document says data must be **NASA and NASA partners**. SPHEREx, WISE, 2MASS and Gaia qualify. Don't make non-partner surveys the default.

### 2.6 IRSA tools to link (not to rebuild)
Spectrophotometry Tool https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry · Moving Object Search Tool https://irsa.ipac.caltech.edu/applications/MOST · SPHEREx Data Explorer https://irsa.ipac.caltech.edu/applications/spherex

### 2.7 Physics gotcha: proper motion
Barnard's Star moves about 10.4″/year, so its J2000 catalog position is about **4 arcminutes** from where SPHEREx saw it in 2025–26. WISE 0855 moves about 8″/year.
- When resolving a name, also fetch proper motion and parallax (SIMBAD via `astroquery.simbad`; Gaia DR3 where available; brown dwarfs like WISE 0855 and Eps Indi Ba/Bb may only be in SIMBAD).
- Propagate positions to each image's observation time with `SkyCoord(...).apply_space_motion(new_obstime=...)`. Center cutouts on the propagated position, and draw the predicted path.
- Real motion is only about **1–2 SPHEREx pixels per year**, so difference images show a faint black/white pair. Explain this in the UI and zoom in enough in the demo.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ FRONTEND (static, GitHub Pages)                          │
│ index.html   → Title page (three.js: Earth, stars, comets)│
│ stellar.html → Stellar View (Aladin Lite v3, Stellarium- │
│                style; time slider; panels)               │
│ Web Worker   → fast client-side image math               │
│ /data/demo/* → saved data for featured targets           │
└──────────────────────┬───────────────────────────────────┘
                       │ JSON + small binary frames (HTTPS, CORS allowed for our site)
┌──────────────────────▼───────────────────────────────────┐
│ BACKEND API (Python, FastAPI, Docker)                    │
│ astropy · astroquery · pyvo · reproject                  │
│ search · cutouts · zodi removal · flag masks · align ·   │
│ stacks · differences · detector merges · photometry →    │
│ spectra & light curves · object lookup · random target   │
│ disk cache (LRU) · hosted on Hugging Face Spaces (free)  │
└──────────────────────┬───────────────────────────────────┘
                       │
   IRSA SIA2/TAP/cutouts (SPHEREx DR1 + QR3) · SIMBAD · Gaia

Browser also loads from CDS/IRSA directly: Aladin Lite, HiPS tiles, VizieR catalogs.
GitHub Actions: deploy Pages · backend tests · weekly data-refresh
```

**Why this design**
- Astropy is Python and can't run on GitHub Pages. Running it in the browser (Pyodide) would be a ~30 MB+ download, so a small server is better.
- The server downloads only small cutouts and sends the browser kilobytes, not megabytes.
- **Download each cutout once and derive everything from it:** the time-slider frame, the flag summary and the photometry point.
- Demo mode keeps the judged experience reliable if the free server is asleep.

---

## 4. Tech stack (pin versions in Phase 1)
| Layer | Choice | Notes |
|---|---|---|
| Build | **Vite**, vanilla JS, multi-page (`index.html`, `stellar.html`) | No React. `base: '/spherex-explorer/'` for GitHub Pages. |
| 3D | **three.js** (npm, pinned) | Title page only; code-split so the Stellar View never loads it. |
| Sky | **Aladin Lite v3**, pinned (`https://aladin.cds.unistra.fr/AladinLite/api/v3/<version>/aladin.js`) | Not `latest`. Check method names in https://cds-astro.github.io/aladin-lite and the examples at https://aladin.cds.unistra.fr/AladinLite/doc/API/examples/ |
| Charts | **Chart.js** + `chartjs-chart-error-bars` | Spectrum + light curve |
| Icons | **Lucide** (MIT): `binoculars`, `shuffle`, `zoom-in`, `zoom-out`, `rotate-cw`, `hand`, `crosshair`, `locate-fixed`, `play`, `square`, `gauge`, `star`, `plus-circle` | Import only the icons used. |
| Fonts (exactly 3) | **Orbitron** (display: logo-adjacent headings, big numbers), **Exo 2** (UI and body text), **JetBrains Mono** (coordinates, data values) | All OFL. Self-host the needed weights (WOFF2) for speed. If Orbitron hurts readability, swap it for Michroma; keep the total at 3. |
| Backend | Python 3.11+, **FastAPI**, uvicorn | |
| Astro libs | **astropy**, **astroquery**, **pyvo**, **reproject**, numpy | |
| Other Python | httpx, diskcache, Pillow, pydantic-settings | |
| Tests | pytest; Vitest (coordinate/FOV parsers, URL state); optional Playwright smoke test | |
| Hosting | GitHub Pages (frontend), Hugging Face Spaces Docker (backend), Render.com as an alternative | ⚠ Check current free-tier limits |

---

## 5. Repository structure
```
spherex-explorer/
├─ PLAN.md · CLAUDE.md · README.md
├─ brand/                         # team-provided logos (do not edit; copy optimized versions into frontend/public/brand)
│  ├─ logo-horizontal-white.png
│  └─ logo-stacked-navy.png
├─ config/
│  ├─ datasets.json               # SINGLE SOURCE OF TRUTH: releases, collections, HiPS, limits (§6)
│  └─ targets.json                # featured targets: coords, proper motions, descriptions
├─ frontend/
│  ├─ index.html · stellar.html · vite.config.js · package.json
│  ├─ public/
│  │  ├─ brand/ (optimized WebP/PNG logos + favicon set made from the navy logo)
│  │  ├─ textures/ (Earth day, night lights, clouds — WebP, see §8.2)
│  │  ├─ data/starfield.bin · data/demo/<slug>/... · data/last_updated.json
│  └─ src/
│     ├─ shared/  api.js · config.js · coords.js · fov.js · url-state.js · cache.js · store.js · ui.js · demo.js
│     ├─ title/   main.js · scene.js · earth.js · starfield.js · flyers.js · transition.js · search.js · randomize.js
│     ├─ stellar/ main.js · sky-view.js · nav-tools.js · time-slider.js · player.js · layers.js ·
│     │           control-panel.js · operations.js · ops.worker.js · object-popup.js ·
│     │           spectrum.js · lightcurve.js · info-panel.js · flags-panel.js · embed.js
│     └─ styles/  tokens.css · fonts.css · base.css · components.css · title.css · stellar.css
├─ backend/
│  ├─ app/  main.py · settings.py · irsa.py · resolve.py · objects.py · motion.py · grid.py ·
│  │        epochs.py · products.py · photometry.py · flags.py · render.py · random_target.py · cache.py
│  ├─ tests/ (small real FITS cutout fixtures)
│  ├─ requirements.txt · Dockerfile
├─ scripts/  build_starfield.py · build_textures.py · resolve_targets.py · build_demo_data.py · check_new_releases.py
├─ docs/  ARCHITECTURE.md · DATA_NOTES.md · DATA_UPDATES.md · DEPLOY.md · RUBRIC.md · RUBRIC_RESULTS.md · CREDITS.md
└─ .github/workflows/  deploy-pages.yml · backend-ci.yml · data-refresh.yml
```
Add Python entries (`.venv/`, `__pycache__/`, `.pytest_cache/`, cache folders, `scripts/scratch/`) to the existing `.gitignore`.

---

## 6. Configuration (the "easy to update" core)

### 6.1 `config/datasets.json`
Both backend and frontend read this. Fill real values in Phase 0:
```json
{
  "default_releases": ["dr1", "qr3"],
  "releases": {
    "dr1": {
      "label": "SPHEREx Data Release 1",
      "doi": "10.26131/IRSA678",
      "sia_collections": { "wide": "spherex_dr1", "deep": "spherex_dr1_deep" },
      "priority": 1,
      "status": "active"
    },
    "qr3": {
      "label": "SPHEREx Quick Release 3 (weekly)",
      "doi": "10.26131/IRSA662",
      "sia_collections": { "wide": "spherex_qr3", "deep": "spherex_qr3_deep" },
      "priority": 2,
      "status": "active"
    }
  },
  "allsky_cube": {
    "label": "SPHEREx DR1 all-sky cube (102 bands)",
    "doi": "10.26131/IRSA679",
    "hips_url": "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube",
    "depth": 102,
    "blank_planes": [50, 51]
  },
  "pixel_scale_arcsec": 6.15,
  "detectors": [ "fill D1–D6 wavelength ranges from real em_min/em_max values (Phase 0)" ],
  "hips": {
    "spherex_color_qr2": "<verified CDS ID>",
    "spherex_D1_qr2": "...", "spherex_D6_qr2": "...",
    "wise_color": "<verified>", "unwise": "<verified>", "twomass": "<verified>"
  },
  "catalogs": { "gaia_dr3": "I/355/gaiadr3", "allwise": "II/328/allwise" },
  "limits": {
    "min_fov_arcsec": 30, "max_fov_arcsec": 3600, "default_fov_arcsec": 600,
    "max_images_default": 400, "epoch_gap_days": 20
  },
  "flags_default_exclude": ["<from the Explanatory Supplement bad-pixel list, verified in Phase 0>"]
}
```
- Adding a future release (e.g. DR2) = add one `releases` entry and update `default_releases`. Users can also choose a release in the UI or with `?release=`.

### 6.2 `config/targets.json`
`scripts/resolve_targets.py` resolves featured targets with SIMBAD (plus Gaia DR3 where available). Store `slug`, name, `ra`, `dec` (ICRS deg), `epoch`, `pmra`, `pmdec` (mas/yr), `parallax` (mas), type, a one-sentence plain-language description, and the suggested FOV/stretch for the demo. Use the user-given coordinates **exactly** for WISE 0855. For Epsilon Indi B, target the brown-dwarf pair (Eps Indi Ba/Bb) and mention the primary star in the description.

---

## 7. Backend specification

### 7.1 General rules
- FastAPI. CORS allows `https://lainnz.github.io`, `http://localhost:5173` and `http://127.0.0.1:5173` (env `ALLOWED_ORIGINS`).
- Env vars: `ALLOWED_ORIGINS`, `CACHE_DIR`, `CACHE_MAX_GB` (5), `IRSA_CONCURRENCY` (6), `MAX_FOV_ARCSEC`, `MAX_IMAGES`.
- Polite to IRSA: concurrency cap, 3 retries with backoff, User-Agent `spherex-xplorer/0.1 (+https://github.com/Lainnz/spherex-explorer)`, caching.
- `Cache-Control: public, max-age=86400` on immutable products.
- Validate inputs and return friendly JSON errors, e.g. `{ "error": "no_coverage", "message": "SPHEREx hasn't observed this spot yet in DR1 or QR3." }`.
- Long jobs stream progress as **NDJSON** so the UI fills in live.

### 7.2 Endpoints
| Method & path | Purpose |
|---|---|
| `GET /api/health` | `{status, releases, version}`. The frontend uses it to choose live vs demo mode. |
| `GET /api/config` | Serves `datasets.json`. |
| `GET /api/resolve?name=` | Name → `{ra, dec, pmra, pmdec, parallax, epoch, otype, source}` |
| `GET /api/random` | A random sky position that **has SPHEREx coverage**. Sample uniformly on the sphere (`ra = 360·u`, `dec = degrees(asin(2v−1))`, not uniform in Dec), check coverage with a quick SIA query, retry up to 5 times. About 1 time in 4, pick from a small built-in list of "interesting" spots (nebulae, clusters, galaxies, featured targets) so random exploring often shows something striking. |
| `GET /api/observations?ra&dec&fov&releases&detectors&tmin&tmax&max_images` | Images covering the position: `obs_id`, `release`, `detector`, `t_start`, `t_end`, `t_mid`, `em_min`, `em_max`, `survey` (wide/deep), `processing_version` (from filename), `access_url`, `s_region`; **epoch grouping**; propagated target position per image; `estimated_download_mb`; `total_available` (sample evenly in time if over `max_images`). De-duplicate DR1/QR3. |
| `POST /api/frames` (NDJSON) | `{ra, dec, fov_arcsec, releases, detectors, mode: "epoch"\|"exposure"\|"white", zodi_subtract, exclude_flags, stretch}` → per frame: `{frame_id, label, t_mid, detectors, wavelength_um, n_images, release, png_url, f32_url, fits_url, width, height, wcs, vmin, vmax}` |
| `GET /api/product/{id}.png` / `.f32` / `.fits` | Rendered frame / raw Float32 / FITS with WCS (to overlay on Aladin) |
| `POST /api/stack` | `{frame_ids, method: "ivw_mean"\|"median"\|"sum"}` → product |
| `POST /api/difference` | `{a, b, normalize}` → product (A − B) |
| `POST /api/photometry` (NDJSON) | `{ra, dec, use_proper_motion, aperture_px, annulus_px}` → per image `{obs_id, detector, wavelength_um, bandwidth_um, t_mid, flux_ujy, err_ujy, flags_at_target, flagged}` |
| `GET /api/object?ra&dec&radius` | **Click-to-identify:** nearest SIMBAD object (main name, other names/identifiers, object type, spectral type if any) and nearest Gaia DR3 source (G mag, BP−RP colour, parallax → distance in light-years with uncertainty, proper motion, radial velocity if present). Plain-language fields for the popup. Returns `found: false` with the clicked coordinates if nothing is nearby. |
| `GET /api/flags/{obs_id}?ra&dec&fov_arcsec` | Flag definitions (from `MSKN*`/`MSKD*`), % of pixels per flag, flags at the target pixel, per-flag mask PNG |
| `GET /api/meta/{obs_id}` | Curated metadata + full header |

### 7.3 Field of view and data budget (C4)
- FOV in **arcseconds** internally (matches WiseView). The UI accepts arcsec, arcmin or degrees. Range 30″–3600″ (1°), default 600″ (10′).
- Cutout size requested = FOV × 1.15 (margin for rotation).
- Download estimate = `n_images × size_px² × 4 bytes × 3 HDUs`. Show it ("≈ 48 MB from NASA, about 30 s") and warn above 150 MB. Explain: larger FOV lets you follow faster movers but takes longer.

### 7.4 Common grid and cleaning
1. TAN WCS centered on the (propagated mean-epoch) target, pixel scale `pixel_scale_arcsec`, north up.
2. Per cutout: `IMAGE − ZODI` if `zodi_subtract`. Mask flagged pixels (NaN). Reproject IMAGE/VARIANCE with `reproject_interp`. Reproject FLAGS with nearest-neighbour only (never interpolate bitmasks).
3. Optional background removal with `sigma_clipped_stats` median.

### 7.5 Epochs, frames, detector merging (C2)
- **Epochs:** sort by `t_mid` and start a new epoch when the gap exceeds `epoch_gap_days`. Label like "Visit 2 · 2025-11-03 → 2025-11-12".
- **Frame modes:**
  - `epoch` (default): one frame per (visit × detector), an inverse-variance-weighted co-add. This is "add together all data from each of the six detector arrays" and gives better signal-to-noise.
  - `white`: one frame per visit merging **all six detectors** (normalize each by its noise, then combine). Deepest image.
  - `exposure`: every individual image in time order (best for very fast movers, noisier).
- **Shared stretch** across all frames in a sequence (so blinking compares like with like), with an option for per-frame stretch.
- **Colour composite:** three detector co-adds mapped to RGB (default D1→blue, D3→green, D5→red; user can change).

### 7.6 Add and subtract (C3)
- **Stack** (`ivw_mean`, `median`, `sum`). A median of all visits makes a "still sky" template where moving objects vanish.
- **Difference** A − B (visit vs visit, or visit vs template), with optional brightness matching. Moving objects show as black/white pairs; variable stars as a single bright or dark spot.
- Quick stacks/differences of already-loaded frames run in a **Web Worker** in the browser without asking the server again.

### 7.7 Spectra and light curves on the fly (C2 extra credit)
- For each image covering the propagated position: pixel (x, y) from the spatial WCS; wavelength and bandwidth from the spectral WCS; aperture photometry (radius 2 px, background annulus 4–7 px, sigma-clipped median); MJy/sr × pixel solid angle → µJy; error from VARIANCE. ⚠ Use the DR1 solid-angle pixel map calibration product if available (the DR1 tutorial update mentions DR1 solid-angle maps); otherwise use the nominal pixel area and label it approximate.
- Reuse cached frame cutouts. Fetch tiny extra cutouts (≈0.03°) only when needed.
- Flagged points hidden by default (toggle to show as hollow markers).
- Label honestly: "Quick-look aperture photometry. For science-grade spectra, use IRSA's Spectrophotometry Tool" (with link).
- **Spectrum:** flux vs wavelength, coloured by detector, optional binning into the 102 channels, per-visit overlay, CSV download.
- **Light curve:** flux vs date per detector, with a wavelength-window filter so users compare like with like, CSV download.

### 7.8 Flags and metadata (C7)
- Flag names and descriptions from the FLAGS header (`MSKN*`/`MSKD*`). Turn them into plain English in the UI ("Hot pixel", "Possible cosmic ray", …) via `backend/app/flag_labels.json`, which maps official names to friendly text (keep official names visible too).
- Per image: % flagged per bit, bits at the target pixel, zodi level at the target, processing version, release, survey.
- The default exclusion set comes from the Explanatory Supplement's bad-pixel list (Phase 0).

### 7.9 Caching
`diskcache` for cutouts (key = hash of url + center + size, LRU-capped); content-hash ids for products; in-memory LRU (6 h) for observation lists so new weekly data shows up.

---

## 8. Frontend specification

### 8.1 Design system
- **Colours (`tokens.css`):** night sky `#050A18` (page background), deep navy `#011939` (panels; matches the logo navy), panel border `#1E3256`, white `#FFFFFF` and soft white `#E8EEF7` (text), muted `#8FA3BF` (secondary text), **Zooniverse-inspired teal `#00979D`** as the single accent (hover `#00B5BC`), warning amber `#F0B200`, error `#E45950`. Light surfaces where needed: `#F5F7FA` with navy text.
- **Fonts (exactly 3):** Orbitron (display), Exo 2 (UI/body, 16 px minimum), JetBrains Mono (coordinates and numbers).
- **Style:** dark glassy panels (`backdrop-filter: blur`, but fall back to solid navy on weak devices), thin teal accent lines, 8 px radius, subtle glow on focus. Looks techy and professional, not "gamer".
- **Detector colours (colour-blind safe, Okabe–Ito):** D1 `#0072B2`, D2 `#56B4E9`, D3 `#009E73`, D4 `#F0E442`, D5 `#E69F00`, D6 `#D55E00`.
- **Help tooltips:** a small "?" next to every science control, written for a curious 14-year-old (e.g. *"Difference: subtracts one visit from another. Anything that moved shows up as a black-and-white pair."*).
- **Logos:** `brand/logo-horizontal-white.png` on dark backgrounds (title page, Stellar View header). `brand/logo-stacked-navy.png` on light backgrounds and as the favicon source. Make optimized WebP copies plus a favicon set in `frontend/public/brand/`. Don't recolour or redraw the logos.
- **Footer:** credits (SPHEREx/IRSA acknowledgement + DOIs, Gaia/ESA, WISE, CDS Aladin Lite & SIMBAD, NASA Earth imagery), GitHub link, "Data current as of <date>".
- **Accessibility:** WCAG AA contrast, keyboard shortcuts (Space play/stop, ←/→ step, +/− zoom, R rotate tool, M move tool, H return home, B blink), `aria-label`s, `prefers-reduced-motion`, responsive to tablet (title page works on phones).

### 8.2 Title page (`index.html`)
**Layout (top to bottom)**
1. **Logo** (`logo-horizontal-white`) centered at the top, about 40–50% of viewport width on desktop.
2. **Tagline** under the logo (placeholder: *"Watch the infrared sky change."* — the team will replace it).
3. **Search area, centered in the middle of the screen:** a large search field (about 640 px wide, 64 px tall) with placeholder *"Search a star or coordinates — e.g. Barnard's Star or 17h57m48.97s +04d41m36.1s"*. To its right: a big teal **search button with a binoculars icon** (label "Explore"), and next to it a secondary **"Randomize" button with a shuffle icon** (label "Surprise me" or "Randomize"; the team picks). Under the field: example chips for the featured targets and a small "Advanced" toggle (FOV, detectors, release).
4. **Earth:** only the **top of the planet** is visible as a curved horizon across the **middle-bottom** of the page (Earth's center sits below the viewport). Objects orbit around it.
5. Small "What is SPHEREx?" / "How to use" links that open short overlays (keep the hero clean).
6. Footer credits.

**3D scene (three.js), matching the team's reference image (night Earth from orbit)**
- **Earth** (`earth.js`): one sphere with a custom shader blending:
  - Day texture and **night-lights texture** (city lights on the dark side). Use NASA imagery (public domain, credited): Blue Marble (day) and Black Marble (night lights) from NASA Visible Earth / NASA Earth Observatory. `scripts/build_textures.py` downloads the originals once, resizes them to **2048×1024 WebP** (plus a 1024×512 version for phones and slow devices), and records sources in `docs/CREDITS.md`.
  - A **cloud layer**: a second sphere slightly larger, semi-transparent cloud texture (NASA cloud imagery), rotating slightly faster than the surface.
  - An **atmosphere glow**: a Fresnel-rim shader on a slightly larger back-side sphere, in a blue like the reference image.
  - Mostly night side facing the viewer with a thin bright limb. Slow rotation (about one turn per 3–4 minutes).
- **Background stars:** real Gaia DR3 bright stars (`scripts/build_starfield.py`: `phot_g_mean_mag < 7.5`, tuned to about 20–30k stars; colour from `bp_rp`, size from magnitude; quantized Int16 xyz + Uint8 mag + Uint8 colour = 8 bytes/star, about 200 KB). One `THREE.Points` draw call with a shader for soft round sprites and **twinkling**.
- **Orbiting objects:** 2–4 **comets** with glowing heads and particle tails orbiting Earth on tilted ellipses; a small original low-poly **SPHEREx-like spacecraft** (cone-shaped telescope, inspired by the logo's silhouette — SPHEREx really does orbit Earth) on a polar orbit; 1–2 small asteroids.
- **Background events:** occasional **meteors** (short bright streaks, fade out) and a distant comet crossing slowly.
- Gentle mouse/touch parallax (disabled with reduced motion).

**Search, randomize and transition**
- `coords.js` parses: decimal degrees (`269.452 4.693`, `269.452, +4.693`), sexagesimal h/m/s + d/m/s (including `08h55m10.831s -7d14m42.53s`), colon form (`17:57:48.97 +04:41:36.1`), and names (resolved via `/api/resolve`, or `targets.json` in demo mode). Unit-test it with Vitest.
- **Randomize:** calls `/api/random` (in demo mode, pick a random featured target or a random known-covered spot from a small saved list), then runs the same transition.
- **Transition (about 2.5–3.5 s, skippable with a click/Esc; instant with reduced motion):**
  1. **Earth spins faster** (ease-in, about 0.8 s), clouds blur slightly.
  2. **Camera zooms out and travels away**: Earth shrinks below, the camera turns toward the target's RA/Dec direction on the star sphere, and stars stretch into short streaks (warp effect done in the star shader, not post-processing).
  3. **Arrive:** stars settle, fade to the night-sky colour, navigate to `stellar.html?ra=…&dec=…&fov=…` (or `?target=slug`). The Stellar View starts slightly zoomed out and eases in, so it feels continuous.
- Friendly errors ("We couldn't find 'Barnards'. Did you mean Barnard's Star?").
- Stop the render loop and `dispose()` all three.js resources before navigating.

### 8.3 Stellar View (`stellar.html`)
**Concept:** Stellarium without the ground. The viewer is at the **center of the Earth**, looking out at the celestial sphere with **north (the celestial pole) up**. Aladin Lite in equatorial coordinates, full-screen, with panels floating over it.

**Layout (desktop)**
```
┌ Header: logo · search (binoculars) · Randomize · release badge · Copy link · Embed ──────────────────┐
│ LEFT CONTROL PANEL (collapsible, ~300px,    │  SKY (Aladin Lite, full-bleed behind panels)           │
│ WiseView-inspired)                          │                                                        │
│ • RA / Dec (decimal + sexagesimal display)  │   ┌ Nav toolbar (right edge, vertical) ┐               │
│ • Field of view [   600 ] [″ ▾]             │   │ 🔍+  🔍−  ⟳ rotate  ✋ move         │               │
│ • Band: All/D1–D6 · Wavelength slider       │   │ ⌖ return home  📍 set as new coord │               │
│ • Colour map: gray / inferno / viridis      │   └────────────────────────────────────┘               │
│ • Stretch: percent / fixed / auto           │                                                        │
│ • Trim Bright slider · Linear (asinh) slider│   Object popup (on click): name, data, ★ Favourite,    │
│ • Frame mode · Operations                   │   ➕ Select                                            │
│ • About this view (plain-language text)     │                                                        │
├─────────────────────────────────────────────┴────────────────────────────────────────────────────────┤
│ TIME BAR: ▶ Play / ■ Stop · speed [1×▾] · ◀ ▶ step · time slider with visit ticks · date readout      │
│ filmstrip thumbnails (coloured by detector)                                                          │
└──────────────────────────────── RIGHT DRAWER tabs: Info · Flags · Spectrum · Light curve · Layers ────┘
```

**1. The sky (Aladin Lite)**
- Base layer: the **SPHEREx DR1 all-sky cube** if Aladin can show it (with the **wavelength slider** choosing among the 102 planes and showing the wavelength in µm), otherwise the CDS SPHEREx colour map. Other base choices: SPHEREx D1–D6, AllWISE colour, unWISE, 2MASS.
- On top: the **current SPHEREx frame** from the time slider (FITS from `/api/product/{id}.fits`), an opacity slider, footprints of matched SPHEREx images, a target crosshair, and the **predicted motion track** for high-proper-motion targets.
- Starts zoomed out (about 30–60°) and eases in to the chosen FOV on arrival.

**2. Navigation tools (`nav-tools.js`)** — as the team described
- **Rotate tool (default):** left-click-drag on empty sky **rotates the view around the center point**; the center stays fixed. Implement by intercepting pointer events, computing the angle of the drag around the center, and setting Aladin's view rotation (⚠ find the rotation method in the pinned version's API). Disable Aladin's default drag-to-pan while this tool is active.
- **Move tool (hand icon):** drag pans the view away from the coordinate (Aladin's normal panning). **The URL coordinate does not change.** Show a small "You've moved X′ from your coordinate" chip.
- **Return home (⌖):** animates back to the original coordinate, FOV and rotation 0.
- **Set as new coordinate (📍):** makes the current view center the new coordinate, updates the URL (`ra`, `dec`), and reloads observations for the new spot (with a confirm toast: "New coordinate set. Loading SPHEREx images…").
- **Zoom:** magnifying-glass **+ / −** buttons (×2 per click, animated), mouse wheel, pinch on touch, and a **FOV input with a unit selector (″ / ′ / °)**. All stay in sync. Validate against the limits in `datasets.json`.
- ⚠ The team's wording "rotate around the center" is interpreted as rotating the view about the fixed center point. If testing shows the team meant something else, ask the user before changing it.

**3. Clicking objects (`object-popup.js`)**
- Clicking a star or catalog marker (not dragging) calls `/api/object` and opens a Stellarium-style popup: main name + other names, type, magnitude and colour, **distance in light-years** (from parallax, with uncertainty, or "unknown"), proper motion ("moves X arcsec per year"), RA/Dec, and a "What is this?" one-liner for the type.
- Buttons: **★ Favourite** and **➕ Select**. Accounts aren't built yet, so store both lists in the browser (`store.js`, `localStorage` wrapped in try/catch, with an in-memory fallback). Show a small "Favourites (n)" / "Selected (n)" counter in the header with a dropdown list. Label it "Saved on this device; accounts coming soon". These lists feed the future Account and 3D Time Machine pages (§14).
- A "Measure spectrum" button in the popup jumps to the Spectrum tab for that object.

**4. Time slider and playback (`time-slider.js`, `player.js`) — the "little video"**
- Slider range = first to last SPHEREx observation of this patch. **Ticks mark each visit.** Dragging moves through time:
  - **SPHEREx frames** switch to the image nearest that time (cross-fade between frames for smoothness).
  - **Catalog markers** for high-proper-motion stars (Gaia/SIMBAD) slide smoothly to their predicted positions for that date, so users see objects' locations change.
  - A date readout (`2025-11-07 UTC · Visit 2 of 3 · D2 · 1.43 µm`).
- **Play / Stop** animate the slider at a steady (linear) speed. **Speed** selector: 0.25×, 0.5×, 1×, 2×, 4×, 8×. Loop and bounce options. **Blink** between two chosen frames.
- Frames stream in one by one with a progress bar ("12 of 18 frames ready"). Frames are decoded once into `ImageBitmap`s. Client-side stretch (from the control panel) is applied in the Web Worker to the Float32 data.
- There's also a detail "Frame Player" view (toggle) that shows the current frame alone, enlarged, WiseView-style, for close inspection with zoom up to 1200%.

**5. Control panel (WiseView-inspired)**
RA/Dec field (decimal; shows sexagesimal under it), FOV with units, Band (All / D1–D6) + wavelength slider, Colour map (gray, inferno, viridis, cividis), Stretch mode (percent / fixed / auto, matching WiseView's idea), Trim Bright (percentile or fixed max), Linear (asinh softening), Frame mode (per-visit co-add / all-detector merge / every exposure), Operations, and an "About this view" section in plain language with data credits.

**6. Operations (C3)**
Segmented control: **None · Stack · Difference · Colour composite**. A one-click **"Find moving objects"** preset (latest visit − median template). Results appear as new frames on the time bar with a badge.

**7. Right drawer tabs**
- **Info (C7):** obs id(s), release (DR1/QR3), detector, wavelength range and wavelength at the target, start/end time (UTC + MJD), images co-added, survey (wide/deep), processing version, zodi level, "Open in IRSA" link, collapsible raw FITS header.
- **Flags (C7):** each flag (official name + plain-English label), % of pixels affected, checkboxes to show as a coloured overlay and to exclude from stacks, flags at the target pixel highlighted, a simple quality badge ("Good / Use with care / Poor", thresholds documented in code).
- **Spectrum (C2):** live-streaming points, detector colours, error bars, 102-channel binning, per-visit overlay, show-flagged toggle, CSV.
- **Light curve:** flux vs date, wavelength window, CSV.
- **Layers (C5):** Gaia DR3 catalog (with proper-motion arrows and a magnitude filter), AllWISE catalog, image overlays + opacity, SPHEREx coverage map, a short note on what each mission is.

**8. Status and empty states**
"Waking up the data server… (free servers sleep; up to ~60 s)", "No SPHEREx images here yet — showing the all-sky map", "Large request — this may take a while", Live/Demo badge.

### 8.4 URL scheme (C6)
`stellar.html` reads these parameters and writes them back with `history.replaceState` (except the panned view center; see the move tool):
| Param | Example | Meaning |
|---|---|---|
| `target` | `barnards-star` or `Barnard's Star` | Name or slug |
| `ra`, `dec` | `ra=133.79513&dec=-7.24515` | ICRS degrees (takes priority over `target`) |
| `coords` | `08h55m10.831s-07d14m42.53s` | Any format `coords.js` accepts |
| `fov` | `600` · `600s` · `10m` · `0.25d` | Plain number = arcseconds; suffix `s`/`m`/`d` for arcsec/arcmin/deg |
| `rot` | `30` | View rotation in degrees |
| `t` | `2026-03-14` | Time-slider position |
| `det`, `wl` | `det=1,2,3` · `wl=3.3` | Detectors; wavelength (µm) for the cube slider |
| `mode` | `epoch` \| `white` \| `exposure` | Frame mode |
| `op`, `a`, `b` | `op=diff&a=3&b=1` | Operation and visit indices |
| `cmap`, `stretch`, `trim`, `linear` | `cmap=gray&stretch=percent&trim=99.5` | Display settings |
| `base`, `overlay`, `opacity`, `cat` | `base=spherex_cube&overlay=wise_color&opacity=0.4&cat=gaia` | Layers |
| `release` | `dr1,qr3` | Releases from `datasets.json` |
| `autoplay`, `speed` | `autoplay=1&speed=2` | Playback |
| `embed`, `demo` | `embed=1` · `demo=1` | Embed UI; force demo data |

- **Copy link** and **Embed** buttons (the embed button copies an `<iframe src=".../stellar.html?...&embed=1" width="800" height="500"></iframe>` snippet).
- Invalid values fall back to defaults with a small notice. They never crash the page.

### 8.5 Embed mode
`embed=1` hides the header, panels and footer. It shows the sky + time bar (play/stop, speed, slider), a small target label, the Live/Demo badge and an **"Open in SPHEREx Xplorer ↗"** link. Must work inside an iframe on another site. Document it in the README.

### 8.6 Demo mode
- `/api/health` with a 3 s timeout. On failure (or `?demo=1`), featured targets load from `/data/demo/<slug>/manifest.json` (same shape as live results: frames, photometry, flags, metadata, object popups for the main star). Banner: "Showing saved demo data from <date>. Live data server unavailable."
- Non-featured positions while offline: the sky still works (Aladin doesn't need our backend), with a wake-up/retry message.
- `scripts/build_demo_data.py` builds these by calling the backend pipeline directly. Total demo data **under 25 MB**.

---

## 9. Performance rules ("anti-lag" and "keep data small")

### 9.1 three.js (title page)
1. Earth = 3 meshes (surface, clouds, atmosphere) at a sensible sphere resolution (64×64 segments is plenty). Stars = 1 `Points` draw call. Comets/asteroids = `InstancedMesh` + shared particle systems. Target **< 30 draw calls**.
2. Textures: WebP 2048×1024 on desktop, 1024×512 on phones and slow devices (pick by `navigator.hardwareConcurrency`, screen size and a quick frame-time test). Generate mipmaps and use `anisotropy` ≤ 4. Load the low-res set first, then swap in high-res when idle.
3. `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
4. No heavy post-processing (no bloom pass). Glows via shaders and additive sprites.
5. **No allocations in the animation loop.** Reuse vectors/matrices. Update buffer attributes in place.
6. Pause rendering when the tab is hidden (`visibilitychange`). Stop and `dispose()` everything before navigating.
7. Adaptive quality: if frame time averages > 20 ms for 2 s, drop the cloud layer resolution, star count (draw range), particle count, then pixel ratio.
8. `prefers-reduced-motion`: slow, near-static scene; transition becomes a fade.
9. Show a CSS star background and the logo instantly while three.js and textures load (the page should never look empty).
10. Budgets: title page JS ≤ 250 KB gzipped; textures ≤ 1.5 MB on desktop, ≤ 500 KB on mobile; starfield ≤ 300 KB; first paint < 1.5 s; steady 60 fps on a typical laptop.

### 9.2 Data (Stellar View)
1. Never move full SPHEREx files. Only FOV-sized cutouts, plus tiny photometry cutouts.
2. The browser gets only display-ready products: PNG frames (~10–60 KB), Float32 frames only when needed for client math, JSON metadata.
3. Stream (NDJSON) and render progressively. `AbortController` cancels stale requests when target/FOV/detectors change.
4. Concurrency: browser ≤ 6 parallel downloads; server ≤ `IRSA_CONCURRENCY`.
5. Caching: server disk cache, HTTP cache headers, browser Cache API, in-memory `ImageBitmap` LRU (~150 MB).
6. Cap images per request (`max_images`, sampled evenly in time) with "Load more". Essential for Deep Field targets such as R Draconis.
7. Pixel math in a Web Worker with transferable `ArrayBuffer`s.
8. Aladin loads HiPS tiles on demand. Don't preload surveys. Don't load three.js on this page.
9. Lighthouse Performance ≥ 85 (desktop) on both pages.

---

## 10. Keeping up with new SPHEREx data (C1)
1. **Live by default:** the backend queries IRSA at request time, so weekly QR3 data appears automatically (observation lists cache 6 h only).
2. **One-file release switch:** `config/datasets.json` + a UI release picker + `?release=`.
3. **Release watcher** (`scripts/check_new_releases.py`): runs `Irsa.list_collections(servicetype='SIA', filter='spherex')` and compares with `datasets.json`. It also checks for new all-sky products. Anything new → a report, and the workflow opens a GitHub Issue ("New SPHEREx collection detected: spherex_dr2 …").
4. **Weekly GitHub Action** (`data-refresh.yml`, cron + manual run): watcher → `resolve_targets.py` → `build_demo_data.py` → update `last_updated.json` → open a Pull Request with refreshed demo data (a human approves).
5. **`docs/DATA_UPDATES.md`:** a beginner-friendly checklist for when NASA announces a new release.
6. Footer: "Data current as of <date> · Releases: DR1, QR3".

---

## 11. Deployment
- **Frontend:** `deploy-pages.yml` builds Vite on push to `main` and deploys with `actions/deploy-pages`. The URL will be `https://lainnz.github.io/spherex-explorer/`. The repo owner (Lainnz) must set Settings → Pages → Source: **GitHub Actions** once. Explain this click by click.
- **Backend:** `backend/Dockerfile` (python:3.11-slim, non-root user, `uvicorn app.main:app --host 0.0.0.0 --port 7860` for Hugging Face Spaces). `docs/DEPLOY.md` explains creating the Space and setting env vars click by click, plus the Render alternative. The frontend reads the backend address from `VITE_API_BASE` (a GitHub Actions variable), defaulting to `http://localhost:8000` in development.
- No secrets or API keys are needed for any data source.

---

## 12. Build phases (stop after each one)

### Phase 0 — Check the data and tools (no app code yet)
1. Inspect the repo, create branch `feature/title-and-stellar-view`.
2. Check Node, Python, Git on Windows. Give PowerShell `winget` commands for anything missing. Set up the Python virtual environment and explain how to activate it in PowerShell (`.\.venv\Scripts\Activate.ps1`; if blocked, `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
3. Scratch script in `scripts/scratch/` (git-ignored) that:
   - Runs `Irsa.list_collections(servicetype='SIA', filter='spherex')` and prints the full list.
   - **Troubleshooting first:** the team's browser tests of SIA links with `spherex_qr2`, `spherex_qr` and `spherex_dr1` all failed on 2026-11-14. IRSA's own documented example (`COLLECTION=spherex_qr&POS=circle+127.69444+-39.17760+0.01&RESPONSEFORMAT=HTML`) returned **column headings but zero rows**. So the service is up and the URL format is valid, and an unknown or retired collection name gives an empty table, not an error. Columns seen: `s_ra, s_dec, facility_name, instrument_name, dataproduct_subtype, calib_level, dataproduct_type, energy_bandpassname, energy_emband, obs_id, s_resolution, em_min, em_max, em_res_power, proposal_title, …`. Find out which names return rows today before anything else: (a) query a long-standing collection such as `wise_allwise` at the same position (if that also fails, the SIA service itself is down or the URL format is wrong); (b) try `RESPONSEFORMAT=CSV` and `VOTABLE` as well as `HTML`; (c) try `POS=CIRCLE 269.452 4.693 0.1` with proper URL encoding; (d) run the same search through TAP (`https://irsa.ipac.caltech.edu/TAP`) as a fallback. Report what worked in plain language. If IRSA is down, say so and pause rather than guessing.
   - Queries each of `spherex_dr1`, `spherex_dr1_deep`, `spherex_qr3`, `spherex_qr3_deep` around Barnard's Star (radius 0.1° to allow for its motion); prints counts, **all column names**, 3 sample rows, the time range covered, and whether DR1 and QR3 overlap.
   - Downloads **one cutout** (0.1°), prints `hdul.info()`, the IMAGE header, the FLAGS `MSKN*`/`MSKD*` table, and the wavelength at the center.
   - Checks CORS headers on SIA, cutout and IRSA HiPS URLs.
   - Fetches the IRSA all-sky cube `properties` file and prints `hips_cube_depth`, `hips_tile_format`, `hips_order`, `data_cube_crval3_arr`.
   - Queries the CDS MocServer for SPHEREx, WISE, unWISE, 2MASS HiPS IDs.
   - Checks whether the pinned Aladin Lite version supports HiPS cubes and view rotation (read the docs/source; build a tiny test page if needed).
4. Write `docs/DATA_NOTES.md` and draft `config/datasets.json` from real results.
5. Report in plain language, including anything that differs from this plan and how you'll adapt.

### Phase 1 — Scaffold
Vite multi-page frontend; FastAPI skeleton with `/api/health` and `/api/config`; `CLAUDE.md`; `.gitignore` additions; README skeleton with credits; backend CI; Vitest; fonts and design tokens; optimized logos + favicon. **Check:** `npm run dev` shows two placeholder pages with the logo and fonts; the health endpoint returns JSON; tests pass.

### Phase 2 — Backend data core
`irsa.py`, `resolve.py`, `motion.py`, `epochs.py`, `random_target.py`, `/api/resolve`, `/api/observations`, `/api/random`, caching, retries. Real FITS fixtures for tests. Run `resolve_targets.py`. **Check:** a table of observation counts/visits/propagated positions for all featured targets, and 5 sample random positions.

### Phase 3 — Backend products
`grid.py`, `products.py`, `render.py`, `flags.py`, `/api/frames`, products, stack/difference, all-detector merge, colour composite. **Check:** a contact-sheet PNG per target (all frames + one difference image). Barnard's Star and WISE 0855 should show motion pairs near the predicted path.

### Phase 4 — Photometry, spectra, light curves, object lookup
`photometry.py`, `objects.py`, `/api/photometry`, `/api/object`, `/api/flags`, `/api/meta`. **Check:** spectrum + light-curve PNGs per target (R Draconis should vary), and sample `/api/object` answers for 3 stars. Explain in plain language.

### Phase 5 — Demo data
`build_demo_data.py` → `frontend/public/data/demo/`. **Check:** folder sizes (< 25 MB total).

### Phase 6 — Title page
`build_textures.py`, `build_starfield.py`, Earth (day/night/clouds/atmosphere), twinkling stars, comets, spacecraft, meteors, logo, search + binoculars button, Randomize, chips, the 3-step transition, reduced-motion version. **Check:** the user opens it locally; the Earth top sits at the middle-bottom, the logo is center-top, the search is large and centered, and the temporary FPS readout stays near 60.

### Phase 7 — Stellar View sky and navigation
Layout, header, Aladin Lite (cube + wavelength slider or fallback), layers, coverage, footprints, nav toolbar (rotate, move, return home, set as new coordinate, zoom buttons, FOV with units), URL read/write, live/demo detection, embed mode. **Check:** every URL example in §8.4 works; each nav tool behaves as described.

### Phase 8 — Time slider, playback, operations, control panel
Streaming frames, time slider with visit ticks, play/stop, speed, blink, moving catalog markers, filmstrip, WiseView-style control panel, Web Worker stretch/math, operations incl. "Find moving objects". **Check:** all featured targets play in live and demo mode.

### Phase 9 — Object popups and data tabs
Click-to-identify popup with Favourite/Select (local storage), Info, Flags (overlays + exclusion), Spectrum, Light curve, help tooltips everywhere. **Check:** walk through each featured target; describe or screenshot each tab.

### Phase 10 — Updates and deployment
`check_new_releases.py`, `data-refresh.yml`, `deploy-pages.yml`, Dockerfile, `DEPLOY.md`, `DATA_UPDATES.md`, `last_updated.json`. **Check:** instructions for running the workflow manually; local Docker build if Docker Desktop is installed (optional).

### Phase 11 — Polish, performance and rubric
Lighthouse, accessibility (keyboard, contrast), cross-browser (Chrome, Edge, Firefox), remove debug overlays, finish README (live link, screenshots, embed example, credits, update steps). Fill `docs/RUBRIC_RESULTS.md` honestly with evidence and gaps. Ask before pushing; open a Pull Request to `main`.

*(Formal testing on the five challenge targets is listed "for later" in the team's document. Phases 2–9 still use them as featured targets. A dedicated test pass can follow in Phase B.)*

---

## 13. Grading scale (`docs/RUBRIC.md`)
Score each row 0–4: **0** missing · **1** started/broken · **2** works for a basic case · **3** works for all featured targets with clear UI · **4** polished, explained for the public, beyond the brief.

| # | Criterion | What "4" looks like | How to verify |
|---|---|---|---|
| R1 | Coordinate search → image sequence (core objective) | Any name/coordinate format → frames stream within seconds, play like a video | Search featured targets + random spots |
| R2 | Moving-object discovery (C3) | Stack, difference, median template, blink, motion track; pairs visible for Barnard's Star and WISE 0855 | "Find moving objects" preset |
| R3 | 102 bands / detector merging (C2) | Per-detector co-adds, all-detector merge, RGB composite, 102-band wavelength slider | Frame modes + slider |
| R4 | Spectra on the fly (C2 extra) | Live spectrum at any clicked object, 102-channel binning, per-visit overlay, CSV | RW Aur, R Dra |
| R5 | Variability | Light curve shows R Dra changing | Light-curve tab |
| R6 | Field of view (C4) | Zoom buttons + FOV in ″/′/°, honest data-size estimate | Change FOV 30″ → 1° |
| R7 | Overlays (C5) | SPHEREx/WISE/2MASS maps, Gaia/AllWISE catalogs, PM arrows, opacity | Layers tab |
| R8 | URL + embed (C6) | Every state in the URL; copy link; iframe embed works elsewhere | New tab + iframe test |
| R9 | Metadata & flags (C7) | Official + plain-English flags, overlays, exclusion, quality badge, raw header | Info & Flags tabs |
| R10 | Easy updates (C1) | Config-driven releases, watcher, weekly PR, docs | Run watcher |
| R11 | Public astro tools (C8) | Astropy/astroquery/reproject + Aladin Lite, credited | Code + README |
| R12 | Title page (team spec) | Night Earth with clouds at bottom, logo top, big centered search with binoculars, Randomize, comets/meteors/twinkling stars, 3-step transition, 60 fps | Visual check + FPS |
| R13 | Stellarium-style navigation (team spec) | Rotate around center, move tool, return home, set-as-new coordinate, zoom buttons | Try each tool |
| R14 | Time slider & playback (team spec) | Slider with visit ticks, play/stop, speed, moving markers | Play on Barnard's Star |
| R15 | Object info (team spec) | Click → Stellarium-style popup with distance in light-years, other names, Favourite/Select | Click 3 stars |
| R16 | Performance & data size | Lighthouse ≥ 85, budgets met, no freezes, stale requests cancelled | Lighthouse, DevTools |
| R17 | Reliability | Demo mode, friendly errors, server wake-up handling | Stop backend, reload |
| R18 | Design & accessibility | 3 fonts, night-sky + white + teal, WiseView-like panel, WCAG AA, shortcuts, tooltips | Manual pass |
| R19 | NASA/partner data, credited | Footer + README credits with DOIs | Read footer |

---

## 14. Future pages ("#" sections in the document) — hooks only, do not build
- **#Account:** create an account; a "Favorites" tab for saved celestial objects. *Hook:* `store.js` keeps favourites/selection in one module with a simple interface (`list`, `add`, `remove`), so it can later sync to an account backend. Header counters already exist.
- **#Categories/Search:** search by category (meteor, comet, asteroid, brown dwarf…); filter by distance in light-years, luminosity, etc. *Hook:* `/api/object` already returns type and distance; keep `api.js` as the single place for backend calls.
- **#3D Time Machine view:** put objects from "Select" into a 3D scene; a bottom time scroller or linear playback into the past and future (up to ~400,000 years, or whatever is accurate per object); a realistic, optimized 3D Earth; zoom out to see all selected objects; draw coloured, labelled, selectable orbital paths with a legend; say "not enough data" or "moving in a straight line" when no orbit can be computed; Kepler-based orbital motion; click objects for distance and data; pan/zoom; show only selected and nearby objects. *Hooks:* reuse `earth.js` and the star shader from the title page (keep them generic and importable); `motion.py` (proper-motion propagation) is the start of the motion engine; the Select list is the input.
- **#Specific objects view:** detailed object page in a Zooniverse-style layout; overlapped and raw SPHEREx images at original resolution; zoom, invert colours, animation, every SPHEREx photo of the object; WISE counterpart photos; metadata, distance, orbital info, mass, luminosity, velocity, temperature, all names; Favourite and Select. *Hooks:* make the Frame Player, charts and panels reusable modules with no page-specific globals; `/api/frames` with `mode=exposure` already returns "all photos"; `/api/object` returns names and distance.
- Add disabled "Coming soon" cards on the title page for Time Machine and Object Profiles.

---

## 15. Working rules for Claude Code
1. Follow the phases. Stop after each one and wait for "go".
2. **Verify, don't guess:** collection names, column names, flag names, HiPS IDs and Aladin API methods must come from live responses or official docs. Record sources in `docs/DATA_NOTES.md`.
3. Commit after each phase with clear messages on `feature/title-and-stellar-view`. **Ask before pushing.** Never force-push `main`.
4. Readable code for beginners: short files, comments that explain *why*, JSDoc on public functions.
5. If reality differs from this plan (renamed services, new releases, a library's API), adapt sensibly, note it in `docs/DATA_NOTES.md`, and tell the user in plain language.
6. Licenses and credits: use the team's logos as provided; NASA Earth imagery and mission data with credit; no Zooniverse/WiseView/NASA logos as our branding; all other artwork original.
7. Every science control gets a one-sentence plain-language tooltip.
8. Each report back includes: what was built, exact PowerShell commands to run it, what the user should see, known issues, and what the next phase does.
