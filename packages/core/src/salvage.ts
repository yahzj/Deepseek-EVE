/**
 * B3 残骸密度引擎（2026-09-05 船长定稿，见 docs/design/b3-salvage.md / docs/glossary.md）。
 *
 * 模型（每星系一个标量池）：
 * - 基础密度 base = round(10 + 15×(1−security)) ∈ [10,40]：只随危险度（低安越危险越高）；
 * - 保底线 WRECK_FLOOR=5（全图固定）：≤ 此值打捞不扣密度、进入保底稳态（半效）；
 * - 击杀注入：远征胜利（主控/AI）Δ = 威胁 ×0.4，无上限；
 * - 闲置漂移（星系无打捞进行中才结算）：>base 线性衰减回 base（48h 放完）、
 *   <base 线性回升回 base（4h 回满）；离线照算；回到 base 自动清记录；
 * - 打捞放干守恒：每轮（每台每周期）扣 = 当前超出保底线量的 2%（1/50）——指数式，
 *   密度越高扣得越快；同速率守恒参照：4×MK1 打捞 ≈ 玩家 50 场/h（威胁45）的注入，
 *   平衡点 ≈ 基础密度；超出量趋零时进位到保底线（避免渐近尾数）；
 * - 保底稳态：密度 ≤5 → 不扣密度，单轮仍产 1 份（体积系数 ×0.5），可持续半效捞。
 *
 * 存档：state.galaxyWrecks（星系 id → 密度/稀有计数）；无记录 = 当前即基础密度
 * （base 由 security 推导不入档；兼容字段，无版本号）。
 */
import type { GameState, WreckGalaxyRecord } from './state'
import type { ItemDef, SimContext } from './types'

/** 保底线（全图固定）：≤ 此值打捞不扣密度、半效保底 */
export const WRECK_FLOOR = 5
/** 击杀注入系数：Δ = 威胁 ×0.4（每场胜利，无上限） */
export const WRECK_INJECT_PER_THREAT = 0.4
/** 放干守恒：每轮（每台每周期）扣当前超出量的 2%（=1/50，N0=50 台·轮参照） */
export const WRECK_DRAIN_SHARE = 1 / 50
/** 超出量小于此值 → 进位到保底线（指数式渐近的尾数收口） */
export const WRECK_DRAIN_SNAP = 0.05
/** 闲置漂移：密度 >base 线性衰减回 base 的总时长（48 游戏小时） */
export const WRECK_DECAY_MS = 48 * 3_600_000
/** 闲置漂移：密度 <base 线性回升回 base 的总时长（4 游戏小时） */
export const WRECK_RECOVER_MS = 4 * 3_600_000

/** 星系残骸基础体积默认推导系数：基础体积 m³ = 威胁 ×0.06（卡级可覆盖，见数据层） */
export const WRECK_VOLUME_PER_THREAT = 0.06

/**
 * 残骸物品定义（按敌群生成，全自动派生可覆盖）：基础体积 m³ = 威胁 ×0.06（下限 0.1）。
 * 残骸不直接卖钱（市场无价值，baseSellPrice 仅占位）——唯一变现 = 精炼炉「残骸回收」开箱；
 * 回收时按物品 id 反查敌群（ctx.anomalies）取星系危险度/威胁决定矿物池与彩头池。
 */
export function wreckItemDefOf(anomalyId: string, anomalyName: string, threat: number): ItemDef {
  const volume = Math.max(0.1, Math.round(Math.max(1, threat) * WRECK_VOLUME_PER_THREAT * 100) / 100)
  return {
    id: wreckItemIdOf(anomalyId),
    name: `${anomalyName}残骸`,
    kind: 'wreck',
    unitM3: volume,
    baseSellPriceIsk: 1,
    description: `「${anomalyName}」编队的舰体残骸（约 ${volume} m³/份）：不可直接出售，回母港用精炼炉「残骸回收」开箱——保底矿物 + 概率彩头。`,
  }
}

/** 残骸物品 id（按敌群注册：每悬赏卡/遭遇群一种残骸） */
export function wreckItemIdOf(anomalyId: string): string {
  return `wreck-${anomalyId}`
}

/** 残骸物品 id → 敌群（悬赏/遭遇）id；非残骸物品返回 null */
export function anomalyIdOfWreck(itemId: string): string | null {
  return itemId.startsWith('wreck-') ? itemId.slice('wreck-'.length) : null
}

/** 星系基础密度 = round(10 + 15×(1−security))，clamp [10,40]；未知星系按中安 0.5 兜底 */
export function wreckBaseDensity(galaxyId: string, ctx: SimContext): number {
  const g = ctx.galaxies.get(galaxyId)
  const sec = typeof g?.security === 'number' && Number.isFinite(g.security) ? g.security : 0.5
  const v = 10 + 15 * (1 - sec)
  return Math.min(40, Math.max(10, Math.round(v)))
}

/** 当前残骸密度（无记录 = 基础密度） */
export function wreckDensityOf(state: GameState, galaxyId: string, ctx: SimContext): number {
  const rec = state.galaxyWrecks[galaxyId]
  return rec ? rec.density : wreckBaseDensity(galaxyId, ctx)
}

function recordOf(state: GameState, galaxyId: string, ctx: SimContext): WreckGalaxyRecord {
  const base = wreckBaseDensity(galaxyId, ctx)
  const rec = state.galaxyWrecks[galaxyId]
  return rec ?? { density: base, rare: 0 }
}

/**
 * 击杀注入（远征胜利结算调用，主控与 AI 同源）：Δ = 威胁 ×0.4，无上限。
 * 只对该星系敌舰所属的战役胜利生效（低安遭遇是否注入见 P2 记录）。
 */
export function injectWreckDensity(state: GameState, ctx: SimContext, galaxyId: string, threat: number): void {
  if (threat <= 0) return
  const rec = recordOf(state, galaxyId, ctx)
  rec.density += threat * WRECK_INJECT_PER_THREAT
  state.galaxyWrecks[galaxyId] = rec
}

/**
 * 闲置漂移推进（engine.advanceGame 每拍调用）：只结算有记录的星系；
 * salvagingGalaxyId = 正在打捞的星系（P2 作业接入；漂移双向挂起）。
 * 收口 = 剩余间距 × dt/时长（单次推进 ≥ 时长恰好归位——离线大步长精确兑现
 * "48h 放完 / 4h 回满"；多段小步为渐近收敛，间距趋零进位清除记录）。
 */
export function advanceWreckDrift(
  state: GameState,
  ctx: SimContext,
  dtMs: number,
  salvagingGalaxyId: string | null = null,
): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return
  for (const [galaxyId, rec] of Object.entries(state.galaxyWrecks)) {
    if (galaxyId === salvagingGalaxyId) continue
    const base = wreckBaseDensity(galaxyId, ctx)
    const d = rec.density
    if (d > base) {
      rec.density = Math.max(base, d - (d - base) * (dtMs / WRECK_DECAY_MS))
    } else if (d < base) {
      rec.density = Math.min(base, d + (base - d) * (dtMs / WRECK_RECOVER_MS))
    }
    if (Math.abs(rec.density - base) < 1e-9) {
      if (rec.rare > 0) rec.density = base
      else delete state.galaxyWrecks[galaxyId]
    }
  }
}

/**
 * 一轮打捞（每台每周期调用一次；引擎/作业层使用）：
 * 先按当前密度给出本轮"体积当量系数" mul = max(0.5, 密度/10)，再执行放干扣减
 * （>保底线：扣当前超出量 2%；超出量趋零进位；≤保底线：不扣）。
 * 调用方按 mul 计入该轮捞取量（基础体积 × mul 的货仓占用）。
 */
export function salvageRoundPull(state: GameState, ctx: SimContext, galaxyId: string): number {
  const rec = recordOf(state, galaxyId, ctx)
  const d = rec.density
  const mul = Math.max(0.5, d / 10)
  if (d > WRECK_FLOOR) {
    const excess = d - WRECK_FLOOR
    rec.density = Math.max(WRECK_FLOOR, d - excess * WRECK_DRAIN_SHARE)
    if (rec.density - WRECK_FLOOR < WRECK_DRAIN_SNAP) rec.density = WRECK_FLOOR
    state.galaxyWrecks[galaxyId] = rec
  }
  return mul
}
