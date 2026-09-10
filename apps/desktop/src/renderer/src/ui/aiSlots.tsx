/**
 * AI 核心占用显示（2026-09-10 船长：工业页「精炼炉 / 组装机」说明精简为一句话，同时把
 * 「可启动 AI 上限」与「当前 AI 占用数量」直接显示出来）。
 *
 * 口径与 AI 指挥中心（ShipPage · AI 指挥中心标题行「AI 核心启用 used/totalCap（共用 cap + 工业扩容 bonus）」）
 * 以及引擎守卫 @whale/core aiCoreCapBlock(state, ctx, 'industry') 完全同源：
 * - 可启动上限 = 共用上限（aiCoreCap，由「AI 核心操作学」决定）+ 工业专用扩容（industryAiBonus，由「工业自动化」决定）；
 * - 当前占用 = 站内工业占用（aiCoreIndustryUsed = AI 精炼炉/回收炉台数 + AI 制造线条数）；
 * - AI 副船任务（aiCoreShipUsed）与站内工业共用总上限，故在提示里一并写出，避免数字对不上。
 *
 * 本文件 = 「AI 核心占用」展示的唯一实现（检索入口：grep `AiSlotText|aiIndustrySlots`），
 * 供工业页精炼炉/组装机两处标题行复用；将来其它需要同款计数的地方直接引用本组件。
 */
import { aiCoreCap, aiCoreIndustryUsed, aiCoreShipUsed, industryAiBonus } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'

/** 站内工业 AI 工位数字（供标题行与提示共用） */
export interface IndustryAiSlots {
  /** 共用上限（AI 核心操作学等级） */
  sharedCap: number
  /** 工业专用扩容（工业自动化：只对炉/线生效） */
  bonus: number
  /** 站内工业可启动上限 = 共用上限 + 工业扩容 */
  cap: number
  /** 当前站内工业占用（AI 精炼炉/回收炉 + AI 制造线） */
  used: number
  /** 其中：AI 精炼炉/回收炉台数 */
  refineUsed: number
  /** 其中：AI 制造线条数 */
  makeUsed: number
  /** AI 副船任务占用（与站内工业共用总上限） */
  shipUsed: number
}

/** 取站内工业 AI 工位数字（与引擎同口径） */
export function aiIndustrySlots(state: GameState, ctx: SimContext): IndustryAiSlots {
  const sharedCap = aiCoreCap(state, ctx)
  const bonus = industryAiBonus(state, ctx)
  const refineUsed = state.refineRuns.filter((r) => r.worker !== 'pilot').length
  const makeUsed = state.manufacturingRuns.filter((r) => r.worker !== undefined && r.worker !== 'pilot').length
  return {
    sharedCap,
    bonus,
    cap: sharedCap + bonus,
    used: aiCoreIndustryUsed(state),
    refineUsed,
    makeUsed,
    shipUsed: aiCoreShipUsed(state),
  }
}

/** 悬停提示：上限怎么来的、占用算在哪（数字对不上时照这里核对） */
export function aiSlotTip(slots: IndustryAiSlots): string {
  const { sharedCap, bonus, cap, used, refineUsed, makeUsed, shipUsed } = slots
  return (
    `站内 AI 核心可启动上限 ${cap} 枚 = 共用上限 ${sharedCap}（AI 核心操作学）` +
    `+ 工业专用扩容 ${bonus}（工业自动化）；当前占用 ${used} 枚（精炼炉/回收炉 ${refineUsed} 台 + 制造线 ${makeUsed} 条）。` +
    `AI 副船任务另占 ${shipUsed} 艘，与站内工业共用同一总上限。`
  )
}

/** 标题行的「AI 核心可启动 3 · 占用 2」计数（数字与 AI 指挥中心同源；悬停看上限构成） */
export function AiSlotText({ state, ctx }: { state: GameState; ctx: SimContext }) {
  const slots = aiIndustrySlots(state, ctx)
  return (
    <span className="app-dim" title={aiSlotTip(slots)}>
      AI 核心可启动 {slots.cap} · 占用 {slots.used}
    </span>
  )
}
