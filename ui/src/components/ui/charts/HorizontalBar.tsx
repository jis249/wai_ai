import { Link } from 'react-router-dom'
import { CHART_CHROME } from '../../../lib/chartColors'

export interface HorizontalBarItem {
  label: string
  value: number
  detail?: string
  /** Optional drill-down link; the whole row becomes a keyboard-accessible link (needs a Router). */
  href?: string
  /** Accessible suffix for the link, e.g. "view request logs". */
  linkLabel?: string
}

export interface HorizontalBarProps {
  items: HorizontalBarItem[]
  maxValue?: number
  color?: string
}

export function HorizontalBar({ items, maxValue, color }: HorizontalBarProps) {
  const max = maxValue ?? Math.max(...items.map((i) => i.value), 1)

  return (
    <div className="space-y-5">
      {items.map((item, idx) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0
        const opacity = Math.max(1 - idx * 0.2, 0.2)

        const barStyle: React.CSSProperties = color
          ? { width: `${pct}%`, background: color, opacity }
          : {
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--chart-5), var(--chart-1))',
              opacity,
            }

        const content = (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-text-secondary truncate mr-2">{item.label}</span>
              {item.detail != null && (
                <span className="text-xs text-text-tertiary shrink-0 tabular-nums">{item.detail}</span>
              )}
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: CHART_CHROME.track }}>
              <div className="h-full rounded-full transition-all duration-500" style={barStyle} />
            </div>
            {item.href != null && item.linkLabel != null && <span className="sr-only">, {item.linkLabel}</span>}
          </>
        )

        if (item.href != null) {
          return (
            <Link
              key={item.label}
              to={item.href}
              className="-mx-2 block rounded-lg px-2 py-1 no-underline transition-colors hover:bg-bg-tertiary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {content}
            </Link>
          )
        }

        return <div key={item.label}>{content}</div>
      })}
    </div>
  )
}
