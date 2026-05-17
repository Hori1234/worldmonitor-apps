/**
 * knowledge_graph_index.js
 *
 * Entry point for the Knowledge Graph Service.
 *
 * Start with:
 *   npm run dev       (node --watch)
 *   npm start         (plain node)
 *
 * Listens on PORT from .env (default 3738).
 * On startup all existing graph directories under data/ are opened automatically.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import router from './knowledge_graph_routes.js';
import { loadAllGraphs, closeAllGraphs } from './knowledge_graph_manager.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3738', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' })); // allow large batch payloads

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/', router);

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Route not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[kg-service] Unhandled error:', err);
  res.status(500).json({ ok: false, error: err.message ?? 'Internal server error' });
});

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── Startup ─────────────────────────────────────────────────────────────────
loadAllGraphs();

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║     Knowledge Graph Service  v1.0.0             ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  REST API  →  http://localhost:${PORT}             ║`);
  console.log(`║  Data dir  →  ./data/                            ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log('  Endpoints:');
  console.log('    GET    /health');
  console.log('    GET    /graphs');
  console.log('    POST   /graphs                  { name, options? }');
  console.log('    POST   /graphs/combine           { sources[], target, options? }');
  console.log('    GET    /graphs/:name');
  console.log('    POST   /graphs/:name/open');
  console.log('    POST   /graphs/:name/close');
  console.log('    POST   /graphs/:name/recreate');
  console.log('    DELETE /graphs/:name');
  console.log('    POST   /graphs/:name/nodes       { typeId, key, props? }');
  console.log('    POST   /graphs/:name/nodes/batch { nodes[] }');
  console.log('    GET    /graphs/:name/nodes/:id');
  console.log('    GET    /graphs/:name/nodes/key/:typeId/:key');
  console.log('    GET    /graphs/:name/nodes/find  ?typeId=&prop=&value=');
  console.log('    POST   /graphs/:name/nodes/query { typeIds?, keys?, props?, limit? }');
  console.log('    DELETE /graphs/:name/nodes/:id');
  console.log('    POST   /graphs/:name/edges       { fromId, toId, typeId }');
  console.log('    POST   /graphs/:name/edges/batch { edges[] }');
  console.log('    DELETE /graphs/:name/edges       { fromId, toId, typeId }');
  console.log('    GET    /graphs/:name/neighbors/:id');
  console.log('    POST   /graphs/:name/traverse');
  console.log('    POST   /graphs/:name/shortest-path');
  console.log('    POST   /graphs/:name/pagerank');
  console.log('    POST   /graphs/:name/subgraph');
  console.log('    POST   /graphs/:name/degrees');
  console.log('    POST   /graphs/:name/components');
  console.log('    POST   /graphs/:name/search      (vector search)');
  console.log('    POST   /graphs/:name/patch       (atomic mutation)\n');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[kg-service] Received ${signal} — shutting down gracefully...`);
  server.close(() => {
    closeAllGraphs();
    console.log('[kg-service] All graphs closed. Bye.');
    process.exit(0);
  });
  // Force-exit if server.close() hangs
  setTimeout(() => {
    console.error('[kg-service] Force exit after timeout.');
    process.exit(1);
  }, 8000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Exports (for Tauri integration / programmatic use) ──────────────────────
export { app, server, router };
