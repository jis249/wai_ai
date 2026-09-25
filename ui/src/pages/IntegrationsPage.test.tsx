import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import IntegrationsPage from './IntegrationsPage'

vi.mock('../api/client', () => ({
  default: vi.fn().mockResolvedValue({
    models: [
      { name: 'auto', type: 'chat' },
      { name: 'gpt-5.3-codex', type: 'chat' },
      { name: 'bge-m3:latest', type: 'embedding' },
    ],
  }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IntegrationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IntegrationsPage', () => {
  it('fills guides with the first real chat model and switches tools', async () => {
    renderPage()
    // Cursor guide by default, using the first non-"auto" chat model.
    expect(await screen.findAllByText('gpt-5.3-codex')).not.toHaveLength(0)
    expect(screen.getByText('Override OpenAI Base URL')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Continue' }))
    const yaml = screen.getByText(/schema: v1/)
    expect(yaml.textContent).toContain('model: gpt-5.3-codex')
    expect(yaml.textContent).toContain('model: bge-m3:latest')
    expect(yaml.textContent).not.toContain('model: auto')

    await userEvent.click(screen.getByRole('tab', { name: 'Claude Code' }))
    const settings = screen.getByText(/ANTHROPIC_BASE_URL/)
    expect(settings.textContent).not.toMatch(/ANTHROPIC_BASE_URL": "[^"]*\/v1"/)
  })
})
