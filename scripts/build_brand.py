"""Make web-sized copies of the team logos and the browser-tab icons (favicons).

The originals in brand/ are never changed. Output goes to frontend/public/brand/.
Run from the repo root:  python scripts/build_brand.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "brand"
OUT = ROOT / "frontend" / "public" / "brand"

# Light rounded tile behind the navy icon, so it shows up on dark browser tabs too.
TILE_COLOUR = (245, 247, 250, 255)  # --light-surface #F5F7FA
# The spacecraft drawing sits above the "SPHEREx Xplorer" text in the stacked logo.
ICON_BOTTOM_FRACTION = 0.70


def resize_to_width(img: Image.Image, width: int) -> Image.Image:
    height = round(img.height * width / img.width)
    return img.resize((width, height), Image.LANCZOS)


def save_logo(name: str, width: int) -> None:
    """WebP for modern browsers, PNG as a fallback."""
    small = resize_to_width(Image.open(SRC / f"{name}.png").convert("RGBA"), width)
    small.save(OUT / f"{name}.webp", quality=90, method=6)
    small.save(OUT / f"{name}.png", optimize=True)


def make_icon_tile(size: int) -> Image.Image:
    """The spacecraft from the navy logo on a light rounded square."""
    logo = Image.open(SRC / "logo-stacked-navy.png").convert("RGBA")
    top = logo.crop((0, 0, logo.width, int(logo.height * ICON_BOTTOM_FRACTION)))
    icon = top.crop(top.getchannel("A").getbbox())

    big = 1024  # draw large, then shrink, for smooth edges
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, big - 1, big - 1), radius=big // 5, fill=TILE_COLOUR)
    inner = int(big * 0.82)
    scale = inner / max(icon.size)
    icon = icon.resize((round(icon.width * scale), round(icon.height * scale)), Image.LANCZOS)
    tile.alpha_composite(icon, ((big - icon.width) // 2, (big - icon.height) // 2))
    return tile.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save_logo("logo-horizontal-white", 1600)  # shown up to ~800 px wide, sharp on 2x screens
    save_logo("logo-stacked-navy", 800)

    tile = make_icon_tile(512)
    tile.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    tile.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)
    tile.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)
    tile.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    tile.save(OUT / "icon-512.png", optimize=True)

    for path in sorted(OUT.iterdir()):
        print(f"{path.name:32} {path.stat().st_size / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
