import Anthropic from '@anthropic-ai/sdk'
import type { Settings } from './settings'

export const NO_QUESTION = 'NO_QUESTION'

const SYSTEM = `You are a real-time meeting copilot. The user is on a live call and glances at your answers on their phone while talking, so every answer must be fast to read and immediately usable.

The transcript comes from a phone microphone sitting next to the user's laptop. It mixes the other participants and the user with no speaker labels, and it has speech-recognition errors. Infer the intended words, especially technical terms that were misheard.

Answer format:
- First line exactly: "Q: " followed by the question restated in 12 words or fewer.
- Then a blank line, then the direct answer in one or two plain sentences the user could say out loud.
- Then, only if it adds value, up to 5 short bullets: key points, numbers, trade-offs or talking points.
- For coding or technical problems, give a complete, correct, minimal code block with a language tag, then 1 to 3 bullets on the approach and time/space complexity.
- No preamble, no restating the transcript, no closing offers, no filler.
- When the question is about the user personally (their experience, opinions, background), answer in first person as the user, using their background below. Do not invent specific facts about them that the background doesn't support; give a framework they can fill in instead.`

export interface Turn {
  kind: 'auto' | 'manual'
  question: string
  images: string[] // data URLs
  answer: string
}

export interface AskInput {
  mode: 'auto' | 'manual'
  transcript: string
  newSpeech?: string // auto mode
  text?: string // manual mode
  images?: string[]
  history: Turn[]
}

function imageBlock(dataUrl: string): Anthropic.Beta.BetaImageBlockParam {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/.exec(dataUrl)
  if (!m) throw new Error('Unsupported image')
  return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] } }
}

function buildMessages(input: AskInput): Anthropic.Beta.BetaMessageParam[] {
  const msgs: Anthropic.Beta.BetaMessageParam[] = []
  // Earlier exchanges, so follow-ups like "shorter" or "now in Java" work.
  // Images are only kept for the last few to keep requests small.
  const recent = input.history.slice(-8)
  recent.forEach((t, i) => {
    const keepImages = i >= recent.length - 3
    const content: Anthropic.Beta.BetaContentBlockParam[] = []
    if (keepImages) t.images.forEach((src) => content.push(imageBlock(src)))
    content.push({ type: 'text', text: t.kind === 'auto' ? `(Question detected on the call) ${t.question}` : t.question || '(image)' })
    msgs.push({ role: 'user', content })
    msgs.push({ role: 'assistant', content: t.answer })
  })

  const transcript = input.transcript.slice(-8000) || '(nothing transcribed yet)'
  const answered = input.history
    .filter((t) => t.kind === 'auto')
    .slice(-10)
    .map((t) => `- ${t.question}`)
    .join('\n')

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  ;(input.images ?? []).forEach((src) => content.push(imageBlock(src)))

  if (input.mode === 'auto') {
    content.push({
      type: 'text',
      text: `<transcript>\n${transcript}\n</transcript>

<new_speech>\n${input.newSpeech}\n</new_speech>

<already_answered>\n${answered || '(none)'}\n</already_answered>

Does the new speech contain a question, problem or request the user should respond to now (including a coding or technical problem being described), that is not already answered above? Small talk, the user's own speech, and statements with nothing to answer don't count. If the question is clearly cut off mid-sentence, treat it as nothing to answer yet: you will get the rest moments later. If there is nothing to answer, reply with exactly ${NO_QUESTION} and nothing else. Otherwise answer it.`,
    })
  } else {
    const ask = input.text?.trim()
    content.push({
      type: 'text',
      text: `<transcript>\n${transcript}\n</transcript>

${
  ask
    ? `My message: ${ask}`
    : input.images?.length
      ? 'Help me with what is in the image, in the context of the call.'
      : 'Answer the most recent question or problem raised in the conversation.'
}`,
    })
  }
  msgs.push({ role: 'user', content })
  return msgs
}

export interface AskCallbacks {
  onText: (snapshot: string) => void
  /** e.g. "Searching the web…" while a server tool runs; null when done. */
  onStatus?: (status: string | null) => void
}

export interface AskHandle {
  done: Promise<{ text: string; model: string }>
  abort: () => void
}

// Thinking adds a pause before the first word. Off by default for speed.
// Sonnet 5.5 turns it off with `between_tools`; Haiku 5.5 accepts `disabled`;
// Opus 5.5 always thinks (low effort keeps it short).
function thinkingFor(s: Settings): Anthropic.Beta.BetaThinkingConfigParam | undefined {
  if (s.think) return undefined
  if (s.model === 'claude-sonnet-5-5') return { type: 'between_tools' }
  if (s.model === 'claude-haiku-5-5') return { type: 'disabled' }
  return undefined
}

const WEB_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 },
]

const TOOL_STATUS: Record<string, string> = {
  web_search: 'Searching the web…',
  web_fetch: 'Reading the page…',
}

export function ask(settings: Settings, input: AskInput, cb: AskCallbacks): AskHandle {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  const system =
    SYSTEM +
    (settings.webSearch
      ? '\n\nYou can search the web and fetch pages. Use them only when the answer depends on current or specific facts you are unsure of (recent events, prices, a company or product, docs for a specific version). Most interview and technical questions need no search: answer them directly.'
      : '') +
    (settings.context.trim() ? `\n\n<user_background>\n${settings.context.trim()}\n</user_background>` : '')
  const isHaiku = settings.model === 'claude-haiku-5-5'
  const thinking = thinkingFor(settings)
  const messages = buildMessages(input)

  let current: { abort: () => void } | null = null
  let aborted = false
  let full = '' // text across every text block and continuation

  const run = async () => {
    let model: string = settings.model
    // A long server-tool turn can come back as `pause_turn`; send it back to continue.
    for (let round = 0; round < 3; round++) {
      const stream = client.beta.messages.stream({
        model: settings.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { effort: settings.effort },
        ...(thinking ? { thinking } : {}),
        ...(settings.webSearch ? { tools: WEB_TOOLS } : {}),
        ...(settings.fast && settings.model === 'claude-opus-5-5' ? { speed: 'fast' as const } : {}),
        // If a safety classifier declines, retry on a suitable model instead of failing.
        ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      })
      current = stream
      if (aborted) stream.abort()

      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start') {
          const b = ev.content_block
          if (b.type === 'server_tool_use') cb.onStatus?.(TOOL_STATUS[b.name] ?? 'Working…')
          else if (b.type === 'text') cb.onStatus?.(null)
        }
      })
      stream.on('text', (delta) => {
        full += delta
        cb.onText(full)
      })

      const msg = await stream.finalMessage()
      model = msg.model
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.')
      if (msg.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
    }
    cb.onStatus?.(null)
    return { text: full, model }
  }

  return {
    done: run(),
    abort: () => {
      aborted = true
      current?.abort()
    },
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Invalid Anthropic API key. Check Settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic. Wait a moment and retry.'
  if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return 'Network error reaching Anthropic.'
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/** Splits "Q: ...\n\nanswer" into its parts. */
export function splitAnswer(text: string): { q: string | null; body: string } {
  const m = /^\s*Q:\s*(.+?)\s*(?:\n|$)([\s\S]*)$/.exec(text)
  if (!m) return { q: null, body: text }
  return { q: m[1], body: m[2].replace(/^\s+/, '') }
}
