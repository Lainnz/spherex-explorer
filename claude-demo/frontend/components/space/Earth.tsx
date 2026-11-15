"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import OrbitingObjects from "./OrbitingObjects";
import {
  EARTH_DAY_TEXTURE,
  EARTH_NIGHT_TEXTURE,
  EARTH_RADIUS,
  EARTH_TILT,
  SUN_DIRECTION,
} from "./constants";

const ROTATION_SPEED = 0.02; // radians per second: one turn every ~5 minutes

/* ------------------------------------------------------------------ */
/* Shaders: small programs that run on the graphics card per pixel.    */
/* ------------------------------------------------------------------ */

// Earth surface: blends the daytime map and the night-lights map depending
// on which side faces the sun, and adds a blue rim of atmosphere.
const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vec3 n = normalize(vNormalW);
    float cosSun = dot(n, sunDirection);
    // 0 on the night side, 1 on the day side, with a soft twilight band
    float dayAmount = smoothstep(-0.12, 0.28, cosSun);

    vec3 day = texture2D(dayMap, vUv).rgb * (0.08 + 1.05 * max(cosSun, 0.0));
    vec3 night = texture2D(nightMap, vUv).rgb * 1.6;
    vec3 color = mix(night, day, dayAmount);

    // Atmospheric rim: brighter where we look across the edge of the globe
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
    color += vec3(0.32, 0.55, 1.0) * rim * (0.2 + 0.8 * dayAmount);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Outer glow: a slightly larger sphere drawn from the inside. The glow is
// strongest right next to Earth's edge and fades to nothing at the outside.
const glowVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = viewPos.xyz;
    gl_Position = projectionMatrix * viewPos;
  }
`;

const glowFragment = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vec3 toCamera = normalize(-vViewPos);
    // 0 at the glow's outer edge, ~0.4 where it meets Earth's edge
    float depth = -dot(normalize(vNormal), toCamera);
    float intensity = pow(clamp(depth / 0.4, 0.0, 1.0), 2.2);
    gl_FragColor = vec4(vec3(0.38, 0.56, 1.0) * intensity * 0.9, 1.0);
  }
`;

/* ------------------------------------------------------------------ */

// Places Earth low in the frame so only its upper part "rises" into view.
// Wide screens: the globe is enlarged until it covers about 73% of the bottom
// edge of the screen, keeping its top edge at the same height. The sizes are
// found by tracing view rays (camera at z = 6, 45° field of view), so the
// result matches what the 3D camera really shows.
const CAMERA = new THREE.Vector3(0, 0, 6);
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(45 / 2));
const TOP_NDC = -0.5; // Earth's top edge: a quarter of the screen height above the bottom
const BOTTOM_COVER = 0.73; // fraction of the bottom edge covered by Earth

function rayHits(aspect: number, radius: number, cy: number, nx: number, ny: number) {
  const d = new THREE.Vector3(nx * TAN_HALF_FOV * aspect, ny * TAN_HALF_FOV, -1).normalize();
  const oc = CAMERA.clone().sub(new THREE.Vector3(0, cy, 0));
  const b = oc.dot(d);
  return b * b - (oc.lengthSq() - radius * radius) >= 0;
}

function bisect(f: (x: number) => boolean, lo: number, hi: number) {
  // f(lo) true, f(hi) false → boundary
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function earthLayout(aspect: number) {
  // centre height that puts the top edge at TOP_NDC for a given radius
  const centreFor = (r: number) => bisect((cy) => !rayHits(aspect, r, cy, 0, TOP_NDC), -40, 0);
  // half-width of Earth along the bottom edge (1 = screen edge)
  const coverFor = (r: number) => {
    const cy = centreFor(r);
    return rayHits(aspect, r, cy, 0, -1) ? bisect((x) => rayHits(aspect, r, cy, x, -1), 0, 4) : 0;
  };
  const radius = bisect((r) => coverFor(r) < BOTTOM_COVER, EARTH_RADIUS, 5.6);
  return { scale: radius / EARTH_RADIUS, y: centreFor(radius) };
}

function EarthRig({ children }: { children: ReactNode }) {
  const { width, height } = useThree((state) => state.size);
  const aspect = width / height;
  const layout = useMemo(() => (aspect < 1 ? { scale: 1, y: -3.35 } : earthLayout(aspect)), [aspect]);
  return (
    <group position={[0, layout.y, 0]} scale={layout.scale}>
      {children}
    </group>
  );
}

function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  return (
    <mesh scale={1.09} material={material}>
      <sphereGeometry args={[EARTH_RADIUS, 64, 48]} />
    </mesh>
  );
}

// Rotates its child slowly around Earth's (tilted) axis.
function Spinner({ children }: { children: ReactNode }) {
  const spinRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * ROTATION_SPEED;
  });
  return (
    <group rotation={[0, 0, EARTH_TILT]}>
      <group ref={spinRef} rotation={[0, 3.6, 0]}>
        {children}
      </group>
    </group>
  );
}

// Realistic Earth using NASA Visible Earth maps.
export default function Earth() {
  const [dayMap, nightMap] = useLoader(THREE.TextureLoader, [
    EARTH_DAY_TEXTURE,
    EARTH_NIGHT_TEXTURE,
  ]);

  const material = useMemo(() => {
    for (const texture of [dayMap, nightMap]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    }
    return new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        dayMap: { value: dayMap },
        nightMap: { value: nightMap },
        sunDirection: { value: SUN_DIRECTION },
      },
    });
  }, [dayMap, nightMap]);

  return (
    <EarthRig>
      <Spinner>
        <mesh material={material}>
          <sphereGeometry args={[EARTH_RADIUS, 128, 96]} />
        </mesh>
      </Spinner>
      <Atmosphere />
      <OrbitingObjects earthRadius={EARTH_RADIUS} />
    </EarthRig>
  );
}

// Shown only if the texture files are missing: a dark blue globe with glow.
export function PlainEarth() {
  return (
    <EarthRig>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, 96, 64]} />
        <meshStandardMaterial color="#0d2a52" roughness={0.9} />
      </mesh>
      <Atmosphere />
      <OrbitingObjects earthRadius={EARTH_RADIUS} />
    </EarthRig>
  );
}
