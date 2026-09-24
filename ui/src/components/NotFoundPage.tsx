import { Link } from 'react-router-dom'
import { PageHeader } from './ui/PageHeader'
import { EmptyState } from './ui/EmptyState'
import { Search } from './ui/icons'

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="That URL is not part of the WAI dashboard." />
      <EmptyState
        variant="card"
        icon={<Search className="h-6 w-6" aria-hidden="true" />}
        title="Nothing here"
        description="Check the address or return to the dashboard."
      >
        <Link to="/" className="text-sm text-accent no-underline hover:underline">
          Go to dashboard
        </Link>
      </EmptyState>
    </>
  )
}
