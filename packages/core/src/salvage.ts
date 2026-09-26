/**
 * B3 残骸密度引擎（2026-09-05 船长定稿，见 docs/design/b3-salvage.md / docs/glossary.md）。
 *
 * 模型（每星系一个标量池）：
 * - 基础密度 base（2026-09-10 船长拍板：**按各自星系算**）= 该星系全部可见悬赏卡「完成 20 次」
 *   的注入量之和（两卡求和；无可见卡回退旧安全等级曲线 10~40 兜底）；
 * - 保底线 WRECK_FLOOR=10（全图固定；2026-09-10 船长拍板 5 → 10）：≤ 此值打捞不扣密度；
 * - 击杀注入（2026-09-10 船长定）：Δ = **注入口径体量**（`wreckThreat` ?? 威胁，见 `wreckInjectThreatOf`）
 *   ×0.4 × (1 + 0.2×敌人数)，无上限（敌人数 = 主舰+僚机+多波全部单位）；低安遇袭 = 该星系**最强悬赏卡**
 *   注入量 ×0.5；
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
import { tuningMul } from './tuning'
import type { GameState, WreckGalaxyRecord } from './state'
import type { AnomalyDef, ItemDef, SimContext } from './types'
import { nextInt, nextRandom, pickOne, pickWeighted } from './rng'
import { addModule, ownedItemCount, ownedModuleCount } from './equipment'
import { addWare, countWare } from './inventory'
import { FOE_LAIR_GEAR } from './lairs'
import {
  wreckGroupOfAnomaly,
  wreckGroupOfItemId,
  WRECK_GROUP_BY_KEY,
  type WreckGroupDef,
  type WreckRegion,
} from './wreckGroups'

/** 出量梯度（船长 2026-09-19）：本模块是"残骸域"的门面，转发 `wreckGroups` 的两个单点方便同域引用 */
export { WRECK_YIELD_TIER_MUL, wreckYieldMultiplierOf } from './wreckGroups'

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
 * 残骸物品定义（**按「来源种族 × 来源地区」的组生成**；B3 乙案：计数 = 体积 → unitM3 = 1，数量即 m³）。
 * 残骸不直接卖钱（baseSellPrice 占位）——唯一变现 = 精炼炉「残骸回收」开箱；
 * 回收时按物品 id 反查**组**（`wreckGroups.ts`）取档位/威胁决定矿物池与彩头池。
 * 体积量级 = 威胁 ×0.06 m³/份 在打捞/回收结算时按**打捞到的卡**的威胁动态计算（见 pullOneWreck）。
 *
 * **2026-09-19 船长定「按来源种族 × 来源地区合并」**：物品从"每卡一种"并为 13 组
 * （名字 = `<族称>残骸（<高安/低安/虫洞>）`；族称取完整名，见 `WRECK_FAMILY_NAMES`）。
 */
export function wreckItemDefOf(group: WreckGroupDef): ItemDef {
  return {
    id: wreckItemIdOf(group.key),
    name: group.name,
    kind: 'wreck',
    unitM3: 1, // 计数 = 体积（m³）
    baseSellPriceIsk: 1,
    description: `${group.name.replace('残骸', '')}编队的舰体残骸（按 m³ 计舱）：可在空间站市场按废料价出售应急，或经精炼炉「残骸回收」拆解——保底原材料 + 概率特色掉落（拆解更值）。`,
  }
}

/** 残骸物品 id（入参 = **组 key**：`wreck-a-hi` / `wreck-d-wh`…；卡 id 请先过 `wreckGroupKeyOfAnomaly`） */
export function wreckItemIdOf(groupKey: string): string {
  return `wreck-${groupKey}`
}

/** 该敌卡的残骸物品 id（卡 → 组；查不到 = 未知/合成卡 ⇒ null）。`ctx.wreckGroups` 可覆盖（用例注入）。 */
export function wreckItemIdOfCard(anomalyId: string, ctx?: SimContext): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  return group ? wreckItemIdOf(group.key) : null
}

/** 组 key → 组定义（先查 `ctx.wreckGroups`（用例/扩展注入），再查静态 13 组表） */
export function wreckGroupOfKey(key: string, ctx?: SimContext): WreckGroupDef | null {
  return ctx?.wreckGroups?.get(key) ?? WRECK_GROUP_BY_KEY.get(key) ?? null
}

/** 敌卡 id → 组定义（先查 `ctx.wreckGroups` 的成员索引，再查静态表） */
export function wreckGroupOfCard(anomalyId: string, ctx?: SimContext): WreckGroupDef | null {
  if (ctx?.wreckGroups) {
    for (const g of ctx.wreckGroups.values()) {
      if (g.members.includes(anomalyId)) return g
    }
  }
  return wreckGroupOfAnomaly(anomalyId)
}

/** 残骸物品 id → 组定义（新 id 与旧"每卡一种"的 id 都认；非残骸/未知 ⇒ null） */
export function wreckGroupOfWreckItem(itemId: string, ctx?: SimContext): WreckGroupDef | null {
  const rare = isRareWreck(itemId)
  if (!rare && !itemId.startsWith('wreck-')) return null
  const key = itemId.slice(rare ? 'wreck-rare-'.length : 'wreck-'.length)
  const direct = wreckGroupOfKey(key, ctx)
  if (direct) return direct
  if (ctx?.wreckGroups) {
    for (const g of ctx.wreckGroups.values()) {
      if (g.members.includes(key)) return g
    }
  }
  return wreckGroupOfAnomaly(key)
}

/** 残骸物品 id → 组 key（非残骸 id / 未知卡 ⇒ null） */
export function wreckGroupKeyOfItemId(itemId: string): string | null {
  return wreckGroupOfItemId(itemId)?.key ?? null
}

/* ═══════════ 稀有残骸（2026-09-10 船长定：赏金任务·窝点战利品，开启词典预留的"高级箱"口子） ═══════════ */

/** 稀有残骸单件体积（m³/件；体积即回收开箱的批数来源） */
export const RARE_WRECK_VOLUME_M3 = 30

/** 稀有残骸物品 id（入参 = **组 key**；窝点战利品继承该**族**的专属装备与组特色池） */
export function rareWreckItemIdOf(groupKey: string): string {
  return `wreck-rare-${groupKey}`
}

/** 该敌卡的稀有残骸物品 id（卡 → 组；查不到 = null）。`ctx.wreckGroups` 可覆盖（用例注入）。 */
export function rareWreckItemIdOfCard(anomalyId: string, ctx?: SimContext): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  return group ? rareWreckItemIdOf(group.key) : null
}

/** 是否稀有残骸 */
export function isRareWreck(itemId: string): boolean {
  return itemId.startsWith('wreck-rare-')
}

/**
 * **这种残骸现在能不能进精炼炉** —— **2026-09-26 起：一律可以**（本函数退役，留作历史说明）。
 *
 * 沿革：**船长 2026-09-25 令**「**先关闭对应的精炼炉，等势力装备出来再说**」＋同日二答
 * 「**H 族残骸整体暂不可回收**」⇒ 当时按组族 H 关着那口炉（普通与稀有都关）。
 * **2026-09-26 船长定了 H 族势力装备三件**（射程压制 · 捕获网 · 重袭机 ⇒ `FOE_LAIR_GEAR.H` 不再是空池）
 * ⇒ **关闭的理由消失，判据整体删除**：`startRecycleRun` 的闸门、拒因 `core.industry.084`、
 * 工业页的摘卡过滤三处一并退役（打捞 / 出售本来就没受影响）。
 *
 * ⚠ 保留本函数只为"日后若再要关某族"有个落点；**现在恒返回 false**（永不拦）。
 */
export function wreckRecycleClosedOf(_itemId: string, _ctx?: SimContext): boolean {
  return false
}

/**
 * 稀有残骸物品定义（**按组**）。**计数即体积**——与普通残骸同一台账口径（unitM3 = 1，数量就是 m³）：
 * 打捞到 1 件 = 入库 `RARE_WRECK_VOLUME_M3`（30）单位 = 30 m³ 货舱/回收批数。
 * **2026-09-10 船长定：已解禁**（二号五族专属装备齐备后开放）——与普通残骸同一条回收链路，
 * 区别只在"首批触发一次高级箱"（`profile.rare === true`；**一炉一箱**，按炉结算不按件累积）。
 * **2026-09-11 船长（说明文案）**：「掉落说明中『必定掉落 / 不重复』会误导玩家，建议删除，只显示掉落列表」
 * ⇒ 物品描述与卡面一律**只列掉落**（专属装备或特色装备 + 高阶矿物），不再写"必定额外掉落"。
 * **2026-09-19 合并**：名字 = `<族称>稀有残骸（<地区>）`（旧名「稀有残骸（<卡名>）」随合并退役）。
 */
export function rareWreckItemDefOf(group: WreckGroupDef): ItemDef {
  return {
    id: rareWreckItemIdOf(group.key),
    name: group.rareName,
    kind: 'wreck',
    unitM3: 1,
    baseSellPriceIsk: 1,
    description: `${group.rareName.replace('稀有残骸', '')}窝点核心舱段的完好残骸（单件 ${RARE_WRECK_VOLUME_M3} m³）：回站用回收炉解体，保底原材料之外必给一件该敌族专属装备或特色装备，另附一批高阶原材料。`,
  }
}

/**
 * 击败窝点 → 该星系稀有残骸入库（按敌群记账；高级箱开箱时按敌群取特色池）。
 * **同时清零"稀有残骸连刷空手"计数**（2026-09-11 船长保底口径）：任何来源的稀有残骸入库都算"出了货"——
 * 窝点必掉的 1~3 件、派系活跃掷中的 1 件、保底触发的那 1 件，走的是同一个单点。
 */
export function injectRareWreck(state: GameState, galaxyId: string, anomalyId: string, count: number): void {
  if (count <= 0 || galaxyId.length === 0 || anomalyId.length === 0) return
  const rec = state.galaxyWrecks[galaxyId] ?? { density: 0, rare: 0 }
  rec.rare = Math.max(0, Math.floor((rec.rare ?? 0) + count))
  const by = { ...(rec.rareBy ?? {}) }
  by[anomalyId] = Math.max(0, Math.floor((by[anomalyId] ?? 0) + count))
  rec.rareBy = by
  state.galaxyWrecks[galaxyId] = rec
  state.rareWreckDryStreak = 0 // 出货即清零（保底计数只统计"连续空手"）
}

/** 该星系某敌群的稀有残骸存量（界面展示用） */
export function rareWreckCountOf(state: GameState, galaxyId: string): number {
  return Math.max(0, Math.floor(state.galaxyWrecks[galaxyId]?.rare ?? 0))
}

/**
 * 打捞一轮里"必捞一件稀有残骸"的判定（船长 2026-09-10：稀有残骸打捞必定捞到、数量随难度）：
 * 该星系有存量 → 扣 1 件并返回其物品 id（按记账顺序取，保证与产出它的敌群同主题）；
 * 无存量返回 null（本轮回落到常规残骸池）。
 *
 * ⚠ **2026-09-19 合并后**：账本 `rareBy` 仍**按卡记账**（星图「稀有残骸 ×N（来源窝点名）」照旧），
 * 但产出物 = 该卡所属**组**的稀有残骸（同族同地区的箱子是同一件）。
 */
export function pullRareWreck(state: GameState, galaxyId: string, ctx?: SimContext): string | null {
  const rec = state.galaxyWrecks[galaxyId]
  if (!rec) return null
  const by = rec.rareBy ?? {}
  const keys = Object.keys(by).filter((k) => (by[k] ?? 0) > 0)
  const anomalyId = keys.find((k) => rareWreckItemIdOfCard(k, ctx) !== null) ?? ''
  if (anomalyId === '') {
    // 旧口径兜底（只有 rare 计数、无归族记账）+ 未知卡兜底：不产出（避免张冠李戴）
    return null
  }
  by[anomalyId] = (by[anomalyId] ?? 0) - 1
  if (by[anomalyId]! <= 0) delete by[anomalyId]
  rec.rareBy = by
  rec.rare = Math.max(0, (rec.rare ?? 0) - 1)
  state.galaxyWrecks[galaxyId] = rec
  return rareWreckItemIdOfCard(anomalyId, ctx)
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

/**
 * **残骸注入口径的"体量"**（`wreckThreat` ?? `threat`）——口径说明见 `AnomalyDef.wreckThreat`。
 *
 * 2026-09-25 船长令「冻结残骸经济」：威胁重定标**不得牵动回收线** ⇒ 注入量、星系基础密度、
 * 最强卡注入（低安遇袭）**三处同源都走本函数**；卡上没写 `wreckThreat` 的（含新卡、洞内卡、
 * 隐藏模板）一律回落 `threat` ⇒ 逐字零变化。
 */
export function wreckInjectThreatOf(anomaly: Pick<AnomalyDef, 'threat' | 'wreckThreat'>): number {
  return anomaly.wreckThreat ?? anomaly.threat
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
    sum += bountyWreckInjection(wreckInjectThreatOf(a), bountyEnemyCount(a))
  }
  if (!anyCard) return wreckBaseDensityBySecurity(galaxyId, ctx)
  return Math.max(1, Math.round(sum * WRECK_BASE_BOUNTY_RUNS))
}

/** 该星系最强悬赏卡的注入量（无可见卡 = null）——低安遇袭注入按其 ×0.5 计（2026-09-10 船长定） */
export function strongestBountyInjection(galaxyId: string, ctx: SimContext): number | null {
  let best: number | null = null
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    const v = bountyWreckInjection(wreckInjectThreatOf(a), bountyEnemyCount(a))
    if (best === null || v > best) best = v
  }
  return best
}

/** 当前残骸密度（无记录 = 基础密度）。
 *  ⚠ **不含入侵残骸**（船长 2026-09-25：「**入侵残骸不算当地星系密度，因为是独立的**」）——
 *  入侵那一池走 `weekendWreckDensityOf` 单独读、界面单独一行；两池只在**打捞计量与扣减**时合并。 */
export function wreckDensityOf(state: GameState, galaxyId: string, ctx: SimContext): number {
  const rec = state.galaxyWrecks[galaxyId]
  // 限时倍率（2026-09-15）：`wreckDensity` **只乘读取值**（不改已存密度 ⇒ 到期自动回落）
  const rawDensity = rec ? rec.density : wreckBaseDensity(galaxyId, ctx)
  return rawDensity * tuningMul(state, 'wreckDensity')
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
 *
 * **入侵残骸池同款在这里推进**（2026-09-25）：只是它的"归位点"是 **0**（无基础密度、不回升）
 * ⇒ 同一根 48h 线性衰减，衰减到 0 即删记录（船长的「随时间消减到最后会消失」）。
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
  advanceWeekendWreckDecay(state, dtMs, salvagingGalaxyId)
}

/* ═══════════ 入侵残骸 · 独立池（2026-09-25 船长令） ═══════════
 *
 * 船长原话：「**入侵舰队不应该有赏金，而且添加的残骸是原星系的残骸密度，需要独立的残骸条
 * （入侵残骸没有星系的残骸保底，因为随时间消减到最后会消失）**」＋追问后两条口径：
 * 「**按照击败卡的威胁注入**」「**入侵残骸不算当地星系密度，因为是独立的。48 小时线性衰减**」。
 *
 * 与星系池（`galaxyWrecks`）的三处差异——**只有这三处**，其余（单位、打捞产出、回收链路）完全同尺：
 * 1. **无保底**：归位点 = 0（不是该星系的基础密度）⇒ 只减不增、**48h 线性衰减到 0 即消失**；
 * 2. **不进当地残骸密度读数**：`wreckDensityOf` 一个字都不变（界面另起一行「入侵残骸」）；
 * 3. **打捞时合并计量、先扣这一池**：体积当量 mul 按（星系密度 ＋ 入侵残骸）算，
 *    扣减顺序 = 先把入侵池扣空（会消失的先捞），再按老口径扣星系池（保底线 10 不动）。
 *
 * ⚠ **为什么这里要存"锚点 + 已漂移时长"而不是只存一个数**（与星系池的差别）：
 * 星系池的算式 `d − (d−base)·dt/时长` 是**逐次调用按比例收缩**（离线一次跨过 48h 恰好归位，
 * 但逐拍小步只作渐近收敛、永远差一点）；船长对本池的要求是**"48 小时线性衰减、最后会消失"**
 * ⇒ 这里改成**真线性**：注入那一刻记下 `density` 与 `decayAccMs = 0`，此后有效值 =
 * `density × max(0, 1 − decayAccMs/48h)` —— **与推进粒度无关、48h 到点必为 0**（记录随即删除）。
 * 再注入一笔 ⇒ 以"当前有效值 ＋ 新注入量"重新起算 48h（打了新的仗，残骸场重新变新鲜）。
 *
 * 存档：`state.weekendWrecks`（星系 id → `{ density, decayAccMs }`；兼容字段，无版本号）。
 */

/** 入侵残骸的闲置衰减时长（48h 线性到 0；与星系池同一把尺，单列常量便于日后单独调） */
export const WEEKEND_WRECK_DECAY_MS = WRECK_DECAY_MS
/** 衰减尾数收口（有效值小于此值直接清零 ⇒ 记录被删、"残骸条"消失） */
const WEEKEND_WRECK_SNAP = 0.05

/** 入侵残骸一条记录（类型本体在 `state.ts`，与 `WreckGalaxyRecord` 同处；此处转发便于同域引用） */
export type { WeekendWreckRecord } from './state'
import type { WeekendWreckRecord } from './state'

/** 由记录算**当前有效残骸量**（线性衰减：锚点值 × max(0, 1 − 已漂移/48h)） */
export function weekendWreckValueOf(rec: WeekendWreckRecord): number {
  const left = 1 - Math.max(0, rec.decayAccMs) / WEEKEND_WRECK_DECAY_MS
  return left <= 0 ? 0 : Math.max(0, rec.density) * left
}

/** 某星系的入侵残骸存量（无记录 / 已衰减到 0 = 0） */
export function weekendWreckDensityOf(state: GameState, galaxyId: string): number {
  const rec = state.weekendWrecks?.[galaxyId]
  if (!rec) return 0
  const v = weekendWreckValueOf(rec)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * **击败入侵舰队的残骸注入量**（船长：「按照击败卡的威胁注入」）——沿用悬赏那条唯一公式
 * （`bountyWreckInjection`：威胁 ×0.4 ×(1+0.2×敌人数)，体量走 `wreckInjectThreatOf`），
 * 只是**记到独立池**。`frac`：主动出击 / 旗舰战 = 1；遇袭沿用既有"遇袭半量"口径（0.5）。
 */
export function weekendWreckInjectionOf(
  card: Pick<AnomalyDef, 'threat' | 'wreckThreat' | 'waves'>,
  frac = 1,
): number {
  return bountyWreckInjection(wreckInjectThreatOf(card), bountyEnemyCount(card)) * Math.max(0, frac)
}

/** 注入入侵残骸（只加不减；非法值/非正数一律忽略）。**注入即重新起算 48h**（残骸场重新变新鲜）。 */
export function injectWeekendWreck(state: GameState, galaxyId: string, amount: number): void {
  if (!(amount > 0) || galaxyId.length === 0) return
  const map = (state.weekendWrecks ??= {})
  const cur = weekendWreckDensityOf(state, galaxyId)
  map[galaxyId] = { density: cur + amount, decayAccMs: 0 }
}

/** 直接写一条记录（打捞扣减用；`decayAccMs` 一并给定） */
function writeWeekendWreck(state: GameState, galaxyId: string, density: number, decayAccMs: number): void {
  const map = state.weekendWrecks
  if (!map) return
  if (!(density > WEEKEND_WRECK_SNAP) || decayAccMs >= WEEKEND_WRECK_DECAY_MS) {
    delete map[galaxyId]
    return
  }
  map[galaxyId] = { density, decayAccMs }
}

/**
 * **入侵残骸的闲置衰减推进**（48h 线性；打捞进行中挂起，与星系池同规则）——
 * 由 `advanceWreckDrift` 每拍带一遍（唯一调用点），到点/见底即删记录。
 */
export function advanceWeekendWreckDecay(
  state: GameState,
  dtMs: number,
  salvagingGalaxyId: string | null = null,
): void {
  const map = state.weekendWrecks
  if (!map) return
  for (const [galaxyId, rec] of Object.entries(map)) {
    if (galaxyId === salvagingGalaxyId) continue
    const acc = Math.max(0, rec.decayAccMs) + dtMs
    // 到点或有效值见底 ⇒ 删记录（残骸条消失）；否则只推进漂移时长，锚点值不动（真线性）
    if (acc >= WEEKEND_WRECK_DECAY_MS || weekendWreckValueOf({ density: rec.density, decayAccMs: acc }) <= WEEKEND_WRECK_SNAP) {
      delete map[galaxyId]
      continue
    }
    map[galaxyId] = { density: rec.density, decayAccMs: acc }
  }
}

/** 本轮的"体积当量系数"（纯算式；**不改任何状态**）：mul = max(0.5, (星系密度 ＋ 入侵残骸)/10)。
 *  分母不变（2026-09-10 船长定）——保底线抬到 10 后，稳态保底（密度 = 10）的实际系数 = 1.0。
 *  **扣减与取数分开**：`salvageRoundPull`（要扣）与 `salvageRoundMulOf`（只读）共用本算式。 */
function roundMulOf(density: number, weekend: number): number {
  return Math.max(0.5, (density + weekend) / 10)
}

/**
 * **本轮密度系数（只读）**——与 `salvageRoundPull` 同一算式，但**一个字都不改**。
 *
 * 给"这一轮不产出普通残骸"的场合取读数用：**稀有残骸轮**（`pullOneWreck` 稀有分支）。
 * 依据（2026-09-25 玩家报障修复）：放干扣减的契约是"**扣减 ↔ 本轮按 mul 出普通残骸**"，
 * 稀有轮出的是固定 30 m³ 的稀有残骸、不吃 mul ⇒ 不许再扣普通池（也不扣入侵池）。
 */
export function salvageRoundMulOf(state: GameState, ctx: SimContext, galaxyId: string): number {
  const rec = recordOf(state, galaxyId, ctx)
  return roundMulOf(rec.density, weekendWreckDensityOf(state, galaxyId))
}

/**
 * 一轮打捞（每台每周期调用一次；引擎/作业层使用）：
 * 先按当前密度给出本轮"体积当量系数" mul = max(0.5, 密度/10)（分母不变——2026-09-10 船长定；
 * 保底线抬到 10 后，稳态保底（密度 = 10）的实际系数 = 1.0），再执行放干扣减
 * （>保底线 10：扣当前超出量 2%；超出量趋零进位；≤保底线：不扣）。
 * 调用方按 mul 计入该轮捞取量（基础体积 × mul 的货仓占用）。
 *
 * ⚠ **只有"确实按 mul 出普通残骸"的轮才调用本函数**——稀有残骸轮走 `salvageRoundMulOf`
 * （只读。2026-09-25 玩家报障：稀有轮扣了普通池却不给普通残骸 ⇒ 已按甲案修掉）。
 *
 * **入侵残骸（独立池）参加本轮**（2026-09-25 船长令）：
 * - **计量合并**：mul 按（星系密度 ＋ 入侵残骸）算 ⇒ 入侵留下的残骸场让每轮出量更大；
 * - **扣减先扣入侵池**：先按同一 2% 放干扣入侵池（**无保底**，可以扣到 0），再照老口径扣星系池
 *   （保底线 10 不动）——"会消失的先捞"这个顺序对玩家最有利，也让两条读数各自降得清楚。
 */
export function salvageRoundPull(state: GameState, ctx: SimContext, galaxyId: string): number {
  const rec = recordOf(state, galaxyId, ctx)
  const weekend = weekendWreckDensityOf(state, galaxyId)
  const d = rec.density
  const mul = roundMulOf(d, weekend)
  if (weekend > 0) {
    /**
     * 入侵池按同一 2% 放干（**无保底** ⇒ 可以扣到 0）：
     * 扣减后**以当前有效值为新锚点重新起算 48h**（玩家正在这一片捞 ⇒ 与"打捞中挂起衰减"同一意图）。
     */
    writeWeekendWreck(state, galaxyId, weekend - weekend * WRECK_DRAIN_SHARE, 0)
  }
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
/**
 * **普通残骸**的回收批体积（m³）/ 周期（劳动者 100%；AI 核心按效率拉长周期）。
 *
 * ⚠ **2026-09-23 船长令**（「将所有普通残骸的精炼炉回收每批的量提高到 100 立方米」⇒ 甲；再问
 * 「残骸回收量十倍了，特色掉落怎么算？」「批大小为什么要公用」⇒ 裁定**乙**）：
 * **普通残骸 = 批 100 m³ / 起炉 100**（本常量）、**稀有残骸 = 批 30 m³ / 起炉 30**（`RARE_UNIT_M3` = 一件的体积，
 * 在 `industry.ts` 按残骸类型分支取值）。普通侧吞吐 **1,440 ⇒ 14,400 m³/h（×10）**、保底收益同 ×10
 * （≈82k ⇒ ≈820k ISK/h）；旧口径「10 m³ 与 4×MK1 打捞（1,440 m³/h）对齐」**作废**。
 * **特色掉落不受影响**：彩头按**体积**掷（`rollRecycleLoot` 逐 m³ 一次骰）⇒ 每 m³ 期望不变、每小时随吞吐 ×10；
 * 稀有侧彩头仍"每满 30 m³ 必给一次"，与批大小无关（乙案下恰好 = 一炉一件一次）。
 */
export const RECYCLE_BATCH_M3 = 100
export const RECYCLE_CYCLE_MS = 25_000

/**
 * 保底矿物产出档（P3 校准 + 2026-09-06 船长定档：无技能单炉保底 ≈82k ISK/h = 采矿 ×1.65，
 * 按"炉时 1440 m³/h"反推：Y_档 = 82,000 ÷ (1440 × 池内矿物期望单价)；
 * 三池期望单价：常 9.8 / 险 27.76 / 危 92.55 ISK/单位（按池权重×baseSellPrice）。
 * 单位 = **保底当量单位/m³ 残骸**。
 *
 * ⚠ **2026-09-14 船长改判（「取消随机抽一种矿物的限制。直接按价值比例产出所有矿物」）后的语义**：
 * 池权重 = **价值占比**；每批产出池内**全部**矿物，各矿物分到的 ISK 价值 = `每批保底价值 × 权重占比`，
 * 单位数 = 该价值 ÷ 该矿物单价 ⇒ 本常量不再是"实际产出单位数"，而是**保底价值的口径锚**：
 * `每批保底价值(ISK) = 体积 × Y_档 × 池均价`（与旧口径的期望价值**逐值等值** ⇒ 保底 EV/h 与一切经济读数不变）。
 * 折算公式收在 `recycleBatchValueIsk` / `recyclePoolMeanIsk` 两个单点里，引擎、界面、经济工具同源。
 */
export const RECYCLE_YIELD_PER_M3: Record<RecycleTier, number> = {
  common: 5.8,
  risky: 2.06,
  dire: 0.62,
}
/** 保底矿物抽取抖动（±10%，走 state.rng） */
export const RECYCLE_YIELD_JITTER = 0.1

/** 三档池的期望单价（ISK/单位：按池权重×baseSellPrice 加权；与 tools/salvage-econ.ts 同源口径）。
 *  供"回收保底 ISK/h 估价"展示——星图「残骸打捞」页与工业页回收卡共用同一组值（2026-09-06）。
 *  2026-09-14 两批重配（均为"整池期望单价不变"口径）：①所有池补钛钢 20%；②船长「提高钛钢占比到 40~60」
 *  ⇒ **统一 40%**（只提不降 · 取区间下限=最小改动点）：常 9.8（本来就有钛钢，未动）· 险 27.72 → **27.76** · 危 92.60 → **92.55**。
 *  ⚠ 这组值同时是 `content-check` 的「B3.1 特色池均价 = m × 档基数 ±3%」**契约基数** ⇒ 改池必同步改这里。 */
export const RECYCLE_POOL_AVG_ISK: Record<RecycleTier, number> = {
  common: 9.8,
  risky: 27.76,
  dire: 92.55,
}

/** 回收矿物池档（按残骸所属星系基础密度；2026-09-10 阈值随基础密度抬等比上移：
 *  常 <428（旧 10-19）/ 险 428-641（旧 20-29）/ 危 ≥642（旧 30-40）） */
export type RecycleTier = 'common' | 'risky' | 'dire'
export const RECYCLE_TIER_LABELS: Record<RecycleTier, string> = { common: '常', risky: '险', dire: '危' }

/** 三档矿物池（权重表：矿物 id → 权重；船长 2026-09-05 定稿构成）
 *  ⚠ **权重的语义（2026-09-14 船长改判后）**：权重 = **价值占比**（每批产出池内全部矿物，各矿物分到
 *  「每批保底价值 × 权重占比」，单位数 = 该价值 ÷ 单价）。**旧语义**（同日上午）= 抽中概率/单位占比；
 *  船长当天先要"钛钢占 40%"（按单位），随后改判「**取消随机抽一种矿物的限制。直接按价值比例产出所有矿物**」
 *  ⇒ 同一张权重表，语义从"单位占比"换成"价值占比"；**表本身一字未动**（改的是产出怎么分配）。
 *  ⚠ **2026-09-14 船长（前两批）**：①「在所有残骸的回收里，添加钛钢合金。已有钛钢合金的不做改变。
 *  没有钛钢合金的，在保持价值不变的前提下将其他材料减少」⇒ 险/危两档补入**钛钢 20%**；
 *  ②「**提高钛钢占比到 40~60**」+ 三答（**只提不降 · 统一 40% · 均价不变**）⇒ 险/危两档钛钢
 *  **20% → 40%**，其余矿物按 `w × (价/均价)^α` 重配（α 二分求解）+ 整数权重微调，
 *  使**整池期望单价不变**（险 27.72 → 27.76 · 危 92.60 → 92.55）；常驻档 65% 已 ≥40% ⇒ **一字未动**。
 *  敌群专属池同批处理（`packages/data/src/salvageFlavors.ts`：19 个提到 40%，其中 6 个补入 1 种高价矿物）。
 *  ⚠ **导出**：体检脚本要用它对"三档基础池必含钛钢 · 均价 = 档基数 · 钛钢**价值**占比 ≥40%"做硬契约（B3.2/B3.3）。
 *  （命名注：本矿物 id 一直是 `min-tritanium`；显示名 2026-09-14 由「三钛合金」改为**「钛钢合金」**，见
 *   `docs/roadmap.md` 二号改名条——本表的注释与体检文案已同步新名，**id 未动 ⇒ 存档与配方零影响**。） */
export const RECYCLE_POOLS: Record<RecycleTier, ReadonlyArray<readonly [string, number]>> = {
  common: [
    ['min-tritanium', 65],
    ['min-pyerite', 30],
    ['min-mexallon', 5],
  ],
  risky: [
    // 2026-09-14 第二批：钛钢 20 → 40（均价 27.72 → 27.76，+0.14%）；余下 60 权重按 (价/均价)^α 重配
    ['min-tritanium', 40],
    ['min-pyerite', 18],
    ['min-mexallon', 18],
    ['min-nocxium', 16],
    ['min-isotope', 8],
  ],
  dire: [
    // 2026-09-14 第二批：钛钢 20 → 40（均价 92.60 → 92.55，−0.05%）
    ['min-tritanium', 40],
    ['min-mexallon', 6],
    ['min-nocxium', 18],
    ['min-isotope', 17],
    ['min-starcore', 16],
    ['min-darkiron', 3],
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

/**
 * 该残骸实际使用的**保底矿物池**（单点：敌群特色池优先、缺省回落档位基础池）。
 * 引擎 `rollRecycleGuarantee` 与界面「保底矿物」展示**同源**——界面不必复写回落逻辑，
 * 也不会出现"卡面列的矿物与实际拆出的不一致"。返回权重表：`[矿物 id, 权重][]`
 * （权重是相对值、和不为 100，展示方按占比折算）。
 */
export function recycleMineralPoolOf(profile: RecycleProfile): ReadonlyArray<readonly [string, number]> {
  return profile.pool && profile.pool.length > 0 ? profile.pool : RECYCLE_POOLS[profile.tier]!
}

/** 残骸物品 → 回收画像（**组**档位/威胁/组池；未知物品返回 null） */
export function recycleProfileOf(ctx: SimContext, wreckItemId: string): RecycleProfile | null {
  const group = wreckGroupOfWreckItem(wreckItemId, ctx)
  if (!group) return null
  return {
    groupKey: group.key,
    region: group.region,
    threat: group.threat,
    tier: group.tier,
    // **低安判定（含 0）**：2026-09-12 船长裁定「**0 也算低安**」⇒ 由 `sec < 0` 改 **`sec ≤ 0`**。
    // 合并后按**组地区**判：低安组 = true（与旧口径"该卡所在星系 sec ≤ 0"逐卡一致）；
    // 洞内组 = false（洞内卡挂在母港星系 sec = 1，旧口径也是 false ⇒ 逐字不变）。
    lowSec: group.region === 'lo',
    // 组池恒非空（洞内 5 组 = 常档基础池）⇒ 不会走 `RECYCLE_POOLS` 回落
    pool: group.pool,
    note: group.note.length > 0 ? group.note : undefined,
    theme: group.theme,
    // 稀有残骸（2026-09-10）：保底照常，另走"必定额外掉落"的高级箱；专属装备池按**族**取（与合并前同源）
    ...(isRareWreck(wreckItemId)
      ? (() => {
          const gear = FOE_LAIR_GEAR[group.family] ?? []
          return gear.length > 0 ? { rare: true as const, lairGear: gear } : { rare: true as const }
        })()
      : {}),
  }
}

/* ═══════════ 高级箱（稀有残骸额外掉落，2026-09-10 船长定） ═══════════ */

/** 专属装备命中率（按回收档位；2026-09-10 船长定：**5% / 8% / 10%**，原 25/40/55 太容易——
 *  专属装备一周就全齐；降下来后集齐一族约 3~6 天。未命中必给该敌群主题件，
 *  且命中给的是**不可出售**的专属件、未命中给的是**可出售**的主题件，所以"非命中"收益不受影响） */
export const RARE_BOX_GEAR_CHANCE: Record<RecycleTier, number> = { common: 0.05, risky: 0.08, dire: 0.1 }

/**
 * 专属**无人机**一次掉落架数（2026-09-10 船长：G 族「鱿蜂无人机」）。
 * 无人机是消耗品（会被点防击落、永久损失），而专属型号无蓝图不可造 → 一次给一批，
 * 打光之后同族池会重新把它放回抽取（见 `ownedItemCount` 口径）。
 */
export const RARE_BOX_DRONE_UNITS = 10
/** 额外掉落附带的高阶矿物单位数（按档位；可调常量） */
export const RARE_BOX_MINERAL_UNITS: Record<RecycleTier, number> = { common: 300, risky: 120, dire: 40 }

/**
 * **高级箱第②支「主题件」的池（单点）**：组表 `theme`（`mk2` + `modules`）优先，
 * 空则用调用方给的**回落池**。
 *
 * ⚠ **为什么要有回落**（2026-09-16 玩家报障「稀有残骸拆解只拆除了 300 钛钢合金」）：
 * **洞内 15 张卡从没配过主题件**（2026-09-19 合并后 = 洞内 5 组的 `theme` 为空）
 * ⇒ 高级箱第②支恒空，5%~10% 没掷中族专属时这一箱**只剩第③支那批矿物**
 * （常档 300 单位、基础池里钛钢占 65% ⇒ 十有八九显示成「钛钢合金 ×300」）。
 * ⇒ 船长当日裁定**甲1案**：洞内回落「军用备货柜」同款 MK3 池抽 1 件
 * （池的构造在 `wormholeSalvage.wormholeRareBoxThemePoolOf`；**洞外组一律回落空池 ⇒ 逐字不变**）。
 */
export function rareBoxThemePoolOf(
  profile: RecycleProfile,
  themeFallback: readonly string[] = [],
): string[] {
  const own = [...(profile.theme?.mk2 ?? []), ...(profile.theme?.modules ?? [])]
  return own.length > 0 ? own : [...themeFallback]
}

/**
 * 稀有残骸开箱的"必定额外掉落"（每件稀有残骸只结算一次，由回收批次的首批触发）：
 * ① 先掷该敌群专属装备（`lairGear`，按档位命中率）——命中即出 1 件；
 *    **池内元素可以是模块 id 或物品 id**（2026-09-10 船长：G 族第一件 = 专属无人机"物品"）：
 *    模块 → `modules`（进装备库）；无人机物品 → `drones`（一次 `RARE_BOX_DRONE_UNITS` 架，进物品仓库）；
 * ② 未命中 → 出一件该敌群主题追加件（`rareBoxThemePoolOf`：卡面池 ?? 回落池；两者都空则跳过）；
 * ③ 无论命中与否，再附一批高阶矿物（数量按档位，从该敌群/档位池加权抽 1 种）。
 * 返回 undefined = 本次没有额外掉落（无专属池且无主题件且无矿物池的极端情况）。
 */
export function rollRareBoxExtra(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  /** 主题件**回落池**（洞内稀有残骸用；见 `rareBoxThemePoolOf` 的注释。缺省空 = 旧口径） */
  themeFallback: readonly string[] = [],
  /**
   * **带权重的回落池组**（**2026-09-24 船长令**：「洞内残骸如果未命中，则从 MK2 和 MK3 里抽，
   * MK3 的权重降低为 0.25」＋同日确认「**MK2 的权重按 1**」）：卡面 `theme` 为空时**优先**用这里 ——
   * 先按 `weight` 选组、再在组内均匀抽 1 件 ⇒ MK2 w=1 / MK3 w=0.25 ⇒ 出 MK3 的实际概率 = **20%**。
   * 组为空 / 未传 ⇒ 退回 `themeFallback`（扁平池 = 旧口径，留给别的调用点）。
   */
  weightedFallback: ReadonlyArray<{ ids: readonly string[]; weight: number }> = [],
): {
  modules: string[]
  drones: Array<{ id: string; count: number }>
  /** 2026-09-14 新增：池内的**蓝图**（专属无人机的一次性图纸——船长「专属无人机出一次性蓝图」） */
  blueprints: string[]
  minerals: Array<{ mineralId: string; units: number }>
  note: string
} | undefined {
  const modules: string[] = []
  const drones: Array<{ id: string; count: number }> = []
  const blueprints: string[] = []
  const minerals: Array<{ mineralId: string; units: number }> = []
  const notes: string[] = []
  // ① 专属装备（2026-09-10 船长：**集齐前不重复掉落**——该族池中还有玩家未持有的件时，
  //    只从"未持有"里均匀抽；三件（或该族全部）都到手后恢复均匀随机、允许重复。
  //    判定口径 = 当前持有：模块看装备库 + 已装配位（equipment.ownedModuleCount）、
  //    无人机物品看物品仓库 + 各船机舱架数（equipment.ownedItemCount）、
  //    **蓝图看蓝图书架存量**（2026-09-14：池里新增一次性图纸后补的这一支）——打光后重新进池）
  const gearAll = profile.lairGear ?? []
  const heldCount = (id: string): number => {
    if (ctx.modules.has(id)) return ownedModuleCount(state, id)
    if (ctx.items.has(id)) return ownedItemCount(state, id)
    return state.blueprintStock[id] ?? 0
  }
  const gear = gearAll.filter((id) => heldCount(id) <= 0)
  const gearPool = gear.length > 0 ? gear : gearAll
  if (gearPool.length > 0 && nextRandom(state.rng) < (RARE_BOX_GEAR_CHANCE[profile.tier] ?? 0)) {
    const pick = gearPool[nextInt(state.rng, gearPool.length)]!
    const modDef = ctx.modules.get(pick)
    const bpDef = ctx.blueprints.get(pick)
    if (modDef) {
      modules.push(pick)
      notes.push(`专属装备「${modDef.name}」`)
    } else if (bpDef) {
      // 专属无人机的一次性图纸（2026-09-14）：进蓝图书架，到组装机开工（一次出 50 架）
      blueprints.push(pick)
      notes.push(`专属图纸「${bpDef.name}」`)
    } else {
      const itemDef = ctx.items.get(pick)
      drones.push({ id: pick, count: RARE_BOX_DRONE_UNITS })
      notes.push(`专属装备「${itemDef?.name ?? pick}」×${RARE_BOX_DRONE_UNITS} 架`)
    }
  } else {
    // ② 主题追加件（未出专属时保底一件主题件；卡面池为空时用**回落池**）
    // **2026-09-24 船长令**：洞内未命中 ⇒ 从 **MK2 + MK3** 里抽，**MK3 权重 0.25**（MK2 = 1 ⇒ MK3 实际 20%）。
    // 实现：先把"哪一组池"按权重抽出来，再在组内均匀抽 1 件（`pickWeighted` 是 rng 里的既有单点）。
    const theme = rareBoxThemePoolOf(profile, themeFallback)
    const pick = ((): string | undefined => {
      if (theme.length > 0) return pickOne(state.rng, theme)
      const groups = weightedFallback.filter((g) => g.ids.length > 0 && g.weight > 0)
      if (groups.length === 0) return undefined
      const chosen = pickWeighted(state.rng, groups, (g) => g.weight, { bound: 'lte' }) ?? groups[0]!
      return pickOne(state.rng, chosen.ids)
    })()
    if (pick !== undefined) {
      modules.push(pick)
      notes.push(`主题装备「${ctx.modules.get(pick)?.name ?? ctx.items.get(pick)?.name ?? pick}」`)
    }
  }
  // ③ 高阶矿物一批（从该敌群特色池或档位池加权抽 1 种）
  const pool = profile.pool ?? RECYCLE_POOLS[profile.tier]
  const units = RARE_BOX_MINERAL_UNITS[profile.tier] ?? 0
  if (pool.length > 0 && units > 0) {
    // 2026-09-12 审计 B3：改走单点 `pickWeighted`（矿种按池权重抽；原扣减循环 `roll -= w; roll <= 0`
    // 即 `lte` 口径）；无中选兜底 = 池首矿种（与改前 `chosen` 初值一致）
    const chosen = pickWeighted(state.rng, pool, (row) => row[1], { bound: 'lte' })?.[0] ?? pool[0]![0]
    minerals.push({ mineralId: chosen, units })
    notes.push(`${ctx.items.get(chosen)?.name ?? chosen} ×${units}`)
  }
  if (modules.length === 0 && drones.length === 0 && blueprints.length === 0 && minerals.length === 0) return undefined
  return { modules, drones, blueprints, minerals, note: notes.join('、') }
}

export interface RecycleProfile {
  /** 组 key（`a-hi` / `d-wh`…；2026-09-19 起取代旧的 `anomalyId`） */
  groupKey: string
  /** 来源地区（高安 / 低安 / 虫洞）——洞内高级箱的"主题件回落池"按它判 */
  region: WreckRegion
  /** 组代表威胁（组内各产残骸卡威胁的平均；驱动蓝图碎片门槛与完好舰体彩头层） */
  threat: number
  /** 组档位（组内主流档；拆解当量 / 市场收价 / 高级箱命中率都读它） */
  tier: RecycleTier
  /** 低安组（地区 = 低安，含 sec 0）——低安门槛 MK2 层与主题追加件按它判 */
  lowSec: boolean
  /** 组保底矿物权重池（恒非空：洞内 5 组 = 常档基础池） */
  pool: ReadonlyArray<readonly [string, number]>
  /** 玩家可见"残骸产出倾向"（洞内 5 组无特色 ⇒ 缺省无） */
  note?: string
  /** 组主题追加件并集（2026-09-08"追加"语义：默认池 + 该组主题件；缺省 = 无追加） */
  theme: { modules?: readonly string[]; mk2?: readonly string[] }
  /** 是否稀有残骸（2026-09-10：赏金任务窝点战利品）——开箱走"高级箱"：保底照常 + **必定**额外掉落 */
  rare?: boolean
  /** 该**族**的专属装备池（稀有残骸额外掉落优先在此掷；缺省 = 未配置） */
  lairGear?: readonly string[]
}

/** 池均价（ISK/单位）：池权重**就是价值占比** ⇒ 均价 = Σ(权重 × 单价) ÷ Σ权重。
 *  引擎抽取、界面折算、经济工具都用它，别各自算一份。 */
export function recyclePoolMeanIsk(
  pool: ReadonlyArray<readonly [string, number]>,
  priceOf: (id: string) => number,
): number {
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  if (wSum <= 0) return 0
  return pool.reduce((s, [id, w]) => s + w * priceOf(id), 0) / wSum
}

/** **残骸提纯学（`salvage-refining`）的保底价值乘数**：每级 **+8%（0.08）**，5 级封顶（与引擎同款 `Math.min`）。
 *  引擎与界面**同源**调它 ⇒ 技能 id 与数值都在这一处，体检的「技能说明契约」现场复核盯得住
 *  （2026-09-14 重构：原先 0.08 与技能 id 分处两个函数，契约报"读取点附近找不到"。） */
export function recycleRefiningMultiplier(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['salvage-refining'] ?? 0)
  return 1 + 0.08 * lv
}

/** 每批保底**价值**（ISK）：体积 × 当量单位 × 池均价 × 提纯学乘数。
 *  ⚠ 与旧口径（每批出一种矿、总量 = 体积×Y_档）的**期望价值逐值等值**——改的是"怎么分配"，不是"给多少"。 */
export function recycleBatchValueFromYield(
  yieldPerM3: number,
  poolMeanIsk: number,
  volumeM3: number,
  refiningMultiplier: number,
): number {
  return Math.max(1, volumeM3 * yieldPerM3) * poolMeanIsk * refiningMultiplier
}

/** 每批保底价值（按档位取 `RECYCLE_YIELD_PER_M3`；引擎用这个，界面已有档位当量时可走上面那个） */
export function recycleBatchValueIsk(
  tier: RecycleTier,
  poolMeanIsk: number,
  volumeM3: number,
  refiningMultiplier: number,
): number {
  return recycleBatchValueFromYield(RECYCLE_YIELD_PER_M3[tier], poolMeanIsk, volumeM3, refiningMultiplier)
}

/**
 * 保底矿物开箱（每批调用；确定性走 state.rng）：
 *
 * **2026-09-14 船长改判**：「取消随机抽一种矿物的限制。直接按价值比例产出所有矿物。」
 * ⇒ 本函数不再"抽一种"，而是：
 * 1. 先算该批**保底价值** = 体积 × 档位当量 × 池均价 ×(1+8%×提纯学)× 抖动(±10%)（`recycleBatchValueIsk`）；
 * 2. 池内**每一种**矿物按**权重 = 价值占比**分到价值，单位数 = 该价值 ÷ 单价；
 * 3. 单位数会出小数（例：危档冥铁 0.02 单位/批）⇒ **不足 1 的余额进 `state.recycleCarry` 累计**，
 *    够 1 才入库（玩家只看到整数；长期总价值精确，不因取整蒸发）。
 */
export function rollRecycleGuarantee(
  state: GameState,
  ctx: SimContext,
  profile: RecycleProfile,
  volumeM3: number,
): Array<{ mineralId: string; units: number }> {
  const pool = recycleMineralPoolOf(profile)
  if (pool.length === 0) return []
  const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  if (wSum <= 0) return []
  const poolMean = recyclePoolMeanIsk(pool, priceOf)
  if (poolMean <= 0) return []
  const refMult = recycleRefiningMultiplier(state)
  const jitter = 1 - RECYCLE_YIELD_JITTER + 2 * RECYCLE_YIELD_JITTER * nextRandom(state.rng)
  const value = recycleBatchValueIsk(profile.tier, poolMean, volumeM3, refMult) * jitter
  const carry = (state.recycleCarry ??= {})
  const out: Array<{ mineralId: string; units: number }> = []
  for (const [id, w] of pool) {
    const price = priceOf(id)
    if (price <= 0) continue
    const exact = (value * (w / wSum)) / price + (carry[id] ?? 0)
    const whole = Math.floor(exact)
    carry[id] = exact - whole
    if (whole > 0) out.push({ mineralId: id, units: whole })
  }
  return out
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
 * 碎片：2026-09-10 船长定 **只降集齐门槛、概率不动**（MK2 25 片 / MK3 250 片）——
 * 门槛下调后单片价值相应上升（MK2 蓝图 45.25 万 ÷ 25 ≈ 1.8 万/片、MK3 297.3 万 ÷ 250 ≈ 1.19 万/片），
 * 碎片路线整档从"约买书工时的 28 倍"降到约 7 倍（见 tools/salvage-econ.ts 两条路线对比表）。 */
export const RECYCLE_CHANCE = { base: 0.00008, mk2: 0.000003, fragT2: 0.00045, fragT3: 0.0007 }
/**
 * 蓝图碎片配方：模块 → 蓝图 id + **档位** + 集齐片数。
 * `tier` 是显式字段：池拆分、威胁门槛、界面提示一律读它——2026-09-10 船长把门槛从 100/1000
 * 降到 25/250，若仍沿用"片数 == 100"当档位判据，改门槛会把两个池一起打成空数组（碎片全不出）。
 */
export const FRAGMENT_RECIPES: Record<string, { blueprintId: string; tier: 2 | 3; need: number }> = {
  'mod-miner-2': { blueprintId: 'bp-miner-2', tier: 2, need: 25 },
  'mod-cargo-2': { blueprintId: 'bp-cargo-2', tier: 2, need: 25 },
  'mod-turret-kin-2': { blueprintId: 'bp-turret-2', tier: 2, need: 25 },
  'mod-miner-3': { blueprintId: 'bp-miner-3', tier: 3, need: 250 },
  'mod-cargo-3': { blueprintId: 'bp-cargo-3', tier: 3, need: 250 },
  'mod-turret-kin-3': { blueprintId: 'bp-turret-3', tier: 3, need: 250 },
}
/**
 * 该档位碎片池：只收**玩家还没拿到蓝图**的模块（2026-09-10 船长定「集齐前不重复」）。
 * 移出池子的两种情况：
 * ① 已学会该蓝图（`learnedRecipes`，含从市场买书学会的）——碎片对它已无意义；
 * ② 碎片已集齐门槛（≥ `need`）但还没去母港逆向——再给就是多余的（碎片不可出售、无市场卡）。
 * 三张书全部到手后该档池为空 → 该档不再出碎片（不报错、不降级抽别的）。
 * 回收开箱与完好舰体彩头共用本池。
 */
export function fragmentPoolOf(state: GameState, ctx: SimContext, tier: 2 | 3): string[] {
  return Object.keys(FRAGMENT_RECIPES).filter((m) => {
    const r = FRAGMENT_RECIPES[m]!
    if (r.tier !== tier) return false
    if (!ctx.blueprints.has(r.blueprintId)) return false
    if (state.learnedRecipes.includes(r.blueprintId)) return false
    if (countWare(state, fragmentItemIdOf(m)) >= r.need) return false
    return true
  })
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
    description: `逆向研究残骸得到的蓝图碎片：集齐 ${FRAGMENT_RECIPES[moduleId]?.need ?? '?'} 片后，在物品页的「蓝图碎片」分组里点「逆向解锁」即可换成该装备的永久蓝图（需停靠空间站）。集齐前不会重复掉落同一本书的碎片——拿到蓝图后它就不再出现。`,
  }
}

/**
 * 彩头开箱（每批调用；逐具掷骰，确定性走 state.rng）。
 * 主题 = "追加"语义（2026-09-08 船长收口）：默认池一件不少，组主题件 `theme.modules/mk2` 只在各自
 * 默认池上追加该组主题件（武器不得为主题追加件——**守墓者·低安组**的三把 MK3 武器为唯一白名单例外，
 * 见 content-check）；有追加件时整池按均价反比缩放（EV 守恒）；无追加件 = 默认池原概率。
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
  const appendBase = (profile.theme?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  const defBaseAvg = avgPriceOf(defBase)
  const basePool = [...defBase, ...appendBase]
  const baseChance =
    appendBase.length > 0 && basePool.length > 0
      ? RECYCLE_CHANCE.base * (defBaseAvg / (avgPriceOf(basePool) || defBaseAvg))
      : RECYCLE_CHANCE.base
  // ② 低安门槛线：默认 MK2 池（7 件，武器全保留）+ 低安主题追加件（仅 sec<0 掷）
  const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
  const appendMk2 = (profile.theme?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
  const defMk2Avg = avgPriceOf(defMk2)
  const mk2Pool = [...defMk2, ...appendMk2]
  const mk2Chance =
    appendMk2.length > 0 && mk2Pool.length > 0
      ? RECYCLE_CHANCE.mk2 * (defMk2Avg / (avgPriceOf(mk2Pool) || defMk2Avg))
      : RECYCLE_CHANCE.mk2
  const t2Pool = fragmentPoolOf(state, ctx, 2)
  const t3Pool = fragmentPoolOf(state, ctx, 3)
  for (let i = 0; i < batchUnits; i++) {
    if (basePool.length > 0 && nextRandom(state.rng) < baseChance) {
      modules.push(pickOne(state.rng, basePool)!)
    }
    if (profile.lowSec && mk2Pool.length > 0 && nextRandom(state.rng) < mk2Chance) {
      modules.push(pickOne(state.rng, mk2Pool)!)
    }
    if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT2) {
      fragments.push(pickOne(state.rng, t2Pool)!)
    }
    if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT3) {
      fragments.push(pickOne(state.rng, t3Pool)!)
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
 * 不再折算体积（旧 ×2 移除），改为按该敌卡**所属组**的回收画像直发回收彩头：
 * ① 基础件**必中 1 件**（该组主题件优先，否则默认基础件池 8 件）；
 * ② 低安组（地区 = 低安）另按 balance.intactMk2Chance 掷 MK2 档（默认 MK2 池 + 组主题件）；
 * ③ 碎片层：威胁 ≥17 按 INTACT_FRAG_T2_CHANCE 掷 MK2 碎片 ×3 片；≥41 追加掷 MK3 碎片 ×1 片。
 * 产物：装备 → 装备库、碎片 → 物品仓库（协会货运直送——打捞舰仍在野外，不占货仓、
 * 不影响满仓返航判定）。返回日志摘要（无任何产物 = null）。
 */
export function rollIntactHullLoot(state: GameState, ctx: SimContext, anomalyId: string): string | null {
  const group = wreckGroupOfCard(anomalyId, ctx)
  if (!group) return null
  const profile = recycleProfileOf(ctx, wreckItemIdOf(group.key))
  if (!profile) return null
  const gains: string[] = []
  // ① 基础件必中（主题追加件优先；无主题或不在上下文 = 默认基础池）
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  const appendBase = (profile.theme?.modules ?? []).filter((id) => ctx.modules.has(id) && !defBase.includes(id))
  if (defBase.length === 0 && appendBase.length === 0) return null
  const basePick =
    appendBase.length > 0
      ? pickOne(state.rng, appendBase)!
      : pickOne(state.rng, defBase)!
  addModule(state, basePick)
  gains.push(`「${ctx.modules.get(basePick)?.name ?? basePick}」`)
  // ② 低安 MK2 层
  if (profile.lowSec) {
    const defMk2 = RECYCLE_MK2_MODULES.filter((id) => ctx.modules.has(id))
    const appendMk2 = (profile.theme?.mk2 ?? []).filter((id) => ctx.modules.has(id) && !defMk2.includes(id))
    const mk2Pool = [...defMk2, ...appendMk2]
    if (mk2Pool.length > 0 && nextRandom(state.rng) < ctx.balance.intactMk2Chance) {
      const mk2Pick = pickOne(state.rng, mk2Pool)!
      addModule(state, mk2Pick)
      gains.push(`「${ctx.modules.get(mk2Pick)?.name ?? mk2Pick}」`)
    }
  }
  // ③ 碎片层（凑逆向收藏的尾缀）
  const t2Pool = fragmentPoolOf(state, ctx, 2)
  const t3Pool = fragmentPoolOf(state, ctx, 3)
  if (profile.threat >= 17 && t2Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T2_CHANCE) {
    const m = pickOne(state.rng, t2Pool)!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T2_COUNT)
    gains.push(`${INTACT_FRAG_T2_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  if (profile.threat >= 41 && t3Pool.length > 0 && nextRandom(state.rng) < INTACT_FRAG_T3_CHANCE) {
    const m = pickOne(state.rng, t3Pool)!
    addWare(state, fragmentItemIdOf(m), INTACT_FRAG_T3_COUNT)
    gains.push(`${INTACT_FRAG_T3_COUNT} 片「${ctx.items.get(fragmentItemIdOf(m))?.name ?? ''}」`)
  }
  return `缴获 ${gains.join('、')}——成件装备已随协会货运先行送回空间站（装备库查收）`
}

