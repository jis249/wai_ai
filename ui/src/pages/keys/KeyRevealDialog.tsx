import { useId, useMemo, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { CircleCheck, TriangleAlert } from '../../components/ui/icons'
import { SnippetTabs } from '../playground/SnippetTabs'
import {
  DEFAULT_SNIPPET_MESSAGES,
  buildAnthropicPythonSnippet,
  buildCurlSnippet,
  buildPythonSnippet,
  resolveProxyBaseUrl,
} from '../playground/codeSnippets'

export interface KeyRevealDialogProps {
  /** Plaintext key, shown exactly once. */
  keyValue: string
  onClose: () => void
  title?: string
  keyName?: string
  /** Model used in the example snippets. */
  model?: string
  /** Override for tests; defaults to the resolved public proxy URL. */
  baseUrl?: string
}

/**
 * One-time reveal of a newly created or rotated key. Closing (button, X, Escape, backdrop)
 * is blocked until the user confirms they stored the key.
 */
export function KeyRevealDialog({
  keyValue,
  onClose,
  title = 'API key created',
  keyName,
  model,
  baseUrl: baseUrlProp,
}: KeyRevealDialogProps) {
  const [stored, setStored] = useState(false)
  const [nudge, setNudge] = useState(false)
  const checkboxId = useId()
  const keyFieldId = useId()
  const baseUrl = baseUrlProp ?? resolveProxyBaseUrl()

  const snippets = useMemo(() => {
    const params = {
      baseUrl,
      apiKey: keyValue,
      model: model || 'your-model-name',
      messages: DEFAULT_SNIPPET_MESSAGES,
    }
    return [
      { value: 'curl' as const, label: 'curl', code: buildCurlSnippet(params) },
      { value: 'python' as const, label: 'Python', code: buildPythonSnippet(params) },
      { value: 'anthropic' as const, label: 'Anthropic SDK', code: buildAnthropicPythonSnippet(params) },
    ]
  }, [baseUrl, keyValue, model])

  function tryClose() {
    if (stored) onClose()
    else setNudge(true)
  }

  return (
    <Dialog open onClose={tryClose} title={title} closeOnBackdrop={false} closeOnEscape={false}>
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <p className="text-sm text-text-secondary">
            {keyName ? (
              <>
                <span className="font-medium text-text-primary">{keyName}</span> is ready to use.
              </>
            ) : (
              'Your key is ready to use.'
            )}
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5" role="note">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="text-xs leading-relaxed text-warning">
            Copy this key now. You won&apos;t be able to see it again.
          </span>
        </div>

        <div>
          <label htmlFor={keyFieldId} className="mb-1.5 block text-sm font-medium text-text-secondary">
            API key
          </label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={keyFieldId}
              readOnly
              value={keyValue}
              onFocus={(e) => e.currentTarget.select()}
              className="block w-full min-w-0 rounded-md border border-border bg-bg-primary px-3 py-2 font-mono text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              spellCheck={false}
            />
            <CopyButton text={keyValue} label="Copy key" copiedLabel="Copied!" className="shrink-0 self-start sm:self-auto" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text-primary">Try it</p>
            <p className="min-w-0 truncate text-xs text-text-tertiary">
              Base URL <span className="font-mono">{baseUrl}</span>
            </p>
          </div>
          <SnippetTabs snippets={snippets} aria-label="Snippet language" />
        </div>

        <div className="space-y-1">
          <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2.5 text-sm text-text-primary">
            <input
              id={checkboxId}
              type="checkbox"
              checked={stored}
              onChange={(e) => {
                setStored(e.target.checked)
                if (e.target.checked) setNudge(false)
              }}
              className="accent-accent mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            />
            I&apos;ve stored this key somewhere safe
          </label>
          {nudge && (
            <p className="pl-6 text-xs text-warning" role="alert">
              Confirm you&apos;ve stored the key before closing.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose} disabled={!stored}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
