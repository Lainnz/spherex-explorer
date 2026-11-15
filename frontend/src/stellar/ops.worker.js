/**
 * Web Worker: picture-making and frame arithmetic away from the main thread, so dragging
 * the time slider never stutters (PLAN.md §9.2). Messages in, transferable results out.
 *
 * Requests ({id, type, ...}):
 *   render     {data, width, height, vmin, vmax, softening, cmap} → {bitmap}
 *   composite  {channels: [r, g, b], width, height, trim, softening} → {bitmap}
 *   stack      {frames: [Float32Array…], method} → {data}
 *   difference {a, b, normalize} → {data}
 * Errors come back as {id, error}.
 */
import { differenceFrames, renderComposite, renderFrame, stackFrames } from './render-math.js';

async function toBitmap(rgba, width, height) {
  return createImageBitmap(new ImageData(rgba, width, height));
}

self.addEventListener('message', async (event) => {
  const { id, type } = event.data;
  try {
    if (type === 'render') {
      const { data, width, height, ...display } = event.data;
      const bitmap = await toBitmap(renderFrame(data, display), width, height);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else if (type === 'composite') {
      const { channels, width, height, trim, softening } = event.data;
      const bitmap = await toBitmap(renderComposite(channels, { trim, softening }), width, height);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else if (type === 'stack') {
      const data = stackFrames(event.data.frames, event.data.method);
      self.postMessage({ id, data }, [data.buffer]);
    } else if (type === 'difference') {
      const data = differenceFrames(event.data.a, event.data.b, event.data.normalize);
      self.postMessage({ id, data }, [data.buffer]);
    } else {
      throw new Error(`Unknown request: ${type}`);
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
});
