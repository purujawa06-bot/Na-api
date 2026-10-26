import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_BACKEND_URL = 'http://localhost:8081';
const CONFIG_FILE = process.env.BACKEND_CONFIG_PATH || path.join(process.cwd(), 'config.json');

/** Cached config file content keyed by mtime so edits apply without a restart. */
let cachedConfig = { path: '', mtimeMs: 0, value: null };
let warnedMissing = false;

/**
 * Read config.json from the project root. Returns an empty object when the file
 * is missing so the frontend can still boot with defaults.
 * @returns {Record<string, unknown>} Parsed configuration.
 */
export function readBackendConfig() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (cachedConfig.path === CONFIG_FILE && cachedConfig.mtimeMs === stat.mtimeMs && cachedConfig.value) {
      return cachedConfig.value;
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    cachedConfig = { path: CONFIG_FILE, mtimeMs: stat.mtimeMs, value: parsed };
    return parsed;
  } catch (error) {
    if (!warnedMissing) {
      console.warn(`[backend] config.json tidak terbaca (${error.message}); memakai ${FALLBACK_BACKEND_URL}`);
      warnedMissing = true;
    }
    return {};
  }
}

/**
 * Resolve the Go backend base URL. Priority: BACKEND_URL env > config.json
 * backendUrl > localhost fallback. Trailing slashes are removed.
 * @returns {string} Backend base URL without a trailing slash.
 */
export function backendBaseUrl() {
  const envUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  const configUrl = readBackendConfig().backendUrl;
  const candidate = (typeof envUrl === 'string' && envUrl.trim()) || (typeof configUrl === 'string' && configUrl.trim()) || FALLBACK_BACKEND_URL;
  return String(candidate).trim().replace(/\/+$/, '');
}
