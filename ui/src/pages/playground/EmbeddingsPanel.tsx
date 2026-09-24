import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Textarea'
import { errorMessage } from '../../lib/errors'
import { fetchEmbeddings } from './proxy'

interface EmbeddingsPanelProps {
  model: string
  apiKey: string
}

export function EmbeddingsPanel({ model, apiKey }: EmbeddingsPanelProps) {
  const [input, setInput] = useState('')
  const [vector, setVector] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmbed() {
    if (!model || !input.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const vectors = await fetchEmbeddings(model, apiKey, input.trim())
      setVector(vectors[0] ?? [])
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card padding="sm" className="space-y-4 sm:p-5">
      <h3 className="text-sm font-medium text-text-primary">Generate Embedding</h3>
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter text to embed..."
        rows={4}
        disabled={loading}
        aria-label="Text to embed"
      />
      <Button size="sm" onClick={() => void handleEmbed()} disabled={!model || !input.trim() || loading} loading={loading}>
        Generate Embedding
      </Button>
      {error !== null && (
        <div role="alert" className="break-words rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}
      {vector !== null && (
        <div className="space-y-2">
          <div className="flex gap-4 text-sm">
            <span className="text-text-tertiary">Dimensions:</span>
            <span className="font-mono text-text-primary">{vector.length}</span>
          </div>
          <div>
            <span className="text-sm text-text-tertiary">Vector:</span>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-bg-primary p-4 font-mono text-xs">
              [{vector.slice(0, 8).map((v) => v.toFixed(6)).join(', ')}
              {vector.length > 8 ? ', ...' : ''}]
            </pre>
          </div>
        </div>
      )}
    </Card>
  )
}
