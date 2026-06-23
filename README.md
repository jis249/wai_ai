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
| http://localhost:8090 | Backend API (internal) |

## Local development

```powershell
.\run-local.ps1 -DevUi          # backend + Vite on http://127.0.0.1:5173
.\run-local.ps1 -BackendOnly    # backend in foreground
```

## Configuration

- **Config file:** `wai.yaml` (or set `WAI_CONFIG`)
- **Secrets:** `.env.local` beside the config file
- **Environment variables:** `WAI_ADMIN_KEY`, `WAI_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`

## API

| Endpoint | Description |
|----------|-------------|
| `GET /v1/models` | List available models (Bearer API key) |
| `POST /v1/chat/completions` | OpenAI-compatible chat proxy |
| `POST /api/v1/auth/login` | Admin login |
| `GET /healthz` | Liveness probe |
| `GET /metrics` | Prometheus metrics |

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
