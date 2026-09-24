import React, { useState } from 'react'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Building2, Gauge } from '../ui/icons'
import { useUpdateOrg, type OrgResponse, type UpdateOrgParams } from '../../hooks/useOrg'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { LimitsForm, LIMITS_MANAGED_NOTE } from './LimitsForm'
import { NameSlugFields } from './NameSlugFields'
import { validateNameSlug, type NameSlugErrors } from './nameSlug'
import { limitsDirty, limitsFromRecord, limitsToParams, type LimitsValues } from './limits'

export interface OrgSettingsFormProps {
  org: OrgResponse
  /** Name/slug not editable (non-admins). */
  readOnly?: boolean
  /** Limits, spend caps and guardrails not editable (everyone except system admins). */
  limitsReadOnly?: boolean
}

const LIMIT_OPTS = { spend: true, guardrails: true } as const

/**
 * Org name/slug + limits/spend/guardrails. Mount with `key={org.id}` so state re-initialises
 * per org. When `limitsReadOnly`, limit fields are shown as text and not sent on save.
 */
export function OrgSettingsForm({ org, readOnly = false, limitsReadOnly = false }: OrgSettingsFormProps) {
  const updateOrg = useUpdateOrg(org.id)
  const { toast } = useToast()

  const [basic, setBasic] = useState({ name: org.name, slug: org.slug })
  const [errors, setErrors] = useState<NameSlugErrors>({})
  const [limits, setLimits] = useState<LimitsValues>(() => limitsFromRecord(org))

  const isDirty =
    basic.name !== org.name ||
    basic.slug !== org.slug ||
    (!limitsReadOnly && limitsDirty(limits, org, LIMIT_OPTS))
  const canSave = !readOnly || !limitsReadOnly

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateNameSlug(basic)
    setErrors(errs)
    if (errs.name || errs.slug) return

    const params: UpdateOrgParams = {
      ...(readOnly ? {} : { name: basic.name.trim(), slug: basic.slug.trim() }),
      ...(limitsReadOnly ? {} : limitsToParams(limits, LIMIT_OPTS)),
    }
    updateOrg.mutate(params, {
      onSuccess: () => toast({ variant: 'success', message: 'Settings saved' }),
      onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to save settings') }),
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader title="Organization" description="Display name and URL slug." icon={<Building2 className="h-5 w-5" />} />
        <NameSlugFields
          values={basic}
          errors={errors}
          onChange={setBasic}
          disabled={readOnly || updateOrg.isPending}
          namePlaceholder="e.g. Acme Corp"
          slugPlaceholder="e.g. acme-corp"
        />
      </Card>

      <Card>
        <CardHeader
          title="Limits & guardrails"
          description="Token, request and spend caps applied to every key in this organization."
          icon={<Gauge className="h-5 w-5" />}
        />
        <LimitsForm
          values={limits}
          onChange={setLimits}
          readOnly={limitsReadOnly}
          readOnlyNote={limitsReadOnly && !readOnly ? LIMITS_MANAGED_NOTE : undefined}
          disabled={updateOrg.isPending}
          {...LIMIT_OPTS}
        />
      </Card>

      {canSave ? (
        <div className="flex justify-end">
          <Button type="submit" loading={updateOrg.isPending} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-tertiary">Contact your org admin to change settings.</p>
      )}
    </form>
  )
}
