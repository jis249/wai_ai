/** Centered spinner shown while a lazily loaded route chunk downloads. */
export function PageFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex min-h-[40vh] items-center justify-center">
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  )
}
