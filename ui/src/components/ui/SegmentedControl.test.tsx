import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

type Range = '24h' | '7d' | '30d'

const options: SegmentedOption<Range>[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

function Controlled({ initial = '7d', onChange = vi.fn() }: { initial?: Range; onChange?: (v: Range) => void }) {
  const [value, setValue] = useState<Range>(initial)
  return (
    <SegmentedControl
      aria-label="Time range"
      options={options}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  describe('Rendering', () => {
    it('renders a labelled group with one button per option', () => {
      render(<SegmentedControl aria-label="Time range" options={options} value="7d" onChange={vi.fn()} />)
      expect(screen.getByRole('group', { name: 'Time range' })).toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(3)
    })

    it('marks only the selected option aria-pressed=true', () => {
      render(<SegmentedControl options={options} value="7d" onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('selected option has the raised bg-bg-secondary style', () => {
      render(<SegmentedControl options={options} value="30d" onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: '30d' }).className).toContain('bg-bg-secondary')
    })

    it('uses ariaLabel as the accessible name when provided', () => {
      render(<SegmentedControl options={[{ value: 'a', label: 'A', ariaLabel: 'Alpha' }]} value="a" onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('clicking an option calls onChange with its value', async () => {
      const onChange = vi.fn()
      render(<SegmentedControl options={options} value="7d" onChange={onChange} />)
      await userEvent.click(screen.getByRole('button', { name: '30d' }))
      expect(onChange).toHaveBeenCalledWith('30d')
    })

    it('disabled option cannot be selected', async () => {
      const onChange = vi.fn()
      render(
        <SegmentedControl
          options={[...options.slice(0, 2), { value: '30d', label: '30d', disabled: true }]}
          value="7d"
          onChange={onChange}
        />,
      )
      expect(screen.getByRole('button', { name: '30d' })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: '30d' }))
      expect(onChange).not.toHaveBeenCalled()
    })

    it('works with numeric values', async () => {
      const onChange = vi.fn()
      render(
        <SegmentedControl
          options={[
            { value: 25, label: '25' },
            { value: 50, label: '50' },
          ]}
          value={25}
          onChange={onChange}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: '50' }))
      expect(onChange).toHaveBeenCalledWith(50)
    })
  })

  describe('Keyboard', () => {
    it('only the selected option is in the tab order (roving tabindex)', () => {
      render(<SegmentedControl options={options} value="7d" onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('tabindex', '0')
      expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('tabindex', '-1')
    })

    it('Tab focuses the selected option', async () => {
      render(<Controlled initial="30d" />)
      await userEvent.tab()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '30d' }))
    })

    it('ArrowRight moves focus and selection to the next option', async () => {
      const onChange = vi.fn()
      render(<Controlled initial="7d" onChange={onChange} />)
      await userEvent.tab()
      await userEvent.keyboard('{ArrowRight}')
      expect(onChange).toHaveBeenCalledWith('30d')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '30d' }))
      expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('ArrowLeft wraps from the first to the last option', async () => {
      const onChange = vi.fn()
      render(<Controlled initial="24h" onChange={onChange} />)
      await userEvent.tab()
      await userEvent.keyboard('{ArrowLeft}')
      expect(onChange).toHaveBeenCalledWith('30d')
    })

    it('Home / End jump to the first / last option', async () => {
      const onChange = vi.fn()
      render(<Controlled initial="7d" onChange={onChange} />)
      await userEvent.tab()
      await userEvent.keyboard('{End}')
      expect(onChange).toHaveBeenLastCalledWith('30d')
      await userEvent.keyboard('{Home}')
      expect(onChange).toHaveBeenLastCalledWith('24h')
    })

    it('arrow keys skip disabled options', async () => {
      const onChange = vi.fn()
      render(
        <SegmentedControl
          options={[options[0], { ...options[1], disabled: true }, options[2]]}
          value="24h"
          onChange={onChange}
        />,
      )
      await userEvent.tab()
      await userEvent.keyboard('{ArrowRight}')
      expect(onChange).toHaveBeenCalledWith('30d')
    })
  })
})
