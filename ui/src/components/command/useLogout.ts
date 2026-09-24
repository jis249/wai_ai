import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import apiClient from '../../api/client'
import { LOCAL_STORAGE_KEY } from '../../lib/constants'

/** Revokes the session server-side (failures ignored), clears local state, and goes to /login. */
export function useLogout() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await apiClient<void>('/auth/logout', { method: 'POST' }).catch(() => {})
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch {
      // storage unavailable
    }
    queryClient.clear()
    window.location.href = '/login'
  }, [queryClient])
}
