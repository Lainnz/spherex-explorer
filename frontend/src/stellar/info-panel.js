/**
 * The Info tab (PLAN.md §8.3 part 7, C7): details of the frame on screen and of the
 * SPHEREx image(s) it was made from: dates, wavelengths, release, survey, processing
 * version, zodiacal light, a link to the full image at IRSA, and the raw FITS header.
 */
import { getJson } from '../shared/api.js';
import { mjdToDate } from './timeline.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isoTime = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().replace('T', ' ').slice(0, 19);

/** Which image to describe: the first one listed for the frame. */
export const firstImage = (frame) => (frame?.obs_ids?.length && frame.detectors?.length === 1
  ? { obsId: frame.obs_ids[0], detector: frame.detectors[0] }
  : null);

/**
 * @param {{root: HTMLElement, sequence: object, state: object, live: boolean,
 *          getDemo: () => Promise<object|null>}} options
 */
export function setupInfoPanel({ root, sequence, state, live, getDemo }) {
  const frameList = root.querySelector('[data-frame-info]');
  const imageBox = root.querySelector('[data-image-info]');
  const metaCache = new Map();
  let shown = null;
  let timer = null;

  function row(label, value) {
    return value === undefined || value === null || value === '' ? '' : `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
  }

  function showFrame(frame) {
    if (!frame) {
      frameList.innerHTML = '<dd>No frame yet.</dd>';
      return;
    }
    if (frame.kind) {
      frameList.innerHTML = row('Result', escapeHtml(frame.label));
      return;
    }
    frameList.innerHTML = [
      row('Frame', escapeHtml(frame.label)),
      row('Middle of the images', `${escapeHtml(mjdToDate(frame.t_mid))} UTC (MJD ${frame.t_mid.toFixed(4)})`),
      row('First to last image', `${escapeHtml(isoTime(frame.t_start))} → ${escapeHtml(isoTime(frame.t_end))} UTC`),
      row('Detector', frame.detectors?.map((d) => `D${d}`).join(', ')),
      row('Wavelength at the target', frame.wavelength_um ? `${frame.wavelength_um.toFixed(3)} µm` : null),
      row('Images added together', String(frame.n_images)),
      row('Releases', escapeHtml(frame.releases?.map((r) => r.toUpperCase()).join(' + '))),
      row('Pixels filled in (saturated cores)', frame.filled_pixels ? String(frame.filled_pixels) : null),
    ].join('');
  }

  async function metaFor(image) {
    const key = `${image.obsId}:D${image.detector}`;
    if (metaCache.has(key)) return metaCache.get(key);
    let meta = null;
    if (live) {
      const grid = sequence.grid();
      meta = await getJson(`/api/meta/${encodeURIComponent(image.obsId)}`, {
        detector: image.detector, ...(grid ? { ra: grid.ra, dec: grid.dec } : {}), fov_arcsec: state.fov,
      }, { timeoutMs: 120000 });
    } else {
      meta = (await getDemo())?.meta?.[key] ?? null;
    }
    metaCache.set(key, meta);
    return meta;
  }

  function showImage(meta, image) {
    if (!meta) {
      imageBox.innerHTML = `<p class="note">${live
        ? "Couldn't load this image's details."
        : 'Saved demo data includes full details for one image per target (the first frame). Live mode shows every image.'}</p>`;
      return;
    }
    const header = meta.header.map(([section, key, value, comment]) =>
      `<tr><td>${escapeHtml(section)}</td><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(comment)}</td></tr>`).join('');
    imageBox.innerHTML = `
      <dl class="info-list">
        ${row('Image (obs_id)', `<span class="mono">${escapeHtml(meta.obs_id)}</span> · D${meta.detector}`)}
        ${row('Release', escapeHtml(meta.release.toUpperCase()))}
        ${row('Survey', meta.survey === 'deep' ? 'Deep Field (observed very often)' : 'Wide (all-sky)')}
        ${row('Wavelengths in this image', `${meta.wavelength_range_um[0]}–${meta.wavelength_range_um[1]} µm`)}
        ${row('Wavelength at the target', meta.wavelength_at_target_um ? `${meta.wavelength_at_target_um.toFixed(3)} µm (bandwidth ${meta.bandwidth_at_target_um.toFixed(3)} µm)` : null)}
        ${row('Taken', `${escapeHtml(meta.start_utc.replace('T', ' ').slice(0, 19))} UTC (MJD ${meta.start_mjd.toFixed(5)})`)}
        ${row('Exposure', `${meta.exposure_s} s`)}
        ${row('Zodiacal light at the target', meta.zodi_at_target_mjy_sr != null ? `${meta.zodi_at_target_mjy_sr} MJy/sr <button type="button" class="help" data-help="Sunlight scattered by dust in our solar system. It's a smooth glow that SPHEREx removes before you see the frames.">?</button>` : null)}
        ${row('Processing version', `<span class="mono">${escapeHtml(meta.processing_version)}</span> (pipeline ${escapeHtml(meta.pipeline_version)})`)}
      </dl>
      <p><a href="${escapeHtml(meta.irsa_url)}" target="_blank" rel="noopener">Download the full image from IRSA (about 70 MB) ↗</a></p>
      <details class="fits-header">
        <summary>Raw FITS header (${meta.header.length} lines)</summary>
        <div class="header-table"><table><thead><tr><th>Part</th><th>Key</th><th>Value</th><th>Comment</th></tr></thead><tbody>${header}</tbody></table></div>
      </details>`;
  }

  async function update() {
    const frame = sequence.current();
    showFrame(frame);
    const image = firstImage(frame);
    const key = image && `${image.obsId}:D${image.detector}`;
    if (key === shown) return;
    shown = key;
    if (!image) {
      imageBox.innerHTML = frame?.kind ? '' : '<p class="note">Choose a single-detector frame to see its images.</p>';
      return;
    }
    imageBox.innerHTML = '<p class="note">Loading image details…</p>';
    try {
      const meta = await metaFor(image);
      if (shown === key) showImage(meta, image);
    } catch (error) {
      if (shown === key) imageBox.innerHTML = `<p class="note">${escapeHtml(error.message)}</p>`;
    }
  }

  // Wait until playback settles on a frame before asking the server.
  sequence.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(update, 300);
  });
  return { update };
}
