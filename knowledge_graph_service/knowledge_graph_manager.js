/**
 * knowledge_graph_manager.js
 *
 * Manages a pool of live OverGraph instances, one per subdirectory under data/.
 * Each graph is opened by name and kept in memory until explicitly closed or
 * the process exits. The data/ directory layout:
 *
 *   data/
 *     <graph-name>/       ← self-contained OverGraph database directory
 *       manifest.current
 *       data.wal
 *       segments/
 *         ...
 */

import { OverGraph } from 'overgraph';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the data directory. */
export const DATA_DIR = path.join(__dirname, 'data');

/**
 * Internal registry: name → { db: OverGraph, openedAt: ISO string, options: object }
 */
const registry = new Map();

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Returns the absolute path for a graph, or throws on invalid names.
 * Prevents path traversal by rejecting names that contain separators or dots.
 */
export function graphPath(name) {
  if (!name || typeof name !== 'string') throw new Error('Graph name must be a non-empty string');
  const safe = path.basename(name);
  if (safe !== name || safe.startsWith('.') || safe === '') {
    throw new Error(`Invalid graph name: "${name}"`);
  }
  return path.join(DATA_DIR, safe);
}

// ─── Startup ─────────────────────────────────────────────────────────────────

/** Ensure the data directory exists. */
export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * On startup: scan data/ and open every graph directory found.
 * Errors from individual graphs are logged but do not abort startup.
 */
export function loadAllGraphs() {
  ensureDataDir();
  let loaded = 0;
  let failed = 0;
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const db = OverGraph.open(graphPath(entry.name));
      registry.set(entry.name, { db, openedAt: new Date().toISOString(), options: {} });
      loaded++;
      console.log(`[kg-manager] Loaded graph: ${entry.name}`);
    } catch (err) {
      failed++;
      console.error(`[kg-manager] Failed to load graph "${entry.name}": ${err.message}`);
    }
  }
  console.log(`[kg-manager] Startup complete — ${loaded} graph(s) loaded, ${failed} failed.`);
}

// ─── Read operations ─────────────────────────────────────────────────────────

/** Returns an array of info objects for every graph discovered on disk. */
export function listGraphs() {
  ensureDataDir();
  const onDisk = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  return onDisk.map(name => {
    const entry = registry.get(name);
    const gPath = graphPath(name);
    let sizeOnDisk = 0;
    try {
      sizeOnDisk = dirSize(gPath);
    } catch { /* ignore */ }
    return {
      name,
      status: entry ? 'open' : 'closed',
      path: gPath,
      openedAt: entry?.openedAt ?? null,
      sizeBytes: sizeOnDisk,
    };
  });
}

/** Returns the live OverGraph instance for a graph, or null if not open. */
export function getGraph(name) {
  return registry.get(name)?.db ?? null;
}

/** Returns true if the graph is currently open in the registry. */
export function isOpen(name) {
  return registry.has(name);
}

// ─── Lifecycle operations ─────────────────────────────────────────────────────

/**
 * Create a brand-new graph. Throws if the name already exists on disk or is open.
 * @param {string} name
 * @param {object} [options]  e.g. { denseVector: { dimension: 384, metric: 'cosine' } }
 * @returns {OverGraph}
 */
export function createGraph(name, options = {}) {
  graphPath(name); // validate
  if (registry.has(name)) throw new Error(`Graph "${name}" is already open`);
  const gPath = graphPath(name);
  if (fs.existsSync(gPath)) throw new Error(`Graph "${name}" already exists on disk. Use POST /graphs/${name}/open or DELETE first.`);
  fs.mkdirSync(gPath, { recursive: true });
  const db = OverGraph.open(gPath, buildOpenOptions(options));
  registry.set(name, { db, openedAt: new Date().toISOString(), options });
  return db;
}

/**
 * Open an existing on-disk graph that is not currently in the registry.
 * If it is already open, returns the existing instance.
 */
export function openGraph(name, options = {}) {
  graphPath(name); // validate
  if (registry.has(name)) return registry.get(name).db;
  const gPath = graphPath(name);
  if (!fs.existsSync(gPath)) throw new Error(`Graph "${name}" does not exist on disk`);
  const db = OverGraph.open(gPath, buildOpenOptions(options));
  registry.set(name, { db, openedAt: new Date().toISOString(), options });
  return db;
}

/** Close a graph without deleting its data. Safe to call if already closed. */
export function closeGraph(name) {
  const entry = registry.get(name);
  if (entry) {
    try { entry.db.close(); } catch { /* ignore */ }
    registry.delete(name);
  }
}

/**
 * Wipe a graph's data directory and reopen it as empty.
 * Useful for resetting without changing the graph's name/location.
 */
export function recreateGraph(name, options = {}) {
  graphPath(name); // validate
  closeGraph(name);
  const gPath = graphPath(name);
  if (fs.existsSync(gPath)) fs.rmSync(gPath, { recursive: true, force: true });
  return createGraph(name, options);
}

/** Close and permanently delete a graph's directory. */
export function deleteGraph(name) {
  graphPath(name); // validate
  closeGraph(name);
  const gPath = graphPath(name);
  if (fs.existsSync(gPath)) fs.rmSync(gPath, { recursive: true, force: true });
}

// ─── Combine ─────────────────────────────────────────────────────────────────

/**
 * Merge one or more source graphs into a new target graph.
 *
 * Algorithm:
 *   1. Create target graph.
 *   2. For each source, paginate all nodes and upsert them into target,
 *      building an oldId → newId mapping.
 *   3. For each source node, fetch its outgoing neighbours and recreate
 *      the edges in target using the mapped IDs.
 *
 * Note: dense/sparse vectors are not copied (they require the same index
 * dimension to be configured at creation time on the target).
 *
 * @param {string[]} sourceNames   Names of graphs to read from.
 * @param {string}   targetName    Name for the new combined graph.
 * @param {object}   [options]     Open-options for the target graph.
 * @returns {OverGraph}
 */
export async function combineGraphs(sourceNames, targetName, options = {}) {
  const targetDb = createGraph(targetName, options);

  for (const sourceName of sourceNames) {
    // Ensure source is open (opens read-only if needed)
    const sourceDb = getGraph(sourceName) ?? openGraph(sourceName);
    const idMap = new Map(); // BigInt(sourceId) → BigInt(targetId)

    // ── Pass 1: copy nodes ──────────────────────────────────────────────────
    let after;
    while (true) {
      const query = { limit: 500 };
      if (after !== undefined) query.after = after;

      const nodes = sourceDb.queryNodes(query);
      if (!nodes || nodes.length === 0) break;

      for (const node of nodes) {
        const newId = targetDb.upsertNode(Number(node.typeId), String(node.key), {
          props: node.props ?? {},
        });
        idMap.set(BigInt(node.id), BigInt(newId));
        after = node.id;
      }

      if (nodes.length < 500) break;
    }

    // ── Pass 2: copy edges ──────────────────────────────────────────────────
    after = undefined;
    while (true) {
      const query = { limit: 500 };
      if (after !== undefined) query.after = after;

      const nodes = sourceDb.queryNodes(query);
      if (!nodes || nodes.length === 0) break;

      for (const node of nodes) {
        const newFromId = idMap.get(BigInt(node.id));
        if (newFromId === undefined) { after = node.id; continue; }

        let neighbours;
        try {
          neighbours = sourceDb.neighbors(BigInt(node.id), { direction: 'outgoing', limit: 50000 });
        } catch { neighbours = []; }

        for (const nb of neighbours) {
          const newToId = idMap.get(BigInt(nb.nodeId));
          if (newToId === undefined) continue;
          try {
            targetDb.upsertEdge(newFromId, newToId, Number(nb.edgeTypeId), {
              ...(nb.weight !== undefined ? { weight: Number(nb.weight) } : {}),
            });
          } catch { /* skip individual edge failures */ }
        }
        after = node.id;
      }

      if (nodes.length < 500) break;
    }

    console.log(`[kg-manager] combine: copied ${idMap.size} nodes from "${sourceName}" → "${targetName}"`);
  }

  return targetDb;
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

/** Close all open graphs gracefully. Called on process exit. */
export function closeAllGraphs() {
  for (const [name, entry] of registry) {
    try { entry.db.close(); } catch { /* ignore */ }
    console.log(`[kg-manager] Closed graph: ${name}`);
  }
  registry.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert user-supplied options object into a valid OverGraph.open options object. */
function buildOpenOptions(options) {
  if (!options || Object.keys(options).length === 0) return undefined;
  const out = {};
  if (options.denseVector) {
    out.denseVector = {
      dimension: Number(options.denseVector.dimension),
      ...(options.denseVector.metric ? { metric: options.denseVector.metric } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Recursively sum the byte sizes of all files in a directory. */
function dirSize(dirPath) {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}
