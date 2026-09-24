import { useRef } from 'react'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  /**
   * Browser tab title ("<documentTitle> · WAI"). Defaults to `title`;
   * pass `false` to leave document.title unchanged (e.g. nested headers).
   */
  documentTitle?: string | false
}

export function PageHeader({ title, description, actions, documentTitle }: PageHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Anchored to the heading so a page header nested inside a layout header wins
  useDocumentTitle(documentTitle === false ? null : (documentTitle ?? title), headingRef)
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 ref={headingRef} className="text-2xl font-bold text-text-primary break-words">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 sm:justify-end">{actions}</div>}
    </div>
  )
}
