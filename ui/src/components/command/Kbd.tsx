import { formatCombo, isMac } from '../../hooks/useHotkeys'
import { cn } from '../../lib/utils'

const kbdClass =
  'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-bg-tertiary px-1 font-mono text-[11px] font-medium leading-none text-text-secondary'

/**
 * Renders a shortcut ("mod+k", "g d") as <kbd> keys. Sequence steps are separated by a
 * visible "then"; the whole hint gets an accessible text like "Ctrl K" / "g then d".
 */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const mac = isMac()
  const steps = keys.trim().split(/\s+/).filter(Boolean)
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-text-tertiary', className)}>
      {steps.map((step, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="px-0.5 text-[10px]">then</span>}
          {formatCombo(step, mac).map((k, j) => (
            <kbd key={j} className={kbdClass}>
              {k}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}
