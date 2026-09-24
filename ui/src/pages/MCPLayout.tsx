import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { usePermissions } from '../hooks/usePermissions'

export default function MCPLayout() {
  const { isOrgAdmin, isTeamAdmin } = usePermissions()

  const tabs = [
    { label: 'Servers', path: '/mcp', end: true },
    ...(isOrgAdmin ? [{ label: 'Org access', path: '/mcp/org-access' }] : []),
    ...(isTeamAdmin ? [{ label: 'Team access', path: '/mcp/team-access' }] : []),
  ]

  return (
    <>
      <PageHeader
        title="MCP"
        description="Register MCP servers and control which orgs and teams can use them."
      />
      {tabs.length > 1 && <Tabs tabs={tabs} />}
      <Outlet />
    </>
  )
}
