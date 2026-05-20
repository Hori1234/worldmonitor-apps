/**
 * api.js — HTTP + WebSocket client for the Notification Center Service.
 * All paths are relative so Vite's proxy handles routing to localhost:3003.
 */

const BASE = '/api/nc';

async function _request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
  if (!res.ok && json.ok === undefined) json.ok = false;
  return json;
}

const get    = (p)         => _request('GET',    p);
const post   = (p, body)   => _request('POST',   p, body);
const put    = (p, body)   => _request('PUT',    p, body);
const patch  = (p, body)   => _request('PATCH',  p, body);
const del    = (p)         => _request('DELETE', p);

// ── Health ────────────────────────────────────────────────────────────────────

export const health = () => get('/health');

// ── Notifications ─────────────────────────────────────────────────────────────

export const listNotifications  = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return get(`/notifications${qs ? '?' + qs : ''}`);
};
export const markRead           = (id)    => patch(`/notifications/${id}/read`);
export const markAllRead        = ()      => post('/notifications/mark-all-read');
export const clearNotifications = ()      => del('/notifications');
export const deleteNotification = (id)    => del(`/notifications/${id}`);

// ── Profiles ──────────────────────────────────────────────────────────────────

export const listProfiles   = ()           => get('/profiles');
export const createProfile  = (data)       => post('/profiles', data);
export const getProfile     = (id)         => get(`/profiles/${id}`);
export const updateProfile  = (id, data)   => put(`/profiles/${id}`, data);
export const deleteProfile  = (id)         => del(`/profiles/${id}`);
export const getCanvas      = (id)         => get(`/profiles/${id}/canvas`);
export const saveCanvas     = (id, canvas) => put(`/profiles/${id}/canvas`, canvas);

// ── Edge Rules ────────────────────────────────────────────────────────────────

export const listRules   = ()           => get('/edge-rules');
export const createRule  = (data)       => post('/edge-rules', data);
export const getRule     = (id)         => get(`/edge-rules/${id}`);
export const updateRule  = (id, data)   => put(`/edge-rules/${id}`, data);
export const deleteRule  = (id)         => del(`/edge-rules/${id}`);
export const enableRule  = (id)         => post(`/edge-rules/${id}/enable`);
export const disableRule = (id)         => post(`/edge-rules/${id}/disable`);
export const testRule    = (id, payload)=> post(`/edge-rules/${id}/test`, payload);

// ── WebSocket ─────────────────────────────────────────────────────────────────

let _ws         = null;
let _reconnectTimer = null;
const _handlers = new Map(); // type → Set<handler>

export function connectWS(onConnect) {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  const wsUrl = `ws://${window.location.hostname}:3003/ws`;
  _ws = new WebSocket(wsUrl);

  _ws.addEventListener('open', () => {
    console.log('[nc-ws] Connected');
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    onConnect?.();
  });

  _ws.addEventListener('message', (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      const handlers = _handlers.get(msg.type);
      if (handlers) handlers.forEach((fn) => fn(msg));
      const wildcards = _handlers.get('*');
      if (wildcards) wildcards.forEach((fn) => fn(msg));
    } catch { /* malformed */ }
  });

  _ws.addEventListener('close', () => {
    console.log('[nc-ws] Disconnected — reconnecting in 5s…');
    _reconnectTimer = setTimeout(() => connectWS(onConnect), 5000);
  });

  _ws.addEventListener('error', () => { _ws.close(); });
}

export function onWS(type, fn) {
  if (!_handlers.has(type)) _handlers.set(type, new Set());
  _handlers.get(type).add(fn);
}

export function offWS(type, fn) {
  _handlers.get(type)?.delete(fn);
}
