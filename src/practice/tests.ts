import type { Lang } from './runner'
import type { Compare, TestCase } from './problems'

// Test runs append a small harness to your code. It calls your function with
// each test's arguments and prints tagged lines that are parsed back here, so
// anything you print yourself is attributed to the test that printed it.

const START = '@@PADTEST:START:'
const RESULT = '@@PADTEST:RESULT:'
const END = '@@'

export interface TestResult {
  status: 'pass' | 'fail' | 'error' | 'invalid' | 'not-run'
  actual?: string // JSON of the returned value
  error?: string
  stdout: string
}

/** Parses each test's argument list; returns an error message for bad JSON. */
export function parseArgs(tc: TestCase): unknown[] | string {
  try {
    const v = JSON.parse(tc.args)
    return Array.isArray(v) ? v : [v]
  } catch {
    return 'Arguments must be a JSON array, e.g. [[1, 2, 3], 5]'
  }
}

export function harness(lang: Lang, fn: string, tests: TestCase[]): string {
  const argLists = tests.map((tc) => {
    const a = parseArgs(tc)
    return typeof a === 'string' ? null : a
  })
  const json = JSON.stringify(argLists)
  if (lang === 'python') {
    return `

import json as _pad_json
def _pad_default(o):
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    return repr(o)
for _pad_i, _pad_args in enumerate(_pad_json.loads(${JSON.stringify(json)})):
    if _pad_args is None:
        continue
    print("${START}%d${END}" % _pad_i)
    try:
        _pad_v = ${fn}(*_pad_args)
        print("${RESULT}" + _pad_json.dumps({"i": _pad_i, "value": _pad_v}, default=_pad_default) + "${END}")
    except Exception as _pad_e:
        print("${RESULT}" + _pad_json.dumps({"i": _pad_i, "error": type(_pad_e).__name__ + ": " + str(_pad_e)}) + "${END}")
`
  }
  return `
;{
  const __padTests = ${json};
  for (let __i = 0; __i < __padTests.length; __i++) {
    if (__padTests[__i] === null) continue;
    console.log('${START}' + __i + '${END}');
    try {
      const __v = await ${fn}(...__padTests[__i]);
      console.log('${RESULT}' + JSON.stringify({ i: __i, value: __v === undefined ? null : __v }) + '${END}');
    } catch (__e) {
      console.log('${RESULT}' + JSON.stringify({ i: __i, error: (__e && __e.name ? __e.name + ': ' : '') + (__e && __e.message ? __e.message : String(__e)) }) + '${END}');
    }
  }
}
`
}

/** Splits a test run's output into per-test results and leftover console text. */
export function parseRun(output: string, tests: TestCase[], compare: Compare): { results: TestResult[]; console: string } {
  const results: TestResult[] = tests.map((tc) =>
    typeof parseArgs(tc) === 'string'
      ? { status: 'invalid', error: parseArgs(tc) as string, stdout: '' }
      : { status: 'not-run', stdout: '' },
  )
  let consoleOut = ''
  let current: number | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith(START) && line.endsWith(END)) {
      current = Number(line.slice(START.length, -END.length))
      continue
    }
    if (line.startsWith(RESULT) && line.endsWith(END)) {
      try {
        const r = JSON.parse(line.slice(RESULT.length, -END.length))
        const res = results[r.i]
        if (res) {
          if ('error' in r) {
            res.status = 'error'
            res.error = r.error
          } else {
            res.actual = JSON.stringify(r.value)
            res.status = matches(r.value, tests[r.i].expected, compare) ? 'pass' : 'fail'
          }
        }
      } catch {}
      current = null
      continue
    }
    if (current != null && results[current]) results[current].stdout += line + '\n'
    else consoleOut += line + '\n'
  }
  return { results, console: consoleOut.replace(/\n+$/, '\n').replace(/^\n$/, '') }
}

function canonical(v: unknown, mode: Compare, depth = 0): string {
  if (Array.isArray(v)) {
    const parts = v.map((x) => canonical(x, mode, depth + 1))
    if (mode === 'unordered-nested' || (mode === 'unordered' && depth === 0)) parts.sort()
    return `[${parts.join(',')}]`
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort()
    return `{${keys.map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k], mode, depth + 1)).join(',')}}`
  }
  return JSON.stringify(v)
}

function matches(actual: unknown, expectedJson: string, mode: Compare): boolean {
  let expected: unknown
  try {
    expected = JSON.parse(expectedJson)
  } catch {
    return false
  }
  return canonical(actual, mode) === canonical(expected, mode)
}
