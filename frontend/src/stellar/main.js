/** Stellar View entry point. Phase 7 replaces the URL readout with the Aladin Lite sky. */
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/stellar.css';
import datasets from '../shared/config.js';
import { clampFov, formatFov, parseFov } from '../shared/fov.js';
import { renderFooter, showHealth } from '../shared/ui.js';

/** Show what the page read from its URL, so the URL scheme can be checked early. */
function showUrlReadout(el) {
  const params = new URLSearchParams(window.location.search);
  const limits = datasets.limits;
  const parsedFov = parseFov(params.get('fov') ?? '');
  const fov = clampFov(parsedFov ?? limits.default_fov_arcsec, limits);

  const rows = [
    ['target', params.get('target') ?? '(none)'],
    ['ra', params.get('ra') ?? '(none)'],
    ['dec', params.get('dec') ?? '(none)'],
    ['fov', `${formatFov(fov)} (${fov} arcsec)${parsedFov === null ? ' · default' : ''}`],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    el.append(dt, dd);
  }
}

showUrlReadout(document.querySelector('[data-url-readout]'));
renderFooter(document.querySelector('[data-footer]'));
showHealth(document.querySelector('[data-health]'));
