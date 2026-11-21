import { tr } from '../i18n/locale'
import { commsDialogueText } from './commsText'

export function Communicator({
  script,
  onClose,
}: {
  script: { id?: string; title: string; lines: readonly { speaker: string; text: string }[] }
  onClose: () => void
}) {
  const text = commsDialogueText(script)
  return (
    <div className="app-comm-mask" onClick={onClose}>
      <div className="app-comm" onClick={(e) => e.stopPropagation()}>
        <div className="app-comm-title">{text.title}</div>
        <div className="app-comm-body">
          {text.lines.map((l, i) => (
            <div key={i} className="app-comm-line">
              <span className="app-comm-speaker">{l.speaker}</span>
              <span className="app-comm-text">{l.text}</span>
            </div>
          ))}
        </div>
        <div className="app-comm-foot">
          <button className="app-btn is-small is-primary" onClick={onClose}>
            {tr('ui.Expedition.048')}
          </button>
        </div>
      </div>
    </div>
  )
}
