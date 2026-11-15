/**
 * Planets and Earth (Milestone 4): turning NASA Exoplanet Archive rows into planets,
 * the habitable zone, the Earth Similarity Index and a plain comparison with Earth.
 * Pure functions, so they can be tested without a browser.
 *
 * Sources:
 * - ESI: Schulze-Makuch et al. 2011, Astrobiology 11, 1041. ESI = Π (1 − |(x − x⊕)/(x + x⊕)|)^(w/n)
 *   over radius (w 0.57), bulk density (1.07), escape velocity (0.70), surface temperature
 *   (5.58, Earth 288 K). Exoplanet surface temperatures are unknown, so the equilibrium
 *   temperature stands in, and only the properties actually known are used (n = how many).
 * - Habitable zone: Kopparapu et al. 2013/2014 conservative limits (runaway greenhouse to
 *   maximum greenhouse), S_eff = S⊙ + aT + bT² + cT³ + dT⁴ with T = T_eff − 5780 K, valid for
 *   2600–7200 K stars.
 * - Size classes: Kepler mission convention (Borucki et al. 2011).
 */
import atmospheres from '../../../config/planet_atmospheres.json';

export const ATMOSPHERES = atmospheres.planets;
export const MOLECULES = atmospheres.molecules;

export const EARTH = {
  radius: 1, // Earth radii (6,371 km)
  mass: 1, // Earth masses
  density: 5.51, // g/cm³
  escape: 1, // Earth units (11.19 km/s)
  surfaceTemp: 288, // K, the ESI's reference
  eqTemp: 255, // K, Earth's equilibrium temperature (what an airless Earth would be)
  insol: 1, // starlight received
  period: 365.25, // days
  orbit: 1, // au
  starTemp: 5772, // K, the Sun
};

const LY_PER_PC = 3.2616;

export const ESI_WEIGHTS = { radius: 0.57, density: 1.07, escape: 0.7, temperature: 5.58 };

export const SIZE_CLASSES = [
  { id: 'earth', label: 'Earth-size', max: 1.25 },
  { id: 'super', label: 'Super-Earth', max: 2 },
  { id: 'neptune', label: 'Neptune-size', max: 6 },
  { id: 'jupiter', label: 'Jupiter-size', max: 15 },
  { id: 'larger', label: 'Larger', max: Infinity },
];

const HZ = {
  inner: { s: 1.107, a: 1.332e-4, b: 1.58e-8, c: -8.308e-12, d: -1.931e-15 }, // runaway greenhouse
  outer: { s: 0.356, a: 6.171e-5, b: 1.698e-9, c: -3.198e-12, d: -5.575e-16 }, // maximum greenhouse
};

const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/** One archive row (in `columns` order) → a planet object with friendly names. */
export function toPlanet(columns, row) {
  const get = (name) => row[columns.indexOf(name)];
  const radius = num(get('pl_rade'));
  const mass = num(get('pl_bmasse'));
  const name = get('pl_name');
  return {
    name,
    host: get('hostname'),
    ra: num(get('ra')),
    dec: num(get('dec')),
    distanceLy: num(get('sy_dist')) != null ? num(get('sy_dist')) * LY_PER_PC : null,
    radius,
    mass,
    density: num(get('pl_dens')) ?? (radius && mass ? (mass / radius ** 3) * EARTH.density : null),
    eqTemp: num(get('pl_eqt')),
    insolGiven: num(get('pl_insol')),
    period: num(get('pl_orbper')),
    orbit: num(get('pl_orbsmax')),
    starTemp: num(get('st_teff')),
    starLogLum: num(get('st_lum')),
    starType: get('st_spectype') || null,
    year: num(get('disc_year')),
    method: get('discoverymethod') || null,
    atmosphere: ATMOSPHERES[name] ?? null,
  };
}

/** Starlight received (Earth = 1): the archive's value, or luminosity / orbit². */
export function insolation(planet) {
  if (planet.insolGiven != null) return planet.insolGiven;
  if (planet.starLogLum != null && planet.orbit > 0) return 10 ** planet.starLogLum / planet.orbit ** 2;
  return null;
}

/** Habitable-zone limits in starlight (Earth = 1) for a star temperature, or null outside 2600–7200 K. */
export function habitableZone(starTemp) {
  if (!(starTemp >= 2600 && starTemp <= 7200)) return null;
  const t = starTemp - 5780;
  const at = ({ s, a, b, c, d }) => s + a * t + b * t ** 2 + c * t ** 3 + d * t ** 4;
  return { inner: at(HZ.inner), outer: at(HZ.outer) };
}

/** true / false, or null when the star or the starlight isn't known. */
export function inHabitableZone(planet) {
  const zone = habitableZone(planet.starTemp);
  const s = insolation(planet);
  if (!zone || s == null) return null;
  return s <= zone.inner && s >= zone.outer;
}

export function sizeClass(radius) {
  if (radius == null) return null;
  return SIZE_CLASSES.find((c) => radius < c.max) ?? SIZE_CLASSES.at(-1);
}

const similarity = (x, x0) => 1 - Math.abs((x - x0) / (x + x0));

/**
 * Earth Similarity Index from the properties we know.
 * @returns {{value: number, parts: {id: string, label: string, planet: number, earth: number, weight: number, score: number}[]} | null}
 */
export function earthSimilarity(planet) {
  const parts = [];
  if (planet.radius != null) parts.push({ id: 'radius', label: 'Radius (Earth = 1)', planet: planet.radius, earth: 1 });
  if (planet.density != null) parts.push({ id: 'density', label: 'Density (Earth = 1)', planet: planet.density / EARTH.density, earth: 1 });
  if (planet.radius != null && planet.mass != null) {
    parts.push({ id: 'escape', label: 'Escape velocity (Earth = 1)', planet: Math.sqrt(planet.mass / planet.radius), earth: 1 });
  }
  if (planet.eqTemp != null) parts.push({ id: 'temperature', label: 'Temperature, K (equilibrium as stand-in)', planet: planet.eqTemp, earth: EARTH.surfaceTemp });
  if (parts.length < 2) return null;
  const weights = { radius: ESI_WEIGHTS.radius, density: ESI_WEIGHTS.density, escape: ESI_WEIGHTS.escape, temperature: ESI_WEIGHTS.temperature };
  let value = 1;
  for (const part of parts) {
    part.weight = weights[part.id];
    part.score = similarity(part.planet, part.earth);
    value *= part.score ** (part.weight / parts.length);
  }
  return { value, parts };
}

const times = (x) => (x >= 10 ? `${Math.round(x)}×` : x >= 1 ? `${x.toFixed(1)}×` : `${x.toFixed(2)}×`);
const close = (ratio, tolerance = 0.25) => ratio >= 1 / (1 + tolerance) && ratio <= 1 + tolerance;

/**
 * Plain-language comparison rows: {label, planet, earth, similar: bool, note}.
 * Only properties the archive knows are compared.
 */
export function compareWithEarth(planet) {
  const rows = [];
  const add = (label, planetText, earthText, similar, note) => rows.push({ label, planet: planetText, earth: earthText, similar, note });
  if (planet.radius != null) {
    add('Size', `${planet.radius.toFixed(2)} Earth radii`, '1 Earth radius', close(planet.radius),
      `${times(planet.radius)} Earth's width · ${sizeClass(planet.radius).label}`);
  }
  if (planet.mass != null) {
    add('Mass', `${planet.mass.toFixed(planet.mass < 10 ? 2 : 0)} Earth masses`, '1 Earth mass', close(planet.mass, 0.5),
      `${times(planet.mass)} Earth's mass${planet.radius == null ? ' (may be a minimum mass)' : ''}`);
  }
  if (planet.density != null) {
    const rocky = planet.density >= 3.5;
    add('Density', `${planet.density.toFixed(2)} g/cm³`, `${EARTH.density} g/cm³`, close(planet.density / EARTH.density),
      rocky ? 'dense enough to be mostly rock and metal, like Earth' : 'too light to be bare rock: lots of water, ice or gas');
  }
  const s = insolation(planet);
  if (s != null) {
    add('Starlight received', `${times(s)} Earth's`, '1×', close(s, 0.5),
      s > 1.5 ? 'much more than Earth: hotter' : s < 0.67 ? 'much less than Earth: colder' : 'similar to Earth');
  }
  if (planet.eqTemp != null) {
    const diff = planet.eqTemp - EARTH.eqTemp;
    add('Temperature (no atmosphere)', `${Math.round(planet.eqTemp)} K (${Math.round(planet.eqTemp - 273.15)} °C)`,
      `${EARTH.eqTemp} K (${EARTH.eqTemp - 273} °C)`, Math.abs(diff) <= 30,
      `${Math.abs(Math.round(diff))} K ${diff >= 0 ? 'warmer' : 'colder'} than airless Earth; real surfaces also depend on the atmosphere`);
  }
  if (planet.period != null) {
    add('Year length', `${planet.period < 2 ? planet.period.toFixed(2) : Math.round(planet.period).toLocaleString()} days`, '365 days',
      close(planet.period / EARTH.period, 0.3), planet.period < 30 ? 'a very short year: it orbits close to its star' : '');
  }
  if (planet.starTemp != null) {
    add('Its star', `${Math.round(planet.starTemp).toLocaleString()} K${planet.starType ? ` (${planet.starType})` : ''}`,
      `${EARTH.starTemp.toLocaleString()} K (G2 V, the Sun)`, Math.abs(planet.starTemp - EARTH.starTemp) <= 600,
      planet.starTemp < 4000 ? 'a cool red dwarf, redder and dimmer than the Sun' : planet.starTemp > 6500 ? 'hotter and bluer than the Sun' : 'a star rather like the Sun');
  }
  const hz = inHabitableZone(planet);
  if (hz !== null) add('Habitable zone', hz ? 'inside' : 'outside', 'inside', hz, hz ? 'where liquid water could exist on the surface, given the right atmosphere' : '');
  return rows;
}

/**
 * Filter and sort planets.
 * @param {object[]} planets
 * @param {{sizes?: string[], habitable?: boolean, tempMin?: number, tempMax?: number,
 *          maxDistanceLy?: number, minEsi?: number, molecule?: string, query?: string}} filters
 */
export function filterPlanets(planets, filters = {}) {
  const query = filters.query?.trim().toLowerCase();
  const list = planets.filter((p) => {
    if (query && !p.name.toLowerCase().includes(query) && !p.host?.toLowerCase().includes(query)) return false;
    if (filters.sizes?.length && !filters.sizes.includes(sizeClass(p.radius)?.id)) return false;
    if (filters.habitable && inHabitableZone(p) !== true) return false;
    if (filters.tempMin != null && !(p.eqTemp >= filters.tempMin)) return false;
    if (filters.tempMax != null && !(p.eqTemp <= filters.tempMax)) return false;
    if (filters.maxDistanceLy != null && !(p.distanceLy <= filters.maxDistanceLy)) return false;
    if (filters.molecule && !p.atmosphere?.detected.includes(filters.molecule)) return false;
    if (filters.minEsi != null && !((earthSimilarity(p)?.value ?? -1) >= filters.minEsi)) return false;
    return true;
  });
  const esi = new Map(list.map((p) => [p, earthSimilarity(p)?.value ?? -1]));
  return list.sort((a, b) => esi.get(b) - esi.get(a) || (a.distanceLy ?? Infinity) - (b.distanceLy ?? Infinity));
}

/** The values a saved planet remembers, to tell what changed when you come back. */
export function planetSnapshot(planet) {
  return { radius: planet.radius, mass: planet.mass, eqTemp: planet.eqTemp, insol: insolation(planet), period: planet.period };
}

/** "Radius 1.10 → 1.20" lines for values the archive changed since the snapshot (> 1% or newly known). */
export function changesSince(snapshot, planet) {
  if (!snapshot) return [];
  const now = planetSnapshot(planet);
  const labels = { radius: 'Radius (Earth radii)', mass: 'Mass (Earth masses)', eqTemp: 'Temperature (K)', insol: 'Starlight (Earth = 1)', period: 'Year (days)' };
  const out = [];
  for (const [key, label] of Object.entries(labels)) {
    const before = snapshot[key];
    const after = now[key];
    if (after == null) continue;
    if (before == null) out.push(`${label}: now known, ${Number(after.toPrecision(3))}`);
    else if (Math.abs(after - before) > Math.abs(before) * 0.01) out.push(`${label}: ${Number(before.toPrecision(3))} → ${Number(after.toPrecision(3))}`);
  }
  return out;
}
