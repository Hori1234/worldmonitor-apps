/**
 * notification_center_ws.js
 * WebSocket broadcast layer.
 * Exports initWS(server) and broadcast(eventType, payload).
 */

import { WebSocketServer } from 'ws';
import { settings }        from './notification_center_settings.js';

let wss = null;

export function initWS(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    console.log(`[nc-ws] Client connected (${req.socket.remoteAddress})`);
  });

  // Heartbeat — drop stale connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));
  console.log('[nc-ws] WebSocket server ready at /ws');
}

/**
 * Broadcast a typed event to all connected WebSocket clients.
 * @param {string} eventType  e.g. 'notification:new'
 * @param {object} payload
 */
export function broadcast(eventType, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type: eventType, ...payload });
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  });
}

export function clientCount() {
  return wss ? wss.clients.size : 0;
}
