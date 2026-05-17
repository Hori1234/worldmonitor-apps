/** Return the configured API base URL (no trailing slash). */
export function apiBase() {
  return (document.getElementById('api-base-url')?.value ?? 'http://localhost:3737').replace(/\/$/, '');
}

export async function healthCheck() {
  const r = await fetch(`${apiBase()}/api/health`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Scrape ────────────────────────────────────────────────────────────────────

export async function submitScrapeJob(jobs, opts = {}) {
  const r = await fetch(`${apiBase()}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs, ...opts }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function submitFeedJob(feedUrl, category, opts = {}) {
  const r = await fetch(`${apiBase()}/api/scrape/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedUrl, category, ...opts }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function getJob(jobId) {
  const r = await fetch(`${apiBase()}/api/jobs/${jobId}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function listJobs() {
  const r = await fetch(`${apiBase()}/api/jobs`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function cancelJob(jobId) {
  const r = await fetch(`${apiBase()}/api/jobs/${jobId}`, { method: 'DELETE' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

// ── Markdown files ────────────────────────────────────────────────────────────

export async function getMarkdownTree() {
  const r = await fetch(`${apiBase()}/api/markdown/tree`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getMarkdownFile(filePath) {
  const r = await fetch(`${apiBase()}/api/markdown/file?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function saveMarkdownFile(filePath, content) {
  const r = await fetch(`${apiBase()}/api/markdown/file?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function deleteMarkdownFile(filePath) {
  const r = await fetch(`${apiBase()}/api/markdown/file?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function renameMarkdownFile(filePath, newPath) {
  const r = await fetch(`${apiBase()}/api/markdown/file`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, newPath }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function getMarkdownMeta(filePath) {
  const r = await fetch(`${apiBase()}/api/markdown/meta?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function searchMarkdown(q) {
  const r = await fetch(`${apiBase()}/api/markdown/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function exportZipUrl(category) {
  const base = apiBase();
  return category
    ? `${base}/api/export?category=${encodeURIComponent(category)}`
    : `${base}/api/export`;
}

// ── Categories ────────────────────────────────────────────────────────────────

export async function getCategories() {
  const r = await fetch(`${apiBase()}/api/markdown/categories`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function createCategory(name) {
  const r = await fetch(`${apiBase()}/api/markdown/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export async function deleteCategory(name) {
  const r = await fetch(`${apiBase()}/api/markdown/categories/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings() {
  const r = await fetch(`${apiBase()}/api/settings`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function patchSettings(updates) {
  const r = await fetch(`${apiBase()}/api/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

let _ws = null;
let _wsListeners = [];

export function connectWS(onMessage) {
  if (_ws && _ws.readyState < 2) {
    _wsListeners.push(onMessage);
    return;
  }
  const base  = apiBase().replace(/^http/, 'ws');
  _ws         = new WebSocket(`${base}/ws`);
  _wsListeners = [onMessage];

  _ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      _wsListeners.forEach((fn) => fn(data));
    } catch { /* ignore malformed frames */ }
  };

  _ws.onclose = () => {
    _ws = null;
    // Reconnect after 3 s
    setTimeout(() => {
      if (_wsListeners.length > 0) connectWS(_wsListeners[0]);
    }, 3_000);
  };
}

export function disconnectWS() {
  _wsListeners = [];
  _ws?.close();
  _ws = null;
}

