import { Navigate, Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { useMe } from '../hooks/useMe'

export default function PlatformLayout() {
  const { data: me, isLoading } = useMe()
  if (isLoading) return null
  if (!me?.is_system_admin && me?.role !== 'system_admin') {
    return <Navigate to="/" replace />
  }

  return (
    <>
      <PageHeader
        title="Platform"
        description="Host health, first-run checklist, and auto-routing configuration."
      />
      <Tabs
        tabs={[
          { label: 'Setup', path: '/platform/setup' },
          { label: 'Host', path: '/platform/host' },
          { label: 'Auto routing', path: '/platform/auto-routing' },
        ]}
      />
      <Outlet />
    </>
  )
}
