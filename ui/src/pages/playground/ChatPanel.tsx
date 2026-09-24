import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/ui/IconButton'
import { ArrowUp, Bot, CirclePause, Zap } from '../../components/ui/icons'
import { cn } from '../../lib/utils'
import { MessageMarkdown, TypingIndicator } from './MessageMarkdown'
import type { ChatMessage, UsageInfo } from './useChatStream'
import { formatMetrics } from './metrics'

interface ChatPanelProps {
  messages: ChatMessage[]
  isStreaming: boolean
  streamEnabled: boolean
  error: string | null
  usage: UsageInfo | null
  canSend: boolean
  onSend: (text: string) => void
  onStop: () => void
}

function AssistantAvatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-tertiary">
      <Bot className="h-4 w-4 text-accent" aria-hidden="true" />
    </div>
  )
}

export function ChatPanel({ messages, isStreaming, streamEnabled, error, usage, canSend, onSend, onStop }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastId = messages[messages.length - 1]?.id

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages, isStreaming])

  const sendEnabled = canSend && !!draft.trim() && !isStreaming

  function submit() {
    if (!sendEnabled) return
    onSend(draft)
    setDraft('')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const lastIsAssistant = messages[messages.length - 1]?.role === 'assistant'

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5 sm:px-5" aria-live="polite">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-text-tertiary">Send a message to start chatting</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && <AssistantAvatar />}
            <div className="flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[80%]">
              <div
                className={cn(
                  'min-w-0 px-4 py-3 text-sm leading-relaxed text-text-primary sm:px-5 sm:py-4',
                  msg.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm border border-accent/20 bg-accent/10'
                    : 'rounded-2xl rounded-tl-sm border border-border bg-bg-secondary',
                )}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                ) : msg.content ? (
                  <MessageMarkdown content={msg.content} />
                ) : isStreaming && msg.id === lastId ? (
                  <TypingIndicator />
                ) : (
                  <p className="italic text-text-tertiary">No content</p>
                )}
              </div>
              {msg.role === 'assistant' && msg.metrics && (
                <p className="px-1 font-mono text-[11px] text-text-tertiary" data-testid="message-metrics">
                  {formatMetrics(msg.metrics)}
                </p>
              )}
            </div>
          </div>
        ))}

        {isStreaming && !streamEnabled && !lastIsAssistant && (
          <div className="flex justify-start gap-3">
            <AssistantAvatar />
            <div className="rounded-2xl rounded-tl-sm border border-border bg-bg-secondary px-5 py-4">
              <TypingIndicator />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border px-3 py-4 sm:px-5">
        {error !== null && (
          <div role="alert" className="mb-3 break-words rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}
        <div className="rounded-xl border border-border bg-bg-tertiary transition-colors duration-150 focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/30">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Type your message..."
            aria-label="Message"
            rows={3}
            className="block w-full resize-none bg-transparent px-4 pb-2 pt-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-1">
            <span className="hidden text-xs text-text-tertiary sm:inline">Enter to send · Shift+Enter for new line</span>
            <span className="sm:hidden" />
            {isStreaming ? (
              <IconButton variant="secondary" icon={<CirclePause />} aria-label="Stop generating" onClick={onStop} />
            ) : (
              <IconButton
                variant="secondary"
                icon={<ArrowUp />}
                aria-label="Send message"
                onClick={submit}
                disabled={!sendEnabled}
                className={cn(sendEnabled && 'border-accent bg-accent text-white hover:bg-accent hover:text-white hover:brightness-110')}
              />
            )}
          </div>
        </div>
        {usage !== null && (
          <div className="flex items-center gap-2.5 px-2 pt-2">
            <Zap className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="font-mono text-xs text-text-tertiary">
              {usage.prompt_tokens.toLocaleString()} prompt + {usage.completion_tokens.toLocaleString()} completion ={' '}
              {usage.total_tokens.toLocaleString()} total · {usage.duration.toFixed(1)}s
            </span>
          </div>
        )}
      </div>
    </>
  )
}
