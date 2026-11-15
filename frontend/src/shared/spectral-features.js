/**
 * Well-known infrared features in SPHEREx's range (0.75–5 µm), rest wavelengths.
 * From Elaine's spectrum panel; also used by the chemistry search (Milestone 3).
 * A marker is only a reference: it does not mean the feature is present.
 * kind: 'ice' (absorption by frozen molecules on dust), 'organic' (carbon-rich molecules),
 * 'gas' (glowing hydrogen).
 */
export const SPECTRAL_FEATURES = [
  { id: 'pa_beta', um: 1.282, label: 'Pa β', what: 'hydrogen gas (Paschen-β line)', kind: 'gas' },
  { id: 'pa_alpha', um: 1.875, label: 'Pa α', what: 'hydrogen gas (Paschen-α line)', kind: 'gas' },
  { id: 'h2o_ice', um: 3.05, label: 'H₂O ice', what: 'water ice absorption', kind: 'ice' },
  { id: 'pah', um: 3.29, label: 'PAH', what: 'organic PAH molecules (emission band)', kind: 'organic' },
  { id: 'aliphatic', um: 3.4, label: 'C–H', what: 'aliphatic (chain-like) carbon, organic matter', kind: 'organic' },
  { id: 'br_alpha', um: 4.05, label: 'Br α', what: 'hydrogen gas (Brackett-α line)', kind: 'gas' },
  { id: 'co2_ice', um: 4.27, label: 'CO₂ ice', what: 'carbon dioxide ice absorption', kind: 'ice' },
  { id: 'co', um: 4.67, label: 'CO', what: 'carbon monoxide (gas and ice)', kind: 'ice' },
];

/** Marker colours by kind (Okabe–Ito, colour-blind safe). */
export const FEATURE_COLOURS = { ice: '#56B4E9', organic: '#E69F00', gas: '#CC79A7' };
