import { IconButton } from '../../components/ui/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { CirclePause, CirclePlay, EllipsisVertical, Eye, Pencil, Plus, Trash2 } from '../../components/ui/icons'
import type { ModelResponse } from '../../hooks/useModels'

export interface ModelRowActionsProps {
  model: ModelResponse
  readOnly: boolean
  /** Toggle / delete request in flight for this row. */
  busy?: boolean
  onView: (model: ModelResponse) => void
  onEdit: (model: ModelResponse) => void
  onAddDeployment: (model: ModelResponse) => void
  onToggleActive: (model: ModelResponse, activate: boolean) => void
  onDelete: (model: ModelResponse) => void
}

/** View + Edit as icon buttons; deployment / activation / delete in a "More" menu. */
export function ModelRowActions({
  model,
  readOnly,
  busy = false,
  onView,
  onEdit,
  onAddDeployment,
  onToggleActive,
  onDelete,
}: ModelRowActionsProps) {
  const isApi = model.source === 'api'
  const canAddDeployment = isApi && (Boolean(model.strategy) || (model.deployments?.length ?? 0) > 0)

  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton size="sm" aria-label="View details" icon={<Eye />} onClick={() => onView(model)} />
      {!readOnly && (
        <>
          {isApi && (
            <IconButton size="sm" aria-label="Edit model" icon={<Pencil />} onClick={() => onEdit(model)} disabled={busy} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                aria-label={`More actions for ${model.name}`}
                tooltip="More actions"
                icon={<EllipsisVertical />}
                disabled={busy}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {canAddDeployment && (
                <DropdownMenuItem icon={<Plus />} onSelect={() => onAddDeployment(model)}>
                  Add deployment
                </DropdownMenuItem>
              )}
              {model.is_active ? (
                <DropdownMenuItem icon={<CirclePause />} onSelect={() => onToggleActive(model, false)}>
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem icon={<CirclePlay />} onSelect={() => onToggleActive(model, true)}>
                  Activate
                </DropdownMenuItem>
              )}
              {isApi && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => onDelete(model)}>
                    Delete model
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}
