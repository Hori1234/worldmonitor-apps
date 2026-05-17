/**
 * panels.js
 *
 * Left sidebar panels:
 *   - Graph selector (dropdown + CRUD buttons)
 *   - Node-type legend (clickable chips — toggle visibility or isolate)
 *   - Edge-type legend
 *   - Selected-node detail panel (metadata, connections, actions)
 *
 * Right-side search results dropdown
 */

import * as api from './api.js';

// ── Color helpers (must match renderer palette exactly) ───────────────────────
const NODE_PALETTE = [
  '#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#a78bfa','#fbbf24','#34d399','#f87171','#60a5fa',
  '#e879f9','#fb923c','#a3e635','#38bdf8','#4ade80',
];
const EDGE_PALETTE = [
  '#64748b','#94a3b8','#6366f1','#f59e0b','#10b981',
  '#8b5cf6','#06b6d4','#f97316','#ec4899','#ef4444',
];

let _nodeColorIdx = 0;
let _edgeColorIdx = 0;
const _nodeColorMap = new Map();
const _edgeColorMap = new Map();

function nodeColor(typeId) {
  if (!_nodeColorMap.has(typeId)) {
    _nodeColorMap.set(typeId, NODE_PALETTE[_nodeColorIdx++ % NODE_PALETTE.length]);
  }
  return _nodeColorMap.get(typeId);
}
function edgeColor(typeId) {
  if (!_edgeColorMap.has(typeId)) {
    _edgeColorMap.set(typeId, EDGE_PALETTE[_edgeColorIdx++ % EDGE_PALETTE.length]);
  }
  return _edgeColorMap.get(typeId);
}

// ── Graph selector panel ──────────────────────────────────────────────────────

export class GraphSelector {
  /**
   * @param {object} opts
   * @param {Function} opts.onSelect   (name) => void
   * @param {Function} opts.onRefresh  () => void
   */
  constructor(opts) {
    this.onSelect  = opts.onSelect  ?? (() => {});
    this.onRefresh = opts.onRefresh ?? (() => {});
    this._graphs = [];

    this._select  = document.getElementById('graph-select');
    this._newBtn  = document.getElementById('btn-new-graph');
    this._delBtn  = document.getElementById('btn-delete-graph');
    this._recrBtn = document.getElementById('btn-recreate-graph');
    this._modal   = document.getElementById('modal-graph');
    this._modalClose = document.getElementById('modal-graph-close');
    this._modalForm  = document.getElementById('modal-graph-form');

    this._select.addEventListener('change', () => this.onSelect(this._select.value));
    this._newBtn.addEventListener('click', () => this._openModal('create'));
    this._delBtn.addEventListener('click', () => this._confirmDelete());
    this._recrBtn.addEventListener('click', () => this._confirmRecreate());
    this._modalClose.addEventListener('click', () => this._closeModal());
    this._modalForm.addEventListener('submit', (e) => this._onFormSubmit(e));
  }

  async refresh() {
    try {
      this._graphs = await api.listGraphs();
      const prev = this._select.value;
      this._select.innerHTML = '<option value="">— select a graph —</option>' +
        this._graphs.map(g =>
          `<option value="${esc(g.name)}">${esc(g.name)} ${g.status === 'open' ? '●' : '○'}</option>`
        ).join('');
      if (prev && this._graphs.find(g => g.name === prev)) {
        this._select.value = prev;
      }
    } catch (e) {
      console.error('[panel] listGraphs:', e);
    }
  }

  get selected() { return this._select.value; }

  _openModal(mode) {
    document.getElementById('modal-graph-title').textContent =
      mode === 'create' ? 'Create Graph' : 'Graph Options';
    document.getElementById('modal-graph-name').value = '';
    document.getElementById('modal-graph-dim').value = '';
    this._modal.classList.add('open');
    document.getElementById('modal-graph-name').focus();
  }

  _closeModal() {
    this._modal.classList.remove('open');
  }

  async _onFormSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('modal-graph-name').value.trim();
    const dim  = parseInt(document.getElementById('modal-graph-dim').value, 10);
    if (!name) return;
    const options = dim > 0 ? { denseVector: { dimension: dim, metric: 'cosine' } } : {};
    try {
      await api.createGraph(name, options);
      this._closeModal();
      await this.refresh();
      this._select.value = name;
      this.onSelect(name);
    } catch (err) {
      alert(`Create failed: ${err.message}`);
    }
  }

  async _confirmDelete() {
    const name = this.selected;
    if (!name) return alert('Select a graph first.');
    if (!confirm(`Permanently DELETE "${name}" and all its data?`)) return;
    try {
      await api.deleteGraph(name);
      await this.refresh();
      this.onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async _confirmRecreate() {
    const name = this.selected;
    if (!name) return alert('Select a graph first.');
    if (!confirm(
      `WIPE all data in "${name}" and start empty?\n\n` +
      `If this graph was built from the file directory, it will be automatically reimported.`
    )) return;
    try {
      await api.recreateGraph(name);
      // Ask the parent scraper (if present) to rebuild the directory structure
      window.parent?.postMessage({ type: 'kg:rebuild-directory', graph: name }, '*');
      this.onSelect(name);
    } catch (err) {
      alert(`Recreate failed: ${err.message}`);
    }
  }
}

// ── Type legend panel ────────────────────────────────────────────────────────

export class TypeLegend {
  /**
   * @param {object} opts
   * @param {Function} opts.onNodeTypeToggle  (typeId, visible) => void
   * @param {Function} opts.onEdgeTypeToggle  (typeId, visible) => void
   * @param {Function} opts.onNodeTypeIsolate (typeId) => void
   * @param {Function} opts.onReset           () => void
   */
  constructor(opts) {
    this.onNodeTypeToggle  = opts.onNodeTypeToggle  ?? (() => {});
    this.onEdgeTypeToggle  = opts.onEdgeTypeToggle  ?? (() => {});
    this.onNodeTypeIsolate = opts.onNodeTypeIsolate ?? (() => {});
    this.onReset           = opts.onReset           ?? (() => {});

    this._nodeList = document.getElementById('node-type-list');
    this._edgeList = document.getElementById('edge-type-list');
    this._resetBtn = document.getElementById('btn-reset-types');
    this._resetBtn?.addEventListener('click', () => this.onReset());
  }

  /** Called by renderer after loading with discovered type IDs */
  render(nodeTypes, edgeTypes) {
    _nodeColorIdx = 0;
    _edgeColorIdx = 0;
    _nodeColorMap.clear();
    _edgeColorMap.clear();

    this._nodeList.innerHTML = nodeTypes.sort((a, b) => a - b).map(tid => `
      <li class="type-chip" data-tid="${tid}" data-kind="node" title="Click to toggle — double-click to isolate">
        <span class="type-dot" style="background:${nodeColor(tid)}"></span>
        <span class="type-label">Type ${tid}</span>
        <input type="checkbox" checked data-tid="${tid}" data-kind="node">
      </li>
    `).join('');

    this._edgeList.innerHTML = edgeTypes.sort((a, b) => a - b).map(tid => `
      <li class="type-chip" data-tid="${tid}" data-kind="edge" title="Click to toggle edge type">
        <span class="type-dot" style="background:${edgeColor(tid)}"></span>
        <span class="type-label">EdgeType ${tid}</span>
        <input type="checkbox" checked data-tid="${tid}" data-kind="edge">
      </li>
    `).join('');

    // Toggle checkbox
    this._nodeList.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        this.onNodeTypeToggle(Number(cb.dataset.tid), cb.checked);
        const chip = cb.closest('.type-chip');
        chip.classList.toggle('dimmed', !cb.checked);
      });
    });
    this._edgeList.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        this.onEdgeTypeToggle(Number(cb.dataset.tid), cb.checked);
        const chip = cb.closest('.type-chip');
        chip.classList.toggle('dimmed', !cb.checked);
      });
    });

    // Double-click to isolate
    this._nodeList.querySelectorAll('.type-chip').forEach(chip => {
      chip.addEventListener('dblclick', () => {
        const tid = Number(chip.dataset.tid);
        this.onNodeTypeIsolate(tid);
        // Visually check only this one
        this._nodeList.querySelectorAll('input[type=checkbox]').forEach(cb => {
          const same = Number(cb.dataset.tid) === tid;
          cb.checked = same;
          cb.closest('.type-chip').classList.toggle('dimmed', !same);
        });
      });
    });
  }
}

// ── Node detail panel ────────────────────────────────────────────────────────

export class NodePanel {
  /**
   * @param {object} opts
   * @param {Function} opts.onEgo     (nodeKey, depth) => void
   * @param {Function} opts.onClearEgo () => void
   * @param {Function} opts.onDelete  (nodeKey) => void
   * @param {Function} opts.onFocus   (nodeKey) => void
   */
  constructor(opts) {
    this.onEgo     = opts.onEgo     ?? (() => {});
    this.onClearEgo = opts.onClearEgo ?? (() => {});
    this.onDelete  = opts.onDelete  ?? (() => {});
    this.onFocus   = opts.onFocus   ?? (() => {});

    this._panel     = document.getElementById('node-panel');
    this._egoBtn    = document.getElementById('btn-ego');
    this._clearEgoBtn = document.getElementById('btn-clear-ego');
    this._deleteBtn = document.getElementById('btn-delete-node');

    this._nodeKey = null;
    this._egoActive = false;

    this._egoBtn?.addEventListener('click', () => {
      if (this._nodeKey) {
        const depth = parseInt(document.getElementById('ego-depth')?.value ?? '2', 10);
        this.onEgo(this._nodeKey, depth);
        this._egoActive = true;
        this._egoBtn.textContent = 'Refresh Ego';
        this._clearEgoBtn.hidden = false;
      }
    });

    this._clearEgoBtn?.addEventListener('click', () => {
      this.onClearEgo();
      this._egoActive = false;
      this._egoBtn.textContent = 'Ego Network';
      this._clearEgoBtn.hidden = true;
    });

    this._deleteBtn?.addEventListener('click', async () => {
      if (!this._nodeKey) return;
      if (!confirm(`Delete node "${this._nodeKey}"?`)) return;
      this.onDelete(this._nodeKey);
    });
  }

  /** Show metadata for a clicked node */
  show(nodeKey, attrs, neighbours) {
    this._nodeKey = nodeKey;
    this._panel.hidden = false;

    const props = attrs._props ?? {};
    const propRows = Object.entries(props).map(([k, v]) => `
      <tr><td class="prop-key">${esc(k)}</td><td class="prop-val">${esc(String(v))}</td></tr>
    `).join('');

    const nbRows = (neighbours ?? []).slice(0, 30).map(nb => `
      <li class="nb-item">
        <span class="nb-dir">→</span>
        <span class="nb-id" data-key="${esc(String(nb.nodeId))}">${esc(String(nb.nodeId))}</span>
        <span class="nb-type badge">T${nb.edgeTypeId ?? 0}</span>
        ${nb.weight !== undefined ? `<span class="nb-weight">${Number(nb.weight).toFixed(2)}</span>` : ''}
      </li>
    `).join('');

    document.getElementById('node-panel-body').innerHTML = `
      <div class="meta-header">
        <span class="meta-badge" style="background:${nodeColor(attrs._typeId)}">Type ${attrs._typeId}</span>
        <button class="btn btn-xs btn-ghost copy-btn" title="Copy ID" data-copy="${esc(nodeKey)}">⎘ Copy ID</button>
      </div>
      <table class="meta-table">
        <tr><td class="prop-key">Internal ID</td><td class="prop-val mono">${esc(nodeKey)}</td></tr>
        <tr><td class="prop-key">Key</td><td class="prop-val mono">${esc(attrs._key ?? '')}</td></tr>
        <tr><td class="prop-key">Label</td><td class="prop-val">${esc(attrs.label ?? '')}</td></tr>
        ${propRows}
      </table>
      ${neighbours?.length ? `
        <div class="nb-section">
          <h4 class="nb-title">Connections (${neighbours.length}${neighbours.length >= 200 ? '+' : ''})</h4>
          <ul class="nb-list">${nbRows}</ul>
        </div>` : '<p class="muted">No outgoing connections.</p>'}
    `;

    // Copy-ID button
    document.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText(e.currentTarget.dataset.copy);
    });

    // Click a neighbour ID to focus that node
    document.querySelectorAll('.nb-id[data-key]').forEach(el => {
      el.addEventListener('click', () => this.onFocus(el.dataset.key));
    });
  }

  hide() {
    this._panel.hidden = true;
    this._nodeKey = null;
    document.getElementById('node-panel-body').innerHTML = '';
  }

  clearEgoState() {
    this._egoActive = false;
    if (this._egoBtn) this._egoBtn.textContent = 'Ego Network';
    if (this._clearEgoBtn) this._clearEgoBtn.hidden = true;
  }
}

// ── Stats bar ────────────────────────────────────────────────────────────────

export function updateStats(total, totalEdges, visNodes, visEdges) {
  const el = (id) => document.getElementById(id);
  if (el('stat-total-nodes'))  el('stat-total-nodes').textContent  = total;
  if (el('stat-total-edges'))  el('stat-total-edges').textContent  = totalEdges;
  if (el('stat-vis-nodes'))    el('stat-vis-nodes').textContent    = visNodes;
  if (el('stat-vis-edges'))    el('stat-vis-edges').textContent    = visEdges;
}

// ── Search dropdown ──────────────────────────────────────────────────────────

export function renderSearchResults(hits, onSelect) {
  const box = document.getElementById('search-results');
  if (!hits.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = hits.slice(0, 20).map(h =>
    `<div class="search-result-item" data-key="${esc(h.node)}">
       <span class="sr-label">${esc(h.attrs.label ?? h.attrs._key ?? h.node)}</span>
       <span class="sr-type badge">Type ${h.attrs._typeId}</span>
     </div>`
  ).join('');
  box.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      onSelect(el.dataset.key);
      box.hidden = true;
    });
  });
}

// ── Utility ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
