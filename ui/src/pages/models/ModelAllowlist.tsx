import { useMemo, useState, type ReactNode } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { StatCard } from '../../components/ui/StatCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Info, LayoutDashboard, Layers, Search } from '../../components/ui/icons'
import type { ModelResponse } from '../../hooks/useModels'
import { providerBadgeVariant, isKnownProvider } from '../../lib/providers'
import { cn } from '../../lib/utils'
import { modelMatchesSearch } from './modelHelpers'

interface QueryLike {
  isLoading: boolean
  isError: boolean
  isFetching?: boolean
  error: unknown
  refetch: () => unknown
}

export interface ModelAllowlistProps {
  models: ModelResponse[]
  modelsQuery: QueryLike
  accessQuery: QueryLike
  selected: Set<string>
  onToggle: (name: string) => void
  onSave: () => void
  saving: boolean
  canSave: boolean
  description: string
  unrestrictedNote: string
}

/** Stat cards + searchable checkbox list of models + save, shared by org and team access tabs. */
export function ModelAllowlist({
  models,
  modelsQuery,
  accessQuery,
  selected,
  onToggle,
  onSave,
  saving,
  canSave,
  description,
  unrestrictedNote,
}: ModelAllowlistProps) {
  const [search, setSearch] = useState('')
  const isLoading = modelsQuery.isLoading || accessQuery.isLoading
  const failed = modelsQuery.isError ? modelsQuery : accessQuery.isError ? accessQuery : null
  const visible = useMemo(() => models.filter((m) => modelMatchesSearch(m, search)), [models, search])

  let list: ReactNode
  if (failed) {
    list = (
      <ErrorState
        title="Couldn't load model access"
        error={failed.error}
        onRetry={() => void failed.refetch()}
        retrying={failed.isFetching}
      />
    )
  } else if (isLoading) {
    list = Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
        <Skeleton className="h-4 w-4 shrink-0" />
        <Skeleton className="h-4 w-40" />
      </div>
    ))
  } else if (models.length === 0) {
    list = (
      <EmptyState
        icon={<Layers className="h-6 w-6" />}
        title="No models configured"
        description="Models added to the catalog will appear here."
      />
    )
  } else if (visible.length === 0) {
    list = (
      <EmptyState
        icon={<Search className="h-6 w-6" />}
        title="No matching models"
        secondaryAction={{ label: 'Clear search', onClick: () => setSearch('') }}
      />
    )
  } else {
    list = visible.map((model) => {
      const providerKey = isKnownProvider(model.provider) ? model.provider : 'custom'
      const isSelected = selected.has(model.name)
      return (
        <label
          key={model.id}
          className={cn(
            'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-150',
            'hover:bg-bg-tertiary first:rounded-t-xl last:rounded-b-xl',
            isSelected && 'bg-accent/5',
          )}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(model.name)}
            className="accent-accent h-4 w-4 shrink-0 cursor-pointer"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary">{model.name}</span>
          <Badge variant={providerBadgeVariant[providerKey]}>{model.provider}</Badge>
        </label>
      )
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isLoading ? (
          <>
            <Skeleton className="h-[92px] rounded-xl" />
            <Skeleton className="h-[92px] rounded-xl" />
          </>
        ) : (
          <>
            <StatCard
              label="Allowed Models"
              value={failed ? '—' : selected.size === 0 ? 'All' : selected.size}
              iconColor="purple"
              icon={<Layers className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label="Available Models"
              value={failed ? '—' : models.length}
              iconColor="blue"
              icon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="mb-1 text-[10px] font-medium uppercase tracking-widest text-text-tertiary">Model Allowlist</h3>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
        {models.length > 5 && (
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Filter models"
              placeholder="Filter models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
      </div>

      {selected.size === 0 && !isLoading && !failed && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-accent">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{unrestrictedNote}</p>
        </div>
      )}

      <div className="divide-y divide-border/50 rounded-xl border border-border bg-bg-secondary">{list}</div>

      <div className="flex justify-end">
        <Button onClick={onSave} loading={saving} disabled={!canSave}>
          Save Changes
        </Button>
      </div>
    </div>
  )
}
