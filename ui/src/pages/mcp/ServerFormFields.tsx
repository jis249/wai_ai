import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { TriangleAlert } from '../../components/ui/icons'
import { AUTH_TYPE_OPTIONS } from './helpers'
import type { ServerFormErrors, ServerFormState } from './serverForm'

interface ServerFormFieldsProps {
  form: ServerFormState
  onChange: (patch: Partial<ServerFormState>) => void
  errors: ServerFormErrors
  disabled?: boolean
  /** Edit mode: secrets are optional ("leave empty to keep current"). */
  editing?: boolean
}

export function ServerFormFields({ form, onChange, errors, disabled, editing = false }: ServerFormFieldsProps) {
  const secretPlaceholder = editing ? 'Leave empty to keep current' : 'Encrypted at rest, never shown again'
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. GitHub MCP"
          error={errors.name}
          disabled={disabled}
        />
        <Input
          label="Alias"
          value={form.alias}
          onChange={(e) => onChange({ alias: e.target.value })}
          placeholder="my-github-mcp"
          description={editing ? undefined : 'Used in the MCP endpoint URL. Must be unique.'}
          error={errors.alias}
          disabled={disabled}
        />
      </div>
      <Input
        label="URL"
        value={form.url}
        onChange={(e) => onChange({ url: e.target.value })}
        placeholder="https://mcp.example.com/sse"
        error={errors.url}
        disabled={disabled}
      />
      <Select
        label="Auth type"
        options={AUTH_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={form.authType}
        onChange={(val) => {
          const patch: Partial<ServerFormState> = { authType: val }
          if (val !== 'oauth') {
            Object.assign(patch, { oauthTokenUrl: '', oauthClientId: '', oauthClientSecret: '', oauthScopes: '' })
          }
          onChange(patch)
        }}
        disabled={disabled}
      />
      {form.authType !== 'none' && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/10 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-warning">
            Credentials configured here are shared across all users with access to this server. Use service
            accounts or application credentials, not personal tokens.
          </p>
        </div>
      )}
      {(form.authType === 'bearer' || form.authType === 'header') && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Auth token"
            type="password"
            autoComplete="new-password"
            value={form.authToken}
            onChange={(e) => onChange({ authToken: e.target.value })}
            placeholder={secretPlaceholder}
            description={editing ? 'Enter a new value to replace the current token.' : undefined}
            disabled={disabled}
          />
          {form.authType === 'header' && (
            <Input
              label="Header name"
              value={form.authHeader}
              onChange={(e) => onChange({ authHeader: e.target.value })}
              placeholder="X-API-Key"
              error={errors.auth_header}
              disabled={disabled}
            />
          )}
        </div>
      )}
      {form.authType === 'oauth' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Token URL"
              value={form.oauthTokenUrl}
              onChange={(e) => onChange({ oauthTokenUrl: e.target.value })}
              placeholder="https://auth.example.com/oauth/token"
              disabled={disabled}
            />
          </div>
          <Input
            label="Client ID"
            value={form.oauthClientId}
            onChange={(e) => onChange({ oauthClientId: e.target.value })}
            disabled={disabled}
          />
          <Input
            label="Client secret"
            type="password"
            autoComplete="new-password"
            value={form.oauthClientSecret}
            onChange={(e) => onChange({ oauthClientSecret: e.target.value })}
            placeholder={secretPlaceholder}
            disabled={disabled}
          />
          <div className="sm:col-span-2">
            <Input
              label="Scopes"
              value={form.oauthScopes}
              onChange={(e) => onChange({ oauthScopes: e.target.value })}
              placeholder="read write"
              description="Space-separated"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  )
}
