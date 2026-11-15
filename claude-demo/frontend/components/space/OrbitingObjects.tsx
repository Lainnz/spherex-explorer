"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Three small DECORATIVE satellites circling Earth. Their models, orbits and
// speeds are invented for looks; they do not show real spacecraft positions.

type OrbitSpec = {
  radiusFactor: number; // orbit size relative to Earth's radius
  tilt: [number, number, number]; // orientation of the orbit plane
  speed: number; // radians per second (bigger = faster)
  phase: number; // starting angle
  size: number; // model scale
  blinkOffset: number; // so the lights don't all blink together
};

const ORBITS: OrbitSpec[] = [
  { radiusFactor: 1.2, tilt: [1.25, 0.3, 0.4], speed: 0.32, phase: 0.8, size: 0.6, blinkOffset: 0 },
  { radiusFactor: 1.42, tilt: [1.5, -0.6, -0.25], speed: 0.2, phase: 2.6, size: 0.75, blinkOffset: 0.5 },
  { radiusFactor: 1.7, tilt: [1.05, 0.9, -0.5], speed: 0.12, phase: 4.4, size: 0.55, blinkOffset: 1.1 },
];

const TRAIL_LENGTH = 0.75; // radians of orbit the fading trail covers
const BLINK_PERIOD = 1.8; // seconds

// A simple, understated satellite: a silver body, two grey solar panels
// and a small antenna dish.
function SatelliteModel({ size, blinkOffset }: { size: number; blinkOffset: number }) {
  const lightRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (lightRef.current) {
      const t = (clock.elapsedTime + blinkOffset) % BLINK_PERIOD;
      lightRef.current.visible = t < 0.18;
    }
  });

  return (
    <group scale={size}>
      {/* Body */}
      <mesh>
        <boxGeometry args={[0.05, 0.05, 0.07]} />
        <meshStandardMaterial color="#d6d9e0" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Solar panels (left and right) */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.1, 0, 0]}>
          <boxGeometry args={[0.13, 0.004, 0.05]} />
          <meshStandardMaterial color="#4a4e58" metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
      {/* Antenna dish */}
      <mesh position={[0, 0.035, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.02, 0.015, 16, 1, true]} />
        <meshStandardMaterial color="#b9bdc6" metalness={0.9} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* Blinking navigation light */}
      <mesh ref={lightRef} position={[0, -0.03, 0.04]}>
        <sphereGeometry args={[0.007, 8, 8]} />
        <meshBasicMaterial color="#e6ecff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Orbit({ spec, earthRadius }: { spec: OrbitSpec; earthRadius: number }) {
  const moverRef = useRef<THREE.Group>(null);
  const radius = earthRadius * spec.radiusFactor;

  // Faint full orbit ring + a brighter trail that fades out behind the satellite
  const { ring, trail } = useMemo(() => {
    const ringPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({
        color: "#a5b4fc",
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    );

    // Trail: bright next to the satellite, fading to nothing. With additive
    // blending, a colour of black is invisible, so fading colour = fading trail.
    const steps = 48;
    const positions = new Float32Array(steps * 3);
    const colors = new Float32Array(steps * 3);
    const head = new THREE.Color("#aab2c5");
    for (let i = 0; i < steps; i++) {
      const f = i / (steps - 1);
      const a = f * TRAIL_LENGTH; // positive angles = where it has already been
      positions.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], i * 3);
      const fade = Math.pow(1 - f, 2) * 0.45;
      colors.set([head.r * fade, head.g * fade, head.b * fade], i * 3);
    }
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    return { ring, trail };
  }, [radius]);

  useFrame((_, delta) => {
    if (moverRef.current) moverRef.current.rotation.y += Math.min(delta, 0.1) * spec.speed;
  });

  return (
    <group rotation={spec.tilt}>
      <primitive object={ring} />
      <group ref={moverRef} rotation={[0, spec.phase, 0]}>
        <primitive object={trail} />
        <group position={[radius, 0, 0]}>
          <SatelliteModel size={spec.size} blinkOffset={spec.blinkOffset} />
        </group>
      </group>
    </group>
  );
}

export default function OrbitingObjects({ earthRadius }: { earthRadius: number }) {
  return (
    <>
      {ORBITS.map((spec, i) => (
        <Orbit key={i} spec={spec} earthRadius={earthRadius} />
      ))}
    </>
  );
}
