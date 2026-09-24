import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryState, type QueryLike } from './QueryState'

function makeQuery<T>(overrides: Partial<QueryLike<T>> = {}): QueryLike<T> {
  return {
    data: undefined,
    error: null,
    isPending: false,
    isError: false,
    isFetching: false,
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...overrides,
  }
}

describe('QueryState', () => {
  describe('Loading', () => {
    it('renders the custom loading node while pending', () => {
      render(
        <QueryState query={makeQuery<string[]>({ isPending: true, fetchStatus: 'fetching' })} loading={<p>Loading rows</p>}>
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByText('Loading rows')).toBeInTheDocument()
      expect(screen.queryByText('data')).not.toBeInTheDocument()
    })

    it('renders a default skeleton when no loading node is given', () => {
      const { container } = render(
        <QueryState query={makeQuery<string[]>({ isPending: true, fetchStatus: 'fetching' })}>
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(container.querySelector('.animate-pulse')).not.toBeNull()
    })

    it('a disabled query (pending + idle) renders the empty node, not loading', () => {
      render(
        <QueryState
          query={makeQuery<string[]>({ isPending: true, fetchStatus: 'idle' })}
          loading={<p>Loading rows</p>}
          empty={<p>Nothing</p>}
        >
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByText('Nothing')).toBeInTheDocument()
      expect(screen.queryByText('Loading rows')).not.toBeInTheDocument()
    })
  })

  describe('Error', () => {
    it('renders the error message with a Retry button that calls refetch', async () => {
      const refetch = vi.fn()
      render(
        <QueryState query={makeQuery<string[]>({ isError: true, error: new Error('Backend down'), refetch })}>
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Backend down')
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(refetch).toHaveBeenCalledOnce()
    })

    it('uses the custom error renderer when provided', async () => {
      const refetch = vi.fn()
      render(
        <QueryState
          query={makeQuery<string[]>({ isError: true, error: new Error('nope'), refetch })}
          error={(err, retry) => <button onClick={retry}>Custom: {(err as Error).message}</button>}
        >
          {() => <p>data</p>}
        </QueryState>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Custom: nope' }))
      expect(refetch).toHaveBeenCalledOnce()
    })

    it('keeps showing previous data when a background refetch fails', () => {
      render(
        <QueryState query={makeQuery<string[]>({ data: ['a'], isError: true, error: new Error('x') })}>
          {(d) => <p>{d.length} items</p>}
        </QueryState>,
      )
      expect(screen.getByText('1 items')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('Empty', () => {
    it('renders empty for an empty array by default', () => {
      render(
        <QueryState query={makeQuery<string[]>({ data: [] })} empty={<p>No rows</p>}>
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByText('No rows')).toBeInTheDocument()
    })

    it('renders empty for a paginated { data: [] } response by default', () => {
      render(
        <QueryState query={makeQuery<{ data: string[] }>({ data: { data: [] } })} empty={<p>No rows</p>}>
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByText('No rows')).toBeInTheDocument()
    })

    it('respects a custom isEmpty', () => {
      render(
        <QueryState
          query={makeQuery<{ total: number }>({ data: { total: 0 } })}
          isEmpty={(d) => d.total === 0}
          empty={<p>Zero</p>}
        >
          {() => <p>data</p>}
        </QueryState>,
      )
      expect(screen.getByText('Zero')).toBeInTheDocument()
    })
  })

  describe('Success', () => {
    it('passes data to the render function', () => {
      render(
        <QueryState query={makeQuery<string[]>({ data: ['alpha', 'beta'] })}>
          {(d) => (
            <ul>
              {d.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </QueryState>,
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    })

    it('treats non-empty objects as data', () => {
      render(
        <QueryState query={makeQuery<{ name: string }>({ data: { name: 'WAI' } })}>
          {(d) => <p>{d.name}</p>}
        </QueryState>,
      )
      expect(screen.getByText('WAI')).toBeInTheDocument()
    })
  })
})
