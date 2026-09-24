import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'
import { usePermissions } from '../hooks/usePermissions'

export default function ModelsLayout() {
  const { isOrgAdmin, isTeamAdmin } = usePermissions()

  const tabs = [
    { label: 'Catalog', path: '/models', end: true },
    ...(isOrgAdmin ? [{ label: 'Org access', path: '/models/org-access' }] : []),
    ...(isTeamAdmin ? [{ label: 'Team access', path: '/models/team-access' }] : []),
  ]

  return (
    <>
      <PageHeader
        title="Models"
        description="Catalog of available models and who can use them."
      />
      {tabs.length > 1 && <Tabs tabs={tabs} />}
      <Outlet />
    </>
  )
}
