import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Pencil, Plus, Trash2 } from '../../components/ui/icons'
import type { DeploymentResponse, ModelResponse } from '../../hooks/useModels'
import type { ModelHealthInfo } from '../../hooks/useModelHealth'
import { providerBadgeVariant, isKnownProvider } from '../../lib/providers'
import { HealthBadge } from './HealthBadge'
import { providerLabel } from './modelHelpers'

export interface DeploymentsSubTableProps {
  model: ModelResponse
  healthByName: Map<string, ModelHealthInfo>
  onAdd: () => void
  onEdit: (deployment: DeploymentResponse) => void
  onDelete: (deployment: DeploymentResponse) => void
}

const th = 'px-3 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wider text-left whitespace-nowrap'

/** Expanded-row content: the deployments behind a load-balanced model. */
export function DeploymentsSubTable({ model, healthByName, onAdd, onEdit, onDelete }: DeploymentsSubTableProps) {
  const deployments = model.deployments ?? []
  const isApi = model.source === 'api'

  return (
    <div className="py-3 pl-4 pr-2 sm:pl-12">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <caption className="sr-only">Deployments of {model.name}</caption>
          <thead>
            <tr className="border-b border-border/40">
              <th scope="col" className={th}>Deployment</th>
              <th scope="col" className={th}>Provider</th>
              <th scope="col" className={th}>Health</th>
              <th scope="col" className={th}>Base URL</th>
              <th scope="col" className={th}>Weight</th>
              <th scope="col" className={th}>Priority</th>
              {isApi && (
                <th scope="col" className={`${th} text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {deployments.map((dep) => (
              <tr key={dep.id} className="border-b border-border/20 last:border-b-0">
                <td className="px-3 py-2 text-sm">
                  <span className="font-mono text-text-secondary">{dep.name}</span>
                </td>
                <td className="px-3 py-2 text-sm">
                  <Badge variant={isKnownProvider(dep.provider) ? providerBadgeVariant[dep.provider] : 'muted'}>
                    {providerLabel(dep.provider)}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm">
                  <HealthBadge info={healthByName.get(`${model.name}/${dep.name}`)} />
                </td>
                <td className="px-3 py-2 text-sm">
                  <span className="block max-w-[18rem] truncate font-mono text-xs text-text-tertiary">
                    {dep.base_url}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm tabular-nums text-text-secondary">{dep.weight}</td>
                <td className="px-3 py-2 text-sm tabular-nums text-text-secondary">{dep.priority}</td>
                {isApi && (
                  <td className="px-3 py-2 text-sm text-right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        size="sm"
                        aria-label={`Edit deployment ${dep.name}`}
                        icon={<Pencil />}
                        onClick={() => onEdit(dep)}
                      />
                      <IconButton
                        size="sm"
                        variant="destructive"
                        aria-label={`Delete deployment ${dep.name}`}
                        icon={<Trash2 />}
                        onClick={() => onDelete(dep)}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isApi && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={onAdd}>
            Add deployment
          </Button>
        </div>
      )}
    </div>
  )
}
