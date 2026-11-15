"""Phase 2 check: how many SPHEREx images each featured target has, in how many visits,
and where a moving target was predicted to be. Also shows 5 Randomize picks.

Run from the repo root (with the .venv active):  python scripts/observation_report.py
The first run asks IRSA live and can take 5-15 minutes; later runs use the cache.
"""
import asyncio
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import load_datasets, load_targets  # noqa: E402
from app.irsa import IrsaUnavailable  # noqa: E402
from app.observations import find_observations  # noqa: E402
from app.random_target import random_target  # noqa: E402


async def report_target(target: dict, datasets: dict) -> str:
    start = time.time()
    try:
        result = await find_observations(
            ra=target["ra"], dec=target["dec"], fov_arcsec=target["demo"]["fov_arcsec"],
            release_ids=datasets["default_releases"], detectors=[1, 2, 3, 4, 5, 6],
            tmin_mjd=None, tmax_mjd=None, max_images=10**6, motion=target["motion"], datasets=datasets,
        )
    except IrsaUnavailable as error:
        return f"{target['name']:15} IRSA unavailable: {error}"
    obs = result["observations"]
    if not obs:
        return f"{target['name']:15} no images ({time.time() - start:.0f} s)"
    per_release = {r: sum(o["release"] == r for o in obs) for r in datasets["default_releases"]}
    per_survey = {s: sum(o["survey"] == s for o in obs) for s in ("wide", "deep")}
    first, last = obs[0], obs[-1]
    moved = math.hypot(
        (last["target_ra"] - first["target_ra"]) * math.cos(math.radians(first["target_dec"])),
        last["target_dec"] - first["target_dec"],
    ) * 3600
    lines = [
        f"{target['name']:15} {len(obs):5d} images  {per_release}  {per_survey}  "
        f"{len(result['visits'])} visits  {first['t_mid_date']} → {last['t_mid_date']}  "
        f"({time.time() - start:.0f} s)",
        f"{'':15} predicted position: ({first['target_ra']:.5f}, {first['target_dec']:+.5f}) → "
        f"({last['target_ra']:.5f}, {last['target_dec']:+.5f})  moved {moved:.1f}″",
    ]
    lines += [f"{'':15}   {v['label']}  ({v['n_images']} images)" for v in result["visits"]]
    return "\n".join(lines)


async def main() -> None:
    datasets, targets = load_datasets(), load_targets()
    print("Featured targets (DR1 + QR3, wide + deep, all detectors):\n")
    reports = await asyncio.gather(*(report_target(t, datasets) for t in targets["targets"]))
    print("\n".join(reports))

    print("\n5 Randomize picks:")
    default_fov = datasets["limits"]["default_fov_arcsec"]
    for _ in range(5):
        pick = random_target(targets["interesting"], targets["targets"], default_fov)
        print(f"  ra={pick['ra']:9.4f} dec={pick['dec']:+8.4f} fov={pick['fov_arcsec']}″  "
              f"{pick['source']}{': ' + pick['name'] if pick['name'] else ''}")


if __name__ == "__main__":
    # Windows PowerShell's default text encoding can't print → or ″.
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
