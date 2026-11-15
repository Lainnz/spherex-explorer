/**
 * Real background stars (Gaia DR3 + the brightest from SIMBAD), drawn in one go
 * (PLAN.md §8.2, §9.1). Reusable by the future 3D Time Machine (§14).
 *
 * Each star is a small square that the shader turns into a soft round glow. During the
 * fly-away the squares stretch outward from the centre of the screen into streaks
 * (the "warp" effect), all in the shader, so there's no extra rendering pass.
 *
 * File format (scripts/build_starfield.py), 8 bytes per star, brightest first:
 *   int16 x, y, z (equatorial unit vector × 32767) · uint8 (mag + 1.5) × 25 · uint8 (BP−RP + 0.5) × 50
 */
import {
  AdditiveBlending,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three';

const BYTES_PER_STAR = 8;

const VERTEX = /* glsl */ `
  attribute vec3 aStar;
  attribute float aMag;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uWarp;
  uniform float uPixelRatio;
  uniform vec2 uViewport;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(aStar, 1.0);
    if (clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }  // behind us
    // Brighter stars (smaller magnitude) are bigger and stronger.
    float size = clamp(3.0 - 0.3 * aMag, 0.9, 4.6) * uPixelRatio;
    float brightness = clamp(1.15 - 0.12 * aMag, 0.22, 1.0);
    // Fainter stars twinkle gently, each at its own pace.
    float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + 1.7 * aPhase) + aPhase * 40.0);
    brightness *= 1.0 - uTwinkle * 0.45 * twinkle * smoothstep(1.5, 4.0, aMag);
    // Warp: stretch along the line from the screen centre, more toward the edges.
    vec2 ndc = clip.xy / clip.w;
    float fromCentre = length(ndc);
    vec2 along = fromCentre > 0.0001 ? ndc / fromCentre : vec2(0.0, 1.0);
    vec2 across = vec2(-along.y, along.x);
    float stretch = 1.0 + uWarp * 60.0 * fromCentre;
    vec2 offsetPx = along * position.x * size * stretch + across * position.y * size;
    clip.xy += offsetPx / uViewport * 2.0 * clip.w;
    gl_Position = clip;
    vUv = position.xy;
    vColor = aColor * brightness * (1.0 + uWarp * 0.6);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    float glow = exp(-dot(vUv, vUv) * 3.5);
    if (glow < 0.02) discard;
    gl_FragColor = vec4(vColor * glow, 1.0);
  }
`;

/** Star colour from BP−RP: blue-white for hot stars, orange-red for cool ones. */
function starColor(bpRp, out, offset) {
  const stops = [
    [-0.4, 0.62, 0.74, 1.0],
    [0.2, 0.86, 0.91, 1.0],
    [0.8, 1.0, 0.97, 0.9],
    [1.4, 1.0, 0.84, 0.64],
    [2.6, 1.0, 0.66, 0.42],
  ];
  let i = 0;
  while (i < stops.length - 2 && bpRp > stops[i + 1][0]) i += 1;
  const [x0, ...c0] = stops[i];
  const [x1, ...c1] = stops[i + 1];
  const t = Math.min(1, Math.max(0, (bpRp - x0) / (x1 - x0)));
  for (let k = 0; k < 3; k += 1) out[offset + k] = c0[k] + (c1[k] - c0[k]) * t;
}

/**
 * Turn starfield.bin into arrays. Stars are placed on a big sphere around the origin,
 * with three.js axes: x = toward RA 0°, y = celestial north, z = toward RA 270°.
 * @param {ArrayBuffer} buffer
 * @param {number} radius
 */
export function decodeStarfield(buffer, radius) {
  const view = new DataView(buffer);
  const count = Math.floor(buffer.byteLength / BYTES_PER_STAR);
  const positions = new Float32Array(count * 3);
  const magnitudes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const o = i * BYTES_PER_STAR;
    const x = view.getInt16(o, true) / 32767;
    const y = view.getInt16(o + 2, true) / 32767;
    const z = view.getInt16(o + 4, true) / 32767;
    positions[i * 3] = x * radius;
    positions[i * 3 + 1] = z * radius; // celestial north is "up"
    positions[i * 3 + 2] = -y * radius;
    magnitudes[i] = view.getUint8(o + 6) / 25 - 1.5;
    starColor(view.getUint8(o + 7) / 50 - 0.5, colors, i * 3);
    phases[i] = ((i * 2654435761) % 1000) / 1000; // fixed pseudo-random twinkle phase
  }
  return { count, positions, magnitudes, colors, phases };
}

/**
 * @param {ReturnType<typeof decodeStarfield>} stars
 */
export function createStarfield(stars) {
  const geometry = new InstancedBufferGeometry();
  // One square (two triangles) shared by every star.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aStar', new InstancedBufferAttribute(stars.positions, 3));
  geometry.setAttribute('aMag', new InstancedBufferAttribute(stars.magnitudes, 1));
  geometry.setAttribute('aColor', new InstancedBufferAttribute(stars.colors, 3));
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(stars.phases, 1));
  geometry.instanceCount = stars.count;

  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: 1 },
      uWarp: { value: 0 },
      uPixelRatio: { value: 1 },
      uViewport: { value: new Vector2(1, 1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // the stars surround us

  return {
    mesh,
    uniforms: material.uniforms,
    total: stars.count,
    /** Show only the brightest `count` stars (they're stored brightest first). */
    setVisibleCount(count) {
      geometry.instanceCount = Math.min(stars.count, Math.max(0, Math.floor(count)));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
