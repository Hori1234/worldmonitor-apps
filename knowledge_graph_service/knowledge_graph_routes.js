/**
 * knowledge_graph_routes.js
 *
 * All Express route handlers for the Knowledge Graph Service.
 *
 * Route overview
 * ──────────────
 * Health
 *   GET  /health
 *
 * Graph management
 *   GET    /graphs                      list all graphs
 *   POST   /graphs                      create a new graph
 *   POST   /graphs/combine              merge multiple graphs into one  ← MUST be before /:name
 *   GET    /graphs/:name                info & stats for a graph
 *   POST   /graphs/:name/open           open a closed graph
 *   POST   /graphs/:name/close          close without deleting
 *   POST   /graphs/:name/recreate       wipe & recreate empty
 *   DELETE /graphs/:name                permanently delete
 *
 * Nodes
 *   POST   /graphs/:name/nodes              upsert a node
 *   POST   /graphs/:name/nodes/batch        batch upsert
 *   GET    /graphs/:name/nodes/find         find by property (query-string)
 *   POST   /graphs/:name/nodes/query        full boolean query (body)
 *   GET    /graphs/:name/nodes/key/:tid/:k  get by (typeId, key)   ← before /:nodeId
 *   GET    /graphs/:name/nodes/:nodeId      get by internal ID
 *   DELETE /graphs/:name/nodes/:nodeId      delete node
 *
 * Edges
 *   POST   /graphs/:name/edges          upsert an edge
 *   POST   /graphs/:name/edges/batch    batch upsert
 *   DELETE /graphs/:name/edges          delete an edge
 *
 * Graph queries & algorithms
 *   GET  /graphs/:name/neighbors/:nodeId   1-hop neighbours
 *   POST /graphs/:name/traverse            BFS traversal
 *   POST /graphs/:name/shortest-path       shortest path
 *   POST /graphs/:name/pagerank            personalized PageRank
 *   POST /graphs/:name/subgraph            extract local subgraph
 *   POST /graphs/:name/degrees             degree counts
 *   POST /graphs/:name/components          connected components
 *   POST /graphs/:name/search              vector search (dense/sparse/hybrid)
 *
 * Atomic mutation
 *   POST /graphs/:name/patch               graph_patch (nodes + edges atomically)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  listGraphs,
  getGraph,
  graphPath,
  createGraph,
  openGraph,
  closeGraph,
  recreateGraph,
  deleteGraph,
  combineGraphs,
} from './knowledge_graph_manager.js';

const router = express.Router();

// Rate-limit heavy operations (traversal, search, combine)
const heavyLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests — slow down.' },
});

// ─── Serialisation helpers ────────────────────────────────────────────────────

/** JSON.stringify that converts BigInt values to strings. */
function serialize(value) {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Send a success response. */
function ok(res, data) {
  res.type('application/json').send(serialize({ ok: true, data }));
}

/** Send an error response. */
function fail(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

/**
 * Convert an OverGraph JsNodeRecord (native WASM object with prototype getters)
 * into a plain serialisable JS object. JSON.stringify cannot enumerate prototype
 * getters, so every node-returning route MUST go through this helper.
 */
function toPlainNode(n) {
  if (!n) return null;
  return {
    id:        String(n.id),
    typeId:    Number(n.typeId),
    key:       String(n.key),
    props:     n.props ?? {},
    createdAt: n.createdAt ?? null,
    updatedAt: n.updatedAt ?? null,
    weight:    n.weight ?? null,
  };
}

/**
 * Convert any iterable / array-like OverGraph result to a plain JS Array of
 * serialisable node objects. Safe to call on real JS arrays too.
 */
function plainNodeArray(result) {
  if (!result) return [];
  // Already a real array of neighbor-records (plain objects with nodeId key)
  if (Array.isArray(result) && (result.length === 0 || 'nodeId' in (result[0] ?? {}))) {
    return result;
  }
  return Array.from(result).map(toPlainNode);
}

/**
 * Convert a native OverGraph edge record (prototype getters) to a plain object.
 */
function toPlainEdge(e) {
  if (!e) return null;
  return {
    id:        String(e.id),
    from:      String(e.from ?? e.fromId),
    to:        String(e.to ?? e.toId),
    typeId:    Number(e.typeId),
    weight:    e.weight ?? 1,
    props:     e.props ?? {},
    validFrom: e.validFrom ?? null,
    validTo:   e.validTo ?? null,
  };
}

/**
 * Parse a value that might be a string-encoded BigInt, a number, or a BigInt.
 * Returns a BigInt or throws.
 */
function toBigInt(val) {
  if (val === undefined || val === null) throw new TypeError('Expected a node ID, got null/undefined');
  return BigInt(val);
}

/** Middleware: resolve :name → live OverGraph db or send 404. */
function requireGraph(req, res) {
  const db = getGraph(req.params.name);
  if (!db) {
    fail(res, 404, `Graph "${req.params.name}" is not open. Use POST /graphs/${req.params.name}/open or create it first.`);
    return null;
  }
  return db;
}

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  const graphs = listGraphs();
  ok(res, {
    service: 'knowledge-graph-service',
    status: 'ok',
    totalGraphs: graphs.length,
    openGraphs: graphs.filter(g => g.status === 'open').length,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph Management
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /graphs — list every graph on disk with status. */
router.get('/graphs', (_req, res) => {
  ok(res, listGraphs());
});

/**
 * POST /graphs — create a new graph.
 *
 * Body: {
 *   name: string,
 *   options?: {
 *     denseVector?: { dimension: number, metric?: 'cosine'|'euclidean'|'dot' }
 *   }
 * }
 */
router.post('/graphs', (req, res) => {
  const { name, options = {} } = req.body ?? {};
  if (!name || typeof name !== 'string') return fail(res, 400, '"name" is required');
  try {
    createGraph(name, options);
    ok(res, { name, status: 'created' });
  } catch (err) {
    fail(res, 409, err.message);
  }
});

/**
 * POST /graphs/combine — merge one or more source graphs into a new target graph.
 * IMPORTANT: this route must be registered before /graphs/:name routes.
 *
 * Body: {
 *   sources: string[],   // names of existing graphs to read from
 *   target: string,      // name of the new combined graph
 *   options?: {}         // open-options for the target graph
 * }
 */
router.post('/graphs/combine', heavyLimit, async (req, res) => {
  const { sources, target, options = {} } = req.body ?? {};
  if (!Array.isArray(sources) || sources.length === 0) return fail(res, 400, '"sources" must be a non-empty array');
  if (!target || typeof target !== 'string') return fail(res, 400, '"target" name is required');
  try {
    await combineGraphs(sources, target, options);
    ok(res, { target, sources, status: 'combined' });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

/** GET /graphs/:name — info & stats for one graph. */
router.get('/graphs/:name', (req, res) => {
  const all = listGraphs();
  const info = all.find(g => g.name === req.params.name);
  if (!info) return fail(res, 404, `Graph "${req.params.name}" not found`);
  ok(res, info);
});

/**
 * POST /graphs/:name/open — open a graph that exists on disk but is not in the pool.
 * Body: { options?: {} }
 */
router.post('/graphs/:name/open', (req, res) => {
  const { options = {} } = req.body ?? {};
  try {
    openGraph(req.params.name, options);
    ok(res, { name: req.params.name, status: 'open' });
  } catch (err) {
    fail(res, 404, err.message);
  }
});

/** POST /graphs/:name/close — flush & close without deleting data. */
router.post('/graphs/:name/close', (req, res) => {
  closeGraph(req.params.name);
  ok(res, { name: req.params.name, status: 'closed' });
});

/**
 * POST /graphs/:name/recreate — wipe all data and reopen as an empty graph.
 * Body: { options?: {} }
 */
router.post('/graphs/:name/recreate', (req, res) => {
  const { options = {} } = req.body ?? {};
  try {
    recreateGraph(req.params.name, options);
    ok(res, { name: req.params.name, status: 'recreated' });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

/** DELETE /graphs/:name — permanently delete a graph and all its data. */
router.delete('/graphs/:name', (req, res) => {
  try {
    deleteGraph(req.params.name);
    ok(res, { name: req.params.name, status: 'deleted' });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nodes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /graphs/:name/nodes — upsert a single node.
 *
 * Body: {
 *   typeId: number,
 *   key: string,
 *   props?: object,
 *   denseVector?: number[],              // Float32 values; requires graph opened with denseVector config
 *   sparseVector?: [{ dimension: number, value: number }]
 * }
 *
 * Returns: { nodeId: string }   (BigInt as string)
 */
router.post('/graphs/:name/nodes', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { typeId, key, props = {}, denseVector, sparseVector } = req.body ?? {};
  if (typeId === undefined) return fail(res, 400, '"typeId" is required');
  if (!key) return fail(res, 400, '"key" is required');
  try {
    const opts = { props };
    if (denseVector) opts.denseVector = new Float32Array(denseVector);
    if (sparseVector) opts.sparseVector = sparseVector;
    const nodeId = db.upsertNode(Number(typeId), String(key), opts);
    ok(res, { nodeId: nodeId.toString() });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/nodes/batch — batch upsert nodes.
 *
 * Body: {
 *   nodes: Array<{ typeId: number, key: string, props?: object }>
 * }
 *
 * Returns: { inserted: number, nodeIds: string[] }
 */
router.post('/graphs/:name/nodes/batch', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { nodes } = req.body ?? {};
  if (!Array.isArray(nodes)) return fail(res, 400, '"nodes" array is required');
  try {
    let nodeIds;
    const mapped = nodes.map(n => ({
      typeId: Number(n.typeId),
      key: String(n.key),
      props: n.props ?? {},
    }));
    if (typeof db.batchUpsertNodes === 'function') {
      nodeIds = db.batchUpsertNodes(mapped);
    } else {
      nodeIds = mapped.map(n => db.upsertNode(n.typeId, n.key, { props: n.props }));
    }
    // batchUpsertNodes returns Float64Array; use Array.from before .map()
    const nodeIdsArr = Array.from(nodeIds).map(String);
    res.type('application/json').send(
      serialize({ ok: true, data: { inserted: nodes.length, nodeIds: nodeIdsArr } })
    );
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * GET /graphs/:name/nodes/find — find nodes by a single property equality.
 * Query params: typeId, prop, value, limit?, after?
 *
 * Example: GET /graphs/myGraph/nodes/find?typeId=1&prop=name&value=Alice
 */
router.get('/graphs/:name/nodes/find', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { typeId, prop, value, limit = '50', after } = req.query;
  if (!typeId || !prop || value === undefined) {
    return fail(res, 400, 'Query params "typeId", "prop", and "value" are required');
  }
  try {
    // findNodesPaged returns JsIdPageResult { items: Float64Array, nextCursor?: number }
    const opts = { limit: Number(limit) };
    if (after != null) opts.after = Number(after);
    const pageResult = db.findNodesPaged(Number(typeId), prop, value, opts);
    const ids = Array.from(pageResult.items ?? []).map(Number);
    const rawNodes = ids.length > 0 ? db.getNodes(ids) : [];
    const nodes = rawNodes.filter(Boolean).map(toPlainNode);
    res.type('application/json').send(serialize({ ok: true, data: nodes }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/nodes/query — full boolean node query.
 *
 * Body: {
 *   typeIds?: number[],
 *   keys?: string[],
 *   props?: {
 *     eq?: object,
 *     range?: { [prop]: { gte?, lte?, gt?, lt? } },
 *     exists?: string[],
 *     missing?: string[]
 *   },
 *   limit?: number,
 *   after?: string  (BigInt string)
 * }
 */
router.post('/graphs/:name/nodes/query', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  try {
    const body = req.body ?? {};
    // Build a QueryNodeRequest with correct camelCase field names expected by OverGraph
    const query = {};
    // typeId is SINGULAR in QueryNodeRequest; accept both typeId and typeIds from client
    if (body.typeId != null) query.typeId = Number(body.typeId);
    else if (Array.isArray(body.typeIds) && body.typeIds.length > 0) query.typeId = Number(body.typeIds[0]);
    // ids must be number[] (not BigInt)
    if (Array.isArray(body.ids)) query.ids = body.ids.map(Number);
    // keys
    if (Array.isArray(body.keys)) query.keys = body.keys.map(String);
    // filter (QueryNodeFilter — pass through)
    if (body.filter) query.filter = body.filter;
    // limit
    query.limit = Number(body.limit ?? 100);
    // after: number cursor (last node ID from previous page)
    if (body.after != null) query.after = Number(body.after);
    // allowFullScan: accept snake_case or camelCase from client; auto-enable when no narrowing
    if (body.allow_full_scan || body.allowFullScan ||
        (!body.typeId && !body.typeIds && !body.keys && !body.ids && !body.filter)) {
      query.allowFullScan = true;
    }
    // queryNodes returns JsNodePageResult { items: JsNodeRecord[], nextCursor?: number }
    const rawResult = db.queryNodes(query);
    const nodes = plainNodeArray(rawResult.items ?? []);
    res.type('application/json').send(serialize({ ok: true, data: nodes }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * GET /graphs/:name/nodes/key/:tid/:k — get node by (typeId, key).
 * NOTE: Registered BEFORE /:nodeId to avoid ambiguity.
 */
router.get('/graphs/:name/nodes/key/:tid/:k', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  try {
    const raw = db.getNodeByKey(Number(req.params.tid), req.params.k);
    if (!raw) return fail(res, 404, 'Node not found');
    res.type('application/json').send(serialize({ ok: true, data: toPlainNode(raw) }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/** GET /graphs/:name/nodes/:nodeId — get node by internal numeric ID. */
router.get('/graphs/:name/nodes/:nodeId', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  try {
    const raw = db.getNode(Number(req.params.nodeId));
    if (!raw) return fail(res, 404, 'Node not found');
    res.type('application/json').send(serialize({ ok: true, data: toPlainNode(raw) }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/** DELETE /graphs/:name/nodes/:nodeId — delete a node and its incident edges. */
router.delete('/graphs/:name/nodes/:nodeId', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  try {
    db.deleteNode(Number(req.params.nodeId));
    ok(res, { deleted: req.params.nodeId });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edges
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /graphs/:name/edges — upsert a single edge.
 *
 * Body: {
 *   fromId: string,      (BigInt as string)
 *   toId:   string,
 *   typeId: number,
 *   weight?: number,
 *   validFrom?: number,  (epoch ms)
 *   validTo?:   number
 * }
 */
router.post('/graphs/:name/edges', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { fromId, toId, typeId, weight, validFrom, validTo } = req.body ?? {};
  if (!fromId || !toId || typeId === undefined) {
    return fail(res, 400, '"fromId", "toId", and "typeId" are required');
  }
  try {
    const opts = {};
    if (weight !== undefined) opts.weight = Number(weight);
    if (validFrom !== undefined) opts.validFrom = Number(validFrom);
    if (validTo !== undefined) opts.validTo = Number(validTo);
    db.upsertEdge(Number(fromId), Number(toId), Number(typeId), opts);
    ok(res, { created: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/edges/batch — batch upsert edges.
 *
 * Body: {
 *   edges: Array<{ fromId, toId, typeId, weight?, validFrom?, validTo? }>
 * }
 */
router.post('/graphs/:name/edges/batch', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { edges } = req.body ?? {};
  if (!Array.isArray(edges)) return fail(res, 400, '"edges" array is required');
  try {
    // JsEdgeInput uses 'from'/'to' (numbers), not 'fromId'/'toId'
    const mapped = edges.map(e => ({
      from:   Number(e.fromId),
      to:     Number(e.toId),
      typeId: Number(e.typeId),
      ...(e.weight !== undefined ? { weight: Number(e.weight) } : {}),
      ...(e.validFrom !== undefined ? { validFrom: Number(e.validFrom) } : {}),
      ...(e.validTo !== undefined ? { validTo: Number(e.validTo) } : {}),
    }));

    if (typeof db.batchUpsertEdges === 'function') {
      db.batchUpsertEdges(mapped);
    } else {
      for (const e of mapped) {
        db.upsertEdge(e.fromId, e.toId, e.typeId, {
          ...(e.weight !== undefined ? { weight: e.weight } : {}),
          ...(e.validFrom !== undefined ? { validFrom: e.validFrom } : {}),
          ...(e.validTo !== undefined ? { validTo: e.validTo } : {}),
        });
      }
    }
    ok(res, { inserted: edges.length });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * DELETE /graphs/:name/edges — delete a specific edge.
 *
 * Body: { fromId: string, toId: string, typeId: number }
 */
router.delete('/graphs/:name/edges', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { fromId, toId, typeId } = req.body ?? {};
  if (!fromId || !toId || typeId === undefined) {
    return fail(res, 400, '"fromId", "toId", and "typeId" are required');
  }
  try {
    // deleteEdge takes a single edge ID; look up edge first
    const edgeRec = db.getEdgeByTriple(Number(fromId), Number(toId), Number(typeId));
    if (!edgeRec) return fail(res, 404, 'Edge not found');
    db.deleteEdge(Number(edgeRec.id));
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph Queries & Algorithms
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /graphs/:name/neighbors/:nodeId — get 1-hop neighbours.
 *
 * Query params:
 *   direction?   outgoing | incoming | both   (default: outgoing)
 *   edgeTypes?   comma-separated typeIds      (e.g. 1,2,3)
 *   limit?       number                       (default: 50)
 *   atEpoch?     epoch ms for temporal edges
 *   decayLambda? number                       (decay scoring)
 */
router.get('/graphs/:name/neighbors/:nodeId', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { direction = 'outgoing', edgeTypes, limit = '50', atEpoch, decayLambda } = req.query;
  try {
    const opts = { direction, limit: Number(limit) };
    if (edgeTypes) opts.edgeTypeFilter = edgeTypes.split(',').map(Number);
    if (atEpoch) opts.atEpoch = Number(atEpoch);
    if (decayLambda) opts.decayLambda = Number(decayLambda);
    const neighbours = db.neighbors(Number(req.params.nodeId), opts);
    res.type('application/json').send(serialize({ ok: true, data: neighbours }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/traverse — breadth-first traversal.
 *
 * Body: {
 *   startNodeId: string,
 *   maxDepth?: number      (default: 3)
 *   minDepth?: number
 *   edgeTypeFilter?: number[]
 *   nodeTypeFilter?: number[]
 *   limit?: number         (default: 200)
 *   cursor?: any           (pagination cursor from previous response)
 * }
 */
router.post('/graphs/:name/traverse', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { startNodeId, maxDepth = 3, minDepth, edgeTypeFilter, nodeTypeFilter, limit = 200, cursor } = req.body ?? {};
  if (!startNodeId) return fail(res, 400, '"startNodeId" is required');
  try {
    const opts = { limit: Number(limit) };
    if (minDepth !== undefined) opts.minDepth = Number(minDepth);
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    if (nodeTypeFilter) opts.nodeTypeFilter = nodeTypeFilter.map(Number);
    if (cursor !== undefined) opts.cursor = cursor;
    const result = db.traverse(Number(startNodeId), Number(maxDepth), opts);
    // JsTraversalPageResult { items: JsTraversalHit[], nextCursor? } — safely extract
    const safeResult = {
      items: Array.from(result.items ?? []).map(h => ({
        nodeId:    Number(h.nodeId),
        depth:     Number(h.depth),
        viaEdgeId: h.viaEdgeId != null ? Number(h.viaEdgeId) : null,
      })),
      nextCursor: result.nextCursor ?? null,
    };
    res.type('application/json').send(serialize({ ok: true, data: safeResult }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/shortest-path — BFS (unweighted) or Dijkstra (weighted).
 *
 * Body: {
 *   fromId: string,
 *   toId: string,
 *   weighted?: boolean     (default: false → BFS)
 *   edgeTypeFilter?: number[]
 * }
 */
router.post('/graphs/:name/shortest-path', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { fromId, toId, weighted = false, edgeTypeFilter } = req.body ?? {};
  if (!fromId || !toId) return fail(res, 400, '"fromId" and "toId" are required');
  try {
    const opts = { weighted: Boolean(weighted) };
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    const path = db.shortestPath(Number(fromId), Number(toId), opts);
    res.type('application/json').send(serialize({ ok: true, data: path }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/pagerank — personalized PageRank from seed nodes.
 *
 * Body: {
 *   seedIds: string[],          (BigInt strings)
 *   dampingFactor?: number      (default: 0.85)
 *   topK?: number               (default: 20)
 *   fast?: boolean              (default: true — forward-push approximation)
 *   edgeTypeFilter?: number[]
 * }
 */
router.post('/graphs/:name/pagerank', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { seedIds, dampingFactor = 0.85, topK = 20, fast = true, edgeTypeFilter } = req.body ?? {};
  if (!Array.isArray(seedIds) || seedIds.length === 0) {
    return fail(res, 400, '"seedIds" must be a non-empty array of node ID strings');
  }
  try {
    const opts = {
      dampingFactor: Number(dampingFactor),
      topK: Number(topK),
      fast: Boolean(fast),
    };
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    const result = db.personalizedPagerank(seedIds.map(Number), opts);
    res.type('application/json').send(serialize({ ok: true, data: result }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/subgraph — extract a local subgraph up to N hops.
 *
 * Body: {
 *   startNodeId: string,
 *   maxDepth?: number      (default: 3)
 *   edgeTypeFilter?: number[]
 * }
 */
router.post('/graphs/:name/subgraph', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { startNodeId, maxDepth = 3, edgeTypeFilter } = req.body ?? {};
  if (!startNodeId) return fail(res, 400, '"startNodeId" is required');
  try {
    const opts = {};
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    // OverGraph uses extractSubgraph (not subgraph)
    const raw = db.extractSubgraph(Number(startNodeId), Number(maxDepth), opts);
    // nodes and edges live on the prototype — must be manually extracted
    const result = {
      nodes: Array.from(raw.nodes ?? []).map(toPlainNode),
      edges: Array.from(raw.edges ?? []).map(toPlainEdge),
    };
    res.type('application/json').send(serialize({ ok: true, data: result }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/degrees — count edges / sum weights for a set of nodes.
 *
 * Body: {
 *   nodeIds: string[],
 *   direction?: 'outgoing' | 'incoming' | 'both'   (default: 'both')
 *   edgeTypeFilter?: number[]
 * }
 */
router.post('/graphs/:name/degrees', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { nodeIds, direction = 'both', edgeTypeFilter } = req.body ?? {};
  if (!Array.isArray(nodeIds)) return fail(res, 400, '"nodeIds" array is required');
  try {
    const opts = { direction };
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    const result = db.degrees(nodeIds.map(Number), opts);
    res.type('application/json').send(serialize({ ok: true, data: result }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/components — connected-component analysis.
 *
 * Body: {
 *   nodeId?: string        if provided, returns only that node's component (BFS)
 *                          if omitted, runs global WCC labelling (union-find)
 *   edgeTypeFilter?: number[]
 *   nodeTypeFilter?: number[]
 * }
 */
router.post('/graphs/:name/components', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const { nodeId, edgeTypeFilter, nodeTypeFilter } = req.body ?? {};
  try {
    const opts = {};
    if (edgeTypeFilter) opts.edgeTypeFilter = edgeTypeFilter.map(Number);
    if (nodeTypeFilter) opts.nodeTypeFilter = nodeTypeFilter.map(Number);
    const raw = nodeId
      ? db.componentOf(Number(nodeId), opts)
      : db.connectedComponents(opts);
    // componentOf returns Float64Array of node IDs in the component
    // connectedComponents returns Array<{ nodeId: number, componentId: number }>
    let result;
    if (nodeId) {
      // Float64Array → array of string node IDs
      result = { nodeIds: Array.from(raw).map(id => String(Math.round(id))) };
    } else {
      // Array<JsComponentEntry> is already a plain serialisable array
      result = { components: raw };
    }
    res.type('application/json').send(serialize({ ok: true, data: result }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * POST /graphs/:name/search — vector search (dense / sparse / hybrid).
 * Requires the graph to have been created with a denseVector config.
 *
 * Body: {
 *   mode?: 'dense' | 'sparse' | 'hybrid'   (default: 'dense')
 *   k?: number                              (default: 10)
 *   denseQuery?: number[]                   Float32 embedding
 *   sparseQuery?: [{ dimension: number, value: number }]
 *   scope?: { startNodeId: string, maxDepth?: number }
 *   typeFilter?: number[]
 *   denseWeight?: number
 *   sparseWeight?: number
 *   fusionMode?: 'WeightedRankFusion' | 'ReciprocalRankFusion' | 'WeightedScoreFusion'
 * }
 */
router.post('/graphs/:name/search', heavyLimit, (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const {
    mode = 'dense',
    k = 10,
    denseQuery,
    sparseQuery,
    scope,
    typeFilter,
    denseWeight,
    sparseWeight,
    fusionMode,
  } = req.body ?? {};
  try {
    const opts = { k: Number(k) };
    if (denseQuery) opts.denseQuery = new Float32Array(denseQuery);
    if (sparseQuery) opts.sparseQuery = sparseQuery;
    if (scope?.startNodeId) {
      opts.scope = {
        startNodeId: Number(scope.startNodeId),
        maxDepth: Number(scope.maxDepth ?? 3),
      };
    }
    if (typeFilter) opts.typeFilter = typeFilter.map(Number);
    if (denseWeight !== undefined) opts.denseWeight = Number(denseWeight);
    if (sparseWeight !== undefined) opts.sparseWeight = Number(sparseWeight);
    if (fusionMode) opts.fusionMode = fusionMode;

    const hits = db.vectorSearch(mode, opts);
    res.type('application/json').send(serialize({ ok: true, data: hits }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Atomic Patch
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /graphs/:name/patch — apply a set of node/edge mutations atomically.
 *
 * Body: {
 *   upsertNodes?:    Array<{ typeId, key, props? }>
 *   upsertEdges?:    Array<{ fromId, toId, typeId, weight? }>
 *   deleteNodes?:    string[]
 *   deleteEdges?:    Array<{ fromId, toId, typeId }>
 *   invalidateEdges?: Array<{ fromId, toId, typeId }>
 * }
 */
router.post('/graphs/:name/patch', (req, res) => {
  const db = requireGraph(req, res);
  if (!db) return;
  const {
    upsertNodes = [],
    upsertEdges = [],
    deleteNodes = [],
    deleteEdges = [],
    invalidateEdges = [],
  } = req.body ?? {};
  try {
    // JsGraphPatch field names per OverGraph API:
    //   upsertEdges: JsEdgeInput[] uses from/to (numbers)
    //   deleteNodeIds: number[]
    //   deleteEdgeIds: number[]
    //   invalidateEdges: JsEdgeInvalidation[] = { edgeId, validTo }
    const patch = {
      upsertNodes: upsertNodes.map(n => ({
        typeId: Number(n.typeId),
        key: String(n.key),
        props: n.props ?? {},
      })),
      upsertEdges: upsertEdges.map(e => ({
        from:   Number(e.fromId),
        to:     Number(e.toId),
        typeId: Number(e.typeId),
        ...(e.weight !== undefined ? { weight: Number(e.weight) } : {}),
      })),
      deleteNodeIds: deleteNodes.map(Number),
      deleteEdgeIds: deleteEdges.map(Number),
      invalidateEdges: invalidateEdges.map(e => ({
        edgeId:  Number(e.edgeId),
        validTo: Number(e.validTo),
      })),
    };
    const result = db.graphPatch(patch);
    res.type('application/json').send(serialize({ ok: true, data: result ?? { applied: true } }));
  } catch (err) {
    fail(res, 500, err.message);
  }
});

export default router;
