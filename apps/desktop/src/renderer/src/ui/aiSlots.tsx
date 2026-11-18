import { aiCoreCap, aiCoreIndustryUsed, aiCoreShipUsed, industryAiBonus } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'

export interface IndustryAiSlots {
  sharedCap: number
  bonus: number
  bonusRows: Array<{ id: string; name: string; level: number; perLevel: number; slots: number }>
  cap: number
  used: number
  refineUsed: number
  makeUsed: number
  labUsed: number
  shipUsed: number
}

export function aiIndustrySlots(state: GameState, ctx: SimContext): IndustryAiSlots {
  const sharedCap = aiCoreCap(state, ctx)
  const bonus = industryAiBonus(state, ctx)
  const refineUsed = state.refineRuns.filter((r) => r.worker !== 'pilot').length
  const makeUsed = state.manufacturingRuns.filter((r) => r.worker !== undefined && r.worker !== 'pilot').length
  const labUsed = (state.labRuns ?? []).filter((r) => r.active && r.worker !== 'pilot').length
  const table = ctx.balance?.aiCore?.industrySkillSlots ?? {}
  const bonusRows = Object.entries(table).map(([id, perLevel]) => {
    const level = state.skills.trained[id] ?? 0
    return {
      id,
      name: ctx.skills.get(id)?.name ?? id,
      level,
      perLevel: perLevel ?? 0,
      slots: level * (perLevel ?? 0),
    }
  })
  return {
    sharedCap,
    bonus,
    bonusRows,
    cap: sharedCap + bonus,
    used: aiCoreIndustryUsed(state),
    refineUsed,
    makeUsed,
    labUsed,
    shipUsed: aiCoreShipUsed(state),
  }
}

export function aiSlotTip(slots: IndustryAiSlots): string {
  const { sharedCap, bonus, bonusRows, cap, used, refineUsed, makeUsed, labUsed, shipUsed } = slots
  const detail =
    bonusRows.length > 0
      ? bonusRows.map((r) => tr("ui.aiSlots.001", { p1: r.name, p2: r.level, p3: r.slots })).join(tr("ui.MatterTechTab.017"))
      : tr("ui.aiSlots.002")
  return (
    tr("ui.aiSlots.003", { cap: cap, sharedCap: sharedCap }) +
    tr("ui.aiSlots.004", {
      bonus: bonus,
      detail: detail,
      used: used,
      refineUsed: refineUsed,
      makeUsed: makeUsed,
      labUsed: labUsed,
    }) +
    tr("ui.aiSlots.005", { shipUsed: shipUsed })
  )
}

export function AiSlotText({ state, ctx }: { state: GameState; ctx: SimContext }) {
  const slots = aiIndustrySlots(state, ctx)
  return (
    <span className="app-dim" title={aiSlotTip(slots)}>
      {tr("ui.aiSlots.006")} {slots.cap}{tr('ui.aiSlots.007', { n: slots.used })}
    </span>
  )
}
