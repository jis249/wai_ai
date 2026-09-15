import { Link } from 'react-router-dom'
import { PageHeader } from './ui/PageHeader'

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="That URL is not part of the WAI dashboard." />
      <div className="rounded-lg border border-border bg-bg-secondary p-12 text-center space-y-4">
        <p className="text-sm text-text-tertiary">Check the address or return to the dashboard.</p>
        <Link to="/" className="text-sm text-accent no-underline hover:underline">
          Go to dashboard
        </Link>
      </div>
    </>
  )
}
