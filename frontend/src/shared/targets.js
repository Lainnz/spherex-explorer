/**
 * Featured targets and "interesting" spots (config/targets.json), usable without the
 * data server: names typed into the search box are matched here first.
 */
import targetsFile from '../../../config/targets.json';

export const featuredTargets = targetsFile.targets;
export const interestingSpots = targetsFile.interesting;

/** Compare names loosely, like the backend: "Barnard's Star" = "barnards-star". */
export const normalizeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

const namesOf = (target) => [target.slug, target.name, ...(target.aliases ?? [])];

/**
 * The featured target called `name` (slug, name or alias), or undefined.
 * @param {string} name
 */
export function findFeatured(name) {
  const wanted = normalizeName(name);
  return featuredTargets.find((target) => namesOf(target).some((n) => normalizeName(n) === wanted));
}

/** Number of single-letter edits between two strings (Levenshtein distance). */
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * A featured target whose name is close to a misspelled `name`, for "Did you mean …?".
 * Allows about one mistake per four letters.
 * @param {string} name
 */
export function suggestFeatured(name) {
  const wanted = normalizeName(name);
  if (wanted.length < 3) return undefined;
  let best;
  let bestDistance = Infinity;
  for (const target of featuredTargets) {
    for (const candidate of namesOf(target)) {
      const distance = editDistance(wanted, normalizeName(candidate));
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
  }
  return bestDistance <= Math.max(1, Math.floor(wanted.length / 4)) ? best : undefined;
}
