import { Badge } from '../ui/Badge'
import { Shield, ShieldCheck } from '../ui/icons'
import { formatRole, roleRank, ROLE_RANK } from '../../hooks/usePermissions'

export interface RoleBadgeProps {
  role: string
  className?: string
}

/** Role label with an icon for admin roles (so status is not conveyed by color alone). */
export function RoleBadge({ role, className }: RoleBadgeProps) {
  const rank = roleRank(role)
  const isAdmin = rank >= ROLE_RANK.team_admin
  const icon =
    rank >= ROLE_RANK.org_admin ? (
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
    ) : isAdmin ? (
      <Shield className="h-3 w-3" aria-hidden="true" />
    ) : undefined
  return (
    <Badge variant={isAdmin ? 'default' : 'muted'} icon={icon} className={className}>
      {formatRole(role) || role}
    </Badge>
  )
}
