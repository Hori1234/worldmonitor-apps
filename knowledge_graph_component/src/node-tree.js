/**
 * node-tree.js
 *
 * Node Browser tab — shows all nodes in the selected graph as a
 * collapsible tree grouped by type, with checkboxes, delete, and
 * a per-node detail panel. Also provides a "Rebuild" action that
 * wipes the graph so it can be re-imported from the scraper.
 */

import * as api from './api.js';

// ── Node type catalogue (mirrors kg-sender in the scraper) ───────────────────
const NODE_TYPE_META = {
  1: { name: 'Document',  icon: '📄' },
  2: { name: 'Entity',    icon: '🏷' },
  3: { name: 'Concept',   icon: '💡' },
  4: { name: 'Category',  icon: '🗂' },
  5: { name: 'Reference', icon: '🔗' },
};

function typeName(typeId) {
  const t = NODE_TYPE_META[typeId];
  return t ? `${t.icon} ${t.name}` : `⬡ Type ${typeId}`;
}

function typeIcon(typeId) {
  return NODE_TYPE_META[typeId]?.icon ?? '⬡';
}

// ── Module state ──────────────────────────────────────────────────────────────
let _graphName     = null;
let _allNodes      = [];
let _selectedIds   = new Set();
let _collapsedTypes = new Set();
let _filter        = '';

// ── Init ──────────────────────────────────────────────────────────────────────
export function initNodeTree() {
  document.getElementById('nt-refresh-btn')  ?.addEventListener('click', () => _graphName && loadNodeTree(_graphName));
  document.getElementById('nt-delete-btn')   ?.addEventListener('click', doDeleteSelected);
  document.getElementById('nt-rebuild-btn')  ?.addEventListener('click', doRebuild);
  document.getElementById('nt-clear-sel-btn')?.addEventListener('click', () => {
    _selectedIds.clear();
    rerenderTree();
    updateSelectionBar();
  });
  document.getElementById('nt-search')?.addEventListener('input', (e) => {
    _filter = e.target.value.toLowerCase();
    rerenderTree();
  });
  document.getElementById('nt-detail-close')?.addEventListener('click', () => {
    document.getElementById('nt-detail-panel').hidden = true;
  });
}

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadNodeTree(graphName) {
  _graphName = graphName;
  _selectedIds.clear();
  _allNodes   = [];
  _filter     = '';
  _collapsedTypes.clear();

  const search = document.getElementById('nt-search');
  if (search) search.value = '';
  document.getElementById('nt-detail-panel').hidden = true;

  setStatus('Loading nodes…');
  setNodeCount('—');

  try {
    let after;
    while (true) {
      const batch = await api.queryNodes(graphName, {
        allow_full_scan: true,
        limit: 500,
        ...(after !== undefined ? { after } : {}),
      });
      if (!batch || batch.length === 0) break;
      _allNodes.push(...batch);
      after = batch[batch.length - 1].id;
      setStatus(`Loaded ${_allNodes.length} nodes…`);
      if (batch.length < 500) break;
    }
    setStatus('');
    setNodeCount(_allNodes.length);
    rerenderTree();
    updateSelectionBar();
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
    setNodeCount(0);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(msg, isError = false) {
  const el = document.getElementById('nt-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = `nt-status${isError ? ' nt-status-err' : ''}`;
}

function setNodeCount(n) {
  const el = document.getElementById('nt-node-count');
  if (el) el.textContent = `${n} node${n !== 1 ? 's' : ''}`;
}

function getFilteredNodes() {
  if (!_filter) return _allNodes;
  return _allNodes.filter(n => {
    const lbl = nodeLabel(n).toLowerCase();
    return lbl.includes(_filter) ||
           String(n.id).includes(_filter) ||
           (n.props?.category ?? '').toLowerCase().includes(_filter);
  });
}

function nodeLabel(n) {
  const p = n.props ?? {};
  return p.title ?? p.name ?? p.label ?? n.key ?? String(n.id);
}

// ── Render ────────────────────────────────────────────────────────────────────
function rerenderTree() {
  const container = document.getElementById('nt-tree');
  if (!container) return;
  const scroll = container.scrollTop;

  const nodes = getFilteredNodes();

  if (nodes.length === 0) {
    container.innerHTML = `<div class="nt-empty">${
      _allNodes.length === 0
        ? 'No nodes in this graph yet. Import files from the Scraper Dashboard.'
        : 'No nodes match your filter.'
    }</div>`;
    container.scrollTop = scroll;
    return;
  }

  // Group by typeId
  const groups = new Map();
  for (const n of nodes) {
    const tid = Number(n.typeId);
    if (!groups.has(tid)) groups.set(tid, []);
    groups.get(tid).push(n);
  }

  const html = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tid, items]) => renderGroup(tid, items))
    .join('');

  container.innerHTML = html;
  container.scrollTop = scroll;

  // Fix indeterminate states (DOM property — can't be set in HTML)
  container.querySelectorAll('.nt-group-check').forEach(cb => {
    const tid   = Number(cb.dataset.tid);
    const items = groups.get(tid) ?? [];
    const allSel  = items.every(n => _selectedIds.has(String(n.id)));
    const noneSel = items.every(n => !_selectedIds.has(String(n.id)));
    cb.indeterminate = !allSel && !noneSel;
  });

  // Wire collapse toggle
  container.querySelectorAll('.nt-group-hdr').forEach(hdr => {
    hdr.addEventListener('click', (e) => {
      if (e.target.classList.contains('nt-check')) return;
      const tid = Number(hdr.dataset.tid);
      _collapsedTypes.has(tid) ? _collapsedTypes.delete(tid) : _collapsedTypes.add(tid);
      rerenderTree();
    });
  });

  // Wire group checkboxes
  container.querySelectorAll('.nt-group-check').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid   = Number(cb.dataset.tid);
      const items = groups.get(tid) ?? [];
      if (cb.checked) items.forEach(n => _selectedIds.add(String(n.id)));
      else            items.forEach(n => _selectedIds.delete(String(n.id)));
      rerenderTree();
      updateSelectionBar();
    });
  });

  // Wire node checkboxes
  container.querySelectorAll('.nt-node-check').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.checked ? _selectedIds.add(cb.dataset.id) : _selectedIds.delete(cb.dataset.id);
      rerenderTree();
      updateSelectionBar();
    });
  });

  // Wire node row click → detail panel
  container.querySelectorAll('.nt-node-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('nt-node-check')) return;
      const id   = row.dataset.id;
      const node = _allNodes.find(n => String(n.id) === id);
      if (node) showNodeDetail(node);
      container.querySelectorAll('.nt-node-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
    });
  });
}

function renderGroup(tid, items) {
  const collapsed = _collapsedTypes.has(tid);
  const allSel    = items.every(n => _selectedIds.has(String(n.id)));

  const itemsHtml = collapsed ? '' : `
    <div class="nt-group-items">
      ${items.map(n => renderNodeRow(n)).join('')}
    </div>
  `;

  return `
    <div class="nt-group" data-tid="${tid}">
      <div class="nt-group-hdr" data-tid="${tid}">
        <input type="checkbox" class="nt-check nt-group-check" data-tid="${tid}"
          ${allSel ? 'checked' : ''}>
        <span class="nt-toggle">${collapsed ? '▸' : '▾'}</span>
        <span class="nt-group-icon">${typeIcon(tid)}</span>
        <span class="nt-group-name">${typeName(tid)}</span>
        <span class="nt-group-count badge">${items.length}</span>
      </div>
      ${itemsHtml}
    </div>
  `;
}

function renderNodeRow(n) {
  const id       = String(n.id);
  const label    = nodeLabel(n);
  const cat      = n.props?.category ?? '';
  const selected = _selectedIds.has(id);

  return `
    <div class="nt-node-row${selected ? ' selected' : ''}" data-id="${escAttr(id)}">
      <input type="checkbox" class="nt-check nt-node-check" data-id="${escAttr(id)}"
        ${selected ? 'checked' : ''}>
      <span class="nt-node-icon">${typeIcon(Number(n.typeId))}</span>
      <span class="nt-node-label" title="${escAttr(label)}">${escHtml(label)}</span>
      ${cat ? `<span class="nt-node-cat">${escHtml(cat)}</span>` : ''}
    </div>
  `;
}

// ── Selection bar ─────────────────────────────────────────────────────────────
function updateSelectionBar() {
  const bar = document.getElementById('nt-selection-bar');
  const cnt = document.getElementById('nt-selection-count');
  if (!bar) return;
  bar.hidden = _selectedIds.size === 0;
  if (cnt) cnt.textContent = `${_selectedIds.size} node${_selectedIds.size !== 1 ? 's' : ''} selected`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function showNodeDetail(node) {
  const panel = document.getElementById('nt-detail-panel');
  const body  = document.getElementById('nt-detail-body');
  if (!panel || !body) return;
  panel.hidden = false;

  const props    = node.props ?? {};
  const propRows = Object.entries(props)
    .map(([k, v]) => {
      const display = String(v);
      const truncated = display.length > 400 ? display.slice(0, 400) + '…' : display;
      return `<tr>
        <td class="prop-key">${escHtml(k)}</td>
        <td class="prop-val">${escHtml(truncated)}</td>
      </tr>`;
    })
    .join('');

  body.innerHTML = `
    <div class="nt-detail-meta">
      <span class="meta-badge" style="background:var(--accent)">${typeName(Number(node.typeId))}</span>
      <span class="nt-detail-id mono">ID: ${escHtml(String(node.id))}</span>
    </div>
    <div class="nt-detail-title">${escHtml(nodeLabel(node))}</div>
    ${propRows
      ? `<table class="meta-table">${propRows}</table>`
      : '<p class="muted">No properties.</p>'}
    <div class="nt-detail-actions">
      <button class="btn btn-danger btn-xs nt-single-del-btn" data-id="${escAttr(String(node.id))}">
        🗑 Delete node
      </button>
    </div>
  `;

  body.querySelector('.nt-single-del-btn')?.addEventListener('click', async (e) => {
    const id    = e.currentTarget.dataset.id;
    const label = nodeLabel(node);
    if (!confirm(`Delete node "${label}"?`)) return;
    try {
      await api.deleteNode(_graphName, id);
      _allNodes   = _allNodes.filter(n => String(n.id) !== id);
      _selectedIds.delete(id);
      panel.hidden = true;
      rerenderTree();
      updateSelectionBar();
      setNodeCount(_allNodes.length);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function doDeleteSelected() {
  if (_selectedIds.size === 0) return;
  if (!confirm(`Delete ${_selectedIds.size} selected node${_selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;

  const ids = [..._selectedIds];
  setStatus(`Deleting ${ids.length} nodes…`);
  let done = 0, failed = 0;

  for (const id of ids) {
    try {
      await api.deleteNode(_graphName, id);
      _allNodes = _allNodes.filter(n => String(n.id) !== id);
      done++;
    } catch { failed++; }
  }

  _selectedIds.clear();
  rerenderTree();
  updateSelectionBar();
  setNodeCount(_allNodes.length);
  document.getElementById('nt-detail-panel').hidden = true;

  const msg = failed === 0
    ? `✓ Deleted ${done} node${done !== 1 ? 's' : ''}`
    : `Deleted ${done}, failed ${failed}`;
  setStatus(msg);
  setTimeout(() => setStatus(''), 4000);
}

async function doRebuild() {
  if (!_graphName) return;
  if (!confirm(
    `Rebuild "${_graphName}"?\n\n` +
    `This will WIPE ALL nodes and edges in this graph.\n` +
    `You can then re-import files from the Scraper Dashboard.`
  )) return;

  try {
    setStatus('Wiping graph…');
    await api.recreateGraph(_graphName);

    _allNodes = [];
    _selectedIds.clear();
    rerenderTree();
    updateSelectionBar();
    setNodeCount(0);
    setStatus('Graph wiped — re-import files from the Scraper Dashboard to rebuild.');

    // Tell parent (scraper dashboard iframe) to refresh its graph list
    window.parent?.postMessage({ type: 'kg:refresh-graphs', graph: _graphName }, '*');
  } catch (err) {
    setStatus(`Rebuild failed: ${err.message}`, true);
  }
}

// ── Escape helpers ────────────────────────────────────────────────────────────
function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
