import { useParams } from 'react-router-dom'
import { QueryState } from '../components/ui/QueryState'
import { OrgSettingsForm } from '../components/settings/OrgSettingsForm'
import { SettingsSkeleton } from '../components/settings/SettingsSkeleton'
import { useOrg } from '../hooks/useOrg'

/** /orgs/:orgId/settings: system-admin edit of any org, including limits, spend cap and guardrails. */
export default function OrgDetailSettingsTab() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const orgQuery = useOrg(orgId)

  return (
    <div className="max-w-3xl">
      <QueryState query={orgQuery} loading={<SettingsSkeleton />} errorTitle="Could not load organization settings">
        {(org) => <OrgSettingsForm key={org.id} org={org} />}
      </QueryState>
    </div>
  )
}
