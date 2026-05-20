/**
 * edge-rule-builder.js
 * Two-column layout: rule list on left, form editor on right.
 * Live test log tails edge-rule:fired WS events.
 */

import * as api  from './api.js';
import { toast } from './toast.js';
import { getCanvasState, getAggregatedPayload, updateNodeData } from './canvas.js';

const KIND_ICONS = { market: '📈', news: '📰', polymarket: '🎯', map: '🗺', general: '⚙', edgeRule: '⚡' };

let _rules        = [];
let _activeRuleId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const list     = () => document.getElementById('rules-list');
const form     = () => document.getElementById('rule-form');
const testLog  = () => document.getElementById('rule-test-log');
const ruleSwitch = () => document.getElementById('rule-view-switch');
const emptyMsg = () => document.getElementById('rule-empty');

const fNewBtn  = () => document.getElementById('rule-new-btn');
const fDel     = () => document.getElementById('rule-delete-btn');
const fTest    = () => document.getElementById('rule-test-btn');

const fName    = () => document.getElementById('rule-name');
const fDesc    = () => document.getElementById('rule-desc');
const fIcm     = () => document.getElementById('rule-icm-type');
const fCount   = () => document.getElementById('rule-count');
const fWindow  = () => document.getElementById('rule-window');
const fInputs  = () => document.getElementById('rule-inputs');
const fOutputs = () => document.getElementById('rule-outputs');
const fFField  = () => document.getElementById('rule-filter-field');
const fFOp     = () => document.getElementById('rule-filter-op');
const fFVal    = () => document.getElementById('rule-filter-value');
const fActType = () => document.getElementById('rule-action-type');

// ── Init ──────────────────────────────────────────────────────────────────────

export function initEdgeRuleBuilder() {
  fNewBtn()?.addEventListener('click', _newRule);
  form()?.addEventListener('submit', _onSubmit);
  fDel()?.addEventListener('click',  _onDelete);
  fTest()?.addEventListener('click', _onTest);

  fActType()?.addEventListener('change', _syncActionFields);

  // Live test log from WebSocket
  api.onWS?.('edge-rule:fired', (msg) => {
    _appendLog(`⚡ Rule fired: "${msg.ruleName}" (${msg.icmType}) count=${msg.count}`, true);
  });

  _load();
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function _load() {
  try {
    const res = await api.listRules();
    _rules = res.rules ?? [];
    _renderList();
  } catch {
    toast('Could not load edge rules', 'error');
  }
}

function _renderList() {
  const l = list();
  if (!l) return;

  if (!_rules.length) {
    l.innerHTML = '<li style="padding:8px;font-size:12px;color:var(--text-3)">No rules yet.</li>';
    return;
  }

  l.innerHTML = _rules.map((r) => `
    <li class="rule-item${r.id === _activeRuleId ? ' active' : ''}" data-id="${r.id}">
      <span class="rule-item-dot${r.enabled ? ' enabled' : ''}"></span>
      <span class="rule-item-name">${_esc(r.name)}</span>
      <span class="rule-item-type">${r.trigger?.icmType ?? '*'}</span>
    </li>
  `).join('');

  l.querySelectorAll('.rule-item').forEach((item) => {
    item.addEventListener('click', () => _selectRule(item.dataset.id));
  });
}

function _selectRule(id) {
  _activeRuleId = id;
  const rule = _rules.find((r) => r.id === id);
  if (!rule) return;
  _renderList();
  _populateForm(rule);
}

// ── Form ──────────────────────────────────────────────────────────────────────

function _showForm() {
  form()?.classList.remove('hidden');
  emptyMsg()?.classList.add('hidden');
  testLog()?.classList.add('hidden');
  // Show toggle and reset to Action tab whenever a rule is opened
  const sw = document.getElementById('rule-view-switch');
  sw?.classList.remove('hidden');
  sw?.querySelectorAll('.view-tab').forEach((btn) => {
    btn.onclick = () => _switchRuleView(btn.dataset.view);
  });
  _switchRuleView('action');
}

function _switchRuleView(tab) {
  const isAction = tab === 'action';
  // Action tab: show form body, hide test log
  // Console tab: hide form body, show test log
  form()?.classList.toggle('hidden', !isAction);
  testLog()?.classList.toggle('hidden', isAction);
  document.getElementById('rule-view-switch')?.querySelectorAll('.view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === tab);
  });
}

function _hideForm() {
  form()?.classList.add('hidden');
  document.getElementById('rule-view-switch')?.classList.add('hidden');
  emptyMsg()?.classList.remove('hidden');
}

function _newRule() {
  _activeRuleId = null;
  _renderList();
  fName()   && (fName().value   = '');
  fDesc()   && (fDesc().value   = '');
  fIcm()    && (fIcm().value    = '*');
  fCount()  && (fCount().value  = '1');
  fWindow() && (fWindow().value = '60000');
  fFField() && (fFField().value = '');
  fFOp()    && (fFOp().value    = '');
  fFVal()   && (fFVal().value   = '');
  _syncActionFields();
  _showForm();
  _renderPayloadVarPanel(null);
  _wireBodyTemplatePreviews(null);
  fName()?.focus();
}

function _populateForm(rule) {
  fName().value   = rule.name ?? '';
  fDesc().value   = rule.description ?? '';
  fIcm().value    = rule.trigger?.icmType ?? '*';
  fCount().value  = rule.trigger?.threshold?.count   ?? 1;
  fWindow().value = rule.trigger?.threshold?.windowMs ?? 60000;
  fInputs()  && (fInputs().value  = rule.trigger?.inputs  ?? 1);
  fOutputs() && (fOutputs().value = rule.trigger?.outputs ?? 1);
  fFField().value = rule.trigger?.filter?.field    ?? '';
  fFOp().value    = rule.trigger?.filter?.operator ?? '';
  fFVal().value   = rule.trigger?.filter?.value    ?? '';

  const action = rule.actions?.[0];
  if (action) {
    fActType().value = action.actionType ?? 'email';
    if (action.actionType === 'email') {
      document.getElementById('rule-email-to').value      = (action.to ?? []).join(', ');
      document.getElementById('rule-email-subject').value = action.subject ?? '';
      document.getElementById('rule-email-body').value    = action.bodyTemplate ?? '';
    } else if (action.actionType === 'webhook') {
      document.getElementById('rule-webhook-url').value    = action.url ?? '';
      document.getElementById('rule-webhook-method').value = action.method ?? 'POST';
      document.getElementById('rule-webhook-body').value   = action.bodyTemplate ?? '';
    }
  }
  _syncActionFields();
  _showForm();
  // Render connected-input conditions panel
  _renderInputConditions(rule.id);
}

function _syncActionFields() {
  const type = fActType()?.value ?? 'email';
  document.getElementById('action-email-fields')  ?.classList.toggle('hidden', type !== 'email');
  document.getElementById('action-webhook-fields') ?.classList.toggle('hidden', type !== 'webhook');
}

function _readForm() {
  const filter = (() => {
    const field = fFField()?.value.trim();
    const op    = fFOp()?.value;
    const value = fFVal()?.value.trim();
    if (!field || !op) return null;
    return { field, operator: op, value };
  })();

  const actionType = fActType()?.value ?? 'email';
  let action;
  if (actionType === 'email') {
    action = {
      actionType: 'email',
      to:           (document.getElementById('rule-email-to')?.value ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      subject:      document.getElementById('rule-email-subject')?.value ?? '',
      bodyTemplate: document.getElementById('rule-email-body')?.value    ?? '',
    };
  } else {
    action = {
      actionType:   'webhook',
      url:          document.getElementById('rule-webhook-url')?.value    ?? '',
      method:       document.getElementById('rule-webhook-method')?.value ?? 'POST',
      bodyTemplate: document.getElementById('rule-webhook-body')?.value   ?? '',
    };
  }

  return {
    name:        fName()?.value.trim() ?? '',
    description: fDesc()?.value.trim() ?? '',
    trigger: {
      icmType:  fIcm()?.value ?? '*',
      filter,
      inputs:   parseInt(fInputs()?.value  ?? '1', 10),
      outputs:  parseInt(fOutputs()?.value ?? '1', 10),
      threshold: {
        count:    parseInt(fCount()?.value  ?? '1',     10),
        windowMs: parseInt(fWindow()?.value ?? '60000', 10),
        resetAfterFire: true,
      },
      inputConditions: _readInputConditionsFromDOM(),
    },
    actions: [action],
  };
}

async function _onSubmit(e) {
  e.preventDefault();
  const data = _readForm();
  if (!data.name) { toast('Rule name is required', 'warn'); return; }

  try {
    if (_activeRuleId) {
      const res = await api.updateRule(_activeRuleId, data);
      if (!res.ok) throw new Error(res.error);
      const idx = _rules.findIndex((r) => r.id === _activeRuleId);
      if (idx !== -1) _rules[idx] = res.rule;
      toast('Rule updated', 'success');
      document.dispatchEvent(new CustomEvent('nc:rules:ruleUpdated', { detail: { rule: res.rule } }));
    } else {
      const res = await api.createRule(data);
      if (!res.ok) throw new Error(res.error);
      _rules.push(res.rule);
      _activeRuleId = res.rule.id;
      toast('Rule created', 'success');
      document.dispatchEvent(new CustomEvent('nc:rules:ruleUpdated', { detail: { rule: res.rule } }));
    }
    _renderList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function _onDelete() {
  if (!_activeRuleId) return;
  if (!confirm('Delete this rule?')) return;
  try {
    const res = await api.deleteRule(_activeRuleId);
    if (!res.ok) throw new Error(res.error);
    _rules = _rules.filter((r) => r.id !== _activeRuleId);
    _activeRuleId = null;
    _renderList();
    _hideForm();
    toast('Rule deleted', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function _onTest() {
  if (!_activeRuleId) return;

  // Auto-save current form state so the test reflects unsaved edits
  const data = _readForm();
  try {
    const saveRes = await api.updateRule(_activeRuleId, data);
    if (!saveRes.ok) throw new Error(saveRes.error ?? 'Save failed');
    const idx = _rules.findIndex((r) => r.id === _activeRuleId);
    if (idx !== -1) _rules[idx] = saveRes.rule;
  } catch (err) {
    toast(`Auto-save failed: ${err.message}`, 'error');
    return;
  }

  const payload = { icmType: fIcm()?.value ?? '*', _test: true };
  try {
    const res = await api.testRule(_activeRuleId, payload);
    _switchRuleView('console');
    testLog().innerHTML = (res.log ?? []).map((entry) => `
      <div class="test-log-entry${entry.msg.includes('FIRE') ? ' fire' : ''}">
        [${entry.ts?.slice(11, 19) ?? ''}] ${_esc(entry.msg)}
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function _appendLog(msg, isFire = false) {
  const log = testLog();
  if (!log || log.classList.contains('hidden')) return;
  const el = document.createElement('div');
  el.className = `test-log-entry${isFire ? ' fire' : ''}`;
  el.textContent = `[live] ${msg}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ── Canvas integration ─────────────────────────────────────────────────────────

/**
 * Called from canvas when an edgeRule node is synced.
 * If the node already has a _ruleId, pushes any changed data to the service.
 * Does NOT auto-create a rule — the user must assign one via the config modal.
 * Returns the ruleId (unchanged) or null if unlinked.
 */
export async function syncEdgeRuleNode(nodeId, nodeData) {
  // Unlinked — only create a stub when the user explicitly chose "(auto-create stub)"
  if (!nodeData._ruleId) {
    if (!nodeData._createStub) return null;

    const stubData = {
      name:        nodeData.ruleName || 'Edge Rule (Canvas)',
      description: 'Created from canvas builder.',
      trigger: {
        icmType:  nodeData.icmType || '*',
        inputs:   nodeData.inputs  != null ? Number(nodeData.inputs)  : 1,
        outputs:  nodeData.outputs != null ? Number(nodeData.outputs) : 1,
        threshold: {
          count:          nodeData.count    ? Number(nodeData.count)    : 1,
          windowMs:       nodeData.windowMs ? Number(nodeData.windowMs) : 60000,
          resetAfterFire: true,
        },
      },
      actions: [],
    };
    try {
      const res = await api.createRule(stubData);
      if (res.ok) {
        _rules.push(res.rule);
        _renderList();
        return res.rule.id; // main.js will write _ruleId back to the node
      }
    } catch { /* service offline — will retry on next save */ }
    return null;
  }

  let rule = _rules.find((r) => r.id === nodeData._ruleId);
  if (!rule) {
    try {
      const res = await api.listRules();
      _rules = res.rules ?? [];
      _renderList();
      rule = _rules.find((r) => r.id === nodeData._ruleId);
    } catch { /* offline */ }
  }

  // Push canvas node data → rule if anything changed
  if (rule) {
    const desiredName    = nodeData.ruleName  || rule.name;
    const desiredIcm     = nodeData.icmType   || rule.trigger?.icmType || '*';
    const desiredCount   = nodeData.count   != null ? Number(nodeData.count)   : (rule.trigger?.threshold?.count   ?? 1);
    const desiredWindow  = nodeData.windowMs != null ? Number(nodeData.windowMs) : (rule.trigger?.threshold?.windowMs ?? 60000);
    const desiredInputs  = nodeData.inputs  != null ? Number(nodeData.inputs)  : (rule.trigger?.inputs  ?? 1);
    const desiredOutputs = nodeData.outputs != null ? Number(nodeData.outputs) : (rule.trigger?.outputs ?? 1);

    const changed =
      desiredName    !== rule.name ||
      desiredIcm     !== rule.trigger?.icmType ||
      desiredCount   !== rule.trigger?.threshold?.count ||
      desiredWindow  !== rule.trigger?.threshold?.windowMs ||
      desiredInputs  !== (rule.trigger?.inputs  ?? 1) ||
      desiredOutputs !== (rule.trigger?.outputs ?? 1);

    if (changed) {
      try {
        const patch = {
          name: desiredName,
          trigger: {
            ...(rule.trigger ?? {}),
            icmType: desiredIcm,
            inputs:  desiredInputs,
            outputs: desiredOutputs,
            threshold: {
              ...(rule.trigger?.threshold ?? {}),
              count:          desiredCount,
              windowMs:       desiredWindow,
              resetAfterFire: true,
            },
          },
        };
        const res = await api.updateRule(nodeData._ruleId, patch);
        if (res.ok) {
          const idx = _rules.findIndex((r) => r.id === nodeData._ruleId);
          if (idx !== -1) _rules[idx] = res.rule;
          _renderList();
          // Refresh form if this rule is currently open
          if (_activeRuleId === nodeData._ruleId) _populateForm(res.rule);
        }
      } catch { /* service offline */ }
    }
  }
  return nodeData._ruleId;
}

/**
 * Returns a shallow copy of the current rules list.
 * Used by node-config.js to populate the "assign rule" dropdown.
 */
export function getRules() {
  return [..._rules];
}

/**
 * Switch to the Edge Rules tab and optionally select a specific rule.
 */
export function navigateToRule(ruleId) {
  document.querySelector('.nav-btn[data-tab="rules"]')?.click();
  if (!ruleId) return;
  setTimeout(() => {
    const rule = _rules.find((r) => r.id === ruleId);
    if (rule) _selectRule(ruleId);
  }, 60);
}

/**
 * Re-render the Connected Inputs panel for the currently active rule.
 * Call this after canvas edges change (e.g. from main.js on canvas:change).
 */
export function refreshInputConditions() {
  if (_activeRuleId) _renderInputConditions(_activeRuleId);
}

// ── Connected Inputs (chained payload conditions) ──────────────────────────

function _renderInputConditions(ruleId) {
  const container = document.getElementById('rule-input-conditions');
  if (!container) return;

  const { nodes, edges } = getCanvasState();
  const canvasNode = nodes.find((n) => n.kind === 'edgeRule' && n.data?._ruleId === ruleId);

  if (!canvasNode) {
    container.innerHTML = '<p class="input-cond-empty">No canvas node linked to this rule.</p>';
    _renderPayloadVarPanel(ruleId);
    _wireBodyTemplatePreviews(ruleId);
    return;
  }

  const inEdges = edges.filter((e) => e.toNodeId === canvasNode.id);
  if (!inEdges.length) {
    container.innerHTML = '<p class="input-cond-empty">No inputs connected yet — draw edges to this node on the canvas.</p>';
    _renderPayloadVarPanel(ruleId);
    _wireBodyTemplatePreviews(ruleId);
    return;
  }

  const existingConds = canvasNode.data?._inputConditions ?? [];
  const ruleLabel     = canvasNode.data?.ruleName ?? canvasNode.data?.icmType ?? 'EdgeRule';

  container.innerHTML = inEdges.map((edge, idx) => {
    // Build the field list from only the explicitly enabled trigger-payload fields.
    // getAggregatedPayload is called on the from-node only for provenance / chain info.
    const enabledFields = (edge.meta?.triggerPayload ?? []).filter((p) => p.enabled);
    const upstream      = enabledFields.length ? getAggregatedPayload(edge.fromNodeId, nodes, edges) : [];
    const fromNode      = nodes.find((n) => n.id === edge.fromNodeId);
    const fromLabel     = fromNode?.data?.title || fromNode?.data?.ticker || fromNode?.data?.ruleName || fromNode?.kind || 'Node';
    const aggPayload    = enabledFields.map((p) => {
      const fieldName = p.targetField ?? p.field;
      const origin    = upstream.find((u) => u.field === p.field || u.targetField === p.field || u.field === p.targetField);
      return {
        field:           fieldName,
        targetField:     fieldName,
        sourceNodeId:    p.sourceNodeId    ?? origin?.sourceNodeId    ?? edge.fromNodeId,
        sourceNodeKind:  p.sourceNodeKind  ?? origin?.sourceNodeKind  ?? fromNode?.kind,
        sourceNodeLabel: p.sourceNodeLabel ?? origin?.sourceNodeLabel ?? fromLabel,
        chain:           origin?.chain     ?? [fromLabel],
      };
    });
    // Prepend synthetic triggerName field if the edge has one
    if (edge.meta?.triggerName) {
      aggPayload.unshift({
        field: 'triggerName', targetField: 'triggerName',
        sourceNodeId: edge.fromNodeId, sourceNodeKind: fromNode?.kind ?? 'general',
        sourceNodeLabel: fromLabel, chain: [fromLabel],
      });
    }

    const maxChain    = aggPayload.reduce((max, p) => (p.chain?.length ?? 0) > max.length ? (p.chain ?? []) : max, []);
    const chainLabel  = [...maxChain, ruleLabel].join(' → ');
    const existing    = existingConds.find((ic) => ic.edgeId === edge.id) ?? {};
    const savedConds  = existing.conditions ?? [];

    const opOpts = (sel) => ['', '==', '!=', '>', '<', '>=', '<=', 'contains', 'regex'].map((op) =>
      `<option value="${op}" ${op === sel ? 'selected' : ''}>${op || '(skip)'}</option>`
    ).join('');

    const rows = aggPayload.map((ap) => {
      const c = savedConds.find((sc) => sc.field === ap.field && sc.sourceNodeId === ap.sourceNodeId) ?? {};
      const srcIcon = KIND_ICONS[ap.sourceNodeKind] ?? '';
      const chain   = ap.chain?.length > 1 ? `<span class="cond-chain" title="${_esc(ap.chain.join(' → '))}"> ↑</span>` : '';
      return `<tr class="cond-row"
          data-field="${_esc(ap.field)}"
          data-source-node-id="${_esc(ap.sourceNodeId ?? '')}"
          data-source-node-kind="${_esc(ap.sourceNodeKind ?? '')}"
          data-source-node-label="${_esc(ap.sourceNodeLabel ?? '')}">
          <td class="cond-field">${_esc(ap.field)}${chain}</td>
          <td class="cond-source">${srcIcon} ${_esc(ap.sourceNodeLabel ?? '')}</td>
          <td><select class="cond-op">${opOpts(c.operator ?? '')}</select></td>
          <td><input type="text" class="cond-val" value="${_esc(c.value ?? '')}" placeholder="value…" /></td>
        </tr>`;
    }).join('');

    return `<div class="input-cond-item" data-edge-id="${_esc(edge.id)}">
      <div class="input-cond-header">
        <button type="button" class="input-cond-toggle">▶</button>
        <span class="input-cond-label">Input ${idx + 1}: ${_esc(chainLabel)}</span>
        <span class="input-cond-count">${aggPayload.length} field${aggPayload.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="input-cond-body hidden">
        <table class="cond-table">
          <thead><tr><th>Field</th><th>From</th><th>Operator</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  // Toggle expand/collapse
  container.querySelectorAll('.input-cond-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.input-cond-item').querySelector('.input-cond-body');
      const open = body.classList.toggle('hidden');
      btn.textContent = open ? '▶' : '▼';
    });
  });

  // "Apply Conditions" button — insert once after container
  if (!document.getElementById('rule-save-conditions-btn')) {
    const row = document.createElement('div');
    row.className = 'input-cond-save-row';
    row.innerHTML = `<button type="button" id="rule-save-conditions-btn">Apply Conditions</button>`;
    container.after(row);
    row.querySelector('button').addEventListener('click', () => _saveInputConditions(canvasNode.id));
  } else {
    // Re-wire in case canvasNode changed
    document.getElementById('rule-save-conditions-btn').onclick = () => _saveInputConditions(canvasNode.id);
  }

  // Refresh payload variable panel and wire live template previews
  _renderPayloadVarPanel(ruleId);
  _wireBodyTemplatePreviews(ruleId);
}

function _saveInputConditions(nodeId) {
  const container = document.getElementById('rule-input-conditions');
  if (!container || !nodeId) return;

  const inputConditions = [];
  container.querySelectorAll('.input-cond-item').forEach((item) => {
    const edgeId     = item.dataset.edgeId;
    const conditions = [];
    item.querySelectorAll('.cond-row').forEach((row) => {
      const op  = row.querySelector('.cond-op')?.value;
      const val = row.querySelector('.cond-val')?.value?.trim() ?? '';
      if (!op) return; // skip unconfigured rows
      conditions.push({
        field:           row.dataset.field,
        sourceNodeId:    row.dataset.sourceNodeId    || undefined,
        sourceNodeKind:  row.dataset.sourceNodeKind  || undefined,
        sourceNodeLabel: row.dataset.sourceNodeLabel || undefined,
        operator:        op,
        value:           val,
      });
    });
    inputConditions.push({ edgeId, conditions });
  });

  updateNodeData(nodeId, { _inputConditions: inputConditions });
  toast('Input conditions saved', 'success');
}

// ── Payload variable panel & body template preview ────────────────────────────

/**
 * Collect all enabled payload fields from edges connected to the edgeRule canvas node
 * associated with ruleId. Returns [{field, sourceKind, sourceLabel}].
 */
function _getConnectedPayloadFields(ruleId) {
  if (!ruleId) return [];
  const { nodes, edges } = getCanvasState();
  const canvasNode = nodes.find((n) => n.kind === 'edgeRule' && n.data?._ruleId === ruleId);
  if (!canvasNode) return [];
  const inEdges = edges.filter((e) => e.toNodeId === canvasNode.id);
  const fields = []; const seen = new Set();
  for (const edge of inEdges) {
    const fromNode = nodes.find((n) => n.id === edge.fromNodeId);
    for (const p of (edge.meta?.triggerPayload ?? []).filter((p) => p.enabled)) {
      const fieldName = p.targetField ?? p.field;
      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        fields.push({
          field:       fieldName,
          sourceKind:  p.sourceNodeKind  ?? fromNode?.kind,
          sourceLabel: p.sourceNodeLabel ?? fromNode?.data?.title ?? fromNode?.data?.ticker ?? fromNode?.kind ?? '',
        });
      }
    }
  }
  return fields;
}

/** Render clickable field chips in the payload-vars panels for both email and webhook. */
function _renderPayloadVarPanel(ruleId) {
  const fields = _getConnectedPayloadFields(ruleId);
  const panel = document.getElementById('email-payload-vars');
  if (!panel) return;
  if (!fields.length) {
    panel.innerHTML = ruleId
      ? '<span class="payload-vars-hint">No payload fields enabled on connected edges.</span>'
      : '';
    return;
  }
  panel.innerHTML = `
    <div class="payload-vars-header">⚡ Payload fields — click to insert <code>{{#field}}</code></div>
    <div class="payload-vars-chips">
      ${fields.map((f) => `
        <button type="button" class="var-chip" data-field="${_esc(f.field)}"
          title="From: ${_esc(f.sourceLabel)}">${KIND_ICONS[f.sourceKind] ?? ''}${_esc(f.field)}</button>
      `).join('')}
    </div>`;
  panel.querySelectorAll('.var-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ta = document.getElementById('rule-email-body');
      if (ta) _insertAtCursor(ta, `{{#${chip.dataset.field}}}`);
    });
  });
}

/** Insert text at the cursor position inside a textarea. */
function _insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
}

/** Update chip highlight state and the live template preview for one textarea. */
function _onBodyTemplateInput(ta, previewEl, panelId, fields) {
  const tpl = ta.value;
  // Collect {{#field}} usages
  const used = new Set([...tpl.matchAll(/\{\{#([^}]+)\}\}/g)].map((m) => m[1].trim()));
  // Highlight chips that are currently used
  document.getElementById(panelId)?.querySelectorAll('.var-chip').forEach((chip) => {
    chip.classList.toggle('used', used.has(chip.dataset.field));
  });
  // Show/hide preview
  if (!tpl) { previewEl.classList.add('hidden'); return; }
  previewEl.classList.remove('hidden');
  const exampleMap = Object.fromEntries(fields.map((f) => [f.field, `\u2039${f.field}\u203a`]));
  // Build highlighted HTML (escape first, then replace tokens with spans)
  const html = _esc(tpl)
    .replace(/\{\{#([^}]+)\}\}/g, (_, f) => {
      const ex = _esc(exampleMap[f.trim()] ?? f.trim());
      return `<mark class="tpl-var" title="payload.${_esc(f.trim())}">${ex}</mark>`;
    })
    .replace(/\{\{([^}]+)\}\}/g, (_, k) => `<span class="tpl-sysvar">{{${_esc(k)}}}</span>`)
    .replace(/\n/g, '<br>');
  previewEl.innerHTML = `<div class="body-preview-label">Preview (example values)</div><div class="body-preview-content">${html}</div>`;
}

/**
 * Auto-generate the webhook JSON body from the email body text.
 * Produces { "message": "<body>", "<field>": "{{#field}}", ... } for every
 * {{#field}} token found in the email body. Fires oninput on the webhook
 * textarea so its preview also refreshes.
 */
function _syncEmailToWebhookJson(emailTa, webhookTa) {
  const text = emailTa.value;
  const vars = [...new Set([...text.matchAll(/\{\{#([^}]+)\}\}/g)].map((m) => m[1].trim()))];
  const obj = { message: text };
  for (const v of vars) obj[v] = `{{#${v}}}`;
  webhookTa.value = JSON.stringify(obj, null, 2);
  webhookTa.dispatchEvent(new Event('input'));
}

/**
 * Wire oninput handlers on both body textareas so the preview and chip highlights
 * update in real time. Uses oninput (property) to avoid duplicate listeners on re-render.
 * The email body also drives the webhook JSON body via _syncEmailToWebhookJson.
 */
function _wireBodyTemplatePreviews(ruleId) {
  const fields = _getConnectedPayloadFields(ruleId);
  const emailTa   = document.getElementById('rule-email-body');
  const webhookTa = document.getElementById('rule-webhook-body');
  ['email', 'webhook'].forEach((type) => {
    const ta      = document.getElementById(type === 'email' ? 'rule-email-body' : 'rule-webhook-body');
    const preview = document.getElementById(`${type}-body-preview`);
    const panelId = `${type}-payload-vars`;
    if (!ta || !preview) return;
    if (type === 'email') {
      ta.oninput = () => {
        _onBodyTemplateInput(ta, preview, panelId, fields);
        if (webhookTa) _syncEmailToWebhookJson(ta, webhookTa);
      };
    } else {
      ta.oninput = () => _onBodyTemplateInput(ta, preview, panelId, fields);
    }
    _onBodyTemplateInput(ta, preview, panelId, fields); // sync preview immediately
  });
  // Sync JSON body immediately on load too
  if (emailTa && webhookTa) _syncEmailToWebhookJson(emailTa, webhookTa);
}

/** Read inputConditions from the Connected Inputs DOM table for inclusion in the rule save. */
function _readInputConditionsFromDOM() {
  const container = document.getElementById('rule-input-conditions');
  if (!container) return [];
  const result = [];
  container.querySelectorAll('.input-cond-item').forEach((item) => {
    const edgeId = item.dataset.edgeId;
    const conditions = [];
    item.querySelectorAll('.cond-row').forEach((row) => {
      const op  = row.querySelector('.cond-op')?.value;
      const val = row.querySelector('.cond-val')?.value?.trim() ?? '';
      if (!op) return;
      conditions.push({ field: row.dataset.field, operator: op, value: val });
    });
    if (conditions.length) result.push({ edgeId, conditions });
  });
  return result;
}
