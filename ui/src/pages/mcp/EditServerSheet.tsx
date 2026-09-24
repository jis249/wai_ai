import { useState } from 'react'
import { useUpdateMCPServer } from '../../hooks/useMCPServers'
import type { MCPServerResponse } from '../../hooks/useMCPServers'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { ServerFormFields } from './ServerFormFields'
import { buildUpdateParams, formFromServer, validateServerForm } from './serverForm'
import type { ServerFormErrors, ServerFormState } from './serverForm'

interface EditServerSheetProps {
  server: MCPServerResponse
  onClose: () => void
}

export function EditServerSheet({ server, onClose }: EditServerSheetProps) {
  const [form, setForm] = useState<ServerFormState>(() => formFromServer(server))
  const [errors, setErrors] = useState<ServerFormErrors>({})
  const updateMCPServer = useUpdateMCPServer()
  const { toast } = useToast()
  const isPending = updateMCPServer.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = validateServerForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const params = buildUpdateParams(server, form)
    if (Object.keys(params).length === 0) {
      onClose()
      return
    }
    updateMCPServer.mutate(
      { serverId: server.id, params },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'MCP server updated' })
          onClose()
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to update MCP server') }),
      },
    )
  }

  const formId = 'edit-mcp-server-form'

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit MCP server"
      description={<span className="font-mono">{server.alias}</span>}
      width="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={isPending}>
            Save changes
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate>
        <ServerFormFields
          form={form}
          onChange={(p) => setForm((prev) => ({ ...prev, ...p }))}
          errors={errors}
          disabled={isPending}
          editing
        />
      </form>
    </Sheet>
  )
}
