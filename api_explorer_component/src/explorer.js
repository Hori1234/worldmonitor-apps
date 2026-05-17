/**
 * explorer.js
 *
 * Generic API explorer factory. Call createExplorer() once per service tab.
 * All DOM queries are scoped to the container element to avoid ID conflicts
 * between the two explorer instances.
 *
 * @param {object} config
 * @param {string}   config.prefix     - ID prefix used in the HTML (e.g. 'scraper' → 'scraper-url')
 * @param {Array}    config.endpoints  - Endpoint definition array
 * @param {string}   config.urlPrefix  - Prepended to all endpoint paths (e.g. '/api' or '/api/kg')
 */

import hljs from 'highlight.js/lib/core';
import hljsJson from 'highlight.js/lib/languages/json';
hljs.registerLanguage('json', hljsJson);

const METHOD_COLORS = {
  GET:    '#44ff88',
  POST:   '#ffaa00',
  PUT:    '#3388ff',
  PATCH:  '#3b82f6',
  DELETE: '#ff4444',
  SSE:    '#a855f7',
};

export function createExplorer({ prefix, endpoints, urlPrefix = '' }) {
  // Shorthand — getElementById with prefix
  const $  = (id)  => document.getElementById(`${prefix}-${id}`);

  // Required elements
  const listEl      = $('list');
  const searchInp   = $('search');
  const methodBadge = $('method');
  const urlInput    = $('url');
  const sendBtn     = $('send');
  const descEl      = $('desc');
  const paramsEl    = $('params');
  const bodyArea    = $('body');
  const respStatus  = $('resp-status');
  const respTime    = $('resp-time');
  const copyResp    = $('copy-resp');
  const respBody    = $('resp-body');

  if (!listEl) return;

  // ── Per-endpoint state ──────────────────────────────────────────────────────
  let current   = null;
  let pathVals  = {};
  let queryVals = {};

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  function renderSidebar(filter = '') {
    const q = filter.toLowerCase();
    const groups = [...new Set(endpoints.map((e) => e.group))];

    listEl.innerHTML = groups.map((g) => {
      const items = endpoints.filter((e) =>
        e.group === g &&
        (!q ||
          e.path.toLowerCase().includes(q) ||
          e.desc.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q))
      );
      if (!items.length) return '';
      return `
        <div class="ex-group">
          <div class="ex-group-label">${esc(g)}</div>
          ${items.map((ep) => {
            const idx = endpoints.indexOf(ep);
            return `
              <div class="ex-endpoint-item" data-idx="${idx}">
                <span class="ex-method-tag" style="color:${METHOD_COLORS[ep.method] ?? '#888'}">${ep.method}</span>
                <span class="ex-path-label">${esc(ep.path)}</span>
              </div>`;
          }).join('')}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.ex-endpoint-item').forEach((el) => {
      el.addEventListener('click', () => {
        listEl.querySelectorAll('.ex-endpoint-item').forEach((x) => x.classList.remove('active'));
        el.classList.add('active');
        selectEndpoint(Number(el.dataset.idx));
      });
    });
  }

  // ── Endpoint selection ───────────────────────────────────────────────────────

  function selectEndpoint(idx) {
    current   = endpoints[idx];
    pathVals  = {};
    queryVals = {};

    const ep = current;
    methodBadge.textContent = ep.method;
    methodBadge.style.color = METHOD_COLORS[ep.method] ?? '#888';
    descEl.textContent = ep.desc;
    bodyArea.value = ep.body ?? '';

    renderParamsTab();
    updateUrl();
  }

  // ── URL builder ──────────────────────────────────────────────────────────────

  function updateUrl() {
    if (!current) return;
    let path = current.path;

    (current.pathParams ?? []).forEach((p) => {
      const v = pathVals[p.name] !== undefined ? pathVals[p.name] : (p.default ?? '');
      path = path.replace(`:${p.name}`, encodeURIComponent(v || `:${p.name}`));
    });

    const qs = (current.queryParams ?? [])
      .map((p) => {
        const v = queryVals[p.name] !== undefined ? queryVals[p.name] : (p.default ?? '');
        return v ? `${encodeURIComponent(p.name)}=${encodeURIComponent(v)}` : '';
      })
      .filter(Boolean)
      .join('&');

    urlInput.value = urlPrefix + path + (qs ? '?' + qs : '');
  }

  // ── Params tab ───────────────────────────────────────────────────────────────

  function renderParamsTab() {
    const pps = current?.pathParams  ?? [];
    const qps = current?.queryParams ?? [];

    if (!pps.length && !qps.length) {
      paramsEl.innerHTML = '<p class="ex-no-params">No parameters for this endpoint.</p>';
      return;
    }

    paramsEl.innerHTML = `
      ${pps.length ? `
        <div class="ex-param-group-label">Path Parameters</div>
        ${pps.map((p) => `
          <div class="ex-param-row">
            <label class="ex-param-name">:${esc(p.name)}</label>
            <input class="ex-param-input" data-name="${esc(p.name)}" data-kind="path"
                   value="${esc(p.default ?? '')}" placeholder="${esc(p.default ?? p.name)}" />
          </div>`).join('')}
      ` : ''}
      ${qps.length ? `
        <div class="ex-param-group-label${pps.length ? ' mt' : ''}">Query Parameters</div>
        ${qps.map((p) => `
          <div class="ex-param-row">
            <label class="ex-param-name">${esc(p.name)}</label>
            <input class="ex-param-input" data-name="${esc(p.name)}" data-kind="query"
                   value="${esc(p.default ?? '')}" placeholder="${esc(p.default ?? p.name)}"
                   title="${esc(p.desc ?? '')}" />
            ${p.desc ? `<span class="ex-param-desc">${esc(p.desc)}</span>` : ''}
          </div>`).join('')}
      ` : ''}
    `;

    // Wire up inputs → update URL
    paramsEl.querySelectorAll('.ex-param-input').forEach((inp) => {
      // Initialise state
      if (inp.dataset.kind === 'path') pathVals[inp.dataset.name]  = inp.value;
      else                             queryVals[inp.dataset.name] = inp.value;

      inp.addEventListener('input', () => {
        if (inp.dataset.kind === 'path') pathVals[inp.dataset.name]  = inp.value;
        else                             queryVals[inp.dataset.name] = inp.value;
        updateUrl();
      });
    });

    updateUrl();
  }

  // ── Sub-tab switching (Params / Body) ────────────────────────────────────────

  const rootEl = listEl.closest('.explorer-root');
  rootEl.querySelectorAll('.ex-req-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      rootEl.querySelectorAll('.ex-req-tab-btn').forEach((b) => b.classList.remove('active'));
      rootEl.querySelectorAll('.ex-req-tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`)?.classList.add('active');
    });
  });

  // ── Resizable split (request / response) ─────────────────────────────────────

  const mainEl      = rootEl.querySelector('.ex-main');
  const reqSection  = rootEl.querySelector('.ex-request-section');
  const resizeHandle = rootEl.querySelector('.ex-resize-handle');

  if (resizeHandle && reqSection && mainEl) {
    // Set initial 40% height after layout is available
    requestAnimationFrame(() => {
      const h = mainEl.getBoundingClientRect().height;
      if (h > 0) reqSection.style.height = `${Math.round(h * 0.4)}px`;
    });

    let startY = 0, startH = 0;

    resizeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = reqSection.getBoundingClientRect().height;
      resizeHandle.classList.add('dragging');
      resizeHandle.setPointerCapture(e.pointerId);
    });

    resizeHandle.addEventListener('pointermove', (e) => {
      if (e.buttons !== 1) return;
      const mainH  = mainEl.getBoundingClientRect().height;
      const newH   = Math.max(60, Math.min(mainH - 80, startH + (e.clientY - startY)));
      reqSection.style.height = `${newH}px`;
    });

    resizeHandle.addEventListener('pointerup', () => {
      resizeHandle.classList.remove('dragging');
    });
  }

  // ── Send request ─────────────────────────────────────────────────────────────

  async function sendRequest() {
    if (!current) return;

    respStatus.textContent = '…';
    respStatus.className   = 'ex-status-badge';
    respTime.textContent   = '';
    respBody.textContent   = 'Sending…';    respBody.className   = 'ex-resp-body';    respBody.removeAttribute('data-highlighted');

    const method  = current.method;
    const url     = urlInput.value;
    const rawBody = bodyArea.value.trim();
    const t0      = performance.now();

    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (method !== 'GET' && rawBody) opts.body = rawBody;

      const res     = await fetch(url, opts);
      const elapsed = Math.round(performance.now() - t0);
      const text    = await res.text();

      respStatus.textContent = `${res.status} ${res.statusText}`;
      respStatus.className   = `ex-status-badge ${res.ok ? 'ok' : 'err'}`;
      respTime.textContent   = `${elapsed} ms`;

      let pretty, isJson = false;
      try   { pretty = JSON.stringify(JSON.parse(text), null, 2); isJson = true; }
      catch { pretty = text; }

      if (isJson) {
        respBody.className   = 'ex-resp-body language-json';
        respBody.textContent = pretty;
        hljs.highlightElement(respBody);
      } else {
        respBody.className   = 'ex-resp-body';
        respBody.textContent = pretty;
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - t0);
      respStatus.textContent = 'Network Error';
      respStatus.className   = 'ex-status-badge err';
      respTime.textContent   = `${elapsed} ms`;
      respBody.textContent   = err.message;
    }
  }

  sendBtn.addEventListener('click', sendRequest);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendRequest(); });

  // ── Copy response ────────────────────────────────────────────────────────────

  copyResp?.addEventListener('click', () => {
    navigator.clipboard.writeText(respBody.textContent).catch(() => {});
    const orig = copyResp.textContent;
    copyResp.textContent = '✓';
    setTimeout(() => { copyResp.textContent = orig; }, 1400);
  });

  // ── Search filter ────────────────────────────────────────────────────────────

  searchInp?.addEventListener('input', () => renderSidebar(searchInp.value));

  // ── Init ─────────────────────────────────────────────────────────────────────

  renderSidebar();
  selectEndpoint(0);
  listEl.querySelector('.ex-endpoint-item')?.classList.add('active');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
