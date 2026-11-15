"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LAUNCH_EVENT, LAUNCH_MS } from "@/lib/launch";

// Camera move for the Earth-to-sky transition (artistic):
// tilt up away from Earth, glide forward and narrow the field of view,
// so the starfield seems to rush towards you.
const START_LOOK = new THREE.Vector3(0, 0, 0);
const END_LOOK = new THREE.Vector3(0, 12, -20);
const END_POSITION = new THREE.Vector3(0, 0.6, 3.2);
const END_FOV = 30;

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default function LaunchCamera() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const start = useRef<{ time: number; position: THREE.Vector3; fov: number } | null>(null);
  const look = useRef(new THREE.Vector3());

  useEffect(() => {
    const onLaunch = () => {
      start.current = { time: performance.now(), position: camera.position.clone(), fov: camera.fov };
    };
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    return () => window.removeEventListener(LAUNCH_EVENT, onLaunch);
  }, [camera]);

  useFrame(() => {
    if (!start.current) return;
    const t = Math.min(1, (performance.now() - start.current.time) / LAUNCH_MS);
    const e = easeInOut(t);
    camera.position.lerpVectors(start.current.position, END_POSITION, e);
    camera.fov = THREE.MathUtils.lerp(start.current.fov, END_FOV, e);
    camera.updateProjectionMatrix();
    look.current.lerpVectors(START_LOOK, END_LOOK, e);
    camera.lookAt(look.current);
  });

  return null;
}
