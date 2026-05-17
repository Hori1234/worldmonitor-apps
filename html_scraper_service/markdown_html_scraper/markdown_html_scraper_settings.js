/**
 * Runtime settings reader/writer.
 * Reads the .env file that lives one directory above (html_scraper_service/).
 * PATCH only touches known keys — never arbitrary env vars.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, '..', '.env');

// Keys that are safe to expose and edit via the API
const ALLOWED_KEYS = [
  'PORT',
  'CORS_ORIGIN',
  'OUTPUT_DIR',
  'MAX_CONCURRENCY',
  'BROWSER_TIMEOUT',
  'FIRECRAWL_API_KEY',
  'PROXY_URL',
  'MAX_RETRIES',
  'LOG_LEVEL',
];

/** Parse a .env file into a plain object (best-effort, no sub-shell). */
function parseEnvFile(raw) {
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

/** Serialise a key-value map back to .env format, preserving comments. */
function serialiseEnvFile(raw, updates) {
  const lines   = raw.split('\n');
  const touched = new Set();

  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      touched.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append keys that weren't already in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!touched.has(key)) out.push(`${key}=${value}`);
  }

  return out.join('\n');
}

/** Return the current settings (merged env + .env file). */
export function getSettings() {
  const fileValues = fs.existsSync(ENV_PATH)
    ? parseEnvFile(fs.readFileSync(ENV_PATH, 'utf-8'))
    : {};

  const settings = {};
  for (const key of ALLOWED_KEYS) {
    settings[key] = process.env[key] ?? fileValues[key] ?? '';
  }
  // Mask the API key in responses
  if (settings.FIRECRAWL_API_KEY && settings.FIRECRAWL_API_KEY !== '') {
    settings.FIRECRAWL_API_KEY = settings.FIRECRAWL_API_KEY.slice(0, 6) + '…(masked)';
  }
  return settings;
}

/**
 * Persist a partial settings update to .env and process.env.
 * @param {Record<string,string>} updates
 */
export function patchSettings(updates) {
  // Reject unknown keys
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`Unknown setting key: "${key}"`);
    }
  }

  // Read current .env (create if missing)
  const raw = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf-8')
    : '# Auto-generated\n';

  const newRaw = serialiseEnvFile(raw, updates);
  fs.writeFileSync(ENV_PATH, newRaw, 'utf-8');

  // Hot-apply to process.env (FIRECRAWL_API_KEY must not be overwritten with mask)
  for (const [key, value] of Object.entries(updates)) {
    if (!value.includes('(masked)')) {
      process.env[key] = value;
    }
  }
}
