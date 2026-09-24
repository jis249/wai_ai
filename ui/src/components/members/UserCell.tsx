import { Skeleton } from '../ui/Skeleton'
import type { UserResponse } from '../../hooks/useUsers'

export interface UserCellProps {
  user: UserResponse | undefined
  loading?: boolean
  /** Shown when the user record could not be loaded. */
  fallbackId?: string
  /** Appends a "(you)" marker. */
  isSelf?: boolean
}

/** Avatar initial + name + email for a membership row. Truncates on narrow screens. */
export function UserCell({ user, loading = false, fallbackId, isSelf = false }: UserCellProps) {
  if (loading && !user) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-8 w-8 shrink-0 rounded-full bg-bg-tertiary" aria-hidden="true" />
        <span className="truncate font-mono text-xs text-text-tertiary">{fallbackId ?? 'Unknown user'}</span>
      </div>
    )
  }

  const name = user.display_name || user.email
  const initial = name.charAt(0).toUpperCase() || '?'

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-snug text-text-primary">
          {name}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-text-tertiary">(you)</span>}
        </div>
        <div className="truncate text-xs leading-snug text-text-tertiary">{user.email}</div>
      </div>
    </div>
  )
}
