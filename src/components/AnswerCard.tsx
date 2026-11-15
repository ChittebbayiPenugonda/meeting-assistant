import { useEffect, useState } from 'react'
import { Markdown } from './Markdown'
import { splitAnswer } from '../llm'

export interface Exchange {
  id: string
  kind: 'auto' | 'manual'
  question: string
  images: string[]
  answer: string
  status: 'thinking' | 'streaming' | 'done' | 'error'
  error?: string
  model?: string
  ttft?: number
}

export function AnswerCard({ x, defaultOpen }: { x: Exchange; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)
  // Older cards collapse when a newer answer arrives.
  useEffect(() => setOpen(defaultOpen), [defaultOpen])

  const { q, body } = splitAnswer(x.answer)
  const title = q || x.question || (x.images.length ? 'Image' : 'Latest question')
  const live = x.status === 'thinking' || x.status === 'streaming'

  return (
    <article className={`card ${open ? 'open' : ''} ${x.kind}`}>
      <button className="card-head" onClick={() => setOpen((v) => !v)}>
        <span className={`tag ${x.kind}`}>{x.kind === 'auto' ? 'Heard' : 'You'}</span>
        <span className="title">{title}</span>
        {live && <span className="spinner" />}
      </button>
      {open && (
        <div className="card-body">
          {x.kind === 'manual' && (x.images.length > 0 || (x.question && q && x.question !== q)) && (
            <div className="asked">
              {x.images.map((src, i) => (
                <img key={i} src={src} alt="" />
              ))}
              {x.question && x.question !== q && <span>{x.question}</span>}
            </div>
          )}
          {x.status === 'thinking' && (
            <div className="dots">
              <i />
              <i />
              <i />
            </div>
          )}
          {body && (
            <div className="prose">
              <Markdown text={body} />
            </div>
          )}
          {x.error && <div className="err">{x.error}</div>}
          {x.status === 'done' && (
            <div className="meta">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(body).catch(() => {})
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              {x.ttft != null && <span>{(x.ttft / 1000).toFixed(1)}s to first word</span>}
              {x.model && <span>{x.model.replace('claude-', '')}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
