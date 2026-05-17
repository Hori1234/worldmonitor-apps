/**
 * main.js — Bootstrap for Notification Center Component
 */

import './style.css';
import { initNotifications }    from './notifications.js';
import { initProfileSelector, getCurrentProfileId } from './profile-selector.js';
import { initCanvas, loadCanvasState, getCanvasState, clearCanvas, removeNode, updateEdgeMeta } from './canvas.js';
import { initNodePalette }      from './node-palette.js';
import { initNodeConfig, openFlyout, initEdgeModal, openEdgeModal } from './node-config.js';
import { initObjectsBrowser }   from './objects-browser.js';
import { initEdgeRuleBuilder }  from './edge-rule-builder.js';
import { connectWS }            from './api.js';
import * as api                 from './api.js';
import { toast }                from './toast.js';

// ── Tab navigation ────────────────────────────────────────────────────────────

function initTabNav() {
  const btns  = document.querySelectorAll('.nav-btn[data-tab]');
  const pages = document.querySelectorAll('.tab-page');

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((b)  => b.classList.remove('active'));
      pages.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
    });
  });
}

// ── Health polling ─────────────────────────────────────────────────────────────

function initHealthPolling() {
  const dot = document.getElementById('health-indicator');
  const poll = async () => {
    try {
      const res = await api.health();
      dot?.classList.toggle('online',  !!res.ok);
      dot?.classList.toggle('offline', !res.ok);
    } catch {
      dot?.classList.remove('online');
      dot?.classList.add('offline');
    }
  };
  poll();
  setInterval(poll, 15_000);
}

// ── Canvas + profile integration ──────────────────────────────────────────────

const _lsKey = (id) => `nc:canvas:${id}`;

/** Load from service; fall back to localStorage if service is offline. */
async function _loadCanvas(profileId) {
  if (!profileId) { clearCanvas(); return; }
  try {
    const res = await api.getCanvas(profileId);
    if (res.ok && res.canvas) {
      loadCanvasState(res.canvas);
      return;
    }
  } catch { /* service offline */ }
  // localStorage fallback
  try {
    const stored = localStorage.getItem(_lsKey(profileId));
    if (stored) loadCanvasState(JSON.parse(stored));
  } catch { /* corrupt data */ }
}

/** Save to service AND localStorage. */
async function _saveCanvas(profileId) {
  if (!profileId) { toast('No profile selected', 'warn'); return; }
  const state = getCanvasState();

  // Always persist to localStorage immediately
  try { localStorage.setItem(_lsKey(profileId), JSON.stringify(state)); } catch { /* quota */ }

  // Also push to service
  try {
    const res = await api.saveCanvas(profileId, state);
    if (!res.ok) throw new Error(res.error ?? 'Save failed');
    toast('Canvas saved', 'success');
  } catch (e) {
    toast(`Saved locally (service: ${e.message})`, 'warn');
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function init() {
  initTabNav();
  initHealthPolling();
  initNotifications();
  initObjectsBrowser();
  initEdgeRuleBuilder();
  initNodePalette();

  // Canvas + node config (depends on profile)
  initCanvas({
    onNodeOpen:   (node) => openFlyout(node),
    onDelete:     () => {},
    onEdgeCreate: (edge) => openEdgeModal(edge, (meta) => updateEdgeMeta(edge.id, meta)),
  });

  initNodeConfig({
    onDelete: (id) => removeNode(id),
  });

  initEdgeModal();

  // Profile selector — loads canvas when profile changes
  initProfileSelector(async (profileId) => {
    await _loadCanvas(profileId);
  });

  // Canvas save / clear buttons
  document.getElementById('canvas-save-btn')?.addEventListener('click', async () => {
    await _saveCanvas(getCurrentProfileId());
  });

  document.getElementById('canvas-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear canvas?')) clearCanvas();
  });

  // WebSocket
  connectWS(() => {
    console.log('[nc] WebSocket connected');
  });
}

document.addEventListener('DOMContentLoaded', init);
