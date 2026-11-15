/**
 * Stellarium-style navigation (PLAN.md §8.3, part 2), as the team described it:
 * - Rotate tool (default): dragging turns the view around its centre; the centre stays put.
 * - Move tool (hand): dragging pans away from the coordinate. The URL coordinate doesn't change.
 * - Return home: back to the coordinate, field of view and rotation 0.
 * - Set as new coordinate: the current centre becomes the coordinate (URL updates).
 * - Zoom: + / − buttons (×2 per click), mouse wheel, pinch, keyboard + and −.
 * Keyboard: R rotate tool, M move tool, H return home.
 *
 * In rotate mode a see-through layer over the sky catches the pointer, so Aladin doesn't
 * pan. A click without dragging is passed on (Phase 9 uses it to identify objects).
 */
import { Crosshair, createElement, Hand, LocateFixed, RotateCw, ZoomIn, ZoomOut } from 'lucide';
import { angleAround, angleDifference, formatAngle, separationArcsec } from './nav-math.js';

const DRAG_THRESHOLD_PX = 4;
const WHEEL_STEP = 1.15;
// Sign between "dragged clockwise on screen" and Aladin's rotation angle.
const ROTATION_SIGN = -1;

function button(icon, label, shortcut) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'tool';
  element.title = shortcut ? `${label} (${shortcut})` : label;
  element.setAttribute('aria-label', label);
  element.append(createElement(icon, { 'aria-hidden': 'true' }));
  return element;
}

/**
 * @param {{sky: object, surface: HTMLElement, toolbar: HTMLElement, movedChip: HTMLElement,
 *          home: {ra: number, dec: number, fovDeg: number},
 *          onSetHome: (place: {ra: number, dec: number}) => void,
 *          onSkyClick?: (place: {ra: number, dec: number, x: number, y: number}) => void,
 *          reducedMotion: boolean}} options
 */
export function setupNavTools({ sky, surface, toolbar, movedChip, home, onSetHome, onSkyClick, reducedMotion }) {
  const tools = {
    zoomIn: button(ZoomIn, 'Zoom in', '+'),
    zoomOut: button(ZoomOut, 'Zoom out', '−'),
    rotate: button(RotateCw, 'Rotate tool: drag to turn the view around its centre', 'R'),
    move: button(Hand, 'Move tool: drag to look around', 'M'),
    home: button(Crosshair, 'Return to your coordinate', 'H'),
    setHome: button(LocateFixed, 'Set the centre of the view as your new coordinate'),
  };
  toolbar.append(...Object.values(tools));

  // See-through layer that catches drags in rotate mode.
  const catcher = document.createElement('div');
  catcher.className = 'drag-catcher';
  surface.append(catcher);

  let mode = 'rotate';
  function setMode(next) {
    mode = next;
    catcher.hidden = mode !== 'rotate';
    tools.rotate.setAttribute('aria-pressed', String(mode === 'rotate'));
    tools.move.setAttribute('aria-pressed', String(mode === 'move'));
  }
  setMode('rotate');

  const zoomBy = (factor) => sky.setFovDeg(sky.fovDeg() * factor, { animate: !reducedMotion });

  // --- Rotate, click and pinch on the catcher ------------------------------------------
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const centre = () => {
    const box = catcher.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  catcher.addEventListener('pointerdown', (event) => {
    catcher.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), fov: sky.fovDeg() };
      drag = null;
      return;
    }
    const c = centre();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      startAngle: angleAround(c.x, c.y, event.clientX, event.clientY),
      startRotation: sky.rotation(),
      moved: false,
    };
  });

  catcher.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0) sky.setFovDeg((pinch.fov * pinch.distance) / distance);
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const c = centre();
    const turned = angleDifference(angleAround(c.x, c.y, event.clientX, event.clientY), drag.startAngle);
    sky.setRotation(drag.startRotation + ROTATION_SIGN * turned);
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && event.type === 'pointerup' && onSkyClick) {
      const box = catcher.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const place = sky.pixelToSky(x, y);
      if (place) onSkyClick({ ...place, x, y });
    }
    drag = null;
  };
  catcher.addEventListener('pointerup', endPointer);
  catcher.addEventListener('pointercancel', endPointer);

  catcher.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
  }, { passive: false });

  // --- Buttons and keys ------------------------------------------------------------------
  function animateRotationToZero() {
    const from = sky.rotation();
    if (reducedMotion || Math.abs(from) < 0.01) {
      sky.setRotation(0);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 600);
      sky.setRotation(from * (1 - t * (2 - t)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function returnHome() {
    sky.goTo(home.ra, home.dec, { animate: !reducedMotion, seconds: 1 });
    sky.setFovDeg(home.fovDeg, { animate: !reducedMotion });
    animateRotationToZero();
  }

  function setHomeHere() {
    const here = sky.center();
    home.ra = here.ra;
    home.dec = here.dec;
    home.fovDeg = sky.fovDeg();
    sky.setTarget(here.ra, here.dec);
    updateMovedChip();
    onSetHome(here);
  }

  tools.zoomIn.addEventListener('click', () => zoomBy(0.5));
  tools.zoomOut.addEventListener('click', () => zoomBy(2));
  tools.rotate.addEventListener('click', () => setMode('rotate'));
  tools.move.addEventListener('click', () => setMode('move'));
  tools.home.addEventListener('click', returnHome);
  tools.setHome.addEventListener('click', setHomeHere);

  window.addEventListener('keydown', (event) => {
    if (event.target.closest?.('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    const actions = {
      '+': () => zoomBy(0.5), '=': () => zoomBy(0.5), '-': () => zoomBy(2), _: () => zoomBy(2),
      r: () => setMode('rotate'), m: () => setMode('move'), h: returnHome,
    };
    const action = actions[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      action();
    }
  });

  // --- "You've moved X from your coordinate" -----------------------------------------------
  function updateMovedChip() {
    const here = sky.center();
    const moved = separationArcsec(home.ra, home.dec, here.ra, here.dec);
    const threshold = Math.max(5, sky.fovDeg() * 3600 * 0.05);
    movedChip.hidden = moved < threshold;
    if (!movedChip.hidden) {
      movedChip.querySelector('[data-moved]').textContent = `You've moved ${formatAngle(moved)} from your coordinate`;
    }
  }
  movedChip.querySelector('button')?.addEventListener('click', returnHome);
  sky.on('positionChanged', updateMovedChip);
  sky.on('zoomChanged', updateMovedChip);

  return { returnHome, setMode, zoomBy, updateMovedChip };
}
