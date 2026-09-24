import React, { useMemo } from 'react'
import { Table } from '../../components/ui/Table'
import type { Column, SortState } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { CircleCheck, CirclePause } from '../../components/ui/icons'
import type { DeploymentResponse, ModelResponse } from '../../hooks/useModels'
import type { ModelHealthInfo } from '../../hooks/useModelHealth'
import { providerBadgeVariant, isKnownProvider } from '../../lib/providers'
import { resolveModelHealth } from '../ModelDetailDialog'
import { HealthBadge } from './HealthBadge'
import { DeploymentsSubTable } from './DeploymentsSubTable'
import { ModelRowActions } from './ModelRowActions'
import { providerLabels, typeBadgeVariant, typeLabels } from './modelHelpers'

export interface ModelsTableProps {
  models: ModelResponse[]
  loading: boolean
  readOnly: boolean
  healthByName: Map<string, ModelHealthInfo>
  sort?: SortState
  onSort: (column: string) => void
  emptyState: React.ReactNode
  expandedKeys: Set<string>
  onToggleExpand: (key: string) => void
  /** Row id with a toggle/delete in flight. */
  busyModelId?: string | null
  onView: (model: ModelResponse) => void
  onEdit: (model: ModelResponse) => void
  onDelete: (model: ModelResponse) => void
  onToggleActive: (model: ModelResponse, activate: boolean) => void
  onAddDeployment: (model: ModelResponse) => void
  onEditDeployment: (model: ModelResponse, deployment: DeploymentResponse) => void
  onDeleteDeployment: (model: ModelResponse, deployment: DeploymentResponse) => void
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="success" icon={<CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}>
      Active
    </Badge>
  ) : (
    <Badge variant="muted" className="font-sans" icon={<CirclePause className="h-3.5 w-3.5" aria-hidden="true" />}>
      Inactive
    </Badge>
  )
}

const dash = <span className="text-text-tertiary">—</span>

export function ModelsTable({
  models,
  loading,
  readOnly,
  healthByName,
  sort,
  onSort,
  emptyState,
  expandedKeys,
  onToggleExpand,
  busyModelId,
  onView,
  onEdit,
  onDelete,
  onToggleActive,
  onAddDeployment,
  onEditDeployment,
  onDeleteDeployment,
}: ModelsTableProps) {
  const columns = useMemo<Column<ModelResponse>[]>(() => {
    const cols: Column<ModelResponse>[] = [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        render: (row) => (
          <button
            type="button"
            onClick={() => onView(row)}
            className="max-w-[16rem] truncate text-left font-mono text-sm text-text-primary transition-colors hover:text-accent cursor-pointer"
          >
            {row.name}
          </button>
        ),
      },
      {
        key: 'provider',
        header: 'Provider',
        sortable: true,
        render: (row) => {
          const depCount = row.deployments?.length ?? 0
          if (depCount > 0) {
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="info">{depCount} deployments</Badge>
                {row.strategy && <Badge variant="muted">{row.strategy}</Badge>}
              </div>
            )
          }
          const key = isKnownProvider(row.provider) ? row.provider : 'custom'
          return <Badge variant={providerBadgeVariant[key]}>{providerLabels[key]}</Badge>
        },
      },
      {
        key: 'type',
        header: 'Type',
        render: (row) => (
          <Badge variant={typeBadgeVariant[row.type] ?? 'muted'}>{typeLabels[row.type] ?? row.type ?? 'Chat'}</Badge>
        ),
      },
      {
        key: 'health',
        header: 'Health',
        render: (row) => (
          <HealthBadge
            info={row.deployments?.length ? resolveModelHealth(row, healthByName) : healthByName.get(row.name)}
          />
        ),
      },
      {
        key: 'aliases',
        header: 'Aliases',
        render: (row) => {
          const list = row.aliases ?? []
          if (list.length === 0) return dash
          return (
            <div className="flex max-w-[16rem] flex-wrap gap-1">
              {list.map((a) => (
                <Badge key={a} variant="muted">
                  {a}
                </Badge>
              ))}
            </div>
          )
        },
      },
      {
        key: 'max_context_tokens',
        header: 'Context',
        align: 'right',
        render: (row) =>
          row.max_context_tokens > 0 ? (
            <span className="tabular-nums text-text-secondary">{row.max_context_tokens.toLocaleString()}</span>
          ) : (
            dash
          ),
      },
    ]

    if (!readOnly) {
      cols.push({
        key: 'source',
        header: 'Source',
        render: (row) => <Badge variant={row.source === 'yaml' ? 'muted' : 'default'}>{row.source}</Badge>,
      })
    }

    cols.push(
      {
        key: 'is_active',
        header: 'Status',
        sortable: true,
        render: (row) => <StatusBadge active={row.is_active} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) => (
          <ModelRowActions
            model={row}
            readOnly={readOnly}
            busy={busyModelId === row.id}
            onView={onView}
            onEdit={onEdit}
            onAddDeployment={onAddDeployment}
            onToggleActive={onToggleActive}
            onDelete={onDelete}
          />
        ),
      },
    )
    return cols
  }, [readOnly, healthByName, busyModelId, onView, onEdit, onAddDeployment, onToggleActive, onDelete])

  return (
    <Table<ModelResponse>
      columns={columns}
      data={models}
      keyExtractor={(row) => row.id}
      loading={loading}
      sort={sort}
      onSort={onSort}
      emptyState={emptyState}
      expandedKeys={readOnly ? undefined : expandedKeys}
      onToggleExpand={readOnly ? undefined : onToggleExpand}
      renderExpandedRow={
        readOnly
          ? undefined
          : (row) =>
              row.deployments?.length ? (
                <DeploymentsSubTable
                  model={row}
                  healthByName={healthByName}
                  onAdd={() => onAddDeployment(row)}
                  onEdit={(dep) => onEditDeployment(row, dep)}
                  onDelete={(dep) => onDeleteDeployment(row, dep)}
                />
              ) : null
      }
    />
  )
}
