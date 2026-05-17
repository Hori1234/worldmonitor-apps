import './style.css';
import { SCRAPER_ENDPOINTS } from './endpoints-scraper.js';
import { KG_ENDPOINTS }      from './endpoints-kg.js';
import { createExplorer }    from './explorer.js';

// ── Top-level pane switching ──────────────────────────────────────────────────

document.querySelectorAll('.app-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.pane;
    document.querySelectorAll('.app-nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.app-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`pane-${target}`)?.classList.add('active');
  });
});

// ── Bootstrap both explorers ──────────────────────────────────────────────────

createExplorer({
  prefix:    'scraper',
  endpoints: SCRAPER_ENDPOINTS,
  urlPrefix: '/api',
});

createExplorer({
  prefix:    'kg',
  endpoints: KG_ENDPOINTS,
  urlPrefix: '/api/kg',
});
