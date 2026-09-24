import { Button } from '../ui/Button'
import { Download } from '../ui/icons'
import { exportData } from '../../lib/export'

export interface ExportButtonsProps {
  data: readonly object[]
  headers: { key: string; label: string }[]
  filenamePrefix: string
  /** What is being exported, for accessible names (e.g. "usage"). */
  subject?: string
}

/** CSV + JSON download buttons for a table's rows. Disabled when there is nothing to export. */
export function ExportButtons({ data, headers, filenamePrefix, subject = 'data' }: ExportButtonsProps) {
  const disabled = data.length === 0
  const rows = data as unknown as Record<string, unknown>[]
  return (
    <div className="flex items-center gap-2">
      {(['csv', 'json'] as const).map((format) => (
        <Button
          key={format}
          variant="secondary"
          size="sm"
          icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          aria-label={`Export ${subject} as ${format.toUpperCase()}`}
          disabled={disabled}
          onClick={() => exportData(rows, headers, filenamePrefix, format)}
        >
          {format.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}
