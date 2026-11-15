/**
 * Drawn over the Aladin sky (PLAN.md §8.3, part 1): the current SPHEREx frame, the
 * target's predicted motion track, and moving-star markers at the slider's date.
 *
 * Frames are placed by mapping three of their corners from sky to screen every animation
 * frame, so they follow Aladin's panning, zooming and rotation exactly. Over a field of a
 * degree or less, the straight (affine) mapping between corners is accurate to a small
 * fraction of a pixel.
 */
import { frameCorners, imageTransform, positionAt } from './frame-geometry.js';

const FADE_MS = 250;
const TRACK_POINTS = 24;
const TEAL = '#00B5BC';
const AMBER = '#F0B200';
const GAIA = '#F0E442';

/**
 * @param {{container: HTMLElement, sky: object, sequence: object, reducedMotion: boolean}} options
 */
export function createFrameOverlay({ container, sky, sequence, reducedMotion }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'frame-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const context = canvas.getContext('2d');

  let shown = null; // {frame, bitmap}
  let previous = null;
  let fadeStart = 0;
  let opacity = 0.85;
  let framesVisible = true;
  let target = null; // {name, motion}
  let movers = [];
  let masks = []; // flag overlays: [{bitmap, frame}] drawn with that frame's sky position
  let requested = null;
  const stats = { loops: 0, framesDrawn: 0, missingCorners: 0, lastAlpha: null, lastTransform: null };

  // When the current frame changes, fetch its picture, then cross-fade to it.
  async function refresh() {
    const frame = sequence.current();
    if (!frame || frame === shown?.frame) return;
    requested = frame;
    try {
      const bitmap = await sequence.bitmapFor(frame);
      if (requested !== frame) return; // something newer was asked for meanwhile
      previous = shown;
      shown = { frame, bitmap };
      fadeStart = performance.now();
    } catch (error) {
      console.warn('Could not draw frame', frame.id, error);
    }
  }
  sequence.onChange((what) => {
    if (what === 'display' || what === 'reset') {
      shown = null;
      previous = null;
    }
    refresh();
  });

  function toScreen(position) {
    return position && sky.skyToPixel(position.ra, position.dec);
  }

  /** Draw a picture on its frame's patch of sky; `strength` defaults to the frame opacity. */
  function drawFrame(entry, alpha, strength = opacity) {
    if (!entry || alpha <= 0) return;
    const { frame, bitmap } = entry;
    const corners = frameCorners(frame.wcs, frame.width, frame.height);
    const topLeft = toScreen(corners.topLeft);
    const topRight = toScreen(corners.topRight);
    const bottomLeft = toScreen(corners.bottomLeft);
    if (!topLeft || !topRight || !bottomLeft) {
      stats.missingCorners += 1;
      return;
    }
    const transform = imageTransform(topLeft, topRight, bottomLeft, frame.width, frame.height);
    context.save();
    context.globalAlpha = alpha * strength;
    context.imageSmoothingEnabled = false; // show SPHEREx's real pixels
    context.transform(...transform);
    context.drawImage(bitmap, 0, 0);
    context.restore();
    stats.framesDrawn += 1;
    stats.lastAlpha = alpha * strength;
    stats.lastTransform = transform;
  }

  function drawTrack(t) {
    if (!target?.motion) return;
    const [first, last] = sequence.span();
    context.save();
    context.strokeStyle = TEAL;
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    let started = false;
    for (let i = 0; i <= TRACK_POINTS; i += 1) {
      const point = toScreen(positionAt(target.motion, first + ((last - first) * i) / TRACK_POINTS));
      if (!point) continue;
      if (started) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
      started = true;
    }
    context.stroke();
    context.setLineDash([]);
    const now = toScreen(positionAt(target.motion, t));
    if (now) {
      context.strokeStyle = AMBER;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(now.x, now.y, 11, 0, 2 * Math.PI);
      context.stroke();
      label(`${target.name} (predicted)`, now.x + 14, now.y - 10, AMBER);
    }
    context.restore();
  }

  function drawMovers(t) {
    context.save();
    context.strokeStyle = GAIA;
    context.lineWidth = 1.2;
    for (const mover of movers) {
      const point = toScreen(positionAt(mover.motion, t));
      if (!point) continue;
      context.beginPath();
      context.arc(point.x, point.y, 6, 0, 2 * Math.PI);
      context.stroke();
      if (mover.pm_arcsec_per_year >= 1) label(`${mover.pm_arcsec_per_year.toFixed(1)}″/yr`, point.x + 8, point.y + 4, GAIA);
    }
    context.restore();
  }

  function label(text, x, y, colour) {
    context.font = '12px "Exo 2 Variable", sans-serif';
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(5, 10, 24, 0.85)';
    context.strokeText(text, x, y);
    context.fillStyle = colour;
    context.fillText(text, x, y);
  }

  function draw(now) {
    stats.loops += 1;
    const ratio = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (framesVisible) {
      const fade = reducedMotion ? 1 : Math.min(1, (now - fadeStart) / FADE_MS);
      if (fade < 1) drawFrame(previous, 1 - fade);
      drawFrame(shown, fade);
    }
    for (const mask of masks) drawFrame(mask, 1, 1); // flag overlays stay fully visible
    const t = sequence.time();
    if (t !== null) {
      drawMovers(t);
      drawTrack(t);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    setOpacity(value) {
      opacity = value;
    },
    setFramesVisible(visible) {
      framesVisible = visible;
    },
    /** @param {{name: string, motion: object} | null} next */
    setTarget(next) {
      target = next?.motion?.pmra != null ? next : null;
    },
    setMovers(next) {
      movers = next ?? [];
    },
    /** Flag overlays (Flags tab): pictures on the same grid as `frame`. */
    setMasks(next) {
      masks = next ?? [];
    },
    /** The picture currently on screen (for the Frame Player). */
    shown: () => shown,
    /** Counters for checking the overlay works (used by automated checks). */
    stats: () => ({ ...stats }),
  };
}
