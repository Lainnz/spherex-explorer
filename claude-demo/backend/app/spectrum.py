"""A SPHEREx spectrum at one sky position, by aperture photometry.

Every pixel of a SPHEREx image sees a slightly different wavelength, so
measuring a source's brightness in each image that covers it gives one point
of its spectrum. This is how the official IRSA Spectrophotometry Tool works too
(it uses forced PSF fitting with The Tractor); that tool has no programming
interface, so SPHEREx Xplorer makes its own, simpler measurement:

  aperture photometry, radius 2 pixels (12.3"), background = sigma-clipped
  median of an annulus 4-7 pixels, zodiacal-light model subtracted,
  quality-flagged pixels excluded, uncertainty from the VARIANCE layer.

To avoid downloading 65 MB per image we read only what we need from each file
with HTTP range requests (IRSA supports several ranges per request):
  * the IMAGE, VARIANCE and ZODI headers, to find where each layer starts,
  * the 15x15 pixel box around the target in IMAGE, VARIANCE and ZODI,
  * the FLAGS rows for that box (stored Rice-compressed, one tile per row),
    decoded with Astropy's own Rice decoder.

Known limits (reported to the user): no aperture correction (PSF wings outside
2 px are missed, so point-source fluxes are somewhat underestimated); blended
neighbours inside 12" contribute; extended sources (nebulae, galaxies) give the
flux inside the aperture only.
"""

import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area

from . import config
from .spherex_image import _flag_definitions
from .spherex_timeline import BLOCK, HEAD_BYTES, _find_hdu, _header_from_bytes, wavelength_at_target

HALF = 7  # box half-size in pixels (15 x 15 box)
R_APERTURE = 2.0  # pixels
R_ANNULUS = (4.0, 7.0)  # pixels
MAX_MASKED_IN_APERTURE = 0.25
MAX_OBSERVATIONS = 360  # per spectrum; more are evenly sub-sampled per detector


def rice_decode(data: bytes, count: int, stop: int | None = None, blocksize: int = 32) -> np.ndarray:
    """Decode one Rice-compressed tile of 32-bit integers (the FITS RICE_1 scheme).

    Written here (instead of calling Astropy's private decoder, whose location
    changes between versions) and checked against a row of a real SPHEREx
    FLAGS layer. `stop` ends decoding early once that many pixels are known;
    we only need the pixels up to the right edge of our little box.
    """
    fsbits, fsmax = 5, 25
    stop = count if stop is None else min(stop, count)
    bits = "".join(format(b, "08b") for b in data[4:])
    out = np.zeros(stop, dtype=np.int64)
    last = int.from_bytes(data[:4], "big", signed=True)
    pos, i = 0, 0
    while i < stop:
        fs = int(bits[pos : pos + fsbits], 2) - 1
        pos += fsbits
        end = min(i + blocksize, count)
        if fs < 0:  # a block with no change
            for j in range(i, min(end, stop)):
                out[j] = last
            i = end
            continue
        while i < end:
            if fs == fsmax:  # high-entropy block: differences stored raw
                diff = int(bits[pos : pos + 32], 2)
                pos += 32
            else:
                one = bits.index("1", pos)
                diff = ((one - pos) << fs) | (int(bits[one + 1 : one + 1 + fs], 2) if fs else 0)
                pos = one + 1 + fs
            diff = diff >> 1 if diff & 1 == 0 else ~(diff >> 1)
            last = (last + diff + 2**31) % 2**32 - 2**31  # 32-bit wrap-around
            if i < stop:
                out[i] = last
            i += 1
            if i >= stop:
                return out
    return out


def _pad(n: int) -> int:
    return -(-n // BLOCK) * BLOCK


def _range(client: httpx.Client, url: str, start: int, length: int) -> bytes:
    response = client.get(url, headers={"Range": f"bytes={start}-{start + length - 1}"}, timeout=config.HTTP_TIMEOUT)
    response.raise_for_status()
    return response.content


def _multi_range(client: httpx.Client, url: str, ranges: list[tuple[int, int]]) -> list[bytes]:
    """Fetch several byte ranges (start, end inclusive) in ONE request; returns them in order."""
    header = "bytes=" + ",".join(f"{a}-{b}" for a, b in ranges)
    response = client.get(url, headers={"Range": header}, timeout=config.HTTP_TIMEOUT)
    response.raise_for_status()
    ctype = response.headers.get("content-type", "")
    body = response.content
    parts: list[tuple[int, bytes]] = []
    if "multipart/byteranges" in ctype:
        boundary = ctype.split("boundary=")[1].strip().strip('"').encode()
        pos = 0
        marker = b"--" + boundary
        while True:
            pos = body.find(marker, pos)
            if pos < 0 or body[pos + len(marker) : pos + len(marker) + 2] == b"--":
                break
            head_end = body.find(b"\r\n\r\n", pos)
            head = body[pos:head_end].decode("latin1")
            line = next(l for l in head.split("\r\n") if l.lower().startswith("content-range"))
            span = line.split("bytes", 1)[1].strip().split("/")[0]
            a, b = (int(v) for v in span.split("-"))
            data_start = head_end + 4
            parts.append((a, body[data_start : data_start + (b - a + 1)]))
            pos = data_start + (b - a + 1)
    else:  # a single range (or the server merged them)
        cr = response.headers.get("content-range", "")
        a = int(cr.split("bytes", 1)[1].strip().split("-")[0]) if cr else 0
        parts.append((a, body))

    out = []
    for a, b in ranges:
        for start, data in parts:
            if start <= a and b < start + len(data):
                out.append(data[a - start : b - start + 1])
                break
        else:
            raise ValueError(f"Range {a}-{b} missing from the server's reply")
    return out


def _header_at(client, url, offset, expect, size=7 * BLOCK):
    data = _range(client, url, offset, size)
    try:
        header = _header_from_bytes(data)
    except ValueError:
        data = _range(client, url, offset, 12 * BLOCK)
        header = _header_from_bytes(data)
    name = str(header.get("EXTNAME", "")).strip()
    if name != expect:
        raise ValueError(f"Expected {expect} at byte {offset}, found {name or header.get('XTENSION')}")
    return header, _pad(len(header.tostring()))


def _clipped_stats(values: np.ndarray):
    values = values[np.isfinite(values)]
    for _ in range(3):
        if values.size < 5:
            break
        med = np.median(values)
        std = 1.4826 * np.median(np.abs(values - med))
        keep = np.abs(values - med) <= 3 * max(std, 1e-12)
        if keep.all():
            break
        values = values[keep]
    if values.size < 5:
        return None, None, values.size
    med = float(np.median(values))
    return med, float(1.4826 * np.median(np.abs(values - med))), values.size


def measure(client: httpx.Client, obs: dict, ra: float, dec: float) -> dict:
    """Aperture photometry of (ra, dec) in one SPHEREx image."""
    url = obs["access_url"]
    key = hashlib.sha1(f"phot-v2|{url}|{ra:.6f}|{dec:.6f}".encode()).hexdigest()[:20]
    folder = config.CACHE_DIR / "photometry"
    folder.mkdir(parents=True, exist_ok=True)
    cache_file = folder / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    base = {
        "obs_id": obs["obs_id"],
        "band": obs["band"],
        "time_utc": obs["time_utc"],
        "time_mjd": obs["time_mjd"],
    }
    wave = wavelength_at_target(client, url, ra, dec)
    result = {**base, "wavelength_um": wave["wavelength_um"], "bandwidth_um": wave["bandwidth_um"]}
    if not wave["inside"] or wave["wavelength_um"] is None:
        result.update(usable=False, reason="target outside this image")
        cache_file.write_text(json.dumps(result))
        return result

    # --- Where each layer lives in the file ------------------------------------
    head = _range(client, url, 0, HEAD_BYTES)
    image_at = _find_hdu(head, "IMAGE", "IMAGE")
    image_header = _header_from_bytes(head[image_at:])
    nx, ny = int(image_header["NAXIS1"]), int(image_header["NAXIS2"])
    image_data = image_at + _pad(len(image_header.tostring()))
    flags_at = image_data + _pad(nx * ny * 4)
    flags_header, flags_hlen = _header_at(client, url, flags_at, "FLAGS")
    flags_data = flags_at + flags_hlen
    table_bytes = int(flags_header["NAXIS1"]) * int(flags_header["NAXIS2"])
    var_at = flags_data + _pad(table_bytes + int(flags_header.get("PCOUNT", 0)))
    var_header, var_hlen = _header_at(client, url, var_at, "VARIANCE")
    var_data = var_at + var_hlen
    zodi_at = var_data + _pad(nx * ny * 4)
    _, zodi_hlen = _header_at(client, url, zodi_at, "ZODI")
    zodi_data = zodi_at + zodi_hlen

    # --- The pixel box around the target ----------------------------------------
    x, y = wave["detector_pixel"]
    xi, yi = int(round(x)), int(round(y))
    if xi - HALF < 0 or yi - HALF < 0 or xi + HALF >= nx or yi + HALF >= ny:
        result.update(usable=False, reason="too close to the image edge")
        cache_file.write_text(json.dumps(result))
        return result
    rows = range(yi - HALF, yi + HALF + 1)
    width = 2 * HALF + 1

    def row_ranges(data_start):
        return [(data_start + (r * nx + xi - HALF) * 4, data_start + (r * nx + xi - HALF) * 4 + width * 4 - 1) for r in rows]

    ranges = row_ranges(image_data)
    ranges.append((flags_data + rows.start * 8, flags_data + rows.stop * 8 - 1))  # tile descriptors
    ranges += row_ranges(var_data) + row_ranges(zodi_data)
    pieces = _multi_range(client, url, ranges)
    image = np.array([np.frombuffer(p, ">f4") for p in pieces[:width]], dtype=np.float64)
    descriptors = np.frombuffer(pieces[width], ">i4").reshape(width, 2)  # (nbytes, heap offset) per row
    variance = np.array([np.frombuffer(p, ">f4") for p in pieces[width + 1 : 2 * width + 1]], dtype=np.float64)
    zodi = np.array([np.frombuffer(p, ">f4") for p in pieces[2 * width + 1 :]], dtype=np.float64)
    for arr, hdr in ((image, image_header), (variance, var_header)):
        arr *= float(hdr.get("BSCALE", 1.0))
        arr += float(hdr.get("BZERO", 0.0))

    # --- Quality flags (Rice-compressed rows) ------------------------------------
    flags = None
    flag_defs = _flag_definitions(flags_header)
    params = {str(flags_header.get(f"ZNAME{i}", "")).strip().upper(): flags_header.get(f"ZVAL{i}") for i in (1, 2)}
    if (
        str(flags_header.get("ZCMPTYPE", "")).strip() == "RICE_1"
        and int(params.get("BYTEPIX", 4)) == 4
        and int(flags_header.get("ZTILE1", 0)) == nx
        and int(flags_header.get("ZTILE2", 0)) == 1
    ):
        heap = flags_data + int(flags_header.get("THEAP", table_bytes))
        heap_ranges = [(heap + int(off), heap + int(off) + int(n) - 1) for n, off in descriptors]
        compressed = _multi_range(client, url, heap_ranges)
        block = int(params.get("BLOCKSIZE", 32))
        flags = np.array(
            [rice_decode(c, nx, stop=xi + HALF + 1, blocksize=block)[xi - HALF :] for c in compressed], dtype=np.int64
        )

    bad_bits = 0
    for name in config.BAD_FLAG_NAMES:
        bad_bits |= flag_defs.get(name, 0)
    bad = ~np.isfinite(image) | ~np.isfinite(variance) | ~np.isfinite(zodi)
    if flags is not None:
        bad |= (flags & bad_bits) != 0

    # --- Aperture photometry --------------------------------------------------------
    yy, xx = np.mgrid[yi - HALF : yi + HALF + 1, xi - HALF : xi + HALF + 1]
    r = np.hypot(xx - x, yy - y)
    aperture = r <= R_APERTURE
    annulus = (r >= R_ANNULUS[0]) & (r <= R_ANNULUS[1])
    clean = image - zodi
    bkg, bkg_sigma, n_bkg = _clipped_stats(np.where(annulus & ~bad, clean, np.nan))
    good_ap = aperture & ~bad
    masked_fraction = 1 - good_ap.sum() / aperture.sum()
    centre_bad = bool((bad & (r <= 1.5)).any())  # the star's core must be clean
    flags_here = sorted({n for n, bit in flag_defs.items() if flags is not None and (flags[aperture] & bit).any()})

    omega_sr = proj_plane_pixel_area(WCS(image_header).celestial) * (math.pi / 180) ** 2
    to_ujy = omega_sr * 1e12  # MJy/sr -> microJansky per pixel
    if bkg is None or masked_fraction > MAX_MASKED_IN_APERTURE or centre_bad:
        result.update(
            usable=False,
            reason=(
                "background could not be measured"
                if bkg is None
                else "flagged pixels at the source centre"
                if centre_bad
                else "too many flagged pixels in the aperture"
            ),
            masked_fraction=round(float(masked_fraction), 3),
            flags_in_aperture=flags_here,
        )
        cache_file.write_text(json.dumps(result))
        return result

    scale = aperture.sum() / good_ap.sum()  # fill masked aperture pixels with the mean of the rest
    flux = float(((clean - bkg)[good_ap]).sum() * scale * to_ujy)
    var_sum = float(variance[good_ap].sum() * scale**2)
    n_ap = int(aperture.sum())
    bkg_var = (bkg_sigma**2 / max(n_bkg, 1)) * n_ap**2
    flux_err = math.sqrt(var_sum + bkg_var) * to_ujy

    result.update(
        usable=True,
        flux_ujy=round(flux, 3),
        flux_err_ujy=round(flux_err, 3),
        background_mjy_sr=round(bkg, 5),
        zodi_mjy_sr=round(float(zodi[HALF, HALF]), 5),
        masked_fraction=round(float(masked_fraction), 3),
        flags_in_aperture=flags_here,
        flags_checked=flags is not None,
        detector_pixel=wave["detector_pixel"],
    )
    cache_file.write_text(json.dumps(result))
    return result


def _bin(points: list[dict]) -> list[dict]:
    """Inverse-variance average of points whose wavelengths agree within half a bandwidth."""
    pts = sorted(points, key=lambda p: p["wavelength_um"])
    groups: list[list[dict]] = []
    for p in pts:
        if groups and p["wavelength_um"] - groups[-1][0]["wavelength_um"] <= 0.5 * (groups[-1][0]["bandwidth_um"] or 0.03):
            groups[-1].append(p)
        else:
            groups.append([p])
    out = []
    for g in groups:
        w = np.array([1 / p["flux_err_total_ujy"] ** 2 for p in g if p["flux_err_total_ujy"] > 0])
        f = np.array([p["flux_ujy"] for p in g if p["flux_err_total_ujy"] > 0])
        if w.size == 0:
            continue
        out.append(
            {
                "wavelength_um": round(float(np.mean([p["wavelength_um"] for p in g])), 4),
                "flux_ujy": round(float((w * f).sum() / w.sum()), 3),
                "flux_err_ujy": round(float(1 / math.sqrt(w.sum())), 3),
                "n": int(w.size),
                "band": g[0]["band"],
            }
        )
    return out


def _systematic_fraction(points: list[dict]) -> float:
    """Extra image-to-image scatter not explained by the VARIANCE layer, as a fraction of the flux.

    Neighbouring wavelengths should give nearly the same flux, so the scatter of each
    point about the median of its 6 nearest neighbours (in wavelength) measures the real
    repeatability. Whatever exceeds the pipeline's statistical errors is reported as a
    systematic term (pointing / pixel-phase effects of SPHEREx's large pixels). It is 0 for
    faint sources, where the statistical noise already dominates. Real narrow spectral
    features would also raise it, so it errs on the cautious side.
    """
    if len(points) < 9:
        return 0.0
    flux = np.array([p["flux_ujy"] for p in points])
    err = np.array([p["flux_err_ujy"] for p in points])
    if np.median(flux) <= 10 * np.median(err):
        return 0.0
    frac = []
    for i in range(len(points)):
        neighbours = np.r_[flux[max(0, i - 3) : i], flux[i + 1 : i + 4]]
        med = np.median(neighbours)
        if med > 0:
            frac.append((flux[i] - med) / med)
    if len(frac) < 9:
        return 0.0
    frac = np.array(frac)
    robust_var = (1.4826 * np.median(np.abs(frac - np.median(frac)))) ** 2
    stat_var = np.median((err / np.abs(flux)) ** 2)
    # the neighbour median itself is noisy; ~(1 + 1/6) inflation of the variance
    return float(math.sqrt(max(0.0, robust_var / (1 + 1 / 6) - stat_var)))


def build_spectrum(observations: list[dict], ra: float, dec: float) -> dict:
    """Photometry in every image (sub-sampled if very many), plus a binned spectrum."""
    by_band: dict[str, list[dict]] = {}
    for o in observations:
        by_band.setdefault(o["band"], []).append(o)
    per_band = max(1, MAX_OBSERVATIONS // max(len(by_band), 1))
    chosen, subsampled = [], False
    for band, obs in sorted(by_band.items()):
        if len(obs) > per_band:
            idx = np.linspace(0, len(obs) - 1, per_band).round().astype(int)
            obs = [obs[i] for i in sorted(set(idx))]
            subsampled = True
        chosen += obs

    def one(obs):
        try:
            with httpx.Client(follow_redirects=True) as client:
                return measure(client, obs, ra, dec)
        except Exception as error:  # report per image, keep going
            return {"obs_id": obs["obs_id"], "band": obs["band"], "time_utc": obs["time_utc"], "usable": False, "reason": f"error: {error}"}

    with ThreadPoolExecutor(max_workers=16) as pool:
        measurements = list(pool.map(one, chosen))

    usable = sorted((m for m in measurements if m.get("usable")), key=lambda m: m["wavelength_um"])
    systematic = _systematic_fraction(usable)
    for m in usable:
        m["flux_err_total_ujy"] = round(math.hypot(m["flux_err_ujy"], systematic * m["flux_ujy"]), 3)
    reasons: dict[str, int] = {}
    skipped_flags: dict[str, int] = {}
    bad_names = set(config.BAD_FLAG_NAMES)
    for m in measurements:
        if not m.get("usable"):
            reasons[m.get("reason", "unknown")] = reasons.get(m.get("reason", "unknown"), 0) + 1
            for name in m.get("flags_in_aperture", []):
                if name in bad_names:
                    skipped_flags[name] = skipped_flags.get(name, 0) + 1
    return {
        "points": usable,
        "systematic_fraction": round(systematic, 4),
        "binned": _bin(usable),
        "attempted": len(measurements),
        "available": len(observations),
        "subsampled": subsampled,
        "skipped": reasons,
        "skipped_flags": skipped_flags,
        "method": {
            "aperture_radius_arcsec": round(R_APERTURE * 6.15, 1),
            "annulus_arcsec": [round(R_ANNULUS[0] * 6.15, 1), round(R_ANNULUS[1] * 6.15, 1)],
            "description": [
                "One measurement per SPHEREx image: each sees the target at its own wavelength.",
                "Zodiacal-light model subtracted; local background = clipped median of a 25-43\" annulus.",
                f"Flux summed in a {R_APERTURE * 6.15:.1f}\" radius aperture and converted from MJy/sr to microjansky.",
                "Pixels with serious quality flags (e.g. saturated, hot, dead) excluded; an image is skipped if the source's core is flagged or >25% of the aperture is.",
                "Uncertainty from the VARIANCE layer plus the background uncertainty, plus a systematic term measured from the image-to-image scatter between neighbouring wavelengths.",
            ],
            "caveats": [
                "Not the official IRSA Spectrophotometry Tool (which fits the PSF); this is simpler aperture photometry.",
                "No aperture correction: some starlight falls outside 12\", so point-source fluxes are somewhat low.",
                "Neighbours within ~12\" add their light; nebulae and galaxies give only the flux inside the aperture.",
            ],
        },
    }
