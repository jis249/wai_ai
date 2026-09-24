import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { useMe } from '../hooks/useMe'

export default function MCPLayout() {
  const { data: me } = useMe()
  const isOrgAdmin = me?.role === 'org_admin' || me?.role === 'system_admin'
  const isTeamAdmin = isOrgAdmin || me?.role === 'team_admin'

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
