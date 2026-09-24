import { useEffect, useRef } from 'react'
import { useInRouterContext, useSearchParams } from 'react-router-dom'

export interface DeepLinkParamProps {
  /** Query parameter to watch, e.g. `new` for `/keys?new=1`. */
  name: string
  /** Value that triggers the action (default `'1'`). */
  value?: string
  /** Called once when the parameter is present (e.g. open a create dialog). */
  onMatch: () => void
}

function DeepLinkParamInner({ name, value = '1', onMatch }: DeepLinkParamProps) {
  const [params, setParams] = useSearchParams()
  const matched = params.get(name) === value
  const onMatchRef = useRef(onMatch)

  useEffect(() => {
    onMatchRef.current = onMatch
  })

  useEffect(() => {
    if (!matched) return
    onMatchRef.current()
    // Drop the param so a refresh / back navigation doesn't reopen it.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(name)
        return next
      },
      { replace: true },
    )
  }, [matched, name, setParams])

  return null
}

/**
 * Renderless deep-link handler: when `?<name>=<value>` is in the URL, calls `onMatch` and removes
 * the param (history replace). Mount it only when the action is allowed for the viewer. Safe
 * outside a router (renders nothing), so pages keep working in router-less tests.
 */
export function DeepLinkParam(props: DeepLinkParamProps) {
  const inRouter = useInRouterContext()
  if (!inRouter) return null
  return <DeepLinkParamInner {...props} />
}
