import { getJob } from './api.js';
import { toast }   from './toast.js';

const POLL_MS = 2000;

// Module-level state
const jobs     = new Map();   // jobId → jobData
const pollers  = new Map();   // jobId → intervalId
const expanded = new Set();   // jobIds with open detail row

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a newly submitted job and start polling it.
 * @param {{ jobId: string, status: string, total: number }} jobData
 */
export function addJob(jobData) {
  const id = jobData.jobId ?? jobData.id;
  jobs.set(id, {
    id,
    status:    jobData.status ?? 'queued',
    total:     jobData.total  ?? 0,
    completed: 0,
    failed:    0,
    results:   [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  renderAll();
  startPolling(id);
}

// ── KG local jobs (no polling — driven by kg-sender) ───────────────────────

/**
 * Register a local-only KG import job with a step log.
 * @param {string} id  Synthetic job id
 * @param {string} label  Human label (e.g. "→ my-graph")
 * @param {number} total  Number of files to process
 */
export function addKGJob(id, label, total) {
  jobs.set(id, {
    id,
    type:      'kg',
    label,
    status:    'running',
    total,
    completed: 0,
    failed:    0,
    steps:     [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  expanded.add(id);   // auto-expand so user sees steps immediately
  renderAll();
}

/**
 * Append a step to a KG job's log and re-render its row.
 * @param {string} id
 * @param {{ file: string, action: string, status: 'running'|'ok'|'err'|'skip', message?: string }} step
 */
export function appendKGJobStep(id, step) {
  const job = jobs.get(id);
  if (!job || job.type !== 'kg') return;
  job.steps.push({ ...step, ts: new Date().toLocaleTimeString() });
  if (step.status === 'ok')  job.completed++;
  if (step.status === 'err') job.failed++;
  job.updatedAt = new Date().toISOString();
  renderRow(id);
  updateCount();
}

/**
 * Mark a KG job as finished.
 * @param {string} id
 * @param {'completed'|'failed'} status
 */
export function finishKGJob(id, status) {
  const job = jobs.get(id);
  if (!job || job.type !== 'kg') return;
  job.status    = status;
  job.updatedAt = new Date().toISOString();
  renderRow(id);
  updateCount();
}

/** Remove completed/failed jobs from the table. */
export function clearFinished() {
  for (const [id, job] of jobs) {
    if (job.status === 'completed' || job.status === 'failed') {
      stopPolling(id);
      jobs.delete(id);
      expanded.delete(id);
    }
  }
  renderAll();
}

/** Set up the expand-button event delegation on the table body. */
export function initMonitor() {
  document.getElementById('jobs-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.expand-btn');
    if (!btn) return;
    const id = btn.dataset.jobId;
    if (!id) return;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderRow(id);
  });
}

// ── Polling ──────────────────────────────────────────────────────────────────

function startPolling(id) {
  if (pollers.has(id)) return;
  poll(id);                                     // immediate first check
  pollers.set(id, setInterval(() => poll(id), POLL_MS));
}

function stopPolling(id) {
  const t = pollers.get(id);
  if (t != null) clearInterval(t);
  pollers.delete(id);
}

async function poll(id) {
  try {
    const data = await getJob(id);
    jobs.set(id, { ...data, id });
    renderRow(id);
    updateCount();
    if (data.status === 'completed' || data.status === 'failed') {
      stopPolling(id);
      if (data.status === 'completed') {
        const label = data.failed > 0
          ? `Job done — ${data.completed} ok, ${data.failed} failed`
          : `Job done — ${data.completed} URL${data.completed !== 1 ? 's' : ''} scraped`;
        toast(label, data.failed > 0 ? 'err' : 'ok');
      }
      document.dispatchEvent(new CustomEvent('scraper:job-done', { detail: { jobId: id } }));
    }
  } catch (err) {
    console.warn(`[monitor] poll failed for ${id}:`, err.message);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAll() {
  const tbody = document.getElementById('jobs-tbody');
  if (!tbody) return;

  if (jobs.size === 0) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="6">No jobs yet — submit one below ↓</td></tr>';
    updateCount();
    return;
  }
  tbody.innerHTML = '';
  for (const id of jobs.keys()) renderRow(id);
  updateCount();
}

function renderRow(id) {
  const job = jobs.get(id);
  if (!job) return;

  const tbody = document.getElementById('jobs-tbody');
  if (!tbody) return;

  if (job.type === 'kg') {
    renderKGRow(job, tbody);
    return;
  }

  // Build progress info
  const done  = (job.completed ?? 0) + (job.failed ?? 0);
  const total = job.total ?? 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const fillCls =
    job.status === 'completed'
      ? job.failed > 0 ? 'mixed' : 'done'
      : '';

  const hasResults = (job.results?.length ?? 0) > 0;
  const isExpanded = expanded.has(id);

  // ── main row ──
  const tr = document.createElement('tr');
  tr.id = `row-${id}`;
  tr.innerHTML = `
    <td class="jobid-cell" title="${id}">${id.slice(0, 8)}…</td>
    <td><span class="status-badge status-${job.status}">${job.status}</span></td>
    <td>
      <div class="prog-wrap">
        <div class="prog-bar">
          <div class="prog-fill ${fillCls}" style="width:${pct}%"></div>
        </div>
        <span class="prog-text">
          ${done}/${total}${job.failed > 0 ? ` <span style="color:var(--err)">(${job.failed} err)</span>` : ''}
        </span>
      </div>
    </td>
    <td class="time-cell">${fmtTime(job.createdAt)}</td>
    <td class="time-cell">${fmtTime(job.updatedAt)}</td>
    <td>
      ${hasResults
        ? `<button class="expand-btn" data-job-id="${id}">${isExpanded ? '▲ Hide' : '▼ Details'}</button>`
        : ''}
    </td>
  `;

  // ── detail/expand row ──
  const expandTr = document.createElement('tr');
  expandTr.id = `expand-${id}`;
  expandTr.className = 'result-row';

  if (isExpanded && hasResults) {
    expandTr.innerHTML = `
      <td colspan="6">
        <div class="result-content">
          <div class="result-grid">
            ${(job.results ?? []).map(buildResultItem).join('')}
          </div>
        </div>
      </td>
    `;
  }

  // Replace or append
  const existing = document.getElementById(`row-${id}`);
  const existingExpand = document.getElementById(`expand-${id}`);

  if (existing) {
    existing.replaceWith(tr);
  } else {
    tbody.appendChild(tr);
  }

  if (existingExpand) {
    existingExpand.replaceWith(expandTr);
  } else {
    tr.after(expandTr);
  }
}

function buildResultItem(r) {
  return `
    <div class="result-item ${r.status}">
      <span class="ri-status">${r.status}</span>
      <div class="ri-body">
        <span class="ri-url">${escHtml(r.url)}</span>
        ${r.file  ? `<span class="ri-file">📄 ${escHtml(r.file)}</span>` : ''}
        ${r.error ? `<span class="ri-err">⚠ ${escHtml(r.error)}</span>`  : ''}
      </div>
      ${r.method ? `<span class="ri-method">${r.method}</span>` : ''}
    </div>
  `;
}

// ── KG job rendering ─────────────────────────────────────────────────────────

function renderKGRow(job, tbody) {
  const id        = job.id;
  const done      = (job.completed ?? 0) + (job.failed ?? 0);
  const total     = job.total ?? 0;
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0;
  const isExpanded = expanded.has(id);
  const fillCls   = job.status === 'completed'
    ? (job.failed > 0 ? 'mixed' : 'done') : '';

  const tr = document.createElement('tr');
  tr.id = `row-${id}`;
  tr.innerHTML = `
    <td class="jobid-cell" title="KG Import">
      <span class="kg-job-badge">⬡ KG</span>
    </td>
    <td><span class="status-badge status-${job.status}">${job.status}</span></td>
    <td>
      <div class="prog-wrap">
        <div class="prog-bar">
          <div class="prog-fill ${fillCls}" style="width:${pct}%"></div>
        </div>
        <span class="prog-text">
          ${done}/${total}${job.failed > 0 ? ` <span style="color:var(--err)">(${job.failed} err)</span>` : ''}
        </span>
      </div>
    </td>
    <td class="time-cell">${fmtTime(job.createdAt)}</td>
    <td class="time-cell">${fmtTime(job.updatedAt)}</td>
    <td>
      <button class="expand-btn" data-job-id="${id}">${isExpanded ? '▲ Hide' : '▼ Details'}</button>
    </td>
  `;

  const expandTr = document.createElement('tr');
  expandTr.id = `expand-${id}`;
  expandTr.className = 'result-row';

  if (isExpanded) {
    expandTr.innerHTML = `
      <td colspan="6">
        <div class="kg-job-details">
          <div class="kg-job-details-header">
            <span class="kg-job-label">⬡ KG Import ${escHtml(job.label ?? '')}</span>
            <span class="kg-job-summary">${job.completed} sent · ${job.failed} failed · ${total} total</span>
          </div>
          <div class="kg-step-log">
            ${(job.steps ?? []).map(buildStepRow).join('') || '<div class="kg-step kg-step-pending"><span class="kg-step-icon">⌛</span><span class="kg-step-text">Waiting for first step…</span></div>'}
          </div>
        </div>
      </td>
    `;
  }

  const existing       = document.getElementById(`row-${id}`);
  const existingExpand = document.getElementById(`expand-${id}`);

  if (existing) {
    existing.replaceWith(tr);
  } else {
    tbody.appendChild(tr);
  }
  if (existingExpand) {
    existingExpand.replaceWith(expandTr);
  } else {
    tr.after(expandTr);
  }
}

const STEP_ICON = { ok: '✓', err: '✗', running: '⟳', skip: '–', pending: '⌛' };

function buildStepRow(s) {
  const icon = STEP_ICON[s.status] ?? '·';
  return `
    <div class="kg-step kg-step-${s.status}">
      <span class="kg-step-ts">${s.ts ?? ''}</span>
      <span class="kg-step-icon">${icon}</span>
      <span class="kg-step-action">${escHtml(s.action ?? '')}</span>
      <span class="kg-step-file">${escHtml(s.file ?? '')}</span>
      ${s.message ? `<span class="kg-step-msg">${escHtml(s.message)}</span>` : ''}
    </div>
  `;
}


function updateCount() {
  const el = document.getElementById('jobs-count');
  if (el) el.textContent = `${jobs.size} job${jobs.size !== 1 ? 's' : ''}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

function escHtml(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
