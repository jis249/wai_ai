import { Skeleton } from '../ui/Skeleton'

/** Placeholder tiles sized like <StatCard>. Place inside the page's stat grid. */
export function StatCardSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[124px] rounded-xl" />
      ))}
    </>
  )
}
