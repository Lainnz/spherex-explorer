"""Server settings, read from environment variables (PLAN.md §7.1).

Every setting has a sensible default, so the server runs locally with no setup.
On Hugging Face Spaces they are set in the Space's "Variables" page.
"""
from pathlib import Path

from pydantic_settings import BaseSettings

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # Comma-separated list of websites allowed to call this API from a browser.
    allowed_origins: str = "https://lainnz.github.io,http://localhost:5173,http://127.0.0.1:5173"
    cache_dir: Path = REPO_ROOT / "backend" / "cache"
    cache_max_gb: float = 5
    irsa_concurrency: int = 6
    max_fov_arcsec: float = 3600
    max_images: int = 80
    # The shared settings file, also read by the website.
    datasets_path: Path = REPO_ROOT / "config" / "datasets.json"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
