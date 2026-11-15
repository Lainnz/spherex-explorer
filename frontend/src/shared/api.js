/**
 * The single place where the website talks to our backend (helper server).
 * In development the backend runs at http://127.0.0.1:8000; on GitHub Pages the
 * address comes from the VITE_API_BASE build variable.
 * 127.0.0.1, not "localhost": Windows tries IPv6 (::1) first for localhost, uvicorn only
 * listens on IPv4, and the refused attempt took ~2 s on 2026-11-15, enough to make the
 * 3-second health check below give up and show demo mode.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');

/** An error with a message that's safe to show to people as-is. */
export class FriendlyError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * GET a JSON answer from the backend. Throws FriendlyError with the server's own
 * plain-language message when there is one.
 * @param {string} path e.g. "/api/resolve"
 * @param {Record<string, string|number>} [params]
 * @param {{timeoutMs?: number}} [options]
 */
export async function getJson(path, params = {}, { timeoutMs = 20000 } = {}) {
  const query = new URLSearchParams(params).toString();
  let response;
  try {
    response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FriendlyError("The data server isn't answering. It may be waking up; try again in a minute.", {
      code: 'offline',
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new FriendlyError(body.message || 'Something went wrong on the data server.', {
      code: body.error,
      status: response.status,
    });
  }
  return body;
}

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
