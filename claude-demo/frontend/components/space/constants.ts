import * as THREE from "three";

// Direction the (decorative) sunlight comes from: upper left, slightly in
// front, so the top-left of Earth is in daylight and the right is in night.
export const SUN_DIRECTION = new THREE.Vector3(-0.9, 0.7, 0.35).normalize();

// Earth's size in scene units and its axial tilt (23.4°).
export const EARTH_RADIUS = 2.2;
export const EARTH_TILT = THREE.MathUtils.degToRad(23.4);

// The NASA image files you download into public/textures/.
export const EARTH_DAY_TEXTURE = "/textures/earth-day.jpg";
export const EARTH_NIGHT_TEXTURE = "/textures/earth-night.jpg";
export const MOON_TEXTURE = "/textures/moon.jpg"; // procedurally generated, decorative
