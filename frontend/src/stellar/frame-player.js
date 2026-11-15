/**
 * Frame Player (PLAN.md §8.3, part 4): the current frame alone, enlarged, WiseView-style,
 * with zoom up to 1200% (each SPHEREx pixel drawn as a sharp square). Playback, stepping
 * and blinking keep working while it's open.
 */
export function setupFramePlayer({ panel, toggle, sequence }) {
  const canvas = panel.querySelector('canvas');
  const zoom = panel.querySelector('#player-zoom');
  const zoomValue = panel.querySelector('[data-zoom-value]');
  const label = panel.querySelector('[data-player-label]');
  const context = canvas.getContext('2d');
  let drawn = null;

  async function draw() {
    if (panel.hidden) return;
    const frame = sequence.current();
    if (!frame) return;
    const scale = Number(zoom.value) / 100;
    zoomValue.textContent = `${zoom.value}%`;
    label.textContent = frame.label;
    const bitmap = await sequence.bitmapFor(frame);
    if (sequence.current() !== frame) return;
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    drawn = frame;
  }

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-pressed', String(!panel.hidden));
    drawn = null;
    draw();
  });
  panel.querySelector('[data-close]').addEventListener('click', () => toggle.click());
  zoom.addEventListener('input', () => {
    drawn = null;
    draw();
  });
  sequence.onChange((what) => {
    if (what === 'display' || sequence.current() !== drawn) {
      drawn = null;
      draw();
    }
  });
}
