import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CompareView } from './CompareView'
import type { ParametersValue } from './ParametersPanel'
import { DEFAULT_RESPONSE_FORMAT } from './responseFormat'
import type { ModelPricing } from './metrics'

const encoder = new TextEncoder()

const params: ParametersValue = {
  systemPrompt: 'Be brief.',
  temperature: 0.3,
  maxTokens: 100,
  stream: true,
  apiKey: 'wa_uk_k',
  responseFormat: DEFAULT_RESPONSE_FORMAT,
}

const options = [
  { value: 'model-a', label: 'model-a' },
  { value: 'model-b', label: 'model-b' },
  { value: 'model-c', label: 'model-c' },
]

interface PendingStream {
  model: string
  body: Record<string, unknown>
  /** Finish the stream normally. */
  release: () => void
}

/**
 * fetch mock: every call streams "Hi from <model>" then hangs until `release()` or abort, so the
 * test can observe requests that are in flight at the same time.
 */
function installStreamingFetch() {
  const pending: PendingStream[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    let released!: () => void
    const releasedP = new Promise<void>((r) => (released = r))
    pending.push({ model: body.model as string, body, release: () => released() })
    let step = 0
    const reader = {
      read: vi.fn(async () => {
        step += 1
        if (step === 1) {
          const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: `Hi from ${body.model}` } }] })}\n\n`
          return { done: false, value: encoder.encode(frame) }
        }
        if (step === 2) {
          await new Promise<void>((resolve, reject) => {
            releasedP.then(resolve)
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          })
          const usage = `data: ${JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } })}\n\n`
          return { done: false, value: encoder.encode(usage) }
        }
        return { done: true, value: undefined }
      }),
      releaseLock: vi.fn(),
    }
    return { ok: true, status: 200, statusText: 'OK', body: { getReader: () => reader }, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, pending }
}

function renderCompare(overrides: Partial<Parameters<typeof CompareView>[0]> = {}) {
  const pricing = new Map<string, ModelPricing>([
    ['model-a', { inputPer1m: 1, outputPer1m: 2 }],
    ['model-b', { inputPer1m: 5, outputPer1m: 10 }],
  ])
  return render(
    <CompareView
      params={params}
      modelOptions={options}
      modelsLoading={false}
      pricing={pricing}
      synced
      onSyncedChange={() => undefined}
      {...overrides}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CompareView', () => {
  it('starts with two columns and supports add, duplicate and remove within 2–4', async () => {
    const user = userEvent.setup()
    renderCompare()
    expect(screen.getAllByTestId('compare-column')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Remove Column 1' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getAllByTestId('compare-column')).toHaveLength(3)
    // New column picks an unused model.
    expect(screen.getByRole('region', { name: 'Column 3: model-c' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Duplicate Column 1' }))
    const cols = screen.getAllByTestId('compare-column')
    expect(cols).toHaveLength(4)
    expect(cols[1]).toHaveAccessibleName('Column 2: model-a')
    expect(screen.getByRole('button', { name: 'Add column' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Remove Column 4' }))
    expect(screen.getAllByTestId('compare-column')).toHaveLength(3)
  })

  it('Run all sends the same prompt to every column in parallel', async () => {
    const user = userEvent.setup()
    const { fetchMock, pending } = installStreamingFetch()
    renderCompare()

    await user.type(screen.getByRole('textbox', { name: 'Compare prompt' }), 'Hello there')
    await user.click(screen.getByRole('button', { name: 'Run all' }))

    // Both requests are in flight before either finishes.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(pending.map((p) => p.model)).toEqual(['model-a', 'model-b'])
    for (const p of pending) {
      expect(p.body).toMatchObject({
        stream: true,
        temperature: 0.3,
        max_tokens: 100,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Hello there' },
        ],
      })
      expect(p.body).not.toHaveProperty('response_format')
    }
    await screen.findByText('Hi from model-a')
    await screen.findByText('Hi from model-b')
    expect(screen.getByRole('button', { name: 'Run all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop all' })).toBeEnabled()

    await act(async () => pending.forEach((p) => p.release()))
    await waitFor(() => expect(screen.getAllByTestId('compare-metrics')).toHaveLength(2))
    // model-a is cheaper: 1000*1 + 1000*2 per 1M = $0.003 vs $0.015.
    const colA = screen.getByRole('region', { name: 'Column 1: model-a' })
    expect(within(colA).getByText('Cheapest')).toBeInTheDocument()
    expect(within(colA).getByTestId('compare-metrics')).toHaveTextContent('~$0.003')
    expect(within(screen.getByRole('region', { name: 'Column 2: model-b' })).queryByText('Cheapest')).toBeNull()
  })

  it('stopping one column leaves the other streaming; Stop all stops the rest', async () => {
    const user = userEvent.setup()
    const { pending } = installStreamingFetch()
    renderCompare()

    await user.type(screen.getByRole('textbox', { name: 'Compare prompt' }), 'Go')
    await user.click(screen.getByRole('button', { name: 'Run all' }))
    await screen.findByText('Hi from model-a')
    await screen.findByText('Hi from model-b')

    await user.click(screen.getByRole('button', { name: 'Stop Column 1' }))
    const colA = screen.getByRole('region', { name: 'Column 1: model-a' })
    const colB = screen.getByRole('region', { name: 'Column 2: model-b' })
    await waitFor(() => expect(within(colA).getByTestId('compare-metrics')).toHaveTextContent('stopped'))
    expect(within(colB).getByText('Generating…')).toBeInTheDocument()
    expect(within(colB).queryByTestId('compare-metrics')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Stop all' }))
    await waitFor(() => expect(within(colB).getByTestId('compare-metrics')).toHaveTextContent('stopped'))
    expect(pending).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Stop all' })).toBeDisabled()
  })

  it('sends per-column temperature/max tokens when not synced, plus response_format when set', async () => {
    const user = userEvent.setup()
    const { pending } = installStreamingFetch()
    renderCompare({
      synced: false,
      params: { ...params, responseFormat: { ...DEFAULT_RESPONSE_FORMAT, type: 'json_object' } },
    })

    await user.click(screen.getByRole('button', { name: 'Show Column 2 parameters' }))
    const colB = screen.getByRole('region', { name: 'Column 2: model-b' })
    const maxTokens = within(colB).getByLabelText('Max tokens')
    fireEvent.change(maxTokens, { target: { value: '42' } })

    await user.type(screen.getByRole('textbox', { name: 'Compare prompt' }), 'Go')
    await user.click(screen.getByRole('button', { name: 'Run all' }))
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[0].body).toMatchObject({ max_tokens: 100, response_format: { type: 'json_object' } })
    expect(pending[1].body).toMatchObject({ max_tokens: 42, response_format: { type: 'json_object' } })
    await act(async () => pending.forEach((p) => p.release()))
  })

  it('blocks Run all while the response format is invalid', async () => {
    const user = userEvent.setup()
    renderCompare({ blockedReason: 'Fix the JSON schema under Response format to send.' })
    await user.type(screen.getByRole('textbox', { name: 'Compare prompt' }), 'Go')
    expect(screen.getByRole('button', { name: 'Run all' })).toBeDisabled()
    expect(screen.getByText('Fix the JSON schema under Response format to send.')).toBeInTheDocument()
  })
})
