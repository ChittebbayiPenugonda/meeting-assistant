import { useEffect, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './Editor'
import { runCode, warmUp, type Lang } from './runner'

const STARTERS: Record<Lang, string> = {
  python: `# Write your solution here, then press Run (⌘/Ctrl + Enter).

def solution():
    pass


print(solution())
`,
  javascript: `// Write your solution here, then press Run (⌘/Ctrl + Enter).

function solution() {
}

console.log(solution());
`,
}

const LANG_KEY = 'practice-pad.lang'
const codeKey = (l: Lang) => `practice-pad.code.${l}`

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}

export default function Practice() {
  const [lang, setLang] = useState<Lang>(() => (read(LANG_KEY) === 'javascript' ? 'javascript' : 'python'))
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const editor = useRef<EditorHandle>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  // Load the saved code for the current language.
  useEffect(() => {
    editor.current?.setCode(read(codeKey(lang)) ?? STARTERS[lang])
    write(LANG_KEY, lang)
    setOutput('')
    setLastMs(null)
    warmUp(lang)
  }, [lang])

  const save = () => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => write(codeKey(lang), editor.current?.getCode() ?? ''), 400)
  }

  async function run() {
    if (running) return
    setRunning(true)
    setOutput('')
    const res = await runCode(lang, editor.current?.getCode() ?? '', (t) => setOutput((o) => o + t), setStatus)
    setStatus(null)
    setRunning(false)
    setLastMs(res.timedOut ? null : res.ms)
  }

  const reset = () => {
    if (!confirm('Replace your code with the empty starter?')) return
    editor.current?.setCode(STARTERS[lang])
    write(codeKey(lang), STARTERS[lang])
    setOutput('')
  }

  return (
    <div className="pad">
      <header className="pad-top">
        <div className="brand">
          <span className="logo">{'</>'}</span> Practice Pad
        </div>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
          <option value="python">Python 3</option>
          <option value="javascript">JavaScript</option>
        </select>
        <button className="run" onClick={run} disabled={running} title="Run (⌘/Ctrl + Enter)">
          {running ? 'Running…' : '▶ Run'}
        </button>
        <button onClick={reset}>Reset</button>
        <div className="spacer" />
        <a className="back" href="../">
          Meeting Copilot
        </a>
      </header>

      <section className="pad-left solo">
        <Editor ref={editor} lang={lang} onRun={run} onChange={save} />
        <div className="pad-output">
          <div className="pad-output-head">
            Output
            {status && <span className="muted">· {status}</span>}
            {!status && lastMs != null && <span className="muted">· {lastMs < 1000 ? `${Math.round(lastMs)} ms` : `${(lastMs / 1000).toFixed(1)} s`}</span>}
            <button onClick={() => setOutput('')}>Clear</button>
          </div>
          <pre>{output || <span className="muted">Run your code to see output here.</span>}</pre>
        </div>
      </section>
    </div>
  )
}
