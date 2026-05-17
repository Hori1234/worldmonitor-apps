import { hl }               from './highlight.js';
import { apiBase, submitScrapeJob } from './api.js';
import { addJob }            from './monitor.js';
import { toast }             from './toast.js';

// ── State ────────────────────────────────────────────────────────────────────

/** Last valid payload — shared with the Preview tab. */
let currentPayload = null;

// ── Init ─────────────────────────────────────────────────────────────────────

export function initBuilder() {
  addUrlRow();   // start with one empty row

  document.getElementById('add-row-btn')
    .addEventListener('click', addUrlRow);

  document.getElementById('builder-run-btn')
    .addEventListener('click', runBuilder);

  document.getElementById('raw-run-btn')
    .addEventListener('click', runRaw);

  document.getElementById('fmt-btn')
    .addEventListener('click', formatRaw);

  document.getElementById('clr-btn')
    .addEventListener('click', () => {
      document.getElementById('raw-input').value = '';
      setCode('raw-code',     '', 'json');
      setCode('curl-code',    'Build a request in the Builder or Raw JSON tab first.', 'bash');
      setCode('ps-code',      '', 'powershell');
      currentPayload = null;
    });

  document.getElementById('raw-input')
    .addEventListener('input', (e) => syncRaw(e.target.value));
}

// ── URL rows ─────────────────────────────────────────────────────────────────

function addUrlRow() {
  const container = document.getElementById('url-rows');

  const row = document.createElement('div');
  row.className = 'url-row';
  row.innerHTML = `
    <input type="url"  class="url-inp" placeholder="https://example.com/article" />
    <input type="text" class="cat-inp" placeholder="Category" />
    <button class="rm-btn" title="Remove row">×</button>
  `;

  row.querySelector('.rm-btn').addEventListener('click', () => {
    if (container.children.length > 1) row.remove();
    syncBuilder();
  });

  row.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', syncBuilder),
  );

  container.appendChild(row);
  syncBuilder();
}

function getBuilderJobs() {
  return Array.from(document.querySelectorAll('.url-row'))
    .map((row) => ({
      url:      row.querySelector('.url-inp').value.trim(),
      category: row.querySelector('.cat-inp').value.trim(),
    }))
    .filter((j) => j.url);
}

// ── Sync helpers ─────────────────────────────────────────────────────────────

/** Rebuild previews from the builder rows. */
function syncBuilder() {
  const jobs    = getBuilderJobs();
  const payload = jobs.length ? { jobs } : null;
  const json    = JSON.stringify(payload ?? {}, null, 2);

  setCode('builder-code', json, 'json');
  currentPayload = payload;
  updateCommandPreviews(payload);
}

/** Rebuild previews from the raw textarea. */
function syncRaw(text) {
  if (!text.trim()) {
    setCode('raw-code', '', 'json');
    currentPayload = null;
    updateCommandPreviews(null);
    return;
  }
  try {
    const parsed = JSON.parse(text);
    setCode('raw-code', JSON.stringify(parsed, null, 2), 'json');
    currentPayload = parsed;
    updateCommandPreviews(parsed);
  } catch {
    document.getElementById('raw-code').innerHTML =
      '<span style="color:var(--err)">Invalid JSON</span>';
  }
}

function updateCommandPreviews(payload) {
  const base = apiBase();

  if (!payload) {
    setCode('curl-code', 'Build a request in the Builder or Raw JSON tab first.', 'bash');
    setCode('ps-code',   '', 'powershell');
    return;
  }

  const compact = JSON.stringify(payload);
  const pretty  = JSON.stringify(payload, null, 2);

  const curlCmd =
    `curl.exe -X POST ${base}/api/scrape \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '${compact}'`;

  const psCmd =
    `$body = @'\n${pretty}\n'@\n\n` +
    `Invoke-RestMethod -Uri "${base}/api/scrape" \`\n` +
    `  -Method POST \`\n` +
    `  -ContentType "application/json" \`\n` +
    `  -Body $body`;

  setCode('curl-code', curlCmd,  'bash');
  setCode('ps-code',   psCmd,    'powershell');
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runBuilder() {
  const jobs = getBuilderJobs();
  if (!jobs.length) { toast('Add at least one URL', 'err'); return; }
  await dispatch(jobs, 'builder-run-btn');
}

async function runRaw() {
  const raw = document.getElementById('raw-input').value.trim();
  if (!raw) { toast('Enter a JSON payload first', 'err'); return; }
  let payload;
  try { payload = JSON.parse(raw); }
  catch { toast('Invalid JSON', 'err'); return; }

  if (!Array.isArray(payload?.jobs) || !payload.jobs.length) {
    toast('"jobs" must be a non-empty array', 'err');
    return;
  }
  await dispatch(payload.jobs, 'raw-run-btn');
}

async function dispatch(jobs, btnId) {
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const result = await submitScrapeJob(jobs);
    addJob(result);
    toast(`Job ${result.jobId.slice(0, 8)}… queued — ${result.total} URL(s)`, 'ok');
    document.getElementById('monitor-panel')?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast(`Submit failed: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ── Format raw JSON ───────────────────────────────────────────────────────────

function formatRaw() {
  const ta = document.getElementById('raw-input');
  try {
    const pretty = JSON.stringify(JSON.parse(ta.value), null, 2);
    ta.value = pretty;
    syncRaw(pretty);
    toast('Formatted', 'ok');
  } catch {
    toast('Invalid JSON — cannot format', 'err');
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function setCode(elId, code, lang) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = code ? hl(code, lang) : '';
}
