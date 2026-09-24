import React, { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useCreateTeam } from '../../hooks/useTeams'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { deriveSlug } from '../../lib/slug'
import { NameSlugFields } from '../settings/NameSlugFields'
import { validateNameSlug, type NameSlugErrors } from '../settings/nameSlug'

export interface CreateTeamDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
}

/** Create a team in an org; slug auto-derives from the name until edited. */
export function CreateTeamDialog({ open, onClose, orgId }: CreateTeamDialogProps) {
  const [values, setValues] = useState({ name: '', slug: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<NameSlugErrors>({})

  const createTeam = useCreateTeam(orgId)
  const { toast } = useToast()

  function handleChange(next: { name: string; slug: string }) {
    if (next.slug !== values.slug) {
      setSlugTouched(true)
      setValues(next)
    } else {
      setValues({ name: next.name, slug: slugTouched ? next.slug : deriveSlug(next.name) })
    }
  }

  function handleClose() {
    setValues({ name: '', slug: '' })
    setSlugTouched(false)
    setErrors({})
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateNameSlug(values)
    setErrors(errs)
    if (errs.name || errs.slug) return
    createTeam.mutate(
      { name: values.name.trim(), slug: values.slug.trim() },
      {
        onSuccess: () => {
          toast({ variant: 'success', message: 'Team created' })
          handleClose()
        },
        onError: (err) => toast({ variant: 'error', message: errorMessage(err, 'Failed to create team') }),
      },
    )
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Create team">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <NameSlugFields
          values={values}
          errors={errors}
          onChange={handleChange}
          disabled={createTeam.isPending}
          namePlaceholder="e.g. Backend Engineering"
          slugPlaceholder="e.g. backend-engineering"
        />
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} disabled={createTeam.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createTeam.isPending}>
            Create team
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
