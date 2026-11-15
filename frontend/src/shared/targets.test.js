import { describe, expect, it } from 'vitest';
import { featuredTargets, findFeatured, suggestFeatured } from './targets.js';

describe('featured targets', () => {
  it('has the five challenge targets', () => {
    expect(featuredTargets.map((t) => t.slug)).toEqual([
      'barnards-star', 'eps-indi-b', 'wise-0855', 'rw-aurigae', 'r-draconis',
    ]);
  });

  it('finds targets by name, slug or alias, loosely', () => {
    expect(findFeatured("Barnard's Star").slug).toBe('barnards-star');
    expect(findFeatured('BARNARDS STAR').slug).toBe('barnards-star');
    expect(findFeatured('gj 699').slug).toBe('barnards-star');
    expect(findFeatured('R Dra').slug).toBe('r-draconis');
    expect(findFeatured('eps-indi-b').slug).toBe('eps-indi-b');
    expect(findFeatured('Sirius')).toBeUndefined();
  });

  it('suggests a featured target for small spelling mistakes', () => {
    expect(suggestFeatured('Barnads Star').slug).toBe('barnards-star');
    expect(suggestFeatured('R Draconsi').slug).toBe('r-draconis');
    expect(suggestFeatured('Betelgeuse')).toBeUndefined();
    expect(suggestFeatured('ab')).toBeUndefined();
  });
});
