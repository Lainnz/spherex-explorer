# SPHEREx Xplorer

A local website for exploring real observations from NASA's SPHEREx mission:
a cinematic landing page with a 3D Earth, and a Stellar View page with a sky
viewer, real SPHEREx images, a time machine, image comparison, object
identification, spectra and all-sky false-colour maps.

Everything runs on your own laptop. Nothing is deployed.

## Start it (two windows)

**1. Data server (backend), Anaconda Prompt:**

```
cd D:\Projects\SPHEREx-Xplorer\backend
conda activate spherex
uvicorn app.main:app --reload --port 8000
```

Check it at http://localhost:8000/api/health.

**2. Website (frontend), PowerShell:**

```
cd D:\Projects\SPHEREx-Xplorer\frontend
npm.cmd run dev
```

Open http://localhost:3000.

Stop either one with **Ctrl + C**.

## Demo script (about 5 minutes)

1. **Landing page.** The Earth, Moon, stars and comets are artistic effects (see the footer). Press **Random Explore** or **Explore** to fly up into the sky.
2. **Orion Nebula:** `/explore?ra=83.82&dec=-5.39&fov=2.5`
   - Background menu → **SPHEREx all-sky mosaic · one wavelength**. Slide from 0.75 to 5 µm.
   - Background menu → **SPHEREx false colour** → *Organic molecules (PAH)*.
3. **Crab Nebula:** `/explore?ra=83.633&dec=22.014`
   - SPHEREx panel → **Show on the sky map** (a real 6″-pixel observation).
   - **Compare** tab: two dates at the same wavelength (September 2025 vs March 2026).
4. **North Ecliptic Pole:** `/explore?ra=270&dec=66.56`. Open the **Time machine** tab: 14–15 visits per detector.
5. **Spectrum.** Click a star → **SPHEREx spectrum of this source**. The first run takes about 20–60 s, then it is cached.

## Where the data comes from

- **SPHEREx images:** NASA/IPAC IRSA, SPHEREx DR1 (SIA service and cutouts).
- **All-sky mosaic:** the IRSA SPHEREx DR1 HiPS cube.
- **Catalogues:** SIMBAD (CfA mirror), Gaia DR3 (ESA), AllWISE (NOIRLab Data Lab).
- **Reference background maps:** 2MASS, AllWISE and DSS (CDS HiPS, IRSA mirror).

Spectra are this project's own aperture photometry, not the official IRSA
Spectrophotometry Tool. The page explains the method and its limits.
Downloaded data is cached in `backend\cache`. It is safe to delete; it
will be fetched again.
