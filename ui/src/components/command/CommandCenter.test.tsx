import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../layout/Shell'
import { ThemeProvider } from '../../hooks/useTheme'
import { RECENT_PAGES_KEY } from './recentPages'

vi.mock('../../api/client', () => ({ default: vi.fn().mockResolvedValue(undefined) }))

let role = 'org_admin'
vi.mock('../../hooks/useMe', () => ({
  useMe: () => ({ data: { id: 'u1', email: 'ada@example.com', display_name: 'Ada', role, is_system_admin: role === 'system_admin' } }),
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  role = 'org_admin'
  localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  document.body.style.overflow = ''
})

function LocationProbe() {
  const loc = useLocation()
  return <p data-testid="location">{loc.pathname + loc.search}</p>
}

function renderApp(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Shell />}>
              <Route
                path="*"
                element={
                  <>
                    <LocationProbe />
                    <input type="search" aria-label="Generic search" />
                    <input data-page-search aria-label="Page search" />
                  </>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const location = () => screen.getByTestId('location').textContent

describe('command palette', () => {
  it('opens on Ctrl+K, filters, and navigates on Enter', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    const input = within(dialog).getByRole('combobox')
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'models')
    const options = within(dialog).getAllByRole('option')
    expect(options[0]).toHaveTextContent('Models')
    expect(within(dialog).queryByRole('option', { name: /Playground/ })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(location()).toBe('/models')
  })

  it('opens from the sidebar search button and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderApp()
    const [button] = screen.getAllByRole('button', { name: /Search…/ })
    await user.click(button)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('hides system items from members and shows them to system admins', async () => {
    const user = userEvent.setup()
    role = 'member'
    const { unmount } = renderApp()
    await user.keyboard('{Control>}k{/Control}')
    let dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    for (const name of [/Organizations/, /Platform/, /Add model/, /Invite member/, /Audit log/]) {
      expect(within(dialog).queryByRole('option', { name })).not.toBeInTheDocument()
    }
    expect(within(dialog).getByRole('option', { name: /Create API key/ })).toBeInTheDocument()
    unmount()

    role = 'system_admin'
    renderApp()
    await user.keyboard('{Control>}k{/Control}')
    dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    for (const name of [/Organizations/, /Platform setup/, /Add model/, /Invite member/]) {
      expect(within(dialog).getByRole('option', { name })).toBeInTheDocument()
    }
  })

  it('runs deep-link actions', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    await user.click(within(dialog).getByRole('option', { name: /Create API key/ }))
    expect(location()).toBe('/keys?new=1')
  })

  it('offers to open a request when the query is a uuid', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    const id = '3f2b8c1e-9a4d-4c2b-8e7f-1a2b3c4d5e6f'
    await user.type(within(dialog).getByRole('combobox'), id)
    const option = within(dialog).getByRole('option', { name: new RegExp(`Open request ${id}`) })
    await user.click(option)
    expect(location()).toBe(`/usage/logs?request=${id}`)
  })

  it('lists recently visited pages, excluding the current one', async () => {
    const user = userEvent.setup()
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(['/models', '/keys', '/not-a-page']))
    renderApp('/')
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    const recent = within(dialog).getByRole('group', { name: 'Recent' })
    const labels = within(recent).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['Models', 'API access'])
    expect(JSON.parse(localStorage.getItem(RECENT_PAGES_KEY)!)).toEqual(['/', '/models', '/keys', '/not-a-page'])
  })

  it('shows shortcut hints on items', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    const models = within(dialog).getByRole('option', { name: /^Models/ })
    expect(within(models).getAllByText((_, el) => el?.tagName === 'KBD').map((k) => k.textContent)).toEqual(['g', 'm'])
  })
})

describe('global shortcuts', () => {
  it('navigates with g sequences but not while typing', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await user.keyboard('gm')
    expect(location()).toBe('/models')
    await user.keyboard('gl')
    expect(location()).toBe('/usage/logs')
    await user.keyboard('gs')
    expect(location()).toBe('/org/settings')

    await user.click(screen.getByRole('textbox', { name: 'Page search' }))
    await user.keyboard('gd')
    expect(location()).toBe('/org/settings')
  })

  it('"/" focuses the [data-page-search] field first', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.keyboard('/')
    expect(screen.getByRole('textbox', { name: 'Page search' })).toHaveFocus()
  })

  it('"?" opens the shortcuts help dialog with grouped keys', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.keyboard('?')
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(help).getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(within(help).getByRole('heading', { name: 'Navigation' })).toBeInTheDocument()
    expect(within(help).getByText('Go to request logs')).toBeInTheDocument()
    expect(within(help).getAllByText('Ctrl').length).toBeGreaterThan(0)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
  })
})
