import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { LimitsForm, LIMITS_MANAGED_NOTE } from './LimitsForm'
import { formatNumber } from '../../lib/utils'
import { limitsDirty, limitsFromRecord, limitsToParams, parseLimit, type LimitsRecord, type LimitsValues } from './limits'

const ORG: LimitsRecord = {
  daily_token_limit: 100000,
  monthly_token_limit: 0,
  requests_per_minute: 60,
  requests_per_day: 0,
  monthly_spend_limit: 25,
  guardrail_pii: true,
  guardrail_tool_denylist: 'shell_exec',
}

function Harness({ readOnly = false, onValues }: { readOnly?: boolean; onValues?: (v: LimitsValues) => void }) {
  const [values, setValues] = useState(() => limitsFromRecord(ORG))
  return (
    <LimitsForm
      values={values}
      onChange={(v) => {
        setValues(v)
        onValues?.(v)
      }}
      readOnly={readOnly}
      readOnlyNote={readOnly ? LIMITS_MANAGED_NOTE : undefined}
      spend
      guardrails
    />
  )
}

describe('LimitsForm', () => {
  it('read-only mode shows values as text with the managed-by note and no inputs', () => {
    render(<Harness readOnly />)
    expect(screen.getByText(LIMITS_MANAGED_NOTE)).toBeInTheDocument()
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByText(formatNumber(100000))).toBeInTheDocument()
    expect(screen.getAllByText('Unlimited')).toHaveLength(2)
    expect(screen.getByText('$25.00')).toBeInTheDocument()
    expect(screen.getByText('shell_exec')).toBeInTheDocument()
  })

  it('editable mode renders number inputs with "0 = unlimited" help', async () => {
    let latest: LimitsValues | undefined
    render(<Harness onValues={(v) => (latest = v)} />)
    expect(screen.getAllByText('0 = unlimited')).toHaveLength(4)
    const rpm = screen.getByLabelText('Requests / minute')
    await userEvent.clear(rpm)
    await userEvent.type(rpm, '120')
    expect(latest?.requestsPerMinute).toBe('120')
    expect(limitsDirty(latest!, ORG, { spend: true, guardrails: true })).toBe(true)
  })
})

describe('limits helpers', () => {
  it('parses blank/negative as unlimited and omits org-only fields unless requested', () => {
    expect(parseLimit('')).toBe(0)
    expect(parseLimit('-5')).toBe(0)
    const values = limitsFromRecord(ORG)
    expect(limitsToParams(values)).not.toHaveProperty('monthly_spend_limit')
    expect(limitsToParams(values, { spend: true, guardrails: true })).toMatchObject({
      monthly_spend_limit: 25,
      guardrail_pii: true,
      guardrail_tool_denylist: 'shell_exec',
    })
    expect(limitsDirty(values, ORG, { spend: true, guardrails: true })).toBe(false)
  })
})
