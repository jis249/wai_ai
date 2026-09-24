import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Check, Clock, KeyRound, Plus, Search } from '../components/ui/icons'
import { useMe } from '../hooks/useMe'
import { usePermissions } from '../hooks/usePermissions'
import { useAPIKeys, useDeleteAPIKey, useRotateAPIKey } from '../hooks/useAPIKeys'
import type { APIKeyResponse } from '../hooks/useAPIKeys'
import { useTeams } from '../hooks/useTeams'
import { useServiceAccounts } from '../hooks/useServiceAccounts'
import { useAvailableModels } from '../hooks/useAvailableModels'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { resolveProxyBaseUrl } from './playground/codeSnippets'
import { CreateKeyDialog } from './keys/CreateKeyDialog'
import { EditKeyDialog } from './keys/EditKeyDialog'
import { RotateKeyDialog } from './keys/RotateKeyDialog'
import { KeyRevealDialog } from './keys/KeyRevealDialog'
import { TypeToConfirmDialog } from './keys/TypeToConfirmDialog'
import { KeysTable } from './keys/KeysTable'
import { filterKeys, keyStatus, nextSort, sortKeys } from './keys/helpers'
import type { KeySort, KeyStatusFilter, OwnerContext } from './keys/helpers'

const STATUS_FILTERS: { value: KeyStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
]

interface RevealState {
  key: string
  name?: string
  title: string
}

export default function KeysPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { data: me } = useMe()
  const { canManageKeys } = usePermissions()
  const orgId = me?.org_id ?? ''
  const navigate = useNavigate()

  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [reveal, setReveal] = useState<RevealState | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<APIKeyResponse | null>(null)
  const [editKey, setEditKey] = useState<APIKeyResponse | null>(null)
  const [rotateTarget, setRotateTarget] = useState<APIKeyResponse | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<KeyStatusFilter>('all')
  const [sort, setSort] = useState<KeySort | null>(null)
  // Status math uses the fetch time of the list (refreshes on refetch; keeps render pure).
  const [mountedAt] = useState(() => Date.now())

  const keysQuery = useAPIKeys(orgId, cursor)
  const { data: keys, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = keysQuery
  const { data: teams } = useTeams(orgId)
  const { data: serviceAccounts } = useServiceAccounts(orgId)
  const { data: models } = useAvailableModels()
  const deleteKey = useDeleteAPIKey(orgId)
  const rotateKey = useRotateAPIKey(orgId)
  const { toast } = useToast()

  const now = Math.max(dataUpdatedAt, mountedAt)

  const allKeys = useMemo(() => keys?.data ?? [], [keys?.data])
  const canManageAnyKey = canManageKeys
  const baseUrl = resolveProxyBaseUrl()
  const snippetModel = models?.models.find((m) => m.type === 'chat' || m.type === 'completion')?.name

  const owner: OwnerContext = useMemo(
    () => ({
      meId: me?.id,
      teamNames: new Map((teams?.data ?? []).map((t) => [t.id, t.name])),
      serviceAccountNames: new Map((serviceAccounts?.data ?? []).map((s) => [s.id, s.name])),
    }),
    [me?.id, teams?.data, serviceAccounts?.data],
  )

  const stats = useMemo(() => {
    let active = 0
    let expiring = 0
    for (const k of allKeys) {
      const s = keyStatus(k, now)
      if (s !== 'expired') active++
      if (s === 'expiring') expiring++
    }
    return { total: allKeys.length, active, expiring }
  }, [allKeys, now])

  const visibleKeys = useMemo(
    () => sortKeys(filterKeys(allKeys, { query, status: statusFilter, now, owner }), sort, owner, now),
    [allKeys, query, statusFilter, now, owner, sort],
  )

  function handleRevoke() {
    if (!revokeTarget) return
    const target = revokeTarget
    deleteKey.mutate(target.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `API key "${target.name}" revoked` })
        setRevokeTarget(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: `Couldn't revoke "${target.name}": ${errorMessage(err, 'Failed to revoke key')}` })
        setRevokeTarget(null)
      },
    })
  }

  function handleRotate() {
    if (!rotateTarget) return
    const target = rotateTarget
    rotateKey.mutate(target.id, {
      onSuccess: (data) => {
        setRotateTarget(null)
        if (data.key) setReveal({ key: data.key, name: target.name, title: 'Key rotated' })
      },
      onError: (err) => {
        // The API refuses rotating a key whose owner is a peer/superior admin (403/404).
        toast({ variant: 'error', message: `Couldn't rotate "${target.name}": ${errorMessage(err, 'Failed to rotate key')}` })
        setRotateTarget(null)
      },
    })
  }

  const createButton = (
    <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowCreateDialog(true)}>
      Create Key
    </Button>
  )

  const showEmptyState = !isLoading && !isError && !!orgId && allKeys.length === 0 && !keys?.has_more
  const filtersActive = query.trim() !== '' || statusFilter !== 'all'

  let body: ReactNode
  if (isError && !keys) {
    body = <ErrorState variant="card" title="Couldn't load API keys" error={error} onRetry={() => void refetch()} retrying={isFetching} />
  } else if (showEmptyState) {
    body = (
      <EmptyState
        variant="card"
        icon={<KeyRound className="h-6 w-6" />}
        title="No API keys yet"
        description="Create a key for Cursor or other clients. The playground can use your login session without a key."
        action={{ label: 'Create Key', onClick: () => setShowCreateDialog(true) }}
        secondaryAction={{ label: 'Open playground', onClick: () => navigate('/playground') }}
      />
    )
  } else {
    body = (
      <>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
            <Input
              aria-label="Search keys by name, hint or owner"
              placeholder="Search name, hint or owner"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              type="search"
            />
          </div>
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl aria-label="Filter by status" size="sm" options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
          </div>
        </div>
        {keys?.has_more && filtersActive && (
          <p className="mb-2 text-xs text-text-tertiary">Search and filters apply to the keys on this page.</p>
        )}
        <KeysTable
          rows={visibleKeys}
          loading={isLoading && !!orgId}
          now={now}
          owner={owner}
          canManageAnyKey={canManageAnyKey}
          sort={sort}
          onSort={(col) => setSort((s) => nextSort(s, col))}
          busy={deleteKey.isPending || rotateKey.isPending}
          onEdit={setEditKey}
          onRotate={setRotateTarget}
          onRevoke={setRevokeTarget}
          emptyState={
            filtersActive ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No matching keys"
                description="Try a different search or status filter."
                action={{
                  label: 'Clear filters',
                  onClick: () => {
                    setQuery('')
                    setStatusFilter('all')
                  },
                }}
              />
            ) : undefined
          }
          pagination={{
            cursor: cursor ?? null,
            hasMore: keys?.has_more ?? false,
            hasPrevious: prevCursors.length > 0,
            onNext: () => {
              if (keys?.next_cursor) {
                setPrevCursors((prev) => [...prev, cursor ?? ''])
                setCursor(keys.next_cursor)
              }
            },
            onPrevious: () => {
              const prev = prevCursors[prevCursors.length - 1]
              setPrevCursors((p) => p.slice(0, -1))
              setCursor(prev || undefined)
            },
          }}
        />
      </>
    )
  }

  return (
    <>
      {!hideHeader ? (
        <PageHeader
          title="API Keys"
          description={`Manage your API keys. Use ${baseUrl} as the OpenAI-compatible base URL in Cursor, Continue, or the OpenAI SDK.`}
          actions={createButton}
        />
      ) : (
        <div className="mb-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-text-secondary">
            OpenAI-compatible base URL: <span className="break-all font-mono text-text-primary">{baseUrl}</span>
          </p>
          <div className="shrink-0">{createButton}</div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Keys" value={stats.total} iconColor="purple" icon={<KeyRound className="h-4 w-4" />} />
        <StatCard label="Active Keys" value={stats.active} iconColor="green" icon={<Check className="h-4 w-4" />} />
        <StatCard label="Expiring Soon" value={stats.expiring} iconColor="yellow" icon={<Clock className="h-4 w-4" />} />
      </div>

      {body}

      <CreateKeyDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={(key, created) => setReveal({ key, name: created.name, title: 'API key created' })}
        orgId={orgId}
      />

      {reveal && (
        <KeyRevealDialog
          key={reveal.key}
          keyValue={reveal.key}
          keyName={reveal.name}
          title={reveal.title}
          model={snippetModel}
          baseUrl={baseUrl}
          onClose={() => setReveal(null)}
        />
      )}

      {editKey !== null && (
        <EditKeyDialog apiKey={editKey} onClose={() => setEditKey(null)} orgId={orgId} canEditLimits={canManageAnyKey} />
      )}

      <RotateKeyDialog apiKey={rotateTarget} onClose={() => setRotateTarget(null)} onConfirm={handleRotate} loading={rotateKey.isPending} />

      {revokeTarget && (
        <TypeToConfirmDialog
          key={revokeTarget.id}
          open
          onClose={() => setRevokeTarget(null)}
          onConfirm={handleRevoke}
          title={revokeTarget.key_type === 'session_key' ? 'Revoke session' : 'Revoke API key'}
          description="This action cannot be undone. Any application using this key will lose access immediately."
          confirmText={revokeTarget.name}
          confirmLabel="Revoke"
          loading={deleteKey.isPending}
        />
      )}
    </>
  )
}
