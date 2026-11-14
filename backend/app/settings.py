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
    # SPHEREx searches at IRSA took 2.5-3 minutes on 2026-11-14 (docs/DATA_NOTES.md).
    irsa_timeout_s: float = 300
    # SIMBAD mirrors to try in order (Strasbourg was down on 2026-11-14; Harvard worked).
    simbad_servers: str = "simbad.cds.unistra.fr,simbad.harvard.edu"
    # The shared settings files, also read by the website.
    datasets_path: Path = REPO_ROOT / "config" / "datasets.json"
    targets_path: Path = REPO_ROOT / "config" / "targets.json"

    @property
    def origins(self) -> list[str]:
        return _split(self.allowed_origins)

    @property
    def simbad_server_list(self) -> list[str]:
        return _split(self.simbad_servers)


def _split(text: str) -> list[str]:
    return [part.strip() for part in text.split(",") if part.strip()]


settings = Settings()
