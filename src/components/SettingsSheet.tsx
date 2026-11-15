import { MODELS, type Effort, type ModelId, type Settings, type SttProvider } from '../settings'

export function SettingsSheet({
  settings: s,
  onChange,
  onClose,
  onClear,
  listening,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
  onClear: () => void
  listening: boolean
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v })

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-head">
        <h2>Settings</h2>
        <button className="done" onClick={onClose} disabled={!s.apiKey}>
          Done
        </button>
      </div>
      <div className="sheet-body">
        {!s.apiKey && (
          <p className="intro">
            Paste an Anthropic API key to get started. It's stored only in this browser on this phone and sent only to
            Anthropic. Get one at console.anthropic.com.
          </p>
        )}

        <label>
          Anthropic API key
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={s.apiKey}
            placeholder="sk-ant-…"
            onChange={(e) => set('apiKey', e.target.value.trim())}
          />
        </label>

        <label>
          Model
          <select value={s.model} onChange={(e) => set('model', e.target.value as ModelId)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Thinking effort
          <select value={s.effort} onChange={(e) => set('effort', e.target.value as Effort)}>
            <option value="low">Low (fastest)</option>
            <option value="medium">Medium</option>
            <option value="high">High (hard coding problems)</option>
          </select>
        </label>

        {s.model === 'claude-opus-5-5' && (
          <label className="check">
            <input type="checkbox" checked={s.fast} onChange={(e) => set('fast', e.target.checked)} />
            <span>
              Fast mode
              <small>Up to 2.5× faster output at 2× the price.</small>
            </span>
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={s.think} onChange={(e) => set('think', e.target.checked)} />
          <span>
            Think before answering
            <small>Better on hard problems, but adds a delay before the first word. Opus always thinks.</small>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={s.webSearch} onChange={(e) => set('webSearch', e.target.checked)} />
          <span>
            Web search
            <small>Claude can search and read pages when a question needs current facts. $10 per 1,000 searches.</small>
          </span>
        </label>

        <label>
          About me and this call
          <textarea
            rows={6}
            value={s.context}
            placeholder="Your role, résumé highlights, the job description, the meeting agenda, the tech stack… Answers about you are tailored to this."
            onChange={(e) => set('context', e.target.value)}
          />
        </label>

        <h3>Listening</h3>

        <label>
          Speech recognition
          <select value={s.stt} disabled={listening} onChange={(e) => set('stt', e.target.value as SttProvider)}>
            <option value="webspeech">Safari built-in (free)</option>
            <option value="deepgram">Deepgram (tells you and them apart; needs key)</option>
          </select>
        </label>
        {listening && <small className="hint">Stop listening to change the recognizer.</small>}

        {s.stt === 'deepgram' && (
          <label>
            Deepgram API key
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={s.deepgramKey}
              onChange={(e) => set('deepgramKey', e.target.value.trim())}
            />
          </label>
        )}

        <label>
          Language
          <select value={s.lang} disabled={listening} onChange={(e) => set('lang', e.target.value)}>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-IN">English (India)</option>
            <option value="en-AU">English (Australia)</option>
          </select>
        </label>

        <button className="danger" onClick={onClear}>
          Clear transcript and answers
        </button>

        <p className="fine">
          Keep the phone near your laptop's speaker (not headphones), with this page open and the screen on. Let people
          on the call know if you're transcribing it.
        </p>
      </div>
    </div>
  )
}
