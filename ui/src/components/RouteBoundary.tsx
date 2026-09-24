import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { Button } from './ui/Button'
import { ErrorState } from './ui/ErrorState'

function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(
    error.message,
  )
}

/**
 * Layout route that isolates page crashes: renders <Outlet /> inside an ErrorBoundary
 * that resets whenever the URL path changes, so navigating away recovers.
 */
export function RouteBoundary() {
  const location = useLocation()
  return (
    <ErrorBoundary
      resetKey={location.pathname}
      fallback={(error, reset) => {
        const stale = isChunkLoadError(error)
        return (
          <div className="bg-bg-secondary rounded-xl border border-border p-6">
            <ErrorState
              title={stale ? 'A new version of WAI is available' : 'This page failed to render'}
              message={stale ? 'Reload to fetch the latest version of the dashboard.' : error.message || 'An unexpected error occurred.'}
              onRetry={stale ? undefined : reset}
            />
            <div className="-mt-6 flex justify-center pb-6">
              <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        )
      }}
    >
      <Outlet />
    </ErrorBoundary>
  )
}
