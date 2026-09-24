import { useEffect, useId, type RefObject } from 'react'

export const APP_TITLE = 'WAI'

/** "<Page> · WAI" (or just "WAI" for an empty page title). */
export function formatDocumentTitle(title: string | null | undefined): string {
  const t = title?.trim()
  return t ? `${t} · ${APP_TITLE}` : APP_TITLE
}

interface TitleEntry {
  title: string
  anchor?: RefObject<Element | null>
  order: number
}

// All mounted title claims. Winner: most recent explicit (anchor-less) claim; otherwise
// the anchored claim latest in document order — so a page's own header beats its
// layout's header regardless of effect ordering (children's effects run first).
const entries = new Map<string, TitleEntry>()
let baseTitle: string | null = null
let counter = 0

function applyTitle() {
  if (entries.size === 0) {
    if (baseTitle != null) document.title = baseTitle
    baseTitle = null
    return
  }
  let winner: TitleEntry | null = null
  for (const e of entries.values()) {
    if (!e.anchor) {
      if (winner == null || winner.anchor || e.order > winner.order) winner = e
      continue
    }
    if (winner != null && !winner.anchor) continue
    const node = e.anchor.current
    const winnerNode = winner?.anchor?.current
    if (winner == null || !winnerNode) {
      winner = e
    } else if (node && winnerNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      winner = e
    }
  }
  if (winner) document.title = formatDocumentTitle(winner.title)
}

/**
 * Sets `document.title` to "<title> · WAI" while mounted; the previous title is
 * restored when no claims remain. Pass null/undefined/'' to make no claim.
 *
 * `anchor` (optional) ties the claim to an element: among anchored claims the one
 * latest in document order wins (PageHeader passes its heading, so nested
 * layout + page headers resolve to the page). Anchor-less claims take precedence.
 */
export function useDocumentTitle(title: string | null | undefined, anchor?: RefObject<Element | null>): void {
  const id = useId()
  useEffect(() => {
    const t = title?.trim()
    if (!t) return
    if (entries.size === 0) baseTitle = document.title
    entries.set(id, { title: t, anchor, order: ++counter })
    applyTitle()
    return () => {
      entries.delete(id)
      applyTitle()
    }
  }, [id, title, anchor])
}
