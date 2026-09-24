import { Outlet } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs } from '../components/ui/Tabs'

export default function ApiAccessLayout() {
  return (
    <>
      <PageHeader
        title="API access"
        description="Keys for clients and service accounts for automation. The playground can use your login session without a separate key."
      />
      <Tabs
        tabs={[
          { label: 'Keys', path: '/keys' },
          { label: 'Service accounts', path: '/service-accounts' },
        ]}
      />
      <Outlet />
    </>
  )
}
