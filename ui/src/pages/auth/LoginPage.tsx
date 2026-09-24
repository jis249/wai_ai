import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { LogIn, ShieldCheck } from '../../components/ui/icons'
import { PasswordInput } from '../../components/settings/PasswordInput'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { LOCAL_STORAGE_KEY } from '../../lib/constants'
import type { MeResponse } from '../../hooks/useMe'

interface AuthProviders {
  local: boolean
  oidc: boolean
}

const SSO_ERROR_MESSAGES: Record<string, string> = {
  not_provisioned: 'Your account has not been provisioned. Please contact your administrator.',
  domain_not_allowed: 'Your email domain is not authorized for SSO login.',
  sso_error: 'SSO authentication failed. Please try again.',
  email_not_verified: 'Your SSO email address is not verified. Verify it with your identity provider and try again.',
  provision_no_default_org: 'SSO sign-up is not configured yet. Please contact your administrator.',
}

const SSO_ERROR_FALLBACK = 'Single sign-on did not complete. Please try again or contact your administrator.'

export default function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  useDocumentTitle('Sign in')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<AuthProviders | null>(null)

  // Surface any SSO error from the URL query string (unknown codes get a generic message).
  const ssoErrorParam = searchParams.get('error')
  const ssoError = ssoErrorParam !== null ? (SSO_ERROR_MESSAGES[ssoErrorParam] ?? SSO_ERROR_FALLBACK) : null

  useEffect(() => {
    fetch('/api/v1/auth/providers')
      .then((res) => {
        if (!res.ok) return
        return res.json() as Promise<AuthProviders>
      })
      .then((data) => {
        if (data !== undefined) setProviders(data)
      })
      .catch(() => {
        // Non-critical: if the endpoint fails we simply don't show the SSO button
      })
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: res.statusText } }))
        const err = body as { error?: { message?: string }; detail?: { error?: { message?: string } } }
        setError(err.error?.message ?? err.detail?.error?.message ?? 'Login failed')
        return
      }

      const data = (await res.json()) as { token: string; expires_at: string; user: MeResponse }
      localStorage.setItem(LOCAL_STORAGE_KEY, data.token)
      queryClient.setQueryData(['me'], data.user)
      navigate('/')
    } catch {
      setError('Unable to reach the server. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-bg-primary px-4 py-12">
      <div className="absolute right-4 top-4 w-36 sm:w-44">
        <ThemeToggle compact />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="gradient-text text-3xl font-bold">wai</h1>
          <p className="mt-2 text-sm text-text-tertiary">Sign in to your workspace</p>
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-6 shadow-xl sm:p-8">
          {ssoError !== null && <Banner variant="error" title={ssoError} className="mb-5" />}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />

              <PasswordInput
                label="Password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
              />

              {error !== null && <Banner variant="error" title={error} />}

              <Button type="submit" loading={loading} fullWidth size="lg" icon={<LogIn className="h-4 w-4" />}>
                Sign in
              </Button>
            </form>

          {providers?.oidc === true && (
            <>
                <div className="my-6 flex items-center gap-3" aria-hidden="true">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-text-tertiary">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              <a
                href="/api/v1/auth/oidc/login"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-6 py-3 text-base font-medium text-text-secondary no-underline transition-colors hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Sign in with SSO
              </a>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-text-tertiary">
          First-time install?{' '}
          <Link to="/setup" className="text-accent no-underline hover:underline">
            Open setup checklist
          </Link>
        </p>
      </div>
    </main>
  )
}
