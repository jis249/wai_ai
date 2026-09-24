import { SegmentedControl } from '../ui/SegmentedControl'

const OPTIONS = [
  { value: 'org' as const, label: 'My Organization' },
  { value: 'all' as const, label: 'All Organizations' },
]

export interface UsageScopeToggleProps {
  crossOrg: boolean
  onChange: (crossOrg: boolean) => void
}

/** System-admin toggle between the current org and all orgs. */
export function UsageScopeToggle({ crossOrg, onChange }: UsageScopeToggleProps) {
  return (
    <SegmentedControl
      aria-label="Usage scope"
      options={OPTIONS}
      value={crossOrg ? 'all' : 'org'}
      onChange={(v) => onChange(v === 'all')}
    />
  )
}
