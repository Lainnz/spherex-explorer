/**
 * Turning SPHEREx frames (Float32 numbers) into pictures, and frame arithmetic
 * (PLAN.md §7.6, §8.3). Pure functions, used inside the Web Worker (ops.worker.js) and
 * tested directly. Frames are row-major, row 0 = north (top), NaN = no data.
 */

// --- Colour maps -------------------------------------------------------------------------
// viridis and inferno: polynomial fits by Matt Zucker ("Simple, efficient colormap
// approximations", CC0), accurate to about 1% of matplotlib's tables.
const POLY = {
  viridis: [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ],
  inferno: [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ],
};
// cividis (colour-blind friendly): approximated from five stops of matplotlib's map.
const CIVIDIS_STOPS = [
  [0.0, 0.0, 0.135, 0.305],
  [0.25, 0.235, 0.299, 0.427],
  [0.5, 0.488, 0.484, 0.471],
  [0.75, 0.737, 0.69, 0.43],
  [1.0, 0.995, 0.909, 0.217],
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A 256-entry RGB lookup table (Uint8Array of 768) for a colour map name. */
export function colourTable(name) {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let rgb;
    if (POLY[name]) {
      rgb = [0, 1, 2].map((c) => POLY[name].reduceRight((sum, coefficients) => sum * t + coefficients[c], 0));
    } else if (name === 'cividis') {
      let k = 0;
      while (k < CIVIDIS_STOPS.length - 2 && t > CIVIDIS_STOPS[k + 1][0]) k += 1;
      const [t0, ...a] = CIVIDIS_STOPS[k];
      const [t1, ...b] = CIVIDIS_STOPS[k + 1];
      const f = (t - t0) / (t1 - t0);
      rgb = [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * f);
    } else {
      rgb = [t, t, t]; // gray
    }
    for (let c = 0; c < 3; c += 1) table[i * 3 + c] = Math.round(clamp01(rgb[c]) * 255);
  }
  return table;
}

// --- Brightness ranges -----------------------------------------------------------------------
/** The p-th percentile (0–100) of the finite values, or NaN if there are none. */
export function percentile(values, p) {
  const finite = [];
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i])) finite.push(values[i]);
  if (!finite.length) return Number.NaN;
  finite.sort((a, b) => a - b);
  const position = (clamp01(p / 100)) * (finite.length - 1);
  const low = Math.floor(position);
  const high = Math.min(finite.length - 1, low + 1);
  return finite[low] + (finite[high] - finite[low]) * (position - low);
}

/**
 * (vmin, vmax) clipping the faintest (100 − trim)% and the brightest (100 − trim)% of pixels
 * across all the given frames (WiseView's "Trim Bright"). Shared ranges make blinking fair.
 * @param {Float32Array[]} frames
 * @param {number} trim e.g. 99.5
 */
export function percentRange(frames, trim) {
  const combined = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const frame of frames) {
    combined.set(frame, offset);
    offset += frame.length;
  }
  let vmin = percentile(combined, 100 - trim);
  let vmax = percentile(combined, trim);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return [0, 1];
  if (vmax <= vmin) vmax = vmin + 1e-6;
  return [vmin, vmax];
}

/** A range centred on zero, for difference images (black = fainter, white = brighter). */
export function symmetricRange(frame, trim) {
  const magnitudes = Float32Array.from(frame, Math.abs);
  const limit = percentile(magnitudes, trim);
  return Number.isFinite(limit) && limit > 0 ? [-limit, limit] : [-1, 1];
}

/**
 * Brightness → 0..1 with an asinh curve (WiseView's "Linear" slider): small `softening`
 * brings out faint things without burning out bright stars; large is almost linear.
 */
export function stretchValue(value, vmin, vmax, softening) {
  const x = clamp01((value - vmin) / (vmax - vmin));
  return Math.asinh(x / softening) / Math.asinh(1 / softening);
}

/**
 * A frame → RGBA pixels (for ImageData). NaN pixels become fully transparent.
 * @returns {Uint8ClampedArray}
 */
export function renderFrame(data, { vmin, vmax, softening, cmap }) {
  const table = colourTable(cmap);
  const rgba = new Uint8ClampedArray(data.length * 4);
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (!Number.isFinite(value)) continue; // stays transparent
    const level = Math.round(stretchValue(value, vmin, vmax, softening) * 255) * 3;
    rgba[i * 4] = table[level];
    rgba[i * 4 + 1] = table[level + 1];
    rgba[i * 4 + 2] = table[level + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Three frames → one colour picture (each channel stretched on its own).
 * @param {[Float32Array, Float32Array, Float32Array]} channels red, green, blue
 */
export function renderComposite(channels, { trim, softening }) {
  const ranges = channels.map((frame) => percentRange([frame], trim));
  const length = channels[0].length;
  const rgba = new Uint8ClampedArray(length * 4);
  for (let i = 0; i < length; i += 1) {
    let any = false;
    for (let c = 0; c < 3; c += 1) {
      const value = channels[c][i];
      if (Number.isFinite(value)) {
        rgba[i * 4 + c] = Math.round(stretchValue(value, ranges[c][0], ranges[c][1], softening) * 255);
        any = true;
      }
    }
    rgba[i * 4 + 3] = any ? 255 : 0;
  }
  return rgba;
}

// --- Frame arithmetic (PLAN.md §7.6) ---------------------------------------------------------
/**
 * Combine frames pixel by pixel, skipping NaN.
 * "median" makes a still-sky template where anything that moved disappears.
 * @param {Float32Array[]} frames  all the same size
 * @param {"mean"|"median"|"sum"} method
 */
export function stackFrames(frames, method) {
  const length = frames[0].length;
  const result = new Float32Array(length);
  const values = new Float64Array(frames.length);
  for (let i = 0; i < length; i += 1) {
    let n = 0;
    for (const frame of frames) if (Number.isFinite(frame[i])) values[n++] = frame[i];
    if (!n) {
      result[i] = Number.NaN;
      continue;
    }
    if (method === 'median') {
      const sorted = values.subarray(0, n).sort();
      result[i] = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    } else {
      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += values[k];
      result[i] = method === 'sum' ? sum : sum / n;
    }
  }
  return result;
}

/**
 * A − B. Something that moved becomes a bright/dark pair; a star that changed brightness
 * becomes a single bright or dark spot. `normalize` first scales B to best match A
 * (least squares), which helps when they were taken at slightly different wavelengths.
 */
export function differenceFrames(a, b, normalize = true) {
  let scale = 1;
  if (normalize) {
    let ab = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        ab += a[i] * b[i];
        bb += b[i] * b[i];
      }
    }
    if (bb > 0) scale = ab / bb;
  }
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) result[i] = a[i] - scale * b[i];
  return result;
}
