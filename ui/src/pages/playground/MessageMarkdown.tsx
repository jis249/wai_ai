/**
 * Minimal markdown renderer for assistant replies: splits on ``` code fences, no external library.
 *
 * Security: model output is untrusted. Everything is rendered as React text children (which React
 * escapes); there is deliberately no dangerouslySetInnerHTML anywhere in the playground.
 */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-0.5" role="status" aria-label="Waiting for response">
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '0ms' }} />
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '150ms' }} />
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: '300ms' }} />
    </div>
  )
}

export function MessageMarkdown({ content }: { content: string }) {
  // Split on triple-backtick fences (optionally with a language hint). An unterminated fence
  // (mid-stream) stays plain text until it closes.
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <div className="min-w-0 space-y-2">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
          const lang = /^```([^\n`]*)/.exec(part)?.[1]?.trim()
          const inner = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
          return (
            <pre
              key={idx}
              data-lang={lang || undefined}
              className="overflow-x-auto rounded-lg border border-border bg-bg-primary p-4 font-mono text-xs leading-relaxed"
            >
              <code>{inner}</code>
            </pre>
          )
        }
        return part ? (
          <p key={idx} className="whitespace-pre-wrap break-words leading-relaxed">
            {part}
          </p>
        ) : null
      })}
    </div>
  )
}
