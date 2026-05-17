import { getMarkdownTree, getMarkdownFile, getMarkdownMeta, deleteMarkdownFile, exportZipUrl } from './api.js';
import { openKGSendModal, initKGSender } from './kg-sender.js';
import { openKGDirModal, initKGDirImporter, rebuildGraphFromDirectory } from './kg-dir-importer.js';
import { marked } from 'marked';
import { toast } from './toast.js';
import { addNotification } from './notifications.js';

// ── Module state ─────────────────────────────────────────────────────────────
let activeFile    = null;
let currentRaw    = '';
let showingRaw    = false;
let treeData      = [];
let filterQuery   = '';
let sortMode      = 'name';    // 'name' | 'date' | 'size'
let selectedPaths = new Set(); // full paths of checked files
let collapsedDirs = new Set(); // dir full-paths that are currently collapsed

// ── Public init ──────────────────────────────────────────────────────────────
export function initFileBrowser() {
  loadTree();
  initKGSender();
  initKGDirImporter();

  // Listen for rebuild requests sent by the KG component iframe
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'kg:rebuild-directory' && e.data.graph) {
      rebuildGraphFromDirectory(e.data.graph);
    }
  });

  document.getElementById('refresh-tree-btn')?.addEventListener('click', () => loadTree());
  document.addEventListener('scraper:job-done', () => setTimeout(loadTree, 1500));
  document.getElementById('preview-raw-toggle')?.addEventListener('click', toggleRaw);

  document.getElementById('tree-search')?.addEventListener('input', (e) => {
    filterQuery = e.target.value.trim();
    rerenderTree();
  });

  document.getElementById('tree-sort')?.addEventListener('change', (e) => {
    sortMode = e.target.value;
    rerenderTree();
  });

  document.getElementById('preview-delete-btn')?.addEventListener('click', deleteActiveFile);

  document.getElementById('preview-export-btn')?.addEventListener('click', () => {
    if (!activeFile) return;
    const category = activeFile.split('/')[0];
    window.open(exportZipUrl(category), '_blank');
  });

  // Selection bar
  document.getElementById('selection-clear')?.addEventListener('click', () => {
    selectedPaths.clear();
    rerenderTree();
    updateSelectionBar();
  });

  document.getElementById('btn-send-to-kg')?.addEventListener('click', () => {
    if (selectedPaths.size > 0) openKGSendModal([...selectedPaths]);
  });

  document.getElementById('btn-import-dir-to-kg')?.addEventListener('click', () => {
    openKGDirModal();
  });

  initResizer();
}

// ── Selection bar ─────────────────────────────────────────────────────────────
function updateSelectionBar() {
  const bar   = document.getElementById('selection-bar');
  const count = document.getElementById('selection-count');
  if (!bar) return;
  if (selectedPaths.size > 0) {
    bar.hidden = false;
    if (count) count.textContent = `${selectedPaths.size} file${selectedPaths.size !== 1 ? 's' : ''} selected`;
  } else {
    bar.hidden = true;
  }
}

// ── Tree helpers ──────────────────────────────────────────────────────────────
function allFilePaths(nodes) {
  const paths = [];
  for (const n of nodes) {
    if (n.type === 'file') paths.push(n.path);
    else if (n.children) paths.push(...allFilePaths(n.children));
  }
  return paths;
}

function dirCheckState(node) {
  const paths = allFilePaths(node.children ?? []);
  if (!paths.length) return 'none';
  const n = paths.filter(p => selectedPaths.has(p)).length;
  if (n === 0) return 'none';
  return n === paths.length ? 'all' : 'partial';
}

// ── Tree loading ─────────────────────────────────────────────────────────────
async function loadTree() {
  const treeEl = document.getElementById('file-tree');
  if (!treeEl) return;

  treeEl.innerHTML = '<p class="tree-empty">Loading…</p>';

  try {
    const { tree } = await getMarkdownTree();
    treeData = tree;
    rerenderTree();
    updateFileCount(tree);
  } catch (err) {
    treeEl.innerHTML = `<p class="tree-error">⚠ ${err.message}</p>`;
  }
}

function rerenderTree() {
  const treeEl = document.getElementById('file-tree');
  if (!treeEl) return;
  const scrollTop = treeEl.scrollTop;
  const nodes = filterQuery ? filterTree(treeData, filterQuery.toLowerCase()) : treeData;
  renderTree(treeEl, nodes, 0, '');
  treeEl.scrollTop = scrollTop;
}

function filterTree(nodes, q) {
  const result = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(q)) result.push(node);
    } else if (node.type === 'dir') {
      const children = filterTree(node.children ?? [], q);
      if (children.length > 0) result.push({ ...node, children });
    }
  }
  return result;
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    if (sortMode === 'date') {
      return new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0);
    }
    if (sortMode === 'size') {
      return (b.size || 0) - (a.size || 0);
    }
    return a.name.localeCompare(b.name);
  });
}

function countFiles(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'file') n++;
    else if (node.children) n += countFiles(node.children);
  }
  return n;
}

function updateFileCount(tree) {
  const el = document.getElementById('file-count');
  if (!el) return;
  const n = countFiles(tree);
  el.textContent = `${n} file${n !== 1 ? 's' : ''}`;
}

// ── Tree rendering ───────────────────────────────────────────────────────────
function renderTree(container, nodes, depth, parentPath) {
  container.innerHTML = '';

  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<p class="tree-empty">No markdown files found.</p>';
    return;
  }

  sortNodes(nodes).forEach((node) => {
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === 'dir')  container.appendChild(makeDirNode(node, depth, fullPath));
    if (node.type === 'file') container.appendChild(makeFileNode(node, depth));
  });
}

function makeDirNode(node, depth, fullPath) {
  const wrap = document.createElement('div');
  wrap.classList.add('tree-dir');

  // Header row
  const hdr = document.createElement('div');
  hdr.classList.add('tree-dir-hdr');
  hdr.style.setProperty('--depth', depth);

  // Tri-state checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.classList.add('tree-check');
  const state = dirCheckState(node);
  cb.checked       = state === 'all';
  cb.indeterminate = state === 'partial';
  cb.title = state === 'none' ? 'Select all in folder' : 'Deselect all in folder';
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    const filePaths = allFilePaths(node.children ?? []);
    if (state === 'none') filePaths.forEach(p => selectedPaths.add(p));
    else filePaths.forEach(p => selectedPaths.delete(p));
    rerenderTree();
    updateSelectionBar();
  });

  const toggle = document.createElement('span');
  toggle.classList.add('toggle-icon');
  const isCollapsed = collapsedDirs.has(fullPath);
  toggle.textContent = isCollapsed ? '▸' : '▾';

  const nameEl = document.createElement('span');
  nameEl.classList.add('dir-name');
  nameEl.textContent = node.name;

  const badge = document.createElement('span');
  badge.classList.add('dir-badge');
  badge.textContent = countFiles(node.children ?? []);

  hdr.append(cb, toggle, nameEl, badge);

  // Children container
  const children = document.createElement('div');
  children.classList.add('tree-children');
  if (isCollapsed) children.classList.add('collapsed');
  sortNodes(node.children ?? []).forEach((child) => {
    const childPath = `${fullPath}/${child.name}`;
    if (child.type === 'dir')  children.appendChild(makeDirNode(child, depth + 1, childPath));
    if (child.type === 'file') children.appendChild(makeFileNode(child, depth + 1));
  });

  // Toggle collapse on header (but not on checkbox)
  hdr.addEventListener('click', (e) => {
    if (e.target === cb) return;
    const nowCollapsed = children.classList.toggle('collapsed');
    toggle.textContent = nowCollapsed ? '▸' : '▾';
    if (nowCollapsed) collapsedDirs.add(fullPath);
    else collapsedDirs.delete(fullPath);
  });

  wrap.append(hdr, children);
  return wrap;
}

function makeFileNode(node, depth) {
  const el = document.createElement('div');
  el.classList.add('tree-file');
  el.style.setProperty('--depth', depth);
  el.dataset.path = node.path;

  // Checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.classList.add('tree-check');
  cb.checked = selectedPaths.has(node.path);
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectedPaths.has(node.path)) selectedPaths.delete(node.path);
    else selectedPaths.add(node.path);
    rerenderTree();
    updateSelectionBar();
  });

  const icon = document.createElement('span');
  icon.classList.add('file-icon');
  icon.textContent = '📄';

  const name = document.createElement('span');
  name.classList.add('file-name');
  name.textContent = node.name.replace(/\.md$/i, '');
  name.title = node.name;

  el.append(cb, icon, name);
  el.addEventListener('click', (e) => {
    if (e.target === cb) return;
    openFile(node.path, node.name, el);
  });
  return el;
}

// ── File preview ─────────────────────────────────────────────────────────────
async function openFile(filePath, fileName, fileEl) {
  // Update active highlight
  document.querySelectorAll('.tree-file.active').forEach((n) => n.classList.remove('active'));
  fileEl.classList.add('active');
  activeFile = filePath;

  // Update header
  const header = document.getElementById('preview-filename');
  if (header) header.textContent = fileName;

  const rendered = document.getElementById('preview-rendered');
  const rawEl    = document.getElementById('preview-raw-text');

  if (rendered) rendered.innerHTML = '<p class="preview-placeholder">Loading…</p>';
  if (rawEl)    rawEl.textContent  = '';

  try {
    const raw = await getMarkdownFile(filePath);
    currentRaw = raw;

    if (rawEl)    rawEl.textContent  = raw;
    if (rendered) rendered.innerHTML = marked.parse(raw);

    // Apply view mode
    applyViewMode();

    // Fetch and display metadata
    loadAndShowMeta(filePath);
  } catch (err) {
    if (rendered) rendered.innerHTML = `<p class="tree-error">⚠ ${err.message}</p>`;
    currentRaw = '';
  }
}

async function loadAndShowMeta(filePath) {
  const strip = document.getElementById('preview-meta-strip');
  if (!strip) return;
  try {
    const meta = await getMarkdownMeta(filePath);
    strip.hidden = false;
    strip.innerHTML = [
      meta.wordCount    != null ? `<span>${meta.wordCount.toLocaleString()} words</span>` : '',
      meta.readingMinutes != null ? `<span>~${meta.readingMinutes} min read</span>` : '',
      meta.method       ? `<span class="meta-method meta-${meta.method}">${meta.method}</span>` : '',
      meta.scraped_at   ? `<span title="Scraped at">${new Date(meta.scraped_at).toLocaleDateString()}</span>` : '',
      meta.url          ? `<a href="${meta.url}" target="_blank" rel="noreferrer noopener" class="meta-url">Source ↗</a>` : '',
    ].filter(Boolean).join('');
  } catch {
    strip.hidden = true;
  }
}

function toggleRaw() {
  showingRaw = !showingRaw;
  const btn = document.getElementById('preview-raw-toggle');
  if (btn) btn.textContent = showingRaw ? 'Rendered' : 'Raw';
  applyViewMode();
}

function applyViewMode() {
  const rendered = document.getElementById('preview-rendered');
  const rawEl    = document.getElementById('preview-raw-text');
  if (showingRaw) {
    if (rendered) rendered.style.display = 'none';
    if (rawEl)    rawEl.style.display    = 'block';
  } else {
    if (rendered) rendered.style.display = 'block';
    if (rawEl)    rawEl.style.display    = 'none';
  }
}

// Allow main.js copy delegation to pick up the raw content
export function getCurrentRaw() {
  return currentRaw;
}

// ── Delete active file ────────────────────────────────────────────────────────
async function deleteActiveFile() {
  if (!activeFile) return;
  if (!confirm(`Delete "${activeFile}"? This cannot be undone.`)) return;
  try {
    await deleteMarkdownFile(activeFile);
    toast(`Deleted: ${activeFile}`, 'ok');
    addNotification('info', 'File deleted', activeFile);
    activeFile  = null;
    currentRaw  = '';
    // Clear preview
    const rendered = document.getElementById('preview-rendered');
    const rawEl    = document.getElementById('preview-raw-text');
    const header   = document.getElementById('preview-filename');
    const strip    = document.getElementById('preview-meta-strip');
    if (rendered) rendered.innerHTML = '<p class="preview-placeholder">Select a file to preview.</p>';
    if (rawEl)    rawEl.textContent  = '';
    if (header)   header.textContent = 'Select a file';
    if (strip)    strip.hidden       = true;
    loadTree();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'err');
  }
}

// ── Resizer (drag to resize tree vs preview) ──────────────────────────────────
function initResizer() {
  const resizer  = document.getElementById('tree-resizer');
  const sidebar  = document.querySelector('.tree-sidebar');
  if (!resizer || !sidebar) return;

  let dragging = false;
  let startX   = 0;
  let startW   = 0;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW  = Math.max(140, Math.min(startW + delta, 600));
    sidebar.style.flex = `0 0 ${newW}px`;
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = '';
  });
}
