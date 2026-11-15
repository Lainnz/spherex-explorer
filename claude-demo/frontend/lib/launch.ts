// The Earth-to-sky transition: the search box announces a "launch", the 3D scene
// swings the camera up from Earth into the stars, then the page navigates.
// Purely decorative; skipped entirely for visitors who prefer reduced motion.

export const LAUNCH_EVENT = "spherex-xplorer-launch";
export const LAUNCH_MS = 1500;

export function announceLaunch() {
  window.dispatchEvent(new Event(LAUNCH_EVENT));
}
