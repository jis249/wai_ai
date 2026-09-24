import React from 'react'
import { Search, X } from '../ui/icons'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// SearchField: labelled search box with a clear button
// ---------------------------------------------------------------------------

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** Accessible label (also the placeholder unless `placeholder` is set). */
  label: string
  placeholder?: string
  className?: string
}

export function SearchField({ value, onChange, label, placeholder, className }: SearchFieldProps) {
  return (
    <div className={cn('relative w-full min-w-0 sm:w-64', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="block w-full rounded-md border border-border bg-bg-secondary py-2 pl-9 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Toolbar row for list pages: wraps on narrow screens. */
export function ListToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>
}

