/**
 * Talking to ops.worker.js with promises: `await worker.render({...})` etc.
 * Frame data is copied before sending, so the originals stay usable here.
 */
let worker = null;
let nextId = 1;
const waiting = new Map();

function ensureWorker() {
  if (!worker) {
    worker = new Worker(new URL('./ops.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { id, error, ...result } = event.data;
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result);
    });
  }
  return worker;
}

function ask(message, transfer = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, ...message }, transfer);
  });
}

const copy = (array) => new Float32Array(array);

/** Frame numbers → ImageBitmap with a colour map and stretch. */
export async function renderBitmap(data, width, height, display) {
  const own = copy(data);
  return (await ask({ type: 'render', data: own, width, height, ...display }, [own.buffer])).bitmap;
}

/** Three frames (red, green, blue) → one colour ImageBitmap. */
export async function compositeBitmap(channels, width, height, display) {
  const own = channels.map(copy);
  return (await ask({ type: 'composite', channels: own, width, height, ...display }, own.map((c) => c.buffer))).bitmap;
}

/** Combine frames pixel by pixel ("mean", "median" or "sum"). */
export async function stack(frames, method) {
  const own = frames.map(copy);
  return (await ask({ type: 'stack', frames: own, method }, own.map((f) => f.buffer))).data;
}

/** A − B (optionally brightness-matched). */
export async function difference(a, b, normalize = true) {
  const [ownA, ownB] = [copy(a), copy(b)];
  return (await ask({ type: 'difference', a: ownA, b: ownB, normalize }, [ownA.buffer, ownB.buffer])).data;
}
