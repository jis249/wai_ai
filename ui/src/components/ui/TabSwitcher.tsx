import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'

export interface Tab {
  key: string
  label: string
}

export interface TabSwitcherProps {
  tabs: Tab[]
  activeKey: string
  onChange: (key: string) => void
  className?: string
}

export default function TabSwitcher({ tabs, activeKey, onChange, className }: TabSwitcherProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the selected tab visible when the strip scrolls horizontally (no page scroll)
  useEffect(() => {
    const container = listRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return
    const active = container.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!active) return
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left < container.scrollLeft) container.scrollLeft = left
    else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth
  }, [activeKey])

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn(
        'relative inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-bg-tertiary p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className ?? 'mb-6',
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === activeKey}
          onClick={() => onChange(tab.key)}
          className={cn(
            'shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-md transition-all duration-200',
            tab.key === activeKey
              ? 'bg-bg-secondary text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
