"""Settings for the SPHEREx Xplorer backend, all in one place."""

from pathlib import Path

# Where downloaded and processed files are stored, so we never download the
# same cutout twice. (Safe to delete; it will be rebuilt.)
# backend/cache/skytools (inside the backend cache folder, which git ignores)
CACHE_DIR = Path(__file__).resolve().parents[2] / "cache" / "skytools"

# Which websites may call the API is set once for the whole server, in app/settings.py.

# --- NASA/IPAC IRSA (official, documented endpoints) ---------------------
# SIA2 image search: https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access
IRSA_SIA_URL = "https://irsa.ipac.caltech.edu/SIA"

# Only these SPHEREx collections may be searched (documented SIA2 collections).
COLLECTIONS = {
    "spherex_dr1": "SPHEREx Data Release 1 — Wide Survey",
    "spherex_dr1_deep": "SPHEREx Data Release 1 — Deep Survey",
    "spherex_qr3": "SPHEREx Quick Release 3 — Wide Survey",
    "spherex_qr3_deep": "SPHEREx Quick Release 3 — Deep Survey",
}
DEFAULT_COLLECTION = "spherex_dr1"

# Cutouts are requested by adding ?center=RA,DEC&size=DEG to an image's
# access URL. We only ever download from IRSA's SPHEREx data area.
ALLOWED_DATA_PREFIX = "https://irsa.ipac.caltech.edu/ibe/data/spherex/"

# Cutout size limits in degrees (small = fast; 1° ≈ 585 SPHEREx pixels across)
MIN_CUTOUT_DEG = 0.02
MAX_CUTOUT_DEG = 1.0

# Network timeouts in seconds
HTTP_TIMEOUT = 90.0

# How long to reuse a cached archive search (seconds)
SEARCH_CACHE_SECONDS = 24 * 3600

# FITS mask planes treated as "bad pixel, don't show". Names are read from
# each file's own FLAGS header (MSKNnnnn / MSKMnnnn keywords).
BAD_FLAG_NAMES = {"OVERFLOW", "SUR_ERROR", "NONFUNC", "MISSING_DATA", "HOT", "COLD"}

# Optional display smoothing: upsample factor (display only, no new detail)
SMOOTH_FACTOR = 4

# Image comparison: extra uncertainty, as a fraction of the local brightness,
# for effects pixel noise doesn't capture (undersampled stars, PSF differences,
# sub-pixel alignment). Stops every bright star from looking "significant".
SYSTEMATIC_FRACTION = 0.10
