/**
 * The Chemistry tab (Milestone 3): search by ingredient (water ice, CO₂, CO, methanol,
 * PAH and chain-like organics) or "signs of pre-life", get a list of places where they
 * have been detected (each with its paper), fly to one, and check any spot live with
 * SPHEREx's own spectrum (band depths from shared/chemistry.js).
 */
import { BANDS, DETECTION_SIGMA, findTargets, formatPercent, INGREDIENTS, measureFeature, PRESETS } from '../shared/chemistry.js';
import { buildStellarUrl } from '../shared/url-state.js';
import { separationArcsec } from './nav-math.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HERE_ARCSEC = 120;

/**
 * @param {{root: HTMLElement, state: object, home: {ra: number, dec: number}, live: boolean,
 *          photometry: object, subject: () => object, onChange: () => void,
 *          toast: (text: string, kind?: string) => void}} options
 */
export function setupChemistryPanel({ root, state, home, live, photometry, subject, onChange, toast }) {
  const chips = root.querySelector('[data-ingredients]');
  const presetButton = root.querySelector('[data-preset="prelife"]');
  const matchAny = root.querySelector('#match-any');
  const count = root.querySelector('[data-chem-count]');
  const results = root.querySelector('[data-chem-results]');
  const checkButton = root.querySelector('[data-chem-check]');
  const liveBox = root.querySelector('[data-chem-live]');

  const query = { ingredients: [...(state.find?.ingredients ?? [])], match: state.find?.match ?? 'all', preset: state.find?.preset };

  // --- Ingredient chips ------------------------------------------------------------------
  for (const [id, info] of Object.entries(INGREDIENTS)) {
    const label = document.createElement('label');
    label.className = `ingredient-chip kind-${info.kind}`;
    label.title = info.why;
    label.innerHTML = `<input type="checkbox" value="${id}" /> ${escapeHtml(info.label)}`;
    chips.append(label);
  }
  const boxes = [...chips.querySelectorAll('input')];

  function show() {
    boxes.forEach((box) => { box.checked = query.ingredients.includes(box.value); });
    presetButton.setAttribute('aria-pressed', String(query.preset === 'prelife'));
    matchAny.checked = query.match === 'any';
    const list = findTargets(query);
    const asked = query.preset || query.ingredients.length;
    count.textContent = asked
      ? `${list.length} place${list.length === 1 ? '' : 's'} with ${describeQuery()}.`
      : `All ${list.length} places in the list. Tick ingredients to narrow it down.`;
    if (query.preset) count.textContent += ` ${PRESETS[query.preset].explain}`;
    results.replaceChildren(...list.map(renderTarget));
    state.find = asked ? { ...query } : undefined;
    onChange();
  }

  function describeQuery() {
    const names = query.ingredients.map((id) => INGREDIENTS[id].label.toLowerCase());
    const parts = [];
    if (query.preset) parts.push(PRESETS[query.preset].label.toLowerCase());
    if (names.length) parts.push(names.join(query.match === 'any' ? ' or ' : ' and '));
    return parts.join(', plus ');
  }

  function renderTarget(target) {
    const item = document.createElement('li');
    item.className = 'chem-item';
    const here = target.ra != null && separationArcsec(target.ra, target.dec, home.ra, home.dec) < HERE_ARCSEC;
    const ingredientChips = Object.entries(target.ingredients).map(([id, detail]) => {
      const percent = formatPercent(detail.percent_of_h2o);
      const wanted = query.ingredients.includes(id) ? ' is-wanted' : '';
      return `<span class="ingredient-tag kind-${INGREDIENTS[id].kind}${wanted}" title="${escapeHtml(INGREDIENTS[id].why)}">${escapeHtml(INGREDIENTS[id].short)}${percent ? ` · ${percent} of water ice` : ''}</span>`;
    }).join('');
    const refs = target.references.map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`).join(' · ');
    item.innerHTML = `
      <header>
        <h4>${escapeHtml(target.name)}</h4>
        ${target.spherex_result ? '<span class="badge" data-state="live" title="Found in SPHEREx data by the SPHEREx team">SPHEREx result</span>' : ''}
        ${here ? '<span class="badge">You are here</span>' : ''}
      </header>
      <p class="note small">${escapeHtml(target.kind)} · ${escapeHtml(target.where)}</p>
      <p class="chem-summary">${escapeHtml(target.summary)}</p>
      <div class="ingredient-tags">${ingredientChips}</div>
      <p class="note small">Source: ${refs}</p>
      <div class="button-row"></div>`;
    if (!here) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'small-button';
      go.textContent = target.ra != null ? `Go to ${target.name}` : `Look up and go to ${target.name}`;
      go.addEventListener('click', () => goTo(target));
      item.querySelector('.button-row').append(go);
    }
    return item;
  }

  function goTo(target) {
    if (target.ra == null && !live) {
      toast(`Finding ${target.name} by name needs the live data server, which is asleep.`, 'warning');
      return;
    }
    const destination = target.ra != null
      ? { ra: target.ra, dec: target.dec, target: target.name }
      : { target: target.resolve };
    window.location.assign(buildStellarUrl({ ...destination, fov: target.fov_arcsec, find: state.find, embed: state.embed }));
  }

  boxes.forEach((box) => box.addEventListener('change', () => {
    query.ingredients = boxes.filter((b) => b.checked).map((b) => b.value);
    show();
  }));
  presetButton.addEventListener('click', () => {
    query.preset = query.preset === 'prelife' ? undefined : 'prelife';
    show();
  });
  matchAny.addEventListener('change', () => {
    query.match = matchAny.checked ? 'any' : 'all';
    show();
  });

  // --- Live SPHEREx check of the current spot ---------------------------------------------
  let checking = false;
  function showLive({ subject: measured, points, done, error }) {
    if (!checking) return;
    if (error) {
      liveBox.innerHTML = `<p class="note small">${escapeHtml(error)}</p>`;
      return;
    }
    const rows = Object.keys(BANDS).map((id) => {
      const result = measureFeature(points, id);
      const info = INGREDIENTS[id];
      if (result.missing) {
        return `<tr><th>${escapeHtml(info.short)}</th><td colspan="2" class="note">${done ? escapeHtml(result.missing) : 'waiting for measurements…'}</td></tr>`;
      }
      const amount = result.type === 'absorption'
        ? `τ = ${result.value.toFixed(2)} ± ${result.err.toFixed(2)} <span class="note">(about ${Math.round((1 - Math.exp(-result.value)) * 100)}% of the light absorbed)</span>`
        : `${result.value >= 0 ? '+' : ''}${Math.round(result.value * 100)}% ± ${Math.round(result.err * 100)}% <span class="note">(glow above the continuum)</span>`;
      const verdict = result.detected ? `<strong>Seen</strong> (${result.sigma.toFixed(1)}σ)` : `Not seen (${result.sigma.toFixed(1)}σ)`;
      return `<tr><th>${escapeHtml(info.short)}</th><td>${amount}</td><td>${verdict}</td></tr>`;
    }).join('');
    liveBox.innerHTML = `
      <p class="note small">${escapeHtml(measured?.name ?? '')}: ${points.length} SPHEREx measurements${done ? '' : ' so far'}.</p>
      <table class="chem-live small"><tbody>${rows}</tbody></table>
      <p class="note small">"Seen" means at least ${DETECTION_SIGMA}σ. Ice features are dips (τ = how much light is absorbed);
        the PAH feature is a glow. Strong ice in front of a source makes the PAH continuum less certain. This is a quick
        check from SPHEREx's measurements here, not a published result.</p>`;
  }
  photometry.onUpdate(showLive);
  checkButton.addEventListener('click', () => {
    checking = true;
    const current = photometry.current();
    const target = subject();
    const sameSpot = current.subject && separationArcsec(current.subject.ra, current.subject.dec, target.ra, target.dec) < 1;
    liveBox.innerHTML = '<p class="note small">Measuring this spot in every SPHEREx image… (new spots can take a few minutes)</p>';
    if (sameSpot && (current.done || current.points.length)) showLive(current);
    else photometry.measure(target);
  });

  show();
  return {
    /** Apply a search from the URL or the search box. */
    setQuery(next) {
      Object.assign(query, { ingredients: [], match: 'all', preset: undefined }, next);
      show();
    },
    describe: () => (query.preset || query.ingredients.length ? describeQuery() : ''),
  };
}
