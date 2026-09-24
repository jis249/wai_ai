import { Input } from '../../components/ui/Input'
import type { KeyLimitsValue } from './helpers'

const FIELDS: { key: keyof KeyLimitsValue; label: string }[] = [
  { key: 'dailyTokenLimit', label: 'Daily Token Limit' },
  { key: 'monthlyTokenLimit', label: 'Monthly Token Limit' },
  { key: 'requestsPerMinute', label: 'Requests per Minute' },
  { key: 'requestsPerDay', label: 'Requests per Day' },
]

interface KeyLimitsFieldsProps {
  value: KeyLimitsValue
  onChange: (value: KeyLimitsValue) => void
  disabled?: boolean
}

/** Token / rate limit inputs shared by the create and edit dialogs. */
export function KeyLimitsFields({ value, onChange, disabled }: KeyLimitsFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <Input
          key={f.key}
          label={f.label}
          type="number"
          min={0}
          inputMode="numeric"
          value={value[f.key]}
          onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
          placeholder="0 = unlimited"
          disabled={disabled}
        />
      ))}
    </div>
  )
}
