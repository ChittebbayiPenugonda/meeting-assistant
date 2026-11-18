import { useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, type Settings } from '../settings'
import { createDeepgram } from '../speech/deepgram'
import { createWebSpeech, webSpeechSupported } from '../speech/webSpeech'
import type { SpeechEngine } from '../speech/types'
import { describeError } from '../llm'
import { Markdown } from '../components/Markdown'
import { Editor, type EditorHandle } from './Editor'
import { runCode, warmUp, type Lang } from './runner'
import { createSpeaker, sentenceChunker, VOICES, type Speaker } from './voice'
import {
  feedback,
  interviewerTurn,
  loadPractice,
  parseReply,
  savePractice,
  type History,
  type PracticeConfig,
  type TurnHandle,
} from './interviewer'

type Phase = 'setup' | 'live' | 'ended'
type Who = 'interviewer' | 'you' | 'note'
interface Line {
  id: number
  who: Who
  text: string
}

// How long you must stop talking before your turn is sent. Candidates pause
// to think, so this is longer than the Meeting Copilot's trigger.
const END_OF_TURN_MS = 1400
// Ignore the mic briefly after the interviewer stops, so its voice coming
// out of the speakers isn't transcribed as yours.
const ECHO_TAIL_MS = 700
const QUIET_NUDGE_MS = 3 * 60 * 1000

let lineId = 0

export default function Practice() {
  const [keys, setKeys] = useState<Settings>(loadSettings)
  const [cfg, setCfg] = useState<PracticeConfig>(loadPractice)
  const [phase, setPhase] = useState<Phase>('setup')
  const [lines, setLines] = useState<Line[]>([])
  const [state, setState] = useState<'idle' | 'thinking' | 'speaking'>('idle')
  const [hearing, setHearing] = useState('')
  const [muted, setMuted] = useState(false)
  const [output, setOutput] = useState('')
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [report, setReport] = useState('')
  const [typed, setTyped] = useState('')

  const editor = useRef<EditorHandle>(null)
  const history = useRef<History>([])
  const lastRun = useRef<string | null>(null)
  const speaker = useRef<Speaker | null>(null)
  const stt = useRef<SpeechEngine | null>(null)
  const pending = useRef('')
  const turnTimer = useRef<number | undefined>(undefined)
  const inFlight = useRef<TurnHandle | null>(null)
  const startedAt = useRef(0)
  const speakingUntil = useRef(0)
  const lastSpeech = useRef(0)
  const nudged = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const keysRef = useRef(keys)
  keysRef.current = keys
  const transcriptEnd = useRef<HTMLDivElement>(null)

  const addLine = (who: Who, text: string) => {
    const id = ++lineId
    setLines((ls) => [...ls, { id, who, text }])
    return id
  }
  const setLine = (id: number, text: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text } : l)))
  const dropLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id))

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' })
  }, [lines, hearing])

  useEffect(() => {
    if (phase !== 'live') return
    const t = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current)
      // A long silence: give the interviewer a chance to check in (once).
      if (!inFlight.current && !speaker.current?.speaking && !pending.current && !nudged.current) {
        if (Date.now() - lastSpeech.current > QUIET_NUDGE_MS) {
          nudged.current = true
          sendTurn('(The candidate has been quiet for about three minutes, probably coding.)', true)
        }
      }
    }, 1000)
    return () => window.clearInterval(t)
  }, [phase])

  const minutes = () => Math.round((Date.now() - startedAt.current) / 60000)

  // ---------- one interviewer turn ----------

  function sendTurn(said: string, isNote = false) {
    if (phaseRef.current !== 'live') return
    window.clearTimeout(turnTimer.current)
    pending.current = ''
    setHearing('')
    if (!isNote) addLine('you', said)
    setState('thinking')

    const chunker = sentenceChunker()
    let lineIdForReply: number | null = null
    let padApplied = false

    const handle = interviewerTurn(
      keysRef.current.apiKey,
      cfgRef.current,
      history.current,
      { said, code: editor.current?.getCode() ?? '', lastRun: lastRun.current, elapsedMin: minutes() },
      (raw) => {
        const r = parseReply(raw)
        if (r.maybeSilent) return
        if (r.pad != null && !padApplied) {
          padApplied = true
          editor.current?.setCode(r.pad + '\n')
          lastRun.current = null
          setOutput('')
        }
        const text = r.spoken.replace(/\s+/g, ' ').trim()
        if (text) {
          if (lineIdForReply == null) lineIdForReply = addLine('interviewer', text)
          else setLine(lineIdForReply, text)
        }
        for (const s of chunker.next(r.spoken)) speaker.current?.say(s)
      },
    )
    inFlight.current = handle

    handle.done
      .then(async (raw) => {
        const r = parseReply(raw)
        if (r.silent) {
          setState('idle')
          return
        }
        for (const s of chunker.next(r.spoken, true)) speaker.current?.say(s)
        await speaker.current?.drained()
        if (r.ended) endInterview()
      })
      .catch((err) => {
        if (/abort/i.test(String(err)) || err?.name === 'APIUserAbortError') return
        setBanner(describeError(err))
      })
      .finally(() => {
        if (inFlight.current === handle) inFlight.current = null
        if (!speaker.current?.speaking) setState('idle')
        // You kept talking while it was thinking: that's your next turn.
        if (pending.current.trim()) armTurn()
      })
  }

  function armTurn() {
    window.clearTimeout(turnTimer.current)
    turnTimer.current = window.setTimeout(() => {
      const said = pending.current.trim()
      if (!said) return
      if (inFlight.current || speaker.current?.speaking) return // picked up when it finishes
      sendTurn(said)
    }, END_OF_TURN_MS)
  }

  const ignoringMic = () => mutedRef.current || !!speaker.current?.speaking || Date.now() < speakingUntil.current

  // ---------- start / stop ----------

  async function start() {
    const k = keysRef.current
    if (!k.apiKey) {
      setBanner('Add your Anthropic API key first.')
      return
    }
    saveSettings(k)
    savePractice(cfg)
    setBanner(null)
    setLines([])
    setReport('')
    setOutput('')
    history.current = []
    lastRun.current = null
    nudged.current = false
    editor.current?.setCode('')
    warmUp(cfg.lang)

    const sp = createSpeaker(k.deepgramKey, cfg.voice, (m) => setBanner(m))
    sp.onSpeakingChange = (on) => {
      if (on) setState('speaking')
      else {
        speakingUntil.current = Date.now() + ECHO_TAIL_MS
        if (!inFlight.current) setState('idle')
        if (pending.current.trim()) armTurn()
      }
    }
    speaker.current = sp

    const handlers = {
      onInterim: (t: string) => {
        if (ignoringMic() || !t) return
        lastSpeech.current = Date.now()
        nudged.current = false
        setHearing((pending.current + ' ' + t).trim())
        window.clearTimeout(turnTimer.current) // still talking
      },
      onFinal: (t: string) => {
        if (ignoringMic()) return
        lastSpeech.current = Date.now()
        nudged.current = false
        pending.current = (pending.current + ' ' + t).trim()
        setHearing(pending.current)
        armTurn()
      },
      onError: (m: string) => setBanner(m),
      onState: () => {},
    }
    let engine: SpeechEngine | null = null
    if (k.deepgramKey) engine = createDeepgram(k.deepgramKey, 'en-US', handlers)
    else if (webSpeechSupported()) engine = createWebSpeech('en-US', handlers)
    else setBanner('No speech recognition in this browser. Use Chrome or Safari, add a Deepgram key, or type your answers.')
    stt.current = engine

    startedAt.current = Date.now()
    lastSpeech.current = Date.now()
    setElapsed(0)
    phaseRef.current = 'live'
    setPhase('live')
    await engine?.start()
    sendTurn('(The call just connected. Greet the candidate briefly and start with the first question.)', true)
  }

  function interrupt() {
    inFlight.current?.abort()
    speaker.current?.stop()
    setState('idle')
  }

  function endInterview() {
    if (phaseRef.current !== 'live') return
    window.clearTimeout(turnTimer.current)
    inFlight.current?.abort()
    speaker.current?.stop()
    stt.current?.stop()
    phaseRef.current = 'ended'
    setPhase('ended')
    setState('idle')
    setHearing('')
    const stream = feedback(keysRef.current.apiKey, cfgRef.current, history.current, {
      said: '(interview ended)',
      code: editor.current?.getCode() ?? '',
      lastRun: lastRun.current,
      elapsedMin: minutes(),
    })
    let text = ''
    stream.on('text', (d) => {
      text += d
      setReport(text)
    })
    stream.finalMessage().catch((err) => setBanner(describeError(err)))
  }

  useEffect(
    () => () => {
      stt.current?.stop()
      speaker.current?.stop()
    },
    [],
  )

  // ---------- running code ----------

  async function run() {
    if (running) return
    setRunning(true)
    setOutput('')
    const res = await runCode(
      cfgRef.current.lang,
      editor.current?.getCode() ?? '',
      (t) => setOutput((o) => o + t),
      setRunStatus,
    )
    setRunStatus(null)
    setRunning(false)
    lastRun.current = (res.output || '(no output)') + (res.error ? '\n[exited with an error]' : '')
  }

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const testVoice = () => {
    const sp = createSpeaker(keys.deepgramKey, cfg.voice, (m) => setBanner(m))
    sp.say("Hi, thanks for joining. Let's get started with the first problem.")
  }

  // ---------- UI ----------

  return (
    <div className="pad">
      <header className="pad-top">
        <div className="brand">
          <span className="logo">{'</>'}</span> Practice Pad
        </div>
        <select
          value={cfg.lang}
          disabled={phase === 'live'}
          onChange={(e) => setCfg({ ...cfg, lang: e.target.value as Lang })}
          aria-label="Language"
        >
          <option value="python">Python 3</option>
          <option value="javascript">JavaScript</option>
        </select>
        <button className="run" onClick={run} disabled={running} title="Run (⌘/Ctrl + Enter)">
          {running ? 'Running…' : '▶ Run'}
        </button>
        <div className="spacer" />
        {phase === 'live' && <span className="timer">{fmtTime(elapsed)}</span>}
        {phase === 'live' ? (
          <button className="end" onClick={endInterview}>
            End interview
          </button>
        ) : (
          <button className="start" onClick={() => setPhase('setup')}>
            New interview
          </button>
        )}
        <a className="back" href="../">
          Meeting Copilot
        </a>
      </header>

      {banner && (
        <div className="pad-banner" onClick={() => setBanner(null)}>
          {banner}
        </div>
      )}

      <div className="pad-main">
        <section className="pad-left">
          <Editor ref={editor} lang={cfg.lang} onRun={run} />
          <div className="pad-output">
            <div className="pad-output-head">
              Output {runStatus && <span className="muted">· {runStatus}</span>}
              <button onClick={() => setOutput('')}>Clear</button>
            </div>
            <pre>{output || <span className="muted">Run your code to see output here.</span>}</pre>
          </div>
        </section>

        <aside className="pad-right">
          <div className={`avatar ${state}`}>
            <div className="ring" />
            <div className="face">AI</div>
            <div className="caption">
              {phase !== 'live'
                ? 'Interviewer'
                : state === 'speaking'
                  ? 'Speaking…'
                  : state === 'thinking'
                    ? 'Thinking…'
                    : muted
                      ? 'Your mic is muted'
                      : 'Listening'}
            </div>
          </div>

          {phase === 'live' && (
            <div className="controls">
              <button className={muted ? 'on' : ''} onClick={() => setMuted((m) => !m)}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={interrupt} disabled={state === 'idle'}>
                Interrupt
              </button>
              <button
                onClick={() => pending.current.trim() && !inFlight.current && sendTurn(pending.current.trim())}
                disabled={!hearing}
                title="Send what you've said without waiting for a pause"
              >
                Done talking
              </button>
            </div>
          )}

          <div className="convo">
            {lines.map((l) => (
              <div className={`line ${l.who}`} key={l.id}>
                <b>{l.who === 'interviewer' ? 'Interviewer' : l.who === 'you' ? 'You' : ''}</b> {l.text}
              </div>
            ))}
            {hearing && (
              <div className="line you live">
                <b>You</b> {hearing}
              </div>
            )}
            {report && (
              <div className="report prose">
                <Markdown text={report} />
              </div>
            )}
            <div ref={transcriptEnd} />
          </div>

          {phase === 'live' && (
            <form
              className="typebox"
              onSubmit={(e) => {
                e.preventDefault()
                const t = typed.trim()
                if (!t || inFlight.current) return
                setTyped('')
                lastSpeech.current = Date.now()
                sendTurn(t)
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type to the interviewer…" />
            </form>
          )}
        </aside>
      </div>

      {phase === 'setup' && (
        <div className="pad-modal">
          <div className="pad-card">
            <h2>Mock technical interview</h2>
            <p className="muted">
              An AI interviewer talks to you, puts problems in the pad, watches your code and runs, and gives written
              feedback at the end. Use headphones for the cleanest audio, or speakers if you want Meeting Copilot on your
              phone to hear the interviewer too.
            </p>

            <div className="grid2">
              <label>
                Anthropic API key
                <input
                  type="password"
                  value={keys.apiKey}
                  placeholder="sk-ant-…"
                  onChange={(e) => setKeys({ ...keys, apiKey: e.target.value.trim() })}
                />
              </label>
              <label>
                Deepgram API key <small>(natural voice + better listening)</small>
                <input
                  type="password"
                  value={keys.deepgramKey}
                  placeholder="Optional"
                  onChange={(e) => setKeys({ ...keys, deepgramKey: e.target.value.trim() })}
                />
              </label>
              <label>
                Role
                <input value={cfg.role} onChange={(e) => setCfg({ ...cfg, role: e.target.value })} />
              </label>
              <label>
                Length
                <select value={cfg.minutes} onChange={(e) => setCfg({ ...cfg, minutes: Number(e.target.value) })}>
                  {[20, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Interviewer voice
                <div className="row">
                  <select
                    value={cfg.voice}
                    disabled={!keys.deepgramKey}
                    onChange={(e) => setCfg({ ...cfg, voice: e.target.value })}
                  >
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={testVoice}>
                    Test
                  </button>
                </div>
                {!keys.deepgramKey && <small>Without a Deepgram key, your browser's built-in voice is used.</small>}
              </label>
              <label>
                Language
                <select value={cfg.lang} onChange={(e) => setCfg({ ...cfg, lang: e.target.value as Lang })}>
                  <option value="python">Python 3</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </label>
            </div>

            <label>
              Questions <small>(in order; edit freely)</small>
              <textarea rows={9} value={cfg.questions} onChange={(e) => setCfg({ ...cfg, questions: e.target.value })} />
            </label>

            <div className="actions">
              <button className="start big" onClick={start}>
                Start interview
              </button>
            </div>
            <p className="fine">
              Keys are stored only in this browser and shared with Meeting Copilot on the same site. Claude costs roughly
              10–20 cents per interview; Deepgram listening and voice add roughly 30–50 cents more.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
