import { QueryState } from '../components/ui/QueryState'
import { EmptyState } from '../components/ui/EmptyState'
import { Building2 } from '../components/ui/icons'
import { OrgSettingsForm } from '../components/settings/OrgSettingsForm'
import { SettingsSkeleton } from '../components/settings/SettingsSkeleton'
import { useActiveOrgId } from '../hooks/useActiveOrg'
import { useOrg } from '../hooks/useOrg'
import { usePermissions } from '../hooks/usePermissions'

/**
 * /org/settings. Org admins edit name/slug; limits, spend caps and guardrails are
 * read-only for them (managed by the system administrator). Members see everything read-only.
 */
export default function SettingsPage() {
  const perms = usePermissions()
  const orgId = useActiveOrgId()
  const orgQuery = useOrg(orgId)

  if (!perms.isReady) {
    return (
      <div className="max-w-3xl">
        <SettingsSkeleton />
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <QueryState query={orgQuery} loading={<SettingsSkeleton />} errorTitle="Could not load organization settings"
        empty={
          <EmptyState
            variant="card"
            icon={<Building2 className="h-6 w-6" />}
            title="No organization"
            description="Your account is not a member of an organization."
          />
        }
      >
        {(org) => (
          <OrgSettingsForm
            key={org.id}
            org={org}
            readOnly={!perms.canManageOrg}
            limitsReadOnly={!perms.isSystemAdmin}
          />
        )}
      </QueryState>
    </div>
  )
}
