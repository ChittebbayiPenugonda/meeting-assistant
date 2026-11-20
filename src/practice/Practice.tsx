import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '../components/Markdown'
import { Editor, type EditorHandle } from './Editor'
import { runCode, warmUp, type Lang } from './runner'
import { clearEdits, loadEdits, PROBLEMS, saveEdits, withEdits, type ProblemEdits, type TestCase } from './problems'
import { harness, parseRun, type TestResult } from './tests'

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

const LANG_KEY = 'practice-pad.lang'
const PROBLEM_KEY = 'practice-pad.problem'
const codeKey = (problem: string, l: Lang) => `practice-pad.code.${problem}.${l}`

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

export default function Practice() {
  const [lang, setLang] = useState<Lang>(() => (read(LANG_KEY) === 'javascript' ? 'javascript' : 'python'))
  const [problemId, setProblemId] = useState(() => {
    const saved = read(PROBLEM_KEY)
    return PROBLEMS.some((p) => p.id === saved) ? saved! : PROBLEMS[0].id
  })
  const [edits, setEdits] = useState<ProblemEdits>(() => loadEdits(problemId))
  const [editingDesc, setEditingDesc] = useState(false)
  const [results, setResults] = useState<TestResult[] | null>(null)
  const [consoleOut, setConsoleOut] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [running, setRunning] = useState<false | 'run' | 'tests'>(false)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const editor = useRef<EditorHandle>(null)

  const base = PROBLEMS.find((p) => p.id === problemId)!
  const problem = useMemo(() => withEdits(base, edits), [base, edits])
  const fn = problem.fn[lang]
  const edited = Object.keys(edits).length > 0

  // Load the problem's saved code (or its starter) whenever problem or language changes.
  useEffect(() => {
    editor.current?.setCode(read(codeKey(problemId, lang)) ?? base.starter[lang])
    write(LANG_KEY, lang)
    write(PROBLEM_KEY, problemId)
    setResults(null)
    setConsoleOut('')
    setLastMs(null)
    warmUp(lang)
  }, [lang, problemId])

  const pickProblem = (id: string) => {
    setEdits(loadEdits(id))
    setEditingDesc(false)
    setProblemId(id)
  }

  const updateEdits = (patch: ProblemEdits) => {
    const next = { ...edits, ...patch }
    setEdits(next)
    saveEdits(problemId, next)
  }

  const setTests = (tests: TestCase[]) => {
    updateEdits({ tests })
    setResults(null)
  }

  // Saved on every change (cheap), so switching problems can never write
  // one problem's code under another's key.
  const saveCode = () => write(codeKey(problemId, lang), editor.current?.getCode() ?? '')

  async function execute(mode: 'run' | 'tests') {
    if (running) return
    setRunning(mode)
    setConsoleOut('')
    if (mode === 'tests') setResults(problem.tests.map(() => ({ status: 'not-run', stdout: '' })))
    const code = editor.current?.getCode() ?? ''
    const full = mode === 'tests' ? code + harness(lang, fn, problem.tests) : code
    let live = ''
    const res = await runCode(
      lang,
      full,
      (t) => {
        live += t
        // Show plain runs live; test runs are shown once parsed.
        if (mode === 'run') setConsoleOut(live)
      },
      setStatus,
    )
    if (mode === 'tests') {
      const parsed = parseRun(res.output, problem.tests, problem.compare)
      setResults(parsed.results)
      setConsoleOut(parsed.console)
    }
    setStatus(null)
    setRunning(false)
    setLastMs(res.timedOut ? null : res.ms)
  }

  const resetCode = () => {
    if (!confirm('Replace your code with the starter for this problem?')) return
    editor.current?.setCode(base.starter[lang])
    write(codeKey(problemId, lang), base.starter[lang])
    setResults(null)
    setConsoleOut('')
  }

  const restoreProblem = () => {
    if (!confirm('Undo your changes to this problem’s description and test cases?')) return
    clearEdits(problemId)
    setEdits({})
    setResults(null)
  }

  const passed = results?.filter((r) => r.status === 'pass').length ?? 0

  return (
    <div className="pad">
      <header className="pad-top">
        <div className="brand">
          <span className="logo">{'</>'}</span> Practice Pad
        </div>
        <select value={problemId} onChange={(e) => pickProblem(e.target.value)} aria-label="Problem">
          {PROBLEMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
          <option value="python">Python 3</option>
          <option value="javascript">JavaScript</option>
        </select>
        <div className="spacer" />
        <button onClick={resetCode}>Reset code</button>
        <button onClick={() => execute('run')} disabled={!!running} title="Run the file as a script (⌘/Ctrl + Enter)">
          {running === 'run' ? 'Running…' : '▶ Run'}
        </button>
        <button className="run" onClick={() => execute('tests')} disabled={!!running || !problem.tests.length} title="Run every test case (⌘/Ctrl + ')">
          {running === 'tests' ? 'Testing…' : 'Run tests'}
        </button>
        <a className="back" href="../">
          Meeting Copilot
        </a>
      </header>

      <div className="pad-cols">
        {/* ---------- problem ---------- */}
        <section className="col problem">
          <div className="col-head">
            <h1>{problem.title}</h1>
            {problem.difficulty && <span className={`diff ${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>}
            <div className="spacer" />
            {edited && !editingDesc && (
              <button className="small ghost" onClick={restoreProblem}>
                Restore
              </button>
            )}
            <button className="small" onClick={() => setEditingDesc((v) => !v)}>
              {editingDesc ? 'Done' : 'Edit'}
            </button>
          </div>
          <div className="col-body">
            {editingDesc ? (
              <textarea
                className="desc-edit"
                value={problem.description}
                onChange={(e) => updateEdits({ description: e.target.value })}
                placeholder="Problem statement (Markdown supported)"
                autoFocus
              />
            ) : (
              <div className="prose">
                <Markdown text={problem.description} />
              </div>
            )}
          </div>
        </section>

        {/* ---------- code ---------- */}
        <section className="col code">
          <Editor ref={editor} lang={lang} onRun={() => execute('run')} onRunTests={() => execute('tests')} onChange={saveCode} />
        </section>

        {/* ---------- tests + output ---------- */}
        <section className="col tests">
          <div className="col-head">
            <h2>Test cases</h2>
            {results && results.some((r) => r.status !== 'not-run') && (
              <span className={`summary ${passed === problem.tests.length ? 'all' : ''}`}>
                {passed}/{problem.tests.length} passed
              </span>
            )}
            {status && <span className="muted small-text">{status}</span>}
          </div>
          <div className="col-body">
            <label className="fn">
              Function
              <input
                value={fn}
                spellCheck={false}
                onChange={(e) => updateEdits({ fn: { ...edits.fn, [lang]: e.target.value.trim() } })}
              />
            </label>

            {problem.tests.map((tc, i) => {
              const r = results?.[i]
              return (
                <div className={`case ${r?.status ?? ''}`} key={i}>
                  <div className="case-head">
                    <span className="badge">{r ? label(r.status) : `Case ${i + 1}`}</span>
                    {r && r.status !== 'not-run' && <span className="muted">Case {i + 1}</span>}
                    <div className="spacer" />
                    <button
                      className="small ghost"
                      onClick={() => setTests(problem.tests.filter((_, j) => j !== i))}
                      aria-label={`Delete case ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                  <Field label="Input (JSON list of arguments)" value={tc.args} onChange={(v) => setTests(problem.tests.map((x, j) => (j === i ? { ...x, args: v } : x)))} />
                  <Field label="Expected" value={tc.expected} onChange={(v) => setTests(problem.tests.map((x, j) => (j === i ? { ...x, expected: v } : x)))} />
                  {r?.actual !== undefined && (
                    <div className="kv">
                      <span>Output</span>
                      <code className={r.status === 'pass' ? 'ok' : 'bad'}>{r.actual}</code>
                    </div>
                  )}
                  {r?.error && (
                    <div className="kv">
                      <span>Error</span>
                      <code className="bad">{r.error}</code>
                    </div>
                  )}
                  {r?.stdout && (
                    <div className="kv">
                      <span>Printed</span>
                      <pre>{r.stdout}</pre>
                    </div>
                  )}
                </div>
              )
            })}

            <button className="add" onClick={() => setTests([...problem.tests, { args: '[]', expected: 'null' }])}>
              + Add test case
            </button>
            {problem.compare !== 'exact' && <p className="muted small-text">Order of the result doesn't matter for this problem.</p>}
          </div>

          <div className="console">
            <div className="console-head">
              Console
              {lastMs != null && !running && <span className="muted"> · {fmtMs(lastMs)}</span>}
              <div className="spacer" />
              <button className="small ghost" onClick={() => setConsoleOut('')}>
                Clear
              </button>
            </div>
            <pre>{consoleOut || <span className="muted">Output from ▶ Run and anything printed outside your function shows here.</span>}</pre>
          </div>
        </section>
      </div>
    </div>
  )
}

function label(s: TestResult['status']) {
  return { pass: 'Passed', fail: 'Failed', error: 'Error', invalid: 'Bad input', 'not-run': 'Not run' }[s]
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea rows={1} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
