import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../hooks/useToast'
import { PricingSyncSheet } from './PricingSyncSheet'
import { PricingCatalogFields } from './PricingCatalogFields'
import { emptyModelForm } from './modelHelpers'
import { formatPer1m, priceChange } from './pricingFormat'
import type { PricingPreviewRow } from '../../hooks/usePricingSync'

function row(overrides: Partial<PricingPreviewRow>): PricingPreviewRow {
  return {
    model_id: 'm1',
    name: 'gpt-4o',
    provider: 'openai',
    model_source: 'api',
    pricing_source: 'manual',
    pricing_key: '',
    pricing_synced_at: '',
    current_input_per_1m: 1,
    current_output_per_1m: 2,
    current_context_window: 0,
    match_key: 'gpt-4o',
    matched_via: 'name',
    catalog_input_per_1m: 2.5,
    catalog_output_per_1m: 10,
    catalog_context_window: 128000,
    input_diff: 1.5,
    output_diff: 8,
    action: 'update',
    note: '',
    ...overrides,
  }
}

const PREVIEW = {
  source: 'https://example/prices.json',
  fetched_at: '2026-09-24T10:00:00+00:00',
  entries: 3000,
  counts: { update: 1, manual_locked: 1, unchanged: 0, no_match: 1 },
  rows: [
    row({ model_id: 'm1', name: 'gpt-4o', pricing_source: 'synced' }),
    row({
      model_id: 'm2', name: 'azure-mini', provider: 'azure', match_key: 'azure/gpt-4o-mini',
      current_input_per_1m: 9, current_output_per_1m: 9, catalog_input_per_1m: 0.165,
      catalog_output_per_1m: 0.66, action: 'manual_locked',
    }),
    row({
      model_id: 'm3', name: 'llama3:8b', provider: 'ollama', match_key: '', matched_via: '',
      catalog_input_per_1m: null, catalog_output_per_1m: null, action: 'no_match',
      note: 'no catalog entry for this model',
    }),
  ],
}

const STATUS = {
  source: 'https://example/prices.json', source_kind: 'url', auto_sync: false, auto_sync_interval_hours: 24,
  last_fetch_at: '', last_sync_at: '2026-09-24T09:00:00+00:00', last_auto_sync_at: '', entries: 3000,
  counts: PREVIEW.counts, synced_models: 1, last_error: '', last_error_at: '',
}

type Call = { url: string; method: string; body?: unknown }

function mockFetch(handlers: (c: Call) => { status?: number; body: unknown } | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const call: Call = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(call)
    const res = handlers(call) ?? { body: {} }
    const status = res.status ?? 200
    return { ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(res.body) }
  }))
  return calls
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pricingFormat', () => {
  it('formats per-1M prices and direction text', () => {
    expect(formatPer1m(2.5)).toBe('$2.50')
    expect(formatPer1m(0.165)).toBe('$0.165')
    expect(formatPer1m(0.02)).toBe('$0.02')
    expect(formatPer1m(null)).toBe('—')
    expect(priceChange(1, 2.5)).toEqual({ from: '$1.00', to: '$2.50', direction: 'up', delta: '$1.50' })
    expect(priceChange(9, 0.66)?.direction).toBe('down')
    expect(priceChange(1, null)).toBeNull()
  })
})

describe('PricingSyncSheet', () => {
  it('shows the preview with diffs, preselects updates and applies the selection', async () => {
    const calls = mockFetch((c) => {
      if (c.url.includes('/pricing/preview')) return { body: PREVIEW }
      if (c.url.includes('/pricing/status')) return { body: STATUS }
      if (c.url.includes('/pricing/apply')) {
        return { body: { updated: [{ model_id: 'm1' }, { model_id: 'm2' }], skipped: [] } }
      }
      return undefined
    })
    wrap(<PricingSyncSheet onClose={() => {}} />)

    const list = await screen.findByRole('list', { name: /pricing preview/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('(up $1.50)')).toBeInTheDocument()
    expect(within(items[1]).getByText('Manual (locked)')).toBeInTheDocument()
    expect(within(items[1]).getByText('(down $8.34)')).toBeInTheDocument()
    expect(within(items[2]).getByText('No catalog match')).toBeInTheDocument()

    const gpt = screen.getByRole('checkbox', { name: 'Select gpt-4o' })
    const mini = screen.getByRole('checkbox', { name: 'Select azure-mini' })
    expect(gpt).toBeChecked()
    expect(mini).not.toBeChecked() // manual prices are never preselected
    expect(screen.getByRole('checkbox', { name: 'Select llama3:8b' })).toBeDisabled()

    await userEvent.click(mini)
    await userEvent.click(screen.getByRole('button', { name: /apply selected \(2\)/i }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/pricing/apply'))).toBe(true))
    const applyCall = calls.find((c) => c.url.includes('/pricing/apply'))!
    expect(applyCall.method).toBe('POST')
    expect(applyCall.body).toEqual({ model_ids: ['m1', 'm2'], lock_to_synced: false })
    expect(await screen.findByText('Updated pricing for 2 models')).toBeInTheDocument()
  })

  it('filters by action and search, and toggles keep-synced per row', async () => {
    const calls = mockFetch((c) => {
      if (c.url.includes('/pricing/preview')) return { body: PREVIEW }
      if (c.url.includes('/pricing/status')) return { body: STATUS }
      if (c.url.includes('/pricing-settings')) {
        return { body: { model_id: 'm2', pricing_source: 'synced', pricing_key: '', pricing_synced_at: '' } }
      }
      return undefined
    })
    wrap(<PricingSyncSheet onClose={() => {}} />)
    await screen.findByRole('list', { name: /pricing preview/i })

    await userEvent.type(screen.getByRole('searchbox', { name: /search models/i }), 'azure')
    expect(within(screen.getByRole('list', { name: /pricing preview/i })).getAllByRole('listitem')).toHaveLength(1)

    await userEvent.click(screen.getByRole('switch', { name: /keep azure-mini synced/i }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toContain('/models/m2/pricing-settings')
    expect(put.body).toEqual({ pricing_source: 'synced' })

    await userEvent.type(screen.getByRole('searchbox', { name: /search models/i }), 'zzz')
    expect(screen.getByText('No matching models')).toBeInTheDocument()
  })

  it('shows an error state with retry when the catalog cannot be fetched', async () => {
    mockFetch((c) => {
      if (c.url.includes('/pricing/preview')) {
        return { status: 502, body: { error: { message: 'price list fetch returned HTTP 503' } } }
      }
      if (c.url.includes('/pricing/status')) return { body: { ...STATUS, last_error: 'HTTP 503' } }
      return undefined
    })
    wrap(<PricingSyncSheet onClose={() => {}} />)
    expect(await screen.findByText("Couldn't load the price list")).toBeInTheDocument()
    expect(screen.getByText('price list fetch returned HTTP 503')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows an empty state when there are no models', async () => {
    mockFetch((c) => {
      if (c.url.includes('/pricing/preview')) return { body: { ...PREVIEW, rows: [] } }
      if (c.url.includes('/pricing/status')) return { body: STATUS }
      return undefined
    })
    wrap(<PricingSyncSheet onClose={() => {}} />)
    expect(await screen.findByText('No models to price')).toBeInTheDocument()
  })
})

describe('PricingCatalogFields', () => {
  it('looks up the catalog match and fills the prices', async () => {
    const calls = mockFetch((c) =>
      c.url.includes('/pricing/lookup')
        ? {
            body: {
              found: true, match_key: 'azure/gpt-4o-mini', matched_via: 'provider_prefix', has_price: true,
              input_per_1m: 0.165, output_per_1m: 0.66, context_window: 128000, tried: [], source: 's',
            },
          }
        : undefined,
    )
    const onChange = vi.fn()
    const values = { ...emptyModelForm(), name: 'gpt-4o-mini', provider: 'azure' }
    wrap(
      <PricingCatalogFields
        values={values}
        onChange={onChange}
        state={{ pricingKey: '', pricingSource: 'manual' }}
        onStateChange={() => {}}
      />,
    )
    expect(screen.getByText('Manual')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /look up/i }))
    expect(await screen.findByText('azure/gpt-4o-mini')).toBeInTheDocument()
    const lookup = calls.find((c) => c.url.includes('/pricing/lookup'))!
    expect(lookup.url).toContain('name=gpt-4o-mini')
    expect(lookup.url).toContain('provider=azure')
    await userEvent.click(screen.getByRole('button', { name: /use these prices/i }))
    expect(onChange).toHaveBeenCalledWith({ inputPrice: '0.165', outputPrice: '0.66', maxContextTokens: '128000' })
  })
})

describe('EditModelSheet catalog pricing', () => {
  it('shows the pricing source and saves pricing settings without a model PATCH', async () => {
    const { EditModelSheet } = await import('./EditModelSheet')
    const calls = mockFetch((c) => {
      if (c.url.includes('/pricing-settings')) {
        return {
          body: { model_id: 'm1', pricing_source: c.method === 'PUT' ? 'synced' : 'manual', pricing_key: '', pricing_synced_at: '' },
        }
      }
      if (c.url.includes('/models')) return { body: { data: [], has_more: false } }
      return undefined
    })
    const model = {
      id: 'm1', name: 'gpt-4o', type: 'chat', provider: 'openai', base_url: 'https://api.openai.com/v1',
      max_context_tokens: 0, input_price_per_1m: 1, output_price_per_1m: 2, is_active: true, source: 'api',
      aliases: [], created_at: '', updated_at: '',
    }
    const onClose = vi.fn()
    wrap(<EditModelSheet model={model} onClose={onClose} />)
    expect(await screen.findByText('Manual')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: /keep synced with the catalog/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /catalog pricing key/i }), 'gpt-4o')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toContain('/models/m1/pricing-settings')
    expect(put.body).toEqual({ pricing_source: 'synced', pricing_key: 'gpt-4o' })
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })
})
