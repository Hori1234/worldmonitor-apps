/**
 * edge-rule-builder.js
 * Two-column layout: rule list on left, form editor on right.
 * Live test log tails edge-rule:fired WS events.
 */

import * as api  from './api.js';
import { toast } from './toast.js';

let _rules        = [];
let _activeRuleId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const list     = () => document.getElementById('rules-list');
const form     = () => document.getElementById('rule-form');
const testLog  = () => document.getElementById('rule-test-log');
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
}

function _hideForm() {
  form()?.classList.add('hidden');
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
  const payload = { icmType: fIcm()?.value ?? '*', _test: true };
  try {
    const res = await api.testRule(_activeRuleId, payload);
    testLog()?.classList.remove('hidden');
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
