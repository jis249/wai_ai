import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MessageMarkdown } from './MessageMarkdown'

describe('MessageMarkdown', () => {
  it('renders code fences as <pre> and text as paragraphs', () => {
    const { container } = render(<MessageMarkdown content={'Intro\n```js\nconst a = 1\n```\nOutro'} />)
    expect(container.querySelector('pre')?.textContent).toBe('const a = 1\n')
    expect(screen.getByText('Intro')).toBeInTheDocument()
  })

  it('escapes HTML from model output (no XSS)', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const { container } = render(<MessageMarkdown content={payload} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain(payload)
  })
})
