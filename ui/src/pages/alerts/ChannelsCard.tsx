import { useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Toggle } from '../../components/ui/Toggle'
import { EmptyState } from '../../components/ui/EmptyState'
import { QueryState } from '../../components/ui/QueryState'
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog'
import { CopyButton } from '../../components/ui/CopyButton'
import { Bell, Pencil, Plus, Send, Trash2 } from '../../components/ui/icons'
import {
  useAlertChannels,
  useDeleteAlertChannel,
  useTestAlertChannel,
  useUpdateAlertChannel,
} from '../../hooks/useAlerts'
import type { AlertChannel, AlertScope } from '../../hooks/useAlerts'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { CHANNEL_KIND_LABEL } from './alertMeta'
import { ChannelSheet } from './ChannelSheet'

export function ChannelsCard({ scope }: { scope: AlertScope }) {
  const query = useAlertChannels(scope)
  const update = useUpdateAlertChannel(scope)
  const remove = useDeleteAlertChannel(scope)
  const test = useTestAlertChannel(scope)
  const { toast } = useToast()
  const [editing, setEditing] = useState<AlertChannel | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AlertChannel | null>(null)
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  function toggle(ch: AlertChannel, enabled: boolean) {
    update.mutate(
      { id: ch.id, params: { enabled } },
      {
        onSuccess: () => toast({ variant: 'success', message: `${ch.name} ${enabled ? 'enabled' : 'disabled'}` }),
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to update channel') }),
      },
    )
  }

  function runTest(ch: AlertChannel) {
    setTestingId(ch.id)
    test.mutate(ch.id, {
      onSuccess: (res) =>
        toast(
          res.ok
            ? { variant: 'success', message: `Test alert delivered to ${ch.name}` }
            : { variant: 'error', message: `Test to ${ch.name} failed: ${res.error || `HTTP ${res.status}`}` },
        ),
      onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to send test alert') }),
      onSettled: () => setTestingId(null),
    })
  }

  function confirmDelete() {
    if (!deleting) return
    const ch = deleting
    remove.mutate(ch.id, {
      onSuccess: () => {
        toast({ variant: 'success', message: `Channel "${ch.name}" deleted` })
        setDeleting(null)
      },
      onError: (err) => {
        toast({ variant: 'error', message: errorMessage(err, 'Failed to delete channel') })
        setDeleting(null)
      },
    })
  }

  const addButton = (
    <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>
      Add channel
    </Button>
  )

  return (
    <Card as="section" aria-labelledby="alert-channels-heading">
      <CardHeader
        title={<span id="alert-channels-heading">Channels</span>}
        description="Microsoft Teams, Slack or signed webhooks that receive alerts."
        actions={addButton}
        className="flex-wrap"
      />
      <QueryState
        query={query}
        errorTitle="Couldn't load channels"
        empty={
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="No channels yet"
            description="Add a Teams, Slack or webhook channel to start receiving alerts. Alerts are still recorded below without one."
            action={{ label: 'Add channel', onClick: () => setEditing('new') }}
          />
        }
      >
        {(data) => (
          <ul className="divide-y divide-border" aria-label="Alert channels">
            {data.data.map((ch) => (
              <li key={ch.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-text-primary">{ch.name}</span>
                    <Badge variant="default">{CHANNEL_KIND_LABEL[ch.kind] ?? ch.kind}</Badge>
                    {!ch.enabled && <Badge variant="muted">Disabled</Badge>}
                    {ch.kind === 'webhook' && ch.has_secret && <Badge variant="info">Signed</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-text-tertiary" title={ch.url_hint}>
                    {ch.url_hint || 'URL hidden'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle
                    checked={ch.enabled}
                    onChange={(v) => toggle(ch, v)}
                    aria-label={`${ch.enabled ? 'Disable' : 'Enable'} ${ch.name}`}
                    disabled={update.isPending}
                    size="sm"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => runTest(ch)}
                    loading={testingId === ch.id}
                    disabled={testingId !== null && testingId !== ch.id}
                    aria-label={`Send test alert to ${ch.name}`}
                  >
                    Test
                  </Button>
                  <IconButton size="sm" icon={<Pencil />} aria-label={`Edit ${ch.name}`} onClick={() => setEditing(ch)} />
                  <IconButton
                    size="sm"
                    variant="destructive"
                    icon={<Trash2 />}
                    aria-label={`Delete ${ch.name}`}
                    onClick={() => setDeleting(ch)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      {editing && (
        <ChannelSheet
          key={editing === 'new' ? 'new' : editing.id}
          scope={scope}
          channel={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSecret={(name, s) => setSecret({ name, secret: s })}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="Delete channel"
        description={
          deleting
            ? `Delete "${deleting.name}"? Rules that target it will stop sending to it. This cannot be undone.`
            : ''
        }
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />

      <Dialog
        open={secret != null}
        onClose={() => setSecret(null)}
        title="Webhook signing secret"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setSecret(null)}>Done</Button>
          </div>
        }
      >
        {secret && (
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              Verify each request to <span className="font-medium text-text-primary">{secret.name}</span> by computing
              HMAC-SHA256 of the raw body with this secret and comparing it with the <code>X-WAI-Signature</code>{' '}
              header (<code>sha256=&lt;hex&gt;</code>). It is shown only once.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-md bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-primary">
                {secret.secret}
              </code>
              <CopyButton text={secret.secret} label="Copy secret" className="shrink-0 self-start sm:self-auto" />
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  )
}
