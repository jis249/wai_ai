export interface NameSlugValues {
  name: string
  slug: string
}

export interface NameSlugErrors {
  name?: string
  slug?: string
}

/** Required name + slug. Returns an empty object when valid. */
export function validateNameSlug(values: NameSlugValues): NameSlugErrors {
  const errors: NameSlugErrors = {}
  if (!values.name.trim()) errors.name = 'Name is required'
  if (!values.slug.trim()) errors.slug = 'Slug is required'
  return errors
}

