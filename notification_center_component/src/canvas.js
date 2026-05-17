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
 */

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
  _renderAllEdges();
  _notifyChange();
}

export function loadCanvasState(state) {
  clearCanvas();
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

// ── Render node ───────────────────────────────────────────────────────────────

function _renderNode(node) {
  const world = document.getElementById('canvas-world');
  if (!world) return;

  const kindColor = KIND_COLORS[node.kind] ?? '#888';

  const el = document.createElement('div');
  el.className = `canvas-node kind-${node.kind}`;
  el.dataset.id = node.id;
  el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px;--kind-color:${kindColor};`;

  el.innerHTML = `
    <div class="node-header">
      <span class="node-kind-icon">${KIND_ICONS[node.kind] ?? '\ud83d\udd14'}</span>
      <span class="node-title">${_esc(_nodeLabel(node))}</span>
      ${node.kind === 'edgeRule' ? '<button class="node-jump-rule-btn" title="Open in Edge Rules">↗</button>' : ''}
      <button class="node-test-btn" title="Test trigger">▶</button>
      <button class="node-menu-btn" title="Configure">⚙</button>
    </div>
    <div class="node-body">${_nodeBodyHtml(node)}</div>
    <div class="node-resize-handle" title="Resize"></div>
  `;

  // Test button
  el.querySelector('.node-test-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _triggerTest(node.id);
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
  const count = direction === 'in' ? (node.data.inputs ?? 1) : (node.data.outputs ?? 1);
  const x = direction === 'in' ? node.x : node.x + (node.w ?? 180);
  const y = node.y + ((portIdx + 1) / (count + 1)) * (node.h ?? 100);
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
    const startW = node.w,    startH = node.h;

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
  svg.querySelectorAll('.canvas-edge, .canvas-edge-label, .canvas-edge-badge').forEach((el) => el.remove());
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
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'canvas-edge');
    path.setAttribute('d', `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`);
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
    const pCount = (edge.meta?.triggerPayload ?? []).length;
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
function _triggerTest(nodeId) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const el = document.querySelector(`.canvas-node[data-id="${nodeId}"]`);
  if (el) {
    el.classList.add('test-pulse');
    setTimeout(() => el.classList.remove('test-pulse'), 800);
  }
  // Dispatch custom DOM event so other modules can respond
  document.dispatchEvent(new CustomEvent('nc:canvas:test', {
    detail: { nodeId, kind: node.kind, data: { ...node.data } },
  }));
  console.log('[canvas] test trigger:', node.kind, node.data);
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

function _nodeLabel(node) {
  const d = node.data ?? {};
  if (d.title)   return d.title;
  if (d.ticker)  return d.ticker;
  if (d.question) return d.question.slice(0, 25) + (d.question.length > 25 ? '…' : '');
  if (d.ruleName) return d.ruleName;
  if (d.category) return d.category;
  return KIND_LABELS[node.kind] ?? node.kind;
}

function _notifyChange() {
  document.dispatchEvent(new CustomEvent('nc:canvas:change'));
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
