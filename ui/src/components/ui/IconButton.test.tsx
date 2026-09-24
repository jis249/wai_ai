import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { IconButton } from './IconButton'
import { TooltipProvider } from './Tooltip'

const icon = <svg data-testid="ib-icon" />

describe('IconButton', () => {
  describe('Rendering', () => {
    it('uses aria-label as the accessible name', () => {
      render(<IconButton aria-label="Delete key" icon={icon} />)
      expect(screen.getByRole('button', { name: 'Delete key' })).toBeInTheDocument()
    })

    it('renders the icon hidden from assistive tech', () => {
      render(<IconButton aria-label="Edit" icon={icon} />)
      expect(screen.getByTestId('ib-icon').parentElement).toHaveAttribute('aria-hidden', 'true')
    })

    it('type defaults to "button"', () => {
      render(<IconButton aria-label="Edit" icon={icon} />)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('destructive variant uses the error hover color', () => {
      render(<IconButton aria-label="Delete" icon={icon} variant="destructive" />)
      expect(screen.getByRole('button').className).toContain('hover:text-error')
    })

    it('sm size is smaller than md', () => {
      const { rerender } = render(<IconButton aria-label="Edit" icon={icon} size="sm" />)
      expect(screen.getByRole('button').className).toContain('h-7')
      rerender(<IconButton aria-label="Edit" icon={icon} />)
      expect(screen.getByRole('button').className).toContain('h-9')
    })

    it('forwards ref to the button element', () => {
      const ref = createRef<HTMLButtonElement>()
      render(<IconButton ref={ref} aria-label="Edit" icon={icon} />)
      expect(ref.current?.tagName).toBe('BUTTON')
    })
  })

  describe('Interaction', () => {
    it('onClick fires when clicked', async () => {
      const onClick = vi.fn()
      render(<IconButton aria-label="Refresh" icon={icon} onClick={onClick} />)
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('disabled prevents onClick', async () => {
      const onClick = vi.fn()
      render(<IconButton aria-label="Refresh" icon={icon} onClick={onClick} disabled />)
      await userEvent.click(screen.getByRole('button'))
      expect(onClick).not.toHaveBeenCalled()
    })

    it('loading disables the button, sets aria-busy and hides the icon', () => {
      render(<IconButton aria-label="Refresh" icon={icon} loading />)
      const btn = screen.getByRole('button', { name: 'Refresh' })
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByTestId('ib-icon')).not.toBeInTheDocument()
    })
  })

  describe('Tooltip', () => {
    it('shows the label in a tooltip on keyboard focus', async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <IconButton aria-label="Copy key" icon={icon} />
        </TooltipProvider>,
      )
      await userEvent.tab()
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy key')
    })

    it('custom tooltip content overrides the label but keeps aria-label', async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <IconButton aria-label="Copy" icon={icon} tooltip="Copy to clipboard" />
        </TooltipProvider>,
      )
      await userEvent.tab()
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy to clipboard')
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    })

    it('works without an explicit TooltipProvider', async () => {
      render(<IconButton aria-label="Standalone" icon={icon} />)
      await userEvent.tab()
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Standalone')
    })

    it('tooltip={false} renders no tooltip', async () => {
      render(
        <TooltipProvider delayDuration={0}>
          <IconButton aria-label="Quiet" icon={icon} tooltip={false} />
        </TooltipProvider>,
      )
      await userEvent.tab()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})
