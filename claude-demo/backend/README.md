# SPHEREx Xplorer — backend

A small Python server that finds and prepares **real SPHEREx observations** from
NASA/IPAC IRSA for the website.

## One-time setup (PowerShell)

```powershell
cd D:\Projects\SPHEREx-Xplorer\backend
conda create -n spherex python=3.12 -y
conda activate spherex
pip install -r requirements.txt
```

## Run it (every time)

```powershell
cd D:\Projects\SPHEREx-Xplorer\backend
conda activate spherex
uvicorn app.main:app --reload --port 8000
```

Keep this window open. The website (port 3000) needs it for SPHEREx data.

- Check it works: http://localhost:8000/api/health
- Interactive list of endpoints: http://localhost:8000/docs

## Endpoints

| Address | What it does |
|---|---|
| `/api/spherex/observations?ra=..&dec=..` | Lists SPHEREx images covering a position (IRSA SIA2 search) |
| `/api/spherex/cutout?access_url=..&ra=..&dec=..&size=0.1` | Downloads a small cutout, reads it with Astropy, returns details |
| `/api/spherex/display/<key>.fits` | Display-ready FITS made from a cutout |

## Files

- `app/main.py` — the web server and its endpoints
- `app/irsa.py` — talks to the IRSA archive (search + cutout download)
- `app/spherex_image.py` — reads the FITS cutout with Astropy
- `app/config.py` — settings (allowed collections, cache folder, limits)
- `cache/` — downloaded files (created automatically; safe to delete)

## Data credit

SPHEREx data: NASA/IPAC Infrared Science Archive (IRSA), Caltech/JPL.
