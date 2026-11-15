// A piece of transcript from one speaker. `spk` is set only when the speech
// engine can tell voices apart (Deepgram); Safari's recognizer leaves it empty.
export interface Seg {
  text: string
  spk?: string
}

export interface Group {
  spk?: string
  text: string
}

/** Merges consecutive segments from the same speaker. */
export function group(segs: Seg[]): Group[] {
  const out: Group[] = []
  for (const s of segs) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && last.spk === s.spk) last.text += ' ' + s.text
    else out.push({ spk: s.spk, text: s.text })
  }
  return out
}

export function speakerLabel(spk: string | undefined, me: string | null): string | null {
  if (!spk) return null
  if (me) return spk === me ? 'Me' : 'Them'
  return `Speaker ${Number(spk.split(':')[1] ?? 0) + 1}`
}

/** Transcript text for Claude: labeled lines when speakers are known, plain text otherwise. */
export function toText(segs: Seg[], me: string | null): string {
  const groups = group(segs)
  if (!groups.some((g) => g.spk)) return groups.map((g) => g.text).join(' ')
  return groups.map((g) => `${speakerLabel(g.spk, me) ?? 'Unknown'}: ${g.text}`).join('\n')
}
