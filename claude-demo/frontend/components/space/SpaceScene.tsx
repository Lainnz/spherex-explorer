"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import Starfield from "./Starfield";
import Comets from "./Comets";
import Earth, { PlainEarth } from "./Earth";
import TextureErrorBoundary from "./TextureErrorBoundary";
import Moon from "./Moon";
import LaunchCamera from "./LaunchCamera";
import { SUN_DIRECTION } from "./constants";

// Everything here is ARTISTIC. The stars are randomly placed, the comets are
// invented, and the satellites are decoration. None of it is real data.
export default function SpaceScene() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <Canvas
      // "demand" = draw once and stop, so nothing moves for reduced-motion users
      frameloop={reducedMotion ? "demand" : "always"}
      camera={{ position: [0, 0, 6], fov: 45, near: 0.1, far: 300 }}
      dpr={[1, 1.75]} // cap the resolution on very sharp screens: looks the same, much less GPU work
      gl={{ antialias: true }}
      fallback={<div className="h-full w-full bg-black" />}
    >
      <color attach="background" args={["#000000"]} />

      {/* Light for the plain fallback globe and the small satellites */}
      <ambientLight intensity={0.04} />
      <directionalLight
        position={SUN_DIRECTION.clone().multiplyScalar(10)}
        intensity={2.2}
      />

      {!reducedMotion && <LaunchCamera />}

      <Starfield animate={!reducedMotion} />
      {!reducedMotion && <Comets />}

      {/* If the NASA texture files are missing, show a plain globe instead
          of crashing the page. */}
      <TextureErrorBoundary name="Earth textures" fallback={<PlainEarth />}>
        <Suspense fallback={null}>
          <Earth />
        </Suspense>
      </TextureErrorBoundary>

      {/* The Moon is optional: if its texture is missing, just skip it */}
      <TextureErrorBoundary name="Moon texture" fallback={null}>
        <Suspense fallback={null}>
          <Moon />
        </Suspense>
      </TextureErrorBoundary>
    </Canvas>
  );
}
