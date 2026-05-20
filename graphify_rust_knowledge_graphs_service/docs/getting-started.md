# Getting Started

This guide walks you through installing, running, and using the Graphify
Knowledge Graph Service from scratch.

---

## Prerequisites

| Requirement | Minimum version | Install |
|-------------|----------------|---------|
| Rust toolchain | 1.85 | https://rustup.rs |
| graphify-rs CLI | latest | `cargo install graphify-rs` |

---

## 1. Install the graphify-rs CLI

The service shells out to the `graphify-rs` binary for all build and query
operations. Install it once globally:

```powershell
cargo install graphify-rs
```

Verify it is on your PATH:

```powershell
graphify-rs --version
```

---

## 2. Start the server

```powershell
cd graphify_rust_knowledge_graphs_service
cargo run --release
```

You should see:

```
INFO Graphify Knowledge Graph Service listening on http://0.0.0.0:3741
```

The server looks for (and creates if missing) a `data/` folder in whichever
directory you run `cargo run` from.

### Change the port

Set the `PORT` environment variable before running:

```powershell
$env:PORT = "8080"; cargo run --release
```

---

## 3. Full workflow example

### Step 1 — Create a graph

```bash
curl -X POST http://localhost:3741/graphs \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```

This creates the directory `data/my-project/`.

---

### Step 2 — Add markdown files

Write your notes, documentation, or any knowledge into `.md` files.
Each file becomes a node in the graph.

```bash
curl -X PUT http://localhost:3741/graphs/my-project/files/overview.md \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Overview\n\nThis project handles user authentication and billing.\n\nSee [[auth]] and [[billing]] for details."
  }'

curl -X PUT http://localhost:3741/graphs/my-project/files/auth.md \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Authentication\n\nJWT tokens are issued on login. Tokens expire after 24 hours.\n\nThe refresh flow is described in [[billing]]."
  }'

curl -X PUT http://localhost:3741/graphs/my-project/files/billing.md \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Billing\n\nStripe is used for all payments. A valid JWT is required for every billing API call."
  }'
```

You can also just drop `.md` files directly into `data/my-project/` using
Windows Explorer or any editor. The API is there for programmatic access.

---

### Step 3 — Build the knowledge graph

```bash
curl -X POST http://localhost:3741/graphs/my-project/build
```

This runs AST extraction (no API key needed) and writes output to
`data/my-project/graphify-out/`. Building 3 files takes under a second.

To also get the analysis report:

```bash
curl -X POST "http://localhost:3741/graphs/my-project/build?format=json,html,report"
```

---

### Step 4 — Query the graph

```bash
curl --get http://localhost:3741/graphs/my-project/query \
  --data-urlencode "q=how does authentication connect to billing?"
```

Response:

```json
{
  "graph_name": "my-project",
  "question": "how does authentication connect to billing?",
  "answer": "Authentication (auth.md) issues JWT tokens which are required by the billing module..."
}
```

---

### Step 5 — Update a file and rebuild incrementally

Edit a file:

```bash
curl -X PUT http://localhost:3741/graphs/my-project/files/auth.md \
  -H "Content-Type: application/json" \
  -d '{"content": "# Authentication\n\nNow using OAuth2 instead of plain JWT."}'
```

Rebuild only the changed file:

```bash
curl -X POST "http://localhost:3741/graphs/my-project/build?incremental=true"
```

---

## 4. Managing multiple graphs

Each directory under `data/` is an independent graph. You can have as many as
you like:

```
data/
├── project-alpha/    ← one team's knowledge base
├── project-beta/     ← another team's knowledge base
└── research/         ← personal research notes
```

```bash
# List all graphs and their build status
curl http://localhost:3741/graphs
```

---

## 5. Opening the visual graph

After building with the `html` format (the default), open the interactive
visualization in your browser:

```
data/<graph-name>/graphify-out/graph.html
```

Open it directly in Windows Explorer or serve the folder with any static file
server. The visualization lets you drag nodes, zoom, and click on any node to
see its connections.

---

## 6. Next steps

- [API Reference](./api.md) — full endpoint documentation
- [LLM Configuration](./llm-config.md) — enable semantic extraction with Claude, GPT-4, or Ollama
