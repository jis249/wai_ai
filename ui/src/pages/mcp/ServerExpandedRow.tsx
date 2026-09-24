import { useId, useState } from 'react'
import type { MCPServerResponse } from '../../hooks/useMCPServers'
import type { MCPServerHealth } from '../../hooks/useMCPServerHealth'
import { cn } from '../../lib/utils'
import { ChevronDown, CircleX } from '../../components/ui/icons'
import { ClientConfigSnippets } from './ClientConfigSnippets'
import { ServerToolsList } from './ServerToolsList'

interface ServerExpandedRowProps {
  server: MCPServerResponse
  /** May manage the blocklist / refresh tools. */
  canEdit: boolean
  health?: MCPServerHealth
}

export function ServerExpandedRow({ server, canEdit, health }: ServerExpandedRowProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const configId = useId()

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      {health?.status === 'unhealthy' && health.last_error && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-error">Last health check failed</p>
            <p className="mt-0.5 break-words text-xs text-error/80">{health.last_error}</p>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          aria-controls={configId}
          className="inline-flex items-center gap-1.5 rounded text-xs font-medium uppercase tracking-wider text-text-tertiary transition-colors hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', configOpen && 'rotate-180')} aria-hidden="true" />
          Client config
        </button>
        {configOpen && (
          <div id={configId} className="mt-3">
            <ClientConfigSnippets alias={server.alias} supportsCodeMode={server.alias === 'wai'} />
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <ServerToolsList serverId={server.id} canEdit={canEdit} />
      </div>
    </div>
  )
}
