/**
 * objects-browser.js — Browser Triggers tab
 * Vertical list (40%) + detail panel (60%).
 * Receives triggers from WebSocket service and canvas test events.
 */

import * as api  from './api.js';
import { toast } from './toast.js';

// Same palette as canvas.js
const KIND_COLORS = {
  market:     '#44ff88',
  news:       '#4499ff',
  polymarket: '#ff9944',
  map:        '#44ddff',
  general:    '#aa77ff',
  edgeRule:   '#ffcc33',
};
const KIND_ICONS = {
  market: '📈', news: '📰', polymarket: '🎯',
  map: '🗺', general: '⚙', edgeRule: '⚡',
};

let _allNotifications = [];
let _selectedId       = null;
let _tabUnread        = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const listEl       = () => document.getElementById('objects-list');
const detailEl     = () => document.getElementById('trigger-detail');
const search       = () => document.getElementById('objects-search');
const filterKind   = () => document.getElementById('objects-filter-kind');
const filterUnread = () => document.getElementById('objects-filter-unread');
const markAllBtn   = () => document.getElementById('objects-mark-all-btn');
const clearBtn     = () => document.getElementById('objects-clear-btn');
const tabBtn       = () => document.querySelector('.nav-btn[data-tab="objects"]');

// ── Tab badge helpers ─────────────────────────────────────────────────────────

function _bumpTabBadge() {
  const tab = document.getElementById('tab-objects');
  if (tab?.classList.contains('active')) { _tabUnread = 0; return; }
  _tabUnread++;
  const btn = tabBtn();
  if (!btn) return;
  let badge = btn.querySelector('.tab-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'tab-badge';
    btn.appendChild(badge);
  }
  badge.textContent = _tabUnread > 99 ? '99+' : String(_tabUnread);
}

function _clearTabBadge() {
  _tabUnread = 0;
  tabBtn()?.querySelector('.tab-badge')?.remove();
}

// Switch to the Objects Browser tab and clear its badge
function _switchToTab() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach((p) => p.classList.remove('active'));
  tabBtn()?.classList.add('active');
  document.getElementById('tab-objects')?.classList.add('active');
  _clearTabBadge();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initObjectsBrowser() {
  search()?.addEventListener('input',  _renderList);
  filterKind()?.addEventListener('change', _renderList);
  filterUnread()?.addEventListener('change', _renderList);

  markAllBtn()?.addEventListener('click', async () => {
    await api.markAllRead();
    _allNotifications.forEach((n) => { n.read = true; });
    _renderList();
    if (_selectedId) _renderDetail(_selectedId);
    toast('All marked as read', 'success');
  });

  clearBtn()?.addEventListener('click', async () => {
    if (!confirm('Clear all triggers?')) return;
    await api.clearNotifications();
    _allNotifications = [];
    _selectedId = null;
    _renderList();
    _showDetailPlaceholder();
    toast('All triggers cleared', 'success');
  });

  // WebSocket — live service notifications
  api.onWS?.('notification:new', (msg) => {
    _allNotifications.unshift(msg);
    _renderList();
    _bumpTabBadge();
    toast(`🔔 ${msg.title ?? msg.kind ?? 'New trigger'} — Browser Triggers`, 'info');
  });

  api.onWS?.('notification:cleared', () => {
    _allNotifications = [];
    _selectedId = null;
    _renderList();
    _showDetailPlaceholder();
  });

  // Canvas test triggers → synthetic entry
  document.addEventListener('nc:canvas:test', (e) => {
    const { nodeId, kind, data } = e.detail;
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([k]) => !['inputs', 'outputs'].includes(k))
    );
    const synth = {
      id:        `test-${nodeId}-${Date.now()}`,
      kind,
      title:     `[TEST] ${data.title ?? data.ticker ?? data.ruleName ?? data.question ?? kind}`,
      summary:   `Canvas test trigger`,
      data:      filtered,
      timestamp: new Date().toISOString(),
      read:      false,
      source:    'canvas-test',
    };
    _allNotifications.unshift(synth);
    _renderList();
    _bumpTabBadge();
    toast(`▶ Test fired: ${synth.title} — Browser Triggers`, 'info');
  });

  // Clear badge when user manually clicks the tab
  tabBtn()?.addEventListener('click', _clearTabBadge);

  _load();
}

export async function refreshObjectsBrowser() { await _load(); }

// ── Load ──────────────────────────────────────────────────────────────────────

async function _load() {
  try {
    const res = await api.listNotifications({ limit: 500 });
    _allNotifications = res.notifications ?? [];
    _renderList();
  } catch {
    const l = listEl();
    if (l) l.innerHTML = '<div class="empty-state" style="color:var(--danger)">Service offline.</div>';
  }
}

// ── List render ───────────────────────────────────────────────────────────────

function _filterItems() {
  const q      = search()?.value.toLowerCase() ?? '';
  const kind   = filterKind()?.value ?? '';
  const unread = filterUnread()?.checked ?? false;
  let items = _allNotifications;
  if (kind)   items = items.filter((n) => n.kind === kind);
  if (unread) items = items.filter((n) => !n.read);
  if (q)      items = items.filter((n) =>
    (n.title ?? '').toLowerCase().includes(q) ||
    (n.summary ?? '').toLowerCase().includes(q) ||
    (n.kind ?? '').toLowerCase().includes(q)
  );
  return items;
}

function _renderList() {
  const l = listEl();
  if (!l) return;
  const items = _filterItems();
  if (!items.length) {
    l.innerHTML = '<div class="empty-state">No triggers yet.</div>';
    return;
  }
  l.innerHTML = items.map((n) => {
    const color  = KIND_COLORS[n.kind] ?? '#888';
    const icon   = KIND_ICONS[n.kind]  ?? '🔔';
    const isTest = n.source === 'canvas-test';
    const active = n.id === _selectedId ? ' active' : '';
    const unread = n.read ? '' : ' unread';
    return `
      <div class="trigger-row${active}${unread}" data-id="${_esc(n.id)}"
           style="--row-kind-color:${color}">
        <span class="trigger-row-icon">${icon}</span>
        <div class="trigger-row-body">
          <div class="trigger-row-title">${_esc(n.title ?? '—')}</div>
          <div class="trigger-row-meta">
            <span class="trigger-row-kind">${n.kind ?? 'unknown'}</span>
            <span class="trigger-row-time">${_relTime(n.timestamp)}</span>
          </div>
        </div>
        <span class="trigger-source-badge${isTest ? ' canvas' : ''}">${isTest ? 'canvas' : 'service'}</span>
      </div>`;
  }).join('');
  l.querySelectorAll('.trigger-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      _selectedId = id;
      const n = _allNotifications.find((x) => x.id === id);
      if (n && !n.read) {
        n.read = true;
        if (!n.source) api.markRead(id).catch(() => {});
      }
      _renderList();
      _renderDetail(id);
    });
  });
}

// ── Detail render ─────────────────────────────────────────────────────────────

function _showDetailPlaceholder() {
  const d = detailEl();
  if (d) d.innerHTML = '<div class="detail-placeholder">🔔 Select a trigger to view its data</div>';
}

function _renderDetail(id) {
  const n = _allNotifications.find((x) => x.id === id);
  const d = detailEl();
  if (!n || !d) return;
  const color  = KIND_COLORS[n.kind] ?? '#888';
  const icon   = KIND_ICONS[n.kind]  ?? '🔔';
  const isTest = n.source === 'canvas-test';
  const coreFields = [
    ['ID',        n.id],
    ['Kind',      n.kind ?? '—'],
    ['Source',    isTest ? 'Canvas test' : 'Service'],
    ['Timestamp', n.timestamp ? new Date(n.timestamp).toLocaleString() : '—'],
    ['Read',      n.read ? 'Yes' : 'No'],
  ];
  const payloadObj    = n.data ?? _extractPayload(n);
  const payloadFields = Object.entries(payloadObj)
    .filter(([k]) => !['id','kind','source','timestamp','read','title','summary'].includes(k));
  d.innerHTML = `
    <div class="detail-header" style="--detail-kind-color:${color}">
      <span class="detail-kind-icon">${icon}</span>
      <div class="detail-heading">
        <div class="detail-title">${_esc(n.title ?? '—')}</div>
        <div class="detail-subtitle">${_esc(n.summary ?? '')} &nbsp;·&nbsp;
          <span class="trigger-source-badge${isTest ? ' canvas' : ''}">${isTest ? 'canvas' : 'service'}</span>
        </div>
      </div>
      ${!n.read ? `<button class="btn detail-mark-btn" data-mark="${_esc(n.id)}">Mark read</button>` : ''}
    </div>
    <div class="detail-body">
      <div class="detail-section-title">Core</div>
      ${coreFields.map(([k, v]) => _kvRow(k, v)).join('')}
      ${payloadFields.length ? `
        <div class="detail-section-title">Payload</div>
        ${payloadFields.map(([k, v]) => _kvRow(k, v)).join('')}
      ` : ''}
      <div class="detail-section-title">Raw JSON</div>
      <pre class="detail-raw">${_esc(JSON.stringify(n, null, 2))}</pre>
    </div>
  `;
  d.querySelector('[data-mark]')?.addEventListener('click', async () => {
    n.read = true;
    if (!isTest) await api.markRead(n.id).catch(() => {});
    _renderList();
    _renderDetail(id);
  });
}

function _kvRow(key, value) {
  const display = value === undefined || value === null ? '—' : String(value);
  return `<div class="detail-kv">
    <span class="detail-key">${_esc(String(key))}</span>
    <span class="detail-val">${_esc(display)}</span>
  </div>`;
}

function _extractPayload(n) {
  const skip = new Set(['id','kind','source','timestamp','read','title','summary']);
  return Object.fromEntries(Object.entries(n).filter(([k]) => !skip.has(k)));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _relTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
