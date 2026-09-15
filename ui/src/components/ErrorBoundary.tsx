import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('WAI UI error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-bg-primary">
          <div className="max-w-md rounded-xl border border-border bg-bg-secondary p-8 space-y-3">
            <h1 className="text-lg font-semibold text-text-primary">Something went wrong</h1>
            <p className="text-sm text-text-secondary">Reload the page. If this keeps happening, check the backend log in data/wai-backend.err.log.</p>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md border border-border text-sm"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
