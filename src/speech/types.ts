export interface SpeechHandlers {
  /**
   * Text that may still change (the phrase being spoken right now).
   * `speaker` is a stable id for the voice when the engine can tell voices
   * apart (Deepgram), otherwise undefined.
   */
  onInterim: (text: string, speaker?: string) => void
  /** Text the recognizer has committed, one call per run of a single speaker. */
  onFinal: (text: string, speaker?: string) => void
  onError: (message: string) => void
  /** Called when the engine actually starts or stops capturing. */
  onState: (listening: boolean) => void
}

export interface SpeechEngine {
  start(): Promise<void>
  stop(): void
}
