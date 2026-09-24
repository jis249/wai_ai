import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'

export interface Tab {
  label: string
  path: string
  end?: boolean
}

export interface TabsProps {
  tabs: Tab[]
}

/** Horizontally scrolls `container` so its `selector` child is visible (no page scroll). */
function revealActive(container: HTMLElement | null, selector: string) {
  if (!container || container.scrollWidth <= container.clientWidth) return
  const active = container.querySelector<HTMLElement>(selector)
  if (!active) return
  const left = active.offsetLeft
  const right = left + active.offsetWidth
  if (left < container.scrollLeft) container.scrollLeft = left
  else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth
}

export function Tabs({ tabs }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    revealActive(listRef.current, '[aria-current="page"]')
  }, [pathname])

  return (
    <div
      ref={listRef}
      className="relative inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-bg-tertiary p-1 mb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.end ?? true}
          className={({ isActive }) =>
            cn(
              'shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 no-underline',
              isActive
                ? 'bg-bg-secondary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary'
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
