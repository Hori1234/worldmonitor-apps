# Graphify Knowledge Graph Service — API Reference

Base URL: `http://localhost:3741`

All request and response bodies are JSON. All error responses have the shape:

```json
{ "error": "human-readable message" }
```

---

## Table of Contents

1. [Health](#1-health)
2. [List graphs](#2-list-graphs)
3. [Create a graph](#3-create-a-graph)
4. [Delete a graph](#4-delete-a-graph)
5. [Build / rebuild a graph](#5-build--rebuild-a-graph)
6. [Graph status](#6-graph-status)
7. [Get graph.json](#7-get-graphjson)
8. [Get analysis report](#8-get-analysis-report)
9. [Query a graph](#9-query-a-graph)
10. [List files](#10-list-files)
11. [Create or update a file](#11-create-or-update-a-file)
12. [Get a file](#12-get-a-file)
13. [Delete a file](#13-delete-a-file)
14. [Error reference](#14-error-reference)

---

## 1. Health

```
GET /health
```

Returns the service version and confirms it is running.

**Response 200**

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

**Example**

```bash
curl http://localhost:3741/health
```

---

## 2. List graphs

```
GET /graphs
```

Returns every subdirectory that exists inside `data/`, regardless of whether it
has been built yet.

**Response 200** — array of graph objects

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Directory name, e.g. `"graph1"` |
| `built` | boolean | `true` when `graphify-out/graph.json` exists |
| `file_count` | number | Number of `.md` files in the directory |
| `output_dir` | string | Relative path to the generated output, e.g. `"data/graph1/graphify-out"` |

```json
[
  {
    "name": "graph1",
    "built": true,
    "file_count": 3,
    "output_dir": "data/graph1/graphify-out"
  },
  {
    "name": "graph2",
    "built": false,
    "file_count": 1,
    "output_dir": "data/graph2/graphify-out"
  }
]
```

**Example**

```bash
curl http://localhost:3741/graphs
```

---

## 3. Create a graph

```
POST /graphs
Content-Type: application/json
```

Creates the directory `data/<name>/`. The name must contain only letters,
digits, hyphens (`-`), and underscores (`_`).

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Identifier for the graph, e.g. `"my-project"` |

```json
{ "name": "my-project" }
```

**Response 201**

```json
{
  "name": "my-project",
  "built": false,
  "file_count": 0,
  "output_dir": "data/my-project/graphify-out"
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 400 | Name contains invalid characters |
| 409 | A graph with that name already exists |

**Example**

```bash
curl -X POST http://localhost:3741/graphs \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```

---

## 4. Delete a graph

```
DELETE /graphs/:name
```

Permanently removes `data/<name>/` and everything inside it, including any
built output.

**Response 204** — no body

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist |

**Example**

```bash
curl -X DELETE http://localhost:3741/graphs/my-project
```

---

## 5. Build / rebuild a graph

```
POST /graphs/:name/build
```

Runs `graphify-rs build` against `data/<name>/` and writes output to
`data/<name>/graphify-out/`.

This is the core operation. Call it after creating a graph and adding `.md`
files, and again whenever you edit those files.

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `use_llm` | boolean | `false` | Enable LLM semantic extraction (Pass 2). Discovers conceptual links between documents. Requires an API key — see [LLM configuration](./llm-config.md). |
| `format` | string | `json,html` | Comma-separated list of output formats to generate. Available values: `json`, `html`, `graphml`, `cypher`, `svg`, `wiki`, `obsidian`, `report`. |
| `incremental` | boolean | `false` | Only re-process files that changed since the last build. Much faster (~2–5 s) for large graphs. |

### Build passes

**Pass 1 — AST extraction** (always runs, free, no API key needed)  
Parses every `.md` file with tree-sitter. Extracts headings, links, code blocks,
and relationships between them. All edges are tagged `EXTRACTED` with confidence 1.0.

**Pass 2 — Semantic extraction** (only when `use_llm=true`)  
Sends documents to an LLM (Anthropic, OpenAI, Ollama, or OpenAI-compatible) to
discover conceptual connections, shared assumptions, and design intent. Edges are
tagged `INFERRED` with confidence 0.4–0.9.

### Output files written to `data/<name>/graphify-out/`

| File | Description |
|------|-------------|
| `graph.json` | Full graph as NetworkX node-link JSON — used for all queries |
| `graph.html` | Interactive browser visualization (drag nodes, zoom, search) |
| `GRAPH_REPORT.md` | Analysis: god nodes, surprising connections, suggested questions |
| `html/` | Per-community HTML pages |
| `wiki/` | Wiki pages with wikilinks |
| `obsidian/` | Obsidian vault with backlinks |
| `graph.svg` | Static SVG export |
| `graph.graphml` | GraphML for yEd / Gephi |
| `cypher.txt` | Neo4j import script |

**Response 200**

```json
{
  "success": true,
  "graph_name": "my-project",
  "output": "... graphify-rs stdout ..."
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph directory does not exist |
| 503 | `graphify-rs` binary is not installed or not in PATH |
| 500 | Build failed — check `output` field for the error message from graphify-rs |

**Examples**

```bash
# Fast AST-only build (no API key required)
curl -X POST http://localhost:3741/graphs/my-project/build

# Only generate JSON and HTML
curl -X POST "http://localhost:3741/graphs/my-project/build?format=json,html"

# Incremental rebuild after editing a few files
curl -X POST "http://localhost:3741/graphs/my-project/build?incremental=true"

# Full build with LLM semantic extraction
curl -X POST "http://localhost:3741/graphs/my-project/build?use_llm=true"

# LLM + incremental + only JSON output
curl -X POST "http://localhost:3741/graphs/my-project/build?use_llm=true&incremental=true&format=json"
```

---

## 6. Graph status

```
GET /graphs/:name/status
```

Returns build status and file count for a single graph without triggering a build.

**Response 200**

```json
{
  "name": "my-project",
  "built": true,
  "file_count": 5,
  "output_dir": "data/my-project/graphify-out"
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist |

**Example**

```bash
curl http://localhost:3741/graphs/my-project/status
```

---

## 7. Get graph.json

```
GET /graphs/:name/graph.json
```

Returns the raw `graph.json` produced by the last build. This is a
NetworkX-compatible `node_link_data` JSON document. You can load it directly
into NetworkX, vis.js, D3.js, or any other graph library.

**Response 200** — `Content-Type: application/json`

The full graph JSON. Structure overview:

```json
{
  "directed": true,
  "multigraph": false,
  "graph": {},
  "nodes": [
    {
      "id": "notes",
      "label": "notes",
      "type": "file",
      "community": 0,
      "pagerank": 0.15
    }
  ],
  "links": [
    {
      "source": "notes",
      "target": "auth",
      "relation": "references",
      "confidence": 1.0,
      "provenance": "EXTRACTED"
    }
  ]
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist, or has never been built |

**Example**

```bash
curl http://localhost:3741/graphs/my-project/graph.json | python -m json.tool
```

---

## 8. Get analysis report

```
GET /graphs/:name/report
```

Returns the `GRAPH_REPORT.md` file as plain text. This document contains:

- **God nodes** — the most-connected hub nodes in the graph
- **Surprising connections** — cross-community links found by community detection
- **Suggested questions** — questions the graph is well-positioned to answer

The report is only generated when `format` includes `report` (or all formats).
The default build (`format=json,html`) does **not** include it. To generate it:

```bash
curl -X POST "http://localhost:3741/graphs/my-project/build?format=json,html,report"
```

**Response 200** — `Content-Type: text/plain`

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist, or has not been built with the `report` format |

---

## 9. Query a graph

```
GET /graphs/:name/query?q=<question>
```

Runs `graphify-rs query` against the built graph and returns the most relevant
subgraph context as a natural-language answer.

The graph must have been built at least once before querying.

### Query parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | yes | — | Natural-language question, e.g. `"how does auth work?"` |
| `dfs` | boolean | no | `false` | Use depth-first search instead of breadth-first for graph traversal. DFS explores deeper paths; BFS covers broader neighbourhoods. |
| `budget` | number | no | `2000` | Maximum token budget for the returned context. Increase for larger graphs or more detailed answers. |

**Response 200**

```json
{
  "graph_name": "my-project",
  "question": "how does auth work?",
  "answer": "Authentication is handled by the auth module which uses JWT tokens..."
}
```

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist, or has not been built yet |
| 503 | `graphify-rs` binary is not installed or not in PATH |

**Examples**

```bash
# Basic question
curl "http://localhost:3741/graphs/my-project/query?q=how+does+auth+work"

# URL-encoded question
curl --get http://localhost:3741/graphs/my-project/query \
  --data-urlencode "q=what are the main components of this system?"

# Deeper traversal with larger context window
curl --get http://localhost:3741/graphs/my-project/query \
  --data-urlencode "q=explain the data flow" \
  --data-urlencode "dfs=true" \
  --data-urlencode "budget=4000"
```

---

## 10. List files

```
GET /graphs/:name/files
```

Returns all `.md` files in `data/<name>/`.

**Response 200**

```json
[
  { "name": "architecture.md", "size_bytes": 1420 },
  { "name": "auth.md",         "size_bytes": 893  },
  { "name": "overview.md",     "size_bytes": 2105 }
]
```

**Errors**

| Status | Reason |
|--------|--------|
| 404 | Graph does not exist |

**Example**

```bash
curl http://localhost:3741/graphs/my-project/files
```

---

## 11. Create or update a file

```
PUT /graphs/:name/files/:filename
Content-Type: application/json
```

Creates or fully overwrites `data/<name>/<filename>` with the provided markdown
content. Only `.md` filenames are accepted. After writing files, call
[build](#5-build--rebuild-a-graph) to recompute the graph.

**URL constraints**

- `:filename` must end in `.md`
- No path separators (`/`, `\`) or `..` are allowed

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | Full markdown text to write |

```json
{
  "content": "# Authentication\n\nThis service uses JWT tokens issued by the auth module.\n\nSee also: [[overview]].\n"
}
```

**Response 204** — no body

**Errors**

| Status | Reason |
|--------|--------|
| 400 | Filename is invalid (not `.md`, contains path separators, etc.) |
| 404 | Graph does not exist |

**Examples**

```bash
# Create a new file
curl -X PUT http://localhost:3741/graphs/my-project/files/auth.md \
  -H "Content-Type: application/json" \
  -d '{"content": "# Auth\n\nJWT-based authentication."}'

# Overwrite an existing file
curl -X PUT http://localhost:3741/graphs/my-project/files/auth.md \
  -H "Content-Type: application/json" \
  -d '{"content": "# Auth\n\nUpdated: now uses OAuth2."}'
```

---

## 12. Get a file

```
GET /graphs/:name/files/:filename
```

Returns the raw markdown content of `data/<name>/<filename>` as plain text.

**Response 200** — `Content-Type: text/plain`

**Errors**

| Status | Reason |
|--------|--------|
| 400 | Filename is invalid |
| 404 | Graph or file does not exist |

**Example**

```bash
curl http://localhost:3741/graphs/my-project/files/auth.md
```

---

## 13. Delete a file

```
DELETE /graphs/:name/files/:filename
```

Removes `data/<name>/<filename>`. Does not automatically rebuild the graph.

**Response 204** — no body

**Errors**

| Status | Reason |
|--------|--------|
| 400 | Filename is invalid |
| 404 | Graph or file does not exist |

**Example**

```bash
curl -X DELETE http://localhost:3741/graphs/my-project/files/old-notes.md
```

---

## 14. Error reference

| HTTP Status | Meaning |
|-------------|---------|
| 204 | Success, no body returned |
| 400 Bad Request | Invalid graph name or filename |
| 404 Not Found | Graph or file does not exist; or graph has not been built yet |
| 409 Conflict | A graph with that name already exists |
| 503 Service Unavailable | `graphify-rs` binary is not found in PATH — run `cargo install graphify-rs` |
| 500 Internal Server Error | Unexpected error; check the `error` field for details |
