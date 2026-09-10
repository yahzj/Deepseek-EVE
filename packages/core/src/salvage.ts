/**
 * B3 残骸密度引擎（2026-09-05 船长定稿，见 docs/design/b3-salvage.md / docs/glossary.md）。
 *
 * 模型（每星系一个标量池）：
 * - 基础密度 base（2026-09-10 船长拍板：**按各自星系算**）= 该星系全部可见悬赏卡「完成 20 次」
 *   的注入量之和（两卡求和；无可见卡回退旧安全等级曲线 10~40 兜底）；
 * - 保底线 WRECK_FLOOR=10（全图固定；2026-09-10 船长拍板 5 → 10）：≤ 此值打捞不扣密度；
 * - 击杀注入（2026-09-10 船长定）：Δ = 威胁 ×0.4 × (1 + 0.2×敌人数)，无上限（敌人数 = 主舰+
 *   僚机+多波全部单位）；低安遇袭 = 该星系**最强悬赏卡**注入量 ×0.5；
 * - 闲置漂移（星系无打捞进行中才结算）：>base 线性衰减回 base（48h 放完）、
 *   <base 线性回升回 base（**96h 回满**，2026-09-10 船长定：大幅下调恢复速度）；离线照算；
 *   回到 base 自动清记录；
 * - 打捞放干守恒：每轮（每台每周期）扣 = 当前超出保底线量的 2%（1/50）——指数式，
 *   密度越高扣得越快；体积当量 mul = max(0.5, 密度/10)（分母不变，2026-09-10 船长定）；
 * - 保底稳态：密度 ≤10 → 不扣密度，单轮仍产 1 份（体积系数按上式，密度 10 时 = 1.0）。
 *
 * 存档：state.galaxyWrecks（星系 id → 密度/稀有计数）；无记录 = 当前即基础密度
 * （base 由 security 推导不入档；兼容字段，无版本号）。
 */
import type { GameState, WreckGalaxyRecord } from './state'
import type { AnomalyDef, ItemDef, SimContext } from './types'
import { nextInt, nextRandom } from './rng'
import { addModule } from './equipment'
import { addWare } from './inventory'
import { lairGearOf } from './lairs'

/** 保底线（全图固定）：≤ 此值打捞不扣密度、进入保底稳态（2026-09-10 船长拍板 5 → 10） */
export const WRECK_FLOOR = 10
/** 击杀注入系数：Δ = 威胁 ×0.4 × (1 + 0.2×敌人数)（2026-09-10 船长拍板：与悬赏敌人总数挂钩） */
export const WRECK_INJECT_PER_THREAT = 0.4
/** 击杀注入：每个敌人额外 +20%（2026-09-10 船长定） */
export const WRECK_INJECT_ENEMY_BONUS = 0.2
/** 星系基础密度基准（2026-09-10 船长定）：= 该星系全部可见悬赏卡「完成 20 次」的注入量之和 */
export const WRECK_BASE_BOUNTY_RUNS = 20
/** 低安遇袭（文字结算伏击）残骸注入 = 该星系**最强悬赏卡**注入量 × 本值（2026-09-10 船长定） */
export const WRECK_ENCOUNTER_INJECT_FRAC = 0.5
/** 放干守恒：每轮（每台每周期）扣当前超出量的 2%（=1/50，N0=50 台·轮参照） */
export const WRECK_DRAIN_SHARE = 1 / 50
/** 超出量小于此值 → 进位到保底线（指数式渐近的尾数收口） */
export const WRECK_DRAIN_SNAP = 0.05
/** 闲置漂移：密度 >base 线性衰减回 base 的总时长（48 游戏小时） */
export const WRECK_DECAY_MS = 48 * 3_600_000
/** 闲置漂移：密度 <base 线性回升回 base 的总时长（2026-09-10 船长拍板：4h → 96h 大幅下调恢复速度） */
export const WRECK_RECOVER_MS = 96 * 3_600_000

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
    description: `「${anomalyName}」编队的舰体残骸（按 m³ 计舱）：可在空间站市场按废料价出售应急，或经精炼炉「残骸回收」拆解——保底矿物 + 概率彩头（拆解更值）。`,
  }
}

/** 残骸物品 id（按敌群注册：每悬赏卡/遭遇群一种残骸） */
export function wreckItemIdOf(anomalyId: string): string {
  return `wreck-${anomalyId}`
}

/* ═══════════ 稀有残骸（2026-09-10 船长定：赏金任务·窝点战利品，开启词典预留的"高级箱"口子） ═══════════ */

/** 稀有残骸单件体积（m³/件；体积即回收开箱的批数来源） */
export const RARE_WRECK_VOLUME_M3 = 30

/** 稀有残骸物品 id（按敌群注册：窝点战利品继承该敌群的特色池与专属装备） */
export function rareWreckItemIdOf(anomalyId: string): string {
  return `wreck-rare-${anomalyId}`
}

/** 是否稀有残骸 */
export function isRareWreck(itemId: string): boolean {
  return itemId.startsWith('wreck-rare-')
}

/**
 * 稀有残骸物品定义。**计数即体积**——与普通残骸同一台账口径（unitM3 = 1，数量就是 m³）：
 * 打捞到 1 件 = 入库 `RARE_WRECK_VOLUME_M3`（30）单位 = 30 m³ 货舱/回收批数。
 * **2026-09-10 船长定：暂不开放精炼炉**（协会回收炉不受理此类残骸）——照掉、照捞、照入库封存；
 * 高级箱链路（`rollRareBoxExtra`）代码保留待开。
 */
export function rareWreckItemDefOf(anomalyId: string, anomalyName: string): ItemDef {
  return {
    id: rareWreckItemIdOf(anomalyId),
    name: `稀有残骸（${anomalyName}）`,
    kind: 'wreck',
    unitM3: 1,
    baseSellPriceIsk: 1,
    description: `「${anomalyName}」窝点核心舱段的完好残骸（单件 ${RARE_WRECK_VOLUME_M3} m³）：协会回收炉暂时不受理此类残骸，先在仓库存放。`,
  }
}

/** 击败窝点 → 该星系稀有残骸入库（按敌群记账；高级箱开箱时按敌群取特色池） */
export function injectRareWreck(state: GameState, galaxyId: string, anomalyId: string, count: number): void {
  if (count <= 0 || galaxyId.length === 0 || anomalyId.length === 0) return
  const rec = state.galaxyWrecks[galaxyId] ?? { density: 0, rare: 0 }
  rec.rare = Math.max(0, Math.floor((rec.rare ?? 0) + count))
  const by = { ...(rec.rareBy ?? {}) }
  by[anomalyId] = Math.max(0, Math.floor((by[anomalyId] ?? 0) + count))
  rec.rareBy = by
  state.galaxyWrecks[galaxyId] = rec
}

/** 该星系某敌群的稀有残骸存量（界面展示用） */
export function rareWreckCountOf(state: GameState, galaxyId: string): number {
  return Math.max(0, Math.floor(state.galaxyWrecks[galaxyId]?.rare ?? 0))
}

/**
 * 打捞一轮里"必捞一件稀有残骸"的判定（船长 2026-09-10：稀有残骸打捞必定捞到、数量随难度）：
 * 该星系有存量 → 扣 1 件并返回其物品 id（按记账顺序取，保证与产出它的敌群同主题）；
 * 无存量返回 null（本轮回落到常规残骸池）。
 */
export function pullRareWreck(state: GameState, galaxyId: string): string | null {
  const rec = state.galaxyWrecks[galaxyId]
  if (!rec) return null
  const by = rec.rareBy ?? {}
  const keys = Object.keys(by).filter((k) => (by[k] ?? 0) > 0)
  let anomalyId = keys.length > 0 ? keys[0]! : ''
  if (anomalyId === '') {
    // 旧口径兜底（只有 rare 计数、无归族记账）：不产出（避免张冠李戴）
    return null
  }
  by[anomalyId] = (by[anomalyId] ?? 0) - 1
  if (by[anomalyId]! <= 0) delete by[anomalyId]
  rec.rareBy = by
  rec.rare = Math.max(0, (rec.rare ?? 0) - 1)
  state.galaxyWrecks[galaxyId] = rec
  return rareWreckItemIdOf(anomalyId)
}

/** 残骸物品 id → 敌群（悬赏/遭遇）id；非残骸物品返回 null */
export function anomalyIdOfWreck(itemId: string): string | null {
  if (isRareWreck(itemId)) return itemId.slice('wreck-rare-'.length)
  return itemId.startsWith('wreck-') ? itemId.slice('wreck-'.length) : null
}

/** 悬赏敌人总数（主舰+僚机+多波全部单位；无波表 = 1）——2026-09-10 残骸注入按此加成 */
export function bountyEnemyCount(anomaly: Pick<AnomalyDef, 'waves'>): number {
  const w = anomaly.waves
  if (!w || w.length === 0) return 1
  return Math.max(1, w.reduce((s, x) => s + x.units, 0))
}

/** 悬赏胜利的残骸注入量（2026-09-10 船长定）：威胁 ×0.4 × (1 + 0.2×敌人数) */
export function bountyWreckInjection(threat: number, units: number): number {
  return threat * WRECK_INJECT_PER_THREAT * (1 + WRECK_INJECT_ENEMY_BONUS * units)
}

/** 旧口径兜底：星系安全等级曲线（现仅"该星系无可见悬赏卡"时回退使用） */
function wreckBaseDensityBySecurity(galaxyId: string, ctx: SimContext): number {
  const g = ctx.galaxies.get(galaxyId)
  const sec = typeof g?.security === 'number' && Number.isFinite(g.security) ? g.security : 0.5
  const v = 10 + 15 * (1 - sec)
  return Math.min(40, Math.max(10, Math.round(v)))
}

/**
 * 星系基础密度（2026-09-10 船长拍板：**按各自星系算**）：
 * = 该星系全部可见悬赏卡「完成 20 次」的注入量之和（两卡求和；含敌人数加成）；
 * 无可见悬赏卡的星系回退旧的安全等级曲线（防御，目前 20 星系都有卡）。
 */
export function wreckBaseDensity(galaxyId: string, ctx: SimContext): number {
  let sum = 0
  let anyCard = false
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    anyCard = true
    sum += bountyWreckInjection(a.threat, bountyEnemyCount(a))
  }
  if (!anyCard) return wreckBaseDensityBySecurity(galaxyId, ctx)
  return Math.max(1, Math.round(sum * WRECK_BASE_BOUNTY_RUNS))
}

/** 该星系最强悬赏卡的注入量（无可见卡 = null）——低安遇袭注入按其 ×0.5 计（2026-09-10 船长定） */
export function strongestBountyInjection(galaxyId: string, ctx: SimContext): number | null {
  let best: number | null = null
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    const v = bountyWreckInjection(a.threat, bountyEnemyCount(a))
    if (best === null || v > best) best = v
  }
  return best
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
 * 注入残骸密度（给出定量；悬赏胜利 = bountyWreckInjection(...)，低安遇袭 = 最强卡×0.5）。
 * 无上限；只对该星系。
 */
export function injectWreckDensity(state: GameState, ctx: SimContext, galaxyId: string, amount: number): void {
  if (!(amount > 0)) return
  const rec = recordOf(state, galaxyId, ctx)
  rec.density += amount
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
 * 先按当前密度给出本轮"体积当量系数" mul = max(0.5, 密度/10)（分母不变——2026-09-10 船长定；
 * 保底线抬到 10 后，稳态保底（密度 = 10）的实际系数 = 1.0），再执行放干扣减
 * （>保底线 10：扣当前超出量 2%；超出量趋零进位；≤保底线：不扣）。
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
 * 保底矿物产出档（P3 校准 + 2026-09-06 船长定档：无技能单炉保底 ≈82k ISK/h = 采矿 ×1.65，
 * 按"炉时 1440 m³/h"反推：Y_档 = 82,000 ÷ (1440 × 池内矿物期望单价)；
 * 三池期望单价：常 9.8 / 险 27.6 / 危 92.45 ISK/单位（按池权重×baseSellPrice）。
 * 单位 = 矿物 unit/m³ 残骸。
 */
export const RECYCLE_YIELD_PER_M3: Record<RecycleTier, number> = {
  common: 5.8,
  risky: 2.06,
  dire: 0.62,
}
/** 保底矿物抽取抖动（±10%，走 state.rng） */
export const RECYCLE_YIELD_JITTER = 0.1

/** 三档池的期望单价（ISK/单位：按池权重×baseSellPrice 加权；与 tools/salvage-econ.ts 同源口径）。
 *  供"回收保底 ISK/h 估价"展示——星图「残骸打捞」页与工业页回收卡共用同一组值（2026-09-06）。 */
export const RECYCLE_POOL_AVG_ISK: Record<RecycleTier, number> = {
  common: 9.8,
  risky: 27.6,
  dire: 92.4,
}

/** 回收矿物池档（按残骸所属星系基础密度；2026-09-10 阈值随基础密度抬等比上移：
 *  常 <428（旧 10-19）/ 险 428-641（旧 20-29）/ 危 ≥642（旧 30-40）） */
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

/** 回收档位等比系数（2026-09-10 船长拍板）：基础密度抬高后阈值同比例上移——
 * 系数 = 新/旧基础密度均值比（≈21.4）→ 险线 428 / 危线 642（旧 20/30 ×21.4） */
export const RECYCLE_TIER_COEF = 21.4
/** 风险档阈值（旧 20 × 系数 ≈ 428） */
export const RECYCLE_TIER_RISKY = Math.round(20 * RECYCLE_TIER_COEF)
/** 危险档阈值（旧 30 × 系数 ≈ 642） */
export const RECYCLE_TIER_DIRE = Math.round(30 * RECYCLE_TIER_COEF)

/** 残骸回收所属档（按其敌群星系基础密度；阈值已随 2026-09-10 基础密度抬高等比上移） */
export function recycleTierOf(baseDensity: number): RecycleTier {
  if (baseDensity >= RECYCLE_TIER_DIRE) return 'dire'
  if (baseDensity >= RECYCLE_TIER_RISKY) return 'risky'
  return 'common'
}

/** 残骸物品 → 回收画像（敌群威胁/星系危险度/特色池；未知物品返回 null） */
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
    // B3.1：敌群特色（2026-09-06）——缺省走三档基础池/三层彩头
    pool: anomaly.recyclePool,
    note: anomaly.recycleNote,
    loot: anomaly.recycleLoot,
    // 稀有残骸（2026-09-10）：保底照常，另走"必定额外掉落"的高级箱；专属装备池只挂给高级箱
    ...(isRareWreck(wreckItemId)
      ? (() => {
          const gear = lairGearOf(anomaly)
          return gear.length > 0 ? { rare: true, lairGear: gear } : { rare: true }
        })()
      : {}),
  }
}

/* ═══════════ 高级箱（稀有残骸额外掉落，2026-09-10 船长定） ═══════════ */

/** 专属装备命中率（按回收档位；可调常量，待船长定数） */
export const RARE_BOX_GEAR_CHANCE: Record<RecycleTier, number> = { common: 0.25, risky: 0.4, dire: 0.55 }
/** 额外掉落附带的高阶矿物单位数（按档位；可调常量） */
export const RARE_BOX_MINERAL_UNITS: Record<RecycleTier, number> = { common: 300, risky: 120, dire: 40 }

/**
 * 稀有残骸开箱的"必定额外掉落"（每件稀有残骸只结算一次，由回收批次的首批触发）：
 * ① 先掷该敌群专属装备（`lairGear`，按档位命中率）——命中即出 1 件；
 * ② 未命中 → 出一件该敌群主题追加件（recycleLoot；池空则跳过）；
 * ③ 无论命中与否，再附一批高阶矿物（数量按档位，从该敌群/档位池加权抽 1 种）。
 * 返回 undefined = 本次没有额外掉落（无专属池且无主题件且无矿物池的极端情况）。
 */
export function rollRareBoxExtra(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
): { modules: string[]; minerals: Array<{ mineralId: string; units: number }>; note: string } | undefined {
  const modules: string[] = []
  const minerals: Array<{ mineralId: string; units: number }> = []
  const notes: string[] = []
  // ① 专属装备
  const gear = profile.lairGear ?? []
  if (gear.length > 0 && nextRandom(state.rng) < (RARE_BOX_GEAR_CHANCE[profile.tier] ?? 0)) {
    const pick = gear[nextInt(state.rng, gear.length)]!
    modules.push(pick)
    notes.push(`专属装备「${ctx.modules.get(pick)?.name ?? pick}」`)
  } else {
    // ② 主题追加件（未出专属时保底一件主题件；池可空）
    const theme = [...(profile.loot?.mk2 ?? []), ...(profile.loot?.modules ?? [])]
    if (theme.length > 0) {
      const pick = theme[nextInt(state.rng, theme.length)]!
      modules.push(pick)
      notes.push(`主题装备「${ctx.modules.get(pick)?.name ?? pick}」`)
    }
  }
  // ③ 高阶矿物一批（从该敌群特色池或档位池加权抽 1 种）
  const pool = profile.pool ?? RECYCLE_POOLS[profile.tier]
  const units = RARE_BOX_MINERAL_UNITS[profile.tier] ?? 0
  if (pool.length > 0 && units > 0) {
    const total = pool.reduce((s, row) => s + row[1], 0)
    let roll = nextRandom(state.rng) * total
    let chosen = pool[0]![0]
    for (const [id, w] of pool) {
      roll -= w
      if (roll <= 0) {
        chosen = id
        break
      }
    }
    minerals.push({ mineralId: chosen, units })
    notes.push(`${ctx.items.get(chosen)?.name ?? chosen} ×${units}`)
  }
  if (modules.length === 0 && minerals.length === 0) return undefined
  return { modules, minerals, note: notes.join('、') }
}

export interface RecycleProfile {
  anomalyId: string
  galaxyId: string
  threat: number
  baseDensity: number
  tier: RecycleTier
  lowSec: boolean
  /** B3.1 特色保底矿物权重池（缺省 = 三档基础池） */
  pool?: ReadonlyArray<readonly [string, number]>
  /** 玩家可见"残骸产出倾向"（缺省无） */
  note?: string
  /** 主题追加件（2026-09-08"追加"语义：默认池 + 敌群增幅件；缺省 = 三层默认，无追加） */
  loot?: { modules?: readonly string[]; mk2?: readonly string[] }
  /** 是否稀有残骸（2026-09-10：赏金任务窝点战利品）——开箱走"高级箱"：保底照常 + **必定**额外掉落 */
  rare?: boolean
  /** 该敌群的专属装备池（稀有残骸额外掉落优先在此掷；缺省 = 未配置） */
  lairGear?: readonly string[]
}

/**
 * 保底矿物开箱（每批调用；确定性走 state.rng）：
 * 产出总量 = 批体积(m³) × 档位单方产量 × jitter，品种按"敌群特色池（缺省档池）"权重抽取。
 */
export function rollRecycleGuarantee(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  volumeM3: number,
): Array<{ mineralId: string; units: number }> {
  const pool = profile.pool && profile.pool.length > 0 ? profile.pool : RECYCLE_POOLS[profile.tier]!
  let baseUnits = Math.max(1, volumeM3 * RECYCLE_YIELD_PER_M3[profile.tier])
  // 残骸提纯学（salvage-refining，2026-09-05）：保底矿物每级 +8%（独立技能线，不依赖精炼产出倍率）
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
  // 2026-09-08 船长：激光/导弹 MK1 也进直出基础池（三系 MK1 武器齐平）
  'mod-laser-1',
  'mod-missile-1',
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

/**
 * 彩头开箱（每批调用；逐具掷骰，确定性走 state.rng）。
 * 主题 = "追加"语义（2026-09-08 船长收口）：默认池一件不少，recycleLoot.modules/mk2 只在各自
 * 默认池上追加敌群主题件（武器不得为主题追加件——穹顶守卫三把 MK3 武器为唯一白名单例外，见 content-check）；
 * 有追加件时整池按均价反比缩放（EV 守恒）；无追加件 = 默认池原概率。
 */
export function rollRecycleLoot(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  batchUnits: number,
): { modules: string[]; fragments: string[] } {
  const modules: string[] = []
  const fragments: string[] = []
  const avgPriceOf = (ids: readonly string[]): number => {
    const ps = ids
      .map((id) => ctx.marketGoods.get(id)?.basePrice)
      .filter((p): p is number => typeof p === 'number' && p > 0)
    return ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : 0
  }
  // ① 基础件直出线：默认池（8 件，2026-09-08 起含三系 MK1 武器）+ 中安主题追加件
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  const appendBase = (profile.loot?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  const defBaseAvg = avgPriceOf(defBase)
  const basePool = [...defBase, ...appendBase]
  const baseChance =
    appendBase.length > 0 && basePool.length > 0
      ? RECYCLE_CHANCE.base * (defBaseAvg / (avgPriceOf(basePool) || defBaseAvg))
      : RECYCLE_CHANCE.base
  // ② 低安门槛线：默认 MK2 池（7 件，武器全保留）+ 低安主题追加件（仅 sec<0 掷）
  const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
  const appendMk2 = (profile.loot?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
  const defMk2Avg = avgPriceOf(defMk2)
  const mk2Pool = [...defMk2, ...appendMk2]
  const mk2Chance =
    appendMk2.length > 0 && mk2Pool.length > 0
      ? RECYCLE_CHANCE.mk2 * (defMk2Avg / (avgPriceOf(mk2Pool) || defMk2Avg))
      : RECYCLE_CHANCE.mk2
  const t2Pool = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 100 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId))
  const t3Pool = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 1000 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId))
  for (let i = 0; i < batchUnits; i++) {
    if (basePool.length > 0 && nextRandom(state.rng) < baseChance) {
      modules.push(basePool[Math.floor(nextRandom(state.rng) * basePool.length)]!)
    }
    if (profile.lowSec && mk2Pool.length > 0 && nextRandom(state.rng) < mk2Chance) {
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

/* ═══════════ 完好舰体当场直发（卷B3⑨，2026-09-08 船长定稿：⑨-A） ═══════════ */

/** 命中「完好舰体」后的蓝图碎片层概率/片数（威胁 ≥17 必掷 MK2 层、≥41 追加 MK3 层；
 *  片值小（MK2 ~几百 ISK/片），纯凑逆向收藏的彩头尾缀，频率不敏感） */
const INTACT_FRAG_T2_CHANCE = 0.3
const INTACT_FRAG_T2_COUNT = 3
const INTACT_FRAG_T3_CHANCE = 0.2
const INTACT_FRAG_T3_COUNT = 1

/**
 * 完好舰体当场直发（主控/AI 打捞共用；在 pullOneWreck 命中完好舰体时调用一次）：
 * 不再折算体积（旧 ×2 移除），改为按该残骸所属敌群的回收画像直发回收彩头：
 * ① 基础件**必中 1 件**（该敌群主题追加件优先，否则默认基础件池 8 件）；
 * ② 低安（sec<0）另按 balance.intactMk2Chance 掷 MK2 档（默认 MK2 池 + 低安主题追加件）；
 * ③ 碎片层：威胁 ≥17 按 INTACT_FRAG_T2_CHANCE 掷 MK2 碎片 ×3 片；≥41 追加掷 MK3 碎片 ×1 片。
 * 产物：装备 → 装备库、碎片 → 物品仓库（协会货运直送——打捞舰仍在野外，不占货仓、
 * 不影响满仓返航判定）。返回日志摘要（无任何产物 = null）。
 */
export function rollIntactHullLoot(state: GameState, ctx: SimContext, anomalyId: string): string | null {
  const profile = recycleProfileOf(ctx, wreckItemIdOf(anomalyId))
  if (!profile) return null
  const gains: string[] = []
  // ① 基础件必中（主题追加件优先；无主题或不在上下文 = 默认基础池）
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  const appendBase = (profile.loot?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  if (defBase.length === 0 && appendBase.length === 0) return null
  const basePick =
    appendBase.length > 0
      ? appendBase[Math.floor(nextRandom(state.rng) * appendBase.length)]!
      : defBase[Math.floor(nextRandom(state.rng) * defBase.length)]!
  addModule(state, basePick)
  gains.push(`「${ctx.modules.get(basePick)?.name ?? basePick}」`)
  // ② 低安 MK2 层
  if (profile.lowSec) {
    const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
    const appendMk2 = (profile.loot?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
    const mk2Pool = [...defMk2, ...appendMk2]
    if (mk2Pool.length > 0 && nextRandom(state.rng) < ctx.balance.intactMk2Chance) {
      const mk2Pick = mk2Pool[Math.floor(nextRandom(state.rng) * mk2Pool.length)]!
      addModule(state, mk2Pick)
      gains.push(`「${ctx.modules.get(mk2Pick)?.name ?? mk2Pick}」`)
    }
  }
  // ③ 碎片层（凑逆向收藏的尾缀）
  const t2Pool = Object.keys(FRAGMENT_RECIPES).filter(
    (m) => FRAGMENT_RECIPES[m]!.need === 100 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId),
  )
  const t3Pool = Object.keys(FRAGMENT_RECIPES).filter(
    (m) => FRAGMENT_RECIPES[m]!.need === 1000 && ctx.blueprints.has(FRAGMENT_RECIPES[m]!.blueprintId),
  )
  if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T2_CHANCE) {
    const m = t2Pool[Math.floor(nextRandom(state.rng) * t2Pool.length)]!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T2_COUNT)
    gains.push(`${INTACT_FRAG_T2_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T3_CHANCE) {
    const m = t3Pool[Math.floor(nextRandom(state.rng) * t3Pool.length)]!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T3_COUNT)
    gains.push(`${INTACT_FRAG_T3_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  return `缴获 ${gains.join('、')}——成件装备已随协会货运先行送回空间站（装备库查收）`
}

