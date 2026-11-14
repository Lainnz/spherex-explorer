/**
 * The single place where the website talks to our backend (helper server).
 * In development the backend runs at http://localhost:8000; on GitHub Pages the
 * address comes from the VITE_API_BASE build variable.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8000').replace(/\/$/, '');

/**
 * Ask the backend if it's awake. Free servers sleep, so give up after a few
 * seconds and let the page fall back to demo mode (PLAN.md §8.6).
 * @param {number} timeoutMs
 * @returns {Promise<{status: string, version: string, releases: string[]} | null>}
 */
export async function getHealth(timeoutMs = 3000) {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
