import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { CopyButton } from '../ui/CopyButton'
import { ErrorState } from '../ui/ErrorState'
import { IconButton } from '../ui/IconButton'
import { Skeleton } from '../ui/Skeleton'
import { ArrowRight, CircleCheck, Sparkles, X } from '../ui/icons'
import { useMe } from '../../hooks/useMe'
import { usePermissions } from '../../hooks/usePermissions'
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus'
import { useAvailableModels } from '../../hooks/useAvailableModels'
import { resolveProxyBaseUrl } from '../../lib/proxyUrl'
import { cn } from '../../lib/utils'
import { API_KEY_PLACEHOLDER, buildCurlSnippet } from '../../pages/playground/codeSnippets'
import { ONBOARDING_DISMISS_KEY, onboardingSteps, readDismissed, writeDismissed } from './onboardingSteps'
import type { OnboardingStep } from './onboardingSteps'

const linkButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

/**
 * Self-contained "Getting started" checklist. Steps tick themselves from GET /onboarding/status,
 * steps the viewer's role can't do are hidden, and the card disappears once every visible step is
 * done or the viewer dismisses it (remembered per user in localStorage).
 */
export function GettingStarted({ className }: { className?: string }) {
  const { data: me } = useMe()
  const perms = usePermissions()
  const storageKey = `${ONBOARDING_DISMISS_KEY}:${me?.id ?? 'anon'}`
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const dismissed = dismissedKeys.has(storageKey) || (!!me?.id && readDismissed(storageKey))

  const statusQuery = useOnboardingStatus({ enabled: perms.isReady && !dismissed })
  const { data: available } = useAvailableModels()

  if (!perms.isReady || dismissed) return null

  const steps = onboardingSteps(statusQuery.data, { isSystemAdmin: perms.isSystemAdmin, isOrgAdmin: perms.isOrgAdmin })
  const doneCount = steps.filter((s) => s.done).length
  if (statusQuery.data && doneCount === steps.length) return null

  function dismiss() {
    writeDismissed(storageKey)
    setDismissedKeys((prev) => new Set(prev).add(storageKey))
  }

  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0
  const snippetModel =
    available?.models.find((m) => m.type === 'chat' || m.type === 'completion')?.name ?? available?.models[0]?.name ?? 'your-model'
  const curl = buildCurlSnippet({
    baseUrl: resolveProxyBaseUrl(),
    apiKey: API_KEY_PLACEHOLDER,
    model: snippetModel,
    messages: [{ role: 'user', content: 'Hello!' }],
  })

  return (
    <Card as="section" aria-labelledby="getting-started-title" className={cn('relative', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="getting-started-title" className="text-lg font-semibold text-text-primary">
              Getting started
            </h2>
            <p className="mt-1 text-sm text-text-secondary">A few steps to get your gateway serving requests.</p>
          </div>
        </div>
        <IconButton icon={<X />} aria-label="Dismiss getting started" tooltip="Dismiss" onClick={dismiss} />
      </div>

      {statusQuery.isError && !statusQuery.data ? (
        <ErrorState
          title="Couldn't load setup progress"
          error={statusQuery.error}
          onRetry={() => void statusQuery.refetch()}
          retrying={statusQuery.isFetching}
          className="py-6"
        />
      ) : statusQuery.isPending ? (
        <div className="space-y-3" aria-label="Loading setup progress">
          <Skeleton className="h-2 w-full rounded-full" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {doneCount} of {steps.length} complete
              </span>
              <span aria-hidden="true">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
              aria-valuetext={`${doneCount} of ${steps.length} steps complete`}
              className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary"
            >
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <StepItem key={step.id} step={step} index={i} curl={step.id === 'request' ? curl : undefined} />
            ))}
          </ol>
        </>
      )}
    </Card>
  )
}

function StepItem({ step, index, curl }: { step: OnboardingStep; index: number; curl?: string }) {
  return (
    <li
      data-testid={`onboarding-step-${step.id}`}
      data-done={step.done}
      className={cn('rounded-lg border border-border p-3', step.done && 'bg-bg-tertiary/30')}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {step.done ? (
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] text-text-tertiary"
            >
              {index + 1}
            </span>
          )}
          <div className="min-w-0">
            <p className={cn('text-sm font-medium', step.done ? 'text-text-tertiary line-through' : 'text-text-primary')}>
              {step.title}
              <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
            </p>
            {!step.done && <p className="mt-0.5 text-xs text-text-tertiary">{step.description}</p>}
          </div>
        </div>
        {!step.done && (
          <Link to={step.href} className={cn(linkButton, 'self-start sm:self-auto')}>
            {step.actionLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {!step.done && curl && (
        <div className="mt-3 min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs text-text-tertiary">Replace {API_KEY_PLACEHOLDER} with your key:</span>
            <CopyButton text={curl} aria-label="Copy curl command" />
          </div>
          <pre className="max-h-48 overflow-auto rounded-md bg-bg-tertiary p-3 font-mono text-xs text-text-secondary">
            <code>{curl}</code>
          </pre>
        </div>
      )}
    </li>
  )
}
