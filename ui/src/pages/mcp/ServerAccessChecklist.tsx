import { useMemo, useState } from 'react'
import type { AvailableMCPServer } from '../../hooks/useMCPAccess'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { EmptyState } from '../../components/ui/EmptyState'
import { Info, Search, Server } from '../../components/ui/icons'

interface ServerAccessChecklistProps {
  /** Servers the user can choose from. */
  servers: AvailableMCPServer[]
  /** Saved allowlist (server ids). Empty = no restriction. */
  saved: string[]
  /** Persist the new list; resolve on success, reject on failure (dirty state is kept). */
  onSave: (ids: string[]) => Promise<unknown>
  saving: boolean
  /** Read-only when the user can't edit. */
  readOnly?: boolean
  /** e.g. "this organization" / "this team". */
  subject: string
  /** Text shown when the list is empty (no restriction). */
  unrestrictedText: string
}

export function ServerAccessChecklist({
  servers,
  saved,
  onSave,
  saving,
  readOnly = false,
  subject,
  unrestrictedText,
}: ServerAccessChecklistProps) {
  const [pending, setPending] = useState<Set<string> | null>(null)
  const [query, setQuery] = useState('')

  const savedSet = useMemo(() => new Set(saved), [saved])
  const selected = pending ?? savedSet
  const isDirty =
    pending !== null && (pending.size !== savedSet.size || [...pending].some((id) => !savedSet.has(id)))

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter((s) => s.name.toLowerCase().includes(q) || (s.alias ?? '').toLowerCase().includes(q))
  }, [servers, query])

  function update(fn: (next: Set<string>) => void) {
    setPending((prev) => {
      const next = new Set(prev ?? savedSet)
      fn(next)
      return next
    })
  }

  function toggle(id: string) {
    update((next) => (next.has(id) ? next.delete(id) : next.add(id)))
  }

  function handleSave() {
    if (!pending) return
    onSave(Array.from(pending)).then(
      () => setPending(null),
      () => undefined,
    )
  }

  // Selected ids that are no longer in the available list still count toward the saved list.
  const selectedCount = servers.filter((s) => selected.has(s.id)).length

  return (
    <div className="space-y-4">
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-secondary px-4 py-3"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          {selected.size === 0
            ? unrestrictedText
            : `Restricted: ${subject} can use ${selectedCount} of ${servers.length} server${servers.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      {servers.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Server className="w-6 h-6" />}
          title="No global MCP servers available"
          description="A system admin must register a global MCP server before access can be narrowed."
        />
      ) : (
        <div className="rounded-xl border border-border bg-bg-secondary">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Search servers"
                placeholder="Search servers…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update((next) => visible.forEach((s) => next.add(s.id)))}
                  disabled={visible.length === 0}
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update((next) => visible.forEach((s) => next.delete(s.id)))}
                  disabled={visible.length === 0}
                >
                  Select none
                </Button>
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-tertiary">No servers match “{query.trim()}”.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {visible.map((server) => {
                const isSelected = selected.has(server.id)
                return (
                  <li key={server.id}>
                    <label
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 transition-colors',
                        readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-bg-tertiary',
                        isSelected && 'bg-accent/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={readOnly || saving}
                        onChange={() => toggle(server.id)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{server.name}</span>
                      {server.alias && (
                        <span className="max-w-[40%] truncate font-mono text-xs text-text-tertiary">{server.alias}</span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {!readOnly && (isDirty || saving) && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-3 shadow-lg"
        >
          <p className="text-sm text-text-secondary">
            Unsaved changes
            {pending && pending.size === 0 && ' — saving an empty list removes all restrictions'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPending(null)} disabled={saving}>
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
