/**
 * notification_center_manager.js
 * In-memory notification store with JSON persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { settings } from './notification_center_settings.js';

const DATA_FILE = path.resolve('./data/notifications.json');

// ── State ─────────────────────────────────────────────────────────────────────

let notifications = [];

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadNotifications() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      notifications = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      _applyRetention();
    }
  } catch (e) {
    console.warn('[nc-manager] Could not load notifications:', e.message);
    notifications = [];
  }
}

function _save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(notifications, null, 2));
  } catch (e) {
    console.warn('[nc-manager] Could not persist notifications:', e.message);
  }
}

function _applyRetention() {
  const cutoff = Date.now() - settings.RETENTION_DAYS * 86_400_000;
  notifications = notifications.filter((n) => new Date(n.timestamp).getTime() > cutoff);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function addNotification(notification) {
  notifications.unshift(notification);
  if (notifications.length > settings.MAX_STORED) {
    notifications = notifications.slice(0, settings.MAX_STORED);
  }
  _save();
  return notification;
}

export function listNotifications({ kind, unread, page = 1, limit = 50 } = {}) {
  let result = notifications;
  if (kind)   result = result.filter((n) => n.kind === kind);
  if (unread) result = result.filter((n) => !n.read);
  const total = result.length;
  const start = (page - 1) * limit;
  return { notifications: result.slice(start, start + limit), total, page, limit };
}

export function getNotification(id) {
  return notifications.find((n) => n.id === id) ?? null;
}

export function markRead(id) {
  const n = notifications.find((n) => n.id === id);
  if (!n) return null;
  n.read = true;
  _save();
  return n;
}

export function markAllRead() {
  notifications.forEach((n) => { n.read = true; });
  _save();
}

export function deleteNotification(id) {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notifications.splice(idx, 1);
  _save();
  return true;
}

export function clearAll() {
  notifications = [];
  _save();
}

export function unreadCount() {
  return notifications.filter((n) => !n.read).length;
}
