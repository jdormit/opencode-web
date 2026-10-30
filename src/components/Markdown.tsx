import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatImage } from './ChatImage'
import styles from './Markdown.module.css'

const components: Components = {
  img: ({ src, alt, title }: React.ComponentProps<'img'>) =>
    typeof src === 'string' && src ? <ChatImage src={src} alt={alt} title={title} /> : null,
  a: ({ node, children, ...props }) =>
    node?.children.some((child) => child.type === 'element' && child.tagName === 'img')
      ? <span>{children}</span>
      : <a {...props}>{children}</a>,
}

export const Markdown = React.memo(function Markdown({
  children,
}: {
  children: string
}) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  )
})
