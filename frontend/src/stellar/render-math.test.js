import { describe, expect, it } from 'vitest';
import {
  colourTable, differenceFrames, percentRange, percentile, renderComposite, renderFrame, stackFrames,
  stretchValue, symmetricRange,
} from './render-math.js';

const rgbAt = (table, i) => [table[i * 3], table[i * 3 + 1], table[i * 3 + 2]];

describe('colour maps', () => {
  it('match the published end colours', () => {
    expect(rgbAt(colourTable('gray'), 255)).toEqual([255, 255, 255]);
    // viridis runs from dark purple (#440154) to yellow (#FDE725)
    const viridis = colourTable('viridis');
    rgbAt(viridis, 0).forEach((v, c) => expect(Math.abs(v - [68, 1, 84][c])).toBeLessThan(6));
    rgbAt(viridis, 255).forEach((v, c) => expect(Math.abs(v - [253, 231, 37][c])).toBeLessThan(6));
    // inferno runs from black to pale yellow (#FCFFA4)
    const inferno = colourTable('inferno');
    rgbAt(inferno, 0).forEach((v) => expect(v).toBeLessThan(6));
    rgbAt(inferno, 255).forEach((v, c) => expect(Math.abs(v - [252, 255, 164][c])).toBeLessThan(8));
    expect(rgbAt(colourTable('cividis'), 0)).toEqual([0, 34, 78]);
  });
});

describe('brightness ranges', () => {
  it('finds percentiles, ignoring NaN', () => {
    expect(percentile([1, 2, 3, 4, 5, NaN], 50)).toBe(3);
    expect(percentile([0, 10], 25)).toBe(2.5);
    expect(percentile([NaN], 50)).toBeNaN();
  });

  it('shares one range across frames', () => {
    const a = Float32Array.from({ length: 100 }, (_, i) => i);
    const b = Float32Array.from({ length: 100 }, (_, i) => i + 100);
    const [vmin, vmax] = percentRange([a, b], 100);
    expect([vmin, vmax]).toEqual([0, 199]);
  });

  it('centres difference images on zero', () => {
    expect(symmetricRange(Float32Array.from([-4, 2, 1, 0]), 100)).toEqual([-4, 4]);
  });

  it('asinh stretch keeps the ends and lifts faint values', () => {
    expect(stretchValue(0, 0, 1, 0.1)).toBe(0);
    expect(stretchValue(1, 0, 1, 0.1)).toBeCloseTo(1, 10);
    // asinh(1)/asinh(10) ≈ 0.294: a 10% brightness shows at ~29%, faint things brought out
    expect(stretchValue(0.1, 0, 1, 0.1)).toBeCloseTo(0.294, 3);
    expect(stretchValue(0.1, 0, 1, 100)).toBeCloseTo(0.1, 3); // nearly linear
  });
});

describe('rendering', () => {
  it('makes NaN transparent and stretches the rest', () => {
    const rgba = renderFrame(Float32Array.from([0, 1, NaN]), { vmin: 0, vmax: 1, softening: 100, cmap: 'gray' });
    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([255, 255, 255, 255]);
    expect(rgba[11]).toBe(0);
  });

  it('builds colour composites channel by channel', () => {
    const on = Float32Array.from([0, 1]);
    const off = Float32Array.from([0, 0]);
    const rgba = renderComposite([on, off, off], { trim: 100, softening: 100 });
    expect(rgba[4]).toBe(255); // red where the red channel is bright
    expect(rgba[5]).toBe(0);
  });
});

describe('frame arithmetic', () => {
  it('median removes something that moves', () => {
    const frames = [0, 1, 2].map((k) => Float32Array.from([0, 0, 0], (_, i) => (i === k ? 100 : 0)));
    expect([...stackFrames(frames, 'median')]).toEqual([0, 0, 0]);
    expect([...stackFrames(frames, 'mean')].map((v) => Math.round(v))).toEqual([33, 33, 33]);
    expect([...stackFrames(frames, 'sum')]).toEqual([100, 100, 100]);
  });

  it('skips missing pixels when stacking', () => {
    const result = stackFrames([Float32Array.from([NaN, 2]), Float32Array.from([NaN, 4])], 'mean');
    expect(result[0]).toBeNaN();
    expect(result[1]).toBe(3);
  });

  it('a mover becomes a bright/dark pair in a difference', () => {
    const later = Float32Array.from([0, 0, 10]);
    const earlier = Float32Array.from([10, 0, 0]);
    expect([...differenceFrames(later, earlier, false)]).toEqual([-10, 0, 10]);
  });

  it('normalising matches brightness before subtracting', () => {
    const a = Float32Array.from([2, 4, 6]);
    const b = Float32Array.from([1, 2, 3]);
    expect([...differenceFrames(a, b, true)].map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
  });
});
