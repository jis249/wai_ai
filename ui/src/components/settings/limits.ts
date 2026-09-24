/** Form state + (de)serialisation for token / request / spend limits and guardrails. */

export interface LimitsValues {
  dailyTokenLimit: string
  monthlyTokenLimit: string
  requestsPerMinute: string
  requestsPerDay: string
  monthlySpendLimit: string
  guardrailPii: boolean
  toolDenylist: string
}

/** Wire shape shared by orgs and teams (spend/guardrails are org-only and optional). */
export interface LimitsRecord {
  daily_token_limit: number
  monthly_token_limit: number
  requests_per_minute: number
  requests_per_day: number
  monthly_spend_limit?: number
  guardrail_pii?: boolean
  guardrail_tool_denylist?: string
}

export interface LimitsParams {
  daily_token_limit: number
  monthly_token_limit: number
  requests_per_minute: number
  requests_per_day: number
  monthly_spend_limit?: number
  guardrail_pii?: boolean
  guardrail_tool_denylist?: string
}

export interface LimitsOptions {
  /** Include the monthly spend cap (orgs only). */
  spend?: boolean
  /** Include PII / tool-denylist guardrails (orgs only). */
  guardrails?: boolean
}

/** Non-negative integer; blank/invalid/negative -> 0 (unlimited). */
export function parseLimit(value: string): number {
  const n = parseInt(value, 10)
  return isNaN(n) || n < 0 ? 0 : n
}

/** Non-negative amount in USD; blank/invalid/negative -> 0 (unlimited). */
export function parseSpend(value: string): number {
  const n = parseFloat(value)
  return isNaN(n) || n < 0 ? 0 : n
}

export function limitsFromRecord(rec: LimitsRecord): LimitsValues {
  return {
    dailyTokenLimit: String(rec.daily_token_limit ?? 0),
    monthlyTokenLimit: String(rec.monthly_token_limit ?? 0),
    requestsPerMinute: String(rec.requests_per_minute ?? 0),
    requestsPerDay: String(rec.requests_per_day ?? 0),
    monthlySpendLimit: String(rec.monthly_spend_limit ?? 0),
    guardrailPii: Boolean(rec.guardrail_pii),
    toolDenylist: rec.guardrail_tool_denylist ?? '',
  }
}

export function limitsToParams(values: LimitsValues, opts: LimitsOptions = {}): LimitsParams {
  const params: LimitsParams = {
    daily_token_limit: parseLimit(values.dailyTokenLimit),
    monthly_token_limit: parseLimit(values.monthlyTokenLimit),
    requests_per_minute: parseLimit(values.requestsPerMinute),
    requests_per_day: parseLimit(values.requestsPerDay),
  }
  if (opts.spend) params.monthly_spend_limit = parseSpend(values.monthlySpendLimit)
  if (opts.guardrails) {
    params.guardrail_pii = values.guardrailPii
    params.guardrail_tool_denylist = values.toolDenylist
  }
  return params
}

export function limitsDirty(values: LimitsValues, rec: LimitsRecord, opts: LimitsOptions = {}): boolean {
  const p = limitsToParams(values, opts)
  if (
    p.daily_token_limit !== rec.daily_token_limit ||
    p.monthly_token_limit !== rec.monthly_token_limit ||
    p.requests_per_minute !== rec.requests_per_minute ||
    p.requests_per_day !== rec.requests_per_day
  ) {
    return true
  }
  if (opts.spend && p.monthly_spend_limit !== (rec.monthly_spend_limit ?? 0)) return true
  if (
    opts.guardrails &&
    (p.guardrail_pii !== Boolean(rec.guardrail_pii) || p.guardrail_tool_denylist !== (rec.guardrail_tool_denylist ?? ''))
  ) {
    return true
  }
  return false
}
