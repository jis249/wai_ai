# WAI

Privacy-first LLM proxy and AI gateway — Python backend with OpenAI-compatible `/v1/*` API, admin dashboard, RBAC, MCP gateway, and usage tracking.

## Production (IIS on Windows)

Requires local **PostgreSQL**, **IIS** with URL Rewrite + ARR, and secrets in `.env.local`.

```powershell
# One-time / after updates (run as Administrator)
Copy-Item wai.yaml.example wai.yaml
python -m venv .venv
.\.venv\Scripts\pip install -e .
.\run-iis-local.ps1
```

This will:

- Start the Python backend on **http://localhost:8090**
- Build and deploy the UI to **C:\inetpub\wai**
- Configure IIS site **wai** on **http://localhost:8081**
- Install a scheduled task to keep the backend and IIS site running

| URL | Role |
|-----|------|
| http://localhost:8081 | Dashboard (IIS) |
| http://127.0.0.1:8090 | Backend API (loopback only) |

The IIS script binds the backend to **127.0.0.1** and sets `WAI_TRUST_PROXY=true` so `X-Forwarded-For` is trusted only behind ARR. Do not set `WAI_DEV=true` on the IIS backend (that enables CORS allow-all for Vite).

First-run checklist: open **http://localhost:8081/setup**.

## Local development

```powershell
.\run-local.ps1 -DevUi          # backend + Vite on http://127.0.0.1:5173
.\run-local.ps1 -BackendOnly    # backend in foreground
```

## Configuration

- **Config file:** `wai.yaml` (or set `WAI_CONFIG`)
- **Secrets:** `.env.local` beside the config file
- **Environment variables:** `WAI_ADMIN_KEY`, `WAI_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `WAI_METRICS_TOKEN` (required to scrape `/metrics`), `WAI_TRUST_PROXY` (IIS), `WAI_DEV` (Vite only)

The default Postgres DSN uses `sslmode=disable` because the database is local. Keep the DSN on loopback.

Admin **session keys** (`wa_sk_…`) can call `/v1/*` so the Playground works with the login token. Treat a leaked dashboard session like a proxy API key.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /v1/models` | List available models (Bearer API key) |
| `POST /v1/chat/completions` | OpenAI-compatible chat proxy |
| `POST /api/v1/auth/login` | Admin login |
| `GET /healthz` | Liveness probe |
| `GET /metrics` | Prometheus metrics (requires `WAI_METRICS_TOKEN`) |
| `GET /api/v1/setup/status` | First-run / Ollama checklist |

## Project layout

```
.
├── pyproject.toml
├── wai.yaml.example
├── run-iis-local.ps1       # IIS deploy + autostart (production)
├── run-local.ps1           # Local dev helpers
├── scripts/
│   ├── setup-iis-wai.ps1
│   ├── install-wai-autostart.ps1
│   ├── ensure-wai-running.ps1
│   ├── wai-backend.ps1
│   └── db/
├── src/wai/
└── ui/
```

## Database

WAI uses **PostgreSQL** on the local Windows service (`127.0.0.1:5432`, database `wai`).

Run migrations manually:

```powershell
.\.venv\Scripts\python.exe scripts\db\migrate.py
```

## Anthropic-compatible API

WAI also speaks the Anthropic Messages API, so Claude Code, the `anthropic` SDKs and agent
frameworks can use it directly:

- `POST /v1/messages` (streaming and non-streaming, tools, images) is translated to the OpenAI chat
  format and sent through the normal proxy, so model access, aliases, `auto` routing, guardrails,
  rate/spend limits, fallbacks, usage logging and caching all apply.
- `POST /v1/messages/count_tokens` returns an **estimate** (characters / 4), not a tokenizer count.
- Auth: `x-api-key: <WAI key>` or `Authorization: Bearer <WAI key>`.
- The Anthropic SDK base URL is the server origin **without** `/v1`:

```python
import anthropic

client = anthropic.Anthropic(base_url="https://ai.waiin.com", api_key="wa_uk_...")
msg = client.messages.create(model="your-model", max_tokens=1024, messages=[{"role": "user", "content": "Hello"}])
```

Claude Code: `ANTHROPIC_BASE_URL=https://ai.waiin.com` plus `ANTHROPIC_API_KEY` (or
`ANTHROPIC_AUTH_TOKEN`) set to a WAI key. The `model` must be a WAI model name or alias; create
aliases for the Claude model ids your client sends, or set `ANTHROPIC_MODEL`.

Limitations: `top_k`, `thinking`, `cache_control` and server tools (web search, etc.) are ignored;
`stop_sequence` is always `null`; `content_filter` is reported as `stop_reason: "refusal"`; errors use
the Anthropic `{"type": "error", "error": {...}}` shape with the original HTTP status.
