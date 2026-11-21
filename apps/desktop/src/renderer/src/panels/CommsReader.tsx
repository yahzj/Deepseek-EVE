import type { ReactNode } from 'react'
import { COMMS_REPLIES_ENABLED } from '@whale/core'
import type { CommsEntryView } from '@whale/core'
import { Glyph } from '../ui/Glyphs'
import { tr } from '../i18n/locale'
import { commsAlignText, commsBriefText, commsClockText, commsEntryBodyText, commsEntrySubjectText, commsHintText, commsKindText, commsSenderText } from '../ui/commsText'

const idAsName = (id: string): string => id

export function CommsDeviceFrame(): ReactNode {
  return (
    <svg className="app-comms-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {/* 经典布局：大圆角机身外框 + 左侧两颗实体键 */}
      <g className="app-comms-frame-classic">
        <rect x="1.1" y="1.1" width="97.8" height="97.8" rx="5" vectorEffect="non-scaling-stroke" />
        <path d="M2.4 34 L2.4 42" vectorEffect="non-scaling-stroke" />
        <path d="M2.4 52 L2.4 58" vectorEffect="non-scaling-stroke" />
      </g>
      {/* 现代 HUD 布局：硬朗缺角战术终端机身 + 实体科技侧键 */}
      <g className="app-comms-frame-modern">
        <polygon
          points="1.2,2.8 2.8,1.2 97.2,1.2 98.8,2.8 98.8,97.2 97.2,98.8 2.8,98.8 1.2,97.2"
          vectorEffect="non-scaling-stroke"
        />
        <path d="M1.2 30 L3.5 30 L3.5 44 L1.2 44" vectorEffect="non-scaling-stroke" />
        <path d="M1.2 50 L3.5 50 L3.5 60 L1.2 60" vectorEffect="non-scaling-stroke" />
        <path d="M92 1.2 L98.8 8" vectorEffect="non-scaling-stroke" />
        <path d="M1.2 92 L8 98.8" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  )
}

export function CommsScreen({
  entry,
  itemNameOf = idAsName,
}: {
  entry: CommsEntryView
  itemNameOf?: (itemId: string) => string
}): ReactNode {
  return (
    <div className="app-comms-screen">
      {/* 屏幕第一层：左上角**发件方头像**（官方章鱼人）+ 标题（右侧内容类型小片） */}
      <div className="app-comms-title-row">
        {entry.glyph ? (
          <span
            className="app-comms-avatar"
            style={entry.tone ? { color: entry.tone, borderColor: entry.tone } : undefined}
            title={entry.fromBrief ? commsBriefText(entry.fromBrief) : tr("ui.CommsReader.001")}
          >
            <Glyph name={entry.glyph} size={50} />
          </span>
        ) : null}
        <div className="app-comms-title-col">
          {/* ⚠ 主题/发件人/时间都是**数据侧中文**（`CommsMessageDef.subject` 等）⇒ 一律过 `ui/commsText.ts`
              的单点映射取当前语言（2026-09-22 通讯本地化批）；查不到原样回落，不会变空 */}
          <span className="app-comms-title">{commsEntrySubjectText(entry, itemNameOf)}</span>
          {/* 细分隔条：发件人 + 立场小片 + 送达时间（压在标题正下方） */}
          <div className="app-comms-head">
            <span className="app-comms-head-from" style={entry.tone ? { color: entry.tone } : undefined}>
              {commsSenderText(entry.from)}
            </span>
            {entry.alignment ? (
              <span
                className="app-chip app-comms-align"
                style={entry.tone ? { color: entry.tone, borderColor: entry.tone } : undefined}
                title={entry.fromBrief ? commsBriefText(entry.fromBrief) : undefined}
              >
                {commsAlignText(entry.alignment)}
              </span>
            ) : null}
            <span className="app-comms-head-time">{commsClockText(entry.deliveredAtGameMs)} {tr("ui.CommsReader.002")}</span>
          </div>
        </div>
        {entry.kind ? (
          <span
            className="app-chip app-comms-kind"
            style={entry.tone ? { color: entry.tone, borderColor: entry.tone } : undefined}
            title={tr("ui.CommsReader.003")}
          >
            {commsKindText(entry.kind)}
          </span>
        ) : null}
      </div>
      {/* 正文；`highlight` 里的段落加**既有强调样式**（`.app-report-highlight`：暗底 + 左侧强调竖条）。
          ⚠ 强调判定**比对中文原文**（`entry.paragraphs[i]`）——英译整段替换后不能拿译文去比对，
          否则高亮丢（`highlight` 存的是数据侧中文段落）。 */}
      <div className="app-comms-lines">
        {commsEntryBodyText(entry, itemNameOf).map((p, i) => (
          <p key={i} className={`app-comms-text${entry.highlight?.includes(entry.paragraphs[i] ?? '') ? ' app-report-highlight' : ''}`}>
            {p}
          </p>
        ))}
      </div>
      {/* 回复选项：接口保留、本期不启用（COMMS_REPLIES_ENABLED = false → 不渲染任何控件） */}
      {COMMS_REPLIES_ENABLED && entry.replies && entry.replies.length > 0 ? (
        <div className="app-comms-replies">
          {entry.replies.map((r) => (
            <button key={r.id} className="app-btn is-small" disabled>
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CommsEave({
  entry,
  onGoto,
  onAction,
  extra,
}: {
  entry: CommsEntryView
  onGoto: (page: string, tab?: string, shipTab?: string, taskTab?: string, skillBranch?: string) => void
  onAction?: (action: string) => void
  extra?: ReactNode
}): ReactNode {
  if (!entry.hint && !extra) return null
  const action = entry.action !== undefined && onAction !== undefined ? entry.action : undefined
  const page = entry.hint?.page
  return (
    <div className="app-comms-eave">
      {entry.hint && (action !== undefined || page !== undefined) ? (
        <button
          className="app-btn is-primary app-comms-goto"
          title={commsHintText(entry.hint.text)}
          onClick={() =>
            action !== undefined ? onAction!(action) : onGoto(page!, entry.hint!.tab, entry.hint!.shipTab, entry.hint!.taskTab, entry.hint!.skillBranch)
          }
        >
          <span className="app-comms-goto-text">{commsHintText(entry.hint.text)}</span>
          <span className="app-comms-goto-label">{tr("ui.CommsReader.004")}</span>
        </button>
      ) : null}
      {extra ? <div className="app-comms-eave-extra">{extra}</div> : null}
    </div>
  )
}
