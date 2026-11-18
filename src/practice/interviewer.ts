import Anthropic from '@anthropic-ai/sdk'
import type { Lang } from './runner'

export interface PracticeConfig {
  role: string
  lang: Lang
  minutes: number
  questions: string
  voice: string
}

export const DEFAULT_QUESTIONS = `1. Two Sum: given an array of integers and a target, return the indices of the two numbers that add up to the target.
2. Longest substring without repeating characters.
3. Merge overlapping intervals, e.g. [1,3],[2,6],[8,10] -> [1,6],[8,10].
4. Binary tree level-order traversal, then zigzag order as a follow-up.
5. Conceptual: how does a hash map work internally, and what happens on collisions?
6. Conceptual: process vs thread, and when you'd use each.
7. System design: a URL shortener handling 100 million new links a month (API, data model, short-code generation, scaling reads).`

export const PRACTICE_DEFAULTS: PracticeConfig = {
  role: 'Software Engineer',
  lang: 'python',
  minutes: 45,
  questions: DEFAULT_QUESTIONS,
  voice: 'aura-2-orion-en',
}

const KEY = 'meeting-copilot.practice.v1'

export function loadPractice(): PracticeConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...PRACTICE_DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return { ...PRACTICE_DEFAULTS }
}

export function savePractice(c: PracticeConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {}
}

export const SILENT = '<silent/>'
export const END = '<end/>'

function systemPrompt(c: PracticeConfig) {
  const langName = c.lang === 'python' ? 'Python' : 'JavaScript'
  return `You are a technical interviewer at a software company, running a live mock coding interview over a voice call with a shared code pad, like CoderPad. Everything you write is spoken to the candidate by text-to-speech, so write exactly what you would say out loud.

How you speak:
- One to three short sentences per turn, in natural spoken English.
- No markdown, lists, emoji or symbols. Never read code aloud; refer to it in words ("your inner loop", "the hash map on line 4").

The interview:
- Role: ${c.role}. The candidate writes ${langName}. Plan for about ${c.minutes} minutes in total.
- Go through the questions below in order. Coding problems go in the pad. Conceptual and design questions are only discussed out loud.
- To put a coding problem in the pad, include a <pad> block in your turn. Inside it, write a ${langName} comment header with the problem title, the statement, one or two examples and the constraints, then an empty function stub, and nothing else. The pad block replaces the pad's contents and is not spoken, so also say a one or two sentence summary of the problem out loud.
- Each candidate turn shows what they just said, the current code in the pad, and the output of their latest run. Use it like a real interviewer watching the screen: notice bugs, ask about complexity and edge cases, and suggest they run a test.
- Interviewers mostly stay quiet while the candidate codes. If the candidate is thinking aloud or narrating and nothing calls for a response, reply with exactly ${SILENT} and nothing else.
- If they are stuck or ask for help, give a small hint, never the solution. If something is wrong, ask a probing question instead of correcting them.
- Answer clarifying questions the way a real interviewer would. Don't praise every answer and don't teach. Brief acknowledgements are fine.
- Watch the elapsed time. If a question runs long, move on.
- Stay in character. When the questions are done or time is up, wrap up and ask whether they have any questions for you. After answering, end your final turn with ${END}.

Questions:
${c.questions}`
}

export interface Snapshot {
  said: string // what the candidate said, or a note like "(quiet for 2 minutes)"
  code: string
  lastRun: string | null
  elapsedMin: number
}

function userTurn(s: Snapshot, c: PracticeConfig): string {
  return `<elapsed>${s.elapsedMin} min</elapsed>
<candidate_said>${s.said}</candidate_said>
<pad language="${c.lang}">
${s.code.trim() || '(empty)'}
</pad>
<last_run>
${s.lastRun?.trim() || '(not run yet)'}
</last_run>`
}

export type History = Anthropic.Beta.BetaMessageParam[]

/** Pulls the parts out of the interviewer's (possibly unfinished) reply. */
export function parseReply(raw: string) {
  const padMatch = /<pad>\n?([\s\S]*?)\n?<\/pad>/.exec(raw)
  let spoken = raw.replace(/<pad>[\s\S]*?<\/pad>/g, ' ')
  // Hold back an unfinished tag so it never reaches the voice.
  const open = spoken.lastIndexOf('<')
  if (open !== -1 && spoken.indexOf('>', open) === -1) spoken = spoken.slice(0, open)
  spoken = spoken.replace(/<pad>[\s\S]*$/, '')
  const ended = raw.includes(END)
  spoken = spoken.replaceAll(END, '').replaceAll(SILENT, '').replace(/[ \t]+/g, ' ')
  const t = raw.trim()
  return {
    spoken,
    pad: padMatch ? padMatch[1] : null,
    silent: t === SILENT,
    maybeSilent: SILENT.startsWith(t), // still could turn out silent
    ended,
  }
}

export interface TurnHandle {
  done: Promise<string>
  abort: () => void
}

export function interviewerTurn(
  apiKey: string,
  c: PracticeConfig,
  history: History,
  snap: Snapshot,
  onText: (raw: string) => void,
): TurnHandle {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  const messages: History = [...history, { role: 'user', content: userTurn(snap, c) }]
  const stream = client.beta.messages.stream({
    model: 'claude-sonnet-5-5',
    max_tokens: 4000,
    system: systemPrompt(c),
    messages,
    cache_control: { type: 'ephemeral' },
    // Spoken back-and-forth needs a fast first word; no extended thinking.
    thinking: { type: 'between_tools' },
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })
  let raw = ''
  stream.on('text', (d) => {
    raw += d
    onText(raw)
  })
  const done = stream.finalMessage().then((m) => {
    if (m.stop_reason === 'refusal') throw new Error('The interviewer declined to continue.')
    // Keep the history exactly as sent so the prompt cache stays valid.
    history.push(messages[messages.length - 1], { role: 'assistant', content: raw || SILENT })
    return raw
  })
  return { done, abort: () => stream.abort() }
}

export function feedback(apiKey: string, c: PracticeConfig, history: History, snap: Snapshot) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  return client.beta.messages.stream({
    model: 'claude-sonnet-5-5',
    max_tokens: 8000,
    system: systemPrompt(c),
    messages: [
      ...history,
      {
        role: 'user',
        content: `${userTurn(snap, c)}

The interview is over. Step out of the interviewer role and write honest written feedback for the candidate, in markdown. For each question covered: correctness, the complexity they reached versus the optimal one, edge cases they missed, and how clearly they communicated. Then an overall hire / lean hire / lean no hire / no hire signal with one sentence why, and the three most useful things to practice next.`,
      },
    ],
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  })
}
