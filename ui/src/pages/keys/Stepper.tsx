import { Check } from '../../components/ui/icons'
import { cn } from '../../lib/utils'

export interface StepperStep {
  id: string
  label: string
}

interface StepperProps {
  steps: StepperStep[]
  /** Index of the current step. */
  current: number
  className?: string
}

/** Numbered progress indicator for a multi-step flow. Labels collapse to "Step n of N" on phones. */
export function Stepper({ steps, current, className }: StepperProps) {
  const active = steps[current]
  return (
    <nav aria-label="Progress" className={className}>
      <p className="mb-2 text-xs text-text-tertiary sm:hidden" aria-hidden="true">
        Step {current + 1} of {steps.length}
        {active ? ` · ${active.label}` : ''}
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {steps.map((step, i) => {
          const done = i < current
          const isCurrent = i === current
          return (
            <li
              key={step.id}
              className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                  done && 'border-accent bg-accent text-white',
                  isCurrent && 'border-accent text-accent',
                  !done && !isCurrent && 'border-border text-text-tertiary',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'hidden min-w-0 truncate text-xs sm:inline',
                  isCurrent ? 'font-medium text-text-primary' : 'text-text-tertiary',
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">
                Step {i + 1}: {step.label}
                {done ? ' (completed)' : isCurrent ? ' (current step)' : ''}
              </span>
              {i < steps.length - 1 && <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-border" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
