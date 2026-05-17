import hljs from 'highlight.js/lib/core';
import hljsJson from 'highlight.js/lib/languages/json';
import hljsBash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('json', hljsJson);
hljs.registerLanguage('bash', hljsBash);

// ── Endpoint definitions ──────────────────────────────────────────────────────

const ENDPOINTS = [
  // ── Health ──────────────────────────────────────────────
  {
    id: 'health', group: 'Health', method: 'GET', path: '/api/health',
    desc: 'Liveness probe — verify the server is running',
  },

  // ── Scrape ──────────────────────────────────────────────
  {
    id: 'scrape-post', group: 'Scrape', method: 'POST', path: '/api/scrape',
    desc: 'Submit a batch of URLs to scrape. Returns a jobId immediately.',
    body: JSON.stringify({
      jobs: [
        { url: 'https://example.com/article', category: 'Technology' },
      ],
      webhookUrl: '',
      skipDuplicates: false,
    }, null, 2),
  },
  {
    id: 'scrape-feed', group: 'Scrape', method: 'POST', path: '/api/scrape/feed',
    desc: 'Parse an RSS/Atom feed and create a scrape job from its items (max 50).',
    body: JSON.stringify({
      feedUrl: 'https://feeds.feedburner.com/TechCrunch',
      category: 'Technology',
      skipDuplicates: true,
    }, null, 2),
  },

  // ── Jobs ────────────────────────────────────────────────
  {
    id: 'jobs-list', group: 'Jobs', method: 'GET', path: '/api/jobs',
    desc: 'List all jobs (active, completed, and failed).',
  },
  {
    id: 'jobs-get', group: 'Jobs', method: 'GET', path: '/api/jobs/:jobId',
    desc: 'Get the status and results of a specific job.',
    pathParams: { jobId: '' },
  },
  {
    id: 'jobs-cancel', group: 'Jobs', method: 'DELETE', path: '/api/jobs/:jobId',
    desc: 'Cancel a running or queued job.',
    pathParams: { jobId: '' },
  },
  {
    id: 'jobs-events', group: 'Jobs', method: 'SSE', path: '/api/jobs/:jobId/events',
    desc: 'Server-Sent Events stream for real-time job progress.',
    pathParams: { jobId: '' },
  },

  // ── Markdown Files ───────────────────────────────────────
  {
    id: 'md-tree', group: 'Markdown', method: 'GET', path: '/api/markdown/tree',
    desc: 'Returns the full directory tree with file size and modifiedAt per node.',
  },
  {
    id: 'md-search', group: 'Markdown', method: 'GET', path: '/api/markdown/search',
    desc: 'Full-text search across all markdown files. Returns matching lines with excerpts.',
    queryParams: [{ name: 'q', value: '', placeholder: 'search term', desc: 'Search query' }],
  },
  {
    id: 'md-file-get', group: 'Markdown', method: 'GET', path: '/api/markdown/file',
    desc: 'Get raw markdown content of a single file.',
    queryParams: [{ name: 'path', value: '', placeholder: 'Technology/article.md', desc: 'Relative path from output dir' }],
  },
  {
    id: 'md-file-put', group: 'Markdown', method: 'PUT', path: '/api/markdown/file',
    desc: 'Overwrite the content of an existing markdown file.',
    queryParams: [{ name: 'path', value: '', placeholder: 'Technology/article.md', desc: 'Relative path from output dir' }],
    body: JSON.stringify({ content: '# My Article\n\nUpdated content here.' }, null, 2),
  },
  {
    id: 'md-file-patch', group: 'Markdown', method: 'PATCH', path: '/api/markdown/file',
    desc: 'Rename or move a markdown file.',
    body: JSON.stringify({ path: 'Technology/old-name.md', newPath: 'Technology/new-name.md' }, null, 2),
  },
  {
    id: 'md-file-delete', group: 'Markdown', method: 'DELETE', path: '/api/markdown/file',
    desc: 'Permanently delete a markdown file.',
    queryParams: [{ name: 'path', value: '', placeholder: 'Technology/article.md', desc: 'Relative path from output dir' }],
  },
  {
    id: 'md-meta', group: 'Markdown', method: 'GET', path: '/api/markdown/meta',
    desc: 'Returns wordCount, readingMinutes, and all YAML front matter fields.',
    queryParams: [{ name: 'path', value: '', placeholder: 'Technology/article.md', desc: 'Relative path from output dir' }],
  },

  // ── Categories ───────────────────────────────────────────
  {
    id: 'cat-list', group: 'Categories', method: 'GET', path: '/api/markdown/categories',
    desc: 'List all category directories with their file counts.',
  },
  {
    id: 'cat-create', group: 'Categories', method: 'POST', path: '/api/markdown/categories',
    desc: 'Create a new category folder.',
    body: JSON.stringify({ name: 'NewCategory' }, null, 2),
  },
  {
    id: 'cat-rename', group: 'Categories', method: 'PATCH', path: '/api/markdown/categories/:name',
    desc: 'Rename an existing category folder.',
    pathParams: { name: '' },
    body: JSON.stringify({ newName: 'RenamedCategory' }, null, 2),
  },
  {
    id: 'cat-delete', group: 'Categories', method: 'DELETE', path: '/api/markdown/categories/:name',
    desc: 'Delete a category and all its markdown files. Irreversible.',
    pathParams: { name: '' },
  },

  // ── Export ───────────────────────────────────────────────
  {
    id: 'export', group: 'Export', method: 'GET', path: '/api/export',
    desc: 'Download all (or a single category\'s) markdown files as a ZIP archive.',
    queryParams: [{ name: 'category', value: '', placeholder: 'Technology (optional)', desc: 'Filter to one category' }],
  },

  // ── Settings ─────────────────────────────────────────────
  {
    id: 'settings-get', group: 'Settings', method: 'GET', path: '/api/settings',
    desc: 'Read all current server settings. API key is masked.',
  },
  {
    id: 'settings-patch', group: 'Settings', method: 'PATCH', path: '/api/settings',
    desc: 'Hot-apply setting changes and rewrite .env. Only send keys you want to change.',
    body: JSON.stringify({
      MAX_CONCURRENCY: '3',
      MAX_RETRIES: '1',
      LOG_LEVEL: 'info',
    }, null, 2),
  },
];

const METHOD_COLORS = {
  GET: '#61affe', POST: '#49cc90', PUT: '#fca130',
  PATCH: '#50e3c2', DELETE: '#f93e3e', SSE: '#a166ff',
};

// ── State ─────────────────────────────────────────────────────────────────────

let activeId      = ENDPOINTS[0].id;
let sseSource     = null;
let reqTabActive  = 'params'; // 'params' | 'body' | 'headers'
let resTabActive  = 'body';   // 'body' | 'headers'
let customHeaders = [{ key: 'Content-Type', value: 'application/json' }];

// ── Init ──────────────────────────────────────────────────────────────────────

export function initExplorer() {
  renderSidebar();
  selectEndpoint(activeId);

  document.getElementById('ex-search')?.addEventListener('input', (e) => {
    filterSidebar(e.target.value.trim().toLowerCase());
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('ex-sidebar-list');
  if (!list) return;

  // Group endpoints
  const groups = {};
  for (const ep of ENDPOINTS) {
    if (!groups[ep.group]) groups[ep.group] = [];
    groups[ep.group].push(ep);
  }

  list.innerHTML = Object.entries(groups).map(([group, eps]) => `
    <div class="ex-group" data-group="${group}">
      <div class="ex-group-label">${group}</div>
      ${eps.map((ep) => `
        <div class="ex-ep-row" data-id="${ep.id}">
          <span class="ex-method-badge" style="background:${METHOD_COLORS[ep.method] ?? '#888'}">${ep.method}</span>
          <span class="ex-ep-path">${shortPath(ep.path)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.ex-ep-row');
    if (row) selectEndpoint(row.dataset.id);
  });
}

function filterSidebar(q) {
  document.querySelectorAll('.ex-ep-row').forEach((row) => {
    const id   = row.dataset.id;
    const ep   = ENDPOINTS.find((e) => e.id === id);
    const text = `${ep.method} ${ep.path} ${ep.desc}`.toLowerCase();
    row.style.display = !q || text.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.ex-group').forEach((g) => {
    const visible = [...g.querySelectorAll('.ex-ep-row')].some((r) => r.style.display !== 'none');
    g.style.display = visible ? '' : 'none';
  });
}

function shortPath(p) {
  return p.replace('/api', '');
}

// ── Select endpoint ───────────────────────────────────────────────────────────

function selectEndpoint(id) {
  activeId = id;
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) return;

  // Sidebar highlight
  document.querySelectorAll('.ex-ep-row').forEach((r) => r.classList.remove('active'));
  document.querySelector(`.ex-ep-row[data-id="${id}"]`)?.classList.add('active');

  // Stop any open SSE
  closeSse();

  renderRequest(ep);
  clearResponse();
}

// ── Request panel ─────────────────────────────────────────────────────────────

function renderRequest(ep) {
  const panel = document.getElementById('ex-request-panel');
  if (!panel) return;

  const hasPathParams  = ep.pathParams && Object.keys(ep.pathParams).length > 0;
  const hasQueryParams = ep.queryParams && ep.queryParams.length > 0;
  const hasBody        = !!ep.body && !['GET','DELETE','SSE'].includes(ep.method) || 
                         (ep.method === 'DELETE' && !!ep.body) ||
                         (ep.method === 'PUT' && !!ep.body);
  const showParams     = hasPathParams || hasQueryParams;
  const isSSE          = ep.method === 'SSE';

  panel.innerHTML = `
    <div class="ex-endpoint-info">
      <span class="ex-method-big" style="background:${METHOD_COLORS[ep.method] ?? '#888'}">${ep.method}</span>
      <span class="ex-endpoint-path">${ep.path}</span>
    </div>
    <p class="ex-desc">${ep.desc}</p>

    <div class="ex-url-bar">
      <input id="ex-resolved-url" class="ex-url-input" readonly />
      ${isSSE
        ? `<button id="ex-send-btn" class="btn btn-primary ex-send-btn">▶ Connect SSE</button>
           <button id="ex-stop-btn" class="btn btn-ghost ex-send-btn" style="display:none">■ Stop</button>`
        : `<button id="ex-send-btn" class="btn btn-primary ex-send-btn">▶ Send</button>`
      }
    </div>

    <div class="ex-req-tabs">
      ${showParams ? `<button class="ex-tab-btn ${reqTabActive==='params'?'active':''}" data-rtab="params">Params</button>` : ''}
      ${(hasBody || ep.method === 'PUT') ? `<button class="ex-tab-btn ${reqTabActive==='body'?'active':''}" data-rtab="body">Body</button>` : ''}
      <button class="ex-tab-btn ${reqTabActive==='headers'?'active':''}" data-rtab="headers">Headers</button>
    </div>

    ${showParams ? `
    <div class="ex-tab-content" data-rtab="params" ${reqTabActive!=='params'?'hidden':''}>
      ${hasPathParams ? `
        <div class="ex-param-section-label">Path Parameters</div>
        ${Object.entries(ep.pathParams).map(([k]) => `
          <div class="ex-param-row">
            <span class="ex-param-key">:${k}</span>
            <input class="ex-param-val path-param" data-key="${k}" placeholder="${k}" />
          </div>
        `).join('')}
      ` : ''}
      ${hasQueryParams ? `
        <div class="ex-param-section-label">Query Parameters</div>
        ${ep.queryParams.map((p) => `
          <div class="ex-param-row">
            <span class="ex-param-key">${p.name}</span>
            <input class="ex-param-val query-param" data-key="${p.name}" 
                   placeholder="${p.placeholder || p.name}" value="${p.value || ''}" 
                   title="${p.desc || ''}" />
            <span class="ex-param-desc">${p.desc || ''}</span>
          </div>
        `).join('')}
      ` : ''}
    </div>` : ''}

    ${(hasBody || ep.method === 'PUT') ? `
    <div class="ex-tab-content" data-rtab="body" ${reqTabActive!=='body'?'hidden':''}>
      <div class="ex-body-toolbar">
        <span class="ex-body-label">JSON</span>
        <button class="btn btn-ghost btn-xs" id="ex-fmt-body-btn">Format</button>
        <button class="btn btn-ghost btn-xs" id="ex-clr-body-btn">Clear</button>
      </div>
      <textarea id="ex-body-editor" class="ex-body-editor" spellcheck="false">${ep.body || '{}'}</textarea>
    </div>` : ''}

    <div class="ex-tab-content" data-rtab="headers" ${reqTabActive!=='headers'?'hidden':''}>
      <div id="ex-headers-list">${renderHeaderRows()}</div>
      <button class="btn btn-ghost btn-xs" id="ex-add-header-btn" style="margin-top:6px">+ Add Header</button>
    </div>
  `;

  // Update resolved URL whenever params change
  updateResolvedUrl(ep);

  // Tab switching
  panel.querySelectorAll('.ex-tab-btn[data-rtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reqTabActive = btn.dataset.rtab;
      panel.querySelectorAll('.ex-tab-btn[data-rtab]').forEach((b) => b.classList.remove('active'));
      panel.querySelectorAll('.ex-tab-content[data-rtab]').forEach((c) => c.hidden = true);
      btn.classList.add('active');
      panel.querySelector(`.ex-tab-content[data-rtab="${reqTabActive}"]`).hidden = false;
    });
  });

  // Path/query param change → update URL
  panel.querySelectorAll('.path-param, .query-param').forEach((inp) => {
    inp.addEventListener('input', () => updateResolvedUrl(ep));
  });

  // Body format / clear
  document.getElementById('ex-fmt-body-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('ex-body-editor');
    try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); } catch { /* invalid JSON */ }
  });
  document.getElementById('ex-clr-body-btn')?.addEventListener('click', () => {
    document.getElementById('ex-body-editor').value = '';
  });

  // Headers
  document.getElementById('ex-add-header-btn')?.addEventListener('click', () => {
    customHeaders.push({ key: '', value: '' });
    document.getElementById('ex-headers-list').innerHTML = renderHeaderRows();
    bindHeaderEvents();
  });
  bindHeaderEvents();

  // Send button
  document.getElementById('ex-send-btn')?.addEventListener('click', () => sendRequest(ep));
  document.getElementById('ex-stop-btn')?.addEventListener('click', () => {
    closeSse();
    toggleSseButtons(false);
  });
}

function renderHeaderRows() {
  return customHeaders.map((h, i) => `
    <div class="ex-param-row">
      <input class="ex-param-key ex-header-key" data-i="${i}" placeholder="Header name" value="${escAttr(h.key)}" />
      <input class="ex-param-val ex-header-val" data-i="${i}" placeholder="Value" value="${escAttr(h.value)}" />
      <button class="btn btn-ghost btn-xs ex-rm-header" data-i="${i}">✕</button>
    </div>
  `).join('');
}

function bindHeaderEvents() {
  document.querySelectorAll('.ex-header-key').forEach((inp) => {
    inp.addEventListener('input', () => { customHeaders[+inp.dataset.i].key = inp.value; });
  });
  document.querySelectorAll('.ex-header-val').forEach((inp) => {
    inp.addEventListener('input', () => { customHeaders[+inp.dataset.i].value = inp.value; });
  });
  document.querySelectorAll('.ex-rm-header').forEach((btn) => {
    btn.addEventListener('click', () => {
      customHeaders.splice(+btn.dataset.i, 1);
      document.getElementById('ex-headers-list').innerHTML = renderHeaderRows();
      bindHeaderEvents();
    });
  });
}

function updateResolvedUrl(ep) {
  const base  = (document.getElementById('api-base-url')?.value ?? 'http://localhost:3737').replace(/\/$/, '');
  let   p     = ep.path;

  // Replace path params
  document.querySelectorAll('.path-param').forEach((inp) => {
    p = p.replace(`:${inp.dataset.key}`, inp.value || `:${inp.dataset.key}`);
  });

  // Build query string
  const qParams = [];
  document.querySelectorAll('.query-param').forEach((inp) => {
    if (inp.value) qParams.push(`${inp.dataset.key}=${encodeURIComponent(inp.value)}`);
  });

  const url = base + p + (qParams.length ? '?' + qParams.join('&') : '');
  const el  = document.getElementById('ex-resolved-url');
  if (el) el.value = url;
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendRequest(ep) {
  const urlEl  = document.getElementById('ex-resolved-url');
  const url    = urlEl?.value;
  if (!url) return;

  // SSE mode
  if (ep.method === 'SSE') {
    startSse(url);
    return;
  }

  // Export: trigger download
  if (ep.id === 'export') {
    window.open(url, '_blank');
    showResponse({ status: 200, statusText: 'OK (download triggered)', time: 0, body: '"Download started in new tab."', headers: {} });
    return;
  }

  const method  = ep.method;
  const headers = {};
  customHeaders.forEach((h) => { if (h.key) headers[h.key] = h.value; });

  let body;
  const bodyEl = document.getElementById('ex-body-editor');
  if (bodyEl && bodyEl.value.trim()) {
    body = bodyEl.value.trim();
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const btn   = document.getElementById('ex-send-btn');
  const orig  = btn?.textContent;
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const t0 = performance.now();
  try {
    const res  = await fetch(url, { method, headers, body });
    const ms   = Math.round(performance.now() - t0);
    const ct   = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    showResponse({ status: res.status, statusText: res.statusText, time: ms, body: text, headers: resHeaders, contentType: ct });
  } catch (err) {
    showResponse({ status: 0, statusText: 'Network Error', time: Math.round(performance.now() - t0), body: err.message, headers: {} });
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function startSse(url) {
  closeSse();
  toggleSseButtons(true);
  clearResponse();

  const container = document.getElementById('ex-response-body');
  if (container) {
    container.innerHTML = '<div id="ex-sse-log" class="ex-sse-log"></div>';
  }
  showStatusBadge(0, 'Connecting…', 0);

  sseSource = new EventSource(url);
  sseSource.onopen = () => showStatusBadge(200, 'Connected', 0);
  sseSource.onmessage = (e) => {
    const log = document.getElementById('ex-sse-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'ex-sse-line';
    try {
      const parsed = JSON.parse(e.data);
      line.innerHTML = `<span class="ex-sse-ts">${new Date().toLocaleTimeString()}</span><span class="ex-sse-data">${escHtml(JSON.stringify(parsed, null, 2))}</span>`;
      if (parsed.status === 'completed' || parsed.status === 'failed' || parsed.status === 'cancelled') {
        closeSse();
        toggleSseButtons(false);
      }
    } catch {
      line.textContent = e.data;
    }
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  };
  sseSource.onerror = () => {
    showStatusBadge(0, 'Disconnected', 0);
    closeSse();
    toggleSseButtons(false);
  };
}

function closeSse() {
  if (sseSource) { sseSource.close(); sseSource = null; }
}

function toggleSseButtons(connecting) {
  const send = document.getElementById('ex-send-btn');
  const stop = document.getElementById('ex-stop-btn');
  if (send) send.style.display = connecting ? 'none' : '';
  if (stop) stop.style.display = connecting ? '' : 'none';
}

// ── Response panel ────────────────────────────────────────────────────────────

function clearResponse() {
  const panel = document.getElementById('ex-response-panel');
  if (panel) panel.innerHTML = '<p class="ex-res-placeholder">Send a request to see the response here.</p>';
}

function showStatusBadge(status, statusText, ms) {
  let el = document.getElementById('ex-status-row');
  if (!el) {
    const panel = document.getElementById('ex-response-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div id="ex-status-row" class="ex-status-row"></div>
      <div class="ex-res-tabs">
        <button class="ex-tab-btn active" data-restab="body">Body</button>
        <button class="ex-tab-btn" data-restab="headers">Headers</button>
        <button class="btn btn-ghost btn-xs ex-copy-res-btn">Copy</button>
      </div>
      <div id="ex-response-body" class="ex-response-body"></div>
      <div id="ex-response-headers" class="ex-response-headers" hidden></div>
    `;
    panel.querySelectorAll('.ex-tab-btn[data-restab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        resTabActive = btn.dataset.restab;
        panel.querySelectorAll('.ex-tab-btn[data-restab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('ex-response-body').hidden    = resTabActive !== 'body';
        document.getElementById('ex-response-headers').hidden = resTabActive !== 'headers';
      });
    });
    panel.querySelector('.ex-copy-res-btn')?.addEventListener('click', () => {
      const content = document.getElementById('ex-response-body')?.textContent ?? '';
      navigator.clipboard.writeText(content).catch(() => {});
    });
    el = document.getElementById('ex-status-row');
  }

  const cls = status >= 200 && status < 300 ? 'ok' : status >= 400 ? 'err' : 'warn';
  el.innerHTML = `
    <span class="ex-status-badge ${cls}">${status || '—'}</span>
    <span class="ex-status-text">${escHtml(statusText)}</span>
    ${ms ? `<span class="ex-status-time">${ms} ms</span>` : ''}
  `;
}

function showResponse({ status, statusText, time, body, headers, contentType = '' }) {
  showStatusBadge(status, statusText, time);

  // Body
  const bodyEl = document.getElementById('ex-response-body');
  if (bodyEl) {
    let highlighted = '';
    const isJson = contentType.includes('json') || isJsonString(body);
    if (isJson) {
      try {
        const pretty = JSON.stringify(JSON.parse(body), null, 2);
        highlighted = hljs.highlight(pretty, { language: 'json' }).value;
      } catch {
        highlighted = escHtml(body);
      }
    } else {
      highlighted = escHtml(body);
    }
    bodyEl.innerHTML = `<pre class="ex-res-pre hljs">${highlighted}</pre>`;
  }

  // Headers
  const hdrEl = document.getElementById('ex-response-headers');
  if (hdrEl) {
    hdrEl.innerHTML = Object.entries(headers).map(([k, v]) => `
      <div class="ex-param-row">
        <span class="ex-param-key">${escHtml(k)}</span>
        <span class="ex-param-val">${escHtml(v)}</span>
      </div>
    `).join('') || '<p style="padding:12px;color:var(--text-dim)">No headers</p>';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isJsonString(s) {
  try { JSON.parse(s); return true; } catch { return false; }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
