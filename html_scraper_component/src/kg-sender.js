import { getMarkdownFile, getMarkdownMeta } from './api.js';
import { toast } from './toast.js';
import { addKGJob, appendKGJobStep, finishKGJob } from './monitor.js';

const KG_BASE = '/api/kg';

// ── Node type catalogue ───────────────────────────────────────────────────────
export const KG_NODE_TYPES = [
  { id: 1, name: 'Document',   icon: '📄', desc: 'A primary content node — article, report, scraped page, or any standalone text file.' },
  { id: 2, name: 'Entity',     icon: '🏷', desc: 'A named real-world thing extracted from content: person, organisation, product, or place.' },
  { id: 3, name: 'Concept',    icon: '💡', desc: 'An abstract idea, topic, or theme that spans multiple documents.' },
  { id: 4, name: 'Category',   icon: '🗂', desc: 'A classification bucket or folder grouping that contains other nodes.' },
  { id: 5, name: 'Reference',  icon: '🔗', desc: 'An external link or citation pointing to a source outside the graph.' },
];

function getNodeTypeInfo(id) {
  return KG_NODE_TYPES.find(t => t.id === Number(id)) ?? null;
}

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

async function listGraphs() {
  const data = await kgFetch('GET', '/graphs');
  return data.graphs ?? [];
}

async function createGraph(name) {
  return kgFetch('POST', '/graphs', { name });
}

async function upsertNode(graphName, typeId, key, props) {
  return kgFetch('POST', `/graphs/${encodeURIComponent(graphName)}/nodes`, { typeId, key, props });
}

// ── Modal state ───────────────────────────────────────────────────────────────
let _paths = [];

export function openKGSendModal(paths) {
  _paths = paths;
  const modal = document.getElementById('modal-kg-send');
  if (!modal) return;
  modal.classList.add('open');
  refreshCountLabel();
  loadGraphDropdown();
  clearStatus();
  updateTypeHint();
}

function closeModal() {
  document.getElementById('modal-kg-send')?.classList.remove('open');
}

function clearStatus() {
  const el = document.getElementById('kg-send-status');
  if (el) { el.textContent = ''; el.className = 'kg-send-status'; }
}

function refreshCountLabel() {
  const el = document.getElementById('kg-send-count');
  if (el) el.textContent = `${_paths.length} file${_paths.length !== 1 ? 's' : ''}`;
}

function updateTypeHint() {
  const idEl   = document.getElementById('kg-node-type-id');
  const hint   = document.getElementById('kg-type-hint');
  if (!idEl || !hint) return;
  const info   = getNodeTypeInfo(idEl.value);
  if (info) {
    hint.innerHTML = `<span class="kg-type-badge">${info.icon} ${info.name}</span> ${escHtml(info.desc)}`;
    hint.hidden = false;
  } else {
    hint.textContent = 'Custom type ID — not one of the built-in node types.';
    hint.hidden = false;
  }
}

async function loadGraphDropdown() {
  const sel = document.getElementById('kg-graph-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const graphs = await listGraphs();
    sel.innerHTML =
      (graphs.length
        ? graphs.map(g =>
            `<option value="${escAttr(g.name)}">${g.name}${g.nodeCount != null ? ` (${g.nodeCount} nodes)` : ''}</option>`
          ).join('')
        : '') +
      '<option value="__new__">＋ Create new graph…</option>';
    if (graphs.length && sel.value === '') sel.selectedIndex = 0;
    toggleNewNameRow();
  } catch {
    sel.innerHTML = '<option value="__new__">＋ Create new graph…</option>';
    setStatus('KG service not reachable — a new graph will be created on send.', 'warn');
    toggleNewNameRow();
  }
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toggleNewNameRow() {
  const sel = document.getElementById('kg-graph-select');
  const row = document.getElementById('kg-new-name-row');
  if (!sel || !row) return;
  row.hidden = sel.value !== '__new__';
}

function setStatus(msg, type = '') {
  const el = document.getElementById('kg-send-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `kg-send-status${type ? ' ' + type : ''}`;
}

// ── Send logic ────────────────────────────────────────────────────────────────
async function doSend() {
  const sel       = document.getElementById('kg-graph-select');
  const newNameEl = document.getElementById('kg-new-graph-name');
  const typeIdEl  = document.getElementById('kg-node-type-id');
  const inclCb    = document.getElementById('kg-incl-content');
  const btn       = document.getElementById('kg-send-btn');

  const isNew       = sel?.value === '__new__';
  const graphName   = isNew ? newNameEl?.value.trim() : sel?.value;
  const typeId      = Math.max(0, parseInt(typeIdEl?.value ?? '1', 10) || 1);
  const inclContent = inclCb?.checked ?? true;
  const typeInfo    = getNodeTypeInfo(typeId);

  if (!graphName) {
    setStatus(isNew ? 'Enter a name for the new graph.' : 'Select a target graph.', 'err');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  clearStatus();
  closeModal();

  // ── Create monitor job ────────────────────────────────────────────────────
  const jobId = `kg-${Date.now()}`;
  addKGJob(jobId, `→ ${graphName}`, _paths.length);

  // Scroll the jobs monitor into view
  document.getElementById('monitor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    if (isNew) {
      appendKGJobStep(jobId, {
        action: 'Create graph',
        file:   graphName,
        status: 'running',
      });
      await createGraph(graphName);
      appendKGJobStep(jobId, {
        action:  'Create graph',
        file:    graphName,
        status:  'ok',
        message: 'New graph created successfully',
      });
    }

    const nodeTypeName = typeInfo ? `${typeInfo.icon} ${typeInfo.name} (type ${typeId})` : `type ${typeId}`;

    for (const path of _paths) {
      appendKGJobStep(jobId, {
        action: `Fetch metadata`,
        file:   path,
        status: 'running',
      });

      let content = '', meta = {};
      try {
        [content, meta] = await Promise.all([
          inclContent ? getMarkdownFile(path) : Promise.resolve(''),
          getMarkdownMeta(path).catch(() => ({})),
        ]);
        appendKGJobStep(jobId, {
          action:  'Fetch metadata',
          file:    path,
          status:  'ok',
          message: `${meta.wordCount ? meta.wordCount + ' words' : ''}${meta.url ? ' · ' + meta.url : ''}`.trim() || undefined,
        });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Fetch metadata', file: path, status: 'err', message: err.message });
        continue;
      }

      appendKGJobStep(jobId, {
        action:  `Upsert node`,
        file:    path,
        status:  'running',
        message: nodeTypeName,
      });

      try {
        const parts    = path.split('/');
        const filename = parts[parts.length - 1];
        const category = parts[0] ?? '';
        await upsertNode(graphName, typeId, path, {
          title:      filename.replace(/\.md$/i, ''),
          category,
          ...(inclContent && content ? { content } : {}),
          ...(meta.url        ? { url:        meta.url        } : {}),
          ...(meta.scraped_at ? { scraped_at: meta.scraped_at } : {}),
          ...(meta.wordCount  ? { word_count: meta.wordCount  } : {}),
        });
        appendKGJobStep(jobId, {
          action:  'Upsert node',
          file:    path,
          status:  'ok',
          message: `saved as ${nodeTypeName}`,
        });
      } catch (err) {
        appendKGJobStep(jobId, { action: 'Upsert node', file: path, status: 'err', message: err.message });
      }
    }

    const job = { completed: 0, failed: 0 };
    // tally from steps
    appendKGJobStep(jobId, {
      action:  'Done',
      file:    '',
      status:  'ok',
      message: `Import finished — graph "${graphName}"`,
    });

    finishKGJob(jobId, 'completed');

    // Notify embedded KG iframe(s) so they refresh their graph list
    _broadcastKGRefresh(graphName);

    // Count actual results from the local job steps to build toast
    const doneCount  = _paths.length;
    toast(`✓ KG import → "${graphName}" — ${doneCount} file${doneCount !== 1 ? 's' : ''} sent`, 'ok');

  } catch (err) {
    appendKGJobStep(jobId, { action: 'Fatal error', file: '', status: 'err', message: err.message });
    finishKGJob(jobId, 'failed');
    toast(`KG import failed: ${err.message}`, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬡ Send Files'; }
  }
}

// ── Cross-frame messaging ─────────────────────────────────────────────────────
function _broadcastKGRefresh(graphName) {
  // Post to embedded KG iframe in the dashboard
  const frame = document.getElementById('kg-frame');
  frame?.contentWindow?.postMessage({ type: 'kg:refresh-graphs', graph: graphName }, '*');
  // Also post to any same-origin KG page open in a separate tab
  try { window.opener?.postMessage({ type: 'kg:refresh-graphs', graph: graphName }, '*'); } catch { /* cross-origin – ignore */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initKGSender() {
  const modal = document.getElementById('modal-kg-send');
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.getElementById('kg-send-close')   ?.addEventListener('click', closeModal);
  document.getElementById('kg-send-cancel')  ?.addEventListener('click', closeModal);
  document.getElementById('kg-send-btn')     ?.addEventListener('click', doSend);
  document.getElementById('kg-graph-select') ?.addEventListener('change', toggleNewNameRow);
  document.getElementById('kg-node-type-id') ?.addEventListener('input',  updateTypeHint);
}


