import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'
import type { Lang } from './runner'

export interface EditorHandle {
  getCode(): string
  setCode(code: string): void
}

const langExt = (l: Lang) => (l === 'python' ? python() : javascript())

export const Editor = forwardRef<
  EditorHandle,
  { lang: Lang; onRun: () => void; onRunTests?: () => void; onChange?: () => void }
>(function Editor({ lang, onRun, onRunTests, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const langConf = useRef(new Compartment())
  const runRef = useRef(onRun)
  runRef.current = onRun
  const testsRef = useRef(onRunTests)
  testsRef.current = onRunTests
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  runRef.current()
                  return true
                },
              },
              {
                key: "Mod-'",
                run: () => {
                  testsRef.current?.()
                  return true
                },
              },
            ]),
          ),
          langConf.current.of(langExt(lang)),
          oneDark,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current?.()
          }),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '14px' } }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: langConf.current.reconfigure(langExt(lang)) })
  }, [lang])

  useImperativeHandle(ref, () => ({
    getCode: () => view.current?.state.doc.toString() ?? '',
    setCode: (code: string) => {
      const v = view.current
      if (!v) return
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } })
      // Put the cursor at the end of the stub, ready to type.
      v.dispatch({ selection: { anchor: v.state.doc.length } })
      v.focus()
    },
  }))

  return <div className="pad-editor" ref={host} />
})
