import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Banner } from '../components/ui/Banner'
import { PROXY_PUBLIC_BASE, LOCAL_STORAGE_KEY } from '../lib/constants'

interface SetupStatus {
  version: string
  database: { ok: boolean; sslmode_note?: string }
  ollama: { ok: boolean; base_url: string; models: string[]; loaded: string[]; error?: string }
  has_users: boolean
  proxy_base_url: string
  ready: boolean
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-secondary p-4">
      <div>
        <div className="text-sm font-medium text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-1">{detail}</div>
      </div>
      <Badge variant={ok ? 'success' : 'warning'}>{ok ? 'OK' : 'Check'}</Badge>
    </div>
  )
}

export default function SetupPage({ embedded = false }: { embedded?: boolean }) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) : null
  const signedIn = Boolean(token)

  const { data: status, error, refetch, isFetching } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/setup/status')
      if (!res.ok) throw new Error(res.statusText)
      return res.json() as Promise<SetupStatus>
    },
  })

  return (
    <div className={embedded ? 'max-w-2xl' : 'min-h-screen bg-bg-primary p-8 max-w-2xl mx-auto'}>
      <PageHeader
        title="WAI setup"
        description="First-run checklist for a local Windows install (Postgres, Ollama, admin user)."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            Refresh
          </Button>
        }
      />
      {error && <Banner variant="error" title={`Could not load setup status: ${error instanceof Error ? error.message : 'error'}`} />}
      {status && (
        <div className="space-y-3">
          <Row ok={status.database.ok} label="PostgreSQL" detail={status.database.sslmode_note || 'Database ping'} />
          <Row
            ok={status.has_users}
            label="Admin user"
            detail={status.has_users ? 'At least one user exists' : 'Set WAI_ADMIN_KEY and start the backend to bootstrap'}
          />
          <Row
            ok={status.ollama.ok}
            label="Ollama"
            detail={
              status.ollama.ok
                ? `${status.ollama.models.length} model(s) at ${status.ollama.base_url}`
                : status.ollama.error || `Not reachable at ${status.ollama.base_url}`
            }
          />
          {status.ollama.models.length > 0 && (
            <p className="text-xs text-text-tertiary font-mono">{status.ollama.models.slice(0, 8).join(', ')}</p>
          )}
          <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm space-y-2">
            <div className="font-medium text-text-primary">Connect Cursor</div>
            <p className="text-text-secondary">
              OpenAI base URL: <span className="font-mono">{PROXY_PUBLIC_BASE}</span>
            </p>
            <p className="text-text-tertiary text-xs">Create an API key after login, then paste it into Cursor / Continue.</p>
          </div>
          <div className="flex gap-3">
            {signedIn ? (
              <Link to="/">
                <Button>Go to dashboard</Button>
              </Link>
            ) : (
              <Link to="/login">
                <Button>{status.ready ? 'Go to login' : 'Login anyway'}</Button>
              </Link>
            )}
            <span className="text-xs text-text-tertiary self-center">v{status.version}</span>
          </div>
        </div>
      )}
    </div>
  )
}
