/**
 * Things moving around the Earth on the title page (PLAN.md §8.2): comets with glowing
 * tails, a small SPHEREx-like spacecraft on a polar orbit, two asteroids, and the odd
 * meteor streaking across the background.
 *
 * Anti-lag (§9.1): every comet head and tail particle is one draw call, meteors are one
 * draw call, asteroids are one instanced mesh. Buffers are updated in place; the
 * animation loop never creates new objects.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

const TAIL_POINTS = 48;
const METEOR_POOL = 6;

/** A tilted ellipse around the Earth's centre. Angles in radians, times in seconds. */
function makeOrbit({ a, e = 0, tiltX = 0, tiltZ = 0, period, phase = 0 }) {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tiltX)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tiltZ));
  return { a, e, rotation, period, phase };
}

/** Copy a vector into a flat array without creating anything new. */
function writeVector(array, offset, v) {
  array[offset] = v.x;
  array[offset + 1] = v.y;
  array[offset + 2] = v.z;
}

/** Position on an orbit at time t, written into `out` (relative to the Earth's centre). */
function orbitPosition(orbit, t, out) {
  // Mean anomaly → eccentric anomaly (a few Newton steps are plenty here).
  const M = orbit.phase + (2 * Math.PI * t) / orbit.period;
  let E = M;
  for (let i = 0; i < 4; i += 1) E -= (E - orbit.e * Math.sin(E) - M) / (1 - orbit.e * Math.cos(E));
  const b = orbit.a * Math.sqrt(1 - orbit.e * orbit.e);
  out.set(orbit.a * (Math.cos(E) - orbit.e), 0, b * Math.sin(E));
  return out.applyQuaternion(orbit.rotation);
}

const GLOW_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = aSize * uPixelRatio * (3.0 / max(-view.z, 0.1));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const GLOW_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float glow = exp(-dot(p, p) * 3.0) * vAlpha;
    if (glow < 0.01) discard;
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`;

/** A small, original spacecraft: an open cone telescope on a body with a sunshade panel. */
function createSpacecraft(scale) {
  const metal = new MeshStandardMaterial({ color: 0xd8dee8, metalness: 0.7, roughness: 0.35 });
  const dark = new MeshStandardMaterial({ color: 0x1e3256, metalness: 0.3, roughness: 0.6 });
  const craft = new Group();
  const cone = new Mesh(new ConeGeometry(0.55, 1.0, 20, 1, true), metal);
  cone.rotation.x = Math.PI; // wide end up, like the logo
  cone.position.y = 0.55;
  const body = new Mesh(new CylinderGeometry(0.22, 0.22, 0.35, 12), dark);
  body.position.y = -0.1;
  const panel = new Mesh(new BoxGeometry(0.6, 0.35, 0.03), dark);
  panel.position.set(0.5, -0.1, 0);
  craft.add(cone, body, panel);
  craft.scale.setScalar(scale);
  return craft;
}

/**
 * @param {{earthRadius: number, earthCenter: Vector3}} options
 */
export function createFlyers({ earthRadius: R, earthCenter }) {
  const group = new Group();
  group.position.copy(earthCenter);

  // --- Comets: 3 around the Earth plus 1 far away crossing slowly. -------------------
  const comets = [
    makeOrbit({ a: R * 1.75, e: 0.25, tiltX: 0.5, tiltZ: 0.3, period: 70, phase: 0.4 }),
    makeOrbit({ a: R * 2.05, e: 0.35, tiltX: -0.35, tiltZ: -0.6, period: 95, phase: 2.6 }),
    makeOrbit({ a: R * 1.55, e: 0.15, tiltX: 1.1, tiltZ: 0.1, period: 55, phase: 4.4 }),
    makeOrbit({ a: R * 12, e: 0.1, tiltX: 0.25, tiltZ: -0.2, period: 900, phase: 1.2 }),
  ];
  const tailLength = TAIL_POINTS;
  const glowCount = comets.length * tailLength;
  const glowPositions = new Float32Array(glowCount * 3);
  const glowSizes = new Float32Array(glowCount);
  const glowAlphas = new Float32Array(glowCount);
  const glowColors = new Float32Array(glowCount * 3);
  for (let c = 0; c < comets.length; c += 1) {
    const far = c === comets.length - 1;
    for (let k = 0; k < tailLength; k += 1) {
      const i = c * tailLength + k;
      const fade = 1 - k / tailLength;
      glowSizes[i] = (k === 0 ? 0.12 : 0.07 * fade + 0.01) * (far ? 6 : 1);
      glowAlphas[i] = k === 0 ? 1.0 : 0.55 * fade * fade;
      // Head white-blue, tail fading to teal.
      glowColors.set(k === 0 ? [0.9, 0.97, 1.0] : [0.45, 0.85 * fade + 0.3, 1.0], i * 3);
    }
  }
  const glowGeometry = new BufferGeometry();
  const glowPositionAttribute = new BufferAttribute(glowPositions, 3).setUsage(DynamicDrawUsage);
  glowGeometry.setAttribute('position', glowPositionAttribute);
  glowGeometry.setAttribute('aSize', new BufferAttribute(glowSizes, 1));
  glowGeometry.setAttribute('aAlpha', new BufferAttribute(glowAlphas, 1));
  glowGeometry.setAttribute('aColor', new BufferAttribute(glowColors, 3));
  const glowMaterial = new ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const glow = new Points(glowGeometry, glowMaterial);
  glow.frustumCulled = false;
  group.add(glow);

  // --- Spacecraft on a polar-ish orbit that passes over the visible horizon. ----------
  const craft = createSpacecraft(R * 0.025);
  const craftOrbit = makeOrbit({ a: R * 1.12, tiltX: 0.25, tiltZ: Math.PI / 2 - 0.35, period: 40, phase: 1.0 });
  group.add(craft);

  // --- Asteroids: one instanced mesh for both. ---------------------------------------
  const rockGeometry = new IcosahedronGeometry(R * 0.012, 0);
  const rockMaterial = new MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95, flatShading: true });
  const rocks = new InstancedMesh(rockGeometry, rockMaterial, 2);
  const rockOrbits = [
    makeOrbit({ a: R * 1.35, e: 0.05, tiltX: 0.15, tiltZ: 0.9, period: 48, phase: 3.0 }),
    makeOrbit({ a: R * 1.9, e: 0.2, tiltX: -0.7, tiltZ: 0.4, period: 110, phase: 5.2 }),
  ];
  group.add(rocks);

  // --- Meteors: short bright streaks far behind the Earth. ---------------------------
  const meteorPositions = new Float32Array(METEOR_POOL * 2 * 3);
  const meteorColors = new Float32Array(METEOR_POOL * 2 * 3);
  const meteorGeometry = new BufferGeometry();
  const meteorPositionAttribute = new BufferAttribute(meteorPositions, 3).setUsage(DynamicDrawUsage);
  const meteorColorAttribute = new BufferAttribute(meteorColors, 3).setUsage(DynamicDrawUsage);
  meteorGeometry.setAttribute('position', meteorPositionAttribute);
  meteorGeometry.setAttribute('color', meteorColorAttribute);
  const meteorLines = new LineSegments(
    meteorGeometry,
    new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false }),
  );
  meteorLines.frustumCulled = false;
  const meteors = Array.from({ length: METEOR_POOL }, () => ({
    active: false, age: 0, life: 0, start: new Vector3(), velocity: new Vector3(), length: 0,
  }));
  let nextMeteorIn = 2;

  // Reused scratch objects (no allocations while animating).
  const p = new Vector3();
  const q = new Vector3();
  const matrix = new Matrix4();
  const spin = new Quaternion();
  const axis = new Vector3(0.3, 1, 0.2).normalize();
  const scale = new Vector3(1, 1, 1);

  function spawnMeteor(meteor, random) {
    // Somewhere in the upper sky in front of the camera, far beyond the Earth.
    meteor.start.set((random() - 0.5) * 300, 40 + random() * 140, -250 - random() * 100);
    meteor.velocity.set((random() - 0.5) * 2, -0.6 - random() * 0.6, (random() - 0.5) * 0.4).normalize()
      .multiplyScalar(160 + random() * 120);
    meteor.length = 12 + random() * 18;
    meteor.life = 0.5 + random() * 0.5;
    meteor.age = 0;
    meteor.active = true;
  }

  return {
    group,
    meteorLines,
    tailPerComet: tailLength,
    /**
     * @param {number} t  seconds since start (scaled by the caller for speed changes)
     * @param {number} dt seconds since the last frame
     * @param {{meteors: boolean, random: () => number}} options
     */
    update(t, dt, { meteors: meteorsOn = true, random = Math.random } = {}) {
      // Comet heads and tails: the tail is where the head was a moment ago.
      for (let c = 0; c < comets.length; c += 1) {
        const step = comets[c].period / 900;
        for (let k = 0; k < tailLength; k += 1) {
          orbitPosition(comets[c], t - k * step, p);
          writeVector(glowPositions, (c * tailLength + k) * 3, p);
        }
      }
      glowPositionAttribute.needsUpdate = true;

      orbitPosition(craftOrbit, t, craft.position);
      orbitPosition(craftOrbit, t + 0.05, q);
      craft.lookAt(q.add(group.position));
      craft.rotateX(Math.PI / 2);

      for (let i = 0; i < rockOrbits.length; i += 1) {
        orbitPosition(rockOrbits[i], t, p);
        spin.setFromAxisAngle(axis, t * (0.6 + i * 0.4));
        matrix.compose(p, spin, scale);
        rocks.setMatrixAt(i, matrix);
      }
      rocks.instanceMatrix.needsUpdate = true;

      // Meteors: occasionally start one, move and fade the rest.
      nextMeteorIn -= dt;
      if (meteorsOn && nextMeteorIn <= 0) {
        const free = meteors.find((m) => !m.active);
        if (free) spawnMeteor(free, random);
        nextMeteorIn = 3 + random() * 5;
      }
      for (let i = 0; i < METEOR_POOL; i += 1) {
        const m = meteors[i];
        let brightness = 0;
        if (m.active) {
          m.age += dt;
          if (m.age >= m.life) m.active = false;
          else brightness = Math.sin((Math.PI * m.age) / m.life);
        }
        p.copy(m.velocity).multiplyScalar(m.age).add(m.start); // head
        writeVector(meteorPositions, i * 6, p);
        q.copy(m.velocity).setLength(-m.length).add(p); // end of the trail
        writeVector(meteorPositions, i * 6 + 3, q);
        meteorColors[i * 6] = brightness;
        meteorColors[i * 6 + 1] = brightness;
        meteorColors[i * 6 + 2] = brightness * 0.9; // the trail end stays dark (fades out)
      }
      meteorPositionAttribute.needsUpdate = true;
      meteorColorAttribute.needsUpdate = true;
    },
    setPixelRatio(ratio) {
      glowMaterial.uniforms.uPixelRatio.value = ratio;
    },
    /** Fewer tail particles on slow devices (only the first few of each tail are drawn). */
    setTailDetail(fraction) {
      glowGeometry.setDrawRange(0, glowCount);
      const keep = Math.max(1, Math.floor(tailLength * fraction));
      for (let c = 0; c < comets.length; c += 1) {
        for (let k = 0; k < tailLength; k += 1) {
          const fade = 1 - k / tailLength;
          glowAlphas[c * tailLength + k] = k >= keep ? 0 : k === 0 ? 1.0 : 0.55 * fade * fade;
        }
      }
      glowGeometry.getAttribute('aAlpha').needsUpdate = true;
    },
    dispose() {
      group.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      meteorGeometry.dispose();
      meteorLines.material.dispose();
    },
  };
}
