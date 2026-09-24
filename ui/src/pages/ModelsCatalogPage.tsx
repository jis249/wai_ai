import { useMe } from '../hooks/useMe'
import ModelsPage from './ModelsPage'

export default function ModelsCatalogPage() {
  const { data: me } = useMe()
  const readOnly = !me?.is_system_admin
  return <ModelsPage readOnly={readOnly} hideHeader />
}
