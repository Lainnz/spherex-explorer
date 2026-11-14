"""Read the shared settings files in config/ (once; restart the server after editing)."""
import json
from functools import lru_cache

from .settings import settings


@lru_cache
def load_datasets() -> dict:
    """config/datasets.json: releases, sky maps and limits."""
    return json.loads(settings.datasets_path.read_text(encoding="utf-8"))


@lru_cache
def load_targets() -> dict:
    """config/targets.json: featured targets and "interesting" spots (made by scripts/resolve_targets.py)."""
    if not settings.targets_path.exists():
        return {"targets": [], "interesting": []}
    return json.loads(settings.targets_path.read_text(encoding="utf-8"))
