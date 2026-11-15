import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALADIN_URL } from '../shared/aladin-url.js';
import { prepareStellarView, withTimeout } from './prefetch.js';

afterEach(() => vi.unstubAllGlobals());

function fakeFetch() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(String(url));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
  }));
  return calls;
}

describe('prepareStellarView', () => {
  it('downloads Aladin and the demo data, and starts the image search when live', async () => {
    const calls = fakeFetch();
    await prepareStellarView({ ra: 269.45, dec: 4.69, target: 'barnards-star' }, { live: true, fov: 300 });
    expect(calls).toContain(ALADIN_URL);
    expect(calls.some((url) => url.endsWith('data/demo/barnards-star/manifest.json'))).toBe(true);
    expect(calls.some((url) => url.includes('/api/observations?') && url.includes('target=barnards-star'))).toBe(true);
  });

  it("doesn't ask the server when it's asleep", async () => {
    const calls = fakeFetch();
    await prepareStellarView({ ra: 10, dec: 20 }, { live: false });
    expect(calls).toEqual([ALADIN_URL]);
  });

  it('never fails, even if downloads do', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(prepareStellarView({ ra: 10, dec: 20 }, { live: true })).resolves.toBeUndefined();
  });
});

describe('withTimeout', () => {
  it('gives up after the time limit', async () => {
    expect(await withTimeout(new Promise(() => {}), 10, 'late')).toBe('late');
    expect(await withTimeout(Promise.resolve('fast'), 1000)).toBe('fast');
  });
});
