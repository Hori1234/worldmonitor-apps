/**
 * profile-selector.js
 * Manages the active profile dropdown + create/rename/delete modals.
 * Mirrors the KG component's graph selector pattern.
 */

import * as api from './api.js';
import { toast } from './toast.js';

let _currentProfileId = null;
let _onProfileChange  = null;

// DOM refs
const sel       = () => document.getElementById('profile-select');
const newBtn    = () => document.getElementById('profile-new-btn');
const renameBtn = () => document.getElementById('profile-rename-btn');
const deleteBtn = () => document.getElementById('profile-delete-btn');

const modal        = () => document.getElementById('profile-modal');
const modalTitle   = () => document.getElementById('profile-modal-title');
const modalName    = () => document.getElementById('profile-modal-name');
const modalDesc    = () => document.getElementById('profile-modal-desc');
const modalConfirm = () => document.getElementById('profile-modal-confirm');

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initProfileSelector(onChange) {
  _onProfileChange = onChange;

  newBtn()?.addEventListener('click',    _openCreateModal);
  renameBtn()?.addEventListener('click', _openRenameModal);
  deleteBtn()?.addEventListener('click', _handleDelete);
  sel()?.addEventListener('change',      _handleSelect);

  // Modal close buttons
  document.querySelectorAll('#profile-modal .modal-close').forEach((btn) => {
    btn.addEventListener('click', _closeModal);
  });

  modalConfirm()?.addEventListener('click', _handleModalConfirm);

  await _reload();
}

export function getCurrentProfileId() { return _currentProfileId; }

// ── Reload ────────────────────────────────────────────────────────────────────

async function _reload() {
  try {
    const res = await api.listProfiles();
    const profiles = res.profiles ?? [];
    const s = sel();
    if (!s) return;

    s.innerHTML = profiles.length
      ? profiles.map((p) => `<option value="${p.id}">${_esc(p.name)}</option>`).join('')
      : '<option value="" disabled>No profiles</option>';

    if (profiles.length) {
      _currentProfileId = profiles[0].id;
      s.value = _currentProfileId;
      _onProfileChange?.(_currentProfileId);
    }
  } catch {
    toast('Could not load profiles', 'error');
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

let _modalMode = 'create';

function _openCreateModal() {
  _modalMode = 'create';
  modalTitle().textContent   = 'New Profile';
  modalName().value          = '';
  modalDesc().value          = '';
  modalConfirm().textContent = 'Create';
  modal()?.classList.remove('hidden');
  modalName()?.focus();
}

function _openRenameModal() {
  if (!_currentProfileId) return;
  _modalMode = 'rename';
  const opt = sel()?.querySelector(`option[value="${_currentProfileId}"]`);
  modalTitle().textContent   = 'Rename Profile';
  modalName().value          = opt?.textContent ?? '';
  modalDesc().value          = '';
  modalConfirm().textContent = 'Rename';
  modal()?.classList.remove('hidden');
  modalName()?.focus();
}

function _closeModal() {
  modal()?.classList.add('hidden');
}

async function _handleModalConfirm() {
  const name = modalName()?.value.trim();
  if (!name) { toast('Name is required', 'warn'); return; }

  try {
    if (_modalMode === 'create') {
      const res = await api.createProfile({ name, description: modalDesc()?.value ?? '' });
      if (!res.ok) throw new Error(res.error);
      toast(`Profile "${name}" created`, 'success');
    } else {
      const res = await api.updateProfile(_currentProfileId, { name });
      if (!res.ok) throw new Error(res.error);
      toast(`Renamed to "${name}"`, 'success');
    }
    _closeModal();
    await _reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function _handleDelete() {
  if (!_currentProfileId) return;
  const opt  = sel()?.querySelector(`option[value="${_currentProfileId}"]`);
  const name = opt?.textContent ?? 'this profile';
  if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return;

  try {
    const res = await api.deleteProfile(_currentProfileId);
    if (!res.ok) throw new Error(res.error);
    toast(`Profile deleted`, 'success');
    _currentProfileId = null;
    _onProfileChange?.(null);
    await _reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function _handleSelect() {
  _currentProfileId = sel()?.value ?? null;
  _onProfileChange?.(_currentProfileId);
}

function _esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
