import { getSettings, patchSettings } from './api.js';
import { toast } from './toast.js';

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_KEYS = {
  scraper: 'wm:settings:scraper',
  nc:      'wm:settings:nc',
  kg:      'wm:settings:kg',
};

function lsLoad(svc) {
  try { return JSON.parse(localStorage.getItem(LS_KEYS[svc]) ?? '{}'); }
  catch { return {}; }
}

function lsSave(svc, data) {
  localStorage.setItem(LS_KEYS[svc], JSON.stringify(data));
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function populateForm(formEl, data) {
  if (!formEl) return;
  for (const [key, value] of Object.entries(data)) {
    const el = formEl.querySelector(`[name="${key}"]`);
    if (!el || value == null) continue;
    if (el.type === 'checkbox') el.checked = value === true || value === 'true';
    else el.value = value;
  }
}

function readForm(formEl) {
  if (!formEl) return {};
  const result = {};
  formEl.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') result[el.name] = el.checked;
    else if (!el.value.includes('(masked)')) result[el.name] = el.value.trim();
  });
  return result;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.stab').forEach((b) =>
    b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.stab-pane').forEach((p) =>
    p.classList.toggle('active', p.id === `stab-${tab}`));
}

// ── Public init ───────────────────────────────────────────────────────────────

export function initSettings() {
  document.getElementById('settings-tab-btn')
    ?.addEventListener('click', openSettings);
  document.getElementById('settings-close-btn')
    ?.addEventListener('click', closeSettings);
  document.getElementById('settings-overlay')
    ?.addEventListener('click', closeSettings);
  document.getElementById('settings-save-btn')
    ?.addEventListener('click', saveAll);
  document.getElementById('settings-reset-btn')
    ?.addEventListener('click', loadAll);
  document.getElementById('test-firecrawl-btn')
    ?.addEventListener('click', testFirecrawlKey);

  document.getElementById('test-scraper-server-btn')  ?.addEventListener('click', testScraperServer);
  document.getElementById('test-scraper-output-btn')   ?.addEventListener('click', testScraperOutput);
  document.getElementById('test-scraper-scraping-btn') ?.addEventListener('click', testScraperScraping);
  document.getElementById('test-scraper-proxy-btn')    ?.addEventListener('click', testScraperProxy);

  document.getElementById('test-nc-server-btn')   ?.addEventListener('click', testNcServer);
  document.getElementById('test-nc-storage-btn')  ?.addEventListener('click', testNcStorage);
  document.getElementById('test-nc-smtp-btn')     ?.addEventListener('click', testNcSmtp);
  document.getElementById('test-nc-webhook-btn')  ?.addEventListener('click', testNcWebhook);

  document.getElementById('test-kg-server-btn')   ?.addEventListener('click', testKgServer);
  document.getElementById('test-kg-data-btn')     ?.addEventListener('click', testKgData);

  document.getElementById('browse-scraper-output-btn')
    ?.addEventListener('click', () => browseDir('[name="OUTPUT_DIR"]', 'settings-form'));
  document.getElementById('browse-kg-data-btn')
    ?.addEventListener('click', () => browseDir('[name="KG_DATA_DIR"]', 'settings-form-kg'));

  document.querySelectorAll('.stab').forEach((btn) =>
    btn.addEventListener('click', () => switchTab(btn.dataset.stab)));
}

// ── OS Directory Picker ─────────────────────────────────────────────────────────

async function browseDir(inputSelector, formId) {
  const port = fv('PORT') || '3737';
  const input = document.querySelector(`#${formId} ${inputSelector}`);
  const initial = input?.value?.trim() || '';
  const params = initial ? `?initial=${encodeURIComponent(initial)}` : '';
  try {
    const r = await fetch(`http://localhost:${port}/api/browse-directory${params}`);
    const d = await r.json();
    if (d.ok && d.path && input) {
      input.value = d.path;
    }
  } catch (err) {
    toast(`Directory picker failed: ${err.message}`, 'err');
  }
}

// ── Open / close ──────────────────────────────────────────────────────────────

function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.add('open');
  loadAll();
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('open');
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadAll() {
  // NC and KG: localStorage only
  populateForm(document.getElementById('settings-form-nc'), lsLoad('nc'));
  populateForm(document.getElementById('settings-form-kg'), lsLoad('kg'));

  // Scraper: localStorage first, then overlay with live server values
  const scraperForm = document.getElementById('settings-form');
  if (!scraperForm) return;
  populateForm(scraperForm, lsLoad('scraper'));
  scraperForm.classList.add('loading');
  try {
    const s = await getSettings();
    populateForm(scraperForm, s);
  } catch (err) {
    toast(`Could not reach scraper service: ${err.message}`, 'err');
  } finally {
    scraperForm.classList.remove('loading');
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveAll() {
  // NC + KG: localStorage only
  lsSave('nc', readForm(document.getElementById('settings-form-nc')));
  lsSave('kg', readForm(document.getElementById('settings-form-kg')));

  // Scraper: localStorage + server API
  const scraperData = readForm(document.getElementById('settings-form'));
  lsSave('scraper', scraperData);
  try {
    await patchSettings(scraperData);
  } catch (err) {
    toast(`Scraper API save failed: ${err.message}`, 'err');
  }

  // Show "Settings saved" in footer, then slide the panel out
  const msg = document.getElementById('settings-save-msg');
  if (msg) {
    msg.textContent = '✓ Settings saved';
    msg.classList.add('visible');
  }
  setTimeout(() => {
    closeSettings();
    // Fade the message out after panel starts closing
    setTimeout(() => {
      if (msg) { msg.classList.remove('visible'); }
    }, 350);
  }, 900);
}

// ── Firecrawl key test ────────────────────────────────────────────────────────

async function testFirecrawlKey() {
  const keyEl = document.querySelector('[name="FIRECRAWL_API_KEY"]');
  const key   = keyEl?.value?.trim();
  const btn   = document.getElementById('test-firecrawl-btn');
  const prev  = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  try {
    const port = fv('PORT') || '3737';
    // If a new (non-masked) key was typed, send it; otherwise let the server use its own key
    const body = (key && !key.includes('(masked)')) ? { apiKey: key } : {};
    const r = await fetch(`http://localhost:${port}/api/test-firecrawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setResult('test-scraper-apikey-result', d.ok, d.ok ? d.message : d.error);
  } catch (err) {
    setResult('test-scraper-apikey-result', false, `Request failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

// ── Section test helpers ──────────────────────────────────────────────────────

function setResult(id, ok, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? `✓ ${msg}` : `✗ ${msg}`;
  el.className = `section-test-result ${ok ? 'ok' : 'err'}`;
}

async function runTest(btnId, resultId, fn) {
  const btn = document.getElementById(btnId);
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  try {
    const msg = await fn();
    setResult(resultId, true, msg);
  } catch (err) {
    setResult(resultId, false, err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

function fv(name, formId = 'settings-form') {
  return document.getElementById(formId)?.querySelector(`[name="${name}"]`)?.value?.trim() ?? '';
}

// ── Scraper tests ─────────────────────────────────────────────────────────────

function testScraperServer() {
  return runTest('test-scraper-server-btn', 'test-scraper-server-result', async () => {
    const port = fv('PORT') || '3737';
    const r = await fetch(`http://localhost:${port}/api/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `Scraper online · uptime ${Math.round(d.uptime)}s`;
  });
}

function testScraperOutput() {
  return runTest('test-scraper-output-btn', 'test-scraper-output-result', async () => {
    const port = fv('PORT') || '3737';
    const r = await fetch(`http://localhost:${port}/api/markdown/tree`);
    if (!r.ok) throw new Error(`Cannot read output directory (HTTP ${r.status})`);
    return 'Output directory accessible';
  });
}

function testScraperScraping() {
  return runTest('test-scraper-scraping-btn', 'test-scraper-scraping-result', async () => {
    const port = fv('PORT') || '3737';
    const r = await fetch(`http://localhost:${port}/api/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `Service running · ${d.status}`;
  });
}

function testScraperProxy() {
  return runTest('test-scraper-proxy-btn', 'test-scraper-proxy-result', async () => {
    const port = fv('PORT') || '3737';
    const r = await fetch(`http://localhost:${port}/api/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'Scraper service reachable (proxy requires backend validation)';
  });
}

// ── Notification Center tests ─────────────────────────────────────────────────

function testNcServer() {
  return runTest('test-nc-server-btn', 'test-nc-server-result', async () => {
    const port = fv('NC_PORT', 'settings-form-nc') || '3003';
    const r = await fetch(`http://localhost:${port}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `NC online · uptime ${Math.round(d.uptime)}s · ${d.unread} unread`;
  });
}

function testNcStorage() {
  return runTest('test-nc-storage-btn', 'test-nc-storage-result', async () => {
    const port = fv('NC_PORT', 'settings-form-nc') || '3003';
    const r = await fetch(`http://localhost:${port}/notifications?limit=1`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `Storage OK · ${d.total ?? 0} notification(s) stored`;
  });
}

function testNcSmtp() {
  return runTest('test-nc-smtp-btn', 'test-nc-smtp-result', async () => {
    const port  = fv('NC_PORT', 'settings-form-nc') || '3003';
    const form  = document.getElementById('settings-form-nc');
    const host  = form?.querySelector('[name="EMAIL_SMTP_HOST"]')?.value?.trim();
    const smtpPort = form?.querySelector('[name="EMAIL_SMTP_PORT"]')?.value?.trim() || '587';
    const user  = form?.querySelector('[name="EMAIL_SMTP_USER"]')?.value?.trim();
    const pass  = form?.querySelector('[name="EMAIL_SMTP_PASS"]')?.value?.trim();
    if (!host || !user || !pass) throw new Error('Fill in SMTP host, user, and password first');
    const r = await fetch(`http://localhost:${port}/test-smtp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: smtpPort, user, pass }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error ?? 'SMTP verification failed');
    return d.message ?? 'SMTP connection verified';
  });
}

function testNcWebhook() {
  return runTest('test-nc-webhook-btn', 'test-nc-webhook-result', async () => {
    const port = fv('NC_PORT', 'settings-form-nc') || '3003';
    const r = await fetch(`http://localhost:${port}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'NC service reachable';
  });
}

// ── Knowledge Graph tests ─────────────────────────────────────────────────────

function testKgServer() {
  return runTest('test-kg-server-btn', 'test-kg-server-result', async () => {
    const port = fv('KG_PORT', 'settings-form-kg') || '3738';
    const r = await fetch(`http://localhost:${port}/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return `KG online · uptime ${Math.round(d.uptime)}s · ${d.totalGraphs} graph(s)`;
  });
}

function testKgData() {
  return runTest('test-kg-data-btn', 'test-kg-data-result', async () => {
    const port = fv('KG_PORT', 'settings-form-kg') || '3738';
    const r = await fetch(`http://localhost:${port}/graphs`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const count = Array.isArray(d) ? d.length : (d.graphs?.length ?? 0);
    return `Data accessible · ${count} graph(s) on disk`;
  });
}

