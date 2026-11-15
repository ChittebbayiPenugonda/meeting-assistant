import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

function extractText(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  return extractText(node.props?.children)
}

function CodeBlock(props: any) {
  const [copied, setCopied] = useState(false)
  const { node: _node, ...rest } = props
  return (
    <div className="codeblock">
      <button
        className="copy-code"
        onClick={() => {
          navigator.clipboard.writeText(extractText(props.children)).catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre {...rest} />
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]} components={{ pre: CodeBlock }}>
      {text}
    </ReactMarkdown>
  )
})
