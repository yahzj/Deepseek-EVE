/**
 * **谜质科技树**（船长 2026-09-19：「先挂起，我打算用制作一个消耗谜质升级的研究科技树。」
 * ＋「消耗谜质和信用点。不消耗时间。主要研究对虫洞内的战斗和探索。另外含部分洞外工业科技。」）。
 *
 * **分工**：节点表（名/层/级数/每级值/费用/前置）住在数据侧 `data/src/matterTech.ts`，经 `ctx.matterTech`
 * 供给本模块；**效果语义与聚合只在 core**——一律**按 `effect` 关键字汇总**（`Σ 等级 × per`），
 * **不认节点 id** ⇒ core 不需要 id 清单，数据侧改名/挪层不影响引擎。
 *
 * **落点**（三处，全部现算、不缓存）：
 * 1. **洞内**：`matterTechWhBuffs(state, ctx)` 产出 `WormholeTechBuffs` ⇒ 传给 `wormholeMatterBuffs(hold, tech)`
 *    （**同一个增益袋、同一套封顶**，威胁/抗性/回避/命中/射程/装填/单发/近盲/回收/维修全走它）；
 *    **最大回合数**（`whTurnMax`）与**货仓格**（`whHoldCells`）也在这只袋子里（`turnBonus` / `holdCells`），
 *    由 `wormhole.ts` 的回合预算与 `wormholeSalvage` 的背包容量分别消费；
 * 2. **洞内倍速**：`matterTechBattleSpeed(state, ctx)`（1 = 未解锁、2、4）由 `combat.ts` 的倍速时间轴消费；
 * 3. **洞外工业三件**：`matterTechUnboxCut` / `matterTechVoidYield` / `matterTechWreckYield` 由 `industry.ts`
 *    的三处挂点消费。
 *
 * **存档与迁移**：等级存在 `state.research.levels`（`Record<节点 id, 等级>`）；老档没有该字段 ⇒
 * `MIGRATIONS[28]`（v28→v29）补空树，读档即"一级未点"，**零行为变化**。
 */
import { addLog } from './state'
import type { GameState } from './state'
import { countWare, removeWare } from './inventory'
import type { MatterTechNodeDef, SimContext } from './types'
import { WORMHOLE_TECH_BUFFS_NONE } from './wormholeMatter'
import type { WormholeTechBuffs } from './wormholeMatter'

/**
 * 研究货币 = **虫洞谜质**的物品 id。
 * ⚠ 这里写**字面量**而不是从 `wormholeSalvage.ts` 引（那个模块反过来依赖 `wormhole.ts`，
 * 引进来会形成 `wormhole → matterTech → wormholeSalvage → wormhole` 的环）；
 * 与 `WORMHOLE_ESSENCE_ITEM_ID` 的一致性由用例断言钉住。
 */
export const MATTER_TECH_ESSENCE_ITEM_ID = 'mat-wh-essence'

/** 全部节点（按数据表顺序；`ctx.matterTech` 缺失 = 空表，引擎零开销） */
export function matterTechNodes(ctx: SimContext): readonly MatterTechNodeDef[] {
  return ctx.matterTech ? [...ctx.matterTech.values()] : []
}

/** 认 id 取节点（未注册 ⇒ undefined） */
export function matterTechNodeOf(ctx: SimContext, id: string): MatterTechNodeDef | undefined {
  return ctx.matterTech?.get(id)
}

/** **某节点的当前等级**（未研究 = 0；`research` 缺失 = 空树兜底） */
export function matterTechLevel(state: GameState, id: string): number {
  return state.research?.levels[id] ?? 0
}

/** 全表等级（界面读数用；`research` 缺失 = 空表） */
export function matterTechLevels(state: GameState): Readonly<Record<string, number>> {
  return state.research?.levels ?? {}
}

/** **仓库里的虫洞谜质枚数**（研究货币；`mat-wh-essence`） */
export function matterTechEssenceHeld(state: GameState): number {
  return countWare(state, MATTER_TECH_ESSENCE_ITEM_ID)
}

/**
 * **下一级的费用**（`level` = 当前等级，0 起）。费用表按级给（长度可短于 `maxLevel` ⇒ 末项兜底）。
 */
export function matterTechCostAt(
  node: MatterTechNodeDef,
  level: number,
): { essence: number; isk: number } {
  const i = Math.max(0, Math.floor(level))
  const pick = (arr: readonly number[]): number =>
    arr.length === 0 ? 0 : (arr[Math.min(i, arr.length - 1)] ?? 0)
  return { essence: pick(node.essence), isk: pick(node.isk) }
}

/** **前置缺口**（返回缺口描述；空数组 = 前置已满） */
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

/** **能不能研究**（只做判据，不扣款）：界面按钮与 `researchMatterTech` 共用同一把尺 */
export function matterTechCanResearch(
  state: GameState,
  ctx: SimContext,
  id: string,
): { ok: boolean; error?: string; node?: MatterTechNodeDef; cost?: { essence: number; isk: number } } {
  const node = matterTechNodeOf(ctx, id)
  if (!node) return { ok: false, error: '没有这项研究。' }
  const level = matterTechLevel(state, id)
  if (level >= node.maxLevel) return { ok: false, error: '这项研究已经满级。', node }
  const missing = matterTechPrereqMissing(state, ctx, node)
  if (missing.length > 0) return { ok: false, error: `前置未满：${missing.join('、')}。`, node }
  const cost = matterTechCostAt(node, level)
  const have = matterTechEssenceHeld(state)
  if (have < cost.essence) {
    return { ok: false, error: `虫洞谜质不足：需要 ${cost.essence} 枚，现有 ${have} 枚。`, node, cost }
  }
  if (state.wallet.isk < cost.isk) {
    return { ok: false, error: `信用点不足：需要 ${cost.isk.toLocaleString('zh-CN')}。`, node, cost }
  }
  return { ok: true, node, cost }
}

/**
 * **研究一级**（船长：「**不消耗时间**」⇒ 点即生效）：扣谜质（仓库）+ 信用点 ⇒ 等级 +1。
 * 判据全走 `matterTechCanResearch`（同一把尺）；**任何一条不满足都不动账**。
 */
export function researchMatterTech(
  state: GameState,
  ctx: SimContext,
  id: string,
): { ok: boolean; error?: string; level?: number } {
  const can = matterTechCanResearch(state, ctx, id)
  if (!can.ok || !can.node || !can.cost) return { ok: false, error: can.error ?? '无法研究。' }
  const node = can.node
  const before = matterTechLevel(state, id)
  if (can.cost.essence > 0) {
    const taken = removeWare(state, MATTER_TECH_ESSENCE_ITEM_ID, can.cost.essence)
    if (!taken) return { ok: false, error: '虫洞谜质不足（账变）。' }
  }
  state.wallet.isk -= can.cost.isk
  if (!state.research) state.research = { levels: {} }
  state.research.levels[id] = before + 1
  addLog(
    state,
    'info',
    `🔬 谜质科技「${node.name}」提升至 ${before + 1}/${node.maxLevel} 级` +
      `（耗虫洞谜质 ${can.cost.essence} 枚 · ${can.cost.isk.toLocaleString('zh-CN')} 信用点）。`,
  )
  return { ok: true, level: before + 1 }
}

/** **按效果关键字汇总**（`Σ 等级 × per`；全表线性叠加——所有节点都是"越点越强"的加量） */
export function matterTechSum(state: GameState, ctx: SimContext, effect: string): number {
  let sum = 0
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== effect) continue
    const lv = matterTechLevel(state, node.id)
    if (lv > 0) sum += lv * node.per
  }
  return sum
}

/** **洞内战斗倍速**（1 = 未解锁；`whBattleSpeed` 的 per = 每级 +2 ⇒ 1 级 ×2、2 级 ×4） */
export function matterTechBattleSpeed(state: GameState, ctx: SimContext): number {
  return 1 + matterTechSum(state, ctx, 'whBattleSpeed')
}

/** **扫描虫洞间隔削减**（0.05/级 ⇒ 0.25 = −25%；与技能链乘算） */
export function matterTechScanCut(state: GameState, ctx: SimContext): number {
  return Math.min(0.9, matterTechSum(state, ctx, 'whScanCut'))
}

/** **货柜拆解周期削减**（0.25/级 ⇒ 满级 0.75；加法口径） */
export function matterTechUnboxCut(state: GameState, ctx: SimContext): number {
  return Math.min(0.9, matterTechSum(state, ctx, 'unboxTimeCut'))
}

/** **虚空晶产出加成**（只作用于「虚空母矿 → 虚空晶」这一支） */
export function matterTechVoidYield(state: GameState, ctx: SimContext): number {
  return matterTechSum(state, ctx, 'voidCrystalYield')
}

/** **残骸保底原材料加成** */
export function matterTechWreckYield(state: GameState, ctx: SimContext): number {
  return matterTechSum(state, ctx, 'wreckMineralYield')
}

/** **打捞器 / 采集器的效率加成**（`whSalvageEff` / `whCollectEff`；与编队里各台的基础效率相加） */
export function matterTechWorkEffBonus(
  state: GameState,
  ctx: SimContext,
  kind: 'salvage' | 'collect',
): number {
  return matterTechSum(state, ctx, kind === 'salvage' ? 'whSalvageEff' : 'whCollectEff')
}

/**
 * **科技树的洞内增益**（`WormholeTechBuffs`）——交给 `wormholeMatterBuffs(hold, tech)` 与装置合流。
 * 未点任何一级 ⇒ 全零（调用方可无脑传）。
 */
export function matterTechWhBuffs(state: GameState, ctx: SimContext): WormholeTechBuffs {
  const sum = (e: string): number => matterTechSum(state, ctx, e)
  return {
    ...WORMHOLE_TECH_BUFFS_NONE,
    turnBonus: sum('whTurnMax'),
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
