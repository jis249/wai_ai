/** Human-readable text for an unknown thrown value (Error, string, or anything else). */
export function errorMessage(error: unknown, fallback = 'An unexpected error occurred.'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}
