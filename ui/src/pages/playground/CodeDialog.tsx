import { useMemo } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { SnippetTabs } from './SnippetTabs'
import {
  API_KEY_PLACEHOLDER,
  buildCurlSnippet,
  buildJavaScriptSnippet,
  buildPythonSnippet,
  maskKey,
  playgroundSnippetParams,
  resolveProxyBaseUrl,
} from './codeSnippets'
import type { ParametersValue } from './ParametersPanel'
import type { ChatMessage } from './useChatStream'

interface CodeDialogProps {
  open: boolean
  onClose: () => void
  model: string
  params: ParametersValue
  messages: ChatMessage[]
}

export function CodeDialog({ open, onClose, model, params, messages }: CodeDialogProps) {
  const snippets = useMemo(() => {
    const p = playgroundSnippetParams(model, params, messages, resolveProxyBaseUrl())
    return [
      { value: 'curl' as const, label: 'curl', code: buildCurlSnippet(p) },
      { value: 'python' as const, label: 'Python', code: buildPythonSnippet(p) },
      { value: 'javascript' as const, label: 'JavaScript', code: buildJavaScriptSnippet(p) },
    ]
  }, [model, params, messages])

  return (
    <Dialog open={open} onClose={onClose} title="View code">
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          This request with the current model, parameters and conversation. Replace{' '}
          <code className="font-mono text-xs">{params.apiKey.trim() ? maskKey(params.apiKey) : API_KEY_PLACEHOLDER}</code> with
          your API key.
        </p>
        <SnippetTabs snippets={snippets} aria-label="Code language" />
      </div>
    </Dialog>
  )
}
