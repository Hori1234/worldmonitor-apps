// ── Notification system ───────────────────────────────────────────────────────
// Stores notifications in localStorage.
// Listens to WS job events and DOM custom events.
// Renders a bell + unread badge in the header and a slide-in drawer.

const STORAGE_KEY = 'scraper:notifications';
const MAX_STORED  = 200;

// ── State ─────────────────────────────────────────────────────────────────────

function loadNotifications() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveNotifications(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_STORED)));
}

let notifications = loadNotifications();
let drawerOpen    = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a notification.
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {string} title
 * @param {string} [body]
 * @param {Object} [meta]  Any extra data to attach
 */
export function addNotification(type, title, body = '', meta = {}) {
  const n = {
    id:        crypto.randomUUID(),
    type,
    title,
    body,
    meta,
    read:      false,
    timestamp: new Date().toISOString(),
  };
  notifications.unshift(n);
  saveNotifications(notifications);
  renderBadge();
  if (drawerOpen) renderList();
  return n;
}

export function markAllRead() {
  notifications.forEach((n) => { n.read = true; });
  saveNotifications(notifications);
  renderBadge();
  if (drawerOpen) renderList();
}

export function clearAll() {
  notifications = [];
  saveNotifications(notifications);
  renderBadge();
  if (drawerOpen) renderList();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initNotifications(wsSubscribe) {
  injectUI();

  // Listen for DOM scraper events (from monitor.js)
  document.addEventListener('scraper:job-done', (e) => {
    const { jobId, completed = 0, failed = 0 } = e.detail ?? {};
    if (failed > 0) {
      addNotification('warning', `Job done — ${completed} ok, ${failed} failed`, `Job ID: ${jobId}`, { jobId });
    } else {
      addNotification('success', `Job done — ${completed} URL${completed !== 1 ? 's' : ''} scraped`, `Job ID: ${jobId}`, { jobId });
    }
  });

  // Also subscribe to WebSocket events for richer server-side events
  if (typeof wsSubscribe === 'function') {
    wsSubscribe((event) => handleWsEvent(event));
  }
}

function handleWsEvent(event) {
  switch (event.type) {
    case 'job:item-error':
      addNotification('error', `Scrape failed: ${event.url}`, event.error, { jobId: event.jobId });
      break;
    case 'job:completed':
      // The DOM event from monitor.js handles the main toast; WS just adds detail
      break;
    case 'job:cancelled':
      addNotification('info', 'Job cancelled', `Job ID: ${event.jobId}`, { jobId: event.jobId });
      break;
  }
}

// ── UI injection ──────────────────────────────────────────────────────────────

function injectUI() {
  // Bell button in header
  const bell = document.getElementById('notif-bell');
  if (bell) {
    bell.addEventListener('click', toggleDrawer);
  }

  // Drawer
  const drawer = document.getElementById('notif-drawer');
  if (drawer) {
    drawer.querySelector('#notif-mark-read')?.addEventListener('click', () => { markAllRead(); });
    drawer.querySelector('#notif-clear')?.addEventListener('click', () => { clearAll(); });
    drawer.querySelector('.drawer-backdrop')?.addEventListener('click', closeDrawer);
  }

  renderBadge();
}

function unreadCount() {
  return notifications.filter((n) => !n.read).length;
}

function renderBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = unreadCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

function toggleDrawer() {
  drawerOpen ? closeDrawer() : openDrawer();
}

function openDrawer() {
  drawerOpen = true;
  const drawer = document.getElementById('notif-drawer');
  drawer?.classList.add('open');
  renderList();
  // Mark all read when opened
  setTimeout(markAllRead, 600);
}

function closeDrawer() {
  drawerOpen = false;
  document.getElementById('notif-drawer')?.classList.remove('open');
}

const TYPE_ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

function renderList() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<p class="notif-empty">No notifications yet.</p>';
    return;
  }

  list.innerHTML = notifications.map((n) => `
    <div class="notif-item ${n.type} ${n.read ? 'read' : 'unread'}" data-id="${n.id}">
      <span class="notif-icon">${TYPE_ICONS[n.type] ?? 'ℹ'}</span>
      <div class="notif-body">
        <p class="notif-title">${escHtml(n.title)}</p>
        ${n.body ? `<p class="notif-desc">${escHtml(n.body)}</p>` : ''}
        <time class="notif-time">${formatTime(n.timestamp)}</time>
      </div>
    </div>
  `).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs  = now - d;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  return d.toLocaleDateString();
}
