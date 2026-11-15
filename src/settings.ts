export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'
export type Effort = 'low' | 'medium' | 'high'
export type SttProvider = 'webspeech' | 'deepgram'

export interface Settings {
  apiKey: string
  model: ModelId
  effort: Effort
  fast: boolean
  think: boolean
  webSearch: boolean
  autoAnswer: boolean
  pauseMs: number
  stt: SttProvider
  deepgramKey: string
  lang: string
  context: string
}

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (smartest)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (fast, recommended)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest, cheapest)' },
]

export const DEFAULTS: Settings = {
  apiKey: '',
  model: 'claude-sonnet-5-5',
  effort: 'low',
  fast: false,
  think: false,
  webSearch: true,
  autoAnswer: true,
  pauseMs: 800,
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
    if (raw) {
      const saved = JSON.parse(raw)
      // 1300ms was the old default; move people who never changed it to the faster one.
      if (saved.pauseMs === 1300) saved.pauseMs = DEFAULTS.pauseMs
      return { ...DEFAULTS, ...saved }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {}
}
