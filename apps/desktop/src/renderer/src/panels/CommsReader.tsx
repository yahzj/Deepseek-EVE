/**
 * 通讯「阅读器」公共件（2026-09-14 船长：「**将所有的通讯弹窗的外形，改成和通讯界面内的右侧界面的相同**」）。
 *
 * 为什么抽出来：同一块版式现在有**两个使用方**——
 * ① 通讯页右栏（机身 SVG + 内嵌屏幕 + 下檐口）；② 送达时的弹窗卡（**无机身**：屏幕 + 下檐口 + 「知道了」）。
 * 两处各写一份必然漂移 ⇒ 类名与结构收在这里**单点**（按约定第六章：先复刻同级既有结构/类名，
 * 不自造相似新样式）。改这里 = 通讯页与弹窗同时变。
 *
 * 版式（沿用通讯页既有语言，不是新造）：
 * - **屏幕**（`.app-comms-screen`）：圆角框 + `outline` 线段描边，自身滚动；内含
 *   第一层「发件方头像 + 标题 + 内容类型小片」、第二层「发件人 + 立场小片 + 送达时间」、第三层正文；
 * - **下檐口**（`.app-comms-eave`）：在滚动区外——上面一行 = 消息自带动作（只有序章简报有），
 *   下面一行 = 通栏「前往」；弹窗再把「知道了」追加在同一檐口里（`extra`）。
 * - `highlight` 命中的段落加**既有强调样式** `.app-report-highlight`（暗底 + 左侧强调竖条）。
 *
 * ⚠ 机身 SVG（`CommsDeviceFrame`）**只给通讯页**用：弹窗没有机身，船长要的那半就是"屏幕"。
 */
import type { ReactNode } from 'react'
import { COMMS_REPLIES_ENABLED } from '@whale/core'
import type { CommsEntryView } from '@whale/core'
import { Glyph } from '../ui/Glyphs'
import { tr } from '../i18n/locale'
import { commsAlignText, commsBodyText, commsClockText, commsHintText, commsKindText, commsSenderText, commsSubjectText } from '../ui/commsText'

/**
 * 通讯器机身：**大圆角机身外框** + 左侧两颗实体键（SVG 线稿，恒定细描边）。
 *
 * 只画机身：**内嵌屏幕的框由屏幕容器自己画**（`.app-comms-screen` 的圆角框 + CSS `outline` 描边）——
 * 这样"文字容器"与"圆角框"是同一圈，窗口不管多高多窄都不会错位（按百分比拉伸的内框会错位：
 * 机身 900px 高时内框在 39px 处、而屏幕容器内边距固定 20px，屏幕框整圈落在内框外面 ⇒ 文字看着在框外）。
 */
export function CommsDeviceFrame(): ReactNode {
  return (
    <svg className="app-comms-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {/* 机身 */}
      <rect x="1.1" y="1.1" width="97.8" height="97.8" rx="5" vectorEffect="non-scaling-stroke" />
      {/* 左侧两颗实体键（参考图侧键的抽象化，只留短线） */}
      <path d="M2.4 34 L2.4 42" vectorEffect="non-scaling-stroke" />
      <path d="M2.4 52 L2.4 58" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** 内嵌屏幕（正文区，自身滚动）：头像 + 标题 + 内容类型小片 / 发件人 + 立场 + 送达时间 / 正文段落 */
export function CommsScreen({ entry }: { entry: CommsEntryView }): ReactNode {
  return (
    <div className="app-comms-screen">
      {/* 屏幕第一层：左上角**发件方头像**（官方章鱼人）+ 标题（右侧内容类型小片） */}
      <div className="app-comms-title-row">
        {entry.glyph ? (
          <span
            className="app-comms-avatar"
            style={entry.tone ? { color: entry.tone, borderColor: entry.tone } : undefined}
            title={entry.fromBrief ?? tr("ui.CommsReader.001")}
          >
            <Glyph name={entry.glyph} size={50} />
          </span>
        ) : null}
        <div className="app-comms-title-col">
          {/* ⚠ 主题/发件人/时间都是**数据侧中文**（`CommsMessageDef.subject` 等）⇒ 一律过 `ui/commsText.ts`
              的单点映射取当前语言（2026-09-22 通讯本地化批）；查不到原样回落，不会变空 */}
          <span className="app-comms-title">{commsSubjectText(entry.id, entry.subject)}</span>
          {/* 细分隔条：发件人 + 立场小片 + 送达时间（压在标题正下方） */}
          <div className="app-comms-head">
            <span className="app-comms-head-from" style={entry.tone ? { color: entry.tone } : undefined}>
              {commsSenderText(entry.from)}
            </span>
            {entry.alignment ? (
              <span
                className="app-chip app-comms-align"
                style={entry.tone ? { color: entry.tone, borderColor: entry.tone } : undefined}
                title={entry.fromBrief}
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
        {commsBodyText(entry.id, entry.paragraphs).map((p, i) => (
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

/**
 * 机身下檐口（2026-09-11 船长定「乙」）：**通栏「前往」一行**，常驻且落在滚动区外——
 * 原先跳转按钮在屏幕滚动内容末尾，长信不往下翻就看不见（船长实测反馈）。
 * 下檐口由自然高度撑起，屏幕（flex:1）自动让位。
 *
 * `extra`：调用方追加的一行（弹窗放「知道了」）。
 * （2026-09-17 教程重做：消息「自带动作」机制整体退场，原先在这一行的动作按钮与 `onAction` 一并删除。）
 */
export function CommsEave({
  entry,
  onGoto,
  extra,
}: {
  entry: CommsEntryView
  /** 跳转出口（可带星图标签 `tab`、任务中心内层标签 `taskTab`、舰船标签 `shipTab`） */
  onGoto: (page: string, tab?: string, shipTab?: string, taskTab?: string) => void
  /** 追加行（弹窗的「知道了」） */
  extra?: ReactNode
}): ReactNode {
  if (!entry.hint && !extra) return null
  return (
    <div className="app-comms-eave">
      {entry.hint ? (
        <button
          className="app-btn is-primary app-comms-goto"
          title={commsHintText(entry.hint.text)}
          onClick={() => onGoto(entry.hint!.page, entry.hint!.tab, entry.hint!.shipTab, entry.hint!.taskTab)}
        >
          <span className="app-comms-goto-text">{commsHintText(entry.hint.text)}</span>
          <span className="app-comms-goto-label">{tr("ui.CommsReader.004")}</span>
        </button>
      ) : null}
      {extra ? <div className="app-comms-eave-extra">{extra}</div> : null}
    </div>
  )
}
