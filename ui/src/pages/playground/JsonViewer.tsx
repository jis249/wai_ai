import { useId, useState } from 'react'
import { CopyButton } from '../../components/ui/CopyButton'
import { ChevronDown, ChevronRight } from '../../components/ui/icons'

/** Collapsible, pretty-printed JSON reply with a copy button. `json` is already formatted. */
export function JsonViewer({ json, defaultOpen = true }: { json: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <div className="min-w-0" data-testid="json-viewer">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          JSON
        </button>
        <CopyButton text={json} label="Copy JSON" copiedLabel="Copied!" />
      </div>
      {open && (
        <pre
          id={bodyId}
          className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-bg-primary p-3 font-mono text-xs leading-relaxed text-text-secondary"
        >
          <code>{json}</code>
        </pre>
      )}
    </div>
  )
}
