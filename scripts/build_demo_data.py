"""Save everything the website needs for the featured targets, so it works without the
data server (demo mode, PLAN.md §8.6).

It calls the real API in-process and stores its answers unchanged, so demo data has
exactly the same shape as live data. Only the picture links are rewritten to point at
saved files. Output: frontend/public/data/demo/<slug>/ and demo/index.json.

Run from the repo root (with the .venv active):  python scripts/build_demo_data.py [slug ...]
The first run downloads cutouts from IRSA; later runs reuse the cache.
"""
import json
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient  # noqa: E402

from app.config import load_targets  # noqa: E402
from app.main import app  # noqa: E402

DEMO = ROOT / "frontend" / "public" / "data" / "demo"
BUDGET_MB = 25
FORMAT_VERSION = 1
# Detectors where each target shows up well (see docs/images/phase3) and how many images
# to combine. The photometry uses every detector.
SETTINGS = {
    "barnards-star": {"detectors": [1, 2, 3], "max_images": 80},
    "eps-indi-b": {"detectors": [2, 5, 6], "max_images": 80},
    "wise-0855": {"detectors": [5, 6], "max_images": 80},
    "rw-aurigae": {"detectors": [1, 2, 3], "max_images": 60},
    "r-draconis": {"detectors": [1, 2, 3], "max_images": 60},
}
PHOTOMETRY_IMAGES = 60
# IRSA sometimes fails for a while; retry a target whose frames lost too many images.
MAX_FAILED_SHARE = 0.10
ATTEMPTS = 3

client = TestClient(app)


def stream(path: str, body: dict) -> list[dict]:
    """POST to a streaming (NDJSON) endpoint and return every message."""
    response = client.post(path, json=body)
    response.raise_for_status()
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def get_json(path: str, params: dict) -> dict:
    response = client.get(path, params=params)
    response.raise_for_status()
    return response.json()


def save(path: Path, content: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path.name


def build_target(target: dict) -> dict:
    """Build into a temporary folder and only replace the saved data if everything worked:
    on 2026-11-15 an IRSA error halfway through left WISE 0855's demo data half-deleted."""
    slug = target["slug"]
    final = DEMO / slug
    building = DEMO / f".{slug}.building"
    shutil.rmtree(building, ignore_errors=True)
    try:
        result = build_into(target, building)
    except BaseException:
        shutil.rmtree(building, ignore_errors=True)
        raise
    shutil.rmtree(final, ignore_errors=True)
    building.rename(final)
    return result


def build_into(target: dict, folder: Path) -> dict:
    slug, settings = target["slug"], SETTINGS[target["slug"]]
    fov = target["demo"]["fov_arcsec"]
    query = {"target": slug, "fov_arcsec": fov, "detectors": settings["detectors"],
             "max_images": settings["max_images"], "mode": "epoch"}
    print(f"{target['name']}: frames…", flush=True)

    # 1. The time-slider frames, plus their pictures, raw numbers and FITS files.
    #    Successful downloads are cached, so a retry only re-fetches the failed ones.
    for attempt in range(1, ATTEMPTS + 1):
        frames_stream = stream("/api/frames", query)
        failed, total = frames_stream[-1].get("images_failed", 0), frames_stream[0]["images_total"]
        if failed <= MAX_FAILED_SHARE * total:
            break
        print(f"  attempt {attempt}: {failed} of {total} images failed "
              f"({frames_stream[-1].get('failure_reasons')}); retrying…", flush=True)
    else:
        raise SystemExit(f"{target['name']}: too many images failed; IRSA may be down. Try again later.")
    for message in frames_stream:
        if message["type"] == "error":
            raise SystemExit(f"{target['name']}: {message['message']}")
        if message["type"] != "frame":
            continue
        frame_id = message["frame_id"]
        for key, extension in (("png_url", "png"), ("f32_url", "f32"), ("fits_url", "fits")):
            response = client.get(message[key])
            response.raise_for_status()
            message[key] = "frames/" + save(folder / "frames" / f"{frame_id}.{extension}", response.content)
    frames = [m for m in frames_stream if m["type"] == "frame"]
    start = frames_stream[0]

    # 2. The image list (same search as the frames).
    observations = get_json("/api/observations", {
        "target": slug, "fov": fov, "detectors": ",".join(map(str, settings["detectors"])),
        "max_images": settings["max_images"],
    })

    # 3. Photometry over all detectors: spectrum and light curve.
    print(f"{target['name']}: photometry…", flush=True)
    photometry_stream = stream("/api/photometry", {
        "target": slug, "fov_arcsec": fov, "max_images": PHOTOMETRY_IMAGES,
    })

    # 4. Flags and details (Info and Flags tabs) for the first image of every frame, with
    #    the flag-overlay masks that actually have pixels.
    grid = start["grid"]
    flags_by_image, meta_by_image = {}, {}
    for frame in frames:
        if len(frame["detectors"]) != 1 or not frame.get("obs_ids"):
            continue
        obs_id, detector = frame["obs_ids"][0], frame["detectors"][0]
        image_key = f"{obs_id}:D{detector}"
        if image_key in flags_by_image:
            continue
        image_params = {"detector": detector, "ra": grid["ra"], "dec": grid["dec"], "fov_arcsec": fov}
        try:
            flags = get_json(f"/api/flags/{obs_id}", image_params)
            meta = get_json(f"/api/meta/{obs_id}", image_params)
        except Exception as error:  # IRSA trouble for this image: the frame still works
            print(f"  no details for {image_key}: {error}", flush=True)
            continue
        for flag in flags["flags"]:
            mask_url, flag["mask_url"] = flag["mask_url"], None
            if flag["percent_of_pixels"] <= 0:
                continue
            response = client.get(mask_url)
            if response.status_code == 200:
                name = f"{obs_id}_D{detector}_{flag['name']}.png"
                flag["mask_url"] = "flags/" + save(folder / "flags" / name, response.content)
        flags_by_image[image_key] = flags
        meta_by_image[image_key] = meta

    # 4b. Fast-moving Gaia stars for the time slider's markers (none is fine).
    try:
        movers = get_json("/api/movers", {"ra": target["ra"], "dec": target["dec"],
                                          "radius": min(0.5, max(0.02, fov / 3600 * 0.75))})["movers"]
    except Exception:
        movers = []

    # 5. The click-to-identify answer for the target itself, at the middle of the images' dates.
    middle = frames[len(frames) // 2]
    ra, dec = middle_position(observations, middle["t_mid"])
    object_info = get_json("/api/object", {"ra": ra, "dec": dec, "radius": 10,
                                           "epoch": f"{middle['t_mid']:.4f}"})

    manifest = {
        "format_version": FORMAT_VERSION,
        "built": date.today().isoformat(),
        "slug": slug,
        "name": target["name"],
        "target": target,
        "query": query,
        "observations": observations,
        "frames_stream": frames_stream,
        "photometry_stream": photometry_stream,
        "flags": flags_by_image,
        "meta": meta_by_image,
        "movers": movers,
        "objects": [object_info],
        "notes": demo_notes(photometry_stream),
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
    points = [m for m in photometry_stream if m["type"] == "point"]
    print(f"{target['name']}: {len(frames)} frames, {len(points)} photometry points, "
          f"{size / 1e6:.2f} MB", flush=True)
    return {"slug": slug, "name": target["name"], "frames": len(frames), "size_mb": round(size / 1e6, 2)}


def middle_position(observations: dict, t_mid: float) -> tuple[float, float]:
    """The target's predicted position in the image closest to `t_mid`."""
    nearest = min(observations["observations"], key=lambda o: abs(o["t_mid"] - t_mid))
    return nearest["target_ra"], nearest["target_dec"]


def demo_notes(photometry_stream: list[dict]) -> list[str]:
    """Plain-language caveats to show with this target's saved data."""
    notes = []
    done = photometry_stream[-1]
    if done.get("warning"):
        notes.append(done["warning"])
    return notes


def main(slugs: list[str]) -> None:
    targets = [t for t in load_targets()["targets"] if not slugs or t["slug"] in slugs]
    DEMO.mkdir(parents=True, exist_ok=True)
    built = [build_target(target) for target in targets]

    index_path = DEMO / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"targets": []}
    by_slug = {entry["slug"]: entry for entry in index["targets"]}
    by_slug.update({entry["slug"]: entry for entry in built})
    index = {
        "format_version": FORMAT_VERSION,
        "built": date.today().isoformat(),
        "note": "Saved SPHEREx data for the featured targets, used when the live data server is unavailable.",
        "targets": [by_slug[t["slug"]] for t in load_targets()["targets"] if t["slug"] in by_slug],
    }
    index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")

    total = sum(f.stat().st_size for f in DEMO.rglob("*") if f.is_file()) / 1e6
    print(f"\nDemo data: {total:.2f} MB in {DEMO.relative_to(ROOT)} (budget {BUDGET_MB} MB)")
    if total > BUDGET_MB:
        raise SystemExit("Over budget: lower max_images or the number of detectors in SETTINGS.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
