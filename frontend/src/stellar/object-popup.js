/**
 * Click a star → a Stellarium-style popup (PLAN.md §8.3 part 3): name and other names,
 * what kind of object it is, brightness and colour, distance in light-years, how fast it
 * moves, with ★ Favourite, ➕ Select and "Measure spectrum" buttons.
 * Live answers come from /api/object (SIMBAD + Gaia); in demo mode only the featured
 * target itself is known (saved answer).
 */
import { getJson } from '../shared/api.js';
import { formatDec, formatRa } from '../shared/coords.js';
import { positionAt } from '../shared/motion.js';
import { favourites, selected } from '../shared/store.js';
import { separationArcsec } from './nav-math.js';
import { mjdToDate } from './timeline.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLICK_TOLERANCE_PX = 8;
const DEMO_MATCH_ARCSEC = 20;

/** A stable id for the lists: the catalogue id if known, else the position. */
const idOf = (answer) => answer.simbad_id ?? (answer.gaia_source_id ? `Gaia DR3 ${answer.gaia_source_id}` : `${answer.ra.toFixed(5)},${answer.dec.toFixed(5)}`);

/**
 * @param {{container: HTMLElement, sky: object, sequence: object, live: boolean, place: object,
 *          getDemo: () => Promise<object|null>, onMeasure: (subject: object) => void}} options
 */
export function setupObjectPopup({ container, sky, sequence, live, place, getDemo, onMeasure }) {
  const popup = document.createElement('section');
  popup.className = 'panel object-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'About this object');
  container.append(popup);
  let request = 0;

  function place_(x, y) {
    const width = container.clientWidth;
    popup.style.left = `${Math.min(Math.max(8, x + 14), width - 330)}px`;
    popup.style.top = `${Math.max(8, y - 20)}px`;
  }

  function close() {
    popup.hidden = true;
  }

  function fact(label, value) {
    return value === null || value === undefined || value === '' ? '' : `<dt>${label}</dt><dd>${value}</dd>`;
  }

  function render(answer, click) {
    if (!answer.found) {
      popup.innerHTML = `
        <header><h3>Nothing catalogued here</h3><button type="button" class="close" aria-label="Close">×</button></header>
        <p class="note">${escapeHtml(answer.message ?? 'No catalogued object at this spot.')}</p>
        <p class="mono small">${formatRa(click.ra)} ${formatDec(click.dec)}</p>
        <div class="popup-actions"><button type="button" class="small-button" data-measure>📈 Measure spectrum here</button></div>`;
    } else {
      // Uncertainties keep two significant figures (Barnard's Star: ± 0.00044, not ± 0).
      const error = answer.distance_ly?.error;
      const errorText = error ? (error < 1 ? Number(error.toPrecision(2)).toString() : Math.round(error).toLocaleString()) : '';
      const distance = answer.distance_ly
        ? `${answer.distance_ly.value.toLocaleString()} light-years${errorText ? ` (± ${errorText})` : ''}`
        : 'unknown';
      const motion = answer.proper_motion_arcsec_per_year != null
        ? `moves ${answer.proper_motion_arcsec_per_year >= 0.1 ? answer.proper_motion_arcsec_per_year.toFixed(2) : answer.proper_motion_arcsec_per_year.toFixed(3)}″ per year across the sky`
        : null;
      const id = idOf(answer);
      popup.innerHTML = `
        <header><h3>${escapeHtml(answer.name)}</h3><button type="button" class="close" aria-label="Close">×</button></header>
        <p class="object-type">${escapeHtml(answer.type_name ?? 'Object')}${answer.spectral_type ? ` · ${escapeHtml(answer.spectral_type)}` : ''}</p>
        ${answer.what_is_this ? `<p class="what">${escapeHtml(answer.what_is_this)}</p>` : ''}
        <dl class="facts">
          ${fact('Distance', distance)}
          ${fact('Brightness', answer.magnitude_g != null ? `G = ${answer.magnitude_g} mag` : answer.magnitude_v != null ? `V = ${answer.magnitude_v} mag` : null)}
          ${fact('Colour (BP−RP)', answer.colour_bp_rp != null ? `${answer.colour_bp_rp} ${answer.colour_bp_rp > 1.5 ? '(red)' : answer.colour_bp_rp < 0.5 ? '(blue-white)' : ''}` : null)}
          ${fact('Motion', motion)}
          ${fact('Radial velocity', answer.radial_velocity_km_s != null ? `${Number(answer.radial_velocity_km_s).toFixed(1)} km/s ${answer.radial_velocity_km_s < 0 ? '(coming closer)' : '(moving away)'}` : null)}
          ${fact('Position', `<span class="mono">${formatRa(answer.ra)} ${formatDec(answer.dec)}</span>`)}
          ${fact('Also called', answer.other_names?.length ? escapeHtml(answer.other_names.slice(0, 5).join(' · ')) : null)}
        </dl>
        <p class="note small">From ${escapeHtml(answer.sources.join(' + '))}. Position on ${escapeHtml(mjdToDate(click.mjd))}.</p>
        <div class="popup-actions">
          <button type="button" class="small-button" data-favourite aria-pressed="${favourites.has(id)}">★ Favourite</button>
          <button type="button" class="small-button" data-select aria-pressed="${selected.has(id)}">➕ Select</button>
          <button type="button" class="small-button" data-measure>📈 Measure spectrum</button>
        </div>
        <p class="note small">Saved on this device; accounts coming soon.</p>`;
      const item = { id, name: answer.name, ra: answer.ra, dec: answer.dec, type: answer.type_name, distance_ly: answer.distance_ly?.value ?? null };
      popup.querySelector('[data-favourite]').addEventListener('click', (event) => {
        event.currentTarget.setAttribute('aria-pressed', String(favourites.toggle(item)));
      });
      popup.querySelector('[data-select]').addEventListener('click', (event) => {
        event.currentTarget.setAttribute('aria-pressed', String(selected.toggle(item)));
      });
    }
    popup.querySelector('.close').addEventListener('click', close);
    popup.querySelector('[data-measure]').addEventListener('click', () => {
      close();
      const name = answer.found ? answer.name : `${formatRa(click.ra)} ${formatDec(click.dec)}`;
      const ra = answer.found ? answer.ra : click.ra;
      const dec = answer.found ? answer.dec : click.dec;
      const isDemoTarget = place.featured && separationArcsec(ra, dec, place.ra, place.dec) < DEMO_MATCH_ARCSEC * 3;
      // Fast movers are measured by name so the server can follow their motion.
      const target = isDemoTarget ? place.featured.slug
        : answer.found && answer.proper_motion_arcsec_per_year >= 0.05 && answer.simbad_id ? answer.simbad_id : undefined;
      onMeasure({ name, ra, dec, target, isDemoTarget });
    });
  }

  /** @param {{ra: number, dec: number, x: number, y: number}} click */
  async function show(click) {
    const token = ++request;
    const mjd = sequence.time() ?? 61041;
    const fovArcsec = sky.fovDeg() * 3600;
    const radius = Math.min(60, Math.max(4, (fovArcsec / container.clientWidth) * CLICK_TOLERANCE_PX));
    const where = { ...click, mjd };
    popup.hidden = false;
    place_(click.x, click.y);
    popup.innerHTML = '<p class="note">Looking this up in SIMBAD and Gaia…</p>';
    try {
      let answer;
      if (live) {
        answer = await getJson('/api/object', { ra: click.ra, dec: click.dec, radius: radius.toFixed(1), epoch: mjd.toFixed(3) });
      } else {
        const demo = await getDemo();
        const saved = demo?.objects?.[0];
        const motion = place.featured?.motion;
        const targetNow = motion ? positionAt(motion, mjd) : place;
        const close_ = saved && separationArcsec(click.ra, click.dec, targetNow.ra, targetNow.dec) <= Math.max(radius, DEMO_MATCH_ARCSEC);
        answer = close_ ? saved : {
          found: false, ra: click.ra, dec: click.dec,
          message: 'Identifying objects needs the live data server, which is asleep. In demo mode, click the featured target itself.',
        };
      }
      if (token === request) render(answer, where);
    } catch (error) {
      if (token === request) {
        popup.innerHTML = `<header><h3>Couldn't look this up</h3><button type="button" class="close" aria-label="Close">×</button></header><p class="note">${escapeHtml(error.message)}</p>`;
        popup.querySelector('.close').addEventListener('click', close);
      }
    }
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  return { show, close };
}
