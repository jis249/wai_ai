import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Table, type Column, type PaginationState } from '../ui/Table'
import { Badge } from '../ui/Badge'
import { TimeAgo } from '../ui/TimeAgo'
import { IconButton } from '../ui/IconButton'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/DropdownMenu'
import { Ellipsis, Search, Settings, Trash2, Users } from '../ui/icons'
import type { TeamResponse } from '../../hooks/useTeams'
import { ListToolbar, SearchField } from './SearchField'
import { matchesQuery, useClientSort } from './listState'

export interface TeamsTableProps {
  teams: TeamResponse[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  pagination?: PaginationState
  /** Base path for team links (e.g. "/teams"); omit to render names as plain text. */
  linkBase?: string
  onDelete?: (team: TeamResponse) => void
  emptyState?: React.ReactNode
}

/** Teams list with search, sortable columns and a per-row actions menu. */
export function TeamsTable({ teams, loading = false, error, onRetry, pagination, linkBase, onDelete, emptyState }: TeamsTableProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const filtered = teams.filter((t) => matchesQuery(query, t.name, t.slug))
  const { sorted, sort, onSort } = useClientSort(filtered, {
    name: (t) => t.name,
    member_count: (t) => t.member_count,
    key_count: (t) => t.key_count,
    created_at: (t) => Date.parse(t.created_at) || 0,
  })

  if (error != null && teams.length === 0 && !loading) {
    return <ErrorState variant="card" title="Could not load teams" error={error} onRetry={onRetry} />
  }

  const columns: Column<TeamResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div className="min-w-0 max-w-[16rem]">
          {linkBase ? (
            <Link to={`${linkBase}/${row.id}`} className="block truncate font-medium text-accent no-underline hover:underline">
              {row.name}
            </Link>
          ) : (
            <span className="block truncate font-medium text-text-primary">{row.name}</span>
          )}
          <Badge variant="muted" className="mt-1 max-w-full truncate">
            {row.slug}
          </Badge>
        </div>
      ),
    },
    {
      key: 'member_count',
      header: 'Members',
      sortable: true,
      align: 'right',
      render: (row) => <span className="tabular-nums text-text-secondary">{row.member_count}</span>,
    },
    {
      key: 'key_count',
      header: 'Keys',
      sortable: true,
      align: 'right',
      render: (row) => <span className="tabular-nums text-text-secondary">{row.key_count}</span>,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row) => <TimeAgo date={row.created_at} className="whitespace-nowrap" />,
    },
  ]

  if (linkBase || onDelete) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => {
        if (!linkBase && onDelete) {
          return (
            <IconButton aria-label={`Delete team ${row.name}`} icon={<Trash2 />} size="sm" variant="destructive" onClick={() => onDelete(row)} />
          )
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={`Actions for ${row.name}`} icon={<Ellipsis />} size="sm" tooltip={false} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<Users />} onSelect={() => navigate(`${linkBase}/${row.id}/members`)}>
                Members
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Settings />} onSelect={() => navigate(`${linkBase}/${row.id}/settings`)}>
                Settings
              </DropdownMenuItem>
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => onDelete(row)}>
                    Delete team
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    })
  }

  return (
    <div className="min-w-0">
      <ListToolbar>
        <SearchField value={query} onChange={setQuery} label="Search teams" placeholder="Search name or slug" />
      </ListToolbar>
      <Table<TeamResponse>
        columns={columns}
        data={sorted}
        keyExtractor={(row) => row.id}
        loading={loading}
        sort={sort}
        onSort={onSort}
        pagination={pagination}
        emptyState={
          query.trim() ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No matching teams"
              description="Try a different name or slug."
              action={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          ) : (
            emptyState
          )
        }
      />
    </div>
  )
}
