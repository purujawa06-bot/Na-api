import appConfig from '../config.json';

const FALLBACK_BACKEND_URL = 'http://localhost:8081';

/**
 * Resolve the Go backend base URL for browser-side requests.
 *
 * Priority: NEXT_PUBLIC_BACKEND_URL env > config.json backendUrl > localhost.
 * Calling the backend directly keeps long-running requests (AI streaming,
 * scrapers) out of the Vercel Function timeout.
 *
 * @returns {string} Backend base URL without a trailing slash.
 */
export function apiBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_URL;
  const candidate = (typeof fromEnv === 'string' && fromEnv.trim()) || appConfig.backendUrl || FALLBACK_BACKEND_URL;
  return String(candidate).trim().replace(/\/+$/, '');
}

/**
 * Build an absolute backend URL from an API path.
 *
 * @param {string} path Path starting with `/api/`.
 * @returns {string} Absolute URL.
 */
export function apiUrl(path) {
  return `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
