import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Textarea'
import { errorMessage } from '../../lib/errors'
import { cosineSimilarity, fetchEmbeddings } from './proxy'

interface SimilarityPanelProps {
  model: string
  apiKey: string
}

export function SimilarityPanel({ model, apiKey }: SimilarityPanelProps) {
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  const [similarity, setSimilarity] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCompare = !!model && !!textA.trim() && !!textB.trim() && !loading

  async function handleCompare() {
    if (!canCompare) return
    setLoading(true)
    setError(null)
    try {
      const [vecA, vecB] = await fetchEmbeddings(model, apiKey, [textA.trim(), textB.trim()])
      if (!vecA?.length || !vecB?.length) {
        setError('Unexpected response: expected two embeddings')
        return
      }
      setSimilarity(cosineSimilarity(vecA, vecB))
    } catch (err) {
      setError(errorMessage(err, 'Request failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card padding="sm" className="space-y-4 sm:p-5">
      <h3 className="text-sm font-medium text-text-primary">Similarity Comparison</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Textarea
          value={textA}
          onChange={(e) => setTextA(e.target.value)}
          placeholder="Enter first text..."
          rows={3}
          disabled={loading}
          aria-label="First text for comparison"
        />
        <Textarea
          value={textB}
          onChange={(e) => setTextB(e.target.value)}
          placeholder="Enter second text..."
          rows={3}
          disabled={loading}
          aria-label="Second text for comparison"
        />
      </div>
      <Button size="sm" onClick={() => void handleCompare()} disabled={!canCompare} loading={loading}>
        Compare
      </Button>
      {error !== null && (
        <div role="alert" className="break-words rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}
      {similarity !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-text-tertiary">Cosine Similarity:</span>
          <span className="rounded-full border border-accent/20 bg-accent/15 px-3 py-1.5 font-mono text-sm font-medium text-accent">
            {similarity.toFixed(4)}
          </span>
        </div>
      )}
    </Card>
  )
}
