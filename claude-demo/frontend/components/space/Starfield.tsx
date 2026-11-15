"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// DECORATIVE stars: randomly placed points, NOT a real star catalog.
// (Real catalogs such as Gaia appear on the Stellar View page later.)

const STAR_COUNT = 2600;

// A tiny predictable random-number generator, so the stars land in the same
// places every visit instead of jumping around on each reload.
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vColor = aColor;
    vTwinkle = 0.78 + 0.22 * sin(uTime * 1.3 + aPhase);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    // Soft round dot instead of a square
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * vTwinkle, alpha * alpha);
  }
`;

export default function Starfield({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Points>(null);
  const dpr = useThree((state) => state.viewport.dpr);

  const { geometry, material } = useMemo(() => {
    const random = seededRandom(20250311); // SPHEREx launch date, for fun
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);

    const palette = [
      new THREE.Color("#ffffff"),
      new THREE.Color("#cdd9ff"), // bluish
      new THREE.Color("#e4dcff"), // violet tint
      new THREE.Color("#fff1dc"), // warm
    ];

    for (let i = 0; i < STAR_COUNT; i++) {
      // Random direction on a sphere, at a large distance from the camera
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const r = 80 + random() * 60;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = r * s * Math.cos(theta);
      positions[i * 3 + 1] = r * u;
      positions[i * 3 + 2] = r * s * Math.sin(theta);

      const c = palette[Math.floor(random() * palette.length)];
      const brightness = 0.45 + random() * 0.55;
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;

      // Mostly tiny stars, a few brighter ones
      sizes[i] = 1.0 + Math.pow(random(), 7) * 3.2;
      phases[i] = random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    return { geometry, material };
  }, []);

  material.uniforms.uPixelRatio.value = dpr;

  useFrame((state, delta) => {
    if (!animate) return;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.004;
  });

  return <points ref={groupRef} geometry={geometry} material={material} />;
}
