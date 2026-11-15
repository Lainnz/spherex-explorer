/**
 * Where Aladin Lite (the Stellar View's sky viewer) is loaded from. Shared so the title
 * page can download it ahead of time into the browser's cache (same address = cache hit).
 * jsDelivr, because the address in PLAN.md returned 404 (docs/DATA_NOTES.md §15).
 */
import datasets from './config.js';

export const ALADIN_URL = `https://cdn.jsdelivr.net/npm/aladin-lite@${datasets.aladin_lite_version}/dist/aladin.js`;
