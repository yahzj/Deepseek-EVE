import { type ReactNode } from 'react'
import { aiEfficiency, countAiCore, type AiCoreType } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { aiCoreText } from '../../ui/labelsText'
import { tr } from '../../i18n/locale'

/**
 * **「优先使用的 AI」选择器**（**2026-09-30 船长令**：「将选择AI的下拉框移动到…队列的顶部…
 * 并添加一个'优先使用的AI：'在其左侧并显示对应AI核心的剩余数量」＋「将工业几个页面都添加AI选择」
 * ＋「实验室放到配方顶部」）。
 *
 * 四个页签（精炼炉 / 组装机 / 造船厂 / 实验室）**共用这一个实现与同一枚页面级状态** `coreSel`：
 * 落点＝各页签"队列/配方"窗口的**顶部**（精炼炉=工位、组装机=制造队列、造船厂=在建舰船、实验室=配方详情）。
 *
 * 为什么这么排（`ui-ux-pro-max` 判定，2026-09-30）：
 * - Forms · **Input Labels**（High）「Every input needs a visible label」⇒ 左侧那句可见标签就是它
 *   （改前只有 `title`，触屏与键盘玩家都读不到"这个下拉框是干嘛的"）；
 * - Accessibility · **Contextual Live Badge Updates**（High）「announce a meaningful contextual status
 *   such as 3 items in cart」/「Don't: Announce a bare number or make every badge a competing live
 *   region」⇒ 剩余数写成「剩余 N 枚」整句、并挂 `aria-describedby`（focus 时读一次），**不做 live region**
 *   （起炉/停炉都会改这个数，做成播报区会很吵）。
 *
 * 护栏：`id` 带页签后缀（同页只渲染一个页签，但避免重复 id）；`select` 只带一个 `title`
 * （§九之七 一个元素一个悬停机制）；计数是**文字**、不靠颜色（颜色不能是唯一载体）。
 */
export function AiCorePick({
  engine,
  suffix,
  core,
  usableCores,
  onPick,
  pilotNote = false,
}: {
  engine: GameEngine
  /** 页签后缀（`refine` / `craft` / `shipyard` / `lab`）：拼进 `id`，避免同页重复 */
  suffix: string
  /** 当前生效的核心（`null` = 一枚可用核心都没有） */
  core: AiCoreType | null
  usableCores: readonly AiCoreType[]
  onPick: (t: AiCoreType) => void
  /** 是否附上「主控手上一台」那枚说明 chip（原先就挂在精炼炉那一处，照旧保留） */
  pilotNote?: boolean
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  return (
    <div className="hud-row wrap hud-aipick">
      <label className="hud-label" htmlFor={`hud-ai-core-${suffix}`}>
        {tr('ui.hud.148')}
      </label>
      <select
        id={`hud-ai-core-${suffix}`}
        className="hud-select"
        value={core ?? ''}
        onChange={(e) => onPick(e.target.value as AiCoreType)}
        disabled={usableCores.length === 0}
        title={tr('ui.hud.048')}
        aria-describedby={`hud-ai-stock-${suffix}`}
      >
        {usableCores.length === 0 ? (
          <option value="">{tr('ui.hud.049')}</option>
        ) : (
          usableCores.map((t) => (
            <option key={t} value={t}>
              {aiCoreText(t)} · {Math.round(aiEfficiency(state, ctx, t) * 100)}%
            </option>
          ))
        )}
      </select>
      {/* 剩余数量：core 既有取数口 `countAiCore`（＝核心库剩余；起炉会消耗一枚） */}
      <span className="hud-chip" id={`hud-ai-stock-${suffix}`}>
        {core !== null ? tr('ui.hud.149', { p1: countAiCore(state, core) }) : tr('ui.hud.049')}
      </span>
      {pilotNote ? <span className="hud-chip">{tr('ui.hud.050')}</span> : null}
    </div>
  )
}
