import type { SpeechEngine, SpeechHandlers } from './types'

// Safari's built-in speech recognition (webkitSpeechRecognition). Free and
// needs no key. iOS ends a session after silence or ~1 minute, so we restart
// it whenever it stops while we still want to listen.

type Rec = any

export function webSpeechSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

export function createWebSpeech(lang: string, h: SpeechHandlers): SpeechEngine {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  let rec: Rec | null = null
  let wanted = false
  let restartTimer: number | undefined
  let fatal = false

  function spawn() {
    rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => h.onState(true)
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) {
          if (text.trim()) h.onFinal(text.trim())
        } else {
          interim += text
        }
      }
      h.onInterim(interim.trim())
    }
    rec.onerror = (e: any) => {
      // "no-speech" and "aborted" are routine; the restart below handles them.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        fatal = true
        wanted = false
        h.onError('Microphone or speech recognition permission was denied. Allow it in Settings › Safari, then reload.')
      } else if (e.error === 'audio-capture') {
        h.onError('No microphone available.')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        h.onError(`Speech recognition: ${e.error}`)
      }
    }
    rec.onend = () => {
      // Whatever was interim when the session ended is lost by the engine, so
      // commit it ourselves.
      h.onInterim('')
      if (wanted && !fatal) {
        restartTimer = window.setTimeout(() => {
          try {
            spawn()
          } catch (err) {
            h.onError(String(err))
          }
        }, 150)
      } else {
        h.onState(false)
      }
    }
    rec.start()
  }

  return {
    async start() {
      wanted = true
      fatal = false
      spawn()
    },
    stop() {
      wanted = false
      window.clearTimeout(restartTimer)
      try {
        rec?.stop()
      } catch {}
      h.onState(false)
    },
  }
}
