/**
 * kg-dir-importer.js
 *
 * "Import Directory → KG" feature.
 *
 * Walks the full markdown directory tree and creates:
 *   - Category node  (typeId 4)  for every folder
 *   - Document node  (typeId 1)  for every .md file
 *   - CONTAINS edge  (typeId 1)  from each Category → its Documents
 *
 * The import runs as a job in the existing job monitor panel.
 */

import { getMarkdownTree } from './api.js';
import { addKGJob, appendKGJobStep, finishKGJob } from './monitor.js';

const KG_BASE = '/api/kg';

// ── KG API helpers ────────────────────────────────────────────────────────────
async function kgFetch(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res  = await fetch(KG_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data;
}

async function listGraphs()             { return (await kgFetch('GET', '/graphs')).graphs ?? []; }
async function createGraph(name)        { return kgFetch('POST', '/graphs', { name }); }
async function upsertNode(graph, typeId, key, props) {
  return kgFetch('POST', `/graphs/${encodeURIComponent(graph)}/nodes`, { typeId, key, props });
}
async function upsertEdge(graph, fromId, toId, typeId) {
  return kgFetch('POST', `/graphs/${encodeURIComponent(graph)}/edges`, { fromId, toId, typeId });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s = '') {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Collect all (category, file) pairs from the tree recursively. */
function flattenTree(nodes, category = null) {
  const pairs = []; // { category: 'ai', filePath: 'ai/some-file.md', fileName: 'some-file.md' }
  for (const n of nodes ?? []) {
    if (n.type === 'dir') {
      const cat = category ?? n.name; // top-level folder is the category
      // Recurse; pass the top-level category name down
      pairs.push(...flattenTree(n.children, cat));
    } else if (n.type === 'file') {
      pairs.push({ category: category ?? '(root)', filePath: n.path, fileName: n.name });
    }
  }
  return pairs;
}

/** Extract all top-level category folder names from tree. */
function topLevelDirs(nodes) {
  return nodes.filter(n => n.type === 'dir').map(n => n.name);
}

// ── Modal state ───────────────────────────────────────────────────────────────
let _treeData    = null;   // cached tree from last load
let _graphName   = '';
let _isNew       = false;

export function openKGDirModal() {
  const modal = document.getElementById('modal-kg-dir');
  if (!modal) return;
  modal.classList.add('open');
  setDirStatus('');
  _treeData = null;
  loadDirGraphDropdown();
  updateDirPreview();
}

function closeDirModal() {
  document.getElementById('modal-kg-dir')?.classList.remove('open');
}

function setDirStatus(msg, cls = '') {
  const el = document.getElementById('kg-dir-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `kg-send-status${cls ? ' ' + cls : ''}`;
}

function toggleDirNewRow() {
  const sel = document.getElementById('kg-dir-graph-select');
  const row = document.getElementById('kg-dir-new-name-row');
  if (!sel || !row) return;
  row.hidden = sel.value !== '__new__';
}

async function loadDirGraphDropdown() {
  const sel = document.getElementById('kg-dir-graph-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const graphs = await listGraphs();
    sel.innerHTML =
      (graphs.length
        ? graphs.map(g => `<option value="${escAttr(g.name)}">${esc(g.name)}${g.nodeCount != null ? ` (${g.nodeCount} nodes)` : ''}</option>`).join('')
        : '') +
      '<option value="__new__">＋ Create new graph…</option>';
    if (graphs.length && sel.value === '') sel.selectedIndex = 0;
  } catch {
    sel.innerHTML = '<option value="__new__">＋ Create new graph…</option>';
  }
  toggleDirNewRow();
}

async function updateDirPreview() {
  const previewEl = document.getElementById('kg-dir-preview');
  if (!previewEl) return;
  previewEl.textContent = 'Loading tree…';
  try {
    if (!_treeData) {
      const res = await getMarkdownTree();
      _treeData = res.tree ?? res;
    }
    const dirs  = topLevelDirs(_treeData);
    const pairs = flattenTree(_treeData);
    const total = dirs.length + pairs.length;

    previewEl.innerHTML =
      `<strong>${dirs.length}</strong> categories, <strong>${pairs.length}</strong> documents → ` +
      `<strong>${total}</strong> nodes + <strong>${pairs.length}</strong> edges<br>` +
      `<span class="kg-dir-cats">${dirs.map(d => `<span class="kg-type-badge">🗂 ${esc(d)}</span>`).join(' ')}</span>`;
  } catch (err) {
    previewEl.textContent = `Could not load tree: ${err.message}`;
  }
}

// ── Import logic ──────────────────────────────────────────────────────────────
async function doImport() {
  const sel       = document.getElementById('kg-dir-graph-select');
  const newNameEl = document.getElementById('kg-dir-new-graph-name');
  const btn       = document.getElementById('kg-dir-import-btn');

  _isNew      = sel?.value === '__new__';
  _graphName  = _isNew ? newNameEl?.value.trim() : sel?.value;

  if (!_graphName) {
    setDirStatus(_isNew ? 'Enter a name for the new graph.' : 'Select a target graph.', 'err');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  setDirStatus('');
  closeDirModal();

  // ── Load tree ─────────────────────────────────────────────────────────────
  let treeNodes;
  try {
    if (!_treeData) {
      const res = await getMarkdownTree();
      _treeData = res.tree ?? res;
    }
    treeNodes = _treeData;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '⬁ Import Directory'; }
    return;
  }

  const dirs  = topLevelDirs(treeNodes);
  const pairs = flattenTree(treeNodes);
  const total = dirs.length + pairs.length;  // nodes only; edges are extra

  const jobId = `kg-dir-${Date.now()}`;
  addKGJob(jobId, `📂 → ${_graphName}`, total);

  document.getElementById('monitor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    // 1. Create graph if new
    if (_isNew) {
      appendKGJobStep(jobId, { action: 'Create graph', file: _graphName, status: 'running' });
      await createGraph(_graphName);
      appendKGJobStep(jobId, { action: 'Create graph', file: _graphName, status: 'ok', message: 'Graph created' });
    }

    // 2. Upsert category nodes  –  collect {name → nodeId}
    const categoryIds = {};   // folder name → nodeId string
    for (const dirName of dirs) {
      appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'running' });
      try {
        const res = await upsertNode(_graphName, 4, dirName, { label: dirName });
        categoryIds[dirName] = res.nodeId;
        appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'ok', message: `id ${res.nodeId}` });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'err', message: err.message });
      }
    }

    // 3. Upsert document nodes + CONTAINS edges
    for (const { category, filePath, fileName } of pairs) {
      const label = fileName.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
      appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'running' });
      let docId;
      try {
        const res = await upsertNode(_graphName, 1, filePath, { label, category, source: filePath });
        docId = res.nodeId;
        appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'ok', message: `id ${res.nodeId}` });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'err', message: err.message });
        continue;
      }

      // Create edge: Category –[CONTAINS]→ Document
      const catId = categoryIds[category];
      if (catId && docId) {
        try {
          await upsertEdge(_graphName, catId, docId, 1 /* CONTAINS */);
          // no step for edges — too many; reflected in progress implicitly
        } catch {
          // non-fatal
        }
      }
    }

    finishKGJob(jobId, 'ok');

    // Broadcast refresh to any open KG component
    const frame = document.getElementById('kg-frame');
    const msg   = { type: 'kg:refresh-graphs', graph: _graphName };
    frame?.contentWindow?.postMessage(msg, '*');
    if (window.opener) window.opener.postMessage(msg, '*');

  } catch (err) {
    appendKGJobStep(jobId, { action: 'Import', file: _graphName, status: 'err', message: err.message });
    finishKGJob(jobId, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬁ Import Directory'; }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initKGDirImporter() {
  document.getElementById('kg-dir-graph-select')?.addEventListener('change', toggleDirNewRow);

  document.getElementById('kg-dir-cancel')?.addEventListener('click', closeDirModal);
  document.getElementById('kg-dir-close-x')?.addEventListener('click', closeDirModal);

  document.getElementById('kg-dir-import-btn')?.addEventListener('click', doImport);

  // Close on backdrop click
  document.getElementById('modal-kg-dir')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDirModal();
  });
}

/**
 * Rebuild an existing graph from the markdown directory tree.
 * Called when the KG component's Recreate button posts a
 * `kg:rebuild-directory` message to the parent (scraper) window.
 * The graph must already exist and be empty (Recreate was just called).
 */
export async function rebuildGraphFromDirectory(graphName) {
  if (!graphName) return;

  let treeNodes;
  try {
    const res = await getMarkdownTree();
    treeNodes = res.tree ?? res;
  } catch (err) {
    console.error('[kg-dir] rebuildGraphFromDirectory: could not load tree', err);
    return;
  }

  const dirs  = topLevelDirs(treeNodes);
  const pairs = flattenTree(treeNodes);
  const total = dirs.length + pairs.length;

  const jobId = `kg-rebuild-${Date.now()}`;
  addKGJob(jobId, `↺ Rebuild ${graphName}`, total);

  document.getElementById('monitor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    // 1. Upsert category nodes — collect {name → nodeId}
    const categoryIds = {};
    for (const dirName of dirs) {
      appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'running' });
      try {
        const res = await upsertNode(graphName, 4, dirName, { label: dirName });
        categoryIds[dirName] = res.nodeId;
        appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'ok', message: `id ${res.nodeId}` });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Category node', file: dirName, status: 'err', message: err.message });
      }
    }

    // 2. Upsert document nodes + CONTAINS edges
    for (const { category, filePath, fileName } of pairs) {
      const label = fileName.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
      appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'running' });
      let docId;
      try {
        const res = await upsertNode(graphName, 1, filePath, { label, category, source: filePath });
        docId = res.nodeId;
        appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'ok', message: `id ${res.nodeId}` });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Document node', file: filePath, status: 'err', message: err.message });
        continue;
      }

      const catId = categoryIds[category];
      if (catId && docId) {
        try {
          await upsertEdge(graphName, catId, docId, 1 /* CONTAINS */);
        } catch { /* non-fatal */ }
      }
    }

    finishKGJob(jobId, 'ok');

    // Notify the KG frame to refresh
    const frame = document.getElementById('kg-frame');
    const msg   = { type: 'kg:refresh-graphs', graph: graphName };
    frame?.contentWindow?.postMessage(msg, '*');

  } catch (err) {
    appendKGJobStep(jobId, { action: 'Rebuild', file: graphName, status: 'err', message: err.message });
    finishKGJob(jobId, 'err');
  }
}
