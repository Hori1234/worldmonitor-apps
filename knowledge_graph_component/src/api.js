/**
 * api.js — Fetch helpers for the Knowledge Graph Service (port 3738).
 * All paths are proxied through Vite at /api/kg → http://localhost:3738
 */

const BASE = '/api/kg';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.data;
}

// ── Health ────────────────────────────────────────────────────────────────────
export const health = () => request('GET', '/health');

// ── Graph management ──────────────────────────────────────────────────────────
export const listGraphs   = ()               => request('GET',    '/graphs');
export const getGraph     = (name)           => request('GET',    `/graphs/${enc(name)}`);
export const createGraph  = (name, options)  => request('POST',   '/graphs', { name, options });
export const openGraph    = (name, options)  => request('POST',   `/graphs/${enc(name)}/open`, { options });
export const closeGraph   = (name)           => request('POST',   `/graphs/${enc(name)}/close`);
export const recreateGraph = (name, options) => request('POST',   `/graphs/${enc(name)}/recreate`, { options });
export const deleteGraph  = (name)           => request('DELETE', `/graphs/${enc(name)}`);
export const combineGraphs = (sources, target, options) =>
  request('POST', '/graphs/combine', { sources, target, options });

// ── Nodes ─────────────────────────────────────────────────────────────────────
export const queryNodes  = (name, query)      => request('POST', `/graphs/${enc(name)}/nodes/query`, query);
export const upsertNode  = (name, node)        => request('POST', `/graphs/${enc(name)}/nodes`, node);
export const batchNodes  = (name, nodes)       => request('POST', `/graphs/${enc(name)}/nodes/batch`, { nodes });
export const getNodeById = (name, nodeId)      => request('GET',  `/graphs/${enc(name)}/nodes/${nodeId}`);
export const getNodeByKey = (name, tid, key)   => request('GET',  `/graphs/${enc(name)}/nodes/key/${tid}/${enc(key)}`);
export const findNodes   = (name, typeId, prop, value, limit = 50) =>
  request('GET', `/graphs/${enc(name)}/nodes/find?typeId=${typeId}&prop=${enc(prop)}&value=${enc(value)}&limit=${limit}`);
export const deleteNode  = (name, nodeId)      => request('DELETE', `/graphs/${enc(name)}/nodes/${nodeId}`);

// ── Edges ─────────────────────────────────────────────────────────────────────
export const upsertEdge  = (name, edge)        => request('POST',   `/graphs/${enc(name)}/edges`, edge);
export const batchEdges  = (name, edges)        => request('POST',   `/graphs/${enc(name)}/edges/batch`, { edges });
export const deleteEdge  = (name, edge)        => request('DELETE', `/graphs/${enc(name)}/edges`, edge);

// ── Graph queries ─────────────────────────────────────────────────────────────
export const getNeighbors = (name, nodeId, direction = 'outgoing', limit = 200, edgeTypes) => {
  const qs = new URLSearchParams({ direction, limit: String(limit) });
  if (edgeTypes?.length) qs.set('edgeTypes', edgeTypes.join(','));
  return request('GET', `/graphs/${enc(name)}/neighbors/${nodeId}?${qs}`);
};
export const traverse      = (name, body)  => request('POST', `/graphs/${enc(name)}/traverse`, body);
export const shortestPath  = (name, body)  => request('POST', `/graphs/${enc(name)}/shortest-path`, body);
export const pagerank      = (name, body)  => request('POST', `/graphs/${enc(name)}/pagerank`, body);
export const subgraph      = (name, body)  => request('POST', `/graphs/${enc(name)}/subgraph`, body);
export const degrees       = (name, body)  => request('POST', `/graphs/${enc(name)}/degrees`, body);
export const components    = (name, body)  => request('POST', `/graphs/${enc(name)}/components`, body);
export const vectorSearch  = (name, body)  => request('POST', `/graphs/${enc(name)}/search`, body);

// ── Atomic mutation ───────────────────────────────────────────────────────────
export const patch = (name, body) => request('POST', `/graphs/${enc(name)}/patch`, body);

// ── Raw request (used by API Explorer) ───────────────────────────────────────
export const raw = (method, path, body) => request(method, path, body);

function enc(s) { return encodeURIComponent(s); }
