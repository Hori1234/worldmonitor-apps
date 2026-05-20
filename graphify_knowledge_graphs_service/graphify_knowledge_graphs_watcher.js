/**
 * graphify_knowledge_graphs_watcher.js
 *
 * Manages long-running `graphify-ts watch .` processes per graph directory.
 * Each named graph can have at most one active watcher at a time.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { GRAPHIFY_EXE, GRAPHIFY_PREFIX_ARGS } from './graphify_knowledge_graphs_runner.js';

/**
 * @typedef {{ proc: import('child_process').ChildProcess, startedAt: Date }} WatcherEntry
 * @type {Map<string, WatcherEntry>}
 */
const watchers = new Map();

/**
 * Start a file-watch rebuild process for the named graph.
 * @returns {{ pid: number|undefined, startedAt: Date }}
 */
export function startWatcher(name, cwd) {
  if (!existsSync(cwd)) {
    const err = new Error(`Graph directory does not exist: ${name}`);
    err.status = 404;
    throw err;
  }
  if (watchers.has(name)) {
    const err = new Error(`Watcher already running for '${name}'`);
    err.status = 409;
    throw err;
  }

  const proc = spawn(GRAPHIFY_EXE, [...GRAPHIFY_PREFIX_ARGS, 'watch', '.'], { cwd, shell: false });
  const startedAt = new Date();
  watchers.set(name, { proc, startedAt });

  proc.on('exit',  () => { watchers.delete(name); });
  proc.on('error', () => { watchers.delete(name); });

  return { pid: proc.pid, startedAt };
}

/**
 * Stop the watcher for the named graph.
 */
export function stopWatcher(name) {
  const entry = watchers.get(name);
  if (!entry) {
    const err = new Error(`No watcher running for '${name}'`);
    err.status = 404;
    throw err;
  }
  entry.proc.kill('SIGTERM');
  watchers.delete(name);
}

/**
 * Return current status of the watcher for the named graph.
 * @returns {{ running: boolean, pid: number|null, startedAt: Date|null }}
 */
export function watcherStatus(name) {
  const entry = watchers.get(name);
  return {
    running:   !!entry,
    pid:       entry?.proc.pid ?? null,
    startedAt: entry?.startedAt ?? null,
  };
}

/** Kill every active watcher (called on graceful shutdown). */
export function stopAllWatchers() {
  for (const [, { proc }] of watchers) proc.kill('SIGTERM');
  watchers.clear();
}
