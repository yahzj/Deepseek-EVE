import { ceilFinalQuantity } from './quantity'
import { addLog } from './state'
import type { GameState } from './state'
import { addWare, countWare, removeWare } from './inventory'
import { peakFirst } from './firstTasks'
import type { MatterTechEffect, MatterTechNodeDef, SimContext } from './types'
import { WORMHOLE_TECH_BUFFS_NONE } from './wormholeMatter'
import type { WormholeTechBuffs } from './wormholeMatter'

export const MATTER_TECH_ESSENCE_ITEM_ID = 'mat-wh-essence'

export function matterTechNodes(ctx: SimContext): readonly MatterTechNodeDef[] {
  return ctx.matterTech ? [...ctx.matterTech.values()] : []
}

export function matterTechNodeOf(ctx: SimContext, id: string): MatterTechNodeDef | undefined {
  return ctx.matterTech?.get(id)
}

export function matterTechLevel(state: GameState, id: string): number {
  return state.research?.levels[id] ?? 0
}

export function matterTechLevels(state: GameState): Readonly<Record<string, number>> {
  return state.research?.levels ?? {}
}

export function matterTechEssenceHeld(state: GameState): number {
  return countWare(state, MATTER_TECH_ESSENCE_ITEM_ID)
}

export function matterTechCostAt(
  node: MatterTechNodeDef,
  level: number,
): { essence: number; isk: number } {
  const i = Math.max(0, Math.floor(level))
  const pick = (arr: readonly number[]): number =>
    arr.length === 0 ? 0 : (arr[Math.min(i, arr.length - 1)] ?? 0)
  return { essence: ceilFinalQuantity(pick(node.essence)), isk: ceilFinalQuantity(pick(node.isk)) }
}

export function matterTechPrereqMissing(
  state: GameState,
  ctx: SimContext,
  node: MatterTechNodeDef,
): string[] {
  const out: string[] = []
  for (const [id, need] of Object.entries(node.prereq ?? {})) {
    const have = matterTechLevel(state, id)
    if (have >= need) continue
    const dep = matterTechNodeOf(ctx, id)
    out.push(`${dep?.name ?? id} ${need} 级（现有 ${have} 级）`)
  }
  return out
}

export function matterTechCanResearch(
  state: GameState,
  ctx: SimContext,
  id: string,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  node?: MatterTechNodeDef
  cost?: { essence: number; isk: number }
} {
  const node = matterTechNodeOf(ctx, id)
  if (!node) return { ok: false, error: '没有这项研究。', errorId: 'core.matterTech.001' }
  const level = matterTechLevel(state, id)
  if (level >= node.maxLevel) {
    return { ok: false, error: '这项研究已经满级。', errorId: 'core.matterTech.002', node }
  }
  const missing = matterTechPrereqMissing(state, ctx, node)
  if (missing.length > 0) {
    return {
      ok: false,
      error: `前置未满：${missing.join('、')}。`,
      errorId: 'core.matterTech.003',
      errorParams: { p1: missing.join('、') },
      node,
    }
  }
  const cost = matterTechCostAt(node, level)
  const have = matterTechEssenceHeld(state)
  if (have < cost.essence) {
    return {
      ok: false,
      error: `虫洞谜质不足：需要 ${cost.essence} 枚，现有 ${have} 枚。`,
      errorId: 'core.matterTech.004',
      errorParams: { p1: cost.essence, p2: have },
      node,
      cost,
    }
  }
  if (state.wallet.isk < cost.isk) {
    return {
      ok: false,
      error: `信用点不足：需要 ${cost.isk.toLocaleString('zh-CN')}。`,
      errorId: 'core.matterTech.005',
      errorParams: { p1: cost.isk.toLocaleString('zh-CN') },
      node,
      cost,
    }
  }
  return { ok: true, node, cost }
}

export function researchMatterTech(
  state: GameState,
  ctx: SimContext,
  id: string,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  level?: number
} {
  const can = matterTechCanResearch(state, ctx, id)
  if (!can.ok || !can.node || !can.cost) {
    return {
      ok: false,
      error: can.error ?? '无法研究。',
      errorId: can.errorId ?? (can.error === undefined ? 'core.matterTech.006' : undefined),
      errorParams: can.errorParams,
    }
  }
  const node = can.node
  const before = matterTechLevel(state, id)
  if (can.cost.essence > 0) {
    const taken = removeWare(state, MATTER_TECH_ESSENCE_ITEM_ID, can.cost.essence)
    if (!taken) return { ok: false, error: '虫洞谜质不足（账变）。', errorId: 'core.matterTech.007' }
  }
  state.wallet.isk -= can.cost.isk
  if (!state.research) state.research = { levels: {} }
  state.research.levels[id] = before + 1
  {
    let maxed = 0
    for (const n of matterTechNodes(ctx)) {
      if ((state.research.levels[n.id] ?? 0) >= n.maxLevel) maxed += 1
    }
    peakFirst(state, 'matterTechMaxed', maxed)
  }
  addLog(
    state,
    'levelup',
    `🔬 谜质科技「${node.name}」提升至 ${before + 1}/${node.maxLevel} 级` +
      `（耗虫洞谜质 ${can.cost.essence} 枚 · ${can.cost.isk.toLocaleString('zh-CN')} 信用点）。`,
  )
  return { ok: true, level: before + 1 }
}

export function matterTechSum(state: GameState, ctx: SimContext, effect: string): number {
  let sum = 0
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== effect) continue
    const lv = matterTechLevel(state, node.id)
    if (lv > 0) sum += lv * node.per
  }
  return sum
}

export function matterTechBattleSpeed(state: GameState, ctx: SimContext): number {
  let mul = 1
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== 'whBattleSpeed') continue
    const lv = matterTechLevel(state, node.id)
    if (lv > 0) mul *= Math.pow(node.per, lv)
  }
  return mul
}

export function matterTechBattleSpeedTiers(state: GameState, ctx: SimContext): number[] {
  const tiers = new Set<number>([1])
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== 'whBattleSpeed') continue
    const lv = matterTechLevel(state, node.id)
    for (let i = 1; i <= lv; i++) tiers.add(Math.pow(node.per, i))
  }
  return [...tiers].sort((a, b) => a - b)
}

export function matterTechScanCut(state: GameState, ctx: SimContext): number {
  return Math.min(0.9, matterTechSum(state, ctx, 'whScanCut'))
}

export function matterTechSignalAutoYield(state: GameState, ctx: SimContext): number {
  const bonus = matterTechNodes(ctx).filter(n => n.effect === 'signalAutoYield')
    .reduce((sum, n) => sum + Math.max(0, Math.min(n.maxLevel, Math.floor(matterTechLevel(state, n.id)))) * n.per, 0)
  return bonus > 0 ? Math.min(80, Math.round(50 + bonus * 100)) / 100 : 0
}

export function matterTechUnboxCut(state: GameState, ctx: SimContext): number {
  return Math.min(0.9, matterTechSum(state, ctx, 'unboxTimeCut'))
}

export function matterTechVoidYield(state: GameState, ctx: SimContext): number {
  return matterTechSum(state, ctx, 'voidCrystalYield')
}

export function matterTechWreckYield(state: GameState, ctx: SimContext): number {
  return matterTechSum(state, ctx, 'wreckMineralYield')
}

export function matterTechWorkEffBonus(
  state: GameState,
  ctx: SimContext,
  kind: 'salvage' | 'collect',
): number {
  return matterTechSum(state, ctx, kind === 'salvage' ? 'whSalvageEff' : 'whCollectEff')
}


export function matterTechVoidRefineCut(state: GameState, ctx: SimContext): number {
  return Math.min(0.9, matterTechSum(state, ctx, 'voidRefineSpeed'))
}

export function matterTechVoidOrePerHour(state: GameState, ctx: SimContext): number {
  return Math.max(0, matterTechSum(state, ctx, 'voidOreDrip'))
}

export function matterTechEffectActive(state: GameState, ctx: SimContext, effect: MatterTechEffect): boolean {
  return matterTechSum(state, ctx, effect) > 0
}

export const MATTER_TECH_VOID_ORE_ITEM_ID = 'ore-voidmother'

export function advanceMatterOreDrip(state: GameState, ctx: SimContext, deltaMs: number): void {
  if (!(deltaMs > 0)) return
  const rate = matterTechVoidOrePerHour(state, ctx)
  if (rate <= 0) return
  const acc = (state.research?.oreDrip ?? 0) + (deltaMs / 3_600_000) * rate
  const whole = Math.floor(acc)
  if (!state.research) state.research = { levels: {} }
  state.research.oreDrip = acc - whole
  if (whole > 0) addWare(state, MATTER_TECH_VOID_ORE_ITEM_ID, whole)
}

export function matterTechWhBuffs(state: GameState, ctx: SimContext): WormholeTechBuffs {
  const sum = (e: string): number => matterTechSum(state, ctx, e)
  return {
    ...WORMHOLE_TECH_BUFFS_NONE,
    turnBonus: sum('whTurnMax'),
    scanRadius: sum('whScanRadius'),
    holdCells: sum('whHoldCells'),
    resistShield: sum('whResistShield'),
    resistArmor: sum('whResistArmor'),
    resistHull: sum('whResistHull'),
    hitBonus: sum('whHit'),
    evasion: sum('whEvasion'),
    enemyHitDown: sum('whEnemyHitDown'),
    weaponRangePct: sum('whRange'),
    reloadPct: sum('whReload'),
    damagePct: sum('whDamage'),
    blindReduce: sum('whBlindReduce'),
    threatNode: sum('whThreatNode'),
    threatBoss: sum('whThreatBoss'),
    droneRecoveryPct: sum('whDroneRecovery'),
    fieldRepairPct: sum('whFieldRepair'),
  }
}
