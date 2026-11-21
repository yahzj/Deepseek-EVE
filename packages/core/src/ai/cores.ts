import type { GameState } from '../state'
import type { SimContext, AiCoreType } from '../types'
import { AI_CORE_ORDER, countAiCore, spendAiCore, gainAiCore, aiCoreName } from '../aiCores'
import { matterTechSum } from '../matterTech'
import type { CoreBlockReason, CommandResult } from '../engine'
import { shipInReturn } from '../mining'
import { commandShipDeployed, stationShipTaskBlock } from '../combat/command/locks'
import { busyLabel } from '../busyLabels'

export function aiEfficiency(state: GameState, ctx: SimContext, type: AiCoreType): number {
  const base = ctx.balance.aiCore.efficiency[type] ?? 1
  const dLv = Math.min(5, state.skills.trained[ctx.balance.aiCore.dispatchSkillId] ?? 0)
  return Math.min(1, base + ctx.balance.aiCore.dispatchPerLevel * dLv)
}

export function usableAiCoresOf(state: GameState): AiCoreType[] {
  return AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
}

export function bestAiCoreOf(state: GameState): AiCoreType | null {
  for (let i = AI_CORE_ORDER.length - 1; i >= 0; i -= 1) {
    const t = AI_CORE_ORDER[i]!
    if (countAiCore(state, t) > 0) return t
  }
  return null
}

export function aiServicingUpgradeMult(state: GameState): number {
  return 1 - 0.01 * Math.min(5, state.skills.trained['ai-servicing-integration'] ?? 0)
}

export function occupyAiCore(state: GameState, type: AiCoreType): boolean {
  return spendAiCore(state, type)
}

export function releaseAiCore(state: GameState, type: AiCoreType): void {
  gainAiCore(state, type)
}

export function aiCoreCap(state: GameState, ctx: SimContext): number {
  let cap = 0
  cap += state.skills.trained[ctx.balance.aiCore.skillId] ?? 0
  return cap
}

export function aiCoreShipUsed(state: GameState): number {
  const autoRuns = (state.wormholeAuto ?? []).filter(run => run.expeditionRules !== undefined).length
  return Object.keys(state.aiAssignments).length + autoRuns
}

export function aiCoreIndustryUsed(state: GameState): number {
  let used = 0
  for (const r of state.refineRuns) {
    if (r.worker !== 'pilot') used += 1
  }
  for (const m of state.manufacturingRuns) {
    if (m.worker !== undefined && m.worker !== 'pilot') used += 1
  }
  for (const l of state.labRuns ?? []) {
    if (l.active && l.worker !== 'pilot') used += 1
  }
  return used
}

export function aiCoreUsed(state: GameState): number {
  return aiCoreShipUsed(state) + aiCoreIndustryUsed(state)
}

export function industryAiBonus(state: GameState, ctx: SimContext): number {
  const table = ctx.balance?.aiCore?.industrySkillSlots
  let bonus = matterTechSum(state, ctx, 'industryAiSlots')
  if (!table) return bonus
  for (const [id, perLevel] of Object.entries(table)) {
    bonus += (state.skills.trained[id] ?? 0) * (perLevel ?? 0)
  }
  return bonus
}

export function aiCoreCapBlock(state: GameState, ctx: SimContext, scope: 'ship' | 'industry' = 'ship'): CoreBlockReason | null {
  const cap = aiCoreCap(state, ctx)
  const bonus = industryAiBonus(state, ctx)
  const eff = cap + bonus
  if (eff <= 0 || (scope === 'ship' && cap <= 0)) {
    return {
      error:
        'AI 核心上限为 0：训练提升 AI 核心上限的技能（如「AI 核心操作学」）后才能启用 AI 核心（AI 副船任务与站内精炼炉/回收炉/制造线/实验室共用上限）。',
      errorId: 'core.ai.041',
    }
  }
  const shipUsed = aiCoreShipUsed(state)
  const indUsed = aiCoreIndustryUsed(state)
  if (scope === 'ship') {
    const indOnShared = Math.max(0, indUsed - bonus)
    const used = shipUsed + indOnShared
    if (used >= cap) {
      if (indOnShared > 0) {
        return {
          error: `AI 核心启用已满（${used}/${cap}：副船 ${shipUsed} 枚 + 站内工业超出「工业自动化」扩容 ${indOnShared} 枚）：先停用部分站内工业 AI 或 AI 副船任务再启用新的。`,
          errorId: 'core.ai.042',
          errorParams: { p1: used, p2: cap, p3: shipUsed, p4: indOnShared },
        }
      }
      return {
        error: `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线）再启用新的。`,
        errorId: 'core.ai.043',
        errorParams: { p1: used, p2: cap },
      }
    }
    return null
  }
  const used = shipUsed + indUsed
  if (used >= eff) {
    if (bonus > 0) {
      return {
        error: `AI 核心启用已满（${used}/${eff}：共用上限 ${cap} + 工业扩容 ${bonus}）：先停用其它 AI 核心（AI 副船任务或站内炉/线/实验室），或训练「工业自动化」再扩工业工位。`,
        errorId: 'core.ai.044',
        errorParams: { p1: used, p2: eff, p3: cap, p4: bonus },
      }
    }
    return {
      error: `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线/实验室）再启用新的。`,
      errorId: 'core.ai.045',
      errorParams: { p1: used, p2: cap },
    }
  }
  return null
}

export function idleAiShipIds(state: GameState): string[] {
  const inHole = state.wormhole.run?.fleet ?? []
  return Object.keys(state.fleet).filter(
    (id) =>
      id !== state.shipId && !inHole.includes(id) && !(id in state.aiAssignments) && !shipInReturn(state, id) && !commandShipDeployed(state, id)
      && !(state.wormholeAuto ?? []).some(run => run.shipIds.includes(id))
      && !(state.planetary?.deliveries ?? []).some(d => d.shipUid === id) && !stationShipTaskBlock(state, id),
  )
}

export function checkAssignable(state: GameState, shipId: string, coreType: AiCoreType, ctx: SimContext): CommandResult {
  const station = stationShipTaskBlock(state, shipId)
  if (station) return { ok: false, ...station }
  if (commandShipDeployed(state, shipId)) return { ok: false, ...busyLabel('expedition') }
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return { ok: false, error: '星球物资运输中', errorId: 'core.busy.031' }
  if (shipId === state.shipId) return { ok: false, error: '主控船由你亲自驾驶，不能指派 AI。', errorId: 'core.ai.003' }
  if (!state.fleet[shipId]) return { ok: false, error: '舰队里没有这艘船。', errorId: 'core.ai.004' }
  if (shipId in state.aiAssignments) return { ok: false, error: '这艘船已有 AI 任务。', errorId: 'core.ai.005' }
  if ((state.wormholeAuto ?? []).some((r) => r.shipIds.includes(shipId))) {
    return {
      ok: false,
      error: '这艘船正在自动探索中（已锁定）：等它返航，或先在「扫描虫洞」页召回那一趟。',
      errorId: 'core.ai.006',
    }
  }
  const capBlock = aiCoreCapBlock(state, ctx)
  if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
  if (countAiCore(state, coreType) <= 0) {
    return {
      ok: false,
      error: `${aiCoreName(coreType)} 库存不足（效率 ${Math.round(aiEfficiency(state, ctx, coreType) * 100)}%）。`,
      errorId: 'core.ai.046',
      errorParams: { p1: aiCoreName(coreType), p2: Math.round(aiEfficiency(state, ctx, coreType) * 100) },
    }
  }
  if (state.mining.active || state.expedition.active) {
  }
  return { ok: true }
}
