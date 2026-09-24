import React, { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Banner } from '../components/ui/Banner'
import { Card, CardHeader } from '../components/ui/Card'
import { ErrorState } from '../components/ui/ErrorState'
import { SkeletonCard } from '../components/ui/Skeleton'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { KeyRound, Sun, User } from '../components/ui/icons'
import { PasswordInput } from '../components/settings/PasswordInput'
import { RoleBadge } from '../components/members/RoleBadge'
import { useMe } from '../hooks/useMe'
import { useUpdateProfile } from '../hooks/useProfile'
import { useToast } from '../hooks/useToast'
import { errorMessage } from '../lib/errors'

const MIN_PASSWORD_LENGTH = 8

// ---------------------------------------------------------------------------
// EditProfileSection
// ---------------------------------------------------------------------------

function EditProfileSection({ userId, initialDisplayName }: { userId: string; initialDisplayName: string }) {
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [displayNameError, setDisplayNameError] = useState<string | undefined>()
  const updateProfile = useUpdateProfile()
  const { toast } = useToast()

  const isDirty = displayName.trim() !== initialDisplayName

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = displayName.trim()
    if (!trimmed) {
      setDisplayNameError('Display name is required')
      return
    }
    setDisplayNameError(undefined)
    updateProfile.mutate(
      { userId, params: { display_name: trimmed } },
      {
        onSuccess: () => toast({ variant: 'success', message: 'Profile updated' }),
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to update profile') }),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Input
        label="Display name"
        value={displayName}
        onChange={(e) => {
          setDisplayName(e.target.value)
          if (displayNameError) setDisplayNameError(undefined)
        }}
        placeholder="e.g. Jane Smith"
        error={displayNameError}
        disabled={updateProfile.isPending}
        autoComplete="name"
      />
      <div className="flex justify-end">
        <Button type="submit" loading={updateProfile.isPending} disabled={!isDirty}>
          Save
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// ChangePasswordSection
// ---------------------------------------------------------------------------

interface PasswordErrors {
  current?: string
  next?: string
  confirm?: string
}

function validatePasswords(current: string, next: string, confirm: string): PasswordErrors {
  const errors: PasswordErrors = {}
  if (!current) errors.current = 'Current password is required'
  if (!next) errors.next = 'New password is required'
  else if (next.length < MIN_PASSWORD_LENGTH) errors.next = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  else if (next === current) errors.next = 'New password must be different from the current one'
  if (!confirm) errors.confirm = 'Confirm your new password'
  else if (next !== confirm) errors.confirm = 'Passwords do not match'
  return errors
}

function ChangePasswordSection({ userId, email }: { userId: string; email: string }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)

  const updateProfile = useUpdateProfile()
  const { toast } = useToast()

  function clear(field: keyof PasswordErrors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (apiError) setApiError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validatePasswords(currentPassword, newPassword, confirmPassword)
    setErrors(errs)
    setApiError(null)
    if (errs.current || errs.next || errs.confirm) return

    updateProfile.mutate(
      { userId, params: { current_password: currentPassword, new_password: newPassword } },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Password changed' })
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
        },
        onError: (err) => {
          const message = errorMessage(err, 'Failed to change password')
          // Backend: 400 invalid_current_password -> "current password is incorrect"
          if (/current password/i.test(message)) setErrors({ current: 'Current password is incorrect' })
          else setApiError(message)
        },
      },
    )
  }

  const pending = updateProfile.isPending

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Username field lets password managers associate the new password with the account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <PasswordInput
        label="Current password"
        value={currentPassword}
        onChange={(e) => {
          setCurrentPassword(e.target.value)
          clear('current')
        }}
        error={errors.current}
        disabled={pending}
        autoComplete="current-password"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PasswordInput
          label="New password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value)
            clear('next')
          }}
          error={errors.next}
          disabled={pending}
          autoComplete="new-password"
          description={`At least ${MIN_PASSWORD_LENGTH} characters`}
        />
        <PasswordInput
          label="Confirm new password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value)
            clear('confirm')
          }}
          error={errors.confirm}
          disabled={pending}
          autoComplete="new-password"
        />
      </div>
      {apiError !== null && <Banner variant="error" title={apiError} />}
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// ProfilePage
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const { data: me, isPending, isError, error, refetch, isFetching } = useMe()

  return (
    <>
      <PageHeader title="Profile" description="Manage your account settings" />
      <div className="max-w-2xl space-y-6">
        {isPending ? (
          <>
            <SkeletonCard bodyClassName="h-20" />
            <SkeletonCard bodyClassName="h-32" />
          </>
        ) : isError || !me ? (
          <ErrorState variant="card" title="Could not load your profile" error={error} onRetry={() => void refetch()} retrying={isFetching} />
        ) : (
          <>
            <Card>
              <CardHeader title="Account" description="Your sign-in identity and access level." icon={<User className="h-5 w-5" />} />
              <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-text-tertiary">Email</dt>
                  <dd className="mt-1 break-all text-sm text-text-primary">{me.email}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-tertiary">Role</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    <RoleBadge role={me.role} />
                    {me.is_system_admin && me.role !== 'system_admin' && <Badge variant="info">System Admin</Badge>}
                  </dd>
                </div>
              </dl>
              <EditProfileSection userId={me.id} initialDisplayName={me.display_name} />
            </Card>

            <Card>
              <CardHeader
                title="Password"
                description="Enter your current password to set a new one. SSO accounts manage passwords with their identity provider."
                icon={<KeyRound className="h-5 w-5" />}
              />
              <ChangePasswordSection userId={me.id} email={me.email} />
            </Card>

            <Card>
              <CardHeader
                title="Appearance"
                description="Choose light or dark mode. Your preference is saved on this device."
                icon={<Sun className="h-5 w-5" />}
              />
              <ThemeToggle />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
