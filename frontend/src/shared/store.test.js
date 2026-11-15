import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeStorage({ blocked = false } = {}) {
  const data = new Map();
  return {
    getItem: (key) => {
      if (blocked) throw new Error('blocked');
      return data.has(key) ? data.get(key) : null;
    },
    setItem: (key, value) => {
      if (blocked) throw new Error('blocked');
      data.set(key, value);
    },
  };
}

async function freshStore(storage) {
  vi.resetModules();
  vi.stubGlobal('window', { localStorage: storage });
  return import('./store.js');
}

afterEach(() => vi.unstubAllGlobals());

describe('favourites and selection', () => {
  let store;
  beforeEach(async () => {
    store = await freshStore(fakeStorage());
  });

  it('adds, lists, toggles and removes', () => {
    const star = { id: 'gaia-1', name: "Barnard's star", ra: 269.45, dec: 4.77 };
    store.favourites.add(star);
    store.favourites.add(star); // no duplicates
    expect(store.favourites.list().map((s) => s.id)).toEqual(['gaia-1']);
    expect(store.favourites.has('gaia-1')).toBe(true);
    expect(store.favourites.toggle(star)).toBe(false);
    expect(store.favourites.list()).toEqual([]);
  });

  it('keeps favourites and the Select list separate, and tells listeners', () => {
    const changes = [];
    store.onListsChange((name) => changes.push(name));
    store.selected.add({ id: 'x', name: 'X', ra: 1, dec: 2 });
    expect(store.favourites.list()).toEqual([]);
    expect(store.selected.list()).toHaveLength(1);
    expect(changes).toEqual(['selected']);
  });
});

describe('when the browser blocks storage', () => {
  it('still works for this visit', async () => {
    const store = await freshStore(fakeStorage({ blocked: true }));
    store.selected.add({ id: 'y', name: 'Y', ra: 3, dec: 4 });
    expect(store.selected.has('y')).toBe(true);
  });
});
