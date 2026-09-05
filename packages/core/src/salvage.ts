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
import { nextRandom } from './rng'

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
 * 残骸物品定义（按敌群生成；B3 乙案：计数 = 体积 → unitM3 = 1，数量即 m³）。
 * 残骸不直接卖钱（baseSellPrice 占位）——唯一变现 = 精炼炉「残骸回收」开箱；
 * 回收时按物品 id 反查敌群（ctx.anomalies）取星系危险度/威胁决定矿物池与彩头池。
 * 体积量级 = 威胁 ×0.06 m³/份 在打捞/回收结算时按敌群威胁动态计算（见 pullOneWreck）。
 */
export function wreckItemDefOf(anomalyId: string, anomalyName: string, threat: number): ItemDef {
  return {
    id: wreckItemIdOf(anomalyId),
    name: `${anomalyName}残骸`,
    kind: 'wreck',
    unitM3: 1, // 计数 = 体积（m³）
    baseSellPriceIsk: 1,
    description: `「${anomalyName}」编队的舰体残骸（按 m³ 计舱）：不可直接出售，回母港用精炼炉「残骸回收」开箱——保底矿物 + 概率彩头。`,
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

/* ═══════════ 回收开箱（B3：精炼炉「残骸回收」批；2026-09-05 船长定稿） ═══════════ */

/**
 * B3 记账口径（2026-09-05 船长拍板乙案）：**残骸计数 = 体积**——
 * 打捞入舱按"m³ 当量"计（item unitM3 = 1，数量即体积），同一型号的残骸 id 只决定
 * 回收画像（危险度池/低安/碎片档），体积不再挂 item 静态单件。回收批按体积：
 * 每批 10 m³ / 25 秒（劳动者 100% → 1440 m³/h，与 4×MK1 打捞量级对齐）。
 */
/** 回收批体积（m³）/ 周期：10 m³ / 25 秒（劳动者 100%；AI 核心按效率拉长周期） */
export const RECYCLE_BATCH_M3 = 10
export const RECYCLE_CYCLE_MS = 25_000

/**
 * 保底矿物产出档（P3 校准，2026-09-05 船长锚：回收链保底 ≈ 采矿 ×1.1 ≈ 5.5 万 ISK/h，
 * 按"炉时 1440 m³/h"反推：Y_档 = 55,000 ÷ (1440 × 池内矿物期望单价)；
 * 三池期望单价：常 9.8 / 险 27.6 / 危 92.45 ISK/单位（按池权重×baseSellPrice）。
 * 单位 = 矿物 unit/m³ 残骸。
 */
export const RECYCLE_YIELD_PER_M3: Record<RecycleTier, number> = {
  common: 3.9,
  risky: 1.4,
  dire: 0.42,
}
/** 保底矿物抽取抖动（±10%，走 state.rng） */
export const RECYCLE_YIELD_JITTER = 0.1

/** 回收矿物池档（按残骸所属星系基础密度；常 10-19 / 险 20-29 / 危 30-40） */
export type RecycleTier = 'common' | 'risky' | 'dire'
export const RECYCLE_TIER_LABELS: Record<RecycleTier, string> = { common: '常', risky: '险', dire: '危' }

/** 三档矿物池（权重表：矿物 id → 权重；船长 2026-09-05 定稿构成） */
const RECYCLE_POOLS: Record<RecycleTier, ReadonlyArray<readonly [string, number]>> = {
  common: [
    ['min-tritanium', 65],
    ['min-pyerite', 30],
    ['min-mexallon', 5],
  ],
  risky: [
    ['min-pyerite', 45],
    ['min-mexallon', 35],
    ['min-nocxium', 12],
    ['min-isotope', 8],
  ],
  dire: [
    ['min-mexallon', 30],
    ['min-nocxium', 25],
    ['min-isotope', 30],
    ['min-starcore', 13],
    ['min-darkiron', 2],
  ],
}

/** 打捞所得残骸回收时所属档（按其敌群星系基础密度） */
export function recycleTierOf(baseDensity: number): RecycleTier {
  if (baseDensity >= 30) return 'dire'
  if (baseDensity >= 20) return 'risky'
  return 'common'
}

/** 残骸物品 → 回收画像（敌群威胁/星系危险度；未知物品返回 null） */
export function recycleProfileOf(ctx: SimContext, wreckItemId: string): RecycleProfile | null {
  const anomalyId = anomalyIdOfWreck(wreckItemId)
  if (!anomalyId) return null
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return null
  const base = wreckBaseDensity(anomaly.galaxyId, ctx)
  const galaxy = ctx.galaxies.get(anomaly.galaxyId)
  return {
    anomalyId,
    galaxyId: anomaly.galaxyId,
    threat: anomaly.threat,
    baseDensity: base,
    tier: recycleTierOf(base),
    lowSec: typeof galaxy?.security === 'number' && galaxy.security < 0,
  }
}

export interface RecycleProfile {
  anomalyId: string
  galaxyId: string
  threat: number
  baseDensity: number
  tier: RecycleTier
  lowSec: boolean
}

/**
 * 保底矿物开箱（每批调用；确定性走 state.rng）：
 * 产出总量 = 批体积(m³) × 档位单方产量 × jitter，矿物品种按档位池权重抽取。
 */
export function rollRecycleGuarantee(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  volumeM3: number,
): Array<{ mineralId: string; units: number }> {
  const pool = RECYCLE_POOLS[profile.tier]!
  let baseUnits = Math.max(1, volumeM3 * RECYCLE_YIELD_PER_M3[profile.tier])
  // 残骸提纯学（salvage-refining，2026-09-05）：保底矿物每级 +8%（对标精炼收率系）
  const refLv = Math.min(5, state.skills.trained['salvage-refining'] ?? 0)
  if (refLv > 0) baseUnits *= 1 + 0.08 * refLv
  const jitter = 1 - RECYCLE_YIELD_JITTER + 2 * RECYCLE_YIELD_JITTER * nextRandom(state.rng)
  const total = Math.max(1, Math.floor(baseUnits * jitter))
  let acc = 0
  const roll = nextRandom(state.rng) * pool.reduce((s, [, w]) => s + w, 0)
  let pick = pool[0]![0]!
  for (const [id, w] of pool) {
    acc += w
    if (roll <= acc) {
      pick = id
      break
    }
  }
  return ctx.items.has(pick) ? [{ mineralId: pick, units: total }] : []
}

/**
 * 彩头分层（B3，2026-09-05 船长定稿；概率为 P3 初值，按"彩头 EV ≤ 保底 10%（~5.5k/h）"
 * 且随获取效率守恒校准，单位 = 每 m³ 掷骰）：
 * ① 基础常驻件直出（civ/MK1 无门槛件）——任何残骸按 m³ 掷骰；
 * ② 低安（sec<0）残骸箱低概率出 MK2 装备；
 * ③ 蓝图碎片：威胁 ≥17 出 MK2 碎片（集 100 解锁蓝图）、≥41 追加 MK3 碎片（集 1000）。
 * 返回：{ modules: [{id,count}] 入装备库；fragments: [{moduleId,count}] 入物品仓库 }。
 */
export const RECYCLE_BASE_MODULES: readonly string[] = [
  'mod-miner-civ',
  'mod-cargo-civ',
  'mod-turret-civ',
  'mod-miner-1',
  'mod-cargo-1',
  'mod-turret-kin-1',
]
export const RECYCLE_MK2_MODULES: readonly string[] = [
  'mod-miner-2',
  'mod-cargo-2',
  'mod-turret-kin-2',
  'mod-laser-2',
  'mod-missile-2',
  'mod-shield-kin-2',
  'mod-armor-kin-2',
]
/** 每 m³ 概率（P3 按真实市场均价反推，EV/批 10m³ ≈ 保底 10% 上限 ≈ 38 ISK）：
 * 基础件池均价 ~23.3k → 0.0001；低安 MK2 池均价 ~251k → 0.000004；
 * 碎片片值（蓝图市价÷所需片数）MK2 ~567 / MK3 ~177 → 0.0006 / 0.0009 */
export const RECYCLE_CHANCE = { base: 0.00008, mk2: 0.000003, fragT2: 0.00045, fragT3: 0.0007 }
/** 蓝图碎片配方：模块 → 蓝图 id + 所需片数（MK2 100 / MK3 1000；异星 10000 预留） */
export const FRAGMENT_RECIPES: Record<string, { blueprintId: string; need: number }> = {
  'mod-miner-2': { blueprintId: 'bp-miner-2', need: 100 },
  'mod-cargo-2': { blueprintId: 'bp-cargo-2', need: 100 },
  'mod-turret-kin-2': { blueprintId: 'bp-turret-2', need: 100 },
  'mod-miner-3': { blueprintId: 'bp-miner-3', need: 1000 },
  'mod-cargo-3': { blueprintId: 'bp-cargo-3', need: 1000 },
  'mod-turret-kin-3': { blueprintId: 'bp-turret-3', need: 1000 },
}
/** 碎片物品 id（蓝图碎片按目标装备注册） */
export function fragmentItemIdOf(moduleId: string): string {
  return `frag-${moduleId}`
}
/** 碎片物品定义（按目标装备生成；不可出售） */
export function fragmentItemDefOf(moduleId: string, moduleName: string): ItemDef {
  return {
    id: fragmentItemIdOf(moduleId),
    name: `${moduleName}蓝图碎片`,
    kind: 'fragment',
    unitM3: 0.02,
    baseSellPriceIsk: 1,
    description: `逆向研究残骸得到的蓝图碎片：集齐 ${FRAGMENT_RECIPES[moduleId]?.need ?? '?'} 片可在母港逆向解锁「${moduleName}」蓝图（无需市场）。`,
  }
}

/** 彩头开箱（每批调用；逐具掷骰，确定性走 state.rng） */
export function rollRecycleLoot(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  batchUnits: number,
): { modules: string[]; fragments: string[] } {
  const modules: string[] = []
  const fragments: string[] = []
  const mk2Pool = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
  const t2Pool = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 100 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId))
  const t3Pool = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 1000 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId))
  for (let i = 0; i < batchUnits; i++) {
    if (nextRandom(state.rng) < RECYCLE_CHANCE.base) {
      const pool = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
      if (pool.length > 0) modules.push(pool[Math.floor(nextRandom(state.rng) * pool.length)]!)
    }
    if (profile.lowSec && mk2Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.mk2) {
      modules.push(mk2Pool[Math.floor(nextRandom(state.rng) * mk2Pool.length)]!)
    }
    if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT2) {
      fragments.push(t2Pool[Math.floor(nextRandom(state.rng) * t2Pool.length)]!)
    }
    if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT3) {
      fragments.push(t3Pool[Math.floor(nextRandom(state.rng) * t3Pool.length)]!)
    }
  }
  return { modules, fragments }
}

