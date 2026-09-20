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
import { peakFirst } from './firstTasks'
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

/** **能不能研究**（只做判据，不扣款）：界面按钮与 `researchMatterTech` 共用同一把尺。
 * 返回形状带 `errorId`/`errorParams`（甲案）：调用方（含渲染层）用 `cmdText(can)` 取当前语言的拒绝原因。 */
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

/**
 * **研究一级**（船长：「**不消耗时间**」⇒ 点即生效）：扣谜质（仓库）+ 信用点 ⇒ 等级 +1。
 * 判据全走 `matterTechCanResearch`（同一把尺）；**任何一条不满足都不动账**。
 */
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
    /** 兜底句（`can` 理论上必带原因，这里防"判据返 ok:false 却不给原因"的将来改动） */
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
  /**
   * **里程碑「谜质通晓」的计数点**（成就系统第二批 · 船长 2026-09-20）。
   *
   * 记的是**已满级的节点数**（不是"点了几次"）⇒ 用一个**状态量**而不是事件累计：
   * 改等级上限、加新节点都不会让旧账失真，且**峰值型**（`peakFirst`）= 幂等、只升不降。
   * 判据 = 每次研究成功后现数一遍全表满级数（23 个节点，遍历成本可忽略）。
   */
  {
    let maxed = 0
    for (const n of matterTechNodes(ctx)) {
      if ((state.research.levels[n.id] ?? 0) >= n.maxLevel) maxed += 1
    }
    peakFirst(state, 'matterTechMaxed', maxed)
  }
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

/**
 * **洞内战斗倍速**（1 = 未解锁）。
 * ⚠ 这是全表**唯一按乘法**算的效果：`whBattleSpeed` 的 `per` 是**每级倍率**（2）
 * ⇒ `per^级` = 1 级 ×2、2 级 ×4；**不能**套通用的 `Σ 等级 × per`（那会算成 ×3 / ×5，本批修）。
 */
export function matterTechBattleSpeed(state: GameState, ctx: SimContext): number {
  let mul = 1
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== 'whBattleSpeed') continue
    const lv = matterTechLevel(state, node.id)
    if (lv > 0) mul *= Math.pow(node.per, lv)
  }
  return mul
}

/**
 * **已解锁的倍速档位**（含 1×；1 级 ⇒ [1, 2]、2 级 ⇒ [1, 2, 4]）。
 * 界面按它渲染控件（**只显示已解锁档**，船长 2026-09-19 口径）；引擎按它夹紧传入档位。
 */
export function matterTechBattleSpeedTiers(state: GameState, ctx: SimContext): number[] {
  const tiers = new Set<number>([1])
  for (const node of matterTechNodes(ctx)) {
    if (node.effect !== 'whBattleSpeed') continue
    const lv = matterTechLevel(state, node.id)
    for (let i = 1; i <= lv; i++) tiers.add(Math.pow(node.per, i))
  }
  return [...tiers].sort((a, b) => a - b)
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
