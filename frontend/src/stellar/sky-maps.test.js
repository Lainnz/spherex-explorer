import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../shared/url-state.js';
import { falseColourPlanes, NO_SERVER_MAP, SKY_MAPS } from './sky-view.js';

describe('sky maps', () => {
  it("builds the false-colour map from the same cube planes as Elaine's demo", () => {
    expect(falseColourPlanes('spherex_rgb')).toEqual([90, 46, 22]); // 4.600, 2.189, 1.254 µm
    expect(SKY_MAPS.spherex_rgb.url).toMatch(/\/api\/hips\/spherex-rgb\/90-46-22$/);
  });

  it('opens on SPHEREx false colour', () => {
    expect(DEFAULTS.base).toBe('spherex_rgb');
    expect(SKY_MAPS[DEFAULTS.base].server).toBe(true);
  });

  it('falls back to a SPHEREx map that needs no data server', () => {
    expect(SKY_MAPS[NO_SERVER_MAP].server).toBeFalsy();
    expect(SKY_MAPS[NO_SERVER_MAP].label).toMatch(/SPHEREx/);
  });

  it('labels every map with a group, so other telescopes are never mistaken for SPHEREx', () => {
    for (const spec of Object.values(SKY_MAPS)) expect(spec.group).toBeTruthy();
    expect(SKY_MAPS.twomass.note).toMatch(/Not SPHEREx/);
  });
});
