/** Small page pieces shared by the title page and the Stellar View. */
import { getHealth } from './api.js';
import datasets from './config.js';

/**
 * Fill a status element with "online" or "offline" for the data server.
 * @param {HTMLElement|null} el
 */
export async function showHealth(el) {
  if (!el) return;
  const health = await getHealth();
  if (health) {
    el.dataset.state = 'online';
    el.textContent = `Data server online · Releases: ${health.releases.map((r) => r.toUpperCase()).join(', ')}`;
  } else {
    el.dataset.state = 'offline';
    el.textContent = 'Data server offline · demo data will be used';
  }
}

/**
 * Credits footer: SPHEREx acknowledgement and DOIs come from datasets.json.
 * @param {HTMLElement|null} el
 */
export function renderFooter(el) {
  if (!el) return;
  const dois = [
    ...datasets.default_releases.map((id) => datasets.releases[id]),
    datasets.allsky_cube,
  ]
    .map((r) => `${r.label}: <a href="https://doi.org/${r.doi}">doi:${r.doi}</a>`)
    .join(' · ');

  el.innerHTML = `
    <p>This publication makes use of data products from the Spectro-Photometer for the History of the Universe,
      Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory
      and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.</p>
    <p>${dois}</p>
    <p>Data from NASA/IPAC Infrared Science Archive (IRSA) · Gaia (ESA) · WISE (NASA) ·
      Sky viewer: Aladin Lite and SIMBAD (CDS, Strasbourg)</p>
    <p><a href="https://github.com/Lainnz/spherex-explorer">SPHEREx Xplorer on GitHub</a> ·
      Releases: ${datasets.default_releases.map((r) => r.toUpperCase()).join(', ')}</p>`;
}
