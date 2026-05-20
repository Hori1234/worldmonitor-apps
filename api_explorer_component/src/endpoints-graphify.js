// Graphify Knowledge Graphs Service API endpoint definitions
// Paths are relative — the urlPrefix '/api/graphify' is prepended by the explorer factory.

export const GRAPHIFY_ENDPOINTS = [

  // ── Health / Help ──────────────────────────────────────────────────────────
  {
    group: 'Health', method: 'GET', path: '/health',
    desc: 'Service liveness check.',
  },
  {
    group: 'Health', method: 'GET', path: '/help',
    desc: 'Returns the full graphify-ts --help output.',
  },

  // ── Graph Discovery ────────────────────────────────────────────────────────
  {
    group: 'Graphs', method: 'GET', path: '/graphs',
    desc: 'List all directories under data/ with hasGraph flag and active watcher status.',
  },
  {
    group: 'Graphs', method: 'GET', path: '/graphs/:name',
    desc: 'Get info for a single graph: path, hasGraph, graphJsonPath, watcher.',
    pathParams: [{ name: 'name', default: 'my-project' }],
  },

  // ── Graph Build ────────────────────────────────────────────────────────────
  {
    group: 'Build', method: 'POST', path: '/graphs/:name/generate',
    desc: 'Run `graphify-ts generate .` inside the named graph directory. Pass spi:true to enable the SPI framework-metadata pipeline.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ spi: false }, null, 2),
  },
  {
    group: 'Build', method: 'POST', path: '/graphs/:name/generate',
    desc: 'Run `graphify-ts generate . --spi` (framework metadata + disk cache).',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ spi: true }, null, 2),
  },

  // ── Watch ──────────────────────────────────────────────────────────────────
  {
    group: 'Watch', method: 'POST', path: '/graphs/:name/watch/start',
    desc: 'Start a `graphify-ts watch .` process for the named graph. Returns pid and startedAt.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: '{}',
  },
  {
    group: 'Watch', method: 'POST', path: '/graphs/:name/watch/stop',
    desc: 'Stop the active watcher process for the named graph.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: '{}',
  },
  {
    group: 'Watch', method: 'GET', path: '/graphs/:name/watch/status',
    desc: 'Check whether a watcher is currently running for the named graph.',
    pathParams: [{ name: 'name', default: 'my-project' }],
  },

  // ── Query / Context ────────────────────────────────────────────────────────
  {
    group: 'Query', method: 'GET', path: '/graphs/:name/summary',
    desc: 'Run `graphify-ts summary` — returns a bounded JSON overview of the graph before deeper retrieval.',
    pathParams: [{ name: 'name', default: 'my-project' }],
  },
  {
    group: 'Query', method: 'POST', path: '/graphs/:name/pack',
    desc: 'Run `graphify-ts pack "<query>" --task <task>` to produce a compact context payload.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ query: 'how does auth work?', task: 'explain' }, null, 2),
  },
  {
    group: 'Query', method: 'POST', path: '/graphs/:name/pack',
    desc: 'Pack with custom retrieval strategy (e.g. slice-v1).',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ query: 'why does auth fail?', task: 'explain', retrievalStrategy: 'slice-v1' }, null, 2),
  },
  {
    group: 'Query', method: 'POST', path: '/graphs/:name/prompt',
    desc: 'Run `graphify-ts prompt "<query>" --provider <provider>` — returns a provider-ready compiled prompt.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ query: 'how does auth work?', provider: 'claude' }, null, 2),
  },

  // ── Benchmark / Comparison ─────────────────────────────────────────────────
  {
    group: 'Benchmark', method: 'POST', path: '/graphs/:name/review-compare',
    desc: 'Run `graphify-ts review-compare graphify-out/graph.json --exec "..." --yes` for PR review benchmark.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ exec: 'claude --output-format json', graphPath: 'graphify-out/graph.json' }, null, 2),
  },
  {
    group: 'Benchmark', method: 'POST', path: '/graphs/:name/compare',
    desc: 'Run `graphify-ts compare "<query>" --exec "..." --yes` to benchmark graphify vs native agent.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ query: 'How does auth work?', exec: 'claude --output-format json' }, null, 2),
  },
  {
    group: 'Benchmark', method: 'POST', path: '/graphs/:name/compare',
    desc: 'Compare with a specific baseline mode (e.g. pack_only).',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ query: 'How does auth work?', exec: 'claude --output-format json', baselineMode: 'pack_only' }, null, 2),
  },

  // ── History ────────────────────────────────────────────────────────────────
  {
    group: 'History', method: 'POST', path: '/graphs/:name/time-travel',
    desc: 'Run `graphify-ts time-travel <ref1> <ref2> --view <view>` to see what changed between two git refs.',
    pathParams: [{ name: 'name', default: 'my-project' }],
    body: JSON.stringify({ ref1: 'main', ref2: 'HEAD', view: 'risk' }, null, 2),
  },

  // ── Multi-graph ────────────────────────────────────────────────────────────
  {
    group: 'Multi-Graph', method: 'POST', path: '/federate',
    desc: 'Run `graphify-ts federate` across multiple named graphs — merges their graph.json files into a federated graph.',
    body: JSON.stringify({ graphs: ['frontend', 'backend'], outputDir: 'federated' }, null, 2),
  },
];
