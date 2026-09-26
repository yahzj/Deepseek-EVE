/**
 * **玩家舰船残骸**（**2026-09-26 船长令**，设计稿 `docs/design/ship-wreck-20260926.md`）。
 *
 * 船长原话（照抄）：「**准备添加新机制，玩家舰船被摧毁后，如果是在非虫洞的正常星系内，在该星系生成一个
 * '<被摧毁的舰船名称>的残骸'该残骸存在48小时，玩家如果在该星系打捞，优先打捞该残骸（比稀有残骸优先级还高）。
 * 打捞后玩家按照一定概率和比例回收被摧毁舰船的部分装备。除此以外没有其他资源。**」
 * ＋「**留一个接口，给之后舰船插件的。之后会添加一个加固结构的舰船插件，有加固结构的插件，
 * 玩家有概率能够回收该舰船。**」
 *
 * ## 一句话
 * 船在正常星系被打没 ⇒ 该星系留一具写着船名的残骸，**48 游戏小时线性衰减**；在那儿打捞时它**排在最前面**
 * （压过稀有池），每轮从它身上捞 1 件、**逐件掷概率**回收装备；**没有矿物、没有信用点、没有其它资源**。
 *
 * ## 与另两本残骸账的关系（**三本账，各管各的**）
 * | 账 | 载体 | 语义 |
 * | --- | --- | --- |
 * | 星系池 | `galaxyWrecks` | 有基础密度、4h/48h 漂移 |
 * | 入侵残骸场 | `weekendWrecks` | 无保底、48h 线性衰减、带来源族 |
 * | **玩家舰船残骸** | `shipWrecks`（本文件） | **逐具记账**（同一星系可多具）、48h 线性衰减、带**装配快照** |
 *
 * ## 打捞序（四级；第 ①★ 档是本文件）
 * ```
 * ①★ 玩家舰船残骸（trySalvagePlayerWreckOf） ← 有就每轮从中捞 1 件
 * ① 稀有池（捞完为止）
 * ② 普通池 ⓐ 同池内入侵残骸优先  ⓑ 否则按各组数量比
 * ```
 *
 * ## 加固结构插件接口（**本批只留口子**）
 * `ModuleDef.hullRecoveryChance`（0~1）= 带该字段的件即"加固结构插件"。损毁那一刻把该船装着的加固件
 * 数值**求和**存进 `ShipWreckRecord.reinforceChance`（日后插件改数值，**已生成的残骸口径不变**）。
 * **现无一件带此字段 ⇒ 回收率恒 0 ⇒ 整船回收永不触发**，行为与"没有这个接口"逐字相同。
 *
 * ⚠ **依赖方向**：本文件只依赖 `state` / `types` / `rng`。**刻意不 import `equipment` 与 `instances`**
 * （那两者处在装配与舰船域的中心，引进来容易成环）；"装配件求回收率之和"与"舰船显示名"都由调用方
 * （`shipyard.loseShip` / `salvaging`）算好传进来。
 */
import type { GameState, ShipWreckRecord } from './state'
import type { FittedModules, SimContext } from './types'
import { nextInt, nextRandom } from './rng'

/** 玩家舰船残骸的衰减时长（48 游戏小时线性到 0；与入侵残骸同一把尺） */
export const SHIP_WRECK_DECAY_MS = 48 * 3_600_000
/** 衰减尾数收口（有效值小于此值直接清记录 ⇒ 残骸条消失） */
const SHIP_WRECK_SNAP = 0.05
/** 每具残骸的"残骸量"当量（**只决定"这具残骸在不在"**：衰减到 0 即消失；**不折算矿物、不并入任何密度读数**） */
export const SHIP_WRECK_WEIGHT = 30
/** **加固结构插件的整船回收率上限**（加算后夹到本值：概率类不封顶容易被叠成必成） */
export const HULL_RECOVERY_MAX = 0.6
/** 整船回收后回港的舰船状态：结构（耐久）与装甲按残骸时刻的值打折 */
export const RECOVERED_HULL_DURABILITY_PCT = 0.3
export const RECOVERED_HULL_ARMOR_PCT = 0.5

/**
 * **逐件回收率**（船长 2026-09-26 选「概率按槽位分档」）。
 *
 * 判据 = `ModuleDef.slot`（家族）：**武器与无人机火控**最好捞回、**无人机本身**最容易彻底损失、
 * **其余**居中。⚠ **新家族（日后新槽位）一律落兜底档**——宁可保守，也不要让新件意外变成必丢件。
 */
export const WRECK_RECOVERY_RATE = {
  /** 武器与无人机火控（炮台 / 导弹 / 激光 / 战术导控 / 中继） */
  weapon: 0.6,
  /** 装甲 / 护盾 / 货舱扩展 */
  hull: 0.4,
  /** 无人机舱各型（消耗件性质，损失最合理） */
  drone: 0.25,
  /** 兜底（其它家族：支援件、推进器等） */
  other: 0.4,
} as const

/** 取该模块家族对应的回收率 */
export function recoveryRateOfSlot(slot: string | undefined): number {
  switch (slot) {
    case 'turret':
    case 'missile':
    case 'laser':
    case 'drone-tac':
    case 'drone-relay':
      return WRECK_RECOVERY_RATE.weapon
    case 'drone-rack':
      return WRECK_RECOVERY_RATE.drone
    case 'armor':
    case 'shield':
    case 'cargo':
      return WRECK_RECOVERY_RATE.hull
    default:
      return WRECK_RECOVERY_RATE.other
  }
}

/** 一具残骸里还等着掷骰的装备行（**装配件按高→中→低槽序，无人机最后**；一行 = 一次掷骰） */
export interface WreckLootRow {
  itemId: string
  /** 模块 = 1；无人机 = 架数 */
  units: number
  isModule: boolean
  /** 回收率（装配件按模块家族、无人机按兜底档判据走 `drone-rack` 之外的物品口径） */
  rate: number
}

/** 按模块定义判该模块属于哪一档（`ctx.modules` 查不到 ⇒ 兜底档） */
function moduleRateOf(id: string, ctx: SimContext): number {
  return recoveryRateOfSlot(ctx.modules.get(id)?.slot)
}

/** 该残骸还剩哪些「可掷行」（顺序即掷骰顺序） */
export function wreckLootRowsOf(rec: ShipWreckRecord, ctx: SimContext): WreckLootRow[] {
  const rows: WreckLootRow[] = []
  for (const slot of ['high', 'mid', 'low'] as const) {
    for (const id of rec.fitted?.[slot] ?? []) {
      if (typeof id === 'string' && id.length > 0) rows.push({ itemId: id, units: 1, isModule: true, rate: moduleRateOf(id, ctx) })
    }
  }
  for (const [id, n] of Object.entries(rec.droneLoad ?? {})) {
    if (id.length > 0 && Number.isFinite(n) && n > 0 && ctx.items.has(id)) {
      rows.push({ itemId: id, units: Math.floor(n), isModule: false, rate: WRECK_RECOVERY_RATE.drone })
    }
  }
  return rows
}

/** 由记录算**当前有效残骸量**（线性衰减：锚点值 × max(0, 1 − 已漂移/48h)） */
export function shipWreckValueOf(rec: ShipWreckRecord): number {
  const left = 1 - Math.max(0, rec.decayAccMs) / SHIP_WRECK_DECAY_MS
  return left <= 0 ? 0 : Math.max(0, rec.density) * left
}

/**
 * **加固结构插件的整船回收率**（唯一判定单点）。
 *
 * = 快照里存下的 `reinforceChance`（损毁那刻求和的加固件数值，上游已夹到 `HULL_RECOVERY_MAX`）。
 * **无插件 / 老档 ⇒ 0** ⇒ 整船回收永不触发（这条留白由用例钉住）。
 */
export function hullRecoveryChanceOf(rec: ShipWreckRecord): number {
  const v = rec.reinforceChance
  if (v === undefined || !Number.isFinite(v) || v <= 0) return 0
  return Math.min(HULL_RECOVERY_MAX, v)
}

/** 某星系当前所有有效残骸（**按记录号倒序 = 最新那具优先**）；无 = 空表 */
export function shipWrecksOf(state: GameState, galaxyId: string): ShipWreckRecord[] {
  const out: ShipWreckRecord[] = []
  for (const rec of Object.values(state.shipWrecks ?? {})) {
    if (rec.galaxyId !== galaxyId) continue
    if (shipWreckValueOf(rec) <= SHIP_WRECK_SNAP) continue
    out.push(rec)
  }
  return out.sort((a, b) => b.seq - a.seq)
}

/** 该星系当前该捞的那一具（最新一条；无 = `undefined`） */
export function shipWreckFor(state: GameState, galaxyId: string): ShipWreckRecord | undefined {
  return shipWrecksOf(state, galaxyId)[0]
}

/** 该星系是否有一具「还有东西可捞」的玩家残骸（四级序第 ①★ 档的判据，界面与打捞序共用） */
export function hasSalvageableShipWreck(state: GameState, galaxyId: string): boolean {
  return shipWrecksOf(state, galaxyId).some((rec) => (rec.fitted !== undefined || rec.droneLoad !== undefined))
}

/**
 * 损毁那一刻的**加固件回收率之和**（夹到 `HULL_RECOVERY_MAX`）。给 `shipyard.loseShip` 用：
 * 它手上有 `ctx` 与 `fitted`，本模块刻意不引 `equipment`（避免成环）。
 */
export function reinforceChanceOfFitted(fitted: FittedModules | undefined, ctx: SimContext): number {
  if (!fitted) return 0
  let sum = 0
  for (const slot of ['high', 'mid', 'low'] as const) {
    for (const id of fitted[slot] ?? []) {
      if (typeof id !== 'string') continue
      const v = ctx.modules.get(id)?.hullRecoveryChance
      if (v !== undefined && Number.isFinite(v) && v > 0) sum += v
    }
  }
  return Math.min(HULL_RECOVERY_MAX, sum)
}

/**
 * **船的装配快照 → 残骸条目**（由 `shipyard.loseShip` 在**删船之前**调用）。
 *
 * ⚠ **顺序不能反**：`loseShip` 里 `delete state.fleet[shipId]` 之后，装配与无人机就什么都没有了。
 */
export function noteShipWreck(
  state: GameState,
  args: {
    galaxyId: string
    shipId: string
    /** 损毁那一刻的显示名（含玩家自定义名）⇒ 残骸名 = 「<船名>的残骸」 */
    shipName: string
    defId?: string
    /** 结构层（= `FleetShipState.durability`）；整船回收后按 ×`RECOVERED_HULL_DURABILITY_PCT` 回港 */
    durability?: number
    armorPct?: number
    fitted?: FittedModules
    droneLoad?: Record<string, number>
    /** 加固结构插件的回收率之和（`reinforceChanceOfFitted`）；0 / 无 ⇒ 不写字段 */
    reinforceChance?: number
    /** 生成时刻（现实墙钟，仅读数用；衰减按游戏时间走） */
    createdAtWallMs?: number
  },
): ShipWreckRecord {
  const map = (state.shipWrecks ??= {})
  const seq = (state.shipWreckSeq ?? 0) + 1
  state.shipWreckSeq = seq
  const hasDrones = args.droneLoad !== undefined && Object.keys(args.droneLoad).length > 0
  const rec: ShipWreckRecord = {
    seq,
    galaxyId: args.galaxyId,
    shipId: args.shipId,
    name: `${args.shipName}的残骸`,
    ...(args.defId !== undefined ? { defId: args.defId } : {}),
    ...(args.fitted !== undefined ? { fitted: args.fitted } : {}),
    ...(hasDrones ? { droneLoad: args.droneLoad } : {}),
    ...(args.durability !== undefined ? { durability: args.durability } : {}),
    ...(args.armorPct !== undefined ? { armorPct: args.armorPct } : {}),
    ...(args.reinforceChance !== undefined && args.reinforceChance > 0
      ? { reinforceChance: Math.min(HULL_RECOVERY_MAX, args.reinforceChance) }
      : {}),
    density: SHIP_WRECK_WEIGHT,
    decayAccMs: 0,
    createdAtWallMs: Number.isFinite(args.createdAtWallMs) ? (args.createdAtWallMs as number) : 0,
  }
  map[rec.shipId] = rec
  return rec
}

/**
 * **玩家舰船残骸的闲置衰减推进**（48h 线性；**打捞进行中的那个星系挂起**，与另两本账同规则）。
 * 由 `salvage.advanceWreckDrift` 每拍带一遍；到点即删记录（残骸条消失）。
 */
export function advanceShipWreckDecay(state: GameState, dtMs: number, salvagingGalaxyId: string | null = null): void {
  const map = state.shipWrecks
  if (!map) return
  for (const rec of Object.values(map)) {
    if (rec.galaxyId === salvagingGalaxyId) continue
    const acc = Math.max(0, rec.decayAccMs) + dtMs
    if (acc >= SHIP_WRECK_DECAY_MS || shipWreckValueOf({ ...rec, decayAccMs: acc }) <= SHIP_WRECK_SNAP) {
      delete map[rec.shipId]
      continue
    }
    map[rec.shipId] = { ...rec, decayAccMs: acc }
  }
}

/** 从残骸里抹掉一行（装配件去掉第一处；无人机整型去掉） */
function removedLootFrom(rec: ShipWreckRecord, row: WreckLootRow): ShipWreckRecord {
  if (!row.isModule) {
    const droneLoad = { ...(rec.droneLoad ?? {}) }
    delete droneLoad[row.itemId]
    return { ...rec, droneLoad }
  }
  const fitted: FittedModules = {
    high: [...(rec.fitted?.high ?? [])],
    mid: [...(rec.fitted?.mid ?? [])],
    low: [...(rec.fitted?.low ?? [])],
  }
  for (const slot of ['high', 'mid', 'low'] as const) {
    const i = fitted[slot].indexOf(row.itemId)
    if (i >= 0) {
      fitted[slot].splice(i, 1)
      break
    }
  }
  return { ...rec, fitted }
}

/** 打捞一具玩家残骸的结果 */
export type PlayerWreckSalvage =
  /** 这一轮什么都没捞到（件没掷中 / 残骸里已经没东西）——残骸**留着**（已空的会被清掉） */
  | { kind: 'none' }
  /** 捞回一件（模块 id 或无人机 id；`units` = 架数） */
  | { kind: 'item'; itemId: string; units: number; isModule: boolean }
  /** **整船回收**（加固结构插件命中）：船回港，残骸消失 */
  | { kind: 'ship'; wreckName: string; defId?: string; durability?: number; armorPct?: number }

/**
 * **从玩家舰船残骸里捞一轮**（四级序第 ①★ 档，唯一入口）。四条判定，按序：
 *
 * 1. **整船回收**（**只在第一次捞这具残骸时掷**；未命中即记 `hullRolled` ⇒ **一具只掷一次**，防反复捞刷概率）
 *    —— 加固结构插件接口；**回收率 0 ⇒ 不掷、不消耗随机数**（"没有这个接口"的路径与今天逐位一致）；
 * 2. **逐行掷骰**（行序 = 高/中/低槽装配件 → 无人机）：命中即取该行、扣掉、产出这一件；
 * 3. **保底**：整具残骸一次都没给过东西（`pityUsed` 未置）且本轮没中 ⇒ 从剩余行里等概率给回一件；
 * 4. 行全部清空 ⇒ **残骸消失**；否则留着等下一轮（48h 内）。
 */
export function trySalvagePlayerWreckOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): PlayerWreckSalvage {
  const map = state.shipWrecks
  const rec = shipWreckFor(state, galaxyId)
  if (!map || !rec) return { kind: 'none' }

  // ① 整船回收（加固结构插件）
  if (rec.hullRolled !== true) {
    const chance = hullRecoveryChanceOf(rec)
    if (chance <= 0) {
      // 没有插件接口 ⇒ 标记已掷（免得日后插件上线时，老残骸补掷一次）
      map[rec.shipId] = { ...rec, hullRolled: true }
    } else if (nextRandom(state.rng) < chance) {
      delete map[rec.shipId]
      return {
        kind: 'ship',
        wreckName: rec.name,
        ...(rec.defId !== undefined ? { defId: rec.defId } : {}),
        ...(rec.durability !== undefined ? { durability: rec.durability } : {}),
        ...(rec.armorPct !== undefined ? { armorPct: rec.armorPct } : {}),
      }
    } else {
      map[rec.shipId] = { ...rec, hullRolled: true }
    }
  }

  // ② 逐行掷骰
  const rows = wreckLootRowsOf(rec, ctx)
  if (rows.length === 0) {
    delete map[rec.shipId] // 空壳：不该留（正常路径应在取走最后一件时删掉）
    return { kind: 'none' }
  }
  let row = rows.find((r) => nextRandom(state.rng) < r.rate)
  const usedPity = row === undefined
  // ③ 保底：整具残骸一次都没给过东西 ⇒ 至少给回一件
  if (!row && rec.pityUsed !== true) row = rows[nextInt(state.rng, rows.length)]
  if (!row) return { kind: 'none' }

  // ④ 扣减与收口
  const after = removedLootFrom(rec, row)
  const left = wreckLootRowsOf(after, ctx)
  if (left.length === 0) {
    delete map[rec.shipId]
  } else {
    map[rec.shipId] = { ...after, hullRolled: true, ...(usedPity ? { pityUsed: true } : {}) }
  }
  return { kind: 'item', itemId: row.itemId, units: row.units, isModule: row.isModule }
}
