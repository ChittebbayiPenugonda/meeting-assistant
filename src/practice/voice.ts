// The interviewer's voice. Text arrives sentence by sentence while Claude is
// still writing; each sentence is synthesized as soon as it's complete and
// played in order, so speech starts after the first sentence instead of the
// whole reply. Deepgram Aura when there's a key, the browser's voice otherwise.

export const VOICES: { id: string; label: string }[] = [
  { id: 'aura-2-orion-en', label: 'Orion: calm, polite (US, male)' },
  { id: 'aura-2-odysseus-en', label: 'Odysseus: smooth, professional (US, male)' },
  { id: 'aura-2-arcas-en', label: 'Arcas: natural, clear (US, male)' },
  { id: 'aura-2-draco-en', label: 'Draco: warm baritone (UK, male)' },
  { id: 'aura-2-athena-en', label: 'Athena: calm, professional (US, female)' },
  { id: 'aura-2-hera-en', label: 'Hera: smooth, warm (US, female)' },
  { id: 'aura-2-luna-en', label: 'Luna: friendly, natural (US, female)' },
  { id: 'aura-2-pandora-en', label: 'Pandora: smooth, calm (UK, female)' },
]

export interface Speaker {
  say(sentence: string): void
  /** Resolves once everything queued so far has finished playing. */
  drained(): Promise<void>
  stop(): void
  readonly speaking: boolean
  onSpeakingChange?: (speaking: boolean) => void
}

export function createSpeaker(deepgramKey: string, voice: string, onError: (msg: string) => void): Speaker {
  type Item = { audio: Promise<HTMLAudioElement | null>; text: string; ctrl: AbortController }
  const queue: Item[] = []
  let current: HTMLAudioElement | null = null
  let playing = false
  let useBrowser = !deepgramKey
  let waiters: (() => void)[] = []

  const self: Speaker = {
    get speaking() {
      return playing || queue.length > 0
    },
    say(sentence) {
      const text = sentence.trim()
      if (!text) return
      const ctrl = new AbortController()
      const audio = useBrowser ? Promise.resolve(null) : synth(text, ctrl.signal)
      queue.push({ audio, text, ctrl })
      if (!playing) pump()
    },
    drained() {
      if (!self.speaking) return Promise.resolve()
      return new Promise((r) => waiters.push(r))
    },
    stop() {
      for (const it of queue.splice(0)) it.ctrl.abort()
      if (current) {
        current.pause()
        current = null
      }
      window.speechSynthesis?.cancel()
      finish()
    },
  }

  function setPlaying(v: boolean) {
    if (playing !== v) {
      playing = v
      self.onSpeakingChange?.(v)
    }
  }

  function finish() {
    setPlaying(false)
    const w = waiters
    waiters = []
    w.forEach((r) => r())
  }

  async function synth(text: string, signal: AbortSignal): Promise<HTMLAudioElement | null> {
    try {
      const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      })
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Deepgram rejected the key' : `Deepgram voice error ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = new Audio(url)
      a.onended = () => URL.revokeObjectURL(url)
      return a
    } catch (err: any) {
      if (err?.name === 'AbortError') return null
      onError(`${err?.message ?? err}. Using the browser voice instead.`)
      useBrowser = true
      return null
    }
  }

  function browserSay(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis
      if (!synth) return resolve()
      const u = new SpeechSynthesisUtterance(text)
      const voices = synth.getVoices().filter((v) => v.lang.startsWith('en'))
      u.voice =
        voices.find((v) => /premium|enhanced|natural/i.test(v.name)) ??
        voices.find((v) => /Google US English|Samantha|Daniel/.test(v.name)) ??
        voices[0] ??
        null
      u.rate = 1.05
      u.onend = u.onerror = () => resolve()
      synth.speak(u)
    })
  }

  async function pump() {
    setPlaying(true)
    while (queue.length) {
      const item = queue[0]
      const audio = await item.audio
      if (queue[0] !== item) continue // stopped meanwhile
      if (audio) {
        current = audio
        await new Promise<void>((resolve) => {
          audio.onended = audio.onerror = audio.onpause = () => resolve()
          audio.play().catch(() => resolve())
        })
        current = null
      } else if (!item.ctrl.signal.aborted) {
        await browserSay(item.text)
      }
      if (queue[0] === item) queue.shift()
    }
    finish()
  }

  return self
}

/**
 * Splits streamed text into whole sentences as they complete. Feed it the
 * growing text; it returns sentences not yet returned.
 */
export function sentenceChunker() {
  let sent = 0
  return {
    next(text: string, final = false): string[] {
      const out: string[] = []
      const re = /[.!?]+["')\]]?(?=\s)|\n+/g
      re.lastIndex = sent
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const end = m.index + m[0].length
        const s = text.slice(sent, end).trim()
        if (s) out.push(s)
        sent = end
      }
      if (final && sent < text.length) {
        const rest = text.slice(sent).trim()
        if (rest) out.push(rest)
        sent = text.length
      }
      return out
    },
  }
}
