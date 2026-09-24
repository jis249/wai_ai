import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { useMe } from '../hooks/useMe'
import type { Tab } from '../components/ui/Tabs'

export default function OrganizationPage() {
  const { data: me } = useMe()

  const isOrgAdmin = me?.role === 'org_admin' || me?.role === 'system_admin'

  const tabs: Tab[] = [
    ...(isOrgAdmin ? [{ label: 'Members', path: '/org/users' }] : []),
    { label: 'Settings', path: '/org/settings' },
    ...(isOrgAdmin
      ? [
          { label: 'SSO', path: '/org/sso' },
          { label: 'Audit log', path: '/org/audit' },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Organization"
        description="Members, limits, SSO, and audit. Model and MCP access live under Models and MCP."
      />
      <Tabs tabs={tabs} />
      <Outlet />
    </>
  )
}
