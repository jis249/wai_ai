import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { usePermissions } from '../hooks/usePermissions'
import type { Tab } from '../components/ui/Tabs'

export default function OrganizationPage() {
  const { isOrgAdmin } = usePermissions()

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
