/**
 * graphify_knowledge_graphs_api.js
 *
 * Express API for the Graphify Knowledge Graphs Service.
 * Wraps every graphify-ts CLI command and exposes it over HTTP so
 * multiple knowledge-graph directories under data/ can be managed
 * independently.
 *
 * Start with:
 *   npm run dev    (node --watch)
 *   npm start      (plain node)
 *
 * Listens on PORT from .env (default 3740).
 *
 * Route overview
 * ──────────────
 * Health / Help
 *   GET  /health
 *   GET  /help                                  graphify-ts --help
 *
 * Graph discovery
 *   GET  /graphs                                list dirs in data/ with graph status
 *   GET  /graphs/:name                          info, path, watcher status
 *
 * Graph build
 *   POST /graphs/:name/generate                 body: { spi?: bool }
 *
 * Watch (rebuild on file change)
 *   POST /graphs/:name/watch/start
 *   POST /graphs/:name/watch/stop
 *   GET  /graphs/:name/watch/status
 *
 * Query / context
 *   GET  /graphs/:name/summary                  bounded JSON overview
 *   POST /graphs/:name/pack                     body: { query, task?, retrievalStrategy? }
 *   POST /graphs/:name/prompt                   body: { query, provider? }
 *
 * Benchmarking / comparison
 *   POST /graphs/:name/review-compare           body: { exec, graphPath? }
 *   POST /graphs/:name/compare                  body: { query, exec, baselineMode? }
 *
 * History
 *   POST /graphs/:name/time-travel              body: { ref1, ref2, view? }
 *
 * Multi-graph
 *   POST /federate                              body: { graphs: string[], outputDir? }
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import {
  DATA_DIR,
  validateName,
  graphDir,
  runGraphify,
  tryParseJSON,
} from './graphify_knowledge_graphs_runner.js';

import {
  startWatcher,
  stopWatcher,
  watcherStatus,
  stopAllWatchers,
} from './graphify_knowledge_graphs_watcher.js';

const PORT = parseInt(process.env.PORT ?? '3740', 10);
const app  = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate-limit long-running commands (generate, compare, etc.) to prevent abuse
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — slow down' },
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

function sendError(res, err) {
  const status = err.status ?? 500;
  const body   = { ok: false, error: err.message };
  if (err.stdout)    body.stdout   = err.stdout;
  if (err.stderr)    body.stderr   = err.stderr;
  if (err.exitCode != null) body.exitCode = err.exitCode;
  res.status(status).json(body);
}

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'graphify-knowledge-graphs-service' });
});

// ─── Help ────────────────────────────────────────────────────────────────────
// graphify-ts --help typically writes to stderr and may exit non-zero

app.get('/help', async (_req, res) => {
  try {
    const result = await runGraphify(['--help'], DATA_DIR, { timeout: 15_000, allowNonZero: true });
    res.json({ ok: true, help: result.stdout || result.stderr });
  } catch (err) {
    // Even on error, forward any captured output
    res.status(err.status ?? 500).json({
      ok: false,
      error: err.message,
      help: err.stdout || err.stderr || null,
    });
  }
});

// ─── List graphs ─────────────────────────────────────────────────────────────
// Returns each directory under data/ with a flag indicating whether
// graphify-out/graph.json already exists.

app.get('/graphs', async (_req, res) => {
  try {
    const entries = existsSync(DATA_DIR)
      ? await readdir(DATA_DIR, { withFileTypes: true })
      : [];

    const graphs = entries
      .filter(e => e.isDirectory())
      .map(e => ({
        name:     e.name,
        hasGraph: existsSync(path.join(DATA_DIR, e.name, 'graphify-out', 'graph.json')),
        watcher:  watcherStatus(e.name),
      }));

    res.json({ ok: true, graphs });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Graph info ──────────────────────────────────────────────────────────────

app.get('/graphs/:name', (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const dir           = graphDir(name);
    const graphJsonPath = path.join(dir, 'graphify-out', 'graph.json');

    if (!existsSync(dir)) {
      return res.status(404).json({ ok: false, error: `Graph '${name}' not found` });
    }

    res.json({
      ok:           true,
      name,
      dir,
      hasGraph:     existsSync(graphJsonPath),
      graphJsonPath: existsSync(graphJsonPath) ? graphJsonPath : null,
      watcher:      watcherStatus(name),
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Generate ────────────────────────────────────────────────────────────────
// POST /graphs/:name/generate   body: { spi?: boolean }

app.post('/graphs/:name/generate', heavyLimiter, async (req, res) => {
  try {
    const { name }       = req.params;
    const { spi = false } = req.body ?? {};
    validateName(name);

    const args = ['generate', '.'];
    if (spi) args.push('--spi');

    const result = await runGraphify(args, graphDir(name), { timeout: 300_000 }); // 5 min
    res.json({ ok: true, stdout: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Watch ───────────────────────────────────────────────────────────────────
// POST /graphs/:name/watch/start
// POST /graphs/:name/watch/stop
// GET  /graphs/:name/watch/status

app.post('/graphs/:name/watch/start', (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const info = startWatcher(name, graphDir(name));
    res.json({ ok: true, ...info });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/graphs/:name/watch/stop', (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    stopWatcher(name);
    res.json({ ok: true, message: `Watcher for '${name}' stopped` });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/graphs/:name/watch/status', (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    res.json({ ok: true, ...watcherStatus(name) });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────
// GET /graphs/:name/summary
// graphify-ts summary — bounded JSON overview before deeper retrieval

app.get('/graphs/:name/summary', async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const result = await runGraphify(['summary'], graphDir(name), { timeout: 60_000 });
    res.json({ ok: true, summary: tryParseJSON(result.stdout), stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Pack ────────────────────────────────────────────────────────────────────
// POST /graphs/:name/pack
// body: { query: string, task?: string, retrievalStrategy?: string }
// graphify-ts pack "<query>" --task <task> [--retrieval-strategy <s>]

app.post('/graphs/:name/pack', heavyLimiter, async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const { query, task = 'explain', retrievalStrategy } = req.body ?? {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: '"query" is required' });
    }

    const args = ['pack', query, '--task', task];
    if (retrievalStrategy) args.push('--retrieval-strategy', retrievalStrategy);

    const result = await runGraphify(args, graphDir(name), { timeout: 60_000 });
    res.json({ ok: true, pack: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Prompt ──────────────────────────────────────────────────────────────────
// POST /graphs/:name/prompt
// body: { query: string, provider?: string }
// graphify-ts prompt "<query>" --provider <provider>

app.post('/graphs/:name/prompt', heavyLimiter, async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const { query, provider = 'claude' } = req.body ?? {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: '"query" is required' });
    }

    const result = await runGraphify(
      ['prompt', query, '--provider', provider],
      graphDir(name),
      { timeout: 60_000 }
    );
    res.json({ ok: true, prompt: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Review-compare ──────────────────────────────────────────────────────────
// POST /graphs/:name/review-compare
// body: { exec: string, graphPath?: string }
// graphify-ts review-compare <graphPath> --exec '<cmd>' --yes

app.post('/graphs/:name/review-compare', heavyLimiter, async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const { exec: execCmd, graphPath = 'graphify-out/graph.json' } = req.body ?? {};

    if (!execCmd || typeof execCmd !== 'string') {
      return res.status(400).json({ ok: false, error: '"exec" is required' });
    }

    const result = await runGraphify(
      ['review-compare', graphPath, '--exec', execCmd, '--yes'],
      graphDir(name),
      { timeout: 300_000 }
    );
    res.json({ ok: true, output: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Compare ─────────────────────────────────────────────────────────────────
// POST /graphs/:name/compare
// body: { query: string, exec: string, baselineMode?: string }
// graphify-ts compare "<query>" --exec '<cmd>' --yes [--baseline-mode <mode>]

app.post('/graphs/:name/compare', heavyLimiter, async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const { query, exec: execCmd, baselineMode } = req.body ?? {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: '"query" is required' });
    }
    if (!execCmd || typeof execCmd !== 'string') {
      return res.status(400).json({ ok: false, error: '"exec" is required' });
    }

    const args = ['compare', query, '--exec', execCmd, '--yes'];
    if (baselineMode) args.push('--baseline-mode', baselineMode);

    const result = await runGraphify(args, graphDir(name), { timeout: 300_000 });
    res.json({ ok: true, output: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Time travel ─────────────────────────────────────────────────────────────
// POST /graphs/:name/time-travel
// body: { ref1: string, ref2: string, view?: string }
// graphify-ts time-travel <ref1> <ref2> --view <view>

app.post('/graphs/:name/time-travel', heavyLimiter, async (req, res) => {
  try {
    const { name } = req.params;
    validateName(name);
    const { ref1, ref2, view = 'risk' } = req.body ?? {};

    if (!ref1 || typeof ref1 !== 'string') {
      return res.status(400).json({ ok: false, error: '"ref1" is required' });
    }
    if (!ref2 || typeof ref2 !== 'string') {
      return res.status(400).json({ ok: false, error: '"ref2" is required' });
    }

    const result = await runGraphify(
      ['time-travel', ref1, ref2, '--view', view],
      graphDir(name),
      { timeout: 120_000 }
    );
    res.json({ ok: true, output: tryParseJSON(result.stdout), stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Federate ────────────────────────────────────────────────────────────────
// POST /federate
// body: { graphs: string[], outputDir?: string }
// graphify-ts federate <graph1>/graphify-out/graph.json <graph2>/graphify-out/graph.json ...
// Each entry in `graphs` is a named directory under data/; their graph.json files
// are passed to the CLI as absolute paths.

app.post('/federate', heavyLimiter, async (req, res) => {
  try {
    const { graphs, outputDir } = req.body ?? {};

    if (!Array.isArray(graphs) || graphs.length < 2) {
      return res.status(400).json({ ok: false, error: '"graphs" must be an array of at least 2 graph names' });
    }

    // Validate names and resolve absolute graph.json paths
    const graphPaths = graphs.map(n => {
      validateName(n);
      return path.join(graphDir(n), 'graphify-out', 'graph.json');
    });

    for (const gp of graphPaths) {
      if (!existsSync(gp)) {
        return res.status(404).json({
          ok: false,
          error: `graph.json not found for '${path.basename(path.dirname(path.dirname(gp)))}'`,
        });
      }
    }

    const args = ['federate', ...graphPaths];
    if (outputDir) {
      validateName(outputDir);
      args.push('--output', path.join(DATA_DIR, outputDir));
    }

    const result = await runGraphify(args, DATA_DIR, { timeout: 120_000 });
    res.json({ ok: true, output: result.stdout, stderr: result.stderr || undefined });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

// ─── Global error handler ────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[graphify-kg-service]', err);
  res.status(500).json({ ok: false, error: err.message ?? 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   Graphify Knowledge Graphs Service  v1.0.0      ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  REST API  →  http://localhost:${PORT}             ║`);
  console.log(`║  Data dir  →  ./data/                            ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log('  Endpoints:');
  console.log('    GET    /health');
  console.log('    GET    /help');
  console.log('    GET    /graphs');
  console.log('    GET    /graphs/:name');
  console.log('    POST   /graphs/:name/generate          { spi? }');
  console.log('    POST   /graphs/:name/watch/start');
  console.log('    POST   /graphs/:name/watch/stop');
  console.log('    GET    /graphs/:name/watch/status');
  console.log('    GET    /graphs/:name/summary');
  console.log('    POST   /graphs/:name/pack               { query, task?, retrievalStrategy? }');
  console.log('    POST   /graphs/:name/prompt             { query, provider? }');
  console.log('    POST   /graphs/:name/review-compare     { exec, graphPath? }');
  console.log('    POST   /graphs/:name/compare            { query, exec, baselineMode? }');
  console.log('    POST   /graphs/:name/time-travel        { ref1, ref2, view? }');
  console.log('    POST   /federate                        { graphs[], outputDir? }\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[graphify-kg-service] Port ${PORT} is already in use.`);
    console.error(`  → Another instance may be running. Stop it first or change PORT in .env\n`);
  } else {
    console.error('[graphify-kg-service] Server error:', err);
  }
  process.exit(1);
});

// Graceful shutdown — kill any active watchers before exit
process.on('SIGTERM', () => { stopAllWatchers(); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { stopAllWatchers(); server.close(() => process.exit(0)); });
