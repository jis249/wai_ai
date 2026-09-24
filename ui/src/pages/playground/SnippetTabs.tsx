import { useState } from 'react'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { CopyButton } from '../../components/ui/CopyButton'
import type { SnippetLanguage } from './codeSnippets'

export interface Snippet {
  value: SnippetLanguage
  label: string
  code: string
}

interface SnippetTabsProps {
  snippets: Snippet[]
  'aria-label'?: string
  initial?: SnippetLanguage
}

/** Language switcher + copyable code block. */
export function SnippetTabs({ snippets, initial, 'aria-label': ariaLabel = 'Code language' }: SnippetTabsProps) {
  const [language, setLanguage] = useState<SnippetLanguage>(initial ?? snippets[0]?.value ?? 'curl')
  const active = snippets.find((s) => s.value === language) ?? snippets[0]
  if (!active) return null
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label={ariaLabel}
          size="sm"
          value={active.value}
          onChange={setLanguage}
          options={snippets.map((s) => ({ value: s.value, label: s.label }))}
        />
        <CopyButton text={active.code} label={`Copy ${active.label}`} copiedLabel="Copied!" />
      </div>
      <pre
        className="max-h-72 overflow-auto rounded-lg border border-border bg-bg-primary p-3 font-mono text-xs leading-relaxed text-text-secondary"
        data-testid="snippet-code"
      >
        <code>{active.code}</code>
      </pre>
    </div>
  )
}
