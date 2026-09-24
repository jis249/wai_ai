import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToastProvider } from '../hooks/useToast'
import ModelsPage from './ModelsPage'

// ---------------------------------------------------------------------------
// Types used in mocks (mirror the production types)
// ---------------------------------------------------------------------------

interface MockModelResponse {
  id: string
  name: string
  type: string
  provider: string
  base_url: string
  max_context_tokens: number
  input_price_per_1m: number
  output_price_per_1m: number
  is_active: boolean
  source: string
  aliases: string[]
  created_at: string
  updated_at: string
  timeout?: string
  fallback_model_name?: string
  deployments?: unknown[]
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeChatModel(overrides: Partial<MockModelResponse> = {}): MockModelResponse {
  return {
    id: 'model-1',
    name: 'gpt-4o',
    type: 'chat',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    max_context_tokens: 0,
    input_price_per_1m: 0,
    output_price_per_1m: 0,
    is_active: true,
    source: 'api',
    aliases: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const MOCK_MODELS_LIST: MockModelResponse[] = [
  makeChatModel({ id: 'model-1', name: 'gpt-4o', type: 'chat' }),
  makeChatModel({ id: 'model-2', name: 'claude-sonnet', type: 'chat', provider: 'anthropic', base_url: 'https://api.anthropic.com' }),
  makeChatModel({ id: 'model-3', name: 'llama-70b', type: 'chat', provider: 'vllm', base_url: 'http://localhost:8000/v1' }),
  makeChatModel({ id: 'model-4', name: 'text-embed-ada', type: 'embedding', provider: 'openai', base_url: 'https://api.openai.com/v1' }),
]

const MOCK_SERVER_CONFIG_DISABLED = {
  fallback_max_depth: 0,
}

const MOCK_SERVER_CONFIG_ENABLED = {
  fallback_max_depth: 3,
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  return { queryClient, Wrapper }
}

function renderModelsPage() {
  const { Wrapper } = makeWrapper()
  return render(<ModelsPage />, { wrapper: Wrapper })
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

type FetchMockEntry = {
  matcher: (url: string) => boolean
  response: unknown
  method?: string
}

function setupFetchMock(entries: FetchMockEntry[], capturedBodies?: Map<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()

    const entry = entries.find(
      (e) => e.matcher(url) && (!e.method || e.method.toUpperCase() === method),
    )

    if (entry) {
      if (capturedBodies && init?.body) {
        capturedBodies.set(`${method}:${url}`, init.body as string)
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(entry.response),
      }
    }

    // Default fallthrough for unmatched requests
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }
  }))
}

function defaultEntries(serverConfigPayload = MOCK_SERVER_CONFIG_DISABLED, modelsPayload = { data: MOCK_MODELS_LIST, has_more: false }): FetchMockEntry[] {
  return [
    {
      // GET-only models list (no method guard needed here — POST entries placed BEFORE
      // defaultEntries() in the entries array so they match first)
      matcher: (u) => u.includes('/api/v1/models') && !u.includes('/health'),
      method: 'GET',
      response: modelsPayload,
    },
    {
      matcher: (u) => u.includes('/api/v1/server-config'),
      response: serverConfigPayload,
    },
    {
      matcher: (u) => u.includes('/api/v1/models/health'),
      response: { models: [] },
    },
  ]
}

// ---------------------------------------------------------------------------
// Dialog helpers
// ---------------------------------------------------------------------------

/** Opens the "Add Model" dialog via the page header button. */
async function openCreateDialog() {
  // The page header button is the first "Add Model" button on the page.
  const buttons = screen.getAllByRole('button', { name: /add model/i })
  await userEvent.click(buttons[0])
}

/** Returns the dialog element rendered in the portal. */
function getDialog(titleText: string | RegExp) {
  // Dialogs are portalled to document.body. Find by the dialog role or by title text.
  const heading = screen.getByRole('heading', { name: titleText })
  // Walk up to the dialog container
  const dialog = heading.closest('[role="dialog"]')
  if (!dialog) throw new Error(`Could not find dialog with title matching ${String(titleText)}`)
  return dialog as HTMLElement
}

/** Clicks the submit button inside the currently-open dialog. */
async function submitDialog(dialog: HTMLElement, buttonName: string | RegExp) {
  await userEvent.click(within(dialog).getByRole('button', { name: buttonName }))
}

/**
 * Adds a minimal deployment entry via the inline deployment form in the
 * Load Balanced tab. Required because the form validates that at least one
 * deployment is present before submitting.
 */
async function addMinimalDeployment(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: /^add deployment$/i }))

  // After clicking "Add deployment", the inline form appears with Name, Base URL, etc.
  // There are now two "Name" inputs in the dialog: the top-level model name and the
  // deployment name. Use getAllByRole and pick the last (inline form).
  const allNameInputs = within(dialog).getAllByRole('textbox', { name: /^name$/i })
  const depNameInput = allNameInputs[allNameInputs.length - 1]
  await userEvent.type(depNameInput, 'primary')

  // Similarly for Base URL
  const allUrlInputs = within(dialog).getAllByRole('textbox', { name: /base url/i })
  const depUrlInput = allUrlInputs[allUrlInputs.length - 1]
  await userEvent.type(depUrlInput, 'https://api.openai.com/v1')

  // Click "Add" to save the deployment entry
  await userEvent.click(within(dialog).getByRole('button', { name: /^add$/i }))
}

/** Switches to the Load Balanced tab within the Add Model dialog. */
async function switchToLoadBalancedTab() {
  await userEvent.click(screen.getByRole('tab', { name: /load balanced/i }))
}

/** Finds the Fallback Model combobox inside a given container element. */
function getFallbackCombobox(container: HTMLElement | Document = document): HTMLElement {
  // The Select has aria-labelledby pointing to its label id. RTL resolves this for getByRole.
  const all = within(container as HTMLElement).getAllByRole('combobox')
  // Find the one whose accessible name contains "Fallback Model"
  const match = all.find((el) => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (!labelledBy) return false
    const labelEl = document.getElementById(labelledBy)
    return labelEl?.textContent?.toLowerCase().includes('fallback model')
  })
  if (!match) throw new Error('Could not find Fallback Model combobox')
  return match
}

// ---------------------------------------------------------------------------
// Tests: CreateModelDialog — fallback disabled
// ---------------------------------------------------------------------------

describe('CreateModelDialog — Fallback Model field', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('when fallback_max_depth is 0', () => {
    it('disables the Fallback Model select when fallback is disabled in server config', async () => {
      setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_DISABLED))
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      // Wait for the models list to load (options depend on it)
      await waitFor(() => {
        const dialog = getDialog(/add model/i)
        const select = getFallbackCombobox(dialog)
        expect(select).toBeDisabled()
      })
    })

    it('shows helper text when fallback is disabled in server config', async () => {
      setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_DISABLED))
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      await waitFor(() => {
        expect(screen.getByText(/fallback is disabled/i)).toBeInTheDocument()
      })
    })

    it('does not send fallback_model_name on submit when fallback is disabled and field is left at default', async () => {
      const capturedBodies = new Map<string, string>()
      const createdModel = makeChatModel({ id: 'new-model', name: 'my-lb-model' })
      setupFetchMock(
        [
          {
            matcher: (u) => u.includes('/api/v1/models') && !u.includes('/health'),
            method: 'POST',
            response: createdModel,
          },
          ...defaultEntries(MOCK_SERVER_CONFIG_DISABLED),
        ],
        capturedBodies,
      )
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      // Fill in required field: name
      await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'my-lb-model')

      const dialog = getDialog(/add model/i)

      // Load balanced mode requires at least one deployment
      await addMinimalDeployment(dialog)

      // Submit
      await submitDialog(dialog, /add model/i)

      await waitFor(() => expect(capturedBodies.has('POST:/api/v1/models')).toBe(true))

      const body = JSON.parse(capturedBodies.get('POST:/api/v1/models')!)
      // When fallback is disabled and field untouched, fallback_model_name is absent
      // because `if (fallbackModelName) params.fallback_model_name = fallbackModelName`
      // and the default value is '' (falsy).
      expect(body).not.toHaveProperty('fallback_model_name')
    })
  })

  // ---------------------------------------------------------------------------
  // CreateModelDialog — fallback enabled
  // ---------------------------------------------------------------------------

  describe('when fallback_max_depth is greater than 0', () => {
    it('enables the Fallback Model select when fallback is enabled in server config', async () => {
      setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_ENABLED))
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      await waitFor(() => {
        const dialog = getDialog(/add model/i)
        const select = getFallbackCombobox(dialog)
        expect(select).not.toBeDisabled()
      })
    })

    it('shows helpful description text when fallback is enabled in server config', async () => {
      setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_ENABLED))
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      await waitFor(() => {
        expect(screen.getByText(/automatically retry on the fallback model/i)).toBeInTheDocument()
      })
    })

    it('shows None option and other chat models, excludes embedding models and current model name', async () => {
      setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_ENABLED))
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      // Type a model name so the self-exclusion logic has a value to compare against
      await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'gpt-4o')

      // Wait for the select to be enabled
      let fallbackSelect: HTMLElement
      await waitFor(() => {
        const dialog = getDialog(/add model/i)
        fallbackSelect = getFallbackCombobox(dialog)
        expect(fallbackSelect).not.toBeDisabled()
      })

      // Open the dropdown
      await userEvent.click(fallbackSelect!)

      // "None" must be present
      expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()

      // Other chat models must be present
      expect(screen.getByRole('option', { name: 'claude-sonnet' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'llama-70b' })).toBeInTheDocument()

      // Current model name (gpt-4o) must NOT appear in the options
      const allOptions = screen.getAllByRole('option')
      const optionNames = allOptions.map((o) => o.textContent)
      expect(optionNames).not.toContain('gpt-4o')

      // The embedding model must NOT appear (type mismatch; current type defaults to 'chat')
      expect(optionNames).not.toContain('text-embed-ada')
    })

    it('sends fallback_model_name when user picks a model', async () => {
      const capturedBodies = new Map<string, string>()
      const createdModel = makeChatModel({ id: 'new-lb', name: 'new-lb' })
      setupFetchMock(
        [
          {
            matcher: (u) => u.includes('/api/v1/models') && !u.includes('/health'),
            method: 'POST',
            response: createdModel,
          },
          ...defaultEntries(MOCK_SERVER_CONFIG_ENABLED),
        ],
        capturedBodies,
      )
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'new-lb')

      // Wait for and select a fallback model
      let fallbackSelect: HTMLElement
      await waitFor(() => {
        const dialog = getDialog(/add model/i)
        fallbackSelect = getFallbackCombobox(dialog)
        expect(fallbackSelect).not.toBeDisabled()
      })

      await userEvent.click(fallbackSelect!)
      await userEvent.click(screen.getByRole('option', { name: 'claude-sonnet' }))

      const dialog = getDialog(/add model/i)

      // Load balanced mode requires at least one deployment
      await addMinimalDeployment(dialog)

      // Submit
      await submitDialog(dialog, /add model/i)

      await waitFor(() => expect(capturedBodies.has('POST:/api/v1/models')).toBe(true))

      const body = JSON.parse(capturedBodies.get('POST:/api/v1/models')!)
      expect(body.fallback_model_name).toBe('claude-sonnet')
    })

    it('does not send fallback_model_name when user leaves the default None', async () => {
      const capturedBodies = new Map<string, string>()
      const createdModel = makeChatModel({ id: 'new-lb2', name: 'new-lb2' })
      setupFetchMock(
        [
          {
            matcher: (u) => u.includes('/api/v1/models') && !u.includes('/health'),
            method: 'POST',
            response: createdModel,
          },
          ...defaultEntries(MOCK_SERVER_CONFIG_ENABLED),
        ],
        capturedBodies,
      )
      renderModelsPage()

      await openCreateDialog()
      await switchToLoadBalancedTab()

      await userEvent.type(screen.getByRole('textbox', { name: /^name$/i }), 'new-lb2')

      // Wait for the select to be ready but do NOT change it (leave as "None")
      const dialog = getDialog(/add model/i)
      await waitFor(() => {
        const select = getFallbackCombobox(dialog)
        expect(select).not.toBeDisabled()
      })

      // Load balanced mode requires at least one deployment
      await addMinimalDeployment(dialog)

      // Submit without touching the fallback select
      await submitDialog(dialog, /add model/i)

      await waitFor(() => expect(capturedBodies.has('POST:/api/v1/models')).toBe(true))

      const body = JSON.parse(capturedBodies.get('POST:/api/v1/models')!)
      // Empty string is falsy: `if (fallbackModelName)` guard omits the field
      expect(body).not.toHaveProperty('fallback_model_name')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: EditModelDialog — Fallback Model field
// ---------------------------------------------------------------------------

describe('EditModelDialog — Fallback Model field', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Clicks the "Edit model" button for a given model name.
   * The edit button is an IconButton (aria-label "Edit model") in the same table row
   * as the model name text.
   */
  async function openEditDialogForModel(modelName: string) {
    // Wait for the model name to appear in the table
    const modelNameEl = await screen.findByText(modelName)
    const row = modelNameEl.closest('tr')
    if (!row) throw new Error(`Could not find table row for model "${modelName}"`)
    const editBtn = within(row).getByRole('button', { name: 'Edit model' })
    await userEvent.click(editBtn)
  }

  it('loads existing fallback_model_name into the Select', async () => {
    const modelWithFallback = makeChatModel({ id: 'model-1', name: 'gpt-4o', fallback_model_name: 'claude-sonnet' })
    const modelsData = {
      data: [modelWithFallback, ...MOCK_MODELS_LIST.slice(1)],
      has_more: false,
    }
    setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_ENABLED, modelsData))
    renderModelsPage()

    await openEditDialogForModel('gpt-4o')

    // The edit dialog opens — wait for it
    await waitFor(() => expect(screen.getByRole('heading', { name: /edit model/i })).toBeInTheDocument())

    const dialog = getDialog(/edit model/i)
    const fallbackSelect = getFallbackCombobox(dialog)

    // The pre-loaded value should display as 'claude-sonnet'
    expect(fallbackSelect).toHaveTextContent('claude-sonnet')
  })

  it('sends updated fallback_model_name on submit', async () => {
    const capturedBodies = new Map<string, string>()
    const modelWithFallback = makeChatModel({ id: 'model-1', name: 'gpt-4o', fallback_model_name: 'claude-sonnet' })
    const modelsData = {
      data: [modelWithFallback, ...MOCK_MODELS_LIST.slice(1)],
      has_more: false,
    }
    setupFetchMock(
      [
        ...defaultEntries(MOCK_SERVER_CONFIG_ENABLED, modelsData),
        {
          matcher: (u) => u.includes('/api/v1/models/model-1'),
          method: 'PATCH',
          response: { ...modelWithFallback, fallback_model_name: 'llama-70b' },
        },
      ],
      capturedBodies,
    )
    renderModelsPage()

    await openEditDialogForModel('gpt-4o')
    await waitFor(() => expect(screen.getByRole('heading', { name: /edit model/i })).toBeInTheDocument())

    const dialog = getDialog(/edit model/i)
    const fallbackSelect = getFallbackCombobox(dialog)

    // Change the fallback from claude-sonnet to llama-70b
    await userEvent.click(fallbackSelect)
    await userEvent.click(screen.getByRole('option', { name: 'llama-70b' }))

    await submitDialog(dialog, /save changes/i)

    await waitFor(() => expect(capturedBodies.has('PATCH:/api/v1/models/model-1')).toBe(true))

    const body = JSON.parse(capturedBodies.get('PATCH:/api/v1/models/model-1')!)
    expect(body.fallback_model_name).toBe('llama-70b')
  })

  it('sends empty string to clear fallback on submit', async () => {
    const capturedBodies = new Map<string, string>()
    const modelWithFallback = makeChatModel({ id: 'model-1', name: 'gpt-4o', fallback_model_name: 'claude-sonnet' })
    const modelsData = {
      data: [modelWithFallback, ...MOCK_MODELS_LIST.slice(1)],
      has_more: false,
    }
    setupFetchMock(
      [
        ...defaultEntries(MOCK_SERVER_CONFIG_ENABLED, modelsData),
        {
          matcher: (u) => u.includes('/api/v1/models/model-1'),
          method: 'PATCH',
          response: { ...modelWithFallback, fallback_model_name: '' },
        },
      ],
      capturedBodies,
    )
    renderModelsPage()

    await openEditDialogForModel('gpt-4o')
    await waitFor(() => expect(screen.getByRole('heading', { name: /edit model/i })).toBeInTheDocument())

    const dialog = getDialog(/edit model/i)
    const fallbackSelect = getFallbackCombobox(dialog)

    // Change to "None" (value='') to clear the existing fallback
    await userEvent.click(fallbackSelect)
    await userEvent.click(screen.getByRole('option', { name: 'None' }))

    await submitDialog(dialog, /save changes/i)

    await waitFor(() => expect(capturedBodies.has('PATCH:/api/v1/models/model-1')).toBe(true))

    const body = JSON.parse(capturedBodies.get('PATCH:/api/v1/models/model-1')!)
    // Empty string signals "clear" to the backend
    expect(body.fallback_model_name).toBe('')
  })

  it('does NOT send fallback_model_name when unchanged on submit', async () => {
    const capturedBodies = new Map<string, string>()
    const modelWithFallback = makeChatModel({
      id: 'model-1',
      name: 'gpt-4o',
      fallback_model_name: 'claude-sonnet',
      timeout: '30s',
    })
    const modelsData = {
      data: [modelWithFallback, ...MOCK_MODELS_LIST.slice(1)],
      has_more: false,
    }
    setupFetchMock(
      [
        ...defaultEntries(MOCK_SERVER_CONFIG_ENABLED, modelsData),
        {
          matcher: (u) => u.includes('/api/v1/models/model-1'),
          method: 'PATCH',
          response: { ...modelWithFallback, timeout: '60s' },
        },
      ],
      capturedBodies,
    )
    renderModelsPage()

    await openEditDialogForModel('gpt-4o')
    await waitFor(() => expect(screen.getByRole('heading', { name: /edit model/i })).toBeInTheDocument())

    const dialog = getDialog(/edit model/i)

    // Change the timeout field only — leave fallback untouched
    const timeoutInput = within(dialog).getByRole('textbox', { name: /timeout/i })
    await userEvent.clear(timeoutInput)
    await userEvent.type(timeoutInput, '60s')

    await submitDialog(dialog, /save changes/i)

    await waitFor(() => expect(capturedBodies.has('PATCH:/api/v1/models/model-1')).toBe(true))

    const body = JSON.parse(capturedBodies.get('PATCH:/api/v1/models/model-1')!)
    // fallback_model_name was not changed — must be absent from the diff
    expect(body).not.toHaveProperty('fallback_model_name')
    // The changed field must be present
    expect(body.timeout).toBe('60s')
  })
})

// ---------------------------------------------------------------------------
// Tests: search, sort, alias tag input
// ---------------------------------------------------------------------------

/** Model names in table order (second cell; the first is the expand column). */
function tableModelNames(): string[] {
  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row').slice(1)
  return rows.map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '')
}

describe('ModelsPage — search', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('filters models by name, provider and alias', async () => {
    const data = [
      makeChatModel({ id: 'm1', name: 'gpt-4o', provider: 'openai' }),
      makeChatModel({ id: 'm2', name: 'claude-sonnet', provider: 'anthropic', aliases: ['smart'] }),
      makeChatModel({ id: 'm3', name: 'llama-70b', provider: 'vllm' }),
    ]
    setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_DISABLED, { data, has_more: false }))
    renderModelsPage()

    await screen.findByText('gpt-4o')
    const search = screen.getByRole('searchbox', { name: /search models/i })

    await userEvent.type(search, 'anthropic')
    expect(screen.queryByText('gpt-4o')).not.toBeInTheDocument()
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'smart')
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument()
    expect(screen.queryByText('llama-70b')).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'LLAMA')
    expect(screen.getByText('llama-70b')).toBeInTheDocument()
    expect(screen.queryByText('claude-sonnet')).not.toBeInTheDocument()
  })

  it('shows an empty state with a clear action when nothing matches', async () => {
    setupFetchMock(defaultEntries())
    renderModelsPage()

    await screen.findByText('gpt-4o')
    await userEvent.type(screen.getByRole('searchbox', { name: /search models/i }), 'zzz-nope')

    expect(screen.getByText(/no matching models/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
  })
})

describe('ModelsPage — sorting', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sorts by name ascending then descending when the header is clicked', async () => {
    setupFetchMock(defaultEntries())
    renderModelsPage()
    await screen.findByText('gpt-4o')

    const nameHeader = screen.getByRole('columnheader', { name: /^name/i })
    await userEvent.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(tableModelNames()).toEqual(['claude-sonnet', 'gpt-4o', 'llama-70b', 'text-embed-ada'])

    await userEvent.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    expect(tableModelNames()).toEqual(['text-embed-ada', 'llama-70b', 'gpt-4o', 'claude-sonnet'])
  })

  it('sorts by provider and by status', async () => {
    const data = [
      makeChatModel({ id: 'm1', name: 'a-model', provider: 'vllm', is_active: false }),
      makeChatModel({ id: 'm2', name: 'b-model', provider: 'anthropic', is_active: true }),
      makeChatModel({ id: 'm3', name: 'c-model', provider: 'openai', is_active: false }),
    ]
    setupFetchMock(defaultEntries(MOCK_SERVER_CONFIG_DISABLED, { data, has_more: false }))
    renderModelsPage()
    await screen.findByText('a-model')

    await userEvent.click(screen.getByRole('columnheader', { name: /^provider/i }))
    expect(tableModelNames()).toEqual(['b-model', 'c-model', 'a-model'])

    await userEvent.click(screen.getByRole('columnheader', { name: /^status/i }))
    // Active first, ties broken by name
    expect(tableModelNames()).toEqual(['b-model', 'a-model', 'c-model'])
  })
})

describe('ModelsPage — row actions menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('deactivates a model from the More menu', async () => {
    const calls: string[] = []
    setupFetchMock(defaultEntries())
    const baseFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`)
      return baseFetch(input, init)
    }))
    renderModelsPage()

    const nameEl = await screen.findByRole('button', { name: 'gpt-4o' })
    await userEvent.click(within(nameEl.closest('tr')!).getByRole('button', { name: /more actions for gpt-4o/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /deactivate/i }))

    await waitFor(() => expect(calls).toContain('PATCH /api/v1/models/model-1/deactivate'))
  })
})

describe('Alias tag input', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('adds chips on Enter/comma, removes with Backspace and x, and sends a string[]', async () => {
    const capturedBodies = new Map<string, string>()
    setupFetchMock(
      [
        {
          matcher: (u) => u.includes('/api/v1/models') && !u.includes('/health'),
          method: 'POST',
          response: makeChatModel({ id: 'new', name: 'aliased' }),
        },
        ...defaultEntries(),
      ],
      capturedBodies,
    )
    renderModelsPage()

    await openCreateDialog()
    const dialog = getDialog(/add model/i)
    const aliasInput = within(dialog).getByRole('textbox', { name: /aliases/i })

    await userEvent.type(aliasInput, 'default{Enter}')
    await userEvent.type(aliasInput, 'gpt4,latest,')
    await userEvent.type(aliasInput, 'extra{Enter}')
    expect(within(dialog).getByRole('button', { name: 'Remove alias default' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove alias latest' })).toBeInTheDocument()

    // Backspace on the empty input removes the last chip ("extra")
    await userEvent.type(aliasInput, '{Backspace}')
    expect(within(dialog).queryByRole('button', { name: 'Remove alias extra' })).not.toBeInTheDocument()

    // The x button removes a specific chip
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove alias gpt4' }))
    expect(within(dialog).queryByRole('button', { name: 'Remove alias gpt4' })).not.toBeInTheDocument()

    await userEvent.type(within(dialog).getByRole('textbox', { name: /^name$/i }), 'aliased')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /base url/i }), 'https://api.openai.com/v1')
    await submitDialog(dialog, /add model/i)

    await waitFor(() => expect(capturedBodies.has('POST:/api/v1/models')).toBe(true))
    const body = JSON.parse(capturedBodies.get('POST:/api/v1/models')!)
    expect(body.aliases).toEqual(['default', 'latest'])
  })

  it('pre-fills existing aliases as chips in the edit sheet and sends the changed list', async () => {
    const capturedBodies = new Map<string, string>()
    const model = makeChatModel({ id: 'model-1', name: 'gpt-4o', aliases: ['a1', 'a2'] })
    setupFetchMock(
      [
        ...defaultEntries(MOCK_SERVER_CONFIG_DISABLED, { data: [model], has_more: false }),
        { matcher: (u) => u.includes('/api/v1/models/model-1'), method: 'PATCH', response: model },
      ],
      capturedBodies,
    )
    renderModelsPage()

    const nameEl = await screen.findByRole('button', { name: 'gpt-4o' })
    await userEvent.click(within(nameEl.closest('tr')!).getByRole('button', { name: 'Edit model' }))
    const dialog = getDialog(/edit model/i)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove alias a1' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: /aliases/i }), 'a3{Enter}')
    await submitDialog(dialog, /save changes/i)

    await waitFor(() => expect(capturedBodies.has('PATCH:/api/v1/models/model-1')).toBe(true))
    const body = JSON.parse(capturedBodies.get('PATCH:/api/v1/models/model-1')!)
    expect(body.aliases).toEqual(['a2', 'a3'])
  })
})
