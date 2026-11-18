// Runs candidate code off the main thread, so an infinite loop can be killed
// without freezing the page. Python uses Pyodide (CPython compiled to
// WebAssembly), loaded from jsDelivr the first time you run Python.

export type Lang = 'python' | 'javascript'

export interface RunResult {
  output: string
  error: boolean
  ms: number
  timedOut: boolean
}

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.8/full/'

const JS_WORKER = `
const fmt = (v) => {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}
const send = (stream, args) => postMessage({ type: 'out', stream, text: args.map(fmt).join(' ') + '\\n' })
console.log = console.info = console.debug = (...a) => send('stdout', a)
console.warn = console.error = (...a) => send('stderr', a)
onmessage = async (e) => {
  try {
    await (0, eval)('(async () => {\\n' + e.data.code + '\\n})()')
    postMessage({ type: 'done', error: false })
  } catch (err) {
    send('stderr', [err && err.stack ? err.stack : String(err)])
    postMessage({ type: 'done', error: true })
  }
}
`

const PY_WORKER = `
importScripts('${PYODIDE_URL}pyodide.js')
let py = null
async function ready() {
  if (!py) {
    postMessage({ type: 'status', text: 'Loading Python (first run only)…' })
    py = await loadPyodide({ indexURL: '${PYODIDE_URL}' })
    py.setStdout({ batched: (s) => postMessage({ type: 'out', stream: 'stdout', text: s + '\\n' }) })
    py.setStderr({ batched: (s) => postMessage({ type: 'out', stream: 'stderr', text: s + '\\n' }) })
    postMessage({ type: 'status', text: null })
  }
  return py
}
onmessage = async (e) => {
  try {
    const p = await ready()
    // Fresh globals each run, like running a new script.
    const ns = p.globals.get('dict')()
    await p.runPythonAsync(e.data.code, { globals: ns })
    ns.destroy()
    postMessage({ type: 'done', error: false })
  } catch (err) {
    postMessage({ type: 'out', stream: 'stderr', text: String(err && err.message ? err.message : err) + '\\n' })
    postMessage({ type: 'done', error: true })
  }
}
`

const workers: Partial<Record<Lang, Worker>> = {}

function workerFor(lang: Lang): Worker {
  let w = workers[lang]
  if (!w) {
    const src = lang === 'python' ? PY_WORKER : JS_WORKER
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })))
    workers[lang] = w
  }
  return w
}

/** Start loading Python in the background so the first Run is quick. */
export function warmUp(lang: Lang) {
  if (lang === 'python') workerFor('python').postMessage({ code: 'pass' })
}

export function runCode(
  lang: Lang,
  code: string,
  onOutput: (text: string, stream: 'stdout' | 'stderr') => void,
  onStatus: (text: string | null) => void,
  timeoutMs = lang === 'python' ? 15000 : 5000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const w = workerFor(lang)
    let output = ''
    let started = performance.now()
    let loading = false
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Kill the stuck worker; a fresh one is made next run.
        w.terminate()
        delete workers[lang]
        w.onmessage = null
        const msg = `\nStopped: still running after ${timeoutMs / 1000}s (infinite loop?)\n`
        onOutput(msg, 'stderr')
        resolve({ output: output + msg, error: true, ms: performance.now() - started, timedOut: true })
      }, timeoutMs)
    }
    arm()
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'status') {
        loading = !!m.text
        onStatus(m.text)
        if (!loading) {
          // Don't count Pyodide's download against the time limit.
          started = performance.now()
          arm()
        }
      } else if (m.type === 'out') {
        output += m.text
        onOutput(m.text, m.stream)
      } else if (m.type === 'done') {
        window.clearTimeout(timer)
        w.onmessage = null
        resolve({ output, error: m.error, ms: performance.now() - started, timedOut: false })
      }
    }
    w.postMessage({ code })
  })
}
