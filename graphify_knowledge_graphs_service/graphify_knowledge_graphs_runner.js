/**
 * graphify_knowledge_graphs_runner.js
 *
 * Low-level helper that spawns graphify-ts CLI commands safely.
 * Args are always passed as an array — never interpolated into a shell string —
 * to prevent command injection.
 *
 * Configurable via env:
 *   GRAPHIFY_CMD   — binary to invoke (default: "graphify-ts")
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.join(__dirname, 'data');

// ─── Command resolution ───────────────────────────────────────────────────────
// GRAPHIFY_CMD may be a single binary name ("graphify-ts") or a multi-word
// value ("npx @mohammednagy/graphify-ts"). We split on whitespace so the
// extra tokens become prefix args prepended to every spawn call.
//
// On Windows, node_modules/.bin entries are .cmd batch scripts that cannot be
// spawn()ed with shell:false. We parse the .cmd file to find the underlying
// Node.js script and invoke `node <script> ...args` directly — this is safe
// from shell injection because no shell is involved.

const _raw = (process.env.GRAPHIFY_CMD ?? 'graphify-ts').trim();
const [_baseCmd, ..._prefixArgs] = _raw.split(/\s+/);

/**
 * Resolves a bare CLI name to { exe, prefixArgs } suitable for spawn().
 * On Windows: finds the .cmd file in node_modules/.bin, parses it to get
 * the actual Node.js script path, and returns { exe: node, prefixArgs: [script, ...] }.
 */
function _resolveForSpawn(cmd, prefixArgs) {
  // Already a full path or non-Windows — use as-is
  if (cmd.includes('/') || cmd.includes('\\')) return { exe: cmd, prefixArgs };
  if (process.platform !== 'win32') return { exe: cmd, prefixArgs };

  const cmdFiles = [
    path.resolve(__dirname, '../node_modules/.bin', cmd + '.cmd'),  // workspace root
    path.resolve(__dirname, 'node_modules/.bin', cmd + '.cmd'),     // service-local
  ];

  for (const cmdFile of cmdFiles) {
    if (!existsSync(cmdFile)) continue;
    // npm .cmd files end with a line like:
    //   "%_prog%"  "%dp0%\..\@scope\pkg\bin\script.js" %*
    // Parse out the script path relative to the .bin directory.
    const content = readFileSync(cmdFile, 'utf8');
    const m = content.match(/"%dp0%\\([^"%\r\n]+\.js)"/);
    if (m) {
      const scriptPath = path.resolve(path.dirname(cmdFile), m[1]);
      if (existsSync(scriptPath)) {
        return { exe: process.execPath, prefixArgs: [scriptPath, ...prefixArgs] };
      }
    }
  }

  // Fall back — binary must be in PATH (e.g. npx, or globally installed)
  return { exe: cmd, prefixArgs };
}

const _resolved = _resolveForSpawn(_baseCmd, _prefixArgs);

/** Resolved executable — node.exe on Windows when binary came from node_modules/.bin. */
export const GRAPHIFY_EXE = _resolved.exe;

/** Prefix args prepended before every graphify-ts sub-command. */
export const GRAPHIFY_PREFIX_ARGS = _resolved.prefixArgs;

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a graph name.
 * Allows letters, numbers, hyphens, underscores and dots.
 * Rejects anything that could be used for path traversal.
 */
export function validateName(name) {
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*$/.test(name) || name.includes('..')) {
    const err = new Error('Invalid graph name — use letters, numbers, hyphens, underscores, or dots; no path separators');
    err.status = 400;
    throw err;
  }
}

/**
 * Resolve the absolute path for a named graph directory inside data/.
 * Throws 400 if the resolved path escapes DATA_DIR.
 */
export function graphDir(name) {
  const dir = path.resolve(DATA_DIR, name);
  if (!dir.startsWith(DATA_DIR + path.sep) && dir !== DATA_DIR) {
    const err = new Error('Graph path resolves outside data directory');
    err.status = 400;
    throw err;
  }
  return dir;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Spawn graphify-ts with the given args array in `cwd`.
 * Returns { stdout, stderr, code } on success.
 * Rejects with an enriched Error on non-zero exit or timeout.
 *
 * @param {string[]} args
 * @param {string}   cwd
 * @param {{ timeout?: number, allowNonZero?: boolean }} opts
 */
export function runGraphify(args, cwd, { timeout = DEFAULT_TIMEOUT_MS, allowNonZero = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!existsSync(cwd)) {
      const err = new Error(`Directory does not exist: ${path.basename(cwd)}`);
      err.status = 404;
      return reject(err);
    }

    const proc = spawn(GRAPHIFY_EXE, [...GRAPHIFY_PREFIX_ARGS, ...args], { cwd, shell: false });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      const err = Object.assign(new Error('graphify-ts command timed out'), { status: 504, stdout, stderr });
      reject(err);
    }, timeout);

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 || allowNonZero) {
        resolve({ stdout, stderr, code });
      } else {
        reject(Object.assign(
          new Error(`graphify-ts exited with code ${code}`),
          { status: 500, stdout, stderr, exitCode: code }
        ));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        err.message =
          `graphify-ts binary not found (tried: ${GRAPHIFY_EXE}) — ` +
          'add @mohammednagy/graphify-ts to package.json or set GRAPHIFY_CMD=npx @mohammednagy/graphify-ts in .env';
        err.status = 503;
      }
      reject(err);
    });
  });
}

/** Attempt to JSON-parse a string; return the original string on failure. */
export function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}
