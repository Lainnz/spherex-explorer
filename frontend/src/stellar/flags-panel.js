/**
 * The Flags tab (PLAN.md §7.8, §8.3 part 7, C7): every quality flag of the image on screen,
 * with its official name and a plain-English label, how much of the view it covers,
 * whether it sits on the target, a quality badge, coloured overlays on the sky, and a
 * choice of which flags to leave out of the frames.
 */
import datasets from '../shared/config.js';
import { API_BASE, getJson } from '../shared/api.js';
import { firstImage } from './info-panel.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {{root: HTMLElement, sequence: object, overlay: object, state: object, live: boolean,
 *          getDemo: () => Promise<object|null>, onExcludeChange: (flags: string[]) => void}} options
 */
export function setupFlagsPanel({ root, sequence, overlay, state, live, getDemo, onExcludeChange }) {
  const body = root.querySelector('[data-flags]');
  const badge = root.querySelector('[data-quality]');
  const applyButton = root.querySelector('[data-apply-exclusions]');
  const cache = new Map();
  let excluded = new Set(datasets.flags_default_exclude);
  let shownKey = null;
  let current = null; // {frame, flags}
  const visibleMasks = new Set();
  let timer = null;

  async function flagsFor(image) {
    const key = `${image.obsId}:D${image.detector}`;
    if (cache.has(key)) return cache.get(key);
    let flags = null;
    if (live) {
      const grid = sequence.grid();
      flags = await getJson(`/api/flags/${encodeURIComponent(image.obsId)}`, {
        detector: image.detector, ...(grid ? { ra: grid.ra, dec: grid.dec } : {}), fov_arcsec: state.fov,
      }, { timeoutMs: 120000 });
    } else {
      flags = (await getDemo())?.flags?.[key] ?? null;
    }
    cache.set(key, flags);
    return flags;
  }

  async function updateMasks() {
    if (!current?.flags) {
      overlay.setMasks([]);
      return;
    }
    const masks = [];
    for (const flag of current.flags.flags) {
      if (!visibleMasks.has(flag.name) || !flag.mask_url) continue;
      try {
        const url = flag.mask_url.startsWith('/api/') ? `${API_BASE}${flag.mask_url}` : flag.mask_url;
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        masks.push({ frame: current.frame, bitmap });
      } catch {
        // skip a mask that won't load
      }
    }
    overlay.setMasks(masks);
  }

  function render() {
    const { flags } = current;
    badge.textContent = flags.quality;
    badge.dataset.quality = flags.quality.replaceAll(' ', '-').toLowerCase();
    badge.title = `${flags.bad_pixel_percent}% of pixels in view carry a bad-pixel flag`;
    body.innerHTML = flags.flags.map((flag) => `
      <tr class="${flag.at_target ? 'at-target' : ''}">
        <td><input type="checkbox" data-mask="${escapeHtml(flag.name)}" ${visibleMasks.has(flag.name) ? 'checked' : ''}
             ${flag.mask_url ? '' : 'disabled'} aria-label="Show ${escapeHtml(flag.name)} on the sky" /></td>
        <td><span class="mono">${escapeHtml(flag.name)}</span><br /><small>${escapeHtml(flag.label)}${flag.info_only ? ' · information only' : ''}</small></td>
        <td class="mono">${flag.percent_of_pixels.toFixed(1)}%</td>
        <td>${flag.at_target ? '<span title="On the target pixel">●</span>' : ''}</td>
        <td><input type="checkbox" data-exclude="${escapeHtml(flag.name)}" ${excluded.has(flag.name) ? 'checked' : ''}
             ${flag.info_only ? 'disabled' : ''} aria-label="Leave ${escapeHtml(flag.name)} pixels out" /></td>
      </tr>`).join('');
  }

  async function update() {
    const frame = sequence.current();
    const image = firstImage(frame);
    const key = image && `${image.obsId}:D${image.detector}`;
    if (key === shownKey) return;
    shownKey = key;
    if (!image) {
      current = null;
      body.innerHTML = '<tr><td colspan="5" class="note">Choose a single-detector frame to see its flags.</td></tr>';
      badge.textContent = '';
      overlay.setMasks([]);
      return;
    }
    body.innerHTML = '<tr><td colspan="5" class="note">Loading flags…</td></tr>';
    try {
      const flags = await flagsFor(image);
      if (shownKey !== key) return;
      if (!flags) {
        body.innerHTML = `<tr><td colspan="5" class="note">${live ? "Couldn't load flags."
          : 'Saved demo data includes flags for one image per target (the first frame). Live mode shows every image.'}</td></tr>`;
        overlay.setMasks([]);
        return;
      }
      current = { frame, flags };
      render();
      updateMasks();
    } catch (error) {
      if (shownKey === key) body.innerHTML = `<tr><td colspan="5" class="note">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  body.addEventListener('change', (event) => {
    const mask = event.target.dataset.mask;
    const exclude = event.target.dataset.exclude;
    if (mask) {
      if (event.target.checked) visibleMasks.add(mask);
      else visibleMasks.delete(mask);
      updateMasks();
    }
    if (exclude) {
      if (event.target.checked) excluded.add(exclude);
      else excluded.delete(exclude);
      applyButton.disabled = false;
    }
  });
  applyButton.addEventListener('click', () => {
    applyButton.disabled = true;
    onExcludeChange([...excluded]);
  });
  applyButton.disabled = true;

  sequence.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(update, 300);
  });
  return { update, excluded: () => [...excluded] };
}
