/**
 * notification_center_index.js
 * Entry point for the Notification Center Service.
 *
 * Start:  npm run dev   (node --watch)
 *         npm start     (plain node)
 *
 * Default port: 3003 (override with PORT env var)
 */

import 'dotenv/config';
import express  from 'express';
import cors     from 'cors';
import http     from 'node:http';

import { settings }        from './notification_center_settings.js';
import { initWS, broadcast } from './notification_center_ws.js';
import { loadNotifications } from './notification_center_manager.js';
import { loadProfiles }      from './notification_center_profiles.js';
import { loadRules, evaluateICM } from './notification_center_edge_engine.js';
import { onICM }             from './notification_center_icm.js';
import router                from './notification_center_routes.js';

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/', router);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Route not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[nc-service] Unhandled error:', err);
  res.status(500).json({ ok: false, error: err.message ?? 'Internal server error' });
});

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(app);
initWS(server);

// ── ICM bus wiring ────────────────────────────────────────────────────────────

// Edge Rule Engine evaluates every ICM
onICM('*', (icm) => evaluateICM(icm, broadcast));

// Optionally forward raw ICMs to WebSocket clients
if (settings.ICM_FORWARD_WS) {
  onICM('*', (icm) => broadcast(icm.icmType, icm));
}

// ── Startup ───────────────────────────────────────────────────────────────────

loadNotifications();
loadProfiles();
loadRules();

server.listen(settings.PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   Notification Center Service  v1.0.0           ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  REST API  →  http://localhost:${settings.PORT}            ║`);
  console.log(`║  WebSocket →  ws://localhost:${settings.PORT}/ws           ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  console.log('  Core endpoints:');
  console.log('    GET    /health');
  console.log('    GET    /notifications');
  console.log('    GET    /notifications/unread');
  console.log('    POST   /notifications/mark-all-read');
  console.log('    DELETE /notifications');
  console.log('  Typed ingest:');
  console.log('    POST   /ingest/market');
  console.log('    POST   /ingest/news');
  console.log('    POST   /ingest/polymarket');
  console.log('    POST   /ingest/map');
  console.log('    POST   /ingest/general');
  console.log('  Profiles:');
  console.log('    GET    /profiles');
  console.log('    POST   /profiles');
  console.log('    GET    /profiles/:id/canvas');
  console.log('    PUT    /profiles/:id/canvas');
  console.log('  Edge Rules:');
  console.log('    GET    /edge-rules');
  console.log('    POST   /edge-rules');
  console.log('    POST   /edge-rules/:id/enable');
  console.log('    POST   /edge-rules/:id/disable');
  console.log('    POST   /edge-rules/:id/test\n');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
