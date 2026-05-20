/**
 * notification_center_routes.js
 * All Express route handlers for the Notification Center Service.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';

import { broadcast } from './notification_center_ws.js';
import { emitICM }   from './notification_center_icm.js';
import {
  addNotification, listNotifications, getNotification,
  markRead, markAllRead, deleteNotification, clearAll, unreadCount,
} from './notification_center_manager.js';
import {
  listProfiles, createProfile, getProfile, renameProfile,
  deleteProfile, getCanvas, saveCanvas,
} from './notification_center_profiles.js';
import {
  listRules, getRule, createRule, updateRule, deleteRule,
  toggleRule, testRule,
} from './notification_center_edge_engine.js';

// Notification object factories
import { createMarketNotification,    toICM as marketICM }      from './objects/market_notification.js';
import { createNewsNotification,      toICM as newsICM }         from './objects/news_notification.js';
import { createPolymarketNotification,toICM as polymarketICM }   from './objects/polymarket_notification.js';
import { createMapNotification,       toICM as mapICM }          from './objects/map_notification.js';
import { createGeneralNotification,   toICM as generalICM }      from './objects/general_notification.js';

const router = express.Router();

const ingestLimit = rateLimit({
  windowMs: 60_000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many requests.' },
});

// ── Health ─────────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'ok', uptime: process.uptime(), unread: unreadCount() });
});

// ── SMTP connectivity test ─────────────────────────────────────────────────────

router.post('/test-smtp', async (req, res) => {
  const { host, port, user, pass } = req.body ?? {};
  if (!host || !user || !pass) {
    return res.status(400).json({ ok: false, error: 'host, user, and pass are required' });
  }
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host,
      port: parseInt(port ?? '587', 10),
      secure: parseInt(port ?? '587', 10) === 465,
      auth: { user, pass },
    });
    await transport.verify();
    res.json({ ok: true, message: `SMTP verified — ${host}:${port ?? 587}` });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Notifications ──────────────────────────────────────────────────────────────

router.get('/notifications', (req, res) => {
  const { kind, unread, page, limit } = req.query;
  const result = listNotifications({
    kind,
    unread: unread === 'true',
    page:   parseInt(page  ?? '1',  10),
    limit:  parseInt(limit ?? '50', 10),
  });
  res.json({ ok: true, ...result });
});

router.get('/notifications/unread', (_req, res) => {
  const result = listNotifications({ unread: true, limit: 200 });
  res.json({ ok: true, ...result });
});

router.post('/notifications', (req, res) => {
  try {
    const n = createGeneralNotification({ template: 'custom', ...req.body });
    addNotification(n);
    broadcast('notification:new', n);
    emitICM(generalICM(n));
    res.status(201).json({ ok: true, notification: n });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.patch('/notifications/:id/read', (req, res) => {
  const n = markRead(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'Notification not found' });
  broadcast('notification:read', { id: n.id });
  res.json({ ok: true, notification: n });
});

router.post('/notifications/mark-all-read', (_req, res) => {
  markAllRead();
  broadcast('notification:read', { all: true });
  res.json({ ok: true });
});

router.delete('/notifications', (_req, res) => {
  clearAll();
  broadcast('notification:cleared', {});
  res.json({ ok: true });
});

router.delete('/notifications/:id', (req, res) => {
  const ok = deleteNotification(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Notification not found' });
  res.json({ ok: true });
});

// ── Typed Ingest ──────────────────────────────────────────────────────────────

function ingestHandler(factory, icmFactory) {
  return (req, res) => {
    try {
      const n = factory(req.body);
      addNotification(n);
      const icm = icmFactory(n);
      emitICM(icm);
      broadcast('notification:new', n);
      res.status(201).json({ ok: true, notification: n, icm });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  };
}

router.post('/ingest/market',      ingestLimit, ingestHandler(createMarketNotification,     marketICM));
router.post('/ingest/news',        ingestLimit, ingestHandler(createNewsNotification,        newsICM));
router.post('/ingest/polymarket',  ingestLimit, ingestHandler(createPolymarketNotification,  polymarketICM));
router.post('/ingest/map',         ingestLimit, ingestHandler(createMapNotification,         mapICM));
router.post('/ingest/general',     ingestLimit, ingestHandler(createGeneralNotification,     generalICM));

// ── Profiles ──────────────────────────────────────────────────────────────────

router.get('/profiles', (_req, res) => {
  res.json({ ok: true, profiles: listProfiles() });
});

router.post('/profiles', (req, res) => {
  try {
    const profile = createProfile(req.body);
    res.status(201).json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/profiles/:id', (req, res) => {
  const profile = getProfile(req.params.id);
  if (!profile) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true, profile });
});

router.put('/profiles/:id', (req, res) => {
  const profile = renameProfile(req.params.id, req.body);
  if (!profile) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true, profile });
});

router.delete('/profiles/:id', (req, res) => {
  const ok = deleteProfile(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true });
});

router.get('/profiles/:id/canvas', (req, res) => {
  const canvas = getCanvas(req.params.id);
  if (!canvas) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true, canvas });
});

router.put('/profiles/:id/canvas', (req, res) => {
  const canvas = saveCanvas(req.params.id, req.body);
  if (!canvas) return res.status(404).json({ ok: false, error: 'Profile not found' });
  res.json({ ok: true, canvas });
});

// ── Edge Rules ────────────────────────────────────────────────────────────────

router.get('/edge-rules', (_req, res) => {
  res.json({ ok: true, rules: listRules() });
});

router.post('/edge-rules', (req, res) => {
  try {
    const rule = createRule(req.body);
    res.status(201).json({ ok: true, rule });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/edge-rules/:id', (req, res) => {
  const rule = getRule(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
  res.json({ ok: true, rule });
});

router.put('/edge-rules/:id', (req, res) => {
  const rule = updateRule(req.params.id, req.body);
  if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
  res.json({ ok: true, rule });
});

router.delete('/edge-rules/:id', (req, res) => {
  const ok = deleteRule(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Rule not found' });
  res.json({ ok: true });
});

router.post('/edge-rules/:id/enable', (req, res) => {
  const rule = toggleRule(req.params.id, true);
  if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
  res.json({ ok: true, rule });
});

router.post('/edge-rules/:id/disable', (req, res) => {
  const rule = toggleRule(req.params.id, false);
  if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
  res.json({ ok: true, rule });
});

router.post('/edge-rules/:id/test', async (req, res) => {
  const result = await testRule(req.params.id, req.body);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

export default router;
