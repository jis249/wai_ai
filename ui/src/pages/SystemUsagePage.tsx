import type { ReactNode } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonText } from '../components/ui/Skeleton'
import { Clock, Cpu, HardDrive, Lock, MemoryStick } from '../components/ui/icons'
import { StatCardSkeletons } from '../components/analytics/StatCardSkeletons'
import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'
import { usePermissions } from '../hooks/usePermissions'
import { useSystemUsage } from '../hooks/useSystemUsage'
import type { SystemStorageInfo } from '../hooks/useSystemUsage'
import { formatBytes, formatNumber, formatDate } from '../lib/utils'

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function percent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0%'
  return `${Math.round(value)}%`
}

function Meter({ value, label }: { value: number; label: string }) {
  const safeValue = Math.max(0, Math.min(100, value || 0))
  return (
    <div
      className="h-2 rounded-full bg-bg-tertiary overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeValue)}
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${safeValue}%` }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" className="min-w-0 p-4 sm:p-6">
      <CardHeader title={title} className="mb-4" />
      {children}
    </Card>
  )
}

interface SubQuery {
  isError: boolean
  error: unknown
  isFetching: boolean
  refetch: () => unknown
}

function SubQueryError({ query, title }: { query: SubQuery; title: string }) {
  return (
    <ErrorState title={title} error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} className="py-6" />
  )
}

function StorageRow({ disk }: { disk: SystemStorageInfo }) {
  return (
    <div className="rounded-lg border border-border bg-bg-primary p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-mono text-sm text-text-primary break-all">{disk.name}</div>
          <div className="text-xs text-text-tertiary">
            {[disk.volume_name, disk.file_system].filter(Boolean).join(' · ') || 'Local disk'}
          </div>
        </div>
        <div className="text-right text-sm text-text-secondary">
          {formatBytes(disk.used_bytes)} / {formatBytes(disk.total_bytes)}
        </div>
      </div>
      <Meter value={disk.used_percent} label={`${disk.name} storage used`} />
      <div className="mt-2 flex justify-between text-xs text-text-tertiary">
        <span>{percent(disk.used_percent)} used</span>
        <span>{formatBytes(disk.free_bytes)} free</span>
      </div>
    </div>
  )
}

export default function SystemUsagePage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { isSystemAdmin, isReady } = usePermissions()
  const usageQuery = useSystemUsage(isSystemAdmin)
  const { data, isLoading, error } = usageQuery
  const ollama = useQuery({
    queryKey: ['system-ollama'],
    queryFn: () => apiClient<{ ok: boolean; base_url: string; models: string[]; loaded: string[]; error?: string }>('/system/ollama'),
    enabled: isSystemAdmin,
    refetchInterval: 20_000,
  })
  const ops = useQuery({
    queryKey: ['system-ops'],
    queryFn: () =>
      apiClient<{
        autostart_task: string
        backend_error_log_tail: string
        backup_hint: string
        config_path: string
        database_dsn_redacted: string
      }>('/system/ops'),
    enabled: isSystemAdmin,
    refetchInterval: 30_000,
  })

  if (isReady && !isSystemAdmin) {
    return (
      <>
        {!hideHeader && <PageHeader title="System Usage" description="Host resource usage and runtime configuration" />}
        <EmptyState
          variant="card"
          icon={<Lock className="w-6 h-6" />}
          title="System admins only"
          description="You need system admin permissions to view system usage."
        />
      </>
    )
  }

  const memoryUsed = data?.memory?.used_percent ?? 0
  const storageTotal = data?.storage?.reduce((sum, d) => sum + d.total_bytes, 0) ?? 0
  const storageUsed = data?.storage?.reduce((sum, d) => sum + d.used_bytes, 0) ?? 0
  const storagePercent = storageTotal > 0 ? (storageUsed / storageTotal) * 100 : 0

  return (
    <>
      {!hideHeader && (
      <PageHeader
        title="System Usage"
        description="Admin-only host resource usage, hardware inventory, and safe runtime configuration."
      />
      )}

      {error != null && (
        <ErrorState
          variant="card"
          className="mb-6"
          title={data == null ? "Couldn't load system usage" : 'Showing last known values — refresh failed'}
          error={error}
          onRetry={() => void usageQuery.refetch()}
          retrying={usageQuery.isFetching}
        />
      )}

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading ? (
            <StatCardSkeletons count={4} />
          ) : (
            <>
              <StatCard
                label="CPU Threads"
                value={formatNumber(data?.runtime.num_cpu ?? 0)}
                icon={<Cpu className="w-4 h-4" />}
                iconColor="purple"
              />
              <StatCard
                label="Memory Used"
                value={percent(memoryUsed)}
                icon={<MemoryStick className="w-4 h-4" />}
                iconColor="blue"
              />
              <StatCard
                label="Storage Used"
                value={percent(storagePercent)}
                icon={<HardDrive className="w-4 h-4" />}
                iconColor="green"
              />
              <StatCard
                label="Backend Uptime"
                value={formatDuration(data?.runtime.uptime_seconds ?? 0)}
                icon={<Clock className="w-4 h-4" />}
                iconColor="pink"
              />
            </>
          )}
        </div>

        <Section title="System">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Info label="OS" value={data?.os.name || data?.os.goos || 'Unknown'} />
            <Info label="Version" value={data?.os.version || 'Unknown'} />
            <Info label="Architecture" value={data?.os.architecture || data?.os.goarch || 'Unknown'} />
            <Info label="Collected" value={data?.collected_at ? formatDate(data.collected_at) : '—'} />
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title="CPU">
            <div className="space-y-3">
              {(data?.cpu ?? []).length > 0 ? data?.cpu.map((cpu) => (
                <div key={cpu.name} className="rounded-lg border border-border bg-bg-primary p-4">
                  <div className="text-sm font-medium text-text-primary">{cpu.name}</div>
                  <div className="mt-2 text-sm text-text-secondary">
                    {formatNumber(cpu.cores)} cores · {formatNumber(cpu.logical_processors)} logical processors
                  </div>
                </div>
              )) : <p className="text-sm text-text-tertiary">CPU inventory unavailable.</p>}
            </div>
          </Section>

          <Section title="Memory">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Used</span>
                <span className="text-text-primary">
                  {formatBytes(data?.memory.used_bytes ?? 0)} / {formatBytes(data?.memory.total_bytes ?? 0)}
                </span>
              </div>
              <Meter value={memoryUsed} label="Memory used" />
              <div className="text-xs text-text-tertiary">
                {formatBytes(data?.memory.available_bytes ?? 0)} available
              </div>
              <div className="pt-3 text-sm text-text-secondary">
                Backend process heap: <span className="text-text-primary">{formatBytes(data?.runtime.process_heap_alloc_bytes ?? 0)}</span>
              </div>
            </div>
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title="GPU">
            <DeviceList devices={data?.gpu ?? []} empty="No GPU devices reported." />
          </Section>
          <Section title="NPU">
            <DeviceList devices={data?.npu ?? []} empty="No NPU devices reported." />
          </Section>
        </div>

        <Section title="Storage">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(data?.storage ?? []).length > 0
              ? data?.storage.map((disk) => <StorageRow key={disk.name} disk={disk} />)
              : <p className="text-sm text-text-tertiary">Storage inventory unavailable.</p>}
          </div>
        </Section>

        <Section title="Ollama">
          {ollama.data ? (
            <div className="space-y-2 text-sm">
              <Info label="Endpoint" value={ollama.data.base_url} monospace />
              <Info label="Reachable" value={ollama.data.ok ? 'yes' : ollama.data.error || 'no'} />
              <Info label="Installed models" value={ollama.data.models.join(', ') || 'none'} />
              <Info label="Loaded now" value={ollama.data.loaded.join(', ') || 'none'} />
            </div>
          ) : ollama.isError ? (
            <SubQueryError query={ollama} title="Couldn't check Ollama" />
          ) : (
            <SkeletonText lines={3} />
          )}
        </Section>

        <Section title="Autostart and backup">
          {ops.data ? (
            <div className="space-y-2 text-sm">
              <Info label="Scheduled task" value={ops.data.autostart_task} />
              <Info label="Config" value={ops.data.config_path} monospace />
              <Info label="Database" value={ops.data.database_dsn_redacted || '—'} monospace />
              <p className="text-xs text-text-tertiary">{ops.data.backup_hint}</p>
              {ops.data.backend_error_log_tail && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-bg-primary p-3 text-[11px] text-text-tertiary whitespace-pre-wrap">
                  {ops.data.backend_error_log_tail}
                </pre>
              )}
            </div>
          ) : ops.isError ? (
            <SubQueryError query={ops} title="Couldn't load ops status" />
          ) : (
            <SkeletonText lines={3} />
          )}
        </Section>

        <Section title="Configuration">
          {Object.keys(data?.configuration ?? {}).length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Object.entries(data?.configuration ?? {}).map(([key, value]) => (
                <Info key={key} label={key} value={value} monospace />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">No safe runtime configuration values are set.</p>
          )}
        </Section>
      </div>
    </>
  )
}

function Info({ label, value, monospace = false }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg-primary p-4">
      <div className="text-xs uppercase tracking-wide text-text-tertiary break-all">{label}</div>
      <div className={monospace ? 'mt-1 font-mono text-sm text-text-primary break-all' : 'mt-1 text-sm text-text-primary break-words'}>
        {value}
      </div>
    </div>
  )
}

function DeviceList({ devices, empty }: { devices: { name: string; memory_bytes?: number }[]; empty: string }) {
  if (devices.length === 0) {
    return <p className="text-sm text-text-tertiary">{empty}</p>
  }
  return (
    <div className="space-y-3">
      {devices.map((device) => (
        <div key={device.name} className="rounded-lg border border-border bg-bg-primary p-4">
          <div className="text-sm font-medium text-text-primary">{device.name}</div>
          {device.memory_bytes != null && device.memory_bytes > 0 && (
            <div className="mt-2 text-sm text-text-secondary">Memory: {formatBytes(device.memory_bytes)}</div>
          )}
        </div>
      ))}
    </div>
  )
}
