"""Download NASA Earth images once and make small WebP textures for the title-page globe.

Run from the repo root (with the .venv active):  python scripts/build_textures.py
Output: frontend/public/textures/ (2048×1024 for desktop, 1024×512 for phones).
Sources and credits are listed in docs/CREDITS.md. All are NASA images (public domain);
NASA Earth Observatory asks to be credited.
"""
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "scripts" / "scratch" / "textures-src"  # git-ignored download cache
OUT = ROOT / "frontend" / "public" / "textures"
ASSETS = "https://assets.science.nasa.gov/content/dam/science/esd/eo"
# Found on 2026-11-14 (Visible Earth moved to science.nasa.gov; see docs/CREDITS.md).
SOURCES = {
    "earth-day": f"{ASSETS}/images/bmng/bmng-base/january/world.200401.3x5400x2700.jpg",
    "earth-night": f"{ASSETS}/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg",
    "clouds": f"{ASSETS}/content-feature/bluemarble/images/cloud_combined_2048.jpg",
}
SIZES = {"2048": (2048, 1024), "1024": (1024, 512)}
BUDGET_BYTES = {"2048": 1_500_000, "1024": 500_000}  # PLAN.md §9.1, per set of three


def download(name: str, url: str) -> Image.Image:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    path = SOURCE_DIR / Path(url).name
    if not path.exists():
        print(f"Downloading {name} …", flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "spherex-xplorer/0.1"})
        with urllib.request.urlopen(request, timeout=300) as response:
            path.write_bytes(response.read())
    image = Image.open(path)
    image.load()
    return image


def encode(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    originals = {}
    for name, url in SOURCES.items():
        image = download(name, url)
        # Clouds only need brightness; the others are colour.
        originals[name] = image.convert("L" if name == "clouds" else "RGB")
        print(f"{name}: {image.size[0]}×{image.size[1]} from {url}")

    for label, size in SIZES.items():
        resized = {name: image.resize(size, Image.LANCZOS) for name, image in originals.items()}
        # Lower the quality step by step until the set fits its budget.
        for quality in range(85, 40, -5):
            encoded = {name: encode(image, quality) for name, image in resized.items()}
            total = sum(len(data) for data in encoded.values())
            if total <= BUDGET_BYTES[label]:
                break
        else:
            sys.exit(f"{label} textures don't fit in {BUDGET_BYTES[label]} bytes even at low quality")
        for name, data in encoded.items():
            (OUT / f"{name}-{label}.webp").write_bytes(data)
        sizes = ", ".join(f"{name} {len(data) / 1024:.0f} KB" for name, data in encoded.items())
        print(f"{label}: quality {quality}, total {total / 1024:.0f} KB ({sizes})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # Windows PowerShell can't print × otherwise
    main()
