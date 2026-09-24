import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { ChevronDown, Layers, Plus, Settings, Trash2 } from '../../components/ui/icons'
import { useToast } from '../../hooks/useToast'
import { deletePreset, loadPresets, savePreset } from './presets'
import type { PlaygroundPreset, PresetSettings } from './presets'

interface PresetsMenuProps {
  /** Current settings, captured when saving. */
  current: PresetSettings
  onLoad: (preset: PlaygroundPreset) => void
  disabled?: boolean
}

/** Header menu: load a saved preset, save the current settings, manage (delete) presets. */
export function PresetsMenu({ current, onLoad, disabled = false }: PresetsMenuProps) {
  const [presets, setPresets] = useState<PlaygroundPreset[]>(() => loadPresets())
  const [dialog, setDialog] = useState<'save' | 'manage' | null>(null)
  const [name, setName] = useState('')
  const { toast } = useToast()

  function openSave() {
    setName('')
    setDialog('save')
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    const overwrite = presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    const next = savePreset(trimmed, current)
    if (!next) {
      toast({ message: 'Could not save the preset: browser storage is unavailable', variant: 'error' })
      return
    }
    setPresets(next)
    setDialog(null)
    toast({ message: overwrite ? `Preset "${trimmed}" updated` : `Preset "${trimmed}" saved`, variant: 'success' })
  }

  function handleDelete(preset: PlaygroundPreset) {
    const next = deletePreset(preset.id)
    if (!next) {
      toast({ message: 'Could not delete the preset: browser storage is unavailable', variant: 'error' })
      return
    }
    setPresets(next)
    toast({ message: `Preset "${preset.name}" deleted`, variant: 'success' })
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && setPresets(loadPresets())}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" icon={<Layers className="h-4 w-4" aria-hidden="true" />} disabled={disabled}>
            Presets
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>Load preset</DropdownMenuLabel>
          {presets.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs text-text-tertiary">No saved presets yet</p>
          ) : (
            presets.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => onLoad(p)}>
                {p.name}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Plus />} onSelect={openSave}>
            Save current as preset…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Settings />} onSelect={() => setDialog('manage')} disabled={presets.length === 0}>
            Manage presets…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog === 'save'}
        onClose={() => setDialog(null)}
        title="Save preset"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
          className="space-y-2"
        >
          <Input
            label="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
            placeholder="e.g. JSON extractor"
            description="Saves the model, system prompt, parameters and response format in this browser. API keys are never saved."
          />
          {presets.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()) && (
            <p className="text-xs text-warning">A preset with this name exists and will be overwritten.</p>
          )}
        </form>
      </Dialog>

      <Dialog open={dialog === 'manage'} onClose={() => setDialog(null)} title="Manage presets">
        {presets.length === 0 ? (
          <p className="text-sm text-text-tertiary">No saved presets.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Saved presets">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-primary">{p.name}</p>
                  <p className="truncate font-mono text-xs text-text-tertiary">
                    {p.model || 'any model'} · temp {p.temperature.toFixed(1)} · {p.responseFormat.type}
                  </p>
                </div>
                <IconButton
                  variant="destructive"
                  icon={<Trash2 />}
                  aria-label={`Delete preset ${p.name}`}
                  onClick={() => handleDelete(p)}
                />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  )
}
