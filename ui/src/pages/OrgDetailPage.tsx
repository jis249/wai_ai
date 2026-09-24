import { useParams, Outlet, Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { useOrg } from '../hooks/useOrg'
import { usePermissions } from '../hooks/usePermissions'
import type { Tab } from '../components/ui/Tabs'

export default function OrgDetailPage() {
  const { orgId = '' } = useParams<{ orgId: string }>()

  const { isReady, isSystemAdmin } = usePermissions()
  const { data: org } = useOrg(orgId)

  if (!orgId) {
    return <Navigate to="/orgs" replace />
  }

  if (isReady && !isSystemAdmin) {
    return <Navigate to="/" replace />
  }

  const tabs: Tab[] = [
    { label: 'Members', path: `/orgs/${orgId}/members` },
    { label: 'Teams', path: `/orgs/${orgId}/teams` },
    { label: 'Settings', path: `/orgs/${orgId}/settings` },
    { label: 'SSO', path: `/orgs/${orgId}/sso` },
  ]

  return (
    <>
      <PageHeader
        title={org?.name ?? 'Organization'}
        description={org?.slug ? `/${org.slug}` : 'Manage organization settings, members, and teams'}
      />
      <Tabs tabs={tabs} />
      <Outlet />
    </>
  )
}
