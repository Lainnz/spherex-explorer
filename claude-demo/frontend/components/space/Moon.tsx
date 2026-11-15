"use client";

import { useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MOON_TEXTURE } from "./constants";

// DECORATIVE Moon in the upper sky. Its size, distance and surface map are
// artistic (the real Moon is ~60 Earth-radii away). It is lit by the same
// sunlight as Earth, so it shows a natural partial phase.
export default function Moon() {
  const meshRef = useRef<THREE.Mesh>(null);
  const map = useLoader(THREE.TextureLoader, MOON_TEXTURE);
  map.colorSpace = THREE.SRGBColorSpace;

  // Upper right on wide screens; nearer the centre-top on phones
  const { width, height } = useThree((state) => state.size);
  const isPortrait = width / height < 1;
  const position: [number, number, number] = isPortrait ? [1.9, 4.6, -9] : [6.4, 3.0, -9];

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += Math.min(delta, 0.1) * 0.01;
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[0.1, 0.4, 0]}>
      <sphereGeometry args={[0.6, 64, 48]} />
      <meshStandardMaterial map={map} roughness={1} metalness={0} />
    </mesh>
  );
}
