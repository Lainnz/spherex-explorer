# spherex-explorer
An interative web platform that uses NASA SphereX data to explore astronomical objects, and visualize how the universe changes over time
<img width="1254" height="1254" alt="image" src="https://github.com/user-attachments/assets/0886404a-8634-43a4-9884-5b5392d94e5b" />

## What it does
**SPHEREx Xplorer** shows NASA SPHEREx infrared images of any patch of sky. Type a
star name or coordinates and the images play like a short video, so moving and
changing objects stand out. Built for the NASA Space Apps "SPHEREx Open Data" challenge.

> 🚧 Under construction. See [PLAN.md](PLAN.md) for the full build plan,
> [docs/DATA_NOTES.md](docs/DATA_NOTES.md) for what we learned about the data, and
> [docs/INTEGRATION.md](docs/INTEGRATION.md) for how Elaine's and Alice's demos are combined.

## Run it on your computer (Windows 11, PowerShell)
You need Node.js, Python 3.12 and Git (see PLAN.md, Part 1).

**Website** (first time: `npm install`):
```
cd frontend
npm install
npm run dev
```
Then open http://localhost:5173/spherex-explorer/

**Data server** (in a second PowerShell window):
```
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements-dev.txt
cd backend
uvicorn app.main:app --reload --port 8000
```
Check it at http://127.0.0.1:8000/api/health

**Tests:** `npm test` (in `frontend`) and `python -m pytest` (in `backend`).

**Demo data** (saved results for the five featured targets, used when the data server is
asleep) lives in `frontend/public/data/demo/`. To refresh it from NASA's archive (with the
`.venv` turned on, from the project folder):
```
python scripts\build_demo_data.py
```

## Project layout
| Folder | What's inside |
|---|---|
| `frontend/` | The website (Vite, plain JavaScript): title page + Stellar View |
| `backend/` | The data server (Python, FastAPI, Astropy) |
| `backend/app/skytools/` | Elaine's sky tools: SPHEREx false-colour map, timelines, comparisons, spectra, catalogue overlays |
| `claude-demo/` | Elaine's original demo, kept for reference until everything is ported (Milestone 2) |
| `config/datasets.json` | Which SPHEREx releases and sky maps to use (one file to update) |
| `brand/` | Team logos (originals; web copies are made by `scripts/build_brand.py`) |
| `docs/` | Notes on the data, deployment and updates |
| `scripts/` | Helper scripts (logos, demo data, release checks) |

## Data and credits
This publication makes use of data products from the Spectro-Photometer for the History
of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint
project of the Jet Propulsion Laboratory and the California Institute of Technology, and
is funded by the National Aeronautics and Space Administration.

- SPHEREx DR1 Spectral Images: [doi:10.26131/IRSA678](https://doi.org/10.26131/IRSA678)
- SPHEREx DR1 Spectral All-Sky Cube: [doi:10.26131/IRSA679](https://doi.org/10.26131/IRSA679)
- SPHEREx Quick Release 3: [doi:10.26131/IRSA662](https://doi.org/10.26131/IRSA662)
- Data served by the NASA/IPAC Infrared Science Archive (IRSA).
- Gaia DR3 (ESA), WISE / AllWISE / unWISE (NASA), 2MASS.
- Sky viewer: [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) and SIMBAD, CDS, Strasbourg.
- Analysis: [Astropy](https://www.astropy.org/), astroquery, pyvo, reproject.
- Fonts: Orbitron, Exo 2, JetBrains Mono (SIL Open Font License).
