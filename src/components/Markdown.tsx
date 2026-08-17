import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

export const Markdown = React.memo(function Markdown({
  children,
}: {
  children: string
}) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
})
