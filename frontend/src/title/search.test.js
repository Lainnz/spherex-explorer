import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomDestination } from './randomize.js';
import { resolveQuery } from './search.js';

afterEach(() => vi.unstubAllGlobals());

function fakeServer(responses) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = new URL(url).pathname;
    const { status = 200, body } = responses[path] ?? { status: 500, body: {} };
    return { ok: status < 400, status, json: async () => body };
  }));
}

describe('resolveQuery', () => {
  it('reads coordinates without asking the server', async () => {
    fakeServer({});
    const place = await resolveQuery('17:57:48.97 +04:41:36.1', { live: true });
    expect(place.ra).toBeCloseTo(269.454, 3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds featured targets offline', async () => {
    const place = await resolveQuery("barnard's star", { live: false });
    expect(place).toMatchObject({ target: 'barnards-star', name: "Barnard's Star", fov: 300 });
  });

  it('asks the server about other names', async () => {
    fakeServer({ '/api/resolve': { body: { ra: 88.79, dec: 7.41, name: 'alf Ori' } } });
    expect(await resolveQuery('Betelgeuse', { live: true })).toMatchObject({ ra: 88.79, name: 'alf Ori' });
  });

  it('suggests a featured target for a misspelling', async () => {
    fakeServer({ '/api/resolve': { status: 404, body: { error: 'not_found', message: 'nope' } } });
    await expect(resolveQuery('Barnads Star', { live: true })).rejects.toMatchObject({
      message: `We couldn't find "Barnads Star". Did you mean Barnard's Star?`,
      suggestion: { slug: 'barnards-star' },
    });
  });

  it('explains demo mode when a name needs the server', async () => {
    await expect(resolveQuery('Betelgeuse', { live: false })).rejects.toThrow(/asleep/);
  });

  it('asks for something to search', async () => {
    await expect(resolveQuery('   ', { live: true })).rejects.toThrow(/Type a star/);
  });
});

describe('randomDestination', () => {
  it('uses the server when it is awake', async () => {
    fakeServer({ '/api/random': { body: { ra: 10, dec: 20, fov_arcsec: 600, name: null, source: 'uniform' } } });
    expect(await randomDestination({ live: true })).toMatchObject({ ra: 10, dec: 20, fov: 600 });
  });

  it('picks a featured target or famous sight offline', async () => {
    const pick = await randomDestination({ live: false, random: () => 0 });
    expect(pick).toMatchObject({ target: 'barnards-star' });
  });
});
