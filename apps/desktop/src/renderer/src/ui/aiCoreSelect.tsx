/**
 * **AI 核心下拉**（**2026-10-02 代码审查 → 模块化**）：精炼炉卡 · 实验室卡 · 组装机卡 · 舰船 AI 指派表
 * 原先各抄一份同一个 `<select>`（同款"无核心时置灰＋空档写明原因"口径，船长 2026-09-10），
 * 选项渲染（`aiCoreText ＋ 效率%`）与"可用核心"判据还散在各页 ⇒ 收成这一个公共件。
 *
 * 判据单点：可用列表走 core `usableAiCoresOf`（`AI_CORE_ORDER` 序 ＋ 持量 > 0）；效率显示走 core
 * `aiEfficiency`。**行为与收敛前逐字一致**：无可用核心 ⇒ 置灰、显示 `emptyLabel` 空档、`title` 换 `titleEmpty`。
 */
import type { ReactNode } from 'react'
import type { AiCoreType } from '@whale/core'
import { aiEfficiency, usableAiCoresOf } from '@whale/core'
import { aiCoreText } from './labelsText'
import type { GameEngine } from '../game/engine'

export function AiCoreSelect({
  engine,
  value,
  onPick,
  titleReady,
  titleEmpty,
  emptyLabel,
}: {
  engine: GameEngine
  /** 当前选中的档位（无可用核心时回落到空档，与旧实现同款） */
  value: AiCoreType | null
  onPick: (t: AiCoreType) => void
  /** 有可用核心时的悬停说明 */
  titleReady: string
  /** 无可用核心时的悬停说明 */
  titleEmpty: string
  /** 无可用核心时那枚空档的文案 */
  emptyLabel: string
}): ReactNode {
  const state = engine.state
  const usable = usableAiCoresOf(state)
  return (
    <select
      className="app-select"
      value={usable.length === 0 ? '' : (value ?? '')}
      onChange={(e) => onPick(e.target.value as AiCoreType)}
      disabled={usable.length === 0}
      title={usable.length === 0 ? titleEmpty : titleReady}
    >
      {usable.length === 0 ? (
        <option value="">{emptyLabel}</option>
      ) : (
        usable.map((t) => (
          <option key={t} value={t}>
            {aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
          </option>
        ))
      )}
    </select>
  )
}
