import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Shell } from './Shell'
import { Sidebar } from './Sidebar'
import { ThemeProvider } from '../../hooks/useTheme'
import { SIDEBAR_COLLAPSED_KEY, LOCAL_STORAGE_KEY } from '../../lib/constants'

const apiClientMock = vi.fn()
vi.mock('../../api/client', () => ({
  default: (...args: unknown[]) => apiClientMock(...args),
}))

vi.mock('../../hooks/useMe', () => ({
  useMe: () => ({
    data: { id: 'u1', email: 'ada@example.com', display_name: 'Ada', role: 'org_admin', is_system_admin: false },
  }),
}))

function renderWithProviders(ui: React.ReactElement, initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

function renderShell(initialPath = '/') {
  return renderWithProviders(
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<p>Dashboard page</p>} />
        <Route path="/models" element={<p>Models page</p>} />
        <Route path="/profile" element={<p>Profile page</p>} />
      </Route>
    </Routes>,
    initialPath,
  )
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  localStorage.clear()
  apiClientMock.mockReset()
})

afterEach(() => {
  document.body.style.overflow = ''
})

describe('Shell mobile navigation drawer', () => {
  it('opens from the hamburger, locks scroll, and closes on Escape', async () => {
    const user = userEvent.setup()
    renderShell()
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).getByRole('link', { name: 'Models' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes via the close button', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('closes on navigation', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    await user.click(within(drawer).getByRole('link', { name: 'Models' }))
    expect(screen.getByText('Models page')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('closes on backdrop click', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.click(screen.getByTestId('mobile-nav-overlay'))
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('marks the active item with aria-current', async () => {
    const user = userEvent.setup()
    renderShell('/models')
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).getByRole('link', { name: 'Models' })).toHaveAttribute('aria-current', 'page')
    expect(within(drawer).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })
})

describe('Shell desktop collapse', () => {
  it('persists the collapsed state in localStorage', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0')
  })

  it('restores the collapsed state on mount', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    renderShell()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })
})

describe('Sidebar collapsed footer', () => {
  function renderCollapsed() {
    return renderWithProviders(<Sidebar collapsed onToggle={() => {}} />)
  }

  it('keeps theme, profile and logout reachable', () => {
    renderCollapsed()
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument()
  })

  it('nav items keep accessible names when collapsed', () => {
    renderCollapsed()
    expect(screen.getByRole('link', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Insights' })).toBeInTheDocument()
  })

  it('theme button toggles the theme', async () => {
    const user = userEvent.setup()
    renderCollapsed()
    const before = document.documentElement.getAttribute('data-theme')
    const btn = screen.getByRole('button', { name: /Switch to (light|dark) theme/ })
    const target = btn.getAttribute('aria-label')!.includes('light') ? 'light' : 'dark'
    await user.click(btn)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe(target))
    expect(target).not.toBe(before)
  })

  it('logout revokes the session then clears storage', async () => {
    const user = userEvent.setup()
    apiClientMock.mockResolvedValue(undefined)
    localStorage.setItem(LOCAL_STORAGE_KEY, 'token')
    const originalLocation = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, href: '/' } })
    try {
      renderCollapsed()
      await user.click(screen.getByRole('button', { name: 'Logout' }))
      await waitFor(() => expect(window.location.href).toBe('/login'))
      expect(apiClientMock).toHaveBeenCalledWith('/auth/logout', { method: 'POST' })
      expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})
