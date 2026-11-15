// Background sky maps ("HiPS surveys") shown by Aladin Lite.
// These are REFERENCE images from other telescopes, not SPHEREx data.
// Real SPHEREx observations are added in Milestone 5.
//
// We load them from NASA/IPAC IRSA's official mirror of the CDS maps
// (listed by the CDS MocServer as a mirror for each survey). This avoids
// relying on a single server: during testing the main CDS servers were
// unavailable from this network, while IRSA worked.

export type Survey = {
  id: string; // CDS identifier (for reference / attribution)
  url: string; // where Aladin Lite fetches the image tiles
  label: string;
  description: string;
};

const IRSA_HIPS = "https://irsa.ipac.caltech.edu/data/hips/CDS";

export const SURVEYS: Survey[] = [
  {
    id: "CDS/P/2MASS/color",
    url: `${IRSA_HIPS}/2MASS/Color`,
    label: "2MASS near-infrared",
    description:
      "Infrared light at 1.2–2.2 µm from the 2MASS survey — the closest match to SPHEREx's wavelengths (0.75–5 µm).",
  },
  {
    id: "CDS/P/allWISE/color",
    url: `${IRSA_HIPS}/AllWISE/RGB-W4-W2-W1`,
    label: "AllWISE infrared",
    description:
      "Longer infrared wavelengths (3.4–22 µm) from NASA's WISE satellite. Warm dust glows brightly here.",
  },
  {
    id: "CDS/P/DSS2/color",
    url: `${IRSA_HIPS}/DSS2/color`,
    label: "DSS visible light",
    description:
      "Roughly what the sky looks like to the eye, from the Digitized Sky Survey's photographic plates.",
  },
];

export const DEFAULT_SURVEY = SURVEYS[0];
