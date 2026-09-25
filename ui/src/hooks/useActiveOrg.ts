import { useSyncExternalStore } from 'react'
import { useMe } from './useMe'

// System admins can "act as" another organization on org-scoped pages (Manage, Analytics,
// Organization). Everyone else always works in their session org. Kept per browser.
const STORAGE_KEY = 'wai.activeOrgId'
const listeners = new Set<() => void>()

function readOverride(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

let current = readOverride()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Set (or clear with '') the system-admin organization override. */
export function setActiveOrgOverride(orgId: string): void {
  current = orgId
  try {
    if (orgId) localStorage.setItem(STORAGE_KEY, orgId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the override still applies for this page load.
  }
  listeners.forEach((l) => l())
}

/** The raw override, regardless of role ('' when none). */
export function useActiveOrgOverride(): string {
  return useSyncExternalStore(subscribe, () => current, () => '')
}

/** Organization that org-scoped pages should show: the override for system admins, else the session org. */
export function useActiveOrgId(): string {
  const { data: me } = useMe()
  const override = useActiveOrgOverride()
  if (me?.is_system_admin && override) return override
  return me?.org_id ?? ''
}
