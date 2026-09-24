import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DeploymentsSubTable } from './DeploymentsSubTable'
import type { DeploymentResponse, ModelResponse } from '../../hooks/useModels'
import type { ModelHealthInfo } from '../../hooks/useModelHealth'

function dep(id: string, name: string): DeploymentResponse {
  return {
    id,
    model_id: 'm1',
    name,
    provider: 'openai',
    base_url: `https://${name}.example.com/v1`,
    weight: 1,
    priority: 0,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

const MODEL: ModelResponse = {
  id: 'm1',
  name: 'gpt',
  type: 'chat',
  provider: 'openai',
  base_url: 'https://example.com/v1',
  max_context_tokens: 0,
  input_price_per_1m: 0,
  output_price_per_1m: 0,
  is_active: true,
  source: 'api',
  aliases: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  deployments: [dep('d1', 'east'), dep('d2', 'west'), dep('d3', 'north')],
}

function health(): Map<string, ModelHealthInfo> {
  const cooldown = new Date(Date.now() + 5 * 60_000).toISOString()
  return new Map([
    [
      'gpt',
      {
        name: 'gpt',
        status: 'healthy',
        latency_ms: 10,
        last_check: '2024-01-01T00:00:00Z',
        health_ok: true,
        models_ok: true,
        functional_ok: true,
        deployments: [
          { id: 'dep_a', name: 'east', circuit: 'open', consecutive_failures: 5, cooldown_until: cooldown, inflight: 0 },
          { id: 'dep_b', name: 'west', circuit: 'half_open', consecutive_failures: 1, cooldown_until: '', inflight: 1 },
        ],
      },
    ],
  ])
}

function row(name: string) {
  const cell = screen.getByText(name)
  const tr = cell.closest('tr')
  if (!tr) throw new Error('row not found')
  return within(tr)
}

describe('DeploymentsSubTable circuit column', () => {
  it('shows circuit state as text with failures and cooldown', () => {
    render(
      <DeploymentsSubTable model={MODEL} healthByName={health()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByRole('columnheader', { name: 'Circuit' })).toBeInTheDocument()

    const east = row('east')
    expect(east.getByText('Open')).toBeInTheDocument()
    expect(east.getByText('5 failures')).toBeInTheDocument()
    expect(east.getByText(/in \d+m/)).toBeInTheDocument()

    const west = row('west')
    expect(west.getByText('Half-open')).toBeInTheDocument()
    expect(west.getByText('1 failure')).toBeInTheDocument()

    expect(row('north').getByText('No data')).toBeInTheDocument()
  })

  it('renders without health data', () => {
    render(
      <DeploymentsSubTable model={MODEL} healthByName={new Map()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getAllByText('No data')).toHaveLength(3)
  })
})
