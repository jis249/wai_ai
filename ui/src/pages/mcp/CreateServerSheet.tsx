import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import apiClient from '../../api/client'
import type { MCPServerResponse } from '../../hooks/useMCPServers'
import { useTeams } from '../../hooks/useTeams'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { ServerFormFields } from './ServerFormFields'
import { EMPTY_SERVER_FORM, buildCreateParams, validateServerForm } from './serverForm'
import type { ServerFormErrors, ServerFormState } from './serverForm'

const TEMPLATES = [
  { name: 'Filesystem', alias: 'fs', url: 'http://127.0.0.1:7331/mcp' },
  { name: 'PowerShell', alias: 'pwsh', url: 'http://127.0.0.1:7332/mcp' },
  { name: 'Browser', alias: 'browser', url: 'http://127.0.0.1:7333/mcp' },
]

interface CreateServerSheetProps {
  open: boolean
  onClose: () => void
  orgId: string
  isSystemAdmin: boolean
  isOrgAdmin: boolean
}

export function CreateServerSheet({ open, onClose, orgId, isSystemAdmin, isOrgAdmin }: CreateServerSheetProps) {
  const scopeOptions = isSystemAdmin
    ? [
        { value: 'global', label: 'Global' },
        { value: 'org', label: 'Organization' },
        { value: 'team', label: 'Team' },
      ]
    : isOrgAdmin
      ? [
          { value: 'org', label: 'Organization' },
          { value: 'team', label: 'Team' },
        ]
      : [{ value: 'team', label: 'Team' }]
  const defaultScope = scopeOptions[0].value

  const [scope, setScope] = useState(defaultScope)
  const [teamId, setTeamId] = useState('')
  const [form, setForm] = useState<ServerFormState>(EMPTY_SERVER_FORM)
  const [errors, setErrors] = useState<ServerFormErrors>({})
  const [isPending, setIsPending] = useState(false)

  const { data: teams } = useTeams(orgId)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const teamOptions = teams?.data?.map((t) => ({ value: t.id, label: t.name })) ?? []

  function handleClose() {
    setScope(defaultScope)
    setTeamId('')
    setForm(EMPTY_SERVER_FORM)
    setErrors({})
    onClose()
  }

  function patch(p: Partial<ServerFormState>) {
    setForm((prev) => ({ ...prev, ...p }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = validateServerForm(form)
    if (scope === 'team' && !teamId) next.team = 'Team is required'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    let endpoint: string
    if (scope === 'global') {
      endpoint = '/mcp-servers'
    } else if (scope === 'org') {
      if (!orgId) {
        toast({ variant: 'error', message: 'Organization context required' })
        return
      }
      endpoint = `/orgs/${orgId}/mcp-servers`
    } else {
      if (!orgId || !teamId) {
        toast({ variant: 'error', message: 'Organization and team required' })
        return
      }
      endpoint = `/orgs/${orgId}/teams/${teamId}/mcp-servers`
    }

    setIsPending(true)
    apiClient<MCPServerResponse>(endpoint, { method: 'POST', body: JSON.stringify(buildCreateParams(form)) })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
        toast({ variant: 'success', message: 'MCP server added' })
        handleClose()
      })
      .catch((err: unknown) => toast({ variant: 'error', message: errorMessage(err, 'Failed to add MCP server') }))
      .finally(() => setIsPending(false))
  }

  const formId = 'create-mcp-server-form'

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Add MCP server"
      description="Register an MCP server endpoint for your organization, a team, or everyone."
      width="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={isPending}>
            Add server
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">Templates</p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((tpl) => (
              <Button
                key={tpl.alias}
                variant="secondary"
                size="sm"
                type="button"
                disabled={isPending}
                onClick={() => patch({ name: tpl.name, alias: tpl.alias, url: tpl.url })}
              >
                {tpl.name}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            Templates fill localhost URLs. Only enable private MCP URLs if you trust the process on this PC.
          </p>
        </div>

        {(scopeOptions.length > 1 || scope === 'team') && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {scopeOptions.length > 1 && (
              <Select
                label="Scope"
                options={scopeOptions}
                value={scope}
                onChange={(val) => {
                  setScope(val)
                  setTeamId('')
                  setErrors((prev) => ({ ...prev, team: undefined }))
                }}
                disabled={isPending}
              />
            )}
            {scope === 'team' && (
              <div>
                <Select
                  label="Team"
                  options={teamOptions}
                  value={teamId}
                  onChange={(val) => {
                    setTeamId(val)
                    if (val) setErrors((prev) => ({ ...prev, team: undefined }))
                  }}
                  placeholder="Select a team..."
                  error={errors.team}
                  disabled={isPending}
                />
                {teamOptions.length === 0 && (
                  <p className="mt-1.5 text-xs text-text-tertiary">
                    No teams found. Create a team first before adding a team-scoped server.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <ServerFormFields form={form} onChange={patch} errors={errors} disabled={isPending} />
      </form>
    </Sheet>
  )
}
