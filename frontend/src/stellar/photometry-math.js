/**
 * Spectrum and light-curve helpers (PLAN.md §7.7): binning into SPHEREx's 102 channels,
 * choosing a wavelength window, and CSV export. Pure functions, tested directly.
 */

/** Points with a usable number (saturated ones have flux null). */
export const measurable = (points) =>
  points.filter((p) => Number.isFinite(p.flux_ujy) && Number.isFinite(p.err_ujy) && p.err_ujy > 0);

/**
 * Average points into the nearest of the 102 channel wavelengths (inverse-variance
 * weighted), like backend/app/photometry.py bin_spectrum().
 */
export function binSpectrum(points, channelWavelengths) {
  const bins = new Map();
  for (const point of measurable(points)) {
    let channel = 0;
    let gap = Infinity;
    channelWavelengths.forEach((wl, i) => {
      const g = Math.abs(wl - point.wavelength_um);
      if (g < gap) {
        gap = g;
        channel = i;
      }
    });
    if (!bins.has(channel)) bins.set(channel, []);
    bins.get(channel).push(point);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([channel, members]) => {
    const weights = members.map((p) => 1 / p.err_ujy ** 2);
    const total = weights.reduce((a, b) => a + b, 0);
    return {
      channel,
      wavelength_um: channelWavelengths[channel],
      flux_ujy: members.reduce((sum, p, i) => sum + weights[i] * p.flux_ujy, 0) / total,
      err_ujy: 1 / Math.sqrt(total),
      n_points: members.length,
    };
  });
}

/**
 * A sensible default wavelength window for a light curve: the detector with the most
 * clean points, so the curve compares like with like.
 * @returns {[number, number] | null} [min, max] in µm
 */
export function defaultWindow(points) {
  const counts = new Map();
  for (const p of measurable(points)) {
    if (p.flagged) continue;
    counts.set(p.detector, (counts.get(p.detector) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const detector = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const wavelengths = points.filter((p) => p.detector === detector).map((p) => p.wavelength_um);
  return [Math.min(...wavelengths), Math.max(...wavelengths)];
}

/** Points inside a wavelength window. */
export const inWindow = (points, [min, max]) => points.filter((p) => p.wavelength_um >= min && p.wavelength_um <= max);

/**
 * Rows → CSV text (header from the column names; numbers as-is, text quoted if needed).
 * @param {object[]} rows
 * @param {string[]} columns
 */
export function toCsv(rows, columns) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) value = value.join(' ');
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n') + '\n';
}

/** Let the browser save some text as a file. */
export function downloadText(text, filename, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
