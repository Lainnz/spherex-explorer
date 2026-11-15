import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFrames } from './frames-source.js';

afterEach(() => vi.unstubAllGlobals());

const frameMessage = (id, t) => ({ type: 'frame', frame_id: id, t_mid: t, width: 2, height: 1, f32_url: `/f/${id}.f32` });

function stubFetch(streamText) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('/api/frames')) {
      // Deliver the stream in awkward chunks, splitting lines, like a real network.
      const bytes = new TextEncoder().encode(streamText);
      const body = new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
          controller.close();
        },
      });
      return { ok: true, body };
    }
    return { ok: true, arrayBuffer: async () => Float32Array.from([1, 2]).buffer };
  }));
}

describe('loadFrames', () => {
  it('reads a streamed (NDJSON) answer, even split mid-line', async () => {
    const stream = [
      { type: 'start', frames_total: 2 }, frameMessage('a', 1), { type: 'progress', frames_ready: 1 },
      frameMessage('b', 2), { type: 'done', images_failed: 0 },
    ].map((m) => JSON.stringify(m)).join('\n');
    stubFetch(stream);
    const seen = [];
    await loadFrames({
      live: true, request: {}, signal: new AbortController().signal,
      onStart: () => seen.push('start'), onFrame: (f) => seen.push(`${f.id}:${f.data.length}`),
      onProgress: () => seen.push('progress'), onDone: () => seen.push('done'),
    });
    expect(seen).toEqual(['start', 'a:2', 'progress', 'b:2', 'done']);
  });

  it('replays saved demo data', async () => {
    stubFetch('');
    const frames = [];
    await loadFrames({
      live: false, demo: { frames_stream: [{ type: 'start' }, frameMessage('x', 5), { type: 'done' }] },
      signal: new AbortController().signal, onStart() {}, onFrame: (f) => frames.push(f), onProgress() {}, onDone() {},
    });
    expect(frames.map((f) => f.id)).toEqual(['x']);
  });

  it('explains when there is no way to get frames', async () => {
    await expect(loadFrames({ live: false, signal: new AbortController().signal })).rejects.toThrow(/asleep/);
  });
});
