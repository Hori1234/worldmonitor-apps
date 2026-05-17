/**
 * notification_center_profiles.js
 * Profile + canvas CRUD with JSON file persistence (one file per profile).
 */

import fs   from 'node:fs';
import path from 'node:path';
import { settings } from './notification_center_settings.js';

const dir = () => path.resolve(settings.PROFILES_DATA_DIR);
const profilePath = (id) => path.join(dir(), `${id}.json`);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function loadProfiles() {
  try { fs.mkdirSync(dir(), { recursive: true }); }
  catch { /* already exists */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readProfile(id) {
  const file = profilePath(id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function writeProfile(profile) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(profilePath(profile.id), JSON.stringify(profile, null, 2));
}

function emptyCanvas(profileId) {
  return { profileId, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listProfiles() {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    return fs.readdirSync(dir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .map(({ id, name, description, createdAt, updatedAt }) => ({ id, name, description, createdAt, updatedAt }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch { return []; }
}

export function createProfile({ name, description = '' }) {
  if (!name?.trim()) throw new Error('Profile name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const profile = {
    id, name: name.trim(), description,
    createdAt: now, updatedAt: now,
    canvas: emptyCanvas(id),
  };
  writeProfile(profile);
  return profile;
}

export function getProfile(id) {
  return readProfile(id);
}

export function renameProfile(id, { name, description }) {
  const profile = readProfile(id);
  if (!profile) return null;
  if (name?.trim()) profile.name = name.trim();
  if (description !== undefined) profile.description = description;
  profile.updatedAt = new Date().toISOString();
  writeProfile(profile);
  return profile;
}

export function deleteProfile(id) {
  const file = profilePath(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function getCanvas(id) {
  const profile = readProfile(id);
  if (!profile) return null;
  return profile.canvas ?? emptyCanvas(id);
}

export function saveCanvas(id, canvas) {
  const profile = readProfile(id);
  if (!profile) return null;
  profile.canvas = { ...canvas, profileId: id };
  profile.updatedAt = new Date().toISOString();
  writeProfile(profile);
  return profile.canvas;
}
