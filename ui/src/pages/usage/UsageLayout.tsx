import { Outlet } from 'react-router-dom'
import { PageHeader } from '../../components/ui/PageHeader'
import { Tabs } from '../../components/ui/Tabs'

export default function UsageLayout() {
  return (
    <>
      <PageHeader
        title="Insights"
        description="Token usage, auto-routing, MCP calls, cost estimates, and recent proxy requests."
      />
      <Tabs
        tabs={[
          { label: 'Overview', path: '/usage', end: true },
          { label: 'LLM', path: '/usage/llm' },
          { label: 'MCP', path: '/usage/mcp' },
          { label: 'Auto', path: '/usage/auto' },
          { label: 'Cost', path: '/usage/cost' },
          { label: 'Logs', path: '/usage/logs' },
        ]}
      />
      <Outlet />
    </>
  )
}
