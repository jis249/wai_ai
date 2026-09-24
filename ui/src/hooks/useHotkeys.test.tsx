import { fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCombo, isEditableTarget, parseKeys, useHotkeys, type Hotkey } from './useHotkeys'

function press(key: string, init: KeyboardEventInit = {}, target: Element = document.body) {
  fireEvent.keyDown(target, { key, ...init })
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('parseKeys / formatCombo', () => {
  it('maps mod per platform and implies shift for printable keys', () => {
    expect(parseKeys('mod+k', false)).toEqual(['ctrl+k'])
    expect(parseKeys('mod+k', true)).toEqual(['meta+k'])
    expect(parseKeys('shift+?', false)).toEqual(['?'])
    expect(parseKeys('g d', false)).toEqual(['g', 'd'])
    expect(parseKeys('Esc', false)).toEqual(['escape'])
  })

  it('formats for mac and other platforms', () => {
    expect(formatCombo('mod+k', true)).toEqual(['⌘', 'K'])
    expect(formatCombo('mod+k', false)).toEqual(['Ctrl', 'K'])
    expect(formatCombo('escape', false)).toEqual(['Esc'])
    expect(formatCombo('g', false)).toEqual(['g'])
  })
})

describe('isEditableTarget', () => {
  it('detects inputs, textareas, selects and contenteditable', () => {
    document.body.innerHTML =
      '<input id="t" type="text"/><input id="c" type="checkbox"/><textarea id="ta"></textarea><div contenteditable="true"><span id="ce">x</span></div><button id="b">b</button>'
    expect(isEditableTarget(document.getElementById('t'))).toBe(true)
    expect(isEditableTarget(document.getElementById('c'))).toBe(false)
    expect(isEditableTarget(document.getElementById('ta'))).toBe(true)
    expect(isEditableTarget(document.getElementById('ce'))).toBe(true)
    expect(isEditableTarget(document.getElementById('b'))).toBe(false)
  })
})

describe('useHotkeys', () => {
  function setup(hotkeys: Hotkey[], options?: Parameters<typeof useHotkeys>[1]) {
    return renderHook(({ h }) => useHotkeys(h, options), { initialProps: { h: hotkeys } })
  }

  it('fires single keys and ctrl combos', () => {
    const help = vi.fn()
    const palette = vi.fn()
    setup([
      { keys: '?', handler: help },
      { keys: 'ctrl+k', handler: palette },
    ])
    press('?', { shiftKey: true })
    expect(help).toHaveBeenCalledTimes(1)
    press('k')
    expect(palette).not.toHaveBeenCalled()
    press('k', { ctrlKey: true })
    expect(palette).toHaveBeenCalledTimes(1)
  })

  it('handles sequences and resets after the timeout', () => {
    vi.useFakeTimers()
    const go = vi.fn()
    setup([{ keys: 'g d', handler: go }])
    press('g')
    press('d')
    expect(go).toHaveBeenCalledTimes(1)

    press('g')
    vi.advanceTimersByTime(1100)
    press('d')
    expect(go).toHaveBeenCalledTimes(1)

    // a wrong key breaks the sequence
    press('g')
    press('x')
    press('d')
    expect(go).toHaveBeenCalledTimes(1)

    // restarting a sequence with its own first key works
    press('g')
    press('g')
    press('d')
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('ignores typing in inputs except for mod+k and escape', () => {
    const go = vi.fn()
    const palette = vi.fn()
    const esc = vi.fn()
    const { container } = render(<input aria-label="field" />)
    const input = container.querySelector('input')!
    setup([
      { keys: 'g d', handler: go },
      { keys: 'ctrl+k', handler: palette },
      { keys: 'escape', handler: esc },
    ])
    press('g', {}, input)
    press('d', {}, input)
    expect(go).not.toHaveBeenCalled()
    press('k', { ctrlKey: true }, input)
    expect(palette).toHaveBeenCalledTimes(1)
    press('Escape', {}, input)
    expect(esc).toHaveBeenCalledTimes(1)
  })

  it('skips plain shortcuts while a modal dialog is open', () => {
    const help = vi.fn()
    render(<div role="dialog" aria-modal="true" />)
    setup([{ keys: '?', handler: help }])
    press('?')
    expect(help).not.toHaveBeenCalled()
  })

  it('respects enabled=false and prevents default when firing', () => {
    const fn = vi.fn()
    const { unmount } = setup([{ keys: 'x', handler: fn }], { enabled: false })
    press('x')
    expect(fn).not.toHaveBeenCalled()
    unmount()

    setup([{ keys: 'x', handler: fn }])
    const evt = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
    document.body.dispatchEvent(evt)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('uses the latest handler without re-subscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = setup([{ keys: 'x', handler: first }])
    rerender({ h: [{ keys: 'x', handler: second }] })
    press('x')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
