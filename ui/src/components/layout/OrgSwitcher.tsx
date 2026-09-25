import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useMe } from '../../hooks/useMe'
import { useOrgs } from '../../hooks/useOrgs'
import { setActiveOrgOverride, useActiveOrgId, useActiveOrgOverride } from '../../hooks/useActiveOrg'
import { Select } from '../ui/Select'

/** System-admin picker for which organization the org-scoped pages show. Renders nothing for others. */
export function OrgSwitcher() {
  const { data: me } = useMe()
  const isSystemAdmin = me?.is_system_admin === true
  const { data: orgs } = useOrgs(undefined, isSystemAdmin)
  const override = useActiveOrgOverride()
  const activeOrgId = useActiveOrgId()
  const queryClient = useQueryClient()

  // Drop an override that points at an organization that no longer exists.
  useEffect(() => {
    if (!isSystemAdmin || !override || !orgs || orgs.has_more) return
    if (!orgs.data.some((o) => o.id === override)) setActiveOrgOverride('')
  }, [isSystemAdmin, override, orgs])

  const options = useMemo(
    () =>
      (orgs?.data ?? []).map((o) => ({
        value: o.id,
        label: o.id === me?.org_id ? `${o.name} (mine)` : o.name,
      })),
    [orgs, me?.org_id],
  )

  if (!isSystemAdmin || options.length < 2) return null

  const onChange = (orgId: string) => {
    setActiveOrgOverride(orgId === me?.org_id ? '' : orgId)
    // Org-less queries (e.g. per-team lookups) should not keep showing the previous org's data.
    void queryClient.invalidateQueries()
  }

  return <Select label="Organization" value={activeOrgId} onChange={onChange} options={options} searchable fullWidth />
}
