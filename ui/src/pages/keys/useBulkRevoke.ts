import { useCallback, useState } from 'react'
import type { APIKeyResponse } from '../../hooks/useAPIKeys'
import { errorMessage } from '../../lib/errors'

export interface BulkRevokeResult {
  succeeded: APIKeyResponse[]
  failed: { key: APIKeyResponse; message: string }[]
}

/**
 * Revokes keys one at a time through the existing per-key delete (so each call gets the API's own
 * permission checks and error message), tracking progress for the UI.
 */
export function useBulkRevoke(revokeOne: (keyId: string) => Promise<unknown>) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const run = useCallback(
    async (keys: APIKeyResponse[]): Promise<BulkRevokeResult> => {
      const result: BulkRevokeResult = { succeeded: [], failed: [] }
      setRunning(true)
      setProgress({ done: 0, total: keys.length })
      try {
        for (const [i, key] of keys.entries()) {
          try {
            await revokeOne(key.id)
            result.succeeded.push(key)
          } catch (err) {
            result.failed.push({ key, message: errorMessage(err, 'Failed to revoke key') })
          }
          setProgress({ done: i + 1, total: keys.length })
        }
      } finally {
        setRunning(false)
      }
      return result
    },
    [revokeOne],
  )

  return { run, running, progress }
}
