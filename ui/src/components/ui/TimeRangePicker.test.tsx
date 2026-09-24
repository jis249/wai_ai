import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TimeRangePicker } from './TimeRangePicker'

describe('TimeRangePicker', () => {
  it('renders presets plus Custom and marks the selected preset', () => {
    render(<TimeRangePicker value="7d" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Time range' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Custom range' })).toBeInTheDocument()
  })

  it('selecting a preset calls onChange with it', async () => {
    const onChange = vi.fn()
    render(<TimeRangePicker value="7d" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    expect(onChange).toHaveBeenCalledWith('30d')
  })

  it('Custom opens a from/to popover and Apply emits an ISO range', async () => {
    const onChange = vi.fn()
    render(<TimeRangePicker value="24h" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-09-01T10:00' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-02T10:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith({
      from: new Date('2026-09-01T10:00').toISOString(),
      to: new Date('2026-09-02T10:00').toISOString(),
    })
  })

  it('rejects a start after the end', async () => {
    const onChange = vi.fn()
    render(<TimeRangePicker value="24h" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-09-03T10:00' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-02T10:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Start must be before end.')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('allowCustom={false} hides the Custom segment; presets prop limits options', () => {
    render(<TimeRangePicker value="7d" onChange={vi.fn()} presets={['7d', '30d']} allowCustom={false} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
