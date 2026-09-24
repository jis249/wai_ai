import { useId, useState } from 'react'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { CopyButton } from '../../components/ui/CopyButton'
import { API_KEY_PLACEHOLDER, MCP_CLIENTS, buildClientConfig, mcpServerEndpoint } from './mcpUrl'
import type { MCPClient } from './mcpUrl'

interface ClientConfigSnippetsProps {
  alias: string
  /** Offer the Code Mode endpoint (all tools behind one server) as an alternative. */
  supportsCodeMode?: boolean
}

type Endpoint = 'server' | 'code'

export function ClientConfigSnippets({ alias, supportsCodeMode = false }: ClientConfigSnippetsProps) {
  const [client, setClient] = useState<MCPClient>('claude')
  const [endpoint, setEndpoint] = useState<Endpoint>('server')
  const codeId = useId()

  const useCode = supportsCodeMode && endpoint === 'code'
  const url = useCode ? mcpServerEndpoint() : mcpServerEndpoint(alias)
  const name = useCode ? 'wai-code' : alias
  const config = buildClientConfig(client, name, url)
  const clientInfo = MCP_CLIENTS.find((c) => c.value === client)

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            aria-label="MCP client"
            size="sm"
            options={MCP_CLIENTS.map((c) => ({ value: c.value, label: c.label }))}
            value={client}
            onChange={setClient}
          />
        </div>
        {supportsCodeMode && (
          <SegmentedControl
            aria-label="Endpoint"
            size="sm"
            options={[
              { value: 'server', label: 'This server' },
              { value: 'code', label: 'Code Mode (all tools)' },
            ]}
            value={endpoint}
            onChange={setEndpoint}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-tertiary min-w-0">
          Add to <span className="font-mono text-text-secondary break-all">{clientInfo?.file}</span> and replace{' '}
          <span className="font-mono text-text-secondary">{API_KEY_PLACEHOLDER}</span>.
        </p>
        <CopyButton text={config} label="Copy config" aria-describedby={codeId} />
      </div>

      <pre
        id={codeId}
        tabIndex={0}
        aria-label={`${clientInfo?.label ?? 'Client'} configuration`}
        className="max-w-full overflow-x-auto rounded-md bg-bg-tertiary px-3 py-2.5 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <code>{config}</code>
      </pre>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary min-w-0">
        <span>Endpoint:</span>
        <span className="font-mono text-text-secondary break-all min-w-0">{url}</span>
        <CopyButton text={url} label="Copy URL" />
      </div>
    </div>
  )
}
