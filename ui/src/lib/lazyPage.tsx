import { lazy, Suspense, type ComponentType } from 'react'
import { PageFallback } from '../components/PageFallback'

/**
 * `React.lazy` + a per-route `<Suspense>` boundary, so a layout (tabs, headers)
 * stays mounted while only the child route's chunk loads.
 *
 *   const KeysPage = lazyPage(() => import('../pages/KeysPage'))
 */
export function lazyPage<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  const Lazy = lazy(factory)
  function LazyPage(props: P) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  return LazyPage
}
