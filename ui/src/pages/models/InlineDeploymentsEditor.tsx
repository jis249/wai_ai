import React, { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Pencil, Plus, Trash2 } from '../../components/ui/icons'
import { DeploymentFields } from './DeploymentFields'
import { emptyDeploymentEntry, providerLabel } from './modelHelpers'
import type { DeploymentEntry, DeploymentEntryErrors } from './modelHelpers'

export interface InlineDeploymentsEditorProps {
  deployments: DeploymentEntry[]
  onChange: (next: DeploymentEntry[]) => void
  error?: string
  disabled?: boolean
}

/** Local (pre-create) list of deployments for a new load-balanced model. */
export function InlineDeploymentsEditor({ deployments, onChange, error, disabled }: InlineDeploymentsEditorProps) {
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [entry, setEntry] = useState<DeploymentEntry>(emptyDeploymentEntry)
  const [errors, setErrors] = useState<DeploymentEntryErrors>({})

  const formOpen = showNewForm || editingIndex !== null

  function resetForm() {
    setShowNewForm(false)
    setEditingIndex(null)
    setEntry(emptyDeploymentEntry())
    setErrors({})
  }

  function validate(): boolean {
    const next: DeploymentEntryErrors = {}
    if (!entry.name.trim()) next.name = 'Name is required'
    if (!entry.provider) next.provider = 'Provider is required'
    if (!entry.baseUrl.trim()) next.base_url = 'Base URL is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSave(e: React.MouseEvent) {
    e.preventDefault()
    if (!validate()) return
    if (editingIndex !== null) {
      const next = [...deployments]
      next[editingIndex] = { ...entry }
      onChange(next)
    } else {
      onChange([...deployments, { ...entry }])
    }
    resetForm()
  }

  function handleEdit(index: number) {
    setShowNewForm(false)
    setEditingIndex(index)
    setEntry({ ...deployments[index] })
    setErrors({})
  }

  function handleRemove(index: number) {
    onChange(deployments.filter((_, i) => i !== index))
    if (editingIndex === index) resetForm()
  }

  const form = (heading: string, saveLabel: string) => (
    <div className="space-y-3 rounded-md border border-border bg-bg-tertiary/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{heading}</p>
      <DeploymentFields
        value={entry}
        onChange={(patch) => setEntry((prev) => ({ ...prev, ...patch }))}
        errors={errors}
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleSave} disabled={disabled}>
          {saveLabel}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.preventDefault()
            resetForm()
          }}
          disabled={disabled}
        >
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-2 sm:col-span-2">
      {deployments.length === 0 && !formOpen && (
        <p className="text-sm text-text-tertiary">No deployments added yet.</p>
      )}

      {deployments.length > 0 && (
        <ul className="divide-y divide-border/40 rounded-md border border-border">
          {deployments.map((dep, index) => (
            <li key={index}>
              {editingIndex === index ? (
                form('Edit Deployment', 'Save')
              ) : (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm text-text-primary truncate">{dep.name}</span>
                    <span className="text-xs text-text-tertiary">{providerLabel(dep.provider)}</span>
                    <span className="hidden min-w-0 truncate text-xs text-text-tertiary sm:inline">
                      {dep.baseUrl}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      size="sm"
                      aria-label="Edit deployment"
                      icon={<Pencil />}
                      onClick={() => handleEdit(index)}
                      disabled={disabled}
                    />
                    <IconButton
                      size="sm"
                      variant="destructive"
                      aria-label="Remove deployment"
                      icon={<Trash2 />}
                      onClick={() => handleRemove(index)}
                      disabled={disabled}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}

      {showNewForm && form('New Deployment', 'Add')}

      {!formOpen && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={(e) => {
            e.preventDefault()
            setShowNewForm(true)
          }}
          disabled={disabled}
        >
          Add deployment
        </Button>
      )}
    </div>
  )
}
