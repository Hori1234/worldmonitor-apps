import { getSettings, patchSettings } from './api.js';
import { toast } from './toast.js';

// ── Public init ───────────────────────────────────────────────────────────────

export function initSettings() {
  const tabBtn = document.getElementById('settings-tab-btn');
  tabBtn?.addEventListener('click', () => openSettings());

  document.getElementById('settings-close-btn')
    ?.addEventListener('click', closeSettings);
  document.getElementById('settings-overlay')
    ?.addEventListener('click', closeSettings);
  document.getElementById('settings-save-btn')
    ?.addEventListener('click', saveSettings);
  document.getElementById('settings-reset-btn')
    ?.addEventListener('click', loadSettings);

  // Test Firecrawl key
  document.getElementById('test-firecrawl-btn')
    ?.addEventListener('click', testFirecrawlKey);
}

// ── Open / close ──────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById('settings-modal')?.classList.add('open');
  loadSettings();
}

function closeSettings() {
  document.getElementById('settings-modal')?.classList.remove('open');
}

// ── Load & save ───────────────────────────────────────────────────────────────

async function loadSettings() {
  const form = document.getElementById('settings-form');
  if (!form) return;
  form.classList.add('loading');
  try {
    const s = await getSettings();
    for (const [key, value] of Object.entries(s)) {
      const el = form.querySelector(`[name="${key}"]`);
      if (el) el.value = value;
    }
  } catch (err) {
    toast(`Could not load settings: ${err.message}`, 'err');
  } finally {
    form.classList.remove('loading');
  }
}

async function saveSettings() {
  const form = document.getElementById('settings-form');
  if (!form) return;

  const updates = {};
  form.querySelectorAll('[name]').forEach((el) => {
    const val = el.value.trim();
    // Don't send masked API key back
    if (!val.includes('(masked)')) updates[el.name] = val;
  });

  try {
    await patchSettings(updates);
    toast('Settings saved', 'ok');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'err');
  }
}

async function testFirecrawlKey() {
  const keyEl = document.querySelector('[name="FIRECRAWL_API_KEY"]');
  const key   = keyEl?.value?.trim();
  if (!key || key.includes('(masked)')) {
    toast('Enter your Firecrawl API key first', 'err');
    return;
  }
  const btn = document.getElementById('test-firecrawl-btn');
  if (btn) btn.textContent = 'Testing…';
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
    });
    if (r.ok) {
      toast('Firecrawl key is valid ✓', 'ok');
    } else {
      toast(`Firecrawl key invalid (${r.status})`, 'err');
    }
  } catch (err) {
    toast(`Test failed: ${err.message}`, 'err');
  } finally {
    if (btn) btn.textContent = 'Test Key';
  }
}
