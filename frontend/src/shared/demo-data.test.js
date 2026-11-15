// Checks the saved demo data (made by scripts/build_demo_data.py) is complete and small.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, '../../public/data/demo');
const TARGETS = join(HERE, '../../../config/targets.json');
const BUDGET_BYTES = 25e6; // PLAN.md §8.6

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function folderSize(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const full = join(path, entry.name);
    return total + (entry.isDirectory() ? folderSize(full) : statSync(full).size);
  }, 0);
}

describe('saved demo data', () => {
  const index = readJson(join(DEMO, 'index.json'));
  const featured = readJson(TARGETS).targets.map((t) => t.slug);

  it('covers every featured target', () => {
    expect(index.targets.map((t) => t.slug)).toEqual(featured);
  });

  it(`stays under ${BUDGET_BYTES / 1e6} MB`, () => {
    expect(folderSize(DEMO)).toBeLessThan(BUDGET_BYTES);
  });

  for (const slug of featured) {
    it(`${slug}: frames, photometry and popups are complete`, () => {
      const folder = join(DEMO, slug);
      const manifest = readJson(join(folder, 'manifest.json'));
      const frames = manifest.frames_stream;

      expect(frames[0].type).toBe('start');
      expect(frames.at(-1)).toMatchObject({ type: 'done', images_failed: 0 });
      const frameMessages = frames.filter((m) => m.type === 'frame');
      expect(frameMessages.length).toBeGreaterThan(0);
      for (const frame of frameMessages) {
        for (const key of ['png_url', 'f32_url', 'fits_url']) {
          expect(existsSync(join(folder, frame[key])), frame[key]).toBe(true);
        }
        // Raw numbers: one 4-byte float per pixel.
        expect(statSync(join(folder, frame.f32_url)).size).toBe(frame.width * frame.height * 4);
      }

      const photometry = manifest.photometry_stream;
      expect(photometry[0].type).toBe('start');
      expect(photometry.at(-1).type).toBe('done');
      expect(photometry.filter((m) => m.type === 'point').length).toBe(photometry.at(-1).points);

      expect(manifest.objects[0].found).toBe(true);
      for (const flags of Object.values(manifest.flags)) {
        for (const flag of flags.flags) {
          if (flag.mask_url) expect(existsSync(join(folder, flag.mask_url)), flag.mask_url).toBe(true);
        }
      }
    });
  }
});
