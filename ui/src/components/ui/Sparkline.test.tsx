import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline } from './Sparkline'

function linePath(container: HTMLElement): string {
  const paths = container.querySelectorAll('path')
  return paths[paths.length - 1].getAttribute('d') ?? ''
}

describe('Sparkline', () => {
  it('spans the 100-unit width and maps min to the bottom, max to the top', () => {
    const { container } = render(<Sparkline values={[0, 5, 10]} height={32} />)
    // y grows downward with 2px padding: min -> 30, mid -> 16, max -> 2
    expect(linePath(container)).toBe('M0 30 L50 16 L100 2')
    expect(screen.getByTestId('sparkline')).toHaveAttribute('viewBox', '0 0 100 32')
  })

  it('draws a flat series and a single value through the middle', () => {
    const { container, rerender } = render(<Sparkline values={[4, 4, 4]} height={20} fill={false} />)
    expect(linePath(container)).toBe('M0 10 L50 10 L100 10')
    rerender(<Sparkline values={[7]} height={20} fill={false} />)
    expect(linePath(container)).toBe('M0 10 L100 10')
  })

  it('treats non-finite values as zero', () => {
    const { container } = render(<Sparkline values={[Number.NaN, 10]} height={32} />)
    expect(linePath(container)).toBe('M0 30 L100 2')
  })

  it('is decorative (aria-hidden) and uses the given theme color', () => {
    const { container } = render(<Sparkline values={[1, 3, 2]} color="var(--chart-2)" />)
    const svg = screen.getByTestId('sparkline')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    expect(paths[1]).toHaveAttribute('stroke', 'var(--chart-2)')
    expect(paths[0].getAttribute('fill')).toContain('var(--chart-2)')
  })

  it('can omit the area fill and renders nothing without data', () => {
    const { container, rerender } = render(<Sparkline values={[1, 2]} fill={false} />)
    expect(container.querySelectorAll('path')).toHaveLength(1)
    rerender(<Sparkline values={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
