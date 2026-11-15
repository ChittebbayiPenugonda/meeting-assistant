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

Does the new speech contain a question, problem or request the user should respond to now (including a coding or technical problem being described), that is not already answered above? Small talk, the user's own speech, and statements with nothing to answer don't count. If there is nothing to answer, reply with exactly ${NO_QUESTION} and nothing else. Otherwise answer it.`,
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
}

export interface AskHandle {
  done: Promise<{ text: string; model: string }>
  abort: () => void
}

export function ask(settings: Settings, input: AskInput, cb: AskCallbacks): AskHandle {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  const system = SYSTEM + (settings.context.trim() ? `\n\n<user_background>\n${settings.context.trim()}\n</user_background>` : '')
  const isHaiku = settings.model === 'claude-haiku-5-5'

  const stream = client.beta.messages.stream({
    model: settings.model,
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: buildMessages(input),
    output_config: { effort: settings.effort },
    ...(settings.fast && settings.model === 'claude-opus-5-5' ? { speed: 'fast' as const } : {}),
    // If a safety classifier declines, retry on a suitable model instead of failing.
    ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
  })

  stream.on('text', (_delta, snapshot) => cb.onText(snapshot))

  const done = stream.finalMessage().then((msg) => {
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to answer this one.')
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return { text, model: msg.model }
  })

  return { done, abort: () => stream.abort() }
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
