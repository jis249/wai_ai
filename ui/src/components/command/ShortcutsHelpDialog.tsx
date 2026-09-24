import { Dialog } from '../ui/Dialog'
import { SHORTCUTS, type ShortcutDef } from './shortcuts'
import { Kbd } from './Kbd'

export interface ShortcutsHelpDialogProps {
  open: boolean
  onClose: () => void
}

const GROUPS: ShortcutDef['group'][] = ['General', 'Navigation']

export function ShortcutsHelpDialog({ open, onClose }: ShortcutsHelpDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group} aria-labelledby={`shortcut-group-${group}`}>
            <h3
              id={`shortcut-group-${group}`}
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
            >
              {group}
            </h3>
            <dl className="space-y-2">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="min-w-0 text-text-secondary">{s.description}</dt>
                  <dd>
                    <Kbd keys={s.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
