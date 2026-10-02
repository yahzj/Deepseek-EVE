/**
 * **通讯弹层**（2026-10-02 从 `panels/Expedition.tsx` 拆出 · 批次 4o · 零行为变化）。
 *
 * 本文件 = 通讯剧本弹层组件（标题 + 逐条发言 + 关闭按钮）——只依赖 `i18n/locale` 的 `tr`。
 * `Expedition.tsx` 原样再导出（先例：fitted.ts），App.tsx 的既有引用零改动。
 */
import { tr } from '../i18n/locale'

export function Communicator({
  script,
  onClose,
}: {
  script: { title: string; lines: readonly { speaker: string; text: string }[] }
  onClose: () => void
}) {
  return (
    <div className="app-comm-mask" onClick={onClose}>
      <div className="app-comm" onClick={(e) => e.stopPropagation()}>
        <div className="app-comm-title">{script.title}</div>
        <div className="app-comm-body">
          {script.lines.map((l, i) => (
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
