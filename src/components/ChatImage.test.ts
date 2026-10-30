import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatImage } from './ChatImage'
import { Markdown } from './Markdown'

test('renders an accessible image modal trigger without an initial dialog', () => {
  const html = renderToStaticMarkup(createElement(ChatImage, {
    src: 'data:image/png;base64,YQ==',
    alt: 'Screenshot',
  }))
  expect(html).toContain('aria-label="View image: Screenshot"')
  expect(html).toContain('aria-haspopup="dialog"')
  expect(html).toContain('<img')
  expect(html).not.toContain('<dialog')
  expect(html).not.toContain('download=')
})

test('markdown images use the modal viewer, including linked images', () => {
  const html = renderToStaticMarkup(createElement(Markdown, {
    children: '[![Photo](https://example.com/photo.png)](https://example.com/full.png)',
  }))
  expect(html).toContain('aria-label="View image: Photo"')
  expect(html).not.toContain('<a ')
})

test('ordinary markdown links remain links', () => {
  const html = renderToStaticMarkup(createElement(Markdown, {
    children: '[Example](https://example.com)',
  }))
  expect(html).toContain('<a href="https://example.com">Example</a>')
})
