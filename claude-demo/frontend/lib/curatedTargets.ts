// Curated sky targets for Random Explore.
//
// Coordinates are J2000 positions in decimal degrees for well-known objects.
// SPHEREx coverage was checked against the real NASA/IPAC IRSA archive
// (SIA2 search, collection spherex_dr1, point search) on VERIFIED_ON.
// dr1ImageCount = number of DR1 Wide Survey images containing the position.

export type CuratedTarget = {
  name: string;
  ra: number;
  dec: number;
  fov: number; // suggested view width in degrees, so the object fills the viewer
  blurb: string; // one beginner-friendly sentence
  spherexCoverageVerified: boolean;
  dr1ImageCount?: number;
};

export const VERIFIED_ON = "2026-11-14";

export const CURATED_TARGETS: CuratedTarget[] = [
  {
    name: "Crab Nebula (M1)",
    ra: 83.633,
    dec: 22.0145,
    fov: 0.25,
    blurb: "The glowing wreck of a star that exploded in the year 1054.",
    spherexCoverageVerified: true,
    dr1ImageCount: 216,
  },
  {
    name: "Orion Nebula (M42)",
    ra: 83.822,
    dec: -5.391,
    fov: 1.2,
    blurb: "A nearby nursery where new stars are forming in clouds of gas and dust.",
    spherexCoverageVerified: true,
    dr1ImageCount: 237,
  },
  {
    name: "Horsehead Nebula",
    ra: 85.247,
    dec: -2.458,
    fov: 0.5,
    blurb: "A dark cloud of dust shaped like a horse's head, in Orion.",
    spherexCoverageVerified: true,
    dr1ImageCount: 239,
  },
  {
    name: "Andromeda Galaxy (M31)",
    ra: 10.6846,
    dec: 41.2691,
    fov: 3.5,
    blurb: "The nearest large spiral galaxy, about 2.5 million light-years away.",
    spherexCoverageVerified: true,
    dr1ImageCount: 226,
  },
  {
    name: "Pleiades (M45)",
    ra: 56.75,
    dec: 24.1167,
    fov: 2.5,
    blurb: "The 'Seven Sisters', a young cluster of hot blue stars.",
    spherexCoverageVerified: true,
    dr1ImageCount: 224,
  },
  {
    name: "Large Magellanic Cloud",
    ra: 80.894,
    dec: -69.756,
    fov: 12,
    blurb: "A small companion galaxy of the Milky Way, visible from the Southern Hemisphere.",
    spherexCoverageVerified: true,
    dr1ImageCount: 893,
  },
  {
    name: "Galactic Centre (Sgr A*)",
    ra: 266.4168,
    dec: -29.0078,
    fov: 1.0,
    blurb: "The heart of our Milky Way, home to a supermassive black hole.",
    spherexCoverageVerified: true,
    dr1ImageCount: 209,
  },
  {
    name: "Carina Nebula",
    ra: 161.285,
    dec: -59.868,
    fov: 2.5,
    blurb: "One of the largest and brightest star-forming regions in our galaxy.",
    spherexCoverageVerified: true,
    dr1ImageCount: 390,
  },
  {
    name: "Eagle Nebula (M16)",
    ra: 274.7,
    dec: -13.807,
    fov: 0.6,
    blurb: "Home of the famous 'Pillars of Creation'.",
    spherexCoverageVerified: true,
    dr1ImageCount: 235,
  },
  {
    name: "Whirlpool Galaxy (M51)",
    ra: 202.4696,
    dec: 47.1953,
    fov: 0.3,
    blurb: "A face-on spiral galaxy interacting with a smaller neighbour.",
    spherexCoverageVerified: true,
    dr1ImageCount: 297,
  },
  {
    name: "North Ecliptic Pole",
    ra: 270.0,
    dec: 66.5607,
    fov: 1.0,
    blurb: "SPHEREx's survey pattern revisits the areas near the ecliptic poles most often.",
    spherexCoverageVerified: true,
    dr1ImageCount: 439,
  },
  {
    name: "South Ecliptic Pole",
    ra: 90.0,
    dec: -66.5607,
    fov: 1.0,
    blurb: "Like its northern twin, a region SPHEREx observes especially often.",
    spherexCoverageVerified: true,
    dr1ImageCount: 658,
  },
];

export function pickRandomTarget(excludeName?: string): CuratedTarget {
  const choices = CURATED_TARGETS.filter((t) => t.name !== excludeName);
  return choices[Math.floor(Math.random() * choices.length)];
}

// If the coordinates match a curated target (within ~4 arcseconds), return it.
export function findCuratedTarget(ra: number, dec: number): CuratedTarget | undefined {
  const tolerance = 0.001;
  return CURATED_TARGETS.find(
    (t) => Math.abs(t.ra - ra) < tolerance && Math.abs(t.dec - dec) < tolerance,
  );
}
