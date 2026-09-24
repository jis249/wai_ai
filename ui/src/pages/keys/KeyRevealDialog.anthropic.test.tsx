import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { KeyRevealDialog } from './KeyRevealDialog'

describe('KeyRevealDialog Anthropic SDK tab', () => {
  it('shows an Anthropic SDK snippet pointed at the origin', async () => {
    render(
      <KeyRevealDialog keyValue="wa_uk_plaintext123" model="claude-alias" baseUrl="https://ai.waiin.com/v1" onClose={vi.fn()} />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Anthropic SDK' }))
    const code = screen.getByTestId('snippet-code').textContent ?? ''
    expect(code).toContain('anthropic.Anthropic(')
    expect(code).toContain('base_url="https://ai.waiin.com",')
    expect(code).toContain('api_key="wa_uk_plaintext123"')
    expect(code).toContain('model="claude-alias"')
  })
})
