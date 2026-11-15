import { group, speakerLabel, type Seg } from '../transcript'

export function TranscriptView({
  finals,
  interim,
  me,
  expanded,
  onToggle,
  onPickMe,
  status,
  placeholder,
  hint,
}: {
  finals: Seg[]
  interim: Seg
  me: string | null
  expanded: boolean
  onToggle: () => void
  onPickMe: (spk: string) => void
  status: string | false
  placeholder: string
  hint?: React.ReactNode
}) {
  const groups = group(finals)
  const shown = expanded ? groups : groups.slice(-4)
  const empty = !groups.length && !interim.text

  return (
    <div className="transcript" onClick={onToggle}>
      {status && <span className="checking">{status}</span>}
      {hint}
      {!expanded && groups.length > shown.length && <span className="muted">… </span>}
      {shown.map((g, i) => {
        const label = speakerLabel(g.spk, me)
        return (
          <div className={`seg ${g.spk && g.spk === me ? 'mine' : ''}`} key={i}>
            {label && (
              <button
                className={`who ${g.spk === me ? 'me' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onPickMe(g.spk!)
                }}
                title="Tap to mark this voice as yours"
              >
                {label}
              </button>
            )}
            {g.text}
          </div>
        )
      })}
      {interim.text && (
        <div className="seg interim">
          {speakerLabel(interim.spk, me) && <span className="who ghost">{speakerLabel(interim.spk, me)}</span>}
          {interim.text}
        </div>
      )}
      {empty && <span className="muted">{placeholder}</span>}
    </div>
  )
}
