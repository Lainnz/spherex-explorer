"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// DECORATIVE comets and meteor streaks. Purely artistic.

type StreakKind = {
  speed: number; // scene units per second
  length: number;
  thickness: number;
  life: number; // seconds visible
  minDelay: number; // seconds between appearances
  maxDelay: number;
  color: string;
};

const COMET: StreakKind = {
  speed: 5,
  length: 9,
  thickness: 0.16,
  life: 6,
  minDelay: 7,
  maxDelay: 16,
  color: "#cfe0ff",
};

const METEOR: StreakKind = {
  speed: 45,
  length: 7,
  thickness: 0.13,
  life: 0.7,
  minDelay: 2.5,
  maxDelay: 7,
  color: "#ffffff",
};

const DEPTH = -40; // far behind Earth

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Bright head at the right end (uv.x = 1), fading tail to the left.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float tail = pow(vUv.x, 3.0);
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float head = smoothstep(0.94, 1.0, vUv.x) * 0.8;
    float alpha = (tail + head) * across * across * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function Streak({ kind, firstDelay }: { kind: StreakKind; firstDelay: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Mutable state that changes every frame (kept out of React to stay fast)
  const state = useRef({
    active: false,
    wait: firstDelay,
    age: 0,
    head: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(kind.color) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [kind.color],
  );

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const delta = Math.min(rawDelta, 0.1); // avoid jumps after switching tabs
    const s = state.current;

    if (!s.active) {
      mesh.visible = false;
      s.wait -= delta;
      if (s.wait > 0) return;
      // Start a new streak somewhere in the upper sky, heading down-left or down-right
      const goingRight = Math.random() < 0.5;
      const angle = goingRight
        ? THREE.MathUtils.degToRad(-25 - Math.random() * 25)
        : THREE.MathUtils.degToRad(-155 + Math.random() * 25);
      s.dir.set(Math.cos(angle), Math.sin(angle), 0);
      s.head.set((Math.random() * 2 - 1) * 28, 6 + Math.random() * 12, DEPTH);
      s.age = 0;
      s.active = true;
    }

    s.age += delta;
    s.head.addScaledVector(s.dir, kind.speed * delta);

    // Fade in, then out, over its lifetime
    const t = s.age / kind.life;
    material.uniforms.uOpacity.value = Math.sin(Math.PI * Math.min(t, 1));

    mesh.visible = true;
    mesh.rotation.z = Math.atan2(s.dir.y, s.dir.x);
    mesh.scale.set(kind.length, kind.thickness, 1);
    mesh.position.copy(s.head).addScaledVector(s.dir, -kind.length / 2);

    if (t >= 1) {
      s.active = false;
      s.wait = kind.minDelay + Math.random() * (kind.maxDelay - kind.minDelay);
    }
  });

  return (
    <mesh ref={meshRef} material={material} visible={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export default function Comets() {
  return (
    <>
      <Streak kind={COMET} firstDelay={1.5} />
      <Streak kind={COMET} firstDelay={9} />
      <Streak kind={METEOR} firstDelay={3} />
      <Streak kind={METEOR} firstDelay={6.5} />
    </>
  );
}
