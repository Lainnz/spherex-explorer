/**
 * The title page's 3D scene (PLAN.md §8.2, §9.1): night-side Earth at the bottom of the
 * screen, real stars, comets, a spacecraft and meteors, plus the fly-away transition.
 *
 * Loaded on demand (dynamic import) so the page shows instantly and the Stellar View
 * never downloads three.js.
 *
 * Orientation: the sky (stars and Earth's axis) is turned so that today's real Sun sits
 * just behind the Earth and slightly above it. We see the night side with city lights
 * and a thin bright rim of sunlit atmosphere, like the team's reference image.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { createEarth, loadEarthTextures } from './earth.js';
import { createFlyers } from './flyers.js';
import { greenwichSiderealDegrees, skyDirection, sunPosition } from './sky.js';
import { createStarfield, decodeStarfield } from './starfield.js';
import { transitionState } from './transition.js';

const BASE = import.meta.env.BASE_URL;
const DEG = Math.PI / 180;
const EARTH_RADIUS = 1.4;
// Earth's centre sits below the screen, so only its top shows as a curved horizon.
const EARTH_CENTER = new Vector3(0, -1.55, 0);
const CAMERA_START = new Vector3(0, 0, 1.6);
const CAMERA_AWAY = new Vector3(0, 1.6, 7.5);
const STAR_RADIUS = 900;
const SUN_IN_VIEW = new Vector3(0, 0.35, -1).normalize(); // behind the Earth, a little above
const SECONDS_PER_TURN = 210; // one Earth turn every 3.5 minutes
const SLOW_FRAME_MS = 20; // adaptive quality kicks in above this average
const FORWARD = new Vector3(0, 0, -1);

/**
 * The rotation that takes sky directions to world directions so that the real Sun
 * (at `date`) lands at SUN_IN_VIEW with celestial north roughly up.
 */
function skyOrientation(date) {
  const sun = sunPosition(date);
  const sunSky = new Vector3(...skyDirection(sun.ra, sun.dec));
  const basis = (a, up) => {
    const b = up.clone().addScaledVector(a, -a.dot(up)).normalize();
    const c = new Vector3().crossVectors(a, b);
    return new Matrix4().makeBasis(a, b, c);
  };
  const fromSky = basis(sunSky, new Vector3(0, 1, 0));
  const toWorld = basis(SUN_IN_VIEW.clone(), new Vector3(0, 1, 0));
  return new Quaternion().setFromRotationMatrix(toWorld.multiply(fromSky.transpose()));
}

/** A guess at how much the device can handle, refined later by measuring frame times. */
function initialQuality() {
  const cores = navigator.hardwareConcurrency ?? 4;
  const shortSide = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768);
  return cores >= 4 && shortSide >= 700 ? 'high' : 'low';
}

/**
 * Start the scene in `canvas`.
 * @param {HTMLCanvasElement} canvas
 * @param {{reducedMotion: boolean, onFps?: (fps: number) => void, onFade?: (opacity: number) => void}} options
 * @returns {Promise<{flyTo: (dest: {ra: number, dec: number}, onArrive: () => void) => void,
 *                    skip: () => void, dispose: () => void}>}
 */
export async function startScene(canvas, { reducedMotion, onFps, onFade }) {
  const quality = initialQuality();
  const renderer = new WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(new Color('#050A18'));

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.copy(CAMERA_START);
  camera.lookAt(0, 0, 0);

  const now = new Date();
  const skyQuaternion = skyOrientation(now);
  const sunWorld = SUN_IN_VIEW.clone();

  // Stars and textures load together; the low-resolution set first so the globe appears fast.
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const [starBuffer, lowTextures] = await Promise.all([
    fetch(`${BASE}data/starfield.bin`).then((response) => response.arrayBuffer()),
    loadEarthTextures(`${BASE}textures/`, '1024', anisotropy),
  ]);

  const stars = createStarfield(decodeStarfield(starBuffer, STAR_RADIUS));
  stars.mesh.quaternion.copy(skyQuaternion);
  stars.uniforms.uTwinkle.value = reducedMotion ? 0 : 1;
  scene.add(stars.mesh);

  const earth = createEarth({ radius: EARTH_RADIUS, sunDirection: sunWorld });
  earth.setTextures(lowTextures);
  earth.group.position.copy(EARTH_CENTER);
  earth.group.quaternion.copy(skyQuaternion);
  scene.add(earth.group);

  const flyers = createFlyers({ earthRadius: EARTH_RADIUS, earthCenter: EARTH_CENTER });
  scene.add(flyers.group, flyers.meteorLines);
  const sunLight = new DirectionalLight(0xffffff, 2.2);
  sunLight.position.copy(sunWorld).multiplyScalar(10);
  scene.add(sunLight, new HemisphereLight(0x8fb4ff, 0x050a18, 0.5));

  // Sharper textures once the page is idle (desktop only).
  let sharpTextures = false;
  let keepLowTextures = false; // set once the device turns out to be slow
  if (quality === 'high') {
    const upgrade = () => loadEarthTextures(`${BASE}textures/`, '2048', anisotropy)
      .then((sharp) => {
        if (disposed || keepLowTextures) return sharp && Object.values(sharp).forEach((t) => t.dispose());
        earth.setTextures(sharp);
        sharpTextures = true;
      })
      .catch(() => {}); // keep the low-resolution set
    (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(upgrade);
  }

  // --- Sizing -------------------------------------------------------------------------
  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    stars.uniforms.uViewport.value.set(width * pixelRatio, height * pixelRatio);
    stars.uniforms.uPixelRatio.value = pixelRatio;
    flyers.setPixelRatio(pixelRatio);
  }
  resize();
  window.addEventListener('resize', resize);

  // --- Gentle parallax from the pointer ------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const onPointer = (event) => {
    pointer.x = event.clientX / window.innerWidth - 0.5;
    pointer.y = event.clientY / window.innerHeight - 0.5;
  };
  if (!reducedMotion) window.addEventListener('pointermove', onPointer);

  // --- Animation ------------------------------------------------------------------------
  const timeScale = reducedMotion ? 0.25 : 1;
  const gmst = greenwichSiderealDegrees(now) * DEG;
  let spin = gmst;
  let cloudDrift = 0;
  let sceneTime = 0;
  let lastTimestamp = null;
  let disposed = false;
  let flight = null; // {start, from, to, onArrive}
  const lookTarget = new Vector3();
  const parallax = new Vector3();

  // Frame-time tracking for the FPS readout and adaptive quality.
  let frames = 0;
  let windowStart = 0;
  let qualityStep = 0;
  let slowWindowMs = 0;
  let slowWindowFrames = 0;

  function degradeQuality() {
    qualityStep += 1;
    if (qualityStep === 1) {
      keepLowTextures = true;
      if (sharpTextures) {
        loadEarthTextures(`${BASE}textures/`, '1024', anisotropy).then((t) => !disposed && earth.setTextures(t));
      }
    }
    if (qualityStep === 2) stars.setVisibleCount(stars.total * 0.5);
    if (qualityStep === 3) flyers.setTailDetail(0.4);
    if (qualityStep === 4) {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      resize();
    }
  }

  function frame(timestamp) {
    const dt = lastTimestamp === null ? 0 : Math.min(0.1, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;

    let state = null;
    if (flight) {
      state = transitionState((timestamp - flight.start) / 1000, { reducedMotion });
      onFade?.(state.fade);
      if (state.done) {
        const { onArrive } = flight;
        flight = null;
        onArrive();
        return;
      }
    }
    const boost = state ? state.spinBoost : 1;
    sceneTime += dt * timeScale;
    spin += ((2 * Math.PI) / SECONDS_PER_TURN) * dt * timeScale * boost;
    cloudDrift += 0.004 * dt * timeScale * boost;
    earth.setSpin(spin, cloudDrift);
    earth.setCloudOpacity(0.85 - 0.35 * Math.min(1, (boost - 1) / 39));
    flyers.update(sceneTime, dt, { meteors: !reducedMotion && !flight });
    stars.uniforms.uTime.value = sceneTime;
    stars.uniforms.uWarp.value = state ? state.warp : 0;

    if (state) {
      // Pull away from the Earth while the sky swings the target to the centre of view.
      camera.position.lerpVectors(CAMERA_START, CAMERA_AWAY, state.travel);
      stars.mesh.quaternion.slerpQuaternions(flight.from, flight.to, state.turn);
      lookTarget.copy(camera.position).add(FORWARD);
      camera.lookAt(lookTarget);
    } else if (!reducedMotion) {
      parallax.set(pointer.x * 0.08, -pointer.y * 0.04, 0);
      camera.position.lerp(lookTarget.copy(CAMERA_START).add(parallax), 0.05);
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);

    frames += 1;
    slowWindowFrames += 1;
    slowWindowMs += dt * 1000;
    if (timestamp - windowStart >= 500) {
      onFps?.(Math.round((frames * 1000) / (timestamp - windowStart)));
      frames = 0;
      windowStart = timestamp;
    }
    if (slowWindowMs >= 2000) {
      if (!flight && slowWindowMs / slowWindowFrames > SLOW_FRAME_MS && qualityStep < 4) degradeQuality();
      slowWindowMs = 0;
      slowWindowFrames = 0;
    }
  }

  const start = () => {
    lastTimestamp = null;
    renderer.setAnimationLoop(frame);
  };
  const onVisibility = () => (document.hidden ? renderer.setAnimationLoop(null) : start());
  document.addEventListener('visibilitychange', onVisibility);
  start();

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    earth.dispose();
    stars.dispose();
    flyers.dispose();
    renderer.dispose();
  }

  return {
    /** Fly toward a sky position, then call onArrive (after cleaning up the scene). */
    flyTo({ ra, dec }, onArrive) {
      const target = new Vector3(...skyDirection(ra, dec)).applyQuaternion(skyQuaternion);
      const align = new Quaternion().setFromUnitVectors(target, FORWARD);
      flight = {
        start: performance.now(),
        from: stars.mesh.quaternion.clone(),
        to: align.multiply(skyQuaternion),
        onArrive: () => {
          dispose();
          onArrive();
        },
      };
    },
    /** Jump straight to the end of the fly-away (click or Esc). */
    skip() {
      if (flight) flight.start -= 10_000;
    },
    dispose,
  };
}
