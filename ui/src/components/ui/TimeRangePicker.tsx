import { useState } from 'react'
import { cn } from '../../lib/utils'
import {
  TIME_RANGE_PRESETS,
  TIME_RANGE_LABELS,
  fromDateTimeLocalValue,
  getTimeRange,
  isCustomTimeRange,
  timeRangeLabel,
  toDateTimeLocalValue,
  type TimeRangeLabelStyle,
  type TimeRangePreset,
  type TimeRangeValue,
} from '../../lib/timeRange'
import { Button } from './Button'
import { Input } from './Input'
import { Popover, PopoverAnchor, PopoverContent } from './Popover'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

export interface TimeRangePickerProps {
  value: TimeRangeValue
  onChange: (value: TimeRangeValue) => void
  /** Preset segments to show (default `TIME_RANGE_PRESETS`: 24h/7d/30d/90d). */
  presets?: readonly TimeRangePreset[]
  /** Show the "Custom" segment with a from/to popover (default true). */
  allowCustom?: boolean
  /** Segment label style (default "short": "7d"). */
  labelStyle?: TimeRangeLabelStyle
  size?: 'sm' | 'md'
  /** Accessible name for the group (default "Time range"). */
  'aria-label'?: string
  className?: string
}

const CUSTOM = '__custom__'
type Segment = TimeRangePreset | typeof CUSTOM

export function TimeRangePicker({
  value,
  onChange,
  presets = TIME_RANGE_PRESETS,
  allowCustom = true,
  labelStyle = 'short',
  size = 'md',
  'aria-label': ariaLabel = 'Time range',
  className,
}: TimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const custom = isCustomTimeRange(value)
  const selected: Segment = custom ? CUSTOM : value

  const options: SegmentedOption<Segment>[] = presets.map((p) => ({
    value: p,
    label: TIME_RANGE_LABELS[p][labelStyle],
    ariaLabel: TIME_RANGE_LABELS[p].long,
  }))
  if (allowCustom) {
    options.push({
      value: CUSTOM,
      label: custom ? timeRangeLabel(value) : 'Custom',
      ariaLabel: custom ? `Custom range: ${timeRangeLabel(value)}` : 'Custom range',
    })
  }

  function openCustom() {
    const current = getTimeRange(value)
    setDraftFrom(toDateTimeLocalValue(current.from))
    setDraftTo(toDateTimeLocalValue(current.to))
    setError(null)
    setOpen(true)
  }

  function handleSegment(next: Segment) {
    if (next === CUSTOM) openCustom()
    else onChange(next)
  }

  function apply() {
    const from = fromDateTimeLocalValue(draftFrom)
    const to = fromDateTimeLocalValue(draftTo)
    if (!from || !to) {
      setError('Enter both a start and an end time.')
      return
    }
    if (new Date(from).getTime() >= new Date(to).getTime()) {
      setError('Start must be before end.')
      return
    }
    onChange({ from, to })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('inline-flex', className)}>
          <SegmentedControl<Segment>
            options={options}
            value={selected}
            onChange={handleSegment}
            size={size}
            aria-label={ariaLabel}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80" aria-label="Custom time range">
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <Input
            type="datetime-local"
            label="From"
            value={draftFrom}
            max={draftTo || undefined}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
          <Input
            type="datetime-local"
            label="To"
            value={draftTo}
            min={draftFrom || undefined}
            onChange={(e) => setDraftTo(e.target.value)}
          />
          {error != null && (
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
