# Credits

## Data
- **SPHEREx** (NASA/JPL-Caltech), via the NASA/IPAC Infrared Science Archive (IRSA):
  DR1 Spectral Images [doi:10.26131/IRSA678](https://doi.org/10.26131/IRSA678), DR1 Spectral
  All-Sky Cube [doi:10.26131/IRSA679](https://doi.org/10.26131/IRSA679), Quick Release 3
  [doi:10.26131/IRSA662](https://doi.org/10.26131/IRSA662). Acknowledgement text: see README.
- **Gaia DR3** (ESA/Gaia/DPAC): background stars on the title page
  (`scripts/build_starfield.py`) and click-to-identify.
- **SIMBAD** (CDS, Strasbourg; Harvard mirror): names, object types, the brightest stars
  missing from Gaia, featured-target positions and motions.
- **WISE / AllWISE / unWISE** (NASA), **2MASS**: sky maps (Stellar View, later phases).

## Earth images (title page), NASA Earth Observatory
Made into WebP textures by `scripts/build_textures.py` (2048×1024 and 1024×512). Downloaded
2026-11-14 from `assets.science.nasa.gov` after Visible Earth moved to science.nasa.gov:
- **Day:** Blue Marble Next Generation, January 2004, base map (Reto Stöckli, NASA Earth
  Observatory), `bmng-base/january/world.200401.3x5400x2700.jpg`
- **Night lights:** Black Marble 2016, 0.1° global map (NASA Earth Observatory, Suomi NPP
  VIIRS data), `imagerecords/144000/144898/BlackMarble_2016_01deg.jpg`,
  from https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps
- **Clouds:** The Blue Marble (2002) cloud layer (Terra MODIS),
  `content-feature/bluemarble/images/cloud_combined_2048.jpg`, from
  https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/

NASA images are generally not copyrighted; NASA Earth Observatory asks to be credited.

## Software and assets
- three.js (MIT), Lucide icons (ISC), Vite and Vitest (MIT)
- Astropy, astroquery, pyvo, reproject, NumPy, FastAPI, Pillow (BSD/MIT-style licences)
- Fonts: Orbitron, Exo 2, JetBrains Mono (SIL Open Font License), via Fontsource
- Aladin Lite (CDS; Stellar View, later phases)

## Branding
SPHEREx Xplorer logos by the team (`brand/`). The title-page spacecraft is an original
low-poly model loosely inspired by the logo's silhouette. No NASA, Zooniverse or WiseView
logos are used as our branding.
