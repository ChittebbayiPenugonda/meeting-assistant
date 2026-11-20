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
let current = 0 // id of the run whose output we're capturing
const send = (stream, args) => postMessage({ id: current, type: 'out', stream, text: args.map(fmt).join(' ') + '\\n' })
console.log = console.info = console.debug = (...a) => send('stdout', a)
console.warn = console.error = (...a) => send('stderr', a)
async function run({ id, code }) {
  current = id
  try {
    await (0, eval)('(async () => {\\n' + code + '\\n})()')
    postMessage({ id, type: 'done', error: false })
  } catch (err) {
    send('stderr', [err && err.stack ? err.stack : String(err)])
    postMessage({ id, type: 'done', error: true })
  }
}
// One run at a time, in order.
let queue = Promise.resolve()
onmessage = (e) => { queue = queue.then(() => run(e.data)) }
`

const PY_WORKER = `
importScripts('${PYODIDE_URL}pyodide.js')
let py = null
let current = 0 // id of the run whose output we're capturing
async function ready() {
  if (!py) {
    postMessage({ type: 'status', text: 'Loading Python (first run only)…' })
    py = await loadPyodide({ indexURL: '${PYODIDE_URL}' })
    py.setStdout({ batched: (s) => postMessage({ id: current, type: 'out', stream: 'stdout', text: s + '\\n' }) })
    py.setStderr({ batched: (s) => postMessage({ id: current, type: 'out', stream: 'stderr', text: s + '\\n' }) })
    postMessage({ type: 'status', text: null })
  }
  return py
}
async function run({ id, code }) {
  try {
    const p = await ready()
    current = id
    // Fresh globals each run, like running a new script.
    const ns = p.globals.get('dict')()
    await p.runPythonAsync(code, { globals: ns })
    ns.destroy()
    postMessage({ id, type: 'done', error: false })
  } catch (err) {
    // Drop Pyodide's own frames so the traceback starts at your code.
    let msg = String(err && err.message ? err.message : err)
    const lines = msg.split('\\n')
    const k = lines.findIndex((l) => l.includes('File "<exec>"'))
    if (k > 0) msg = 'Traceback (most recent call last):\\n' + lines.slice(k).join('\\n')
    postMessage({ id, type: 'out', stream: 'stderr', text: msg.trimEnd() + '\\n' })
    postMessage({ id, type: 'done', error: true })
  }
}
// One run at a time, in order, so the warm-up and a quick first Run can't mix.
let queue = Promise.resolve()
onmessage = (e) => { queue = queue.then(() => run(e.data)) }
`

const workers: Partial<Record<Lang, Worker>> = {}
let nextId = 1
// Python is ready once Pyodide has downloaded in the current worker.
let pyReady = false
const pyReadyListeners = new Set<() => void>()

function workerFor(lang: Lang): Worker {
  let w = workers[lang]
  if (!w) {
    const src = lang === 'python' ? PY_WORKER : JS_WORKER
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })))
    workers[lang] = w
    if (lang === 'python') {
      pyReady = false
      w.addEventListener('message', (e) => {
        if (e.data.type === 'status' && !e.data.text) {
          pyReady = true
          pyReadyListeners.forEach((f) => f())
          pyReadyListeners.clear()
        }
      })
    }
  }
  return w
}

/** Start loading Python in the background so the first Run is quick. */
export function warmUp(lang: Lang) {
  // id 0: no run listens for it, so its messages are ignored.
  if (lang === 'python') workerFor('python').postMessage({ id: 0, code: 'pass' })
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
    const runId = nextId++
    let output = ''
    let started = performance.now()
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
    const onReady = () => {
      onStatus(null)
      started = performance.now()
      arm()
    }
    if (lang === 'python' && !pyReady) {
      // Don't count Pyodide's download against the time limit.
      onStatus('Loading Python (first run only)…')
      pyReadyListeners.add(onReady)
    } else {
      arm()
    }
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'status' || m.id !== runId) {
        return // status is handled above; anything else is from the warm-up or an earlier run
      } else if (m.type === 'out') {
        output += m.text
        onOutput(m.text, m.stream)
      } else if (m.type === 'done') {
        window.clearTimeout(timer)
        pyReadyListeners.delete(onReady)
        onStatus(null)
        w.onmessage = null
        resolve({ output, error: m.error, ms: performance.now() - started, timedOut: false })
      }
    }
    w.postMessage({ id: runId, code })
  })
}
