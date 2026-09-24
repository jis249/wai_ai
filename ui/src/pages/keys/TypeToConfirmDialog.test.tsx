import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TypeToConfirmDialog } from './TypeToConfirmDialog'

describe('TypeToConfirmDialog', () => {
  it('enables the destructive action only after the exact name is typed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <TypeToConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Revoke API key"
        description="Cannot be undone."
        confirmText="Prod backend"
        confirmLabel="Revoke"
      />,
    )
    const revoke = screen.getByRole('button', { name: 'Revoke' })
    expect(revoke).toBeDisabled()
    const input = screen.getByLabelText('Type "Prod backend" to confirm')
    await user.type(input, 'Prod')
    expect(revoke).toBeDisabled()
    await user.type(input, ' backend')
    expect(revoke).toBeEnabled()
    await user.click(revoke)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
