# Integration: Elaine's demo + Alice's demo → SPHEREx Xplorer

Branch: `elaine-demo-integration`. Base: **Alice's demo** (Vite + plain JavaScript website,
FastAPI data server). Elaine's features are ported in from her latest copy
(`D:\Projects\SPHEREx-Xplorer`). Her original Next.js demo was removed from this branch in
Milestone 2; it's still on the `elaine-demo` branch.

## What the final product looks like
- **Title page:** Alice's, unchanged (3D night Earth, star-name search, Randomize, featured
  targets, Advanced options, fly-away transition).
- **Explore (Stellar View):** Alice's layout and controls. The sky opens on **Elaine's SPHEREx
  false-colour Aladin Lite map**; the Layers tab can switch to Alice's 102-colour SPHEREx map
  (wavelength slider) or the other maps.
- **One data server** with both demos' endpoints (Alice's in `backend/app/main.py`, Elaine's
  in `backend/app/skytools/`).

## Feature comparison

| Feature | Elaine | Alice | Decision |
|---|---|---|---|
| Title page | three.js Earth, Moon, satellites, comets; coordinate search | three.js night Earth with real Sun/stars, flyers; name **or** coordinate search; featured chips; Advanced (FOV, detectors, release); server status | **Alice** (as asked) |
| Search | Decimal RA/Dec, validation | SIMBAD name resolution + decimal + sexagesimal | **Alice** (does everything Elaine's does, plus names) |
| Random | Random spot | Pre-searched pool of spots that SPHEREx covers (instant) | **Alice** (faster, never lands on empty sky) |
| Earth-to-sky transition | Launch camera + veil | Fly-away + ease-in zoom | **Alice** (part of her title page) |
| Default sky map | SPHEREx false colour (server-built RGB from 3 cube channels) + 3 presets | SPHEREx 102-colour cube, one plane at a time | **Elaine's false colour is the default** (as asked); Alice's cube is the switch and the no-server fallback |
| One-wavelength SPHEREx map | Backend re-serves each cube frame | Aladin `setSliceNumber` straight from IRSA | **Alice** (no server needed, faster) |
| Other maps | 2MASS, AllWISE, DSS (IRSA mirror) | QR2 colour + D1–D6 (CDS), AllWISE, unWISE, 2MASS; overlay map with see-through slider | **Alice** (more maps, overlays); menu now grouped so non-SPHEREx maps are clearly labelled |
| Navigation | Pan / rotate, zoom buttons, return, set as new coordinate | Same, plus keyboard shortcuts, pinch zoom, "moved" chip | **Alice** |
| Cursor coordinates | Live RA/Dec under the mouse | — | **Add to Alice's UI** (M2) |
| Footprints / coverage | Footprints from `s_region` | Footprints + DR1 coverage map (MOC) | **Alice** |
| Catalogue overlays | SIMBAD, Gaia DR3, AllWISE via our server (cached) | Gaia DR3, AllWISE straight from VizieR (CDS) | **Elaine's server route** (CDS was down on 2026-11-14/15; cached server copy is more reliable) in **Alice's checkboxes**, plus SIMBAD (M2) |
| Click to identify | SIMBAD + Gaia + AllWISE panel, "measure spectrum" | Object popup (`/api/object`), favourite / select, measure | **Alice's popup**, filled with Elaine's richer three-catalogue answer (M2) |
| Time playback | Time machine: per detector/channel, detector picker (All / D1–D6), brightness at target | Time bar: play, speed, loop/bounce, blink, filmstrip, frame modes, shared stretch, proper-motion aware | **Alice** + Elaine's **brightness-at-target readout** and **same-wavelength channel** filter (M2) |
| Compare two visits | Aligned difference **and significance map (σ)**, PSF, noise check, >5σ pixel count, limitations | Difference (match brightness), stack (median/mean/sum), colour composite, Find moving objects | **Alice's operations** + Elaine's **significance map and quality numbers** in the Difference result (M2). Clearer: tells users whether a change is real |
| Spectrum | Own aperture photometry, **known-feature markers** (H₂O ice, CO₂, CO, PAH, Brα…), log scale, data table, method & limitations | Chart.js spectrum, bin to 102 channels, flagged points, colour by detector/visit, CSV | **Alice's chart** + Elaine's **feature markers, table and method notes** (M2). Markers also power the M3 ice/carbon search |
| Light curve | — | Light curve with wavelength window, relative mode for saturated stars, CSV | **Alice** |
| Quality flags | Flag counts | Flags tab: show on sky, leave out, quality badge | **Alice** |
| Image info | In observation list | Info tab (frame + original image metadata) | **Alice** |
| Single sharp observation on the sky | FITS cutout layer, "match background to wavelength" | Frames drawn on the sky with see-through | **Alice's overlay** + Elaine's **match background to wavelength** (M2) |
| Learning content | SPHEREx guide (detector table, how to read each tool), intro section | About / How-to dialogs, "?" help bubbles | **Both**: Elaine's guide becomes a Guide tab in Alice's drawer (M2) |
| Sharing | Copy link | Copy link, embed code, favourites, selected list, demo mode | **Alice** |
| Tests | — | Frontend (vitest) and backend (pytest, offline fixtures) | **Alice**, extended for ported features |

## Milestones
1. **Foundation** (done): branch, merge, one backend, Alice's title page, Explore opens on
   Elaine's false-colour map with a switch to Alice's maps, this comparison.
2. **Feature merge** (done): cursor coordinates; SIMBAD/Gaia/AllWISE markers through the
   data server with per-catalogue status; AllWISE infrared section in the object popup;
   "At target" brightness and "Same colour" playback in the time bar; σ significance map
   and quality numbers after a visit-minus-visit Difference (`/api/significance`); spectral
   feature markers, points table and limits in the Spectrum tab; "match the sky map to the
   frame's colour"; Guide tab. `claude-demo/` removed.
3. **New features** (done): Chemistry tab on the Explore page. Pick ingredients (water,
   CO₂, CO and methanol ice; PAH and chain-like organics) or "signs of pre-life chemistry"
   to list places from `config/chemistry.json` (12 places, each with its paper; SPHEREx's own
   Cygnus X results first), fly to one, and "check this spot with SPHEREx" (band depths
   τ = ln(continuum / band) from the live spectrum, ≥ 3σ = seen). Both search boxes accept
   ingredient words ("water ice", "carbon", "pre-life"). "Why use SPHEREx Xplorer" in the
   Guide tab and README.
4. **Life-ingredient filters, Earth comparison, favourites:**
   - Filter on the Explore page: find places by ingredients life needs, with numbers.
     *SPHEREx ice clouds:* ice amounts as published (e.g. CO₂ or CO as a % of water ice,
     water-ice column), plus organics (PAH, aliphatic carbon). *Planets:* NASA Exoplanet
     Archive values (radius, mass, temperature, sunlight received, in the habitable zone),
     with water / atmosphere detections only where a paper reports them.
   - Planet profile comparing each planet with Earth: similarities, differences and an
     Earth Similarity Index (formula shown). Every number names its source; nothing is
     guessed.
   - Add a planet or place to **favourites** and come back to it later (saved on this
     device, building on Alice's favourites list), with what changed since the last visit
     where the data allows.

## Honesty rules carried over from both demos
- Never fabricate data. Decorative visuals are labelled as such.
- Every sky map says whether it is SPHEREx data or another telescope.
- The false-colour mosaic is for looking, not measuring (stretched display version).
