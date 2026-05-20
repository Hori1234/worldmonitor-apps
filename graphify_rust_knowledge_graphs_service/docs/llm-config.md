# LLM Configuration

By default every build runs **AST-only (Pass 1)** and requires no API key.
To enable **semantic extraction (Pass 2)** pass `?use_llm=true` to the build
endpoint and configure an LLM provider using one of the methods below.

---

## Option A — Environment variable (simplest)

Set `ANTHROPIC_API_KEY` before starting the server:

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
cargo run --release
```

```bash
# bash / macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...
cargo run --release
```

graphify-rs will automatically pick up the key and use Claude for Pass 2.

---

## Option B — Per-graph `graphify.toml`

Drop a `graphify.toml` file inside `data/<graph-name>/`. This lets each graph
use a different provider or model.

```
data/
├── graph1/
│   ├── graphify.toml   ← config for graph1 only
│   └── notes.md
└── graph2/
    └── notes.md        ← graph2 uses env var fallback
```

### Anthropic Claude

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-5"
anthropic_api_key = "sk-ant-..."   # optional: falls back to ANTHROPIC_API_KEY env var
```

### OpenAI

```toml
[llm]
provider = "openai"
model = "gpt-4o"
openai_api_key = "sk-..."          # optional: falls back to OPENAI_API_KEY env var
```

### Ollama (local, free)

Run Ollama locally (`ollama serve`) then point graphify-rs at it:

```toml
[llm]
provider = "ollama"
model = "llama3"
ollama_base_url = "http://localhost:11434"   # default, can be omitted
```

### OpenAI-compatible (vLLM, LM Studio, etc.)

```toml
[llm]
provider = "openai_compatible"
model = "my-fine-tuned-model"
openai_compatible_base_url = "http://localhost:8000/v1"
openai_compatible_api_key = "..."            # optional
```

---

## Precedence rules

1. **CLI flags** passed by the service to graphify-rs (highest priority)
2. **`graphify.toml`** in the graph directory
3. **Environment variables** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
4. **Built-in defaults** (lowest priority)

---

## Running a build with LLM

```bash
curl -X POST "http://localhost:3741/graphs/my-project/build?use_llm=true"
```

LLM extraction runs concurrently across documents (default: 4 workers).
For large graphs this can take tens of seconds to several minutes depending
on document count and model latency.

Use `?incremental=true` on subsequent builds to only re-process changed files:

```bash
curl -X POST "http://localhost:3741/graphs/my-project/build?use_llm=true&incremental=true"
```
