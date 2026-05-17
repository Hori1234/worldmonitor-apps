/**
 * explorer.js
 *
 * API Explorer for the Knowledge Graph Service — a Postman-like interface
 * for testing all 28 endpoints. Rendered in the "API Explorer" tab.
 */

const ENDPOINTS = [
  // ── Health ──────────────────────────────────────────────────────────────────
  {
    group: 'Health',
    method: 'GET', path: '/health',
    desc: 'Service status and open graph count.',
    body: null,
  },

  // ── Graph Management ────────────────────────────────────────────────────────
  {
    group: 'Graphs',
    method: 'GET', path: '/graphs',
    desc: 'List all graphs on disk with status and size.',
    body: null,
  },
  {
    group: 'Graphs',
    method: 'POST', path: '/graphs',
    desc: 'Create a new graph.',
    body: JSON.stringify({ name: 'my-graph', options: { denseVector: { dimension: 384, metric: 'cosine' } } }, null, 2),
  },
  {
    group: 'Graphs',
    method: 'POST', path: '/graphs/combine',
    desc: 'Merge multiple source graphs into a new target graph.',
    body: JSON.stringify({ sources: ['graph-a', 'graph-b'], target: 'combined', options: {} }, null, 2),
  },
  {
    group: 'Graphs',
    method: 'GET', path: '/graphs/:name',
    desc: 'Get info and disk size for a graph.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: null,
  },
  {
    group: 'Graphs',
    method: 'POST', path: '/graphs/:name/open',
    desc: 'Open an existing on-disk graph (reopens closed graphs).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ options: {} }, null, 2),
  },
  {
    group: 'Graphs',
    method: 'POST', path: '/graphs/:name/close',
    desc: 'Flush and close a graph (keeps data on disk).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: '{}',
  },
  {
    group: 'Graphs',
    method: 'POST', path: '/graphs/:name/recreate',
    desc: 'Wipe all data and reopen as an empty graph.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ options: {} }, null, 2),
  },
  {
    group: 'Graphs',
    method: 'DELETE', path: '/graphs/:name',
    desc: 'Permanently delete a graph and all data.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: null,
  },

  // ── Nodes ───────────────────────────────────────────────────────────────────
  {
    group: 'Nodes',
    method: 'POST', path: '/graphs/:name/nodes',
    desc: 'Upsert a single node by (typeId, key).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ typeId: 1, key: 'user:alice', props: { name: 'Alice', role: 'admin' } }, null, 2),
  },
  {
    group: 'Nodes',
    method: 'POST', path: '/graphs/:name/nodes/batch',
    desc: 'Batch upsert multiple nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ nodes: [
      { typeId: 1, key: 'user:alice', props: { name: 'Alice' } },
      { typeId: 1, key: 'user:bob',   props: { name: 'Bob' } },
    ]}, null, 2),
  },
  {
    group: 'Nodes',
    method: 'GET', path: '/graphs/:name/nodes/:nodeId',
    desc: 'Get a node by its internal numeric ID.',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
    body: null,
  },
  {
    group: 'Nodes',
    method: 'GET', path: '/graphs/:name/nodes/key/:typeId/:key',
    desc: 'Get a node by (typeId, key).',
    pathParams: [
      { name: 'name', default: 'my-graph' },
      { name: 'typeId', default: '1' },
      { name: 'key', default: 'user:alice' },
    ],
    body: null,
  },
  {
    group: 'Nodes',
    method: 'GET', path: '/graphs/:name/nodes/find',
    desc: 'Find nodes by a single property equality.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    queryParams: [
      { name: 'typeId', default: '1' },
      { name: 'prop', default: 'role' },
      { name: 'value', default: 'admin' },
      { name: 'limit', default: '50' },
    ],
    body: null,
  },
  {
    group: 'Nodes',
    method: 'POST', path: '/graphs/:name/nodes/query',
    desc: 'Full boolean node query with type, key, and property filters.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({
      typeIds: [1], limit: 50,
      props: { eq: { role: 'admin' } },
    }, null, 2),
  },
  {
    group: 'Nodes',
    method: 'DELETE', path: '/graphs/:name/nodes/:nodeId',
    desc: 'Delete a node (cascades to incident edges).',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
    body: null,
  },

  // ── Edges ───────────────────────────────────────────────────────────────────
  {
    group: 'Edges',
    method: 'POST', path: '/graphs/:name/edges',
    desc: 'Upsert a directed edge between two nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '2', typeId: 10, weight: 1.0 }, null, 2),
  },
  {
    group: 'Edges',
    method: 'POST', path: '/graphs/:name/edges/batch',
    desc: 'Batch upsert multiple edges.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ edges: [
      { fromId: '1', toId: '2', typeId: 10, weight: 1.0 },
      { fromId: '2', toId: '3', typeId: 11, weight: 0.5 },
    ]}, null, 2),
  },
  {
    group: 'Edges',
    method: 'DELETE', path: '/graphs/:name/edges',
    desc: 'Delete a specific edge.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '2', typeId: 10 }, null, 2),
  },

  // ── Graph Queries ────────────────────────────────────────────────────────────
  {
    group: 'Queries',
    method: 'GET', path: '/graphs/:name/neighbors/:nodeId',
    desc: 'Get 1-hop neighbours of a node.',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
    queryParams: [
      { name: 'direction', default: 'outgoing' },
      { name: 'limit', default: '50' },
    ],
    body: null,
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/traverse',
    desc: 'BFS traversal up to maxDepth hops.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ startNodeId: '1', maxDepth: 3, limit: 200 }, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/shortest-path',
    desc: 'Shortest path between two nodes (BFS or Dijkstra).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '10', weighted: false }, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/pagerank',
    desc: 'Personalized PageRank from seed nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ seedIds: ['1'], topK: 20, dampingFactor: 0.85, fast: true }, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/subgraph',
    desc: 'Extract a local subgraph up to N hops from a start node.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ startNodeId: '1', maxDepth: 2 }, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/degrees',
    desc: 'Count edges and sum weights for a set of nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ nodeIds: ['1', '2'], direction: 'both' }, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/components',
    desc: 'Connected-component analysis (global WCC or single-node component).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({}, null, 2),
  },
  {
    group: 'Queries',
    method: 'POST', path: '/graphs/:name/search',
    desc: 'Dense / sparse / hybrid vector search (requires denseVector config).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ mode: 'dense', k: 10, denseQuery: [] }, null, 2),
  },

  // ── Atomic Patch ─────────────────────────────────────────────────────────────
  {
    group: 'Patch',
    method: 'POST', path: '/graphs/:name/patch',
    desc: 'Atomically apply a set of node/edge mutations.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({
      upsertNodes: [{ typeId: 1, key: 'user:new', props: { name: 'New User' } }],
      upsertEdges: [{ fromId: '1', toId: '2', typeId: 10 }],
      deleteNodes: [],
      deleteEdges: [],
    }, null, 2),
  },
];

// ── Method badge colours ───────────────────────────────────────────────────────
const METHOD_CLASS = { GET: 'get', POST: 'post', DELETE: 'delete', PUT: 'put', PATCH: 'patch' };

// ── initExplorer ──────────────────────────────────────────────────────────────

export function initExplorer() {
  const sidebar   = document.getElementById('ex-sidebar');
  const urlBar    = document.getElementById('ex-url');
  const methodBadge = document.getElementById('ex-method-badge');
  const descEl    = document.getElementById('ex-desc');
  const paramsTab = document.getElementById('ex-params-tab');
  const bodyArea  = document.getElementById('ex-body');
  const sendBtn   = document.getElementById('ex-send');
  const respStatus = document.getElementById('ex-resp-status');
  const respTime  = document.getElementById('ex-resp-time');
  const respBody  = document.getElementById('ex-resp-body');
  const searchInp = document.getElementById('ex-search');

  if (!sidebar) return;

  let currentEndpoint = null;
  let pathParamValues = {};
  let queryParamValues = {};

  // ── Build sidebar ──────────────────────────────────────────────────────────

  function renderSidebar(filter = '') {
    const q = filter.toLowerCase();
    const groups = [...new Set(ENDPOINTS.map(e => e.group))];
    sidebar.innerHTML = groups.map(g => {
      const items = ENDPOINTS.filter(e =>
        e.group === g && (
          !q || e.path.toLowerCase().includes(q) ||
          e.desc.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q)
        )
      );
      if (!items.length) return '';
      return `
        <div class="ex-group">
          <div class="ex-group-label">${g}</div>
          ${items.map((ep, i) => {
            const idx = ENDPOINTS.indexOf(ep);
            return `
              <div class="ex-endpoint-item" data-idx="${idx}">
                <span class="ex-method-badge ${METHOD_CLASS[ep.method] ?? ''}">${ep.method}</span>
                <span class="ex-path-label">${ep.path}</span>
              </div>`;
          }).join('')}
        </div>`;
    }).join('');

    sidebar.querySelectorAll('.ex-endpoint-item').forEach(el => {
      el.addEventListener('click', () => {
        sidebar.querySelectorAll('.ex-endpoint-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        selectEndpoint(Number(el.dataset.idx));
      });
    });
  }

  function selectEndpoint(idx) {
    currentEndpoint = ENDPOINTS[idx];
    const ep = currentEndpoint;
    pathParamValues = {};
    queryParamValues = {};

    methodBadge.textContent = ep.method;
    methodBadge.className = `ex-method-badge lg ${METHOD_CLASS[ep.method] ?? ''}`;
    descEl.textContent = ep.desc;

    // Resolve URL
    updateUrl();

    // Body
    bodyArea.value = ep.body ?? '';

    // Params tab
    renderParamsTab();
  }

  function updateUrl() {
    if (!currentEndpoint) return;
    let path = currentEndpoint.path;
    for (const [k, v] of Object.entries(pathParamValues)) {
      path = path.replace(`:${k}`, encodeURIComponent(v || `:${k}`));
    }
    // Fill defaults for unset path params
    (currentEndpoint.pathParams ?? []).forEach(p => {
      if (!pathParamValues[p.name]) {
        path = path.replace(`:${p.name}`, encodeURIComponent(p.default));
      }
    });
    // Build query string
    const qps = currentEndpoint.queryParams ?? [];
    const qs = qps.map(p => {
      const v = queryParamValues[p.name] ?? p.default;
      return `${encodeURIComponent(p.name)}=${encodeURIComponent(v)}`;
    }).join('&');
    urlBar.value = '/api/kg' + path + (qs ? '?' + qs : '');
  }

  function renderParamsTab() {
    const ep = currentEndpoint;
    const pathPs = ep.pathParams ?? [];
    const queryPs = ep.queryParams ?? [];
    const noParams = pathPs.length === 0 && queryPs.length === 0;

    paramsTab.innerHTML = noParams ? '<p class="ex-no-params">No parameters for this endpoint.</p>' : `
      ${pathPs.length ? `
        <div class="ex-param-group">
          <div class="ex-param-group-label">Path Parameters</div>
          ${pathPs.map(p => `
            <div class="ex-param-row">
              <label class="ex-param-name">${p.name}</label>
              <input class="ex-param-input" data-param="${p.name}" data-kind="path"
                     value="${esc(p.default)}" placeholder="${esc(p.default)}">
            </div>`).join('')}
        </div>` : ''}
      ${queryPs.length ? `
        <div class="ex-param-group">
          <div class="ex-param-group-label">Query Parameters</div>
          ${queryPs.map(p => `
            <div class="ex-param-row">
              <label class="ex-param-name">${p.name}</label>
              <input class="ex-param-input" data-param="${p.name}" data-kind="query"
                     value="${esc(p.default)}" placeholder="${esc(p.default)}">
            </div>`).join('')}
        </div>` : ''}
    `;

    paramsTab.querySelectorAll('.ex-param-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const { param, kind } = inp.dataset;
        if (kind === 'path') pathParamValues[param] = inp.value;
        else queryParamValues[param] = inp.value;
        updateUrl();
      });
      // Initialise default values
      const { param, kind } = inp.dataset;
      if (kind === 'path')  pathParamValues[param]  = inp.value;
      else                  queryParamValues[param] = inp.value;
    });
    updateUrl();
  }

  // ── Send request ──────────────────────────────────────────────────────────

  sendBtn?.addEventListener('click', () => sendRequest());
  urlBar?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendRequest(); });

  async function sendRequest() {
    if (!currentEndpoint) return;
    respStatus.textContent = '…';
    respStatus.className = 'ex-status-badge';
    respTime.textContent = '';
    respBody.textContent = 'Sending…';

    const method = currentEndpoint.method;
    const url    = urlBar.value;

    const t0 = performance.now();
    try {
      const rawBody = bodyArea?.value ?? '';
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (method !== 'GET' && method !== 'DELETE' && rawBody.trim()) {
        opts.body = rawBody;
      } else if (method === 'DELETE' && rawBody.trim()) {
        opts.body = rawBody;
      }
      const res = await fetch(url, opts);
      const elapsed = Math.round(performance.now() - t0);
      const text = await res.text();

      respStatus.textContent = res.status + ' ' + res.statusText;
      respStatus.className = `ex-status-badge ${res.ok ? 'ok' : 'err'}`;
      respTime.textContent = `${elapsed} ms`;

      let pretty;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        pretty = text;
      }
      respBody.textContent = pretty;

      // Syntax highlight if hljs available
      if (typeof hljs !== 'undefined') hljs.highlightElement(respBody);

    } catch (err) {
      const elapsed = Math.round(performance.now() - t0);
      respStatus.textContent = 'Network Error';
      respStatus.className = 'ex-status-badge err';
      respTime.textContent = `${elapsed} ms`;
      respBody.textContent = err.message;
    }
  }

  // ── Tab switching (Params / Body) ─────────────────────────────────────────

  document.querySelectorAll('.ex-req-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ex-req-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ex-req-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(`ex-tab-${btn.dataset.tab}`);
      if (pane) pane.classList.add('active');
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  searchInp?.addEventListener('input', () => renderSidebar(searchInp.value));

  // ── Init ──────────────────────────────────────────────────────────────────

  renderSidebar();
  // Select first endpoint by default
  selectEndpoint(0);
  sidebar.querySelector('.ex-endpoint-item')?.classList.add('active');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
