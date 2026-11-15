/**
 * Getting the frames of the time sequence (PLAN.md §8.3, part 4):
 * - live: POST /api/frames and read its NDJSON answer line by line as it streams in;
 * - demo: replay the saved messages from the demo manifest.
 * Either way each frame's raw numbers (.f32) are downloaded once, so the browser can
 * re-colour and re-stretch them instantly.
 */
import { API_BASE, FriendlyError } from '../shared/api.js';

async function fetchFloat32(url, signal, expectedLength) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn't download ${url}`);
  const data = new Float32Array(await response.arrayBuffer());
  if (expectedLength && data.length !== expectedLength) throw new Error(`Unexpected frame size for ${url}`);
  return data;
}

/** Read an NDJSON stream message by message (also used for photometry). */
export async function* readLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
      newline = buffer.indexOf('\n');
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

/**
 * @param {{live: boolean, request: object, demo?: object, signal: AbortSignal,
 *          onStart: (start: object) => void, onFrame: (frame: object) => void,
 *          onProgress: (progress: object) => void, onDone: (done: object) => void}} options
 *   request: the POST /api/frames body; demo: the demo manifest (used when not live)
 */
export async function loadFrames({ live, request, demo, signal, onStart, onFrame, onProgress, onDone }) {
  let messages;
  let base = '';
  if (live) {
    const response = await fetch(`${API_BASE}/api/frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new FriendlyError(body.message || "The data server couldn't make the images.", { code: body.error });
    }
    messages = readLines(response);
    base = API_BASE;
  } else if (demo) {
    messages = demo.frames_stream;
  } else {
    throw new FriendlyError('The live data server is asleep, and this spot has no saved demo data.', { code: 'offline' });
  }

  for await (const message of messages) {
    if (signal.aborted) return;
    if (message.type === 'start') onStart(message);
    else if (message.type === 'progress') onProgress(message);
    else if (message.type === 'error') throw new FriendlyError(message.message, { code: message.error });
    else if (message.type === 'done') onDone(message);
    else if (message.type === 'frame') {
      const data = await fetchFloat32(`${base}${message.f32_url}`, signal, message.width * message.height);
      onFrame({ ...message, id: message.frame_id, data });
    }
  }
}
