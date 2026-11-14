"""The API the website talks to. Phase 1: just "are you awake?" and the settings file.

Run locally (from the backend folder):  uvicorn app.main:app --reload --port 8000
"""
import json
from functools import lru_cache

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .settings import settings

app = FastAPI(title="SPHEREx Xplorer API", version=__version__)

# Browsers block calls to another website unless that website says it's allowed (CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@lru_cache
def load_datasets() -> dict:
    """Read config/datasets.json once; restart the server after editing it."""
    return json.loads(settings.datasets_path.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    """The website calls this to choose between live data and demo mode."""
    return {
        "status": "ok",
        "version": __version__,
        "releases": load_datasets()["default_releases"],
    }


@app.get("/api/config")
def config() -> dict:
    """The shared settings file, so the website and server always agree."""
    return load_datasets()
