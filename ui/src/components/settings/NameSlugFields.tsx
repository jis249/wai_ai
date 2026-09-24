import { Input } from '../ui/Input'
import type { NameSlugErrors, NameSlugValues } from './nameSlug'

export interface NameSlugFieldsProps {
  values: NameSlugValues
  errors: NameSlugErrors
  onChange: (values: NameSlugValues) => void
  disabled?: boolean
  namePlaceholder?: string
  slugPlaceholder?: string
}

export function NameSlugFields({
  values,
  errors,
  onChange,
  disabled = false,
  namePlaceholder,
  slugPlaceholder,
}: NameSlugFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label="Name"
        value={values.name}
        onChange={(e) => onChange({ ...values, name: e.target.value })}
        placeholder={namePlaceholder}
        error={errors.name}
        disabled={disabled}
      />
      <Input
        label="Slug"
        value={values.slug}
        onChange={(e) => onChange({ ...values, slug: e.target.value })}
        placeholder={slugPlaceholder}
        description="Used in URLs and API references. Lowercase letters, numbers, and hyphens."
        error={errors.slug}
        disabled={disabled}
        className="font-mono"
      />
    </div>
  )
}
