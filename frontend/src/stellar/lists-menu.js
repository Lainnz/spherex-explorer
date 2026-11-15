/**
 * "★ Favourites (n)" and "✓ Selected (n)" in the header (PLAN.md §8.3 part 3): counters with
 * a drop-down list. Clicking a name opens it in the Stellar View; × removes it.
 */
import { favourites, onListsChange, selected } from '../shared/store.js';
import { buildStellarUrl } from '../shared/url-state.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Where a saved item opens: a planet's profile, a place looked up by name, or a position. */
function linkFor(item) {
  if (item.kind === 'planet') return buildStellarUrl({ ra: item.ra, dec: item.dec, target: item.host, planet: item.planet });
  if (item.resolve) return buildStellarUrl({ target: item.resolve });
  return buildStellarUrl({ ra: item.ra, dec: item.dec, target: item.kind === 'place' ? item.name : undefined });
}

export function setupListsMenu(root) {
  const lists = { favourites, selected };

  function render() {
    for (const [name, list] of Object.entries(lists)) {
      const menu = root.querySelector(`[data-list="${name}"]`);
      const items = list.list();
      menu.querySelector('[data-count]').textContent = String(items.length);
      menu.querySelector('ul').innerHTML = items.length
        ? items.map((item) => `
            <li>
              <a href="${escapeHtml(linkFor(item))}">${escapeHtml(item.name)}</a>
              <small>${escapeHtml(item.type ?? '')}${item.distance_ly ? ` · ${item.distance_ly.toLocaleString()} ly` : ''}</small>
              <button type="button" data-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
            </li>`).join('')
        : '<li class="note">Nothing yet. Click a star on the sky, or ★ Save a place or planet, to add it.</li>';
    }
  }

  root.addEventListener('click', (event) => {
    const id = event.target.dataset?.remove;
    if (!id) return;
    const listName = event.target.closest('[data-list]').dataset.list;
    lists[listName].remove(id);
  });
  onListsChange(render);
  render();
}
