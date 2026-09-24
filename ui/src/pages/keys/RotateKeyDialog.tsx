import { ConfirmDialog } from '../../components/ui/Dialog'
import type { APIKeyResponse } from '../../hooks/useAPIKeys'

interface RotateKeyDialogProps {
  apiKey: APIKeyResponse | null
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
}

export function RotateKeyDialog({ apiKey, onClose, onConfirm, loading }: RotateKeyDialogProps) {
  return (
    <ConfirmDialog
      open={apiKey !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      title={apiKey ? `Rotate "${apiKey.name}"?` : 'Rotate API Key'}
      description="This will generate a new key and expire the current key after 24 hours. Any application using the current key will need to be updated."
      confirmLabel="Rotate"
      loading={loading}
    />
  )
}
