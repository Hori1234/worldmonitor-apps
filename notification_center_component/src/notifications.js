/**
 * notifications.js
 * Bell icon / drawer — shows live notifications from WebSocket + polls unread count.
 */

import * as api from './api.js';
import { toast } from './toast.js';

const STORAGE_KEY = 'nc:notifications';

let _drawerOpen = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const bell   = () => document.getElementById('notif-bell');
const badge  = () => document.getElementById('notif-badge');
const drawer = () => document.getElementById('notif-drawer');
const list   = () => document.getElementById('drawer-list');
const close  = () => document.getElementById('drawer-close');

// ── Init ──────────────────────────────────────────────────────────────────────

export function initNotifications() {
  bell()?.addEventListener('click', toggleDrawer);
  close()?.addEventListener('click', closeDrawer);

  // Listen for new notifications via WebSocket
  api.onWS('notification:new', (msg) => {
    _prependCard(msg);
    _updateBadge();
    toast(`New notification: ${msg.title ?? msg.kind}`, 'info');
  });

  api.onWS('notification:read', () => _updateBadge());
  api.onWS('notification:cleared', () => {
    const l = list();
    if (l) l.innerHTML = '<p style="color:var(--text-3);padding:8px;font-size:12px;">No notifications.</p>';
    _updateBadge();
  });

  // Initial load
  _loadDrawer();
  _updateBadge();
}

// ── Badge ─────────────────────────────────────────────────────────────────────

async function _updateBadge() {
  try {
    const res = await api.health();
    const count = res.unread ?? 0;
    const b = badge();
    if (!b) return;
    b.textContent = count > 99 ? '99+' : String(count);
    b.hidden = count === 0;
  } catch { /* service offline */ }
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function toggleDrawer() {
  _drawerOpen ? closeDrawer() : openDrawer();
}

function openDrawer() {
  _drawerOpen = true;
  drawer()?.classList.remove('hidden');
  _loadDrawer();
}

function closeDrawer() {
  _drawerOpen = false;
  drawer()?.classList.add('hidden');
}

async function _loadDrawer() {
  const l = list();
  if (!l) return;
  try {
    const res = await api.listNotifications({ limit: 30 });
    const items = res.notifications ?? [];
    l.innerHTML = '';
    if (!items.length) {
      l.innerHTML = '<p style="color:var(--text-3);padding:8px;font-size:12px;">No notifications.</p>';
      return;
    }
    items.forEach((n) => _prependCard(n, false));
  } catch {
    l.innerHTML = '<p style="color:var(--danger);padding:8px;font-size:12px;">Service offline.</p>';
  }
}

function _prependCard(n, prepend = true) {
  const l = list();
  if (!l) return;

  const el = document.createElement('div');
  el.className = `notif-card${n.read ? '' : ' unread'}`;
  el.dataset.id = n.id;
  el.innerHTML = `
    <div class="card-header">
      <span class="card-kind">${_kindIcon(n.kind)} ${n.kind}</span>
      <span class="card-time">${_relTime(n.timestamp)}</span>
    </div>
    <div class="card-title">${_esc(n.title ?? '')}</div>
    <div class="card-body">${_esc(n.summary ?? '')}</div>
  `;
  el.addEventListener('click', () => _onCardClick(n.id, el));

  if (prepend && l.firstChild) {
    l.insertBefore(el, l.firstChild);
  } else {
    l.appendChild(el);
  }
}

async function _onCardClick(id, el) {
  if (!el.classList.contains('unread')) return;
  await api.markRead(id);
  el.classList.remove('unread');
  _updateBadge();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _kindIcon(kind) {
  const icons = { market: '📈', news: '📰', polymarket: '🎯', map: '🗺', general: '⚙' };
  return icons[kind] ?? '🔔';
}

function _relTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
