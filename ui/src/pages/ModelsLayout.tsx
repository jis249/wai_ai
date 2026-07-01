import { useMe } from '../hooks/useMe'
import ModelsPage from './ModelsPage'

export default function ModelsLayout() {
  const { data: me } = useMe()
  const readOnly = !me?.is_system_admin

  return <ModelsPage readOnly={readOnly} />
}
