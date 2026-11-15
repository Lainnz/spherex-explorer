/**
 * The Planets tab (Milestone 4): every confirmed exoplanet from the NASA Exoplanet Archive,
 * filtered by what life needs (Earth-like size, the habitable zone, temperature, molecules
 * seen in its air), ranked by Earth Similarity Index, with a planet-vs-Earth profile.
 * Saved planets remember their values, so coming back shows what the archive has updated.
 */
import { getJson } from '../shared/api.js';
import {
  changesSince, compareWithEarth, earthSimilarity, ESI_WEIGHTS, filterPlanets, habitableZone, inHabitableZone,
  insolation, MOLECULES, planetSnapshot, SIZE_CLASSES, sizeClass, toPlanet,
} from '../shared/planets.js';
import { favourites } from '../shared/store.js';
import { buildStellarUrl } from '../shared/url-state.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SHOW_AT_ONCE = 40;
const planetId = (name) => `planet:${name}`;

/**
 * @param {{root: HTMLElement, state: object, live: boolean, toast: (text: string, kind?: string) => void,
 *          onChange: () => void}} options
 */
export function setupPlanetsPanel({ root, state, live, toast, onChange }) {
  const $ = (selector) => root.querySelector(selector);
  const status = $('[data-planets-status]');
  const results = $('[data-planets-results]');
  const profile = $('[data-planet-profile]');
  const savedBox = $('[data-planets-saved]');
  let planets = null;
  let loading = null;
  let shown = SHOW_AT_ONCE;

  // Size chips
  const sizeBox = $('[data-planet-sizes]');
  for (const size of SIZE_CLASSES) {
    const label = document.createElement('label');
    label.className = 'ingredient-chip';
    label.innerHTML = `<input type="checkbox" value="${size.id}" /> ${escapeHtml(size.label)}`;
    sizeBox.append(label);
  }
  const moleculeSelect = $('#planet-molecule');
  for (const [id, label] of Object.entries(MOLECULES)) moleculeSelect.add(new Option(label, id));

  function filters() {
    const number = (selector) => ($(selector).value === '' ? null : Number($(selector).value));
    return {
      query: $('#planet-search').value,
      sizes: [...sizeBox.querySelectorAll('input:checked')].map((box) => box.value),
      habitable: $('#planet-hz').checked,
      tempMin: number('#planet-tmin'),
      tempMax: number('#planet-tmax'),
      maxDistanceLy: number('#planet-dist'),
      minEsi: number('#planet-esi'),
      molecule: moleculeSelect.value || null,
    };
  }

  async function load() {
    if (planets) return planets;
    if (!live) {
      status.textContent = 'The planet list comes from NASA\'s Exoplanet Archive through the data server, which is asleep. Start the server to explore planets.';
      return null;
    }
    loading ??= (async () => {
      status.textContent = 'Getting every confirmed planet from NASA\'s Exoplanet Archive… (the first time can take a minute)';
      try {
        const body = await getJson('/api/planets', {}, { timeoutMs: 150000 });
        planets = body.rows.map((row) => toPlanet(body.columns, row));
        status.dataset.source = `${body.source}, fetched ${body.fetched}${body.stale ? ' (saved copy: the archive didn\'t answer)' : ''}.`;
        if (body.warning) toast(body.warning, 'warning', 10);
        return planets;
      } catch (error) {
        status.textContent = error.message;
        loading = null;
        return null;
      }
    })();
    return loading;
  }

  function badge(text, kind) {
    return `<span class="badge"${kind ? ` data-state="${kind}"` : ''}>${escapeHtml(text)}</span>`;
  }

  function render() {
    if (!planets) return;
    const list = filterPlanets(planets, filters());
    status.textContent = `${list.length.toLocaleString()} of ${planets.length.toLocaleString()} confirmed planets match, most Earth-like first. ${status.dataset.source ?? ''}`;
    results.replaceChildren(...list.slice(0, shown).map(renderPlanet));
    if (list.length > shown) {
      const more = document.createElement('li');
      more.innerHTML = `<button type="button" class="small-button">Show ${Math.min(SHOW_AT_ONCE, list.length - shown)} more</button>`;
      more.querySelector('button').addEventListener('click', () => { shown += SHOW_AT_ONCE; render(); });
      results.append(more);
    }
    renderSaved();
  }

  function renderPlanet(planet) {
    const item = document.createElement('li');
    item.className = 'chem-item';
    const esi = earthSimilarity(planet);
    const hz = inHabitableZone(planet);
    const facts = [
      planet.radius != null ? `${planet.radius.toFixed(2)} R⊕ · ${sizeClass(planet.radius).label}` : null,
      planet.eqTemp != null ? `${Math.round(planet.eqTemp)} K` : null,
      planet.distanceLy != null ? `${Math.round(planet.distanceLy).toLocaleString()} light-years` : null,
    ].filter(Boolean).join(' · ');
    item.innerHTML = `
      <header>
        <h4>${escapeHtml(planet.name)}</h4>
        ${esi ? badge(`ESI ${esi.value.toFixed(2)}`, esi.value >= 0.8 ? 'live' : '') : ''}
        ${hz ? badge('Habitable zone', 'live') : ''}
        ${planet.atmosphere ? badge('Air measured') : ''}
      </header>
      <p class="note small">${escapeHtml(facts || 'Few measurements yet')}</p>
      <div class="button-row">
        <button type="button" class="small-button" data-compare>Compare with Earth</button>
        <button type="button" class="small-button" data-save aria-pressed="${favourites.has(planetId(planet.name))}">★ Save</button>
      </div>`;
    item.querySelector('[data-compare]').addEventListener('click', () => showProfile(planet));
    item.querySelector('[data-save]').addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-pressed', String(toggleSaved(planet)));
    });
    return item;
  }

  function toggleSaved(planet) {
    const saved = favourites.toggle({
      id: planetId(planet.name), kind: 'planet', planet: planet.name, name: planet.name, ra: planet.ra, dec: planet.dec,
      host: planet.host, type: 'Exoplanet', distance_ly: planet.distanceLy != null ? Math.round(planet.distanceLy) : null,
      snapshot: planetSnapshot(planet), checked: new Date().toISOString(),
    });
    renderSaved();
    return saved;
  }

  /** Your saved planets, with what NASA's archive changed since you saved or last checked. */
  function renderSaved() {
    const saved = favourites.list().filter((item) => item.kind === 'planet');
    if (!saved.length || !planets) {
      savedBox.hidden = true;
      return;
    }
    savedBox.hidden = false;
    const byName = new Map(planets.map((p) => [p.name, p]));
    savedBox.querySelector('ul').replaceChildren(...saved.map((item) => {
      const planet = byName.get(item.planet);
      const li = document.createElement('li');
      const changes = planet ? changesSince(item.snapshot, planet) : [];
      const when = new Date(item.checked ?? item.added).toLocaleDateString();
      li.innerHTML = `<button type="button" class="link-button">${escapeHtml(item.name)}</button>
        <small>${!planet ? 'no longer in the archive' : changes.length ? `updated since ${escapeHtml(when)}: ${escapeHtml(changes.join('; '))}` : `no changes since ${escapeHtml(when)}`}</small>`;
      if (planet) {
        li.querySelector('button').addEventListener('click', () => {
          showProfile(planet);
          // You've now seen the new values.
          favourites.update(item.id, { snapshot: planetSnapshot(planet), checked: new Date().toISOString() });
        });
      }
      return li;
    }));
  }

  function showProfile(planet) {
    const esi = earthSimilarity(planet);
    const rows = compareWithEarth(planet);
    const zone = habitableZone(planet.starTemp);
    const s = insolation(planet);
    const atmosphere = planet.atmosphere;
    profile.hidden = false;
    profile.innerHTML = `
      <header class="profile-head">
        <h3>${escapeHtml(planet.name)} vs Earth</h3>
        <button type="button" class="close" aria-label="Close">×</button>
      </header>
      <p class="note small">Orbits ${escapeHtml(planet.host)}${planet.distanceLy != null ? `, ${Math.round(planet.distanceLy).toLocaleString()} light-years away` : ''}. Found ${planet.year ?? '?'} by ${escapeHtml(planet.method ?? 'unknown method')}.</p>
      <table class="chem-live small earth-table">
        <thead><tr><th></th><th>${escapeHtml(planet.name)}</th><th>Earth</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.similar ? 'is-similar' : 'is-different'}"><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.planet)}${r.note ? `<br><span class="note">${escapeHtml(r.note)}</span>` : ''}</td><td>${escapeHtml(r.earth)}</td></tr>`).join('')}</tbody>
      </table>
      <p class="small"><strong>Like Earth:</strong> ${escapeHtml(rows.filter((r) => r.similar).map((r) => r.label.toLowerCase()).join(', ') || 'none of the measured properties')}.
        <strong>Unlike Earth:</strong> ${escapeHtml(rows.filter((r) => !r.similar).map((r) => r.label.toLowerCase()).join(', ') || 'none of the measured properties')}.</p>
      ${atmosphere ? `
        <h4 class="popup-subhead">Measured in its atmosphere</h4>
        <p class="small">${atmosphere.detected.map((m) => escapeHtml(MOLECULES[m])).join(', ')}${atmosphere.disputed?.length ? `. Disputed: ${atmosphere.disputed.map((m) => escapeHtml(MOLECULES[m])).join(', ')}` : ''}.</p>
        <p class="note small">${escapeHtml(atmosphere.summary)} Source: ${atmosphere.references.map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`).join(' · ')}</p>`
        : '<p class="note small">No atmosphere measurement in our list for this planet. For almost all planets, what their air or surface is made of (and how much water they hold) hasn\'t been measured yet.</p>'}
      <h4 class="popup-subhead">Earth Similarity Index ${esi ? esi.value.toFixed(2) : '–'}</h4>
      ${esi ? `<table class="chem-live small"><thead><tr><th>Property</th><th>Planet</th><th>Earth</th><th>Match</th></tr></thead><tbody>
        ${esi.parts.map((p) => `<tr><th>${escapeHtml(p.label)}</th><td>${p.planet.toPrecision(3)}</td><td>${p.earth}</td><td>${p.score.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<p class="note small">Not enough measurements for an ESI.</p>'}
      <details class="about"><summary>How the ESI and habitable zone are worked out</summary>
        <p class="note small">ESI = product of (1 − |(x − x⊕)/(x + x⊕)|)<sup>w/n</sup> over the n properties known, with weights
          radius ${ESI_WEIGHTS.radius}, density ${ESI_WEIGHTS.density}, escape velocity ${ESI_WEIGHTS.escape}, temperature ${ESI_WEIGHTS.temperature}
          (Schulze-Makuch et al. 2011, Astrobiology 11, 1041). 1 = identical to Earth. Surface temperatures of exoplanets aren't known,
          so the equilibrium temperature stands in against Earth's 288 K, which lowers every score a little (an exact Earth twin would get about 0.92).</p>
        <p class="note small">Habitable zone: Kopparapu et al. 2013/2014 conservative limits for a star of ${planet.starTemp ? `${Math.round(planet.starTemp)} K` : 'unknown temperature'}:
          ${zone ? `${zone.outer.toFixed(2)}–${zone.inner.toFixed(2)}× Earth's starlight; this planet gets ${s != null ? `${s.toPrecision(3)}×` : 'an unknown amount'}.` : 'the formula covers stars of 2,600–7,200 K only, so this star is outside its range.'}</p>
      </details>
      <div class="button-row">
        <a class="small-button" href="${escapeHtml(buildStellarUrl({ ra: planet.ra, dec: planet.dec, target: planet.host, planet: planet.name, embed: state.embed }))}">Show ${escapeHtml(planet.host)} on the sky</a>
        <button type="button" class="small-button" data-save aria-pressed="${favourites.has(planetId(planet.name))}">★ Save</button>
      </div>
      <p class="note small">Data: NASA Exoplanet Archive (best values for each planet). Sizes and temperatures have error bars not shown here.</p>`;
    profile.querySelector('.close').addEventListener('click', () => {
      profile.hidden = true;
      delete state.planet;
      onChange();
    });
    profile.querySelector('[data-save]').addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-pressed', String(toggleSaved(planet)));
      render();
    });
    profile.scrollIntoView({ block: 'nearest' });
    state.planet = planet.name;
    onChange();
  }

  root.addEventListener('input', (event) => {
    if (event.target.closest('[data-planet-filters]')) {
      shown = SHOW_AT_ONCE;
      render();
    }
  });
  $('[data-preset="earthlike"]').addEventListener('click', () => {
    sizeBox.querySelectorAll('input').forEach((box) => { box.checked = box.value === 'earth' || box.value === 'super'; });
    $('#planet-hz').checked = true;
    shown = SHOW_AT_ONCE;
    render();
  });

  return {
    /** Load the list the first time the tab opens (it's a big download). */
    async open() {
      if (await load()) {
        render();
        if (state.planet) {
          const planet = planets.find((p) => p.name === state.planet);
          if (planet) showProfile(planet);
        }
      }
    },
  };
}
