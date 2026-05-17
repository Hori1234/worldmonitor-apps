import 'highlight.js/styles/github-dark.css';
import './style.css';

import { healthCheck, getMarkdownTree, getCategories, listJobs, connectWS, apiBase } from './api.js';
import { initMonitor, clearFinished } from './monitor.js';
import { initBuilder }  from './builder.js';
import { toast }        from './toast.js';
import { initFileBrowser, getCurrentRaw } from './filebrowser.js';
import { initNotifications, addNotification } from './notifications.js';
import { initSettings } from './settings.js';
import { initExplorer } from './api-explorer.js';

// ── Top-level page navigation ────────────────────────────────────────────

function initAppNav() {
  document.querySelectorAll('.app-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.app-nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.app-page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`page-${page}`)?.classList.add('active');
    });
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`)?.classList.add('active');
    });
  });
}

// ── Health polling ────────────────────────────────────────────────────────────

async function checkHealth() {
  const badge = document.getElementById('health-badge');
  const text  = document.getElementById('health-text');
  try {
    await healthCheck();
    badge.className  = 'health-badge ok';
    text.textContent = 'Online';
  } catch {
    badge.className  = 'health-badge error';
    text.textContent = 'Offline';
  }
}

// ── Copy buttons ──────────────────────────────────────────────────────────────

function initCopyButtons() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const targetId = btn.dataset.for;
    if (!targetId) return;

    let text;
    if (targetId === 'preview-raw-text') {
      text = getCurrentRaw();
    } else {
      text = document.getElementById(targetId)?.textContent ?? '';
    }
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => (btn.textContent = orig), 1600);
    } catch {
      toast('Could not copy to clipboard', 'err');
    }
  });
}

// ── API URL change → immediate health re-check ────────────────────────────────

function initApiUrlInput() {
  document.getElementById('api-base-url')?.addEventListener('change', () => {
    checkHealth();
    initStatsBar();
  });
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

async function initStatsBar() {
  try {
    const [{ tree }, categories, jobs] = await Promise.all([
      getMarkdownTree().catch(() => ({ tree: [] })),
      getCategories().catch(() => ({ categories: [] })),
      listJobs().catch(() => ({ jobs: [] })),
    ]);
    const totalFiles = countAllFiles(tree);
    const totalCats  = (categories.categories ?? []).length;
    const today      = new Date().toDateString();
    const jobsToday  = (jobs.jobs ?? []).filter((j) => new Date(j.createdAt).toDateString() === today).length;

    document.getElementById('stat-files')?.setAttribute('textContent', totalFiles) ||
      (document.getElementById('stat-files').textContent = totalFiles);
    document.getElementById('stat-categories').textContent = totalCats;
    document.getElementById('stat-jobs-today').textContent = jobsToday;
  } catch { /* stats bar is non-critical */ }
}

function countAllFiles(nodes) {
  let n = 0;
  for (const node of nodes ?? []) {
    if (node.type === 'file') n++;
    else if (node.children) n += countAllFiles(node.children);
  }
  return n;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function initWebSocket() {
  connectWS((event) => {
    // Forward to notification system (handled inside notifications.js subscriber)
    document.dispatchEvent(new CustomEvent('ws:event', { detail: event }));
  });
}

// ── Notification drawer close button ─────────────────────────────────────────

function initDrawerClose() {
  document.querySelector('.drawer-close-btn')?.addEventListener('click', () => {
    document.getElementById('notif-drawer')?.classList.remove('open');
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initAppNav();
initTabs();
initMonitor();

// ── Fix main height to fill viewport below all chrome elements ───────────────
function syncChromeHeight() {
  const header  = document.getElementById('app-header')?.offsetHeight  ?? 0;
  const stats   = document.getElementById('stats-bar')?.offsetHeight   ?? 0;
  const nav     = document.getElementById('app-nav')?.offsetHeight     ?? 0;
  document.documentElement.style.setProperty('--chrome-h', `${header + stats + nav + 20}px`);
}
syncChromeHeight();
window.addEventListener('resize', syncChromeHeight);
initBuilder();
initCopyButtons();
initApiUrlInput();
initFileBrowser();
initNotifications((cb) => {
  document.addEventListener('ws:event', (e) => cb(e.detail));
});
initSettings();
initExplorer();
initWebSocket();
initDrawerClose();
checkHealth();
setInterval(checkHealth, 30_000);
initStatsBar();
document.addEventListener('scraper:job-done', () => setTimeout(initStatsBar, 2000));

document.getElementById('clear-done-btn')
  ?.addEventListener('click', clearFinished);

// Health check on load and every 15 s
checkHealth();
setInterval(checkHealth, 15_000);
