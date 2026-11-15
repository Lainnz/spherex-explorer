import { describe, expect, it } from 'vitest';
import { embedSnippet, fullSiteUrl } from './embed.js';

const PAGE = 'https://lainnz.github.io/spherex-explorer/stellar.html?ra=269.45208&dec=4.69337&fov=300';

describe('sharing', () => {
  it('makes an iframe snippet with embed=1 (PLAN.md §8.4)', () => {
    const snippet = embedSnippet(PAGE);
    expect(snippet).toContain(`src="${PAGE}&embed=1"`);
    expect(snippet).toContain('width="800" height="500"');
  });

  it('links an embedded view back to the full site', () => {
    expect(fullSiteUrl(`${PAGE}&embed=1`)).toBe(PAGE);
  });
});
