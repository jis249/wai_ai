import { usePermissions } from '../hooks/usePermissions'
import ModelsPage from './ModelsPage'

export default function ModelsCatalogPage() {
  const { isSystemAdmin } = usePermissions()
  return <ModelsPage readOnly={!isSystemAdmin} hideHeader />
}
