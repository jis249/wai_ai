import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonRows } from '../components/ui/Skeleton'
import { CopyButton } from '../components/ui/CopyButton'
import { CircleCheck, CircleAlert, RefreshCw, Terminal } from '../components/ui/icons'
import { LOCAL_STORAGE_KEY } from '../lib/constants'
import { resolveProxyBaseUrl } from '../lib/proxyUrl'
import { cn } from '../lib/utils'

interface SetupStatus {
  version: string
  database: { ok: boolean; sslmode_note?: string }
  ollama: { ok: boolean; base_url: string; models: string[]; loaded: string[]; error?: string }
  has_users: boolean
  proxy_base_url: string
  ready: boolean
}

interface Step {
  key: string
  title: string
  done: boolean
  detail: string
  /** What to do when the step is pending. */
  hint?: string
}

function buildSteps(status: SetupStatus, signedIn: boolean): Step[] {
  const models = status.ollama.models ?? []
  return [
    {
      key: 'db',
      title: 'Connect PostgreSQL',
      done: status.database.ok,
      detail: status.database.ok ? status.database.sslmode_note || 'Database reachable' : 'Database ping failed',
      hint: 'Check the database connection string in wai.yaml and that the Postgres service is running.',
    },
    {
      key: 'admin',
      title: 'Create the first admin user',
      done: status.has_users,
      detail: status.has_users ? 'At least one user exists' : 'No users yet',
      hint: 'Set WAI_ADMIN_KEY and start the backend to bootstrap the admin account.',
    },
    {
      key: 'ollama',
      title: 'Reach Ollama',
      done: status.ollama.ok,
      detail: status.ollama.ok
        ? `Reachable at ${status.ollama.base_url}`
        : status.ollama.error || `Not reachable at ${status.ollama.base_url}`,
      hint: 'Start Ollama (ollama serve) or fix the base URL in wai.yaml.',
    },
    {
      key: 'models',
      title: 'Pull at least one model',
      done: models.length > 0,
      detail:
        models.length > 0
          ? `${models.length} model(s): ${models.slice(0, 6).join(', ')}${models.length > 6 ? ', ...' : ''}`
          : 'No models found',
      hint: 'Run e.g. "ollama pull llama3.1" on the host.',
    },
    {
      key: 'signin',
      title: 'Sign in to the dashboard',
      done: signedIn,
      detail: signedIn ? 'Signed in' : 'Not signed in on this browser',
      hint: 'Sign in with the admin account, then create an API key.',
    },
  ]
}

function StepRow({ step, index }: { step: Step; index: number }) {
  return (
    <li className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
      {step.done ? (
        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-text-primary">
            {index + 1}. {step.title}
          </span>
          <span className={cn('text-xs font-medium', step.done ? 'text-success' : 'text-warning')}>
            {step.done ? 'Done' : 'Pending'}
          </span>
        </div>
        <p className="mt-0.5 break-words text-xs text-text-tertiary">{step.detail}</p>
        {!step.done && step.hint && <p className="mt-1 text-xs text-text-secondary">{step.hint}</p>}
      </div>
    </li>
  )
}

export default function SetupPage({ embedded = false }: { embedded?: boolean }) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) : null
  const signedIn = Boolean(token)

  const { data: status, error, isError, isPending, refetch, isFetching } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      // Send the session when present so system admins get the unredacted checklist.
      const res = await fetch('/api/v1/setup/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`)
      return res.json() as Promise<SetupStatus>
    },
  })

  const steps = status ? buildSteps(status, signedIn) : []
  const doneCount = steps.filter((s) => s.done).length
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0

  return (
    <div className={embedded ? 'max-w-2xl' : 'mx-auto min-h-screen max-w-2xl bg-bg-primary px-4 py-8 sm:px-8'}>
      <PageHeader
        title="WAI setup"
        documentTitle={embedded ? false : undefined}
        description="First-run checklist for a local Windows install."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void refetch()}
            loading={isFetching}
          >
            Refresh
          </Button>
        }
      />

      {isPending && (
        <Card>
          <SkeletonRows rows={5} columns={2} />
        </Card>
      )}

      {isError && !status && (
        <ErrorState variant="card" title="Could not load setup status" error={error} onRetry={() => void refetch()} retrying={isFetching} />
      )}

      {status && (
        <div className="space-y-6">
          <Card>
            <div className="mb-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-text-primary">
                  {doneCount === steps.length ? 'All set' : 'Getting started'}
                </h2>
                <span className="text-sm text-text-secondary">
                  {doneCount} of {steps.length} steps complete
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary"
              >
                <div
                  className={cn('h-full rounded-full transition-all', doneCount === steps.length ? 'bg-success' : 'bg-accent')}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
            <ol className="divide-y divide-border">
              {steps.map((step, i) => (
                <StepRow key={step.key} step={step} index={i} />
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title="Connect Cursor / Continue"
              description="Create an API key after signing in, then paste it with this base URL."
              icon={<Terminal className="h-5 w-5" />}
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded-md bg-bg-tertiary px-2 py-1 font-mono text-sm text-text-primary">
                {resolveProxyBaseUrl()}
              </code>
              <CopyButton text={resolveProxyBaseUrl()} />
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            {signedIn ? (
              <Link to="/">
                <Button>Go to dashboard</Button>
              </Link>
            ) : (
              <Link to="/login">
                <Button>{status.ready ? 'Go to login' : 'Login anyway'}</Button>
              </Link>
            )}
            <span className="text-xs text-text-tertiary">v{status.version}</span>
          </div>
        </div>
      )}
    </div>
  )
}
