import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import PlaygroundPage from '../PlaygroundPage'
import { ToastProvider } from '../../hooks/useToast'
import { LAST_SETTINGS_STORAGE_KEY, PRESETS_STORAGE_KEY } from './presets'

type Json = Record<string, unknown>

function setup() {
  const chatBodies: Json[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(body) })
    if (url.endsWith('/me/available-models')) return json({ models: [{ name: 'model-a', type: 'chat' }, { name: 'model-b', type: 'chat' }] })
    if (url.endsWith('/me/models')) return json({ data: [] })
    if (url === '/v1/chat/completions') {
      chatBodies.push(JSON.parse(init?.body as string) as Json)
      return json({
        choices: [{ message: { content: '{"answer":"42"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <PlaygroundPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), chatBodies }
}

/** The desktop sidebar (the mobile Sheet is closed, so this is the only panel in the DOM). */
function sidebar() {
  return screen.getByRole('heading', { name: 'Configuration' }).closest('aside') as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  // Radix menus rely on these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})
afterEach(() => vi.unstubAllGlobals())

describe('PlaygroundPage', () => {
  it('JSON schema: validates live, blocks sending until valid, sends response_format and shows a JSON viewer', async () => {
    const { user, chatBodies } = setup()
    const panel = sidebar()
    await within(panel).findByText('model-a')
    // Non-streaming keeps the mocked response simple.
    await user.click(within(panel).getByRole('switch', { name: 'Stream response' }))
    await user.click(within(panel).getByRole('button', { name: 'Schema' }))

    const schema = within(panel).getByLabelText('JSON schema')
    fireEvent.change(schema, { target: { value: '{\n  "type": "object",\n  "properties": {,}\n}' } })
    expect(within(panel).getByTestId('schema-validation')).toHaveTextContent(/^Line 3/)
    expect(screen.getByText('Fix the JSON schema under Response format to send.')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

    fireEvent.change(schema, { target: { value: '{"type":"object","properties":{"answer":{"type":"string"}}}' } })
    expect(within(panel).getByTestId('schema-validation')).toHaveTextContent('Valid JSON schema')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(chatBodies).toHaveLength(1))
    expect(chatBodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema: { type: 'object', properties: { answer: { type: 'string' } } }, strict: true },
    })
    const viewer = await screen.findByTestId('json-viewer')
    expect(within(viewer).getByText(/"answer": "42"/)).toBeInTheDocument()
    expect(within(viewer).getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument()

    // View code includes response_format.
    await user.click(screen.getByRole('button', { name: 'View code' }))
    expect(screen.getByTestId('snippet-code')).toHaveTextContent('"response_format"')
  })

  it('text format sends no response_format', async () => {
    const { user, chatBodies } = setup()
    await within(sidebar()).findByText('model-a')
    await user.click(within(sidebar()).getByRole('switch', { name: 'Stream response' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi{Enter}')
    await waitFor(() => expect(chatBodies).toHaveLength(1))
    expect(chatBodies[0]).not.toHaveProperty('response_format')
  })

  it('presets: save, change, load restores settings; delete removes it; last settings persist', async () => {
    const { user } = setup()
    const panel = sidebar()
    await within(panel).findByText('model-a')
    const system = within(panel).getByLabelText('System prompt')
    fireEvent.change(system, { target: { value: 'Preset prompt' } })
    await user.click(within(panel).getByRole('button', { name: 'JSON' }))

    await user.click(screen.getByRole('button', { name: /Presets/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Save current as preset/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Save preset' })
    await user.type(within(dialog).getByLabelText('Preset name'), 'Extractor')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save preset' })).toBeNull())
    expect(JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY)!)[0]).toMatchObject({
      name: 'Extractor',
      systemPrompt: 'Preset prompt',
      responseFormat: { type: 'json_object' },
    })

    fireEvent.change(system, { target: { value: 'Something else' } })
    await user.click(within(panel).getByRole('button', { name: 'Text' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LAST_SETTINGS_STORAGE_KEY)!).systemPrompt).toBe('Something else'))

    await user.click(screen.getByRole('button', { name: /Presets/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Extractor' }))
    expect(within(panel).getByLabelText('System prompt')).toHaveValue('Preset prompt')
    expect(within(panel).getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /Presets/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Manage presets/ }))
    const manage = await screen.findByRole('dialog', { name: 'Manage presets' })
    await user.click(within(manage).getByRole('button', { name: 'Delete preset Extractor' }))
    expect(JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY)!)).toEqual([])
  })

  it('restores last-used chat settings on load', async () => {
    localStorage.setItem(
      LAST_SETTINGS_STORAGE_KEY,
      JSON.stringify({ model: 'model-b', systemPrompt: 'Remembered', temperature: 1.2, maxTokens: 77, stream: false }),
    )
    setup()
    const panel = sidebar()
    await within(panel).findByText('model-b')
    expect(within(panel).getByLabelText('System prompt')).toHaveValue('Remembered')
    expect(within(panel).getByLabelText('Max tokens')).toHaveValue(77)
  })

  it('switches to compare mode with two columns and shared settings', async () => {
    const { user } = setup()
    await within(sidebar()).findByText('model-a')
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getAllByTestId('compare-column')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Column 1: model-a' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Column 2: model-b' })).toBeInTheDocument()
    expect(screen.getByText('Shared by all columns')).toBeInTheDocument()
    // Synced by default: shared temperature visible; unsync hides it (per-column instead).
    expect(within(sidebar()).getByLabelText('Temperature')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Sync parameters' }))
    expect(within(sidebar()).queryByLabelText('Temperature')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show Column 1 parameters' })).toBeInTheDocument()
  })
})
