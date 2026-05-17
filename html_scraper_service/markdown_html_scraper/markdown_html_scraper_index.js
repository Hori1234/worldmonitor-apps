/**
 * Standalone entry point for the scraper backend.
 *
 * Can also be consumed as a module so the Express app / router can be
 * mounted inside an existing Tauri sidecar server:
 *
 *   import { app, scraperRouter } from './index.js';
 *   existingApp.use('/scraper', scraperRouter);
 */

import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import http    from 'http';
import { WebSocketServer } from 'ws';
import scraperRouter       from './markdown_html_scraper_routes.js';
import { closeBrowser }    from './markdown_html_scraper_scrape.js';
import { setBroadcast }    from './markdown_html_scraper_jobs.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();

// Allow all origins by default (lock this down in production via CORS_ORIGIN env)
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));

app.use(express.json({ limit: '1mb' }));

// Mount the scraper API
app.use('/api', scraperRouter);

// ---------------------------------------------------------------------------
// Start server (only when run as the main module)
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(
  process.argv[1].replace(/\\/g, '/').split('/').pop(),
);

let server;
let wss;

if (isMain) {
  const PORT = parseInt(process.env.PORT || '3737', 10);

  // Wrap Express in a plain http.Server so WebSocket can share the port
  server = http.createServer(app);

  // WebSocket server — clients connect to ws://localhost:PORT/ws
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
  });

  // Heartbeat to drop stale connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  // Wire job events → WebSocket broadcast
  setBroadcast((event) => {
    const msg = JSON.stringify(event);
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    });
  });

  server.listen(PORT, () => {
    console.log(`[server] Scraper backend running  → http://localhost:${PORT}`);
    console.log(`[server] WebSocket                → ws://localhost:${PORT}/ws`);
    console.log(`[server] Output directory: ${process.env.OUTPUT_DIR || './markdown'}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received — shutting down…`);
    await closeBrowser();
    server.close(() => {
      console.log('[server] HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

export { app, scraperRouter, server };
export default app;
