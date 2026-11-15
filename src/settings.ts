export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'
export type Effort = 'low' | 'medium' | 'high'
export type SttProvider = 'webspeech' | 'deepgram'

export interface Settings {
  apiKey: string
  model: ModelId
  effort: Effort
  fast: boolean
  autoAnswer: boolean
  pauseMs: number
  stt: SttProvider
  deepgramKey: string
  lang: string
  context: string
}

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (smartest)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (balanced)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest, cheapest)' },
]

export const DEFAULTS: Settings = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'low',
  fast: false,
  autoAnswer: true,
  pauseMs: 1300,
  stt: 'webspeech',
  deepgramKey: '',
  lang: 'en-US',
  context: '',
}

const KEY = 'meeting-copilot.settings.v1'

// Everything lives in this browser's localStorage only. Nothing is sent
// anywhere except Anthropic (and Deepgram, if you pick it).
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULTS }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {}
}
