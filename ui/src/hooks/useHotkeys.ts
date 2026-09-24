import { useEffect, useRef } from 'react'

/**
 * Keyboard shortcut hook.
 *
 * Key syntax: a combo is `+`-joined modifiers and a key (`mod+k`, `shift+?`, `escape`);
 * a sequence is space-separated combos (`g d`). `mod` is ⌘ on macOS and Ctrl elsewhere.
 * Shift is implied for single printable characters, so `?` matches Shift+/.
 *
 * Events from inputs, textareas, selects and contenteditable elements are ignored,
 * except for bindings with `allowInInputs` (defaults to true for `mod+k` and `escape`).
 * Bindings that are not allowed in inputs are also skipped while a modal dialog
 * (`[aria-modal="true"]`) is open, so page shortcuts don't fire behind a dialog.
 */
export interface Hotkey {
  keys: string
  handler: (event: KeyboardEvent) => void
  allowInInputs?: boolean
  /** Call preventDefault when the binding fires (default true). */
  preventDefault?: boolean
}

export interface UseHotkeysOptions {
  enabled?: boolean
  /** Element to listen on (default: document). */
  target?: HTMLElement | Document | null
  /** Max gap between steps of a sequence, in ms (default 1000). */
  sequenceTimeout?: number
}

export const SEQUENCE_TIMEOUT_MS = 1000

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'alt', 'shift', 'os', 'altgraph', 'capslock'])

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  space: ' ',
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  option: 'alt',
}

function normalizeStep(mods: Set<string>, key: string): string {
  const k = key.toLowerCase()
  const m = new Set(mods)
  if (k.length === 1) m.delete('shift')
  return [...['ctrl', 'meta', 'alt', 'shift'].filter((x) => m.has(x)), k].join('+')
}

/** Parse "mod+k" / "g d" into normalized steps. */
export function parseKeys(keys: string, mac = isMac()): string[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((combo) => {
      const parts = combo.split('+').filter(Boolean)
      // "shift++" style: a trailing empty part means the key itself is "+"
      if (combo.endsWith('++') || combo === '+') parts.push('+')
      const key = KEY_ALIASES[parts[parts.length - 1].toLowerCase()] ?? parts[parts.length - 1]
      const mods = new Set<string>()
      for (const raw of parts.slice(0, -1)) {
        const p = KEY_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase()
        mods.add(p === 'mod' ? (mac ? 'meta' : 'ctrl') : p)
      }
      return normalizeStep(mods, key)
    })
}

export function eventToStep(e: KeyboardEvent): string | null {
  if (!e.key || MODIFIER_KEYS.has(e.key.toLowerCase())) return null
  const mods = new Set<string>()
  if (e.ctrlKey) mods.add('ctrl')
  if (e.metaKey) mods.add('meta')
  if (e.altKey) mods.add('alt')
  if (e.shiftKey) mods.add('shift')
  return normalizeStep(mods, e.key)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
  }
  // contenteditable="" on an ancestor (jsdom does not implement isContentEditable)
  return !!target.closest('[contenteditable]:not([contenteditable="false"])')
}

function defaultAllowInInputs(steps: string[]): boolean {
  return steps.length === 1 && (steps[0] === 'escape' || steps[0] === 'ctrl+k' || steps[0] === 'meta+k')
}

function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null
}

export function useHotkeys(hotkeys: Hotkey[], options: UseHotkeysOptions = {}) {
  const { enabled = true, target, sequenceTimeout = SEQUENCE_TIMEOUT_MS } = options
  const hotkeysRef = useRef(hotkeys)
  useEffect(() => {
    hotkeysRef.current = hotkeys
  })

  useEffect(() => {
    if (!enabled) return
    const el: HTMLElement | Document | null = target === undefined ? document : target
    if (!el) return
    const mac = isMac()
    let pending: string[] = []
    let lastAt = 0

    const onKeyDown = (evt: Event) => {
      const e = evt as KeyboardEvent
      if (e.defaultPrevented || e.isComposing) return
      const step = eventToStep(e)
      if (!step) return

      const editable = isEditableTarget(e.target)
      const inModal = modalOpen()
      const candidates = hotkeysRef.current
        .map((h) => {
          const steps = parseKeys(h.keys, mac)
          return { h, steps, allow: h.allowInInputs ?? defaultAllowInInputs(steps) }
        })
        .filter((c) => c.allow || (!editable && !inModal))

      const now = Date.now()
      if (pending.length && now - lastAt > sequenceTimeout) pending = []

      const tryMatch = (seq: string[]) => {
        const exact = candidates.find((c) => c.steps.length === seq.length && c.steps.every((s, i) => s === seq[i]))
        if (exact) return { exact }
        const prefix = candidates.some(
          (c) => c.steps.length > seq.length && seq.every((s, i) => c.steps[i] === s),
        )
        return { prefix }
      }

      let seq = [...pending, step]
      let result = tryMatch(seq)
      if (!result.exact && !result.prefix && pending.length) {
        seq = [step]
        result = tryMatch(seq)
      }

      if (result.exact) {
        pending = []
        if (result.exact.h.preventDefault !== false) e.preventDefault()
        result.exact.h.handler(e)
      } else if (result.prefix) {
        pending = seq
        lastAt = now
      } else {
        pending = []
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [enabled, target, sequenceTimeout])
}

/** Human-readable label for one combo, e.g. "mod+k" → ["⌘", "K"] on mac, ["Ctrl", "K"] elsewhere. */
export function formatCombo(combo: string, mac = isMac()): string[] {
  const parts = combo.split('+').filter(Boolean)
  return parts.map((part) => {
    const p = part.toLowerCase()
    if (p === 'mod') return mac ? '⌘' : 'Ctrl'
    if (p === 'ctrl') return 'Ctrl'
    if (p === 'meta') return mac ? '⌘' : 'Meta'
    if (p === 'alt') return mac ? '⌥' : 'Alt'
    if (p === 'shift') return mac ? '⇧' : 'Shift'
    if (p === 'escape' || p === 'esc') return 'Esc'
    if (p === 'enter') return 'Enter'
    if (part.length === 1) return parts.length > 1 ? part.toUpperCase() : part
    return part.charAt(0).toUpperCase() + part.slice(1)
  })
}
