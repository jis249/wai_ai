import React, { useId, useState } from 'react'
import { X } from '../../components/ui/icons'
import { cn } from '../../lib/utils'
import { normalizeAliases, splitAliasText } from './modelHelpers'

export interface AliasInputProps {
  label?: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  description?: string
  disabled?: boolean
  className?: string
}

/**
 * Tag input for model aliases. Type and press Enter or comma to add a chip;
 * Backspace on an empty input removes the last chip; each chip has a remove
 * button. Pasting "a, b, c" adds all three. Pending text is committed on blur
 * so a typed-but-not-entered alias is not lost when the form is submitted.
 */
export function AliasInput({
  label = 'Aliases',
  value,
  onChange,
  placeholder = 'Type an alias and press Enter',
  description,
  disabled = false,
  className,
}: AliasInputProps) {
  const id = useId()
  const descId = `${id}-desc`
  const [draft, setDraft] = useState('')

  function commit(text: string) {
    const tokens = splitAliasText(text)
    if (tokens.length > 0) onChange(normalizeAliases([...value, ...tokens]))
    setDraft('')
  }

  function remove(alias: string) {
    onChange(value.filter((a) => a !== alias))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    if (text.includes(',')) {
      // Commit everything before the last comma; keep the remainder as draft.
      const parts = text.split(',')
      const rest = parts.pop() ?? ''
      const tokens = parts.flatMap(splitAliasText)
      if (tokens.length > 0) onChange(normalizeAliases([...value, ...tokens]))
      setDraft(rest.trimStart())
    } else {
      setDraft(text)
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-text-secondary mb-1.5">
        {label}
      </label>
      <div
        className={cn(
          'flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-secondary px-2 py-1.5',
          'transition-colors duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40',
          disabled && 'opacity-50 cursor-not-allowed bg-bg-tertiary',
        )}
      >
        <ul className="contents" aria-label={`${label} list`}>
          {value.map((alias) => (
            <li
              key={alias}
              className="inline-flex max-w-full items-center gap-1 rounded bg-bg-tertiary py-0.5 pl-2 pr-1 font-mono text-xs text-text-secondary"
            >
              <span className="truncate">{alias}</span>
              <button
                type="button"
                onClick={() => remove(alias)}
                disabled={disabled}
                aria-label={`Remove alias ${alias}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded text-text-tertiary hover:bg-bg-primary hover:text-text-primary cursor-pointer disabled:cursor-not-allowed"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          type="text"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-describedby={description != null ? descId : undefined}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      {description != null && (
        <p id={descId} className="mt-1.5 text-xs text-text-tertiary">
          {description}
        </p>
      )}
    </div>
  )
}
