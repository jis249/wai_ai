import { useMemo, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import {
  useMCPServerTools,
  useRefreshMCPServerTools,
  useSetToolBlocked,
  toolBlockMutationKey,
} from '../../hooks/useMCPServers'
import type { SetToolBlockedVars } from '../../hooks/useMCPServers'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { cn } from '../../lib/utils'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { Tooltip } from '../../components/ui/Tooltip'
import { Lock, RefreshCw, Search, Wrench } from '../../components/ui/icons'

interface ServerToolsListProps {
  serverId: string
  /** May block/unblock tools and refresh the cache. */
  canEdit: boolean
}

export function ServerToolsList({ serverId, canEdit }: ServerToolsListProps) {
  const [query, setQuery] = useState('')
  const toolsQuery = useMCPServerTools(serverId)
  const setBlocked = useSetToolBlocked(serverId)
  const refreshTools = useRefreshMCPServerTools()
  const { toast } = useToast()

  const pendingTools = useMutationState({
    filters: { mutationKey: toolBlockMutationKey(serverId), status: 'pending' },
    select: (m) => (m.state.variables as SetToolBlockedVars | undefined)?.toolName,
  })
  const pendingSet = useMemo(() => new Set(pendingTools), [pendingTools])

  const tools = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data])
  const blockedCount = tools.filter((t) => t.blocked).length
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
    )
  }, [tools, query])

  function handleToggle(toolName: string, blocked: boolean) {
    setBlocked.mutate(
      { toolName, blocked },
      {
        onSuccess: () =>
          toast({ variant: 'success', message: `Tool "${toolName}" ${blocked ? 'blocked' : 'unblocked'}` }),
        onError: (err) =>
          toast({
            variant: 'error',
            message: errorMessage(err, blocked ? 'Failed to block tool' : 'Failed to unblock tool'),
          }),
      },
    )
  }

  function handleRefresh() {
    refreshTools.mutate(serverId, {
      onSuccess: (result) =>
        toast({
          variant: 'success',
          message: `Tools refreshed — ${result.tool_count} tool${result.tool_count === 1 ? '' : 's'} found`,
        }),
      onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to refresh tools') }),
    })
  }

  return (
    <section aria-label="Tools" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
          Tools
          {tools.length > 0 && (
            <span className="ml-2 normal-case tracking-normal">
              {tools.length} total{blockedCount > 0 && ` · ${blockedCount} blocked`}
            </span>
          )}
        </h4>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={handleRefresh}
            loading={refreshTools.isPending}
          >
            {refreshTools.isPending ? 'Refreshing…' : 'Refresh tools'}
          </Button>
        )}
      </div>

      {tools.length > 5 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search tools"
            placeholder="Search tools…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {toolsQuery.isPending && toolsQuery.fetchStatus !== 'idle' ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : toolsQuery.isError && toolsQuery.data === undefined ? (
        <ErrorState
          title="Couldn't load tools"
          error={toolsQuery.error}
          onRetry={() => void toolsQuery.refetch()}
          retrying={toolsQuery.isFetching}
        />
      ) : tools.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Wrench className="w-6 h-6" />}
          title="No tools cached"
          description={canEdit ? 'Refresh to fetch the tool list from this server.' : 'This server has not reported any tools yet.'}
          action={canEdit ? { label: 'Refresh tools', onClick: handleRefresh } : undefined}
        />
      ) : visible.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-tertiary">No tools match “{query}”.</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border">
          {visible.map((tool) => {
            const pending = pendingSet.has(tool.name)
            return (
              <li
                key={tool.name}
                className={cn('flex items-center gap-3 px-3 py-2', tool.blocked && 'bg-error/5')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'font-mono text-sm break-all',
                        tool.blocked ? 'text-text-tertiary line-through' : 'text-text-primary',
                      )}
                    >
                      {tool.name}
                    </span>
                    {tool.blocked && (
                      <Badge variant="error" icon={<Lock className="w-3 h-3" aria-hidden="true" />}>
                        Blocked
                      </Badge>
                    )}
                  </div>
                  {tool.description && (
                    <Tooltip content={tool.description.length > 80 ? tool.description : null}>
                      <p className="mt-0.5 truncate text-xs text-text-tertiary">{tool.description}</p>
                    </Tooltip>
                  )}
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant={tool.blocked ? 'secondary' : 'ghost'}
                    className={cn('shrink-0', !tool.blocked && 'hover:text-error')}
                    disabled={pending}
                    aria-label={`${tool.blocked ? 'Unblock' : 'Block'} tool ${tool.name}`}
                    onClick={() => handleToggle(tool.name, !tool.blocked)}
                  >
                    {tool.blocked ? 'Unblock' : 'Block'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
