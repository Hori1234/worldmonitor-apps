/**
 * node-config.js
 * Center-screen modal for node config and edge connection config.
 */

import { updateNodeData } from './canvas.js';

let _activeNodeId      = null;
let _onDeleteNode      = null;
let _edgeApplyCallback = null;

// ── Node config modal ─────────────────────────────────────────────────────────

export function initNodeConfig({ onDelete } = {}) {
  _onDeleteNode = onDelete;

  document.getElementById('node-modal-close')?.addEventListener('click',  _closeNodeModal);
  document.getElementById('node-modal-cancel')?.addEventListener('click', _closeNodeModal);

  document.getElementById('node-modal-apply')?.addEventListener('click', () => {
    if (!_activeNodeId) return;
    const data = _readForm();
    updateNodeData(_activeNodeId, data);
    _closeNodeModal();
  });

  document.getElementById('node-modal-delete')?.addEventListener('click', () => {
    if (!_activeNodeId) return;
    _onDeleteNode?.(_activeNodeId);
    _closeNodeModal();
  });

  document.getElementById('node-config-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'node-config-modal') _closeNodeModal();
  });
}

// Aliases kept for main.js compatibility
export function openFlyout(node) { _openNodeModal(node); }
export function closeFlyout()    { _closeNodeModal(); }

function _openNodeModal(node) {
  _activeNodeId = node.id;
  document.getElementById('node-modal-title').textContent =
    `${_kindIcon(node.kind)} Configure ${_kindLabel(node.kind)}`;
  document.getElementById('node-modal-body').innerHTML = _buildForm(node.kind, node.data ?? {});
  document.getElementById('node-config-modal').classList.remove('hidden');
}

function _closeNodeModal() {
  _activeNodeId = null;
  document.getElementById('node-config-modal')?.classList.add('hidden');
}

// ── Edge config modal ─────────────────────────────────────────────────────────

export function initEdgeModal() {
  document.getElementById('edge-modal-close')?.addEventListener('click',  _closeEdgeModal);
  document.getElementById('edge-modal-cancel')?.addEventListener('click', _closeEdgeModal);

  document.getElementById('edge-modal-apply')?.addEventListener('click', () => {
    if (!_edgeApplyCallback) return;
    _edgeApplyCallback(_readEdgeForm());
    _closeEdgeModal();
  });

  document.getElementById('edge-config-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'edge-config-modal') _closeEdgeModal();
  });
}

export function openEdgeModal(edge, onApply) {
  _edgeApplyCallback = onApply;
  document.getElementById('edge-modal-body').innerHTML = _edgeForm(edge.meta ?? {});
  document.getElementById('edge-config-modal').classList.remove('hidden');
}

function _closeEdgeModal() {
  _edgeApplyCallback = null;
  document.getElementById('edge-config-modal')?.classList.add('hidden');
}

function _edgeForm(meta) {
  const actionOpts = ['', 'email', 'webhook', 'display']
    .map((v) => `<option value="${v}" ${v === (meta.action ?? '') ? 'selected' : ''}>${v || 'None'}</option>`)
    .join('');
  return `
    ${_field('edge-label',        'Label',                meta.label        ?? '', 'text',   'placeholder="Connection name\u2026"')}
    ${_field('edge-icmType',      'ICM Type filter',      meta.icmType      ?? '', 'text',   'placeholder="icm:market-update"')}
    ${_field('edge-priority',     'Priority',             meta.priority     ?? 1,  'number')}
    <div class="form-group">
      <label>Action</label>
      <select id="edge-action">${actionOpts}</select>
    </div>
    ${_field('edge-actionTarget', 'Action target (URL / email)', meta.actionTarget ?? '', 'text')}
    ${_field('edge-notes',        'Notes',                meta.notes        ?? '', 'text')}
  `;
}

function _readEdgeForm() {
  const v = (id) => document.getElementById(id)?.value ?? '';
  return {
    label:        v('edge-label'),
    icmType:      v('edge-icmType'),
    priority:     parseInt(v('edge-priority'), 10) || 1,
    action:       v('edge-action'),
    actionTarget: v('edge-actionTarget'),
    notes:        v('edge-notes'),
  };
}

// ── Form builders ─────────────────────────────────────────────────────────────

function _buildForm(kind, data) {
  const ports = `
    <div class="form-group form-row-2">
      ${_field('cfg-inputs',  'Inputs',  data.inputs  ?? 1, 'number', 'min="0" max="8"')}
      ${_field('cfg-outputs', 'Outputs', data.outputs ?? 1, 'number', 'min="0" max="8"')}
    </div>`;
  switch (kind) {
    case 'market':     return ports + _marketForm(data);
    case 'news':       return ports + _newsForm(data);
    case 'polymarket': return ports + _polymarketForm(data);
    case 'map':        return ports + _mapForm(data);
    case 'general':    return ports + _generalForm(data);
    case 'edgeRule':   return ports + _edgeRuleForm(data);
    default:           return ports + '<p style="color:var(--text-3)">Unknown node kind.</p>';
  }
}

function _field(id, label, value = '', type = 'text', extra = '') {
  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" value="${_esc(String(value ?? ''))}" ${extra} />
    </div>`;
}

function _select(id, label, value, options) {
  const opts = options.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('');
  return `<div class="form-group"><label>${label}</label><select id="${id}">${opts}</select></div>`;
}

function _marketForm(d) {
  return `
    ${_field('cfg-ticker',   'Ticker *',   d.ticker,   'text', 'placeholder="AAPL"')}
    ${_field('cfg-exchange', 'Exchange',   d.exchange, 'text', 'placeholder="NASDAQ"')}
    ${_field('cfg-price',    'Price',      d.price,    'number')}
    ${_field('cfg-pct',      'Change %',   d.priceChangePct, 'number')}
    ${_field('cfg-title',    'Title',      d.title,    'text')}
  `;
}

function _newsForm(d) {
  return `
    ${_field('cfg-category', 'Category *', d.category, 'text', 'placeholder="technology"')}
    ${_field('cfg-title',    'Title',      d.title,    'text')}
    ${_field('cfg-source',   'Source',     d.source,   'text')}
    ${_field('cfg-url',      'URL',        d.url,      'url')}
  `;
}

function _polymarketForm(d) {
  return `
    ${_field('cfg-marketId', 'Market ID *', d.marketId, 'text')}
    ${_field('cfg-question', 'Question *',  d.question, 'text')}
    ${_field('cfg-yes',      'Yes prob %',  d.yesProbability, 'number')}
    ${_field('cfg-no',       'No prob %',   d.noProbability,  'number')}
  `;
}

function _mapForm(d) {
  const categories = ['conflict','natural-disaster','political','economic','environmental','other'];
  return `
    ${_select('cfg-eventCategory', 'Event Category *', d.eventCategory ?? 'other', categories)}
    ${_field('cfg-lat',  'Latitude',   d.latitude,  'number')}
    ${_field('cfg-lon',  'Longitude',  d.longitude, 'number')}
    ${_field('cfg-title','Title',      d.title,     'text')}
    ${_field('cfg-region','Region',    d.region,    'text')}
  `;
}

function _generalForm(d) {
  const templates = ['alert','digest','status','metric','custom'];
  const channels  = ['email','webhook','display','sms'];
  return `
    ${_select('cfg-template', 'Template *', d.template ?? 'alert', templates)}
    ${_field('cfg-title',   'Title',   d.title,   'text')}
    ${_field('cfg-message', 'Message', d.message, 'text')}
    ${_select('cfg-channel', 'Channel', d.channel ?? 'display', channels)}
    <div class="form-group">
      <label>Priority</label>
      <select id="cfg-priority">
        ${[1,2,3,4,5].map((n) => `<option ${n === (d.priority ?? 3) ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>
  `;
}

function _edgeRuleForm(d) {
  return `
    ${_field('cfg-ruleName', 'Rule Name', d.ruleName, 'text')}
    ${_field('cfg-icmType',  'ICM Type',  d.icmType,  'text', 'placeholder="icm:market-update"')}
    ${_field('cfg-count',    'Threshold count', d.count ?? 1, 'number')}
    ${_field('cfg-window',   'Window ms',       d.windowMs ?? 60000, 'number')}
  `;
}

// ── Read back form values ─────────────────────────────────────────────────────

function _readForm() {
  const get = (id) => document.getElementById(id);
  const v   = (id) => get(id)?.value ?? '';

  return {
    inputs:          parseInt(v('cfg-inputs'),  10) || 1,
    outputs:         parseInt(v('cfg-outputs'), 10) || 1,
    ticker:          v('cfg-ticker'),
    exchange:        v('cfg-exchange'),
    price:           parseFloat(v('cfg-price')) || undefined,
    priceChangePct:  parseFloat(v('cfg-pct'))   || undefined,
    category:        v('cfg-category'),
    source:          v('cfg-source'),
    url:             v('cfg-url'),
    marketId:        v('cfg-marketId'),
    question:        v('cfg-question'),
    yesProbability:  parseFloat(v('cfg-yes')) || undefined,
    noProbability:   parseFloat(v('cfg-no'))  || undefined,
    eventCategory:   v('cfg-eventCategory'),
    latitude:        parseFloat(v('cfg-lat')) || undefined,
    longitude:       parseFloat(v('cfg-lon')) || undefined,
    region:          v('cfg-region'),
    template:        v('cfg-template'),
    channel:         v('cfg-channel'),
    priority:        parseInt(v('cfg-priority'), 10) || 3,
    ruleName:        v('cfg-ruleName'),
    icmType:         v('cfg-icmType'),
    count:           parseInt(v('cfg-count'),  10) || 1,
    windowMs:        parseInt(v('cfg-window'), 10) || 60000,
    title:           v('cfg-title'),
    message:         v('cfg-message'),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const KIND_ICONS  = { market: '📈', news: '📰', polymarket: '🎯', map: '🗺', general: '⚙', edgeRule: '⚡' };
const KIND_LABELS = { market: 'Market', news: 'News', polymarket: 'PolyMarket', map: 'Map', general: 'General', edgeRule: 'Edge Rule' };

function _kindIcon(k)  { return KIND_ICONS[k]  ?? '🔔'; }
function _kindLabel(k) { return KIND_LABELS[k] ?? k; }

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
