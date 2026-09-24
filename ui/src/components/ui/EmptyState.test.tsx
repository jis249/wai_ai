import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  describe('Rendering', () => {
    it('renders the title as a heading', () => {
      render(<EmptyState title="No API keys yet" />)
      expect(screen.getByRole('heading', { name: 'No API keys yet' })).toBeInTheDocument()
    })

    it('renders the description when provided', () => {
      render(<EmptyState title="Nothing here" description="Create one to get started." />)
      expect(screen.getByText('Create one to get started.')).toBeInTheDocument()
    })

    it('renders the icon in an aria-hidden bubble', () => {
      render(<EmptyState title="Empty" icon={<span data-testid="empty-icon">i</span>} />)
      expect(screen.getByTestId('empty-icon').parentElement).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders no buttons when no actions are given', () => {
      render(<EmptyState title="Empty" />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('plain variant has no border; card variant draws a bordered surface', () => {
      const { rerender } = render(<EmptyState title="Empty" />)
      expect(screen.getByRole('status').className).not.toContain('border-border')
      rerender(<EmptyState title="Empty" variant="card" />)
      expect(screen.getByRole('status').className).toContain('bg-bg-secondary')
      expect(screen.getByRole('status').className).toContain('border-border')
    })

    it('renders children', () => {
      render(
        <EmptyState title="Empty">
          <a href="/docs">Read the docs</a>
        </EmptyState>,
      )
      expect(screen.getByRole('link', { name: 'Read the docs' })).toBeInTheDocument()
    })
  })

  describe('Actions', () => {
    it('primary action renders a primary button and fires onClick', async () => {
      const onClick = vi.fn()
      render(<EmptyState title="Empty" action={{ label: 'Create key', onClick }} />)
      const btn = screen.getByRole('button', { name: 'Create key' })
      expect(btn.className).toContain('bg-accent')
      await userEvent.click(btn)
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('secondary action renders a secondary button and fires onClick', async () => {
      const onClick = vi.fn()
      render(
        <EmptyState
          title="Empty"
          action={{ label: 'Create', onClick: vi.fn() }}
          secondaryAction={{ label: 'Learn more', onClick }}
        />,
      )
      const btn = screen.getByRole('button', { name: 'Learn more' })
      expect(btn.className).toContain('border')
      await userEvent.click(btn)
      expect(onClick).toHaveBeenCalledOnce()
    })
  })
})
