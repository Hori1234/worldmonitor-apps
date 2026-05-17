// Knowledge Graph Service API endpoint definitions
// Paths are relative — the urlPrefix '/api/kg' is prepended by the explorer factory.

export const KG_ENDPOINTS = [
  // ── Health ──────────────────────────────────────────────────────────────────
  {
    group: 'Health', method: 'GET', path: '/health',
    desc: 'Service status and open graph count.',
  },

  // ── Graph Management ────────────────────────────────────────────────────────
  {
    group: 'Graphs', method: 'GET', path: '/graphs',
    desc: 'List all graphs on disk with status and size.',
  },
  {
    group: 'Graphs', method: 'POST', path: '/graphs',
    desc: 'Create a new graph.',
    body: JSON.stringify({ name: 'my-graph', options: { denseVector: { dimension: 384, metric: 'cosine' } } }, null, 2),
  },
  {
    group: 'Graphs', method: 'POST', path: '/graphs/combine',
    desc: 'Merge multiple source graphs into a new target graph.',
    body: JSON.stringify({ sources: ['graph-a', 'graph-b'], target: 'combined', options: {} }, null, 2),
  },
  {
    group: 'Graphs', method: 'GET', path: '/graphs/:name',
    desc: 'Get info and disk size for a graph.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
  },
  {
    group: 'Graphs', method: 'POST', path: '/graphs/:name/open',
    desc: 'Open an existing on-disk graph (reopens closed graphs).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ options: {} }, null, 2),
  },
  {
    group: 'Graphs', method: 'POST', path: '/graphs/:name/close',
    desc: 'Flush and close a graph (keeps data on disk).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: '{}',
  },
  {
    group: 'Graphs', method: 'POST', path: '/graphs/:name/recreate',
    desc: 'Wipe all data and reopen as an empty graph.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ options: {} }, null, 2),
  },
  {
    group: 'Graphs', method: 'DELETE', path: '/graphs/:name',
    desc: 'Permanently delete a graph and all data.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
  },

  // ── Nodes ───────────────────────────────────────────────────────────────────
  {
    group: 'Nodes', method: 'POST', path: '/graphs/:name/nodes',
    desc: 'Upsert a single node by (typeId, key).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ typeId: 1, key: 'user:alice', props: { name: 'Alice', role: 'admin' } }, null, 2),
  },
  {
    group: 'Nodes', method: 'POST', path: '/graphs/:name/nodes/batch',
    desc: 'Batch upsert multiple nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ nodes: [
      { typeId: 1, key: 'user:alice', props: { name: 'Alice' } },
      { typeId: 1, key: 'user:bob',   props: { name: 'Bob' } },
    ]}, null, 2),
  },
  {
    group: 'Nodes', method: 'GET', path: '/graphs/:name/nodes/:nodeId',
    desc: 'Get a node by its internal numeric ID.',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
  },
  {
    group: 'Nodes', method: 'GET', path: '/graphs/:name/nodes/key/:typeId/:key',
    desc: 'Get a node by (typeId, key).',
    pathParams: [
      { name: 'name',   default: 'my-graph' },
      { name: 'typeId', default: '1' },
      { name: 'key',    default: 'user:alice' },
    ],
  },
  {
    group: 'Nodes', method: 'GET', path: '/graphs/:name/nodes/find',
    desc: 'Find nodes by a single property equality.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    queryParams: [
      { name: 'typeId', default: '1' },
      { name: 'prop',   default: 'role' },
      { name: 'value',  default: 'admin' },
      { name: 'limit',  default: '50' },
    ],
  },
  {
    group: 'Nodes', method: 'POST', path: '/graphs/:name/nodes/query',
    desc: 'Full boolean node query with type, key, and property filters.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ typeIds: [1], limit: 50, props: { eq: { role: 'admin' } } }, null, 2),
  },
  {
    group: 'Nodes', method: 'DELETE', path: '/graphs/:name/nodes/:nodeId',
    desc: 'Delete a node (cascades to incident edges).',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
  },

  // ── Edges ───────────────────────────────────────────────────────────────────
  {
    group: 'Edges', method: 'POST', path: '/graphs/:name/edges',
    desc: 'Upsert a directed edge between two nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '2', typeId: 10, weight: 1.0 }, null, 2),
  },
  {
    group: 'Edges', method: 'POST', path: '/graphs/:name/edges/batch',
    desc: 'Batch upsert multiple edges.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ edges: [
      { fromId: '1', toId: '2', typeId: 10, weight: 1.0 },
      { fromId: '2', toId: '3', typeId: 11, weight: 0.5 },
    ]}, null, 2),
  },
  {
    group: 'Edges', method: 'DELETE', path: '/graphs/:name/edges',
    desc: 'Delete a specific edge.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '2', typeId: 10 }, null, 2),
  },

  // ── Graph Queries ────────────────────────────────────────────────────────────
  {
    group: 'Queries', method: 'GET', path: '/graphs/:name/neighbors/:nodeId',
    desc: 'Get 1-hop neighbours of a node.',
    pathParams: [{ name: 'name', default: 'my-graph' }, { name: 'nodeId', default: '1' }],
    queryParams: [
      { name: 'direction', default: 'outgoing' },
      { name: 'limit',     default: '50' },
    ],
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/traverse',
    desc: 'BFS traversal up to maxDepth hops.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ startNodeId: '1', maxDepth: 3, limit: 200 }, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/shortest-path',
    desc: 'Shortest path between two nodes (BFS or Dijkstra).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ fromId: '1', toId: '10', weighted: false }, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/pagerank',
    desc: 'Personalized PageRank from seed nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ seedIds: ['1'], topK: 20, dampingFactor: 0.85, fast: true }, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/subgraph',
    desc: 'Extract a local subgraph up to N hops from a start node.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ startNodeId: '1', maxDepth: 2 }, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/degrees',
    desc: 'Count edges and sum weights for a set of nodes.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ nodeIds: ['1', '2'], direction: 'both' }, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/components',
    desc: 'Connected-component analysis (global WCC or single-node component).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({}, null, 2),
  },
  {
    group: 'Queries', method: 'POST', path: '/graphs/:name/search',
    desc: 'Dense / sparse / hybrid vector search (requires denseVector config).',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({ mode: 'dense', k: 10, denseQuery: [] }, null, 2),
  },

  // ── Atomic Patch ─────────────────────────────────────────────────────────────
  {
    group: 'Patch', method: 'POST', path: '/graphs/:name/patch',
    desc: 'Atomically apply a set of node/edge mutations.',
    pathParams: [{ name: 'name', default: 'my-graph' }],
    body: JSON.stringify({
      upsertNodes: [{ typeId: 1, key: 'user:new', props: { name: 'New User' } }],
      upsertEdges: [{ fromId: '1', toId: '2', typeId: 10 }],
      deleteNodes: [],
      deleteEdges: [],
    }, null, 2),
  },
];
