import { useCallback, useEffect, useRef, useState } from 'react'
import { ask, describeError, NO_QUESTION, splitAnswer, type AskHandle, type Turn } from './llm'
import { loadSettings, saveSettings, type Settings } from './settings'
import { createWebSpeech, webSpeechSupported } from './speech/webSpeech'
import { createDeepgram } from './speech/deepgram'
import type { SpeechEngine } from './speech/types'
import { fileToDataUrl } from './images'
import { AnswerCard, type Exchange } from './components/AnswerCard'
import { SettingsSheet } from './components/SettingsSheet'

const uid = () => Math.random().toString(36).slice(2, 10)
const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(() => !loadSettings().apiKey)
  const [listening, setListening] = useState(false)
  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [checking, setChecking] = useState(false)
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [banner, setBanner] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const finalsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const exchangesRef = useRef<Exchange[]>([])
  exchangesRef.current = exchanges
  const engineRef = useRef<SpeechEngine | null>(null)
  const wantListenRef = useRef(false)
  const pauseTimer = useRef<number | undefined>(undefined)
  const consumedRef = useRef(0) // number of final segments already checked for questions
  const autoRef = useRef<{ handle: AskHandle; decided: boolean; startIdx: number } | null>(null)
  const autoPending = useRef(false)
  const wakeLock = useRef<any>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const updateSettings = (s: Settings) => {
    setSettings(s)
    saveSettings(s)
  }

  const patch = (id: string, p: Partial<Exchange>) =>
    setExchanges((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const history = (): Turn[] =>
    exchangesRef.current
      .filter((x) => x.status === 'done' && x.answer)
      .slice()
      .reverse() // state is newest-first
      .map((x) => ({ kind: x.kind, question: x.question, images: x.images, answer: x.answer }))

  const fullTranscript = () => [...finalsRef.current, interimRef.current].filter(Boolean).join(' ')

  // ---------- automatic question detection ----------

  const runAutoCheck = useCallback(() => {
    const s = settingsRef.current
    if (!s.autoAnswer || !s.apiKey) {
      consumedRef.current = finalsRef.current.length
      return
    }
    const cur = autoRef.current
    if (cur && cur.decided) {
      // An answer is streaming; check again once it finishes.
      autoPending.current = true
      return
    }
    let startIdx = consumedRef.current
    if (cur && !cur.decided) {
      // Still deciding about earlier speech: fold it into a fresh check.
      cur.handle.abort()
      startIdx = cur.startIdx
      autoRef.current = null
    }
    const newSpeech = [...finalsRef.current.slice(startIdx), interimRef.current].filter(Boolean).join(' ')
    if (wordCount(newSpeech) < 3) return
    consumedRef.current = finalsRef.current.length

    const id = uid()
    const started = performance.now()
    let created = false
    setChecking(true)
    const handle = ask(
      s,
      { mode: 'auto', transcript: fullTranscript(), newSpeech, history: history() },
      {
        onText: (snap) => {
          const entry = autoRef.current
          if (!entry || entry.handle !== handle) return
          const t = snap.trimStart()
          if (!entry.decided) {
            if (NO_QUESTION.startsWith(t) || t.startsWith(NO_QUESTION)) {
              if (t.startsWith(NO_QUESTION)) handle.abort()
              return
            }
            entry.decided = true
            setChecking(false)
          }
          if (!created) {
            created = true
            setExchanges((xs) => [
              { id, kind: 'auto', question: '', images: [], answer: snap, status: 'streaming', ttft: performance.now() - started },
              ...xs,
            ])
          } else {
            patch(id, { answer: snap })
          }
        },
      },
    )
    autoRef.current = { handle, decided: false, startIdx }

    handle.done
      .then(({ text, model }) => {
        if (created) {
          const { q } = splitAnswer(text)
          patch(id, { answer: text, question: q ?? newSpeech.slice(-160), status: 'done', model })
        }
      })
      .catch((err) => {
        if ((err as any)?.name === 'APIUserAbortError' || /abort/i.test(String(err))) {
          if (created) patch(id, { status: 'done' })
          return
        }
        if (created) patch(id, { status: 'error', error: describeError(err) })
        else setBanner(describeError(err))
      })
      .finally(() => {
        if (autoRef.current?.handle === handle) {
          autoRef.current = null
          setChecking(false)
          if (autoPending.current) {
            autoPending.current = false
            runAutoCheck()
          }
        }
      })
  }, [])

  const onSpeechActivity = useCallback(() => {
    window.clearTimeout(pauseTimer.current)
    pauseTimer.current = window.setTimeout(runAutoCheck, settingsRef.current.pauseMs)
  }, [runAutoCheck])

  // ---------- listening ----------

  const acquireWakeLock = async () => {
    try {
      wakeLock.current = await (navigator as any).wakeLock?.request('screen')
    } catch {}
  }

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && wantListenRef.current) acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const startListening = async () => {
    const s = settingsRef.current
    setBanner(null)
    const handlers = {
      onInterim: (t: string) => {
        interimRef.current = t
        setInterim(t)
        if (t) onSpeechActivity()
      },
      onFinal: (t: string) => {
        finalsRef.current = [...finalsRef.current, t]
        setFinals(finalsRef.current)
        onSpeechActivity()
      },
      onError: (m: string) => setBanner(m),
      onState: (on: boolean) => {
        if (on) setListening(true)
        else if (!wantListenRef.current) setListening(false)
      },
    }
    let engine: SpeechEngine
    if (s.stt === 'deepgram') {
      if (!s.deepgramKey) {
        setBanner('Add a Deepgram API key in Settings, or switch to Safari speech.')
        return
      }
      engine = createDeepgram(s.deepgramKey, s.lang, handlers)
    } else {
      if (!webSpeechSupported()) {
        setBanner('This browser has no built-in speech recognition. Use Safari, or switch to Deepgram in Settings.')
        return
      }
      engine = createWebSpeech(s.lang, handlers)
    }
    engineRef.current = engine
    wantListenRef.current = true
    setListening(true)
    acquireWakeLock()
    await engine.start()
  }

  const stopListening = () => {
    wantListenRef.current = false
    engineRef.current?.stop()
    engineRef.current = null
    setListening(false)
    setInterim('')
    interimRef.current = ''
    wakeLock.current?.release?.().catch(() => {})
    wakeLock.current = null
  }

  // ---------- manual ask ----------

  const send = () => {
    const s = settingsRef.current
    if (!s.apiKey) {
      setShowSettings(true)
      return
    }
    const q = text.trim()
    const imgs = images
    const id = uid()
    const started = performance.now()
    let first = true
    setExchanges((xs) => [{ id, kind: 'manual', question: q, images: imgs, answer: '', status: 'thinking' }, ...xs])
    setText('')
    setImages([])
    // Typing or "Answer now" covers the speech so far.
    consumedRef.current = finalsRef.current.length
    const handle = ask(
      s,
      { mode: 'manual', transcript: fullTranscript(), text: q, images: imgs, history: history() },
      {
        onText: (snap) => {
          patch(id, first ? { answer: snap, status: 'streaming', ttft: performance.now() - started } : { answer: snap })
          first = false
        },
      },
    )
    handle.done
      .then(({ text, model }) => {
        const { q: detected } = splitAnswer(text)
        patch(id, { answer: text, status: 'done', model, question: q || detected || '' })
      })
      .catch((err) => patch(id, { status: 'error', error: describeError(err) }))
  }

  const addFiles = async (files: Iterable<File>) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      try {
        const url = await fileToDataUrl(f)
        setImages((xs) => [...xs, url])
      } catch {
        setBanner('Could not read that image.')
      }
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const clearSession = () => {
    autoRef.current?.handle.abort()
    autoRef.current = null
    finalsRef.current = []
    consumedRef.current = 0
    setFinals([])
    setExchanges([])
    setShowSettings(false)
  }

  const transcriptTail = (() => {
    const all = finals.join(' ')
    return all.length > 220 ? '…' + all.slice(-220) : all
  })()

  const canSend = !!text.trim() || images.length > 0

  return (
    <div className="app">
      <header className="topbar">
        <button className={`listen ${listening ? 'on' : ''}`} onClick={listening ? stopListening : startListening}>
          <span className="dot" />
          {listening ? 'Listening' : 'Start listening'}
        </button>
        <button
          className={`chip ${settings.autoAnswer ? 'active' : ''}`}
          onClick={() => updateSettings({ ...settings, autoAnswer: !settings.autoAnswer })}
          title="Automatically answer questions heard on the call"
        >
          Auto {settings.autoAnswer ? 'on' : 'off'}
        </button>
        <button className="icon" onClick={() => setShowSettings(true)} aria-label="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </header>

      <button className="transcript" onClick={() => setShowTranscript((v) => !v)}>
        {checking && <span className="checking">checking for a question…</span>}
        {showTranscript ? (
          <span className="full">{finals.join(' ')}</span>
        ) : (
          <span>{transcriptTail}</span>
        )}
        {interim && <span className="interim"> {interim}</span>}
        {!finals.length && !interim && (
          <span className="muted">
            {listening ? 'Listening… put the phone near your laptop speaker.' : 'Tap Start listening when the call begins.'}
          </span>
        )}
      </button>

      {banner && (
        <div className="banner" onClick={() => setBanner(null)}>
          {banner}
        </div>
      )}

      <main className="feed">
        {exchanges.length === 0 ? (
          <div className="empty">
            <p>Answers to questions heard on the call appear here, newest on top.</p>
            <p>You can also type, paste a screenshot, or tap <b>Answer</b> to answer the latest question right now.</p>
          </div>
        ) : (
          exchanges.map((x, i) => <AnswerCard key={x.id} x={x} defaultOpen={i === 0} />)
        )}
      </main>

      <footer className="composer">
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((src, i) => (
              <div className="thumb" key={i}>
                <img src={src} alt="" />
                <button onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove image">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button className="icon attach" onClick={() => fileInput.current?.click()} aria-label="Add image">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
          <textarea
            rows={1}
            value={text}
            placeholder="Ask or paste an image"
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="send" onClick={send}>
            {canSend ? 'Send' : 'Answer'}
          </button>
        </div>
      </footer>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          onClear={clearSession}
          listening={listening}
        />
      )}
    </div>
  )
}
