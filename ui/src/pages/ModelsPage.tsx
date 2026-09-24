import { useCallback, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import type { SortState } from '../components/ui/Table'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { StatCard } from '../components/ui/StatCard'
import { Skeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Activity, CirclePause, Layers, Plus, Search } from '../components/ui/icons'
import {
  useModels,
  useAccessibleModels,
  useDeleteModel,
  useToggleModel,
  useDeleteDeployment,
} from '../hooks/useModels'
import type { ModelResponse, DeploymentResponse } from '../hooks/useModels'
import { useModelHealth } from '../hooks/useModelHealth'
import type { ModelHealthInfo } from '../hooks/useModelHealth'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'
import { ModelDetailDialog } from './ModelDetailDialog'
import { ModelsTable } from './models/ModelsTable'
import { CreateModelSheet } from './models/CreateModelSheet'
import { DeepLinkParam } from '../components/onboarding/DeepLinkParam'
import { EditModelSheet } from './models/EditModelSheet'
import { DeploymentDialog } from './models/DeploymentDialog'
import { modelMatchesSearch, nextSort, sortModels } from './models/modelHelpers'

export interface ModelsPageProps {
  readOnly?: boolean
  hideHeader?: boolean
}

export default function ModelsPage({ readOnly = false, hideHeader = false }: ModelsPageProps) {
  const [detailModel, setDetailModel] = useState<ModelResponse | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editModel, setEditModel] = useState<ModelResponse | null>(null)
  const [deleteModelId, setDeleteModelId] = useState<string | null>(null)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [editDeployment, setEditDeployment] = useState<{ modelId: string; deployment: DeploymentResponse | null } | null>(null)
  const [deleteDeployment, setDeleteDeployment] = useState<{ modelId: string; deploymentId: string } | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState | undefined>(undefined)

  const adminModels = useModels()
  const accessibleModels = useAccessibleModels(readOnly)
  const modelsQuery = readOnly ? accessibleModels : adminModels
  const { data: models, isLoading } = modelsQuery
  const { data: healthData } = useModelHealth()
  const deleteModel = useDeleteModel()
  const toggleModel = useToggleModel()
  const deleteDeploymentMutation = useDeleteDeployment()
  const { toast } = useToast()

  const allModels = useMemo(() => models?.data ?? [], [models])
  const activeCount = allModels.filter((m) => m.is_active).length
  const inactiveCount = allModels.length - activeCount

  const visibleModels = useMemo(
    () => sortModels(allModels.filter((m) => modelMatchesSearch(m, search)), sort),
    [allModels, search, sort],
  )

  // O(1) lookup: model name (or "model/deployment") → health info
  const healthByName = useMemo(() => {
    const map = new Map<string, ModelHealthInfo>()
    for (const h of healthData?.models ?? []) map.set(h.name, h)
    return map
  }, [healthData])

  const busyModelId =
    toggleModel.isPending
      ? (toggleModel.variables?.modelId ?? null)
      : deleteModel.isPending
        ? deleteModelId
        : null

  const handleToggleActive = useCallback(
    (model: ModelResponse, activate: boolean) => {
      toggleModel.mutate(
        { modelId: model.id, activate },
        {
          onError: (err) => {
            toast({ variant: 'error', message: errorMessage(err, 'Failed to update model status') })
          },
        },
      )
    },
    [toggleModel, toast],
  )

  const handleView = useCallback((m: ModelResponse) => setDetailModel(m), [])
  const handleEdit = useCallback((m: ModelResponse) => setEditModel(m), [])
  const handleAskDelete = useCallback((m: ModelResponse) => setDeleteModelId(m.id), [])
  const handleAddDeployment = useCallback(
    (m: ModelResponse) => setEditDeployment({ modelId: m.id, deployment: null }),
    [],
  )

  function handleDelete() {
    if (!deleteModelId) return
    deleteModel.mutate(deleteModelId, {
      onSuccess: () => {
        toast({ variant: 'success', message: 'Model deleted' })
        setDeleteModelId(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete model') })
        setDeleteModelId(null)
      },
    })
  }

  function handleDeleteDeployment() {
    if (!deleteDeployment) return
    deleteDeploymentMutation.mutate(deleteDeployment, {
      onSuccess: () => {
        toast({ variant: 'success', message: 'Deployment deleted' })
        setDeleteDeployment(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete deployment') })
        setDeleteDeployment(null)
      },
    })
  }

  const addButton = readOnly ? undefined : (
    <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowCreate(true)}>
      Add Model
    </Button>
  )

  const emptyState =
    allModels.length === 0 ? (
      <EmptyState
        icon={<Layers className="h-6 w-6" />}
        title={readOnly ? 'No models available' : 'No models configured'}
        description={
          readOnly
            ? 'No models are available to your account yet. Ask an admin to grant access.'
            : 'Add a model endpoint so requests can be routed to it.'
        }
        action={readOnly ? undefined : { label: 'Add model', onClick: () => setShowCreate(true) }}
      />
    ) : (
      <EmptyState
        icon={<Search className="h-6 w-6" />}
        title="No matching models"
        description={`Nothing matches “${search.trim()}” by name, provider or alias.`}
        secondaryAction={{ label: 'Clear search', onClick: () => setSearch('') }}
      />
    )

  const loadFailed = modelsQuery.isError && models === undefined

  return (
    <>
      {!hideHeader && (
        <PageHeader
          title="Models"
          description={readOnly ? 'Models available to your account (read-only)' : 'System model registry'}
          actions={addButton}
        />
      )}

      {/* Stat cards */}
      <div className={`grid grid-cols-1 ${readOnly ? '' : 'sm:grid-cols-3'} gap-4 mb-6`}>
        {isLoading ? (
          Array.from({ length: readOnly ? 1 : 3 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <StatCard
              label={readOnly ? 'Available Models' : 'Total Models'}
              value={loadFailed ? '—' : allModels.length}
              icon={<Layers className="h-[18px] w-[18px]" aria-hidden="true" />}
              iconColor="purple"
            />
            {!readOnly && (
              <>
                <StatCard
                  label="Active"
                  value={loadFailed ? '—' : activeCount}
                  icon={<Activity className="h-[18px] w-[18px]" aria-hidden="true" />}
                  iconColor="green"
                />
                <StatCard
                  label="Inactive"
                  value={loadFailed ? '—' : inactiveCount}
                  icon={<CirclePause className="h-[18px] w-[18px]" aria-hidden="true" />}
                  iconColor="yellow"
                />
              </>
            )}
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search models"
            placeholder="Search name, provider, alias…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {search.trim() !== '' && !isLoading && (
          <span className="text-xs text-text-tertiary" role="status">
            {visibleModels.length} of {allModels.length}
          </span>
        )}
        {hideHeader && addButton != null && <div className="ml-auto">{addButton}</div>}
      </div>

      {loadFailed ? (
        <ErrorState
          variant="card"
          title="Couldn't load models"
          error={modelsQuery.error}
          onRetry={() => void modelsQuery.refetch()}
          retrying={modelsQuery.isFetching}
        />
      ) : (
        <ModelsTable
          models={visibleModels}
          loading={isLoading}
          readOnly={readOnly}
          healthByName={healthByName}
          sort={sort}
          onSort={(column) => setSort((prev) => nextSort(prev, column))}
          emptyState={emptyState}
          expandedKeys={expandedModels}
          onToggleExpand={(key) =>
            setExpandedModels((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }
          busyModelId={busyModelId}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleAskDelete}
          onToggleActive={handleToggleActive}
          onAddDeployment={handleAddDeployment}
          onEditDeployment={(m, dep) => setEditDeployment({ modelId: m.id, deployment: dep })}
          onDeleteDeployment={(m, dep) => setDeleteDeployment({ modelId: m.id, deploymentId: dep.id })}
        />
      )}

      <ModelDetailDialog
        model={detailModel}
        healthByName={healthByName}
        onClose={() => setDetailModel(null)}
        onEdit={readOnly ? undefined : setEditModel}
        readOnly={readOnly}
      />

      {!readOnly && (
        <>
          <DeepLinkParam name="new" onMatch={() => setShowCreate(true)} />
          {showCreate && <CreateModelSheet onClose={() => setShowCreate(false)} />}

          {editModel !== null && <EditModelSheet model={editModel} onClose={() => setEditModel(null)} />}

          <ConfirmDialog
            open={deleteModelId !== null}
            onClose={() => setDeleteModelId(null)}
            onConfirm={handleDelete}
            title="Delete Model"
            description="Are you sure you want to delete this model? This action cannot be undone. YAML-sourced models must be removed from the config file."
            confirmLabel="Delete"
            loading={deleteModel.isPending}
          />

          {editDeployment !== null && (
            <DeploymentDialog
              modelId={editDeployment.modelId}
              deployment={editDeployment.deployment}
              onClose={() => setEditDeployment(null)}
            />
          )}

          <ConfirmDialog
            open={deleteDeployment !== null}
            onClose={() => setDeleteDeployment(null)}
            onConfirm={handleDeleteDeployment}
            title="Delete Deployment"
            description="Are you sure you want to delete this deployment?"
            confirmLabel="Delete"
            loading={deleteDeploymentMutation.isPending}
          />
        </>
      )}
    </>
  )
}
