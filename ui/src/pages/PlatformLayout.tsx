import { Navigate, Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { usePermissions } from '../hooks/usePermissions'

export default function PlatformLayout() {
  const { isReady, isSystemAdmin } = usePermissions()
  if (!isReady) return null
  if (!isSystemAdmin) {
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
