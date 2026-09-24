import { Navigate } from 'react-router-dom'
import { SkeletonCard } from '../components/ui/Skeleton'
import { useMe } from '../hooks/useMe'

/**
 * Legacy /sso route (not in the nav). Its content duplicated the org SSO tab
 * (OrgDetailSSOTab shows the global config read-only plus the org override form),
 * so it now redirects: users with an org go to /org/sso; system admins without an
 * org go to /orgs, where each organization has its own SSO tab.
 */
export default function SSOConfigPage() {
  const { data: me, isLoading } = useMe()
  if (isLoading) return <SkeletonCard className="max-w-3xl" />
  return <Navigate to={me?.org_id ? '/org/sso' : '/orgs'} replace />
}
