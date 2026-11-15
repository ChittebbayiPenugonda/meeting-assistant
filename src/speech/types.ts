export interface SpeechHandlers {
  /** Text that may still change (the phrase being spoken right now). */
  onInterim: (text: string) => void
  /** Text the recognizer has committed. */
  onFinal: (text: string) => void
  onError: (message: string) => void
  /** Called when the engine actually starts or stops capturing. */
  onState: (listening: boolean) => void
}

export interface SpeechEngine {
  start(): Promise<void>
  stop(): void
}
