/**
 * The 3D Earth: surface (day + city lights), clouds and atmosphere glow (PLAN.md §8.2).
 * Kept generic (no title-page globals) so the future 3D Time Machine can reuse it (§14).
 *
 * Images: NASA Blue Marble (day), Black Marble 2016 (night lights), Blue Marble clouds,
 * made by scripts/build_textures.py. Credit: NASA Earth Observatory.
 */
import {
  AdditiveBlending,
  BackSide,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';

const SURFACE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Day where the Sun shines, city lights where it doesn't, a soft band in between.
const SURFACE_FRAGMENT = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    float sun = dot(normalize(vNormalW), uSunDir);
    float daylight = smoothstep(-0.12, 0.28, sun);
    vec3 day = texture2D(uDay, vUv).rgb * (0.25 + 0.95 * max(sun, 0.0));
    vec3 night = texture2D(uNight, vUv).rgb;
    // Boost the lights a little and let the darkest night stay nearly black.
    night = pow(night, vec3(1.35)) * 1.6;
    gl_FragColor = vec4(mix(night, day, daylight), 1.0);
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec3 uSunDir;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    float cover = texture2D(uClouds, vUv).r;
    float sun = dot(normalize(vNormalW), uSunDir);
    // Sunlit clouds are bright; on the night side they're faintly visible (moonlight).
    float light = 0.05 + 0.95 * smoothstep(-0.1, 0.35, sun);
    gl_FragColor = vec4(vec3(light), cover * uOpacity);
    #include <colorspace_fragment>
  }
`;

// A glow that is strongest at the edge of the globe (Fresnel rim), brighter toward the Sun.
const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vToCamera;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vToCamera = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  varying vec3 vNormalW;
  varying vec3 vToCamera;
  void main() {
    float rim = pow(clamp(1.0 + dot(vNormalW, vToCamera), 0.0, 1.0), 2.5);
    float sunSide = 0.25 + 0.75 * smoothstep(-0.4, 0.6, dot(-vNormalW, uSunDir));
    gl_FragColor = vec4(uColor * rim * sunSide * 1.6, 1.0);
  }
`;

/**
 * Load one set of Earth textures.
 * @param {string} base  URL of the textures folder (ends with "/")
 * @param {"1024"|"2048"} size
 * @param {number} anisotropy
 */
export async function loadEarthTextures(base, size, anisotropy) {
  const loader = new TextureLoader();
  const [day, night, clouds] = await Promise.all(
    ['earth-day', 'earth-night', 'clouds'].map((name) => loader.loadAsync(`${base}${name}-${size}.webp`)),
  );
  for (const texture of [day, night]) texture.colorSpace = SRGBColorSpace;
  for (const texture of [day, night, clouds]) texture.anisotropy = anisotropy;
  return { day, night, clouds };
}

/**
 * @param {{radius?: number, segments?: number, sunDirection: Vector3}} options
 *   sunDirection: unit vector in world space, shared with the caller (update it in place)
 */
export function createEarth({ radius = 1, segments = 64, sunDirection }) {
  const group = new Group();
  const sun = { value: sunDirection };

  const surfaceMaterial = new ShaderMaterial({
    uniforms: { uDay: { value: null }, uNight: { value: null }, uSunDir: sun },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
  });
  const surface = new Mesh(new SphereGeometry(radius, segments, segments), surfaceMaterial);

  const cloudMaterial = new ShaderMaterial({
    uniforms: { uClouds: { value: null }, uSunDir: sun, uOpacity: { value: 0.85 } },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const clouds = new Mesh(new SphereGeometry(radius * 1.008, segments, segments), cloudMaterial);

  const atmosphere = new Mesh(
    new SphereGeometry(radius * 1.035, segments, segments),
    new ShaderMaterial({
      uniforms: { uSunDir: sun, uColor: { value: new Vector3(0.3, 0.6, 1.0) } },
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  group.add(surface, clouds, atmosphere);

  let textures = null;
  return {
    group,
    surface,
    clouds,
    /** Swap in a texture set (e.g. sharper ones once the page is idle). */
    setTextures(next) {
      const previous = textures;
      textures = next;
      surfaceMaterial.uniforms.uDay.value = next.day;
      surfaceMaterial.uniforms.uNight.value = next.night;
      cloudMaterial.uniforms.uClouds.value = next.clouds;
      if (previous) Object.values(previous).forEach((texture) => texture.dispose());
    },
    /** @param {number} spin  Earth's rotation angle (radians); clouds drift a little faster */
    setSpin(spin, cloudDrift) {
      surface.rotation.y = spin;
      clouds.rotation.y = spin + cloudDrift;
    },
    setCloudOpacity(opacity) {
      cloudMaterial.uniforms.uOpacity.value = opacity;
    },
    dispose() {
      group.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      if (textures) Object.values(textures).forEach((texture) => texture.dispose());
    },
  };
}
