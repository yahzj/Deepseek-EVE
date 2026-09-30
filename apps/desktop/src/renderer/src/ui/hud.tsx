/**
 * **HUD 通用小件**（**2026-09-30 船长令**：「和之前技能树一样，先复制现有工业页面…」＋
 * 「**现在文字太多了，适量的图标也不能拉下**」）。
 *
 * 两个件是"少字多图标"的最小公共语汇，工业 HUD 页与舰船页跃迁燃料页共用（避免两处各写一份）：
 * - `IconBtn`：**图标按钮** —— 图标 ＋（可选）2~4 字；语义说明一律走 `title`（全仓 `ui/Tooltip.tsx` 接管）；
 * - `Readout`：**图标读数** —— 图标 ＋ 数字；单位/口径走 `title`。
 *
 * 样式全部挂在 `.hud` 命名空间（`ui/layout-css/_hud-industry.css`）⇒ 不影响任何既有页面。
 */
import type { ReactNode } from 'react'
import { Glyph } from './Glyphs'
import { RowGlyph } from './itemView'
import { tr } from '../i18n/locale'

export function IconBtn({
  glyph,
  label,
  title,
  primary,
  disabled,
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaControls,
}: {
  glyph: string
  label?: string
  title: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  /** 无障碍名（**仅图标按钮**必须给：SVG 是 `aria-hidden`，不给就没有名字）。
   *  ⚠ 只放**稳定的**名字（如所在面板名）；"这一下会发生什么"走 `title`，状态走 `ariaExpanded`。 */
  ariaLabel?: string
  /** 折叠/展开类开关的当前状态（缺省不写 ⇒ 普通按钮不谎报状态） */
  ariaExpanded?: boolean
  /** 该开关控制的元素 id（与 `ariaExpanded` 配对使用） */
  ariaControls?: string
}): ReactNode {
  return (
    <button
      className={`hud-btn${primary ? ' is-primary' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaExpanded !== undefined ? ariaControls : undefined}
    >
      <Glyph name={glyph} size={14} color="currentColor" />
      {label !== undefined ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
    </button>
  )
}

export function Readout({ glyph, value, title }: { glyph: string; value: ReactNode; title: string }): ReactNode {
  return (
    <span className="hud-row" style={{ gap: 6 }} title={title}>
      <Glyph name={glyph} size={13} color="currentColor" />
      <b>{value}</b>
    </span>
  )
}

/* ═══════════ 悬浮卡（左输入 / 右输出）═══════════
 * **2026-09-30 船长令**：工位行的悬停卡要"在投料窗口内也要有"，并点名
 * 「**因为还需要应用到组装机和造船厂，所以请对左侧输入进行一定优化**」。
 * ⇒ 左列不能写死成"一味料"，必须是**清单形态（1..N 行材料）**：
 *   · 精炼 / 回收 / 拆解（单料）：一行材料 ＋ 若干**规格行**（每批件数 / 手上件数 / 每批秒数）；
 *   · 组装机 / 造船厂（多料）：逐材料一行（图标 ＋ 名 ＋ 需要 ×N），缺料由卡底那行文字点出。
 * 结构（`.hud-io` 两列）与工位卡原本的写法一致，只是抽成公共件、四个页签共用一份。
 *
 * **同日追加令**（「**工业生产项如果缺料的话，在悬浮窗内，缺料的项目需换红色字体
 * （或者其他方式标注出来）**」）⇒ 缺料行＝**红字（`--hud-bad`，＋加粗）＋ 行尾真值「缺 N」**：
 * 依据 `ui-ux-pro-max` Accessibility · **Color Only**（High）「Don't convey information by color
 * alone」/「Do: Use icons/text in addition to color」/「Don't: Red/green only for error/success」
 * ⇒ **红色只是补充，文字才是主载体**（同条也是仓库硬线「颜色不能是唯一载体」）。
 * ⚠ 只在"**未开工**"的项上标（旧工业页 `.app-bp-mat.is-short` 那条口径：制造中/在跑的红字会被
 * 误读成故障）——在跑的工位卡因此不传 `ok`。 */

/** 悬浮卡里的一行：**有图标 = 材料行**；**没图标 = 规格行**（整行弱化读数，如「每批 100 件」） */
export interface HudIoLine {
  glyph?: string
  name?: ReactNode
  /** 行尾读数（材料行 = 「×N」/「×N · 手上 M」；规格行不用） */
  qty?: ReactNode
  /** 输入列专用：这一项够不够（不够 ⇒ 整行红字加粗；**缺多少另有文字**，见 `short`） */
  ok?: boolean
  /**
   * 输入列专用：**缺多少的成文真值**（如「缺 12」/「缺 12 m³」）——由调用点按 core 口径算好，
   * 这里只负责摆；与 `ok: false` 配对使用（红字 ＋ 文字两件一起，缺一不算达标）。
   */
  short?: ReactNode
}

function IoLine({ line }: { line: HudIoLine }): ReactNode {
  if (line.glyph === undefined) return <div className="hud-io-num">{line.name}</div>
  /* 缺多少**单独起一行**（**2026-09-30 船长令**：「缺料的文本也单独起一行」）——
     与书架卡「每味料两行」（名/需要一行、（可用：M）另起一行）同一手法：
     行内只留"叫什么、够不够得上色"，读数另起一行 ⇒ 不挤、不折行。 */
  return (
    <>
      <div className={`hud-io-row${line.ok === false ? ' is-short' : ''}`}>
        <RowGlyph glyph={line.glyph} />
        <span>{line.name}</span>
        {line.qty !== undefined ? <b className="hud-io-num">{line.qty}</b> : null}
      </div>
      {line.short !== undefined ? <div className="hud-io-short">{line.short}</div> : null}
    </>
  )
}

/**
 * 悬浮卡骨架：标题行 ＋（左输入 / 右输出）两列 ＋ 可选脚注。
 * 纯展示件——判定与取数全在调用点（各页的 `…Tip()`），这里不认任何业务口径。
 */
export function HudHoverCard({
  title,
  input,
  output,
  note,
  emptyOutput,
}: {
  title: ReactNode
  input: readonly HudIoLine[]
  output: readonly HudIoLine[]
  note?: ReactNode
  emptyOutput?: ReactNode
}): ReactNode {
  return (
    <>
      <span className="app-ship-hover-title">{title}</span>
      <div className="hud-io">
        <div className="hud-io-col">
          <div className="hud-tiny">{tr('ui.hud.116')}</div>
          {input.map((l, i) => (
            <IoLine key={i} line={l} />
          ))}
        </div>
        <div className="hud-io-col">
          <div className="hud-tiny">{tr('ui.hud.120')}</div>
          {output.length === 0 ? (
            <div className="hud-io-num">{emptyOutput ?? tr('ui.hud.122')}</div>
          ) : (
            output.map((l, i) => <IoLine key={i} line={l} />)
          )}
        </div>
      </div>
      {note !== undefined ? <div className="app-info-note">{note}</div> : null}
    </>
  )
}
