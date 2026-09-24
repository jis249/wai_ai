import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/ui/PageHeader'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Select } from '../../components/ui/Select'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonText } from '../../components/ui/Skeleton'
import { Building2, Lock, Server } from '../../components/ui/icons'
import { usePermissions } from '../../hooks/usePermissions'
import { useMe } from '../../hooks/useMe'
import { useAlertOrgOptions } from '../../hooks/useAlerts'
import { ChannelsCard } from './ChannelsCard'
import { RulesCard } from './RulesCard'
import { EventsCard } from './EventsCard'

type ScopeMode = 'platform' | 'org'

export default function AlertsPage() {
  const perms = usePermissions()
  const { data: me } = useMe()
  const [mode, setMode] = useState<ScopeMode>('platform')
  const [pickedOrg, setPickedOrg] = useState<string>('')
  const orgs = useAlertOrgOptions(perms.isSystemAdmin)
  const orgNames = useMemo(() => new Map((orgs.data?.data ?? []).map((o) => [o.id, o.name])), [orgs.data?.data])

  if (!perms.isReady) {
    return (
      <>
        <PageHeader title="Alerts" />
        <SkeletonText lines={4} />
      </>
    )
  }

  if (!perms.isOrgAdmin) {
    return (
      <>
        <PageHeader title="Alerts" />
        <EmptyState
          variant="card"
          icon={<Lock className="h-6 w-6" />}
          title="Organization admins only"
          description="Ask an organization admin to set up alert channels and rules."
        />
      </>
    )
  }

  const ownOrg = me?.org_id ?? ''
  const isSys = perms.isSystemAdmin
  const orgId = isSys ? pickedOrg || ownOrg : ownOrg
  const scope = isSys && mode === 'platform' ? '' : orgId

  const orgOptions = (orgs.data?.data ?? []).map((o) => ({ value: o.id, label: o.name }))
  if (orgId && !orgOptions.some((o) => o.value === orgId)) orgOptions.unshift({ value: orgId, label: 'My organization' })

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Send budget, error-rate, health and digest alerts to Microsoft Teams, Slack or webhooks."
      />
      {isSys && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <SegmentedControl<ScopeMode>
            aria-label="Alert scope"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'platform', label: 'Platform', icon: <Server className="h-4 w-4" /> },
              { value: 'org', label: 'Organization', icon: <Building2 className="h-4 w-4" /> },
            ]}
          />
          {mode === 'org' && (
            <div className="w-full sm:max-w-xs">
              <Select
                label="Organization"
                options={orgOptions}
                value={orgId}
                onChange={setPickedOrg}
                searchable
                placeholder="Select organization"
              />
            </div>
          )}
        </div>
      )}
      {isSys && mode === 'platform' && (
        <p className="mb-4 text-sm text-text-secondary">
          Platform channels receive platform events (model health, circuit breakers) and every critical alert from any
          organization.
        </p>
      )}
      {!isSys || mode === 'platform' || scope ? (
        <div key={scope || 'platform'} className="space-y-6">
          <ChannelsCard scope={scope} />
          <RulesCard scope={scope} />
          <EventsCard scope={scope} orgNames={orgNames} />
        </div>
      ) : (
        <EmptyState variant="card" icon={<Building2 className="h-6 w-6" />} title="Choose an organization" />
      )}
    </>
  )
}
