/**
 * B3 残骸密度引擎（2026-09-05 船长定稿，见 docs/design/b3-salvage.md / docs/glossary.md）。
 *
 * 模型（每星系一个标量池）：
 * - 基础密度 base（2026-09-10 船长拍板：**按各自星系算**）= 该星系全部可见悬赏卡「完成 20 次」
 *   的注入量之和（两卡求和；无可见卡回退旧安全等级曲线 10~40 兜底）；
 * - 保底线 WRECK_FLOOR=10（全图固定）：≤ 此值打捞不扣密度。沿革：**5 → 10**（2026-09-10 船长拍板）
 *   → 25（2026-10-03 上午令）→ **回到 10**（同日回滚令「将打捞获取量进行回滚，回滚到 2026-10-02 那条「甲」」）；
 * - 击杀注入（2026-09-10 船长定）：Δ = **注入口径体量**（`wreckThreat` ?? 威胁，见 `wreckInjectThreatOf`）
 *   ×0.4 × (1 + 0.2×敌人数)，无上限（敌人数 = 主舰+僚机+多波全部单位）；低安遇袭 = 该星系**最强悬赏卡**
 *   注入量 ×0.5；
 * - 闲置漂移（星系无打捞进行中才结算）：>base 线性衰减回 base（48h 放完）、
 *   <base 线性回升回 base（**96h 回满**，2026-09-10 船长定：大幅下调恢复速度）；离线照算；
 *   回到 base 自动清记录；
 * - 打捞放干守恒：每轮（每台每周期）扣 = 当前超出保底线量的 2%（1/50）——指数式，
 *   密度越高扣得越快；体积当量 mul = max(0.5, 密度/10)（分母不变，2026-09-10 船长定）；
 *   **2026-10-03 船长令**：**入侵残骸池也改走这一套**（渐近缓释 ＋ 出量按余额封顶 ＋
 *   池量 ≤ 基础值时一轮捞光剩余），见 `chargeWeekendWreckByVolume`（**该版本已按同日回滚令作废**）；
 * - 保底稳态：密度 ≤10 → 不扣密度，单轮仍产 1 份（体积系数按上式，密度 10 时 = 1.0）。
 *
 * 存档：state.galaxyWrecks（星系 id → 密度/稀有计数）；无记录 = 当前即基础密度
 * （base 由 security 推导不入档；兼容字段，无版本号）。
 */
import { tuningMul } from './tuning'
import type { GameState, WreckGalaxyRecord } from './state'
import type { AnomalyDef, FoeFamily, ItemDef, SimContext } from './types'
import { hashSeed, nextInt, nextRandom, pickOne, pickWeighted } from './rng'
import { advanceShipWreckDecay } from './shipWrecks'
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

/** 保底线（全图固定）：≤ 此值打捞不扣密度、进入保底稳态。
 *  沿革：**5 → 10**（2026-09-10 船长拍板）→ **25**（2026-10-03 上午令「所有的基础值上调到25立方米」）
 *  → **回到 10**（**2026-10-03 回滚令**：「**将打捞获取量进行回滚，回滚到 2026-10-02 那条「甲」**」，
 *  船长同日就"25 让星系池保底稳态出量 ×2.5"一问裁「**甲：也回到 10**」）。 */
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
export function pullRareWreck(
  state: GameState,
  galaxyId: string,
  ctx?: SimContext,
  /** **打捞对象**（2026-09-26）：`undefined` = 全部 */
  target?: string,
): string | null {
  /**
   * **两本账都要看**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」＋「**进残骸场**」）：
   * - 常驻残骸场的箱子（`galaxyWrecks.rareBy`，窝点与派系活跃那套）；
   * - **入侵残骸场的箱子**（`weekendWrecks.rareBy`，主力舰队打赢留下的那件）。
   * 两本账的"稀有池优先、本轮必出一件"口径完全一致，只是落账对象不同。
   */
  const galaxyRec = state.galaxyWrecks[galaxyId]
  const weekRec = state.weekendWrecks?.[galaxyId]
  /** **打捞对象过滤**（2026-09-26 船长令 Q6 甲 ＋ **2026-09-27 改一条**）：
   *  选组 ⇒ 只在**该组**的卡里抽稀有；**选入侵 ⇒ 只抽入侵残骸场里的稀有**（改前是"稀有不参与"——
   *  船长 2026-09-27 令"主力舰队的箱子进残骸场"后，若仍不参与，玩家选"只捞入侵残骸"就永远拿不到它）。 */
  const inTarget = (cardId: string, fromWeekend: boolean): boolean => {
    if (target === undefined) return true
    if (target === WEEKEND_WRECK_TARGET) return fromWeekend
    return wreckGroupOfCard(cardId, ctx)?.key === target
  }
  const cand: Array<{ cardId: string; fromWeekend: boolean }> = []
  for (const [cardId, n] of Object.entries(galaxyRec?.rareBy ?? {})) {
    if ((n ?? 0) > 0 && inTarget(cardId, false)) cand.push({ cardId, fromWeekend: false })
  }
  for (const [cardId, n] of Object.entries(weekRec?.rareBy ?? {})) {
    if ((n ?? 0) > 0 && inTarget(cardId, true)) cand.push({ cardId, fromWeekend: true })
  }
  const pick = cand.find((c) => rareWreckItemIdOfCard(c.cardId, ctx) !== null)
  if (pick === undefined) {
    // 旧口径兜底（只有 rare 计数、无归族记账）+ 未知卡兜底：不产出（避免张冠李戴）
    return null
  }
  if (pick.fromWeekend) {
    const by = { ...(weekRec?.rareBy ?? {}) }
    by[pick.cardId] = (by[pick.cardId] ?? 0) - 1
    if (by[pick.cardId]! <= 0) delete by[pick.cardId]
    const rare = Math.max(0, (weekRec?.rare ?? 0) - 1)
    /** 场里矿物与箱子都空了 ⇒ 记录才删（矿物捞干 ≠ 箱子没了；与 `writeWeekendWreck` 同一判据） */
    const density = weekRec?.density ?? 0
    if (rare <= 0 && !(density > WEEKEND_WRECK_SNAP)) {
      if (state.weekendWrecks) delete state.weekendWrecks[galaxyId]
    } else if (weekRec !== undefined && state.weekendWrecks) {
      state.weekendWrecks[galaxyId] = {
        density,
        decayAccMs: weekRec.decayAccMs,
        ...(weekRec.family !== undefined ? { family: weekRec.family } : {}),
        ...(rare > 0 ? { rare } : {}),
        ...(Object.keys(by).length > 0 ? { rareBy: by } : {}),
      }
    }
    return rareWreckItemIdOfCard(pick.cardId, ctx)
  }
  const rec = galaxyRec!
  const by = rec.rareBy ?? {}
  by[pick.cardId] = (by[pick.cardId] ?? 0) - 1
  if (by[pick.cardId]! <= 0) delete by[pick.cardId]
  rec.rareBy = by
  rec.rare = Math.max(0, (rec.rare ?? 0) - 1)
  state.galaxyWrecks[galaxyId] = rec
  return rareWreckItemIdOfCard(pick.cardId, ctx)
}

/**
 * **某个打捞对象名下的稀有存量（件数）**（**2026-09-27 加**）：两本账都算 ——
 * 常驻残骸场的箱子（`galaxyWrecks.rareBy`）＋ **入侵残骸场的箱子**（`weekendWrecks.rareBy`）。
 *
 * 用途只有一个：`salvaging.pullOneWreck` 那道"选中对象已捞干 ⇒ 本轮不出"的闸。
 * 场里**只剩箱子**（矿物被捞干）时不许把这一轮挡掉，否则玩家选「只捞入侵残骸」永远拿不到主力舰队那件箱子。
 */
export function rareStockForTargetOf(
  state: GameState,
  ctx: SimContext | undefined,
  galaxyId: string,
  target: string | undefined,
): number {
  const inTarget = (cardId: string, fromWeekend: boolean): boolean => {
    if (target === undefined) return true
    if (target === WEEKEND_WRECK_TARGET) return fromWeekend
    return wreckGroupOfCard(cardId, ctx)?.key === target
  }
  let n = 0
  for (const [cardId, c] of Object.entries(state.galaxyWrecks[galaxyId]?.rareBy ?? {})) {
    if ((c ?? 0) > 0 && inTarget(cardId, false)) n += c ?? 0
  }
  for (const [cardId, c] of Object.entries(state.weekendWrecks?.[galaxyId]?.rareBy ?? {})) {
    if ((c ?? 0) > 0 && inTarget(cardId, true)) n += c ?? 0
  }
  return n
}

/** 悬赏敌人总数（主舰+僚机+多波全部单位；无波表 = 1）——2026-09-10 残骸注入按此加成 */export function bountyEnemyCount(anomaly: Pick<AnomalyDef, 'waves'>): number {
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

/**
 * **卡的回收档**（2026-09-26 船长令「将G族和H族残骸价格提高到和D族差不多的位置」时立的单点）。
 *
 * 卡级覆写（`AnomalyDef.wreckTier`）优先，缺省 = 该卡所在星系的**基础密度**现算
 * （与 2026-09-19 合并后的既有口径**逐值一致** ⇒ 没写覆写的卡行为零变化）。
 *
 * 为什么要有这个单点：残骸的**保底收益 = 档位当量 × 组池均价**，而 B3.1 契约把组档位钉在
 * 「成员卡多数档」、把组池均价钉在「卡级加权保值目标 ±3%」⇒ 想抬某个族的残骸价，只能从**卡级**动手：
 * 卡级覆写既驱动契约复算（`content:check`），也驱动引擎/体检的同一把尺（此处）。
 */
export function wreckCardTierOf(card: Pick<AnomalyDef, 'galaxyId' | 'wreckTier'>, ctx: SimContext): RecycleTier {
  return card.wreckTier ?? recycleTierOf(wreckBaseDensity(card.galaxyId, ctx))
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
/**
 * **「只捞入侵残骸」这个打捞对象的哨兵键**（**2026-09-26**）——与组 key（形如 `h-hi`）不冲突。
 */
export const WEEKEND_WRECK_TARGET = '__weekend__'

/**
 * **该星系各张常驻悬赏卡所属的残骸组**（去重 · 保序）——"无组信息的量"按它**均分**（船长 Q3 口径）。
 * 只认**可见**（非 hidden）的常驻悬赏：隐藏遭遇模板与入侵独立卡都不算常驻悬赏。
 */
export function residentWreckGroupsOf(galaxyId: string, ctx: SimContext): string[] {
  const out: string[] = []
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true || a.galaxyId !== galaxyId) continue
    const g = wreckGroupOfCard(a.id, ctx)
    if (g && !out.includes(g.key)) out.push(g.key)
  }
  return out
}

/**
 * **惰性补齐分组份额**（缺 `byGroup` 就按常驻悬赏卡均分 `density`）——返回可写的那份（已挂回 rec）。
 * 没有常驻悬赏卡（池底来自安全等级）⇒ 分不出组，返回空表（打捞只走"全部"口径）。
 */
export function ensureWreckGroupShares(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  rec: WreckGalaxyRecord,
): Record<string, number> {
  if (rec.byGroup) return rec.byGroup
  const groups = residentWreckGroupsOf(galaxyId, ctx)
  const shares: Record<string, number> = {}
  if (groups.length > 0) {
    const each = Math.max(0, rec.density) / groups.length
    for (const g of groups) shares[g] = each
  }
  rec.byGroup = shares
  state.galaxyWrecks[galaxyId] = rec
  return shares
}

/**
 * **该星系当前可选的打捞对象与各自存量**（界面下拉与用例共用；含入侵残骸那一行）。
 * 星系池各组 = `byGroup` 份额（缺省惰性均分）；`WEEKEND_WRECK_TARGET` 行只在有效密度 > 0 时给。
 */
export function wreckGroupStocksOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  /** **只读模式**（渲染期用）：缺 `byGroup` 时**按均分规则现算**、**不写档** */
  readOnly = false,
): Array<{ groupKey: string; stockM3: number; rareCount?: number }> {
  const rows: Array<{ groupKey: string; stockM3: number; rareCount?: number }> = []
  const rec = state.galaxyWrecks[galaxyId]
  if (rec) {
    const shares = rec.byGroup
      ? rec.byGroup
      : (() => {
          // 老档 / 还没补账：现算均分（与 `ensureWreckGroupShares` 同一条规则），但**不落盘**
          const groups = residentWreckGroupsOf(galaxyId, ctx)
          const out: Record<string, number> = {}
          if (groups.length > 0) {
            const each = Math.max(0, rec.density) / groups.length
            for (const g of groups) out[g] = each
          }
          return out
        })()
    if (!readOnly) ensureWreckGroupShares(state, ctx, galaxyId, rec)
    for (const [groupKey, v] of Object.entries(shares)) {
      if (v > 0.05) rows.push({ groupKey, stockM3: v })
    }
  }
  const inv = weekendWreckDensityOf(state, galaxyId)
  /**
   * **入侵残骸那一行**（**2026-09-27 补**）：矿物 > 0 **或场里有箱子**都要给这一行 ——
   * 矿物被捞干、箱子还在时若不给行，玩家就选不到「入侵残骸」这个对象（`rareCount` 一并带给界面读数）。
   */
  const invRare = weekendRareWreckCountOf(state, galaxyId)
  if (inv > 0 || invRare > 0) {
    rows.push({ groupKey: WEEKEND_WRECK_TARGET, stockM3: inv, ...(invRare > 0 ? { rareCount: invRare } : {}) })
  }
  return rows
}

/** 某组的当前存量（不存在 = 0） */
export function wreckGroupStockOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string,
): number {
  if (target === WEEKEND_WRECK_TARGET) return weekendWreckDensityOf(state, galaxyId)
  const rec = state.galaxyWrecks[galaxyId]
  if (!rec) return 0
  return ensureWreckGroupShares(state, ctx, galaxyId, rec)[target] ?? 0
}

/**
 * 注入残骸密度（给出定量；悬赏胜利 = bountyWreckInjection(...)，低安遇袭 = 最强卡×0.5）。无上限；只对该星系。
 *
 * ⚠ **2026-09-26 加 `sourceCardId`**（分组记账）：记到**击毁那张卡的组**上，玩家才"选什么捞什么"；
 * 没给来源卡（低安遇袭等合成调用）⇒ 该笔按**常驻悬赏卡均分**落组（与老存量同一条规则）。
 */
export function injectWreckDensity(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  amount: number,
  sourceCardId?: string,
): void {
  if (!(amount > 0)) return
  const rec = recordOf(state, galaxyId, ctx)
  // 先把"存量里没有组信息的那部分"按常驻悬赏卡均分补齐（幂等），再记这一笔
  const shares = ensureWreckGroupShares(state, ctx, galaxyId, rec)
  rec.density += amount
  const g = sourceCardId !== undefined ? wreckGroupOfCard(sourceCardId, ctx) : undefined
  if (g) {
    shares[g.key] = (shares[g.key] ?? 0) + amount
  } else {
    const groups = Object.keys(shares)
    if (groups.length > 0) for (const k of groups) shares[k] = (shares[k] ?? 0) + amount / groups.length
  }
  rec.byGroup = shares
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
    // 分组份额按总池变化**等比回调**（2026-09-26 船长令：分开算；保持 `ΣbyGroup == density`）
    if (rec.byGroup && d > 0 && rec.density !== d) {
      const k = rec.density / d
      for (const g of Object.keys(rec.byGroup)) rec.byGroup[g] = (rec.byGroup[g] ?? 0) * k
    }
    if (Math.abs(rec.density - base) < 1e-9) {
      if (rec.rare > 0) rec.density = base
      else delete state.galaxyWrecks[galaxyId]
    }
  }
  advanceWeekendWreckDecay(state, dtMs, salvagingGalaxyId)
  /**
   * **玩家舰船残骸同款在这里推进**（2026-09-26 船长令）：第三本账，同一根 48h 线性衰减、
   * 到点即删条目（船长的「该残骸存在48小时」）。判定与逐件打捞在 `shipWrecks.ts`。
   */
  advanceShipWreckDecay(state, dtMs, salvagingGalaxyId)
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

/** 注入入侵残骸（只加不减；非法值/非正数一律忽略）。**注入即重新起算 48h**（残骸场重新变新鲜）。
 *
 * ⚠ **2026-09-26 加 `family`**（玩家报障「打捞残骸捞不到 H 族残骸，只能捞到该星系默认的」）：
 * 记下**这批残骸的来源势力**，打捞型号池据此并入对应族的独立入侵卡——哪怕星系**已夺回 / 活动已结束**
 * （残骸场比占领活得久）。同族再注入 ⇒ 家族保持；换族注入 ⇒ 以新注入为准。 */
export function injectWeekendWreck(
  state: GameState,
  galaxyId: string,
  amount: number,
  family?: FoeFamily,
): void {
  if (!(amount > 0) || galaxyId.length === 0) return
  const map = (state.weekendWrecks ??= {})
  const cur = map[galaxyId]
  const kept = family ?? cur?.family
  const rareLeft = Math.max(0, Math.floor(cur?.rare ?? 0))
  map[galaxyId] = {
    density: weekendWreckDensityOf(state, galaxyId) + amount,
    decayAccMs: 0,
    ...(kept !== undefined ? { family: kept } : {}),
    // ⚠ **2026-09-27**：普通注入**不许把场里的箱子冲掉**（`rare`/`rareBy` 原样带过）
    ...(rareLeft > 0 ? { rare: rareLeft } : {}),
    ...(cur?.rareBy !== undefined ? { rareBy: { ...cur.rareBy } } : {}),
  }
}

/**
 * **往入侵残骸场里放箱子（稀有残骸）**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」
 * ＋ 追问落点答「**进残骸场**」）。
 *
 * 与常驻残骸场的 `injectRareWreck` **同义不同账**：都进"稀有池"、打捞时**稀有池优先且本轮必出一件**，
 * 只是这本账记在**入侵独立池**上 ⇒ 打捞对象选「入侵残骸」也能捞到它。
 * 按卡记账（`rareBy[cardId]`），打捞时据此归族取箱子（`wreck-rare-<组 key>`）。
 * 与常驻场同款：**出货即清零"稀有残骸连刷空手"计数**。
 */
export function injectWeekendRareWreck(
  state: GameState,
  galaxyId: string,
  cardId: string,
  count: number,
): void {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0 || galaxyId.length === 0 || cardId.length === 0) return
  const map = (state.weekendWrecks ??= {})
  const cur = map[galaxyId]
  const rare = Math.max(0, Math.floor(cur?.rare ?? 0)) + n
  const by = { ...(cur?.rareBy ?? {}) }
  by[cardId] = Math.max(0, Math.floor(by[cardId] ?? 0)) + n
  map[galaxyId] = {
    density: cur?.density ?? 0,
    decayAccMs: cur?.decayAccMs ?? 0,
    ...(cur?.family !== undefined ? { family: cur.family } : {}),
    rare,
    rareBy: by,
  }
  state.rareWreckDryStreak = 0 // 出货即清零（与 `injectRareWreck` 同一条口径）
}

/** 该星系**入侵残骸场里的稀有残骸存量**（件数；界面读数与打捞判据共用） */
export function weekendRareWreckCountOf(state: GameState, galaxyId: string): number {
  return Math.max(0, Math.floor(state.weekendWrecks?.[galaxyId]?.rare ?? 0))
}

/**
 * **这批入侵残骸的来源势力**（打捞型号池用）：记录里有就用它，老档没记 ⇒ 回落**当前事件族**；
 * 事件也结束了又没记（极老档）⇒ `undefined`（池子按"没有入侵残骸"处理）。
 *
 * 🔴 **2026-10-03 真因修复（船长转述玩家报障：「打完入侵旗舰，结束入侵后，去有入侵残骸的星系进行打捞，
 * 捞不到入侵残骸」）**：`asFoeFamily` 原先用**手写区间** `/^[A-H]$/` 收窄，而 `FoeFamily` 的联合是
 * `'A'…'H' | 'R'`（`types.ts`）——**R 族（光环科技）落在区间外**，于是：
 * ① **注入时**记不上族（`injectWeekendWreck(..., asFoeFamily(card.foeFamily))` 传进去的是 `undefined`）；
 * ② **判据时**连记录里明写的 `'R'` 也读不出来。
 * 后果（探针读数）：R 族的残骸场在**活动进行中、星系还在被占名单里**时还能靠第一路（占领供卡）捞出
 * `wreck-r-inv`；**一旦收场/夺回**，就只剩第二路"残骸场比占领活得久"——而它靠族认卡 ⇒ R 族整条失效：
 * 逐格捞上来的全是该星系自己的 `wreck-a-hi`、**入侵池 272 m³ 四格纹丝不动**（玩家看到的就是"捞不到"）。
 * 现改为**唯一登记表** `FOE_FAMILY_CODES`（与联合逐字一致，含 R）⇒ 不再有"手写区间漏一族"这种事。
 */
export const FOE_FAMILY_CODES: readonly FoeFamily[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'R']

/** `string` → `FoeFamily` 的收窄小工具（数据侧族码是 `string`，core 侧是字面量联合） */
export function asFoeFamily(v: string | undefined): FoeFamily | undefined {
  return v !== undefined && (FOE_FAMILY_CODES as readonly string[]).includes(v) ? (v as FoeFamily) : undefined
}

export function weekendWreckFamilyOf(state: GameState, galaxyId: string): FoeFamily | undefined {
  return asFoeFamily(state.weekendWrecks?.[galaxyId]?.family) ?? asFoeFamily(state.weekendEvent?.family)
}

/** 直接写一条记录（打捞扣减用；`decayAccMs` 一并给定）。
 *
 * ⚠ **2026-09-27**：写回必须**带全** `family` / `rare` / `rareBy` 三格 —— 少任何一格都等于静默丢数据：
 * `family` 丢了打捞池就认不出这批残骸属于哪一族（玩家报障「捞不到 H 族残骸」的那条修复会失效）；
 * `rare`/`rareBy` 丢了玩家打主力舰队挣来的箱子就没了。
 * 且**场里有箱子时不删记录**（矿物捞干 ≠ 箱子没了）。 */
function writeWeekendWreck(state: GameState, galaxyId: string, density: number, decayAccMs: number): void {
  const map = state.weekendWrecks
  if (!map) return
  const cur = map[galaxyId]
  const rareLeft = Math.max(0, Math.floor(cur?.rare ?? 0))
  if ((!(density > WEEKEND_WRECK_SNAP) && rareLeft === 0) || (decayAccMs >= WEEKEND_WRECK_DECAY_MS && rareLeft === 0)) {
    delete map[galaxyId]
    return
  }
  map[galaxyId] = {
    density,
    decayAccMs,
    ...(cur?.family !== undefined ? { family: cur.family } : {}),
    ...(rareLeft > 0 ? { rare: rareLeft } : {}),
    ...(cur?.rareBy !== undefined ? { rareBy: { ...cur.rareBy } } : {}),
  }
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
    const rareLeft = Math.max(0, Math.floor(rec.rare ?? 0))
    const dried = acc >= WEEKEND_WRECK_DECAY_MS || weekendWreckValueOf({ density: rec.density, decayAccMs: acc }) <= WEEKEND_WRECK_SNAP
    /**
     * ⚠ **2026-09-27 船长令**（「主力舰队添加一个稀有残骸掉落」＋「进残骸场」）：
     * **矿物到点即消、箱子（稀有残骸）不随场消失** —— 场里还有没捞走的稀有残骸时**不删记录**
     * （漂移时长钉在满窗、有效值恒 0 ⇒ 星图上那一条只报箱子）。与常驻残骸场同款口径
     * （`advanceWreckDrift`：`rec.rare > 0` 时不删）。
     */
    if (dried && rareLeft === 0) {
      delete map[galaxyId]
      continue
    }
    map[galaxyId] = {
      density: rec.density,
      decayAccMs: dried ? WEEKEND_WRECK_DECAY_MS : acc,
      // ⚠ 三格都要带全（`family` 丢了打捞池认不出族；`rare`/`rareBy` 丢了箱子就没了）
      ...(rec.family !== undefined ? { family: rec.family } : {}),
      ...(rareLeft > 0 ? { rare: rareLeft } : {}),
      ...(rec.rareBy !== undefined ? { rareBy: { ...rec.rareBy } } : {}),
    }
  }
}

/** 本轮的"体积当量系数"（纯算式；**不改任何状态**）：mul = max(0.5, 池子量/10)。
 *  分母不变（2026-09-10 船长定）——保底线抬到 10 后，稳态保底（密度 = 10）的实际系数 = 1.0。
 *  **扣减与取数分开**：`salvageRoundPull`（要扣）与 `salvageRoundMulOf`（只读）共用本算式。
 *  ⚠ **2026-10-02 船长令「甲」**：`density` 一律传**本轮真正在出的那一池**的量 ——
 *  从入侵池出就传入侵池量（**不再**把星系密度与入侵残骸相加，见 `roundMulFor` 的长注）。 */
function roundMulOf(density: number, weekend = 0): number {
  return Math.max(0.5, (density + weekend) / 10)
}

/**
 * **本轮密度系数的唯一算式**（`salvageRoundPull` 与 `salvageRoundMulOf` 共用 ⇒ 取数与扣减永不脱节）：
 *
 * - **从入侵残骸池出**（选「入侵残骸」；或未指定对象而池里有存量 ⇒ 按 2026-09-26 的三级序"同池内入侵优先"）
 *   ⇒ `mul = max(0.5, 入侵池/10)` —— **只看入侵池自己的量**；
 * - 选了某一组 ⇒ 只看该组存量；
 * - 其余（普通池）⇒ 按星系密度。
 *
 * 🔴 **2026-10-02 船长令「甲」**（原话：「**我发现入侵残骸哪怕数量很少也能一次性捞出很多。**」⇒ 裁「甲」＝
 * **池子的量真正约束出量**）：**改判 2026-09-25 那条"计量合并"**（原文：mul 按（星系密度 ＋ 入侵残骸）算
 * ⇒ 入侵留下的残骸场让每轮出量更大）。为什么必须改（探针实测，`tools/_ui-artifacts/invasion-wreck-yield.log`）：
 * 合并计量下系数由**星系自己的密度**顶起来，与入侵池大小几乎无关 —— 富星系（密度 150）＋**只有 10 m³**
 * 的入侵池，40 轮却能捞出 **2951 m³ 入侵残骸（295 倍）**；而池子每轮只按 2% 渐近放干、永远不归零。
 *
 * 🔴 **2026-10-03 船长令**（「给所有打捞设定一个基础值，然后恢复渐近缓释」＋「所有的基础值上调到
 * 25立方米」＋「余额封顶也保留」→ 同日**回滚令**：「**将打捞获取量进行回滚，回滚到 2026-10-02 那条「甲」**」）：
 * 本函数**一字未改**（系数只看本池 ＝ 甲的前半）；
 * **入侵池的结算回滚到甲**（`chargeWeekendWreckByVolume`：按实际出量等量扣 ＋ 出量按余额封顶 ⇒
 * 总获取量 = 池子标称量）；当天那版"渐近缓释"按回滚令作废（放大 54~157 倍的读数见其头注与工作文档）。
 */
function roundMulFor(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string | undefined,
  weekend: number,
): number {
  const fromWeekend = weekend > 0 && (target === undefined || target === WEEKEND_WRECK_TARGET)
  if (fromWeekend) return roundMulOf(weekend)
  if (target !== undefined) {
    const shares = ensureWreckGroupShares(state, ctx, galaxyId, recordOf(state, galaxyId, ctx))
    return roundMulOf(shares[target] ?? 0)
  }
  return roundMulOf(recordOf(state, galaxyId, ctx).density)
}

/**
 * **本轮密度系数（只读）**——与 `salvageRoundPull` 同一算式，但**一个字都不改**。
 *
 * 给"这一轮不产出普通残骸"的场合取读数用：**稀有残骸轮**（`pullOneWreck` 稀有分支）、
 * 以及"从入侵池出"的那一轮（那一轮的池子结算由 `chargeWeekendWreckByVolume` 做 ——
 * **2026-10-03 回滚令后 = 按实际出量等量扣 ＋ 出量按余额封顶**，与 2026-10-02「甲」一致）。
 * 依据（2026-09-25 玩家报障修复）：放干扣减的契约是"**扣减 ↔ 本轮按 mul 出普通残骸**"，
 * 稀有轮出的是固定 30 m³ 的稀有残骸、不吃 mul ⇒ 不许再扣普通池（也不扣入侵池）。
 */
export function salvageRoundMulOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  /** **打捞对象**（2026-10-02 起参与系数判定：选组/选入侵各按自己那一池算） */
  target?: string,
): number {
  return roundMulFor(state, ctx, galaxyId, target, weekendWreckDensityOf(state, galaxyId))
}

/**
 * **入侵残骸池的每轮结算**（扣减 ＋ 出量裁决）—— **2026-10-02 船长令「甲」**（**2026-10-03 回滚令**）：
 * 池子**按本轮真出的量等量扣**、**出量按余额封顶** ⇒ 「池子标称多少，最多就只能捞多少」，捞几轮即见底。
 *
 * 🔴 **2026-10-03 船长令（原话照抄）**：「**将打捞获取量进行回滚，回滚到 2026-10-02 那条「甲」**」。
 * 回滚理由（同日探针读数，见 `docs/design/salvage-asymptotic-unified-20261003.md` §三）：
 * 当天早些时候按「恢复渐近缓释」改成的版本（池子每轮只放干"超出基础值部分"的 2%）与"**出量系数按池量算**"
 * （`mul = 池量/10`，而入侵卡单份体积恰好 = 威胁×0.06 ≈ **5.4~10.2 m³** ⇒ 每轮出量 ≈ **池量的 0.5~1.0 倍**）
 * 相乘后总量失控：272 m³ 的场子 400 轮吐出 **17,757 m³（≈65 倍）**、30 m³ 的吐出 **4,702 m³（≈157 倍）**；
 * 「余额封顶」在"出量 ≈ 池量"时**一次都不触发**（探针：违规 0 次）。
 * 甲这版把两者绑成一本账（扣多少 = 出多少）⇒ **总获取量 = 池子标称量**（读数：30 m³ 的池子出 ≤30 且见底）。
 *
 * ⚠ **「池量 ≤ 基础值 ⇒ 一轮捞光剩余」由封顶天然满足**（池子 ≤ 本轮出量时，`give = 池量` ⇒ 一次拿完、
 * 池子归零、记录按既有判据清理）——2026-10-03 那条追补令不需要额外分支。
 */
export function chargeWeekendWreckByVolume(state: GameState, galaxyId: string, wantM3: number): number {
  const left = weekendWreckDensityOf(state, galaxyId)
  if (!(wantM3 > 0) || left <= 0) return 0
  const give = Math.min(wantM3, left)
  writeWeekendWreck(state, galaxyId, left - give, 0)
  return give
}

/**
 * 一轮打捞（每台每周期调用一次；引擎/作业层使用）：
 * 先按**本轮真正在出的那一池**给出"体积当量系数" mul（`roundMulFor`），再执行**星系池**放干扣减
 * （>保底线 25：扣当前超出量 2%；超出量趋零进位；≤保底线：不扣）。调用方按 mul 计入该轮捞取量。
 *
 * ⚠ **只有"确实按 mul 出普通残骸"的轮才调用本函数**——稀有残骸轮走 `salvageRoundMulOf`（只读）。
 *
 * 🔴 **2026-10-02 船长令「甲」改判两处**（其余逐字不变）：
 * 1. **入侵池不再由本函数扣** —— 旧口径「先按同一 2% 放干扣入侵池」作废；改由
 *    `chargeWeekendWreckByVolume` 在 `pullOneWreck` 里结算（**2026-10-03 回滚令后 = 按本轮实际出量
 *    等量扣 ＋ 出量按余额封顶**，即 2026-10-02「甲」那版，见该函数头注）；
 * 2. **从入侵池出的那一轮不再扣星系池** —— 本轮产出记在入侵残骸名下，扣星系池就是"扣了不给"
 *    （与 2026-09-25 那条"稀有轮不扣普通池"同一类错误）。
 * 旧注（2026-09-25 船长令「入侵残骸（独立池）参加本轮」：计量合并 ＋ 扣减先扣入侵池）**已按甲作废**，
 * 理由与实测见 `roundMulFor` 的长注。
 */
export function salvageRoundPull(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  /** **打捞对象**：缺省 = 全部（只有星系池放干）· 组 key = 只扣该组 · `WEEKEND_WRECK_TARGET` = 只扣入侵池 */
  target?: string,
): number {
  const rec = recordOf(state, galaxyId, ctx)
  const weekend = weekendWreckDensityOf(state, galaxyId)
  const mul = roundMulFor(state, ctx, galaxyId, target, weekend)
  const wantsWeekend = target === WEEKEND_WRECK_TARGET
  const wantsGroup = target !== undefined && !wantsWeekend
  /** 从入侵池出的那一轮：星系池一分不扣（甲·第 2 条） */
  const fromWeekend = weekend > 0 && (target === undefined || wantsWeekend)
  const d = rec.density
  // 星系池：按老口径放干（保底线 10 不动）；选入侵时不碰它、从入侵池出时也不碰它
  if (!wantsWeekend && !fromWeekend && d > WRECK_FLOOR) {
    const excess = d - WRECK_FLOOR
    const next = Math.max(WRECK_FLOOR, d - excess * WRECK_DRAIN_SHARE)
    rec.density = next - WRECK_FLOOR < WRECK_DRAIN_SNAP ? WRECK_FLOOR : next
    const lost = d - rec.density
    /**
     * **分组份额同步**（船长 2026-09-26「残骸也要分开算」）：
     * - 选组 ⇒ 从**该组**扣掉本轮真实放干的量（该组见底即停，不自动换组）；
     * - 全部 ⇒ 各组按总池变化**等比回调**（保持 `ΣbyGroup == density`）。
     */
    const shares = ensureWreckGroupShares(state, ctx, galaxyId, rec)
    if (wantsGroup) {
      shares[target!] = Math.max(0, (shares[target!] ?? 0) - lost)
    } else if (rec.density > 0) {
      const k = rec.density / d
      for (const g of Object.keys(shares)) shares[g] = (shares[g] ?? 0) * k
    } else {
      for (const g of Object.keys(shares)) shares[g] = 0
    }
    rec.byGroup = shares
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
 * 保底矿物产出档（**2026-09-28 船长令：三档按 1 : 2 : 3 拉开**）。
 *
 * 船长原话（照抄）：「**三档应该在保底产出上有差距，按照1:2:3进行划分**」
 * ＋（同日）「**2026-09-06 定的锚废除**」。
 *
 * 口径：`每批保底价值(ISK) = 体积 × Y_档 × 池均价`，三池均价见 {@link RECYCLE_POOL_AVG_ISK}
 * （常 9.8 / 险 27.76 / 危 92.55）⇒ **每 m³ 保底价值 = 常 28.62 / 险 57.19 / 危 85.79 ISK**
 * （实测比 **1 : 1.998 : 2.998** ✓），满技能（残骸提纯学 5 ⇒ ×1.4）= 40.06 / 80.06 / 120.11。
 *
 * **取 Y 的方式**：以**中档（险）保持原值 2.06 为基准**，常档 ÷2、危档 ×1.5 ——
 * 这样三档的**平均保底不变**（57.2 ISK/m³），只是把"同样的 m³"分出高低，
 * 不整体抬高回收线（A 线 4.78M / B 线 7.06M / C 线 7.20M 的对比关系不被这一刀改写）。
 *
 * 单位 = **保底当量单位/m³ 残骸**。
 *
 * ⚠ **2026-09-14 船长改判（「取消随机抽一种矿物的限制。直接按价值比例产出所有矿物」）后的语义**：
 * 池权重 = **价值占比**；每批产出池内**全部**矿物，各矿物分到的 ISK 价值 = `每批保底价值 × 权重占比`，
 * 单位数 = 该价值 ÷ 该矿物单价 ⇒ 本常量不再是"实际产出单位数"，而是**保底价值的口径锚**。
 * 折算公式收在 `recycleBatchValueIsk` / `recyclePoolMeanIsk` 两个单点里，引擎、界面、经济工具同源。
 *
 * ⚠ **2026-09-06 那个 82k 锚已由船长废除**（「2026-09-06 定的锚废除」）——
 * 本表不再由任何"锚 ÷ 炉时"反推，**现状即定档**；`salvage:econ` 里的"偏差"列随之作废（见该工具头注）。
 */
export const RECYCLE_YIELD_PER_M3: Record<RecycleTier, number> = {
  common: 2.92, // 常：28.62 ISK/m³
  risky: 2.06, // 险：57.19 ISK/m³（基准档，保持原值）
  dire: 0.927, // 危：85.79 ISK/m³
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
    // **来源敌族**（2026-10-01）：只给"有族专属产出"的组用（现 = R 族核心掉落）
    ...(group.family !== undefined ? { family: group.family } : {}),
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
    // 入侵族特色池（2026-10-03）：非空 ⇒ 回收开箱走"10% 出特色"那条替换支
    // ⚠ **`themeGear` 不带给稀有残骸**：`themeGear` 是"普通残骸直出"这条支路的池子；稀有箱的具名件
    //   走 `lairGear`（专属支）、兜底走 `rareTheme`（见下），三条支路互不重叠。
    ...(!isRareWreck(wreckItemId) && group.themeGear !== undefined ? { themeGear: group.themeGear } : {}),
    ...(!isRareWreck(wreckItemId) && group.themeGearMk2 !== undefined ? { themeGearMk2: group.themeGearMk2 } : {}),
    ...(group.rareTheme !== undefined ? { rareTheme: group.rareTheme } : {}),
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
  /**
   * 主题件**最后兜底池**（甲1案：洞内稀有残骸用 `wormholeSalvage.wormholeRareBoxThemePoolOf`。
   * ⚠ **2026-09-30 修正顺序**：本池只在「卡面 `theme` 空 **且** 下面的带权重组也空」时才用——
   * 修前它被当成"卡面池"先返回，非空就把带权重组挡死 ⇒ 洞内只出 MK3）。
   */
  themeFallback: readonly string[] = [],
  /**
   * **带权重的回落池组**（**2026-09-24 船长令**：「洞内残骸如果未命中，则从 MK2 和 MK3 里抽，
   * MK3 的权重降低为 0.25」＋同日确认「**MK2 的权重按 1**」）：卡面 `theme` 为空时**优先**用这里 ——
   * 先按 `weight` 选组、再在组内均匀抽 1 件 ⇒ MK2 w=1 / MK3 w=0.25 ⇒ 出 MK3 的实际概率 = **20%**。
   * 组为空 / 未传 ⇒ 退回上面那个扁平兜底池（旧口径，留给别的调用点）。
   * ⚠ 2026-09-30 前这里实际上**永远走不到**（被非空的 `themeFallback` 挡住），见上面实现内的注释。
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
    /**
     * ② 主题追加件（未出专属时保底一件主题件）。**取值优先级**（2026-09-30 修 · 船长报障「洞内稀有残骸
     * 回收疑似还是只有 MK3，没有 MK2 池」）：
     *   ① **卡面 `theme`** —— 各族自己的主题件，洞外组走这里；
     *   ② **带权重的洞内回落组** —— 2026-09-24 船长令：MK2 w=1 / MK3 w=0.25 ⇒ 出 MK3 实际 20%；
     *   ③ **扁平回落池** —— 2026-09-16 甲1案的洞内 MK3 池，只在 ①② 都空时兜底。
     *
     * ⚠ **修前 ②③ 的顺序是反的**：`rareBoxThemePoolOf(profile, themeFallback)` 把甲1案那 35 件 MK3 池
     * 当"卡面池"先返回 ⇒ 它非空 ⇒ ②永远走不到 ⇒ 洞内高级箱**只出 MK3**（引擎 2 万次实测 MK2 = 0）。
     * 本函数的注释本来就写着「卡面 `theme` 为空时**优先**用带权重组」⇒ 这里只是让实现回到注释与船长令的口径。
     */
    const theme = rareBoxThemePoolOf(profile, [])
    const pick = ((): string | undefined => {
      if (theme.length > 0) return pickOne(state.rng, theme)
      /**
       * ⚠ **2026-10-03 新增 `rareTheme` 这一档**（在带权重组之前）：入侵两组的 `theme` 必须为空
       * （组主题件 = 成员卡并集契约），兜底件另配在 `rareTheme`（家族 MK2 一件）——没有它，
       * 入侵稀有箱未命中专属支时就只剩"高阶矿物"（船长令「**稀有残骸必定出特色掉落**」会落空）。
       */
      const own = profile.rareTheme ?? []
      if (own.length > 0) return pickOne(state.rng, own)
      const groups = weightedFallback.filter((g) => g.ids.length > 0 && g.weight > 0)
      if (groups.length > 0) {
        // 先把"哪一组池"按权重抽出来，再在组内均匀抽 1 件（`pickWeighted` 是 rng 里的既有单点）
        const chosen = pickWeighted(state.rng, groups, (g) => g.weight, { bound: 'lte' }) ?? groups[0]!
        return pickOne(state.rng, chosen.ids)
      }
      // ③ 最后兜底：扁平回落池（甲1案）。缺省空 ⇒ 旧口径不变
      const flat = [...themeFallback]
      return flat.length > 0 ? pickOne(state.rng, flat) : undefined
    })()
    if (pick !== undefined) {
      /**
       * ⚠ **2026-09-26 只有"无人机物品"改道**（船长令「H族已经添加势力装备，可以放入残骸内」＋「甲2」）：
       * 主题件池里可能出现**非模块件**——H 族墨潮帮三件里有一架无人机（`drone-ink-heavy`）。
       * 改前这一支无条件 `modules.push(pick)`，而调用点（`industry.ts` 的彩头结算）把 `modules`
       * 一律记进 `moduleBay` ⇒ 无人机 id 会变成一件"假模块"进装备库。
       *
       * 分派口径（**保持改前的缺省行为**，只多一条无人机支）：
       * 蓝图 ⇒ `blueprints` · **物品且 `kind === 'drone'` ⇒ `drones`（一次 `RARE_BOX_DRONE_UNITS` 架）** ·
       * 其余（模块 / 池里的合成 id / 未知 id）⇒ `modules`（逐字同旧口径 —— `rare-box-weight` 用例
       * 就是拿合成 id 抽样，不能被改道）。
       */
      const themeBpDef = ctx.blueprints.get(pick)
      const themeItemDef = ctx.items.get(pick)
      if (themeBpDef) {
        blueprints.push(pick)
        notes.push(`主题图纸「${themeBpDef.name}」`)
      } else if (themeItemDef?.kind === 'drone') {
        drones.push({ id: pick, count: RARE_BOX_DRONE_UNITS })
        notes.push(`主题装备「${themeItemDef.name}」×${RARE_BOX_DRONE_UNITS} 架`)
      } else {
        modules.push(pick)
        notes.push(`主题装备「${ctx.modules.get(pick)?.name ?? themeItemDef?.name ?? pick}」`)
      }
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
  /**
   * **本组来源敌族**（**船长 2026-10-01 令**：「**AI 核心为 R 族残骸回收的特色**」）——
   * 回收炉的族专属产出（现只有 R 族的核心掉落）靠它判；其余各族**不写该字段** ⇒ 零行为变化。
   */
  family?: FoeFamily
  /** 来源地区（高安 / 低安 / 虫洞 / 入侵）——洞内高级箱的"主题件回落池"按它判 */
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
  /**
   * **入侵族特色池**（**2026-10-03 船长定**；只有 `region: 'inv'` 的两组配了它）。
   * 非空 ⇒ {@link rollRecycleLoot} 的 ①★ 支**取代**基础直出：每批 10% 掷中，从
   * `themeGear ×1 ＋ themeGearMk2 ×20` 里抽一件；未掷中则该批无物品。见 `INVASION_FEATURE_CHANCE`。
   */
  themeGear?: readonly string[]
  /** 见 `themeGear`：特色池的家族 MK2 部分（权重 20，可重复获得） */
  themeGearMk2?: readonly string[]
  /**
   * **稀有箱"未命中专属支"时的主题件池**（**2026-10-03**）：入侵两组的 `theme` 按契约保持为空
   * ⇒ 兜底支另配这一格（船长令「**稀有残骸必定出特色掉落**」）。非入侵组不带它，
   * `rollRareBoxExtra` 照旧走 `rareBoxThemePoolOf(profile)`（= `theme`）。 */
  rareTheme?: readonly string[]
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
  // 2026-09-27 船长令（R4/R5 上位技能批）：残骸精炼学 +2.5%/级（与残骸提纯学乘算叠加）
  const upLv = Math.min(5, state.skills.trained['wreck-refining'] ?? 0)
  return (1 + 0.08 * lv) * (1 + 0.025 * upLv)
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
 * **入侵族「特色掉落」三个常量**（**2026-10-03 船长定**）。
 *
 * 船长原话（照抄）：「**不能使用和星系内残骸同样的设置吗？普通残骸有10%概率出特色掉落，特色掉落里，
 * MK2和势力装备混在一起。稀有残骸必定出特色掉落**」＋两条选择（掷点 = **回收炉每批**；
 * 掷中后在「专属件 : MK2」间按 **1 : 20** 分、**可重复获得**）。
 *
 * 掷法（{@link rollRecycleLoot} 的 ① 支）：每批先掷 {@link INVASION_FEATURE_CHANCE}；掷中 ⇒ **替换**那一次
 * 基础直出、从特色池（族专属件权重 1 ＋ 家族 MK2 权重 20）里抽一件；未掷中 ⇒ 本批无物品。
 * 池内容按组配在 `wreckGroups.WreckGroupDef.themeGear` / `themeGearMk2`。
 *
 * ⚠ **为什么"替换"而不是"追加"**：旧的"主题追加件"机制（`theme.modules`）为了保值会按
 * `默认池均价 ÷ 总池均价` **反比压低**整条直出链的概率 —— 塞进 960 万级的族专属件后实测出件率
 * **×0.031**（每 269 批一件 → 每 4,900 批一件），普通掉落被一起关掉。改成"换池"后概率只由本常量决定。
 *
 * ⚠ **这一支有意不接受"每批 EV 守恒"**（本批立下的口径 · 与船长的 10% 不可兼得，实测见下）：
 * 旧的"按均价反比缩放"等价于给每次命中套一个**价值上限** = 原来那一次基础直出的期望
 * （`0.00008 × 默认池均价 33,800` ≈ **2.7 ISK/批**）。特色池均价 1.27M ⇒ 守恒要求的概率只有
 * **0.00021%**（≈ 1,900 h 一件），与船长要的 10% 差 4.7 万倍。
 * ⇒ 取船长的 10%，代价**精确记账**：特色掉落 EV **2.7 ISK/批 → 127,000 ISK/批**（刻意提高）。
 *
 * **尺度对照（一场入侵 ≈ 42 场战斗 ≈ 4,000 m³ 残骸）**：
 * - 族专属件 **0.19 件/场**（≈ 2.0M ISK）· 家族 MK2 **3.8 件/场**（≈ 1.7M ISK）⇒ 物品合计 ≈ 3.7M ISK/场；
 * - 同一批残骸的**保底矿物 ≈ 0.41M ISK**（101.88 ISK/m³）、**基础直出件**（旧机制）≈ 0.017M ISK
 *   ⇒ 本支把**物品**收入抬到主位，但**总收益仍以保底矿物为地板**（36.5k ISK/m³，其中矿物占 0.3%）。
 */
export const INVASION_FEATURE_CHANCE = 0.1
/** 特色池里**族专属件**的权重（家族 MK2 的总权重见下） */
export const INVASION_FEATURE_GEAR_WEIGHT = 1
/**
 * 特色池里**家族 MK2 一侧的总权重**（⇒ 族专属件占总命中的 `1 / (1 + 20)` ≈ **4.76%**）。
 * ⚠ 这是**整组的总权重**、不是"每件 20"：实现按 `20 ÷ 该组件数` 摊到每一件
 * （若误写成"每件 20"，三件 MK2 时实际比例会变成 1 : 60）。
 */
export const INVASION_FEATURE_MK2_WEIGHT = 20
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
/**
 * 碎片物品定义（按目标装备生成；不可出售）。
 *
 * ⚠ **名字是"拼"出来的**（`${moduleName}蓝图碎片`）⇒ 英文界面下必须是
 * `${moduleName} Blueprint Fragment`。core 不认识渲染层的语言，所以这里收成一个
 * **可选 `en` 覆盖对象**（键与下面两句同形，由数据层 `EN_FRAGMENT` 供给，见 `context.ts` 的调用点）：
 * 给了就是英文侧的那两句（`{p1}` ＝ 装备名、`{p1}` ＝ 门槛片数），不给就仍出中文原串
 * （工具 / 用例 / 中文侧零变化）。
 */
export function fragmentItemDefOf(
  moduleId: string,
  moduleName: string,
  en?: Readonly<{ name: string; description: string }>,
): ItemDef {
  const need = FRAGMENT_RECIPES[moduleId]?.need ?? '?'
  if (en !== undefined) {
    return {
      id: fragmentItemIdOf(moduleId),
      name: en.name.replace('{p1}', moduleName),
      kind: 'fragment',
      unitM3: 0.02,
      baseSellPriceIsk: 1,
      description: en.description.replace('{p1}', String(need)),
    }
  }
  return {
    id: fragmentItemIdOf(moduleId),
    name: `${moduleName}蓝图碎片`,
    kind: 'fragment',
    unitM3: 0.02,
    baseSellPriceIsk: 1,
    description: `逆向研究残骸得到的蓝图碎片：集齐 ${need} 片后，在物品页的「蓝图碎片」分组里点「逆向解锁」即可换成该装备的永久蓝图（需停靠空间站）。集齐前不会重复掉落同一本书的碎片——拿到蓝图后它就不再出现。`,
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
  const defBase = RECYCLE_BASE_MODULES.filter((id) => ctx.modules.has(id))
  /**
   * ①★ **入侵族「特色池」**（**2026-10-03 船长定**，见 `INVASION_FEATURE_CHANCE` 的头注）：
   * 按组配了 `themeGear`（族专属件）⇒ **本支取代** 原来那一次"基础直出"，
   * 掷中 `INVASION_FEATURE_CHANCE`（10%）从 `族专属件(权重 1) : 家族 MK2(权重 20)` 里抽一件，
   * 未掷中则这一批没有物品。
   * ⚠ 正是"取代"（不是追加）才躲开了旧机制"按均价反比缩放把整条链压低"的坑（实测 ×0.031）。
   * ⚠ 本支**有意不套"每批 EV 守恒"**（那是旧机制的语义；套上去概率只有 0.00021%，与船长要的 10%
   * 差 4.7 万倍）——理由与代价逐条记在 `INVASION_FEATURE_CHANCE` 的注释里。
   */
  const featureGear = (profile.themeGear ?? []).filter((id) => ctx.modules.has(id))
  if (featureGear.length > 0) {
    const featureMk2 = (profile.themeGearMk2 ?? []).filter((id) => ctx.modules.has(id))
    /**
     * 权重展开成抽取池——用现成的 `pickOne`，不另造加权抽取。
     * ⚠ **按"两组的总权重"配比，不是"单件对单件"**：船长要的是 **族专属件组 : 家族 MK2 组 = 1 : 20**
     * ⇒ MK2 侧的总权重 = 20（摊到该组每件 = `20 ÷ 件数`）。若写成"每件各 20"，
     * 三件 MK2 时实际比例会变成 1 : 60（实测族专属件占比 1.63% 而非 4.76%）。
     */
    const mk2PerItem = Math.max(1, Math.round(INVASION_FEATURE_MK2_WEIGHT / Math.max(1, featureMk2.length)))
    const pool = [
      ...featureGear.flatMap((id) => Array.from({ length: INVASION_FEATURE_GEAR_WEIGHT }, () => id)),
      ...featureMk2.flatMap((id) => Array.from({ length: mk2PerItem }, () => id)),
    ]
    const t2PoolF = fragmentPoolOf(state, ctx, 2)
    const t3PoolF = fragmentPoolOf(state, ctx, 3)
    for (let i = 0; i < batchUnits; i++) {
      if (pool.length > 0 && nextRandom(state.rng) < INVASION_FEATURE_CHANCE) {
        modules.push(pickOne(state.rng, pool)!)
      }
      if (profile.threat >= 17 && t2PoolF.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT2) {
        fragments.push(pickOne(state.rng, t2PoolF)!)
      }
      if (profile.threat >= 41 && t3PoolF.length > 0 && nextRandom(state.rng) < RECYCLE_CHANCE.fragT3) {
        fragments.push(pickOne(state.rng, t3PoolF)!)
      }
    }
    return { modules, fragments }
  }
  // ① 基础件直出线：默认池（8 件，2026-09-08 起含三系 MK1 武器）+ 中安主题追加件
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

/* ═══════════ R 族残骸回收的 AI 核心（**船长 2026-10-01 令**）═══════════ */

/**
 * **AI 核心 = R 族残骸回收的特色**（**船长 2026-10-01 令**：「**AI 核心为 R 族残骸回收的特色**」＋
 * 「核心结算方式…如果是〔回收时抽中〕，**直接入账**」）。
 *
 * 口径（同日四问的裁定，逐条记在案）：
 * - **触发点 = 回收炉烧 R 族残骸时**（选「甲」）——残骸回收炉每处理**一批**（`RECYCLE_BATCH_M3` = 100 m³）
 *   额外掷一次；其余各族**一次都不掷**（`rollRecycleCoreGain` 见到非 R 族直接返回 `undefined`）；
 * - **产出率 10%**、命中后按 **60 / 30 / 10** 抽伽马 / 贝塔 / 阿尔法（选「甲」；与虫洞遗迹打捞那把尺逐字一致，
 *   见 `wormholeSalvage.WORMHOLE_CORE_SHARE` / `WORMHOLE_CORE_WEIGHTS`）；
 * - **只在回收炉出**（选「甲」）⇒ 打捞舰那条「完好舰体当场直发」的彩头链**一个字不动**；
 * - **直接入核心账本**（`state.aiCores`），**不进仓库**——这是既有硬契约：核心是一本账，
 *   三种实物物品一律 `unreleased: true`（见 `packages/data/src/marketCatalog.ts` 那条注释）；
 * - **独立随机流**：种子 = `hashSeed(wreckItemId + ':' + 批序号)` ⇒ **不消耗 `state.rng`**
 *   ⇒ 既有各族的回收产出（基础件 / MK2 / 碎片 / 高级箱）**逐字不变**（照「不挤占旧有出率」的既有契约）。
 *
 * ⚠ 批序号由调用方传入（`industry.ts` 的回收炉批次结算处）⇒ **同一批的结果可复现**、
 * 不同批之间互不相关；同族不同残骸（普通 / 稀有）各自数十。
 */
export const RECYCLE_CORE_SHARE = 0.1

/** 命中后三档的相对权重（船长 2026-10-01 选「甲」：沿用遗迹打捞的 60 / 30 / 10） */
export const RECYCLE_CORE_WEIGHTS: Readonly<Record<'gamma' | 'beta' | 'alpha', number>> = {
  gamma: 60,
  beta: 30,
  alpha: 10,
}

/**
 * **掷一次回收炉的核心掉落**（纯函数：只读入参、不碰 `state.rng`）。
 *
 * @param wreckItemId 本批烧的残骸物品 id（`wreck-r-inv` / `wreck-rare-r-inv`…）
 * @param batchSeq 本炉**第几批**（同一批重复调用结果一致）
 * @returns 核心档位（`'gamma' | 'beta' | 'alpha'`）；非 R 族或没掷中 ⇒ `undefined`
 */
export function rollRecycleCoreGain(
  wreckItemId: string,
  batchSeq: number,
): 'gamma' | 'beta' | 'alpha' | undefined {
  const group = wreckGroupOfWreckItem(wreckItemId)
  if (group?.family !== 'R') return undefined // **只有 R 族**（船长令：AI 核心是本族残骸回收的特色）
  // **本函数自带一条独立流**（不复用 `state.rng`、也不借 `rng.ts` 的内部实现，只借它的 `hashSeed`）——
  // 一个最小 LCG（Numerical Recipes 常数）就够：本处只要"确定性 + 分布均匀 + 与主序列无关"三条。
  let s = hashSeed(`${wreckItemId}:${Math.max(1, Math.round(batchSeq))}`) >>> 0
  const rng = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  if (rng() >= RECYCLE_CORE_SHARE) return undefined
  const total = RECYCLE_CORE_WEIGHTS.gamma + RECYCLE_CORE_WEIGHTS.beta + RECYCLE_CORE_WEIGHTS.alpha
  let pick = rng() * total
  for (const type of ['gamma', 'beta', 'alpha'] as const) {
    pick -= RECYCLE_CORE_WEIGHTS[type]
    if (pick < 0) return type
  }
  return 'gamma' // 浮点兜底（理论到不了）
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

