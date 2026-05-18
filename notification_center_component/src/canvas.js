/**
 * canvas.js — Infinite canvas with pan/zoom, node drag, SVG edges.
 *
 * Public API:
 *   initCanvas(options)         options: { onNodeOpen, onDelete, onEdgeCreate }
 *   addNode(kind, x, y)         → node
 *   updateNodeData(id, data)
 *   updateEdgeMeta(id, meta)
 *   removeNode(id)
 *   loadCanvasState(state)
 *   getCanvasState()            → { nodes[], edges[], viewport }
 *   clearCanvas()
 *   triggerTestNodes()          fire all Test-Mode nodes + propagate through edges
 */

import { toast } from './toast.js';

const KIND_ICONS  = { market: '📈', news: '📰', polymarket: '🎯', map: '🗺', general: '⚙', edgeRule: '⚡' };
const KIND_LABELS = { market: 'Market', news: 'News', polymarket: 'PolyMarket', map: 'Map', general: 'General', edgeRule: 'Edge Rule' };
const KIND_COLORS = {
  market:     '#44ff88',
  news:       '#4499ff',
  polymarket: '#ff9944',
  map:        '#44ddff',
  general:    '#aa77ff',
  edgeRule:   '#ffcc33',
};
const OUTPUT_PORT_COLOR = '#ff4444';

// ── State ─────────────────────────────────────────────────────────────────────

let nodes         = [];   // { id, kind, x, y, w, h, data }
let edges         = [];   // { id, fromNodeId, fromPortIdx, toNodeId, toPortIdx, meta }
let viewport      = { x: 0, y: 0, zoom: 1 };

// Live test state — cleared on every new test run, never persisted
// nodeId → { payload: {}, edgeStates: [{edgeId, toNodeId, toNodeLabel, pass, conditions}], firedEdges: Set }
const _testLiveData    = new Map();
const _testDisplayTimers = new Map(); // per-node debounce timers for live display

// Persistent payload cache — accumulated incoming payloads survive page reloads
// nodeId → { payload: {}, updatedAt: ISO string }
const _payloadCache = new Map();
let _payloadCacheSaveTimer = null;
const _PAYLOAD_CACHE_KEY = 'nc:canvas:payload-cache';
let _onNodeOpen   = null; // callback(node)
let _onEdgeCreate = null; // callback(edge) after a connection is made
let _onEdgeEdit   = null; // callback(edgeId) to re-open edge config modal
let _containerEl  = null; // cached container element

// pending edge drag
let _pendingEdge = null; // { fromNodeId, fromPortIdx, el (SVG path), x0, y0 }
// active edge info node
let _activeEdgeInfo = null; // { edgeId, nodeEl, lineEl, _cleanup }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCanvas({ onNodeOpen, onDelete, onEdgeCreate, onEdgeEdit } = {}) {
  _onNodeOpen   = onNodeOpen;
  _onEdgeCreate = onEdgeCreate;
  _onEdgeEdit   = onEdgeEdit;

  const container = document.getElementById('canvas-container');
  const world     = document.getElementById('canvas-world');
  if (!container || !world) return;
  _containerEl = container;

  // Pan — left-click on canvas background (not on nodes)
  let panning  = false;
  let panStart = { x: 0, y: 0 };

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.canvas-node')) return; // let node drag handle it
    if (_pendingEdge) { _cancelPendingEdge(); return; }
    if (!_activeEdgeInfo?.pinned) _closeEdgeInfoNode(); // auto-save on canvas background click (skip when pinned)
    panning  = true;
    panStart = { x: e.clientX - viewport.x, y: e.clientY - viewport.y };
    container.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    viewport.x = e.clientX - panStart.x;
    viewport.y = e.clientY - panStart.y;
    _applyTransform();
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && panning) {
      panning = false;
      container.style.cursor = '';
    }
    // Cancel pending edge if mouse released outside an input port
    if (e.button === 0 && _pendingEdge && !e.target.closest('.port.in')) {
      _cancelPendingEdge();
    }
  });

  // Zoom — wheel
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    const rect   = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    viewport.x    = mx - (mx - viewport.x) * factor;
    viewport.y    = my - (my - viewport.y) * factor;
    viewport.zoom = Math.min(3, Math.max(0.15, viewport.zoom * factor));
    _applyTransform();
  }, { passive: false });

  // Drop from palette
  container.addEventListener('dragover', (e) => e.preventDefault());
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('nc-kind');
    if (!kind) return;
    const rect = container.getBoundingClientRect();
    const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const wy = (e.clientY - rect.top  - viewport.y) / viewport.zoom;
    addNode(kind, wx, wy);
  });

  // Cancel pending edge on Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _cancelPendingEdge();
  });

  _applyTransform();
}

// ── Node management ───────────────────────────────────────────────────────────

export function addNode(kind, x = 100, y = 100) {
  const node = { id: crypto.randomUUID(), kind, x, y, w: 180, h: 100, data: { inputs: 1, outputs: 1 } };
  nodes.push(node);
  _renderNode(node);
  _notifyChange();
  return node;
}

export function updateNodeData(id, data) {
  const node = nodes.find((n) => n.id === id);
  if (!node) return;
  const needPortUpdate = data.inputs !== undefined || data.outputs !== undefined;
  Object.assign(node.data, data);
  const el = document.querySelector(`.canvas-node[data-id="${id}"]`);
  if (el) {
    const titleEl = el.querySelector('.node-title');
    if (titleEl) titleEl.textContent = _esc(_nodeLabel(node));
    const bodyEl  = el.querySelector('.node-body');
    if (bodyEl)  bodyEl.innerHTML = _nodeBodyHtml(node);
    const footerEl = el.querySelector('.node-footer');
    if (footerEl) { footerEl.innerHTML = _nodeFooterHtml(node); _wireFooter(el); }
    // Sync height based on test mode
    if (node.kind !== 'edgeRule') {
      el.style.height = node.data._testMode ? '' : `${node.h}px`;
    }
    if (needPortUpdate) { _renderPorts(el, node); _renderAllEdges(); }
  }
  _notifyChange();
}

export function updateEdgeMeta(id, meta) {
  const edge = edges.find((e) => e.id === id);
  if (!edge) return;
  edge.meta = { ...edge.meta, ...meta };
  _renderAllEdges();
  _notifyChange();
}

export function removeNode(id) {
  nodes = nodes.filter((n) => n.id !== id);
  edges = edges.filter((e) => e.fromNodeId !== id && e.toNodeId !== id);
  document.querySelector(`.canvas-node[data-id="${id}"]`)?.remove();
  _payloadCache.delete(id);
  _savePayloadCache();
  _renderAllEdges();
  _notifyChange();
}

export function loadCanvasState(state) {
  clearCanvas();
  _loadPayloadCache(); // restore accumulated payload state from previous session
  viewport = state.viewport ?? { x: 0, y: 0, zoom: 1 };
  (state.nodes ?? []).forEach((n) => {
    n.w = n.w ?? 180; n.h = n.h ?? 100;
    n.data = n.data ?? {};
    n.data.inputs  = n.data.inputs  ?? 1;
    n.data.outputs = n.data.outputs ?? 1;
    nodes.push(n); _renderNode(n);
  });
  (state.edges ?? []).forEach((e) => { edges.push(e); });
  _renderAllEdges();
  _applyTransform();
  // Show cached payload overlays on nodes that have accumulated data from prior runs
  nodes.forEach((n) => _updateNodeLiveDisplay(n.id));
}

export function getCanvasState() {
  return {
    nodes:    nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges:    edges.map((e) => ({ ...e, meta: { ...(e.meta ?? {}) } })),
    viewport: { ...viewport },
  };
}

export function clearCanvas() {
  nodes = []; edges = [];
  const world = document.getElementById('canvas-world');
  if (!world) return;
  world.querySelectorAll('.canvas-node').forEach((el) => el.remove());
  _clearEdgesSVG();
}

// ── Chained payload ───────────────────────────────────────────────────────────

const _KIND_FIELDS = {
  market:     ['ticker', 'exchange', 'price', 'priceChangePct', 'title'],
  news:       ['category', 'title', 'source', 'url'],
  polymarket: ['marketId', 'question', 'yesProbability', 'noProbability'],
  map:        ['eventCategory', 'latitude', 'longitude', 'title', 'region'],
  general:    ['priority', 'title', 'source'],
  edgeRule:   [],
};

function _nodeLabel(node) {
  const d = node?.data ?? {};
  return d.title || d.ticker || d.ruleName || KIND_LABELS[node?.kind] || node?.kind || 'Node';
}

/**
 * Returns all payload fields available at the OUTPUT of a node, including
 * the node's own fields AND any fields forwarded from upstream via incoming edges.
 *
 * Each item: { field, targetField, sourceNodeId, sourceNodeKind, sourceNodeLabel, chain }
 *   chain — array of node-labels from the origin node through to this one,
 *           e.g. ['AAPL Market', 'CNN News'] for a field that passed through Market→News.
 *
 * @param {string}   nodeId
 * @param {object[]} allNodes  — full nodes array (e.g. from getCanvasState().nodes)
 * @param {object[]} allEdges  — full edges array
 * @param {Set}      _visited  — internal cycle guard (do not pass externally)
 */
export function getAggregatedPayload(nodeId, allNodes, allEdges, _visited = new Set()) {
  if (_visited.has(nodeId)) return [];
  const visited = new Set([..._visited, nodeId]);

  const node = allNodes.find((n) => n.id === nodeId);
  if (!node) return [];

  const nodeLabel = _nodeLabel(node);
  const result    = [];
  const seen      = new Set();

  // 1. Own type fields — always exposed regardless of incoming edges ──────────
  const base  = _KIND_FIELDS[node.kind] ?? [];
  const data  = node.data ?? {};
  // Only include extra keys with a real (non-empty, non-nullish) value.
  // _readForm() saves all form fields for every kind, so node.data accumulates
  // empty strings / undefined for fields belonging to other node kinds — exclude them.
  const extra = Object.keys(data).filter(
    (k) => !k.startsWith('_') && k !== 'inputs' && k !== 'outputs' && !base.includes(k)
         && data[k] !== undefined && data[k] !== null && data[k] !== ''
  );
  for (const field of [...base, ...extra]) {
    const key = `${nodeId}:${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ field, targetField: field, sourceNodeId: nodeId, sourceNodeKind: node.kind, sourceNodeLabel: nodeLabel, chain: [nodeLabel] });
    }
  }

  // 2. triggerName + selected fields forwarded from configured incoming edges ─
  const inEdges = allEdges.filter((e) => e.toNodeId === nodeId);
  for (const edge of inEdges) {
    const fromNode  = allNodes.find((n) => n.id === edge.fromNodeId);
    const fromLabel = _nodeLabel(fromNode);

    // triggerName — forwarded as a synthetic 'triggerName' field
    if (edge.meta?.triggerName) {
      const key = `${edge.fromNodeId}:triggerName`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          field:           'triggerName',
          targetField:     'triggerName',
          sourceNodeId:    edge.fromNodeId,
          sourceNodeKind:  fromNode?.kind ?? 'general',
          sourceNodeLabel: fromLabel,
          chain:           [fromLabel, nodeLabel],
        });
      }
    }

    // Only the explicitly enabled payload fields
    const enabled = (edge.meta?.triggerPayload ?? []).filter((p) => p.enabled);
    if (!enabled.length) continue;
    const upstream = getAggregatedPayload(edge.fromNodeId, allNodes, allEdges, visited);
    for (const p of enabled) {
      const origin   = upstream.find((u) => u.field === p.field || u.targetField === p.field || u.field === p.targetField);
      const srcId    = origin?.sourceNodeId    ?? edge.fromNodeId;
      const srcKind  = origin?.sourceNodeKind  ?? (fromNode?.kind ?? 'general');
      const srcLabel = origin?.sourceNodeLabel ?? fromLabel;
      const upChain  = origin?.chain           ?? [fromLabel];
      const fieldName = p.targetField ?? p.field;
      const key = `${srcId}:${fieldName}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ field: fieldName, targetField: fieldName, sourceNodeId: srcId, sourceNodeKind: srcKind, sourceNodeLabel: srcLabel, chain: [...upChain, nodeLabel] });
      }
    }
  }

  return result;
}

// ── Render node ───────────────────────────────────────────────────────────────

function _renderNode(node) {
  const world = document.getElementById('canvas-world');
  if (!world) return;

  const kindColor = KIND_COLORS[node.kind] ?? '#888';

  const el = document.createElement('div');
  el.className = `canvas-node kind-${node.kind}`;
  el.dataset.id = node.id;
  el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.w}px;min-height:${node.h}px;--kind-color:${kindColor};`;
  // Lock to explicit height unless in test mode (test mode lets content flow freely)
  if (!(node.kind !== 'edgeRule' && node.data._testMode)) {
    el.style.height = `${node.h}px`;
  }

  el.innerHTML = `
    <div class="node-header">
      <span class="node-kind-icon">${KIND_ICONS[node.kind] ?? '\ud83d\udd14'}</span>
      <span class="node-title">${_esc(_nodeLabel(node))}</span>
      ${node.kind === 'edgeRule' ? '<button class="node-jump-rule-btn" title="Open in Edge Rules">↗</button>' : ''}
      <button class="node-test-btn" title="Test trigger">▶</button>
      <button class="node-menu-btn" title="Configure">⚙</button>
    </div>
    <div class="node-body">${_nodeBodyHtml(node)}</div>
    <div class="node-live-overlay hidden"></div>
    ${node.kind !== 'edgeRule' ? `<div class="node-footer">${_nodeFooterHtml(node)}</div>` : ''}
    <div class="node-resize-handle" title="Resize"></div>
  `;

  // Test button
  el.querySelector('.node-test-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _triggerTestSingle(node.id);
  });

  // Config button → open modal
  el.querySelector('.node-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const n = nodes.find((n) => n.id === node.id);
    if (n) _onNodeOpen?.(n);
  });

  // Jump to edge rule tab (edgeRule nodes only)
  el.querySelector('.node-jump-rule-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('nc:canvas:navigateToRule', {
      detail: { ruleId: node.data._ruleId },
    }));
  });

  _makeDraggable(el, node);
  _makeResizable(el, node);
  _renderPorts(el, node);
  _wireFooter(el);

  world.appendChild(el);
}

// ── Ports ─────────────────────────────────────────────────────────────────────

function _renderPorts(el, node) {
  el.querySelectorAll('.port').forEach((p) => p.remove());

  const kindColor = KIND_COLORS[node.kind] ?? '#888';
  const inputs  = Math.max(0, Math.min(8, node.data.inputs  ?? 1));
  const outputs = Math.max(0, Math.min(8, node.data.outputs ?? 1));

  for (let i = 0; i < inputs; i++) {
    const port = document.createElement('div');
    port.className = 'port in';
    port.dataset.portIdx = i;
    port.dataset.node = node.id;
    port.style.top = `${((i + 1) / (inputs + 1)) * 100}%`;
    port.style.borderColor = kindColor;
    port.title = `In ${i}`;
    // finish edge on mouseup so drag-to-connect works
    port.addEventListener('mouseup', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (_pendingEdge) _finishEdge(node.id, i);
    });
    el.appendChild(port);
  }

  for (let i = 0; i < outputs; i++) {
    const port = document.createElement('div');
    port.className = 'port out';
    port.dataset.portIdx = i;
    port.dataset.node = node.id;
    port.style.top = `${((i + 1) / (outputs + 1)) * 100}%`;
    port.style.borderColor = OUTPUT_PORT_COLOR;
    port.title = `Out ${i}`;
    port.addEventListener('mousedown', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!_pendingEdge) _startEdge(node.id, i);
    });
    el.appendChild(port);
  }
}

/** Port centre in world coordinates for bezier path computation. */
function _portWorldPos(nodeId, direction, portIdx) {
  const node  = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  // Use actual DOM height so ports track the node even when test mode expands it
  const domEl = document.querySelector(`.canvas-node[data-id="${nodeId}"]`);
  const h     = domEl ? domEl.offsetHeight : (node.h ?? 100);
  const count = direction === 'in' ? (node.data.inputs ?? 1) : (node.data.outputs ?? 1);
  const x = direction === 'in' ? node.x : node.x + (node.w ?? 180);
  const y = node.y + ((portIdx + 1) / (count + 1)) * h;
  return { x, y };
}

// ── Node drag ─────────────────────────────────────────────────────────────────

function _makeDraggable(el, node) {
  let dragging = false;
  let ox = 0, oy = 0;

  el.querySelector('.node-header').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = _containerEl.getBoundingClientRect();
    ox = (e.clientX - rect.left - viewport.x) / viewport.zoom - node.x;
    oy = (e.clientY - rect.top  - viewport.y) / viewport.zoom - node.y;
    dragging = true;
    el.classList.add('selected');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = _containerEl.getBoundingClientRect();
    node.x = (e.clientX - rect.left - viewport.x) / viewport.zoom - ox;
    node.y = (e.clientY - rect.top  - viewport.y) / viewport.zoom - oy;
    el.style.left = `${node.x}px`;
    el.style.top  = `${node.y}px`;
    _renderAllEdges();
  });

  window.addEventListener('mouseup', (e) => {
    if (dragging && e.button === 0) { dragging = false; el.classList.remove('selected'); _notifyChange(); }
  });
}

// ── Node resize ───────────────────────────────────────────────────────────────

function _makeResizable(el, node) {
  const handle = el.querySelector('.node-resize-handle');
  if (!handle) return;

  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startW = node.w;
    // Use actual DOM height so resize works correctly whether or not test mode is active
    const startH = el.offsetHeight;

    const onMove = (e) => {
      node.w = Math.max(150, startW + (e.clientX - startX) / viewport.zoom);
      node.h = Math.max(80,  startH + (e.clientY - startY) / viewport.zoom);
      el.style.width  = `${node.w}px`;
      el.style.height = `${node.h}px`;
      _renderPorts(el, node);
      _renderAllEdges();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      _notifyChange();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ── Edge management ───────────────────────────────────────────────────────────

function _startEdge(nodeId, portIdx) {
  const svg = document.getElementById('canvas-svg');
  if (!svg) return;

  const from = _portWorldPos(nodeId, 'out', portIdx);
  if (!from) return;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke', 'var(--accent)');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-dasharray', '6 3');
  path.setAttribute('fill', 'none');
  svg.appendChild(path);

  _pendingEdge = { fromNodeId: nodeId, fromPortIdx: portIdx, el: path, x0: from.x, y0: from.y };

  const moveHandler = (e) => {
    if (!_pendingEdge) return;
    const rect = _containerEl.getBoundingClientRect();
    const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const wy = (e.clientY - rect.top  - viewport.y) / viewport.zoom;
    const dx = (wx - _pendingEdge.x0) * 0.5;
    path.setAttribute('d', `M${_pendingEdge.x0},${_pendingEdge.y0} C${_pendingEdge.x0 + dx},${_pendingEdge.y0} ${wx - dx},${wy} ${wx},${wy}`);
  };
  window.addEventListener('mousemove', moveHandler);
  _pendingEdge._moveHandler = moveHandler;
}

function _finishEdge(toNodeId, toPortIdx) {
  if (!_pendingEdge) return;
  if (toNodeId === _pendingEdge.fromNodeId) { _cancelPendingEdge(); return; }

  window.removeEventListener('mousemove', _pendingEdge._moveHandler);
  _pendingEdge.el.remove();

  const edge = {
    id:          crypto.randomUUID(),
    fromNodeId:  _pendingEdge.fromNodeId,
    fromPortIdx: _pendingEdge.fromPortIdx,
    toNodeId,
    toPortIdx,
    meta: {},
  };
  edges.push(edge);
  _pendingEdge = null;
  _renderAllEdges();
  _notifyChange();
  _onEdgeCreate?.(edge); // open edge config popup
}

function _cancelPendingEdge() {
  if (!_pendingEdge) return;
  window.removeEventListener('mousemove', _pendingEdge._moveHandler);
  _pendingEdge.el.remove();
  _pendingEdge = null;
}

function _clearEdgesSVG() {
  const svg = document.getElementById('canvas-svg');
  if (!svg) return;
  svg.querySelectorAll('.canvas-edge, .canvas-edge-hit, .canvas-edge-label, .canvas-edge-badge').forEach((el) => el.remove());
}

function _renderAllEdges() {
  _clearEdgesSVG();
  const svg = document.getElementById('canvas-svg');
  if (!svg) return;

  for (const edge of edges) {
    const from = _portWorldPos(edge.fromNodeId, 'out', edge.fromPortIdx ?? 0);
    const to   = _portWorldPos(edge.toNodeId,   'in',  edge.toPortIdx   ?? 0);
    if (!from || !to) continue;

    const dx   = Math.abs(to.x - from.x) * 0.5;
    const dStr = `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`;

    // Invisible wide hit-area path so edges are easy to click
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('class', 'canvas-edge-hit');
    hitPath.setAttribute('d', dStr);
    hitPath.dataset.edgeId = edge.id;
    hitPath.addEventListener('click', (e) => { e.stopPropagation(); _openEdgeInfoNode(edge); });
    svg.appendChild(hitPath);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'canvas-edge');
    path.setAttribute('d', dStr);
    path.dataset.edgeId = edge.id;

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      _openEdgeInfoNode(edge);
    });
    svg.appendChild(path);

    // Edge badge: trigger name · payload field count · or plain label
    const badgeParts = [];
    if (edge.meta?.triggerName)  badgeParts.push(edge.meta.triggerName);
    else if (edge.meta?.label)   badgeParts.push(edge.meta.label);
    const pCount = (edge.meta?.triggerPayload ?? []).filter((p) => p.enabled).length;
    if (pCount > 0) badgeParts.push(`${pCount} field${pCount !== 1 ? 's' : ''}`);

    if (badgeParts.length) {
      const mx       = (from.x + to.x) / 2;
      const my       = (from.y + to.y) / 2;
      const badgeStr = badgeParts.join(' · ');
      const w        = Math.max(70, badgeStr.length * 6.5 + 24);
      const h        = 18;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'canvas-edge-badge');

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x',      String(mx - w / 2));
      rect.setAttribute('y',      String(my - h / 2));
      rect.setAttribute('width',  String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx',     '4');
      g.appendChild(rect);

      const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textEl.setAttribute('x',           String(mx));
      textEl.setAttribute('y',           String(my + 5));
      textEl.setAttribute('text-anchor', 'middle');
      textEl.textContent = badgeStr;
      g.appendChild(textEl);
      svg.appendChild(g);
    }
  }
  _updateEdgeInfoConnector();
}

// ── Edge info node ────────────────────────────────────────────────────────────

function _openEdgeInfoNode(edge) {
  _closeEdgeInfoNode();

  const from = _portWorldPos(edge.fromNodeId, 'out', edge.fromPortIdx ?? 0);
  const to   = _portWorldPos(edge.toNodeId,   'in',  edge.toPortIdx   ?? 0);
  if (!from || !to) return;

  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

  const world = document.getElementById('canvas-world');
  const svg   = document.getElementById('canvas-svg');
  if (!world || !svg) return;

  const meta  = edge.meta ?? {};
  const label  = meta.label || meta.triggerName || 'Edge';

  // Regular KV rows — skip triggerPayload (shown as JSON below)
  const SKIP = new Set(['triggerPayload']);
  const metaKeys = Object.keys(meta).filter(
    (k) => !SKIP.has(k) && meta[k] !== undefined && meta[k] !== '' && !Array.isArray(meta[k])
  );
  let bodyHtml = metaKeys.map((k) =>
    `<span class="body-kv"><span class="body-key">${_esc(k)}</span><span class="body-val">${_esc(String(meta[k]))}</span></span>`
  ).join('');

  // Trigger payload JSON preview
  const payload = meta.triggerPayload ?? [];
  if (meta.triggerName || payload.length) {
    const payloadObj = {};
    payload.forEach((p) => { payloadObj[p.targetField || p.field] = `<${p.field}>`; });
    const jsonStr = JSON.stringify(
      { triggerName: meta.triggerName || undefined, payload: payloadObj },
      null, 2
    );
    bodyHtml += `<pre class="body-json">${_esc(jsonStr)}</pre>`;
  }

  if (!bodyHtml) bodyHtml = '<span class="body-hint">Click ✏ to configure</span>';

  const nodeX = mid.x + 50;
  const nodeY = mid.y - 140;

  const nodeEl = document.createElement('div');
  nodeEl.className = 'canvas-node edge-info-node';
  nodeEl.dataset.edgeId = edge.id;
  nodeEl.style.cssText  = `left:${nodeX}px;top:${nodeY}px;width:220px;z-index:100;`;

  nodeEl.innerHTML = `
    <div class="node-header">
      <span class="node-kind-icon">🔗</span>
      <span class="node-title">${_esc(label)}</span>
      <button class="edge-info-pin-btn"  title="Pin to canvas">📌</button>
      <button class="edge-info-edit-btn" title="Edit edge config">✏</button>
      <button class="edge-info-save-btn" title="Close">✓</button>
      <button class="edge-info-delete-btn" title="Delete edge">🗑</button>
    </div>
    <div class="node-body">${bodyHtml}</div>
  `;

  nodeEl.querySelector('.edge-info-pin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    _activeEdgeInfo.pinned = !_activeEdgeInfo.pinned;
    const isPinned = _activeEdgeInfo.pinned;
    nodeEl.querySelector('.edge-info-pin-btn').classList.toggle('pinned', isPinned);
    nodeEl.querySelector('.edge-info-edit-btn').style.display   = isPinned ? 'none' : '';
    nodeEl.querySelector('.edge-info-save-btn').style.display   = isPinned ? 'none' : '';
    nodeEl.querySelector('.edge-info-delete-btn').style.display = isPinned ? 'none' : '';
  });

  nodeEl.querySelector('.edge-info-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const edgeToEdit = edges.find((ed) => ed.id === edge.id);
    _closeEdgeInfoNode();
    if (edgeToEdit) _onEdgeEdit?.(edgeToEdit.id);
  });

  nodeEl.querySelector('.edge-info-save-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    _closeEdgeInfoNode();
  });

  nodeEl.querySelector('.edge-info-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    edges = edges.filter((ed) => ed.id !== edge.id);
    _closeEdgeInfoNode();
    _renderAllEdges();
    _notifyChange();
  });

  // Prevent canvas mousedown from auto-saving while interacting with this node
  nodeEl.addEventListener('mousedown', (e) => e.stopPropagation());

  // Draggable by header
  let dragging = false, ox = 0, oy = 0;
  const onHeaderDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const rect = _containerEl.getBoundingClientRect();
    ox = (e.clientX - rect.left - viewport.x) / viewport.zoom - parseFloat(nodeEl.style.left);
    oy = (e.clientY - rect.top  - viewport.y) / viewport.zoom - parseFloat(nodeEl.style.top);
    dragging = true;
  };
  const onDragMove = (e) => {
    if (!dragging) return;
    const rect = _containerEl.getBoundingClientRect();
    nodeEl.style.left = `${(e.clientX - rect.left - viewport.x) / viewport.zoom - ox}px`;
    nodeEl.style.top  = `${(e.clientY - rect.top  - viewport.y) / viewport.zoom - oy}px`;
    _updateEdgeInfoConnector();
  };
  const onDragUp = () => { dragging = false; };

  nodeEl.querySelector('.node-header').addEventListener('mousedown', onHeaderDown);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup',  onDragUp);

  world.appendChild(nodeEl);

  // SVG dotted connector from edge midpoint to info node centre
  const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  lineEl.setAttribute('class', 'edge-info-connector');
  lineEl.setAttribute('stroke', 'var(--border-2, #444)');
  lineEl.setAttribute('stroke-dasharray', '5 3');
  lineEl.setAttribute('stroke-width', '1');
  _positionConnectorLine(lineEl, mid, nodeEl);
  svg.appendChild(lineEl);

  _activeEdgeInfo = {
    edgeId: edge.id, nodeEl, lineEl, pinned: false,
    _cleanup: () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup',  onDragUp);
    },
  };
}

function _closeEdgeInfoNode() {
  if (!_activeEdgeInfo) return;
  _activeEdgeInfo._cleanup?.();
  _activeEdgeInfo.nodeEl.remove();
  _activeEdgeInfo.lineEl.remove();
  _activeEdgeInfo = null;
}

function _updateEdgeInfoConnector() {
  if (!_activeEdgeInfo) return;
  const edge = edges.find((e) => e.id === _activeEdgeInfo.edgeId);
  if (!edge) { _closeEdgeInfoNode(); return; }
  const from = _portWorldPos(edge.fromNodeId, 'out', edge.fromPortIdx ?? 0);
  const to   = _portWorldPos(edge.toNodeId,   'in',  edge.toPortIdx   ?? 0);
  if (!from || !to) return;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  _positionConnectorLine(_activeEdgeInfo.lineEl, mid, _activeEdgeInfo.nodeEl);
}

function _positionConnectorLine(lineEl, mid, nodeEl) {
  const nx = parseFloat(nodeEl.style.left);
  const ny = parseFloat(nodeEl.style.top);
  const nw = nodeEl.offsetWidth  || 220;
  const nh = nodeEl.offsetHeight || 80;
  lineEl.setAttribute('x1', mid.x);
  lineEl.setAttribute('y1', mid.y);
  lineEl.setAttribute('x2', nx + nw / 2);
  lineEl.setAttribute('y2', ny + nh / 2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _applyTransform() {
  const world = document.getElementById('canvas-world');
  if (world) world.style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`;
}

/** Fire a one-shot test event for this node and show a visual pulse. */
/**
 * Fire a test signal from a single node and propagate through all downstream edges.
 * Behaves identically to the global Test Triggers button but scoped to one node.
 */
function _triggerTestSingle(nodeId) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.kind === 'edgeRule') return;

  // Clear run-specific state; persistent payload cache is preserved across runs
  _testDisplayTimers.forEach((t) => clearTimeout(t));
  _testDisplayTimers.clear();
  _testLiveData.clear();
  document.querySelectorAll('.canvas-node.test-pulse').forEach((el) => el.classList.remove('test-pulse'));
  // Refresh overlays — cached payloads remain visible between runs
  nodes.forEach((n) => _updateNodeLiveDisplay(n.id));

  // Build payload from the node's test payload inputs
  const payload = {};
  for (const f of (_KIND_FIELDS[node.kind] ?? [])) payload[f] = node.data._testPayload?.[f] ?? '';
  _deliverPayload(nodeId, payload);
}

/** Short metadata summary rendered inside each canvas node. */
function _nodeBodyHtml(node) {
  const d = node.data ?? {};
  const rows = [];

  switch (node.kind) {
    case 'market':
      if (d.ticker)   rows.push(['Ticker',   d.ticker]);
      if (d.exchange) rows.push(['Exchange', d.exchange]);
      if (d.price !== undefined) rows.push(['Price', d.price]);
      if (d.priceChangePct !== undefined) rows.push(['Chg %', d.priceChangePct]);
      break;
    case 'news':
      if (d.category) rows.push(['Category', d.category]);
      if (d.source)   rows.push(['Source',   d.source]);
      if (d.url)      rows.push(['URL',      d.url.slice(0, 28) + (d.url.length > 28 ? '…' : '')]);
      break;
    case 'polymarket':
      if (d.question)      rows.push(['Q', d.question.slice(0, 28) + (d.question.length > 28 ? '…' : '')]);
      if (d.yesProbability !== undefined) rows.push(['Yes', (d.yesProbability * 100).toFixed(1) + '%']);
      if (d.noProbability  !== undefined) rows.push(['No',  (d.noProbability  * 100).toFixed(1) + '%']);
      break;
    case 'map':
      if (d.region)    rows.push(['Region', d.region]);
      if (d.eventCategory) rows.push(['Type', d.eventCategory]);
      if (d.latitude  !== undefined) rows.push(['Lat', d.latitude]);
      if (d.longitude !== undefined) rows.push(['Lon', d.longitude]);
      break;
    case 'general':
      if (d.title)    rows.push(['Title',   d.title]);
      if (d.message)  rows.push(['Message', d.message.slice(0, 32) + (d.message.length > 32 ? '…' : '')]);
      if (d.channel)  rows.push(['Channel', d.channel]);
      if (d.priority !== undefined) rows.push(['Priority', d.priority]);
      break;
    case 'edgeRule':
      if (d.ruleName) rows.push(['Rule',    d.ruleName]);
      if (d.icmType)  rows.push(['Type',    d.icmType]);
      if (d.count !== undefined) rows.push(['Count', d.count]);
      if (d.windowMs !== undefined) rows.push(['Window', d.windowMs + 'ms']);
      break;
  }

  if (!rows.length) return `<span class="body-hint">Click ⚙ to configure</span>`;

  return rows.map(([k, v]) =>
    `<span class="body-kv"><span class="body-key">${_esc(k)}</span><span class="body-val">${_esc(String(v))}</span></span>`
  ).join('');
}

// ── Test Mode ─────────────────────────────────────────────────────────────────

/** Returns the HTML for the footer of a notification node (Trigger / Test Mode toggle + payload inputs). */
function _nodeFooterHtml(node) {
  const d        = node.data ?? {};
  const testMode = !!d._testMode;
  const fields   = _KIND_FIELDS[node.kind] ?? [];

  let html = `
    <div class="mode-switch-row">
      <label class="mode-switch" title="${testMode ? 'Switch to Trigger mode' : 'Switch to Test Mode'}">
        <input type="checkbox" class="mode-switch-input"${testMode ? ' checked' : ''}>
        <span class="mode-switch-track"><span class="mode-switch-thumb"></span></span>
        <span class="mode-switch-label">${testMode ? 'Test Mode' : 'Trigger'}</span>
      </label>
    </div>`;

  if (testMode && fields.length) {
    html += `<div class="test-payload-fields">`;
    for (const f of fields) {
      const val = _esc(String(d._testPayload?.[f] ?? ''));
      html += `
        <div class="test-payload-row">
          <span class="test-payload-key">${_esc(f)}</span>
          <input class="test-payload-input" data-field="${_esc(f)}" value="${val}" placeholder="test value">
        </div>`;
    }
    html += `</div>`;
  }

  return html;
}

/** Wire the footer toggle + payload inputs on a node element. */
function _wireFooter(el) {
  const nodeId = el.dataset.id;

  const switchInput = el.querySelector('.mode-switch-input');
  if (!switchInput) return;

  switchInput.addEventListener('change', (e) => {
    e.stopPropagation();
    const n = nodes.find((n) => n.id === nodeId);
    if (!n) return;
    n.data._testMode = e.target.checked;
    // Toggle explicit height lock
    el.style.height = n.data._testMode ? '' : `${n.h}px`;
    // Re-render footer
    const footerEl = el.querySelector('.node-footer');
    if (footerEl) { footerEl.innerHTML = _nodeFooterHtml(n); _wireFooter(el); }
    // Edges must update because port positions can change
    _renderAllEdges();
    _notifyChange();
  });

  el.querySelectorAll('.test-payload-input').forEach((input) => {
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      const n     = nodes.find((n) => n.id === nodeId);
      if (!n || !field) return;
      n.data._testPayload = { ...(n.data._testPayload ?? {}), [field]: e.target.value };
      _notifyChange();
    });
  });
}

/**
 * Evaluate outConditions from an edge against a live payload.
 * Returns { pass: bool, results: [{...cond, actual, pass}] }.
 * If every condition has operator '' (skip), always passes.
 */
function _evaluateConditions(outConditions, payload) {
  if (!outConditions.length) return { pass: true, results: [] };
  const results = outConditions.map((c) => {
    const actual = payload[c.field];
    if (!c.operator) return { ...c, pass: true, actual };
    const exp = c.value ?? '';
    let pass = false;
    switch (c.operator) {
      case '==':       pass = String(actual) === String(exp); break;
      case '!=':       pass = String(actual) !== String(exp); break;
      case '>':        pass = Number(actual)  >  Number(exp); break;
      case '<':        pass = Number(actual)  <  Number(exp); break;
      case '>=':       pass = Number(actual)  >= Number(exp); break;
      case '<=':       pass = Number(actual)  <= Number(exp); break;
      case 'contains': pass = String(actual).includes(String(exp)); break;
      case 'regex':    try { pass = new RegExp(exp).test(String(actual)); } catch { pass = false; } break;
    }
    return { ...c, pass, actual };
  });
  // All active (non-skip) conditions must pass
  const pass = results.filter((r) => r.operator).every((r) => r.pass);
  return { pass, results };
}

/** Update the .node-live-overlay div inside a canvas node — 2-tab UI (Payloads / Conditions). */
function _updateNodeLiveDisplay(nodeId) {
  const runData  = _testLiveData.get(nodeId);
  const cached   = _payloadCache.get(nodeId);
  // Prefer live run data; fall back to cached payload to show last known state between runs
  const liveData = runData ?? (cached?.payload ? { payload: cached.payload, edgeStates: [] } : null);
  const el       = document.querySelector(`.canvas-node[data-id="${nodeId}"]`);
  if (!el) return;
  const overlay = el.querySelector('.node-live-overlay');
  if (!overlay) return;

  if (!liveData) { overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');

  // Preserve active tab across re-renders
  const activeTab = overlay.querySelector('.live-tab-btn.active')?.dataset.tab ?? 'payloads';

  // ── Payloads pane ─────────────────────────────────────────────────────────
  const payloadEntries = Object.entries(liveData.payload ?? {}).filter(([k]) => !k.startsWith('_'));
  let payloadsHtml = '';
  if (payloadEntries.length) {
    payloadsHtml += '<div class="live-payload">';
    for (const [k, v] of payloadEntries) {
      payloadsHtml += `<span class="live-kv"><span class="live-key">${_esc(k)}</span><span class="live-val">${_esc(String(v ?? ''))}</span></span>`;
    }
    payloadsHtml += '</div>';
  } else {
    payloadsHtml = '<span class="live-empty">No payload yet</span>';
  }

  // ── Conditions pane ───────────────────────────────────────────────────────
  let condsHtml = '';
  if (liveData.edgeStates?.length) {
    condsHtml += '<div class="live-edge-states">';
    for (const es of liveData.edgeStates) {
      const cls = es.pass ? 'pass' : 'fail';
      condsHtml += `<div class="live-edge-state ${cls}"><span class="live-edge-icon">${es.pass ? '\u2713' : '\u2717'}</span><span class="live-edge-label">\u2192 ${_esc(es.toNodeLabel)}</span></div>`;
      for (const c of (es.conditions ?? []).filter((c) => c.operator)) {
        const cc = c.pass ? 'pass' : 'fail';
        condsHtml += `<div class="live-cond-row ${cc}">`
          + `<span class="live-cond-icon">${c.pass ? '\u2713' : '\u2717'}</span>`
          + `<span class="live-cond-field">${_esc(c.field)}</span>`
          + `<span class="live-cond-op">${_esc(c.operator)}</span>`
          + `<span class="live-cond-val">${_esc(String(c.value ?? ''))}</span>`
          + `<span class="live-cond-actual">[${_esc(String(c.actual ?? ''))}]</span>`
          + `</div>`;
      }
    }
    condsHtml += '</div>';
  } else {
    condsHtml = '<span class="live-empty">No outgoing edges</span>';
  }

  const pA = activeTab === 'payloads';
  overlay.innerHTML =
    `<div class="live-tabs">`
    + `<button class="live-tab-btn${pA ? ' active' : ''}" data-tab="payloads">Payloads</button>`
    + `<button class="live-tab-btn${!pA ? ' active' : ''}" data-tab="conditions">Conditions</button>`
    + `</div>`
    + `<div class="live-pane${pA ? '' : ' hidden'}" data-pane="payloads">${payloadsHtml}</div>`
    + `<div class="live-pane${!pA ? '' : ' hidden'}" data-pane="conditions">${condsHtml}</div>`;

  // Wire tab buttons
  overlay.querySelectorAll('.live-tab-btn').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.tab;
      overlay.querySelectorAll('.live-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      overlay.querySelectorAll('.live-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
    });
  });
}

// ── Payload cache helpers ─────────────────────────────────────────────────────────

/** Load the payload cache from localStorage into the in-memory `_payloadCache` map. */
function _loadPayloadCache() {
  _payloadCache.clear();
  try {
    const raw = localStorage.getItem(_PAYLOAD_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const [id, entry] of Object.entries(obj)) {
      if (id && entry?.payload) _payloadCache.set(id, entry);
    }
  } catch { /* ignore corrupted data */ }
}

/** Debounced (500 ms) write of the in-memory cache to localStorage. */
function _savePayloadCache() {
  clearTimeout(_payloadCacheSaveTimer);
  _payloadCacheSaveTimer = setTimeout(() => {
    try {
      const obj = {};
      for (const [id, entry] of _payloadCache) obj[id] = entry;
      localStorage.setItem(_PAYLOAD_CACHE_KEY, JSON.stringify(obj));
    } catch { /* quota exceeded or private mode — silently ignore */ }
  }, 500);
}

/** Pulse an SVG edge path with a pass (yellow) or fail (red) colour flash. */
function _pulseEdge(edgeId, type /* 'pass' | 'fail' */) {
  const path = document.querySelector(`.canvas-edge[data-edge-id="${edgeId}"]`);
  if (!path) return;
  path.classList.remove('edge-pulse-pass', 'edge-pulse-fail');
  void path.getBoundingClientRect(); // force reflow so re-applying restarts the animation
  path.classList.add(type === 'pass' ? 'edge-pulse-pass' : 'edge-pulse-fail');
  setTimeout(() => path.classList.remove('edge-pulse-pass', 'edge-pulse-fail'), 2500);
}

/**
 * Deliver an incoming payload to a node.
 * Merges with any already-accumulated payload, re-evaluates outgoing edge conditions,
 * and fires any edges that now pass (each edge fires at most once per test run).
 * Visual updates are debounced so burst deliveries produce a single display refresh.
 */
function _deliverPayload(nodeId, incomingPayload) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;

  // ── Accumulate payload: persistent cache ← run state ← new incoming ───────
  const existing      = _testLiveData.get(nodeId) ?? { payload: {}, edgeStates: [], firedEdges: new Set() };
  const cachedPayload = _payloadCache.get(nodeId)?.payload ?? {};
  const mergedPayload = { ...cachedPayload, ...existing.payload, ...incomingPayload };

  // ── Re-evaluate outgoing edge conditions against the merged payload ────────
  const outEdges   = edges.filter((e) => e.fromNodeId === nodeId);
  const edgeStates = outEdges.map((edge) => {
    const toNode = nodes.find((n) => n.id === edge.toNodeId);
    const { pass, results } = _evaluateConditions(edge.meta?.outConditions ?? [], mergedPayload);
    return { edgeId: edge.id, toNodeId: edge.toNodeId, toNodeLabel: _nodeLabel(toNode) || 'Node', pass, conditions: results };
  });

  _testLiveData.set(nodeId, { payload: mergedPayload, edgeStates, firedEdges: existing.firedEdges });

  // ── Persist merged payload so it survives page reloads ───────────────────
  _payloadCache.set(nodeId, { payload: { ...mergedPayload }, updatedAt: new Date().toISOString() });
  _savePayloadCache();

  // ── Fire newly-passing out-edges (each edge fires at most once per run) ───
  for (const edge of outEdges) {
    const es = edgeStates.find((s) => s.edgeId === edge.id);
    if (es?.pass && !existing.firedEdges.has(edge.id)) {
      existing.firedEdges.add(edge.id);
      const enabled   = (edge.meta?.triggerPayload ?? []).filter((p) => p.enabled);
      const forwarded = {};
      if (edge.meta?.triggerName) forwarded.triggerName = edge.meta.triggerName;
      if (enabled.length) {
        for (const p of enabled) forwarded[p.targetField ?? p.field] = mergedPayload[p.field] ?? mergedPayload[p.targetField] ?? '';
      } else {
        Object.assign(forwarded, mergedPayload);
      }
      // Cascade downstream with a 300 ms visual lag
      setTimeout(() => _deliverPayload(edge.toNodeId, forwarded), 300);
    }
  }

  // ── Debounced visual update (50 ms) so burst deliveries merge into one render
  clearTimeout(_testDisplayTimers.get(nodeId));
  _testDisplayTimers.set(nodeId, setTimeout(() => {
    _testDisplayTimers.delete(nodeId);
    const el = document.querySelector(`.canvas-node[data-id="${nodeId}"]`);
    if (el) { el.classList.add('test-pulse'); setTimeout(() => el.classList.remove('test-pulse'), 800); }
    _updateNodeLiveDisplay(nodeId);
    // Pulse each outgoing edge: yellow if it passed, red if still failing
    const ld = _testLiveData.get(nodeId);
    for (const es of (ld?.edgeStates ?? [])) _pulseEdge(es.edgeId, es.pass ? 'pass' : 'fail');
    document.dispatchEvent(new CustomEvent('nc:canvas:test', {
      detail: { nodeId, kind: node.kind, data: { ...node.data }, payload: { ...mergedPayload } },
    }));
    console.log('[canvas] test payload →', node.kind, mergedPayload);
  }, 50));
}

/**
 * Fire a simulated signal from every notification node that is in Test Mode.
 * Payloads flow downstream through edges exactly as configured.
 */
export function triggerTestNodes() {
  // Clear run-specific state; persistent payload cache is preserved across runs
  _testDisplayTimers.forEach((t) => clearTimeout(t));
  _testDisplayTimers.clear();
  _testLiveData.clear();
  document.querySelectorAll('.canvas-node.test-pulse').forEach((el) => el.classList.remove('test-pulse'));
  // Refresh overlays — cached payloads remain visible between runs
  nodes.forEach((n) => _updateNodeLiveDisplay(n.id));

  const testNodes = nodes.filter((n) => n.kind !== 'edgeRule' && n.data._testMode);
  if (!testNodes.length) {
    toast('No nodes in Test Mode', 'warn');
    return;
  }
  for (const node of testNodes) {
    const payload = {};
    for (const f of (_KIND_FIELDS[node.kind] ?? [])) payload[f] = node.data._testPayload?.[f] ?? '';
    _deliverPayload(node.id, payload);
  }
}

function _notifyChange() {
  document.dispatchEvent(new CustomEvent('nc:canvas:change'));
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
