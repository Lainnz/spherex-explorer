"use client";

import dynamic from "next/dynamic";

// The 3D scene only works in a browser (it needs WebGL), so we tell Next.js
// not to try rendering it on the server. Until it loads, the page is black.
const SpaceScene = dynamic(() => import("./SpaceScene"), {
  ssr: false,
  loading: () => null,
});

// Full-screen decorative background: stars, comets and the 3D Earth.
// Fixed to the window, so the scene always matches the visible screen size.
// aria-hidden: screen readers skip it, because it carries no information.
export default function SpaceBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <SpaceScene />
      {/* Soft violet haze near the top, layered over the 3D scene */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.16),transparent_55%)]" />
    </div>
  );
}
