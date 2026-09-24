import { useId, useState } from 'react'
import { Sheet } from '../../components/ui/Sheet'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Toggle } from '../../components/ui/Toggle'
import { Info } from '../../components/ui/icons'
import { useCreateAlertChannel, useUpdateAlertChannel } from '../../hooks/useAlerts'
import type { AlertChannel, AlertChannelKind, AlertScope } from '../../hooks/useAlerts'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { CHANNEL_KIND_HELP, CHANNEL_KIND_LABEL, CHANNEL_URL_PLACEHOLDER } from './alertMeta'

const KIND_OPTIONS = (Object.keys(CHANNEL_KIND_LABEL) as AlertChannelKind[]).map((k) => ({
  value: k,
  label: k === 'teams' ? 'Teams' : CHANNEL_KIND_LABEL[k],
}))

interface ChannelSheetProps {
  scope: AlertScope
  /** Existing channel to edit; omit to create. */
  channel?: AlertChannel
  onClose: () => void
  /** Called with the webhook signing secret after a webhook channel is created. */
  onSecret?: (channelName: string, secret: string) => void
}

export function ChannelSheet({ scope, channel, onClose, onSecret }: ChannelSheetProps) {
  const editing = channel != null
  const [kind, setKind] = useState<AlertChannelKind>(channel?.kind ?? 'teams')
  const [name, setName] = useState(channel?.name ?? '')
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({})
  const create = useCreateAlertChannel(scope)
  const update = useUpdateAlertChannel(scope)
  const { toast } = useToast()
  const pending = create.isPending || update.isPending
  const kindLabelId = useId()

  function validate() {
    const next: { name?: string; url?: string } = {}
    if (!name.trim()) next.name = 'Name is required'
    const u = url.trim()
    if (!editing && !u) next.url = 'URL is required'
    else if (u && !/^https:\/\/[^\s/]+/i.test(u)) next.url = 'URL must start with https://'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    const onError = (err: unknown) => toast({ variant: 'error', message: errorMessage(err, 'Failed to save channel') })
    if (editing && channel) {
      const params: { name?: string; url?: string; enabled?: boolean } = {}
      if (name.trim() !== channel.name) params.name = name.trim()
      if (url.trim()) params.url = url.trim()
      if (enabled !== channel.enabled) params.enabled = enabled
      if (Object.keys(params).length === 0) {
        onClose()
        return
      }
      update.mutate(
        { id: channel.id, params },
        {
          onSuccess: () => {
            toast({ variant: 'success', message: 'Channel updated' })
            onClose()
          },
          onError,
        },
      )
      return
    }
    create.mutate(
      { name: name.trim(), kind, url: url.trim(), enabled },
      {
        onSuccess: (created) => {
          toast({ variant: 'success', message: `Channel "${created.name}" added` })
          if (created.signing_secret) onSecret?.(created.name, created.signing_secret)
          onClose()
        },
        onError,
      },
    )
  }

  const formId = editing ? 'edit-alert-channel-form' : 'create-alert-channel-form'

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Edit channel' : 'Add channel'}
      description={editing ? CHANNEL_KIND_LABEL[channel.kind] : 'Where alerts for this scope are delivered.'}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {editing ? 'Save changes' : 'Add channel'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <p id={kindLabelId} className="mb-1.5 block text-sm font-medium text-text-secondary">
            Type
          </p>
          <SegmentedControl
            aria-labelledby={kindLabelId}
            options={KIND_OPTIONS.map((o) => ({ ...o, disabled: editing && o.value !== kind }))}
            value={kind}
            onChange={(v) => !editing && setKind(v)}
            fullWidth
          />
          <p className="mt-2 flex items-start gap-2 text-xs text-text-secondary">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            <span>{CHANNEL_KIND_HELP[kind]}</span>
          </p>
        </div>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ops on-call"
          maxLength={100}
          error={errors.name}
          disabled={pending}
        />
        <Input
          label={editing ? 'New URL (optional)' : 'URL'}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={CHANNEL_URL_PLACEHOLDER[kind]}
          description={
            editing
              ? `Current: ${channel.url_hint || 'hidden'}. The URL is stored encrypted and never shown again; leave blank to keep it.`
              : 'Stored encrypted. It is never shown again after saving; only the host is displayed.'
          }
          error={errors.url}
          disabled={pending}
        />
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" aria-label="Enabled" disabled={pending} />
      </form>
    </Sheet>
  )
}
