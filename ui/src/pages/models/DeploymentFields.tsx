import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { PROVIDER_OPTIONS, baseUrlPlaceholder } from './modelHelpers'
import type { DeploymentEntry, DeploymentEntryErrors } from './modelHelpers'

export type { DeploymentEntry, DeploymentEntryErrors } from './modelHelpers'

export interface DeploymentFieldsProps {
  value: DeploymentEntry
  onChange: (patch: Partial<DeploymentEntry>) => void
  errors?: DeploymentEntryErrors
  disabled?: boolean
  /** Editing an existing deployment: key/URL may be left empty to keep current. */
  isEdit?: boolean
}

/** Name / provider / URL / key / Azure / weight / priority fields for one deployment. */
export function DeploymentFields({ value, onChange, errors, disabled, isEdit = false }: DeploymentFieldsProps) {
  const isAzure = value.provider === 'azure'
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label="Name"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="e.g. primary"
        error={errors?.name}
        disabled={disabled}
      />
      <Select
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={value.provider}
        onChange={(provider) => onChange({ provider })}
        error={errors?.provider}
        disabled={disabled}
      />
      <Input
        label="Base URL"
        value={value.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder={baseUrlPlaceholder(value.provider)}
        error={errors?.base_url}
        description={isEdit ? 'Leave empty to keep current' : undefined}
        disabled={disabled}
      />
      <Input
        label="API Key"
        type="password"
        autoComplete="new-password"
        value={value.apiKey}
        onChange={(e) => onChange({ apiKey: e.target.value })}
        placeholder={isEdit ? 'Leave empty to keep current' : 'sk-...'}
        description={isEdit ? 'Leave empty to keep current key' : 'Encrypted at rest, never shown again'}
        disabled={disabled}
      />
      {isAzure && (
        <>
          <Input
            label="Azure Deployment"
            value={value.azureDeployment}
            onChange={(e) => onChange({ azureDeployment: e.target.value })}
            placeholder="e.g. gpt-4o-deployment"
            disabled={disabled}
          />
          <Input
            label="Azure API Version"
            value={value.azureApiVersion}
            onChange={(e) => onChange({ azureApiVersion: e.target.value })}
            placeholder="e.g. 2024-02-01"
            disabled={disabled}
          />
        </>
      )}
      <Input
        label="Weight"
        type="number"
        inputMode="numeric"
        value={value.weight}
        onChange={(e) => onChange({ weight: e.target.value })}
        placeholder="1"
        disabled={disabled}
      />
      <Input
        label="Priority"
        type="number"
        inputMode="numeric"
        value={value.priority}
        onChange={(e) => onChange({ priority: e.target.value })}
        placeholder="0"
        disabled={disabled}
      />
    </div>
  )
}
