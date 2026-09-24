import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { KeyRevealDialog } from './KeyRevealDialog'

function setup() {
  const onClose = vi.fn()
  render(
    <KeyRevealDialog
      keyValue="wa_uk_plaintext123"
      keyName="CI"
      model="gpt-4o"
      baseUrl="https://ai.waiin.com/v1"
      onClose={onClose}
    />,
  )
  return { onClose, user: userEvent.setup() }
}

describe('KeyRevealDialog', () => {
  it('shows the key in a read-only monospace field with a copy button and a curl snippet', () => {
    setup()
    const field = screen.getByLabelText('API key') as HTMLInputElement
    expect(field.value).toBe('wa_uk_plaintext123')
    expect(field.readOnly).toBe(true)
    expect(field.className).toContain('font-mono')
    expect(screen.getByRole('button', { name: /copy key/i })).toBeInTheDocument()
    const code = screen.getByTestId('snippet-code').textContent ?? ''
    expect(code).toContain('https://ai.waiin.com/v1/chat/completions')
    expect(code).toContain('Bearer wa_uk_plaintext123')
  })

  it('switches to the Python (OpenAI SDK) snippet', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Python' }))
    const code = screen.getByTestId('snippet-code').textContent ?? ''
    expect(code).toContain('base_url="https://ai.waiin.com/v1"')
    expect(code).toContain('model="gpt-4o"')
  })

  it('blocks closing until the user confirms the key is stored', async () => {
    const { onClose, user } = setup()
    const dialog = screen.getByRole('dialog')
    const [headerClose, footerClose] = within(dialog).getAllByRole('button', { name: 'Close' })
    expect(footerClose).toBeDisabled()

    // Header X and Escape are blocked too, with a nudge.
    await user.click(headerClose)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/stored the key/i)

    await user.click(screen.getByLabelText(/stored this key somewhere safe/i))
    expect(footerClose).toBeEnabled()
    await user.click(footerClose)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
