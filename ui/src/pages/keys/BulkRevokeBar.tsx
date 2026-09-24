import { Button } from '../../components/ui/Button'
import { Trash2 } from '../../components/ui/icons'
import { cn } from '../../lib/utils'

interface BulkRevokeBarProps {
  selectedCount: number
  allSelected: boolean
  onToggleAll: () => void
  onRevoke: () => void
  onClear: () => void
  disabled?: boolean
}

/**
 * Select-all control for the current page plus, once something is selected, a sticky
 * "N selected · Revoke · Clear" bar.
 */
export function BulkRevokeBar({ selectedCount, allSelected, onToggleAll, onRevoke, onClear, disabled }: BulkRevokeBarProps) {
  const some = selectedCount > 0
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        'mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-sm',
        some && 'sticky top-2 z-20 border border-accent/40 bg-bg-secondary shadow-lg',
      )}
    >
      <label className="flex cursor-pointer items-center gap-2 text-text-secondary">
        <input
          type="checkbox"
          className="accent-accent h-4 w-4 cursor-pointer"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = some && !allSelected
          }}
          onChange={onToggleAll}
          disabled={disabled}
          aria-label="Select all revocable keys on this page"
        />
        <span aria-hidden="true">{some ? '' : 'Select all'}</span>
      </label>
      {some && (
        <>
          <span className="font-medium text-text-primary" aria-live="polite">
            {selectedCount} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="destructive" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={onRevoke} disabled={disabled}>
              Revoke
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear} disabled={disabled}>
              Clear
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function BulkRevokeProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="space-y-2">
      <p>
        Revoking {Math.min(done + 1, total)} of {total}…
      </p>
      <div
        role="progressbar"
        aria-label="Revoke progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary"
      >
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
