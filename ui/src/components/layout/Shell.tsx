import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { SIDEBAR_COLLAPSED_KEY } from '../../lib/constants'

export function Shell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  const width = collapsed ? 72 : 260

  return (
    <div className="min-h-screen bg-bg-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-accent focus:text-white focus:rounded-md focus:m-2"
      >
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main
        id="main-content"
        className="p-8 transition-[margin] duration-200"
        style={{ marginLeft: width, maxWidth: `calc(100% - ${width}px)` }}
      >
        <Outlet />
      </main>
    </div>
  )
}
