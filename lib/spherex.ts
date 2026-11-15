/**
 * Public SPHEREx mission facts used for explanatory copy on the site.
 *
 * These are mission parameters, NOT observations. Any change here should be
 * checked against the official sources listed in `sources` below.
 */

export const missionSources = [
  {
    label: "NASA Science: SPHEREx mission page",
    href: "https://science.nasa.gov/mission/spherex/",
  },
  {
    label: "NASA/IPAC Infrared Science Archive (IRSA): SPHEREx",
    href: "https://irsa.ipac.caltech.edu/Missions/spherex.html",
  },
] as const;

export const missionName =
  "Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer";

export const missionStats = [
  {
    value: "102",
    label: "infrared colors",
    detail: "Each patch of sky is measured in 102 spectral bands.",
  },
  {
    value: "0.75–5 µm",
    label: "wavelength range",
    detail: "Near-infrared light, just beyond what human eyes can see.",
  },
  {
    value: "~6 months",
    label: "per all-sky map",
    detail: "The full sky is mapped roughly twice a year.",
  },
  {
    value: "2025",
    label: "launch year",
    detail: "Launched from Vandenberg Space Force Base, California.",
  },
] as const;

export const scienceGoals = [
  {
    title: "The first moment",
    subtitle: "Cosmic inflation",
    description:
      "By mapping the 3D positions of hundreds of millions of galaxies, SPHEREx looks for faint patterns left over from the universe's first fraction of a second.",
    accent: "nebula",
  },
  {
    title: "The glow of all galaxies",
    subtitle: "Galaxy history",
    description:
      "SPHEREx measures the combined light from every galaxy, including ones too faint to see individually, to trace how much light galaxies have produced over cosmic time.",
    accent: "aurora",
  },
  {
    title: "Ingredients for life",
    subtitle: "Water & ices",
    description:
      "In cold clouds of gas and dust in our Milky Way, SPHEREx searches for frozen water, carbon dioxide, and other ices that could end up in new planetary systems.",
    accent: "ember",
  },
] as const;

export type ScienceGoal = (typeof scienceGoals)[number];
