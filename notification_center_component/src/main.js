/**
 * main.js — Bootstrap for Notification Center Component
 */

import './style.css';
import { initNotifications }    from './notifications.js';
import { initProfileSelector, getCurrentProfileId } from './profile-selector.js';
import { initCanvas, loadCanvasState, getCanvasState, clearCanvas, removeNode, updateEdgeMeta, updateNodeData, getAggregatedPayload, triggerTestNodes, setActiveProfile } from './canvas.js';
import { initNodePalette }      from './node-palette.js';
import { initNodeConfig, openFlyout, initEdgeModal, openEdgeModal } from './node-config.js';
import { initObjectsBrowser }   from './objects-browser.js';
import { initEdgeRuleBuilder, syncEdgeRuleNode, navigateToRule, refreshInputConditions }  from './edge-rule-builder.js';
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

// ── Edge rule sync ────────────────────────────────────────────────────────────

let _syncingRules = false;

async function _syncEdgeRuleNodes() {
  if (_syncingRules) return;
  _syncingRules = true;
  try {
    const state = getCanvasState();
    for (const node of state.nodes) {
      if (node.kind !== 'edgeRule') continue;
      const ruleId = await syncEdgeRuleNode(node.id, node.data);
      if (ruleId && ruleId !== node.data._ruleId) {
        updateNodeData(node.id, { _ruleId: ruleId });
      }
    }
  } finally {
    _syncingRules = false;
  }
}

/** Load from service; fall back to localStorage if service is offline. */
async function _loadCanvas(profileId) {
  if (!profileId) { clearCanvas(); return; }
  try {
    const res = await api.getCanvas(profileId);
    if (res.ok && res.canvas) {
      loadCanvasState(res.canvas);
      await _syncEdgeRuleNodes();
      return;
    }
  } catch { /* service offline */ }
  // localStorage fallback
  try {
    const stored = localStorage.getItem(_lsKey(profileId));
    if (stored) loadCanvasState(JSON.parse(stored));
  } catch { /* corrupt data */ }
  await _syncEdgeRuleNodes();
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

/** Silent auto-save: no toast, used for debounced saves. */
async function _autoSave(profileId) {
  if (!profileId) return;
  const state = getCanvasState();
  try { localStorage.setItem(_lsKey(profileId), JSON.stringify(state)); } catch { /* quota */ }
  try {
    const res = await api.saveCanvas(profileId, state);
    if (!res.ok) throw new Error(res.error);
  } catch { /* silent */ }
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
    onEdgeCreate: (edge) => {
      const state            = getCanvasState();
      const fromNode         = state.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode           = state.nodes.find((n) => n.id === edge.toNodeId);
      const aggregatedPayload = getAggregatedPayload(edge.fromNodeId, state.nodes, state.edges);
      openEdgeModal(edge, { fromNode, toNode, aggregatedPayload }, (meta) => updateEdgeMeta(edge.id, meta));
    },
    onEdgeEdit: (edgeId) => {
      const state            = getCanvasState();
      const edge             = state.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const fromNode         = state.nodes.find((n) => n.id === edge.fromNodeId);
      const toNode           = state.nodes.find((n) => n.id === edge.toNodeId);
      const aggregatedPayload = getAggregatedPayload(edge.fromNodeId, state.nodes, state.edges);
      openEdgeModal(edge, { fromNode, toNode, aggregatedPayload }, (meta) => updateEdgeMeta(edgeId, meta));
    },
  });

  initNodeConfig({
    onDelete: (id) => removeNode(id),
  });

  initEdgeModal();

  // Profile selector — loads canvas when profile changes
  initProfileSelector(async (profileId) => {
    setActiveProfile(profileId);
    await _loadCanvas(profileId);
  });

  // Canvas save / clear / test-trigger buttons
  document.getElementById('canvas-save-btn')?.addEventListener('click', async () => {
    await _saveCanvas(getCurrentProfileId());
  });

  document.getElementById('canvas-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear canvas?')) clearCanvas();
  });

  document.getElementById('canvas-test-trigger-btn')?.addEventListener('click', () => {
    triggerTestNodes();
  });

  // WebSocket
  connectWS(() => {
    console.log('[nc] WebSocket connected');
  });

  // Auto-save canvas after every change (debounced 1.5 s)
  let _autoSaveTimer = null;
  document.addEventListener('nc:canvas:change', () => {
    refreshInputConditions();
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
      _autoSave(getCurrentProfileId());
      if (!_syncingRules) _syncEdgeRuleNodes();
    }, 1500);
  });

  // Navigate to edge rule tab from canvas jump button
  document.addEventListener('nc:canvas:navigateToRule', (e) => {
    navigateToRule(e.detail?.ruleId ?? null);
  });

  // Patch canvas node when its linked rule is saved in the Edge Rules Editor
  document.addEventListener('nc:rules:ruleUpdated', (e) => {
    const rule = e.detail?.rule;
    if (!rule) return;
    const state = getCanvasState();
    const node  = state.nodes.find((n) => n.kind === 'edgeRule' && n.data._ruleId === rule.id);
    if (!node) return;
    const patch = {};
    if (rule.name)                                   patch.ruleName = rule.name;
    if (rule.trigger?.icmType)                       patch.icmType  = rule.trigger.icmType;
    if (rule.trigger?.threshold?.count  != null)     patch.count    = rule.trigger.threshold.count;
    if (rule.trigger?.threshold?.windowMs != null)   patch.windowMs = rule.trigger.threshold.windowMs;
    if (rule.trigger?.inputs  != null)               patch.inputs   = rule.trigger.inputs;
    if (rule.trigger?.outputs != null)               patch.outputs  = rule.trigger.outputs;
    updateNodeData(node.id, patch);
  });
}

document.addEventListener('DOMContentLoaded', init);
