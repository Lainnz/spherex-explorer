/**
 * Favourites and the Select list (PLAN.md §8.3 part 3, §14 #Account): saved in this
 * browser for now ("Saved on this device; accounts coming soon"). Kept behind a small
 * list/add/remove interface so it can later sync to an account backend, and so the
 * future 3D Time Machine can read the Select list.
 *
 * localStorage can be missing or blocked (private windows, embedded iframes), so every
 * access is wrapped and falls back to memory for this visit.
 */
const PREFIX = 'spherex-xplorer:';
const memory = new Map();

function read(name) {
  try {
    const text = window.localStorage.getItem(PREFIX + name);
    if (text !== null) return JSON.parse(text);
  } catch {
    // blocked or corrupted: use this visit's copy
  }
  return memory.get(name) ?? [];
}

function write(name, items) {
  memory.set(name, items);
  try {
    window.localStorage.setItem(PREFIX + name, JSON.stringify(items));
  } catch {
    // blocked: the in-memory copy still works until the page is closed
  }
}

const listeners = new Set();

/**
 * @param {"favourites"|"selected"} name
 */
export function createList(name) {
  return {
    /** @returns {{id: string, name: string, ra: number, dec: number}[]} */
    list: () => read(name),
    has: (id) => read(name).some((item) => item.id === id),
    add(item) {
      if (this.has(item.id)) return;
      write(name, [...read(name), { ...item, added: new Date().toISOString() }]);
      listeners.forEach((fn) => fn(name));
    },
    remove(id) {
      write(name, read(name).filter((item) => item.id !== id));
      listeners.forEach((fn) => fn(name));
    },
    /** Change some fields of a saved item (e.g. what was seen last time), keeping the rest. */
    update(id, changes) {
      if (!this.has(id)) return;
      write(name, read(name).map((item) => (item.id === id ? { ...item, ...changes } : item)));
      listeners.forEach((fn) => fn(name));
    },
    get: (id) => read(name).find((item) => item.id === id) ?? null,
    toggle(item) {
      if (this.has(item.id)) this.remove(item.id);
      else this.add(item);
      return this.has(item.id);
    },
  };
}

export const favourites = createList('favourites');
export const selected = createList('selected');

/** Call `fn(listName)` whenever either list changes. */
export function onListsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
