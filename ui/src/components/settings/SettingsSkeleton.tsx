import { SkeletonCard } from '../ui/Skeleton'

/** Placeholder for a two-card settings form (basic info + limits). */
export function SettingsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard bodyClassName="h-20" />
      <SkeletonCard bodyClassName="h-40" />
    </div>
  )
}
