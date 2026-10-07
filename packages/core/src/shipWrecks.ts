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
 * 新残骸按2026-10-07船长确认的整船回收/装备保全规则；缺recoveryRules的旧残骸保留原规则。
 * 加固件的hullRecoveryChance在损毁时求和存reinforceChance，新规则再与基础率/当前工程技能加算。
 *
 * ⚠ **依赖方向**：本文件只依赖 `state` / `types` / `rng`。**刻意不 import `equipment` 与 `instances`**
 * （那两者处在装配与舰船域的中心，引进来容易成环）；"装配件求回收率之和"与"舰船显示名"都由调用方
 * （`shipyard.loseShip` / `salvaging`）算好传进来。
 */
import type { GameState, ShipWreckRecord, WreckLogEntry } from './state'
import type { FittedModules, SimContext } from './types'
import { nextInt, nextRandom } from './rng'
import { cleanShipDamage, rollShipDamage, type ShipDamageKind } from './shipDamage'

/** 玩家舰船残骸的衰减时长（48 游戏小时线性到 0；与入侵残骸同一把尺） */
export const SHIP_WRECK_DECAY_MS = 48 * 3_600_000

/** 沉船记录条数上限（**2026-09-27 船长令**：留最近 30 条，超出丢最旧） */
export const WRECK_LOG_MAX = 30

/** 追加一条沉船记录（**新的在前**、超上限截尾；同记录号去重防御） */
export function noteWreckLog(state: GameState, entry: WreckLogEntry): void {
  const rest = (state.wreckLog ?? []).filter((e) => e.seq !== entry.seq)
  state.wreckLog = [entry, ...rest].slice(0, WRECK_LOG_MAX)
}

/** 沉船记录列表行（界面只读它，不自己算状态） */
export interface WreckLogRow {
  entry: WreckLogEntry
  /** 残骸状态：可打捞 / 已回收 / 已过期（残骸账里已无且没标已回收）/ 没有残骸（虫洞内损毁） */
  wreck: 'salvageable' | 'recovered' | 'expired' | 'none'
  /** 可打捞时：剩余游戏内毫秒 */
  leftMs?: number
}

/**
 * **沉船记录读数**（**2026-09-27 船长令**）：新的在前；残骸状态是**读残骸账算出来的**——
 * 那边还有这具 ⇒ 可打捞（剩余 = 48h − 已衰减）；没了且记录标了 `recovered` ⇒ 已回收；否则 ⇒ 已过期。
 */
export function wreckLogRowsOf(state: GameState, ctx: SimContext): WreckLogRow[] {
  const list = state.wreckLog ?? []
  const out: WreckLogRow[] = []
  for (const entry of list) {
    const rec = entry.wreckGalaxyId !== undefined ? state.shipWrecks?.[entry.shipId] : undefined
    if (rec !== undefined) {
      const leftMs = Math.max(0, SHIP_WRECK_DECAY_MS - rec.decayAccMs)
      out.push({ entry, wreck: 'salvageable', leftMs })
    } else if (entry.wreckGalaxyId === undefined) {
      out.push({ entry, wreck: 'none' })
    } else if (entry.recovered === true) {
      out.push({ entry, wreck: 'recovered' })
    } else {
      out.push({ entry, wreck: 'expired' })
    }
  }
  void ctx
  return out
}

/** 某艘船的残骸**被捞走** ⇒ 记录里标「已回收」（超出上限的老记录已不在列表 ⇒ 无事发生） */
export function markWreckRecovered(state: GameState, shipId: string): void {
  const list = state.wreckLog
  if (!list || list.length === 0) return
  let hit = false
  const next = list.map((e) => {
    if (e.shipId !== shipId || e.recovered === true) return e
    hit = true
    return { ...e, recovered: true }
  })
  if (hit) state.wreckLog = next
}
/**
 * **插件换回的黑匣物品 id**（船长：「**玩家回收按插件数量直接回收成黑匣**」）。
 *
 * ⚠ 本文件**刻意不 import 作业模块**（依赖方向：本文件只依赖 `state` / `types` / `rng`）⇒
 * 这条**纯常数**就地复制一份；设计口径的权威副本在 `blackbox.ts`（`PLUG_BLACKBOX_ITEM_ID`；
 * 2026-10-02 起从 `plugs.ts` 移居，破 blackbox→plugs 环），两处由用例钉住同值。
 */
export const WRECK_PLUG_BLACKBOX_ITEM_ID = 'blackbox-h'
/** 衰减尾数收口（有效值小于此值直接清记录 ⇒ 残骸条消失） */
const SHIP_WRECK_SNAP = 0.05
/** 每具残骸的"残骸量"当量（**只决定"这具残骸在不在"**：衰减到 0 即消失；**不折算矿物、不并入任何密度读数**） */
export const SHIP_WRECK_WEIGHT = 30
/** 新残骸整船回收总上限；基础/技能/加固件全部加算后夹取。 */
export const HULL_RECOVERY_MAX = 0.9
const LEGACY_HULL_RECOVERY_MAX = 0.6
export const WRECK_RECOVERY_SKILL = {
  hullBase: 0.25,
  hullSkillId: 'hull-salvage-engineering',
  hullPerLevel: 0.05,
  advancedHullSkillId: 'advanced-hull-salvage-engineering',
  advancedHullPerLevel: 0.04,
  equipmentBase: 0.8,
  equipmentSkillId: 'wreck-equipment-preservation',
  equipmentPerLevel: 0.04,
} as const
export const RECOVERED_SHIP_CONDITION = 0.2
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
    // 无人机储备甲板（2026-09-27）：与甲板扩展同档 —— 都是**无人机保障件**、不是武器
    case 'drone-deck':
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
 * 整船回收概率单点：新规则基础+打捞时技能+损毁时加固件快照；旧规则只读加固件快照。
 */
export function hullRecoveryChanceOf(rec: ShipWreckRecord, state?: Pick<GameState, 'skills'>): number {
  const reinforce = Number.isFinite(rec.reinforceChance) ? Math.max(0, rec.reinforceChance ?? 0) : 0
  if (rec.recoveryRules !== 2) return Math.min(LEGACY_HULL_RECOVERY_MAX, reinforce)
  const skill = WRECK_RECOVERY_SKILL
  return Math.min(HULL_RECOVERY_MAX, skill.hullBase + reinforce +
    skill.hullPerLevel * recoverySkillLevel(state, skill.hullSkillId) +
    skill.advancedHullPerLevel * recoverySkillLevel(state, skill.advancedHullSkillId))
}

function recoverySkillLevel(state: Pick<GameState, 'skills'> | undefined, id: string): number {
  const level = state?.skills.trained[id] ?? 0
  return Number.isFinite(level) ? Math.max(0, Math.min(5, Math.floor(level))) : 0
}

export function wreckEquipmentRecoveryChanceOf(state: Pick<GameState, 'skills'>): number {
  const skill = WRECK_RECOVERY_SKILL
  return Math.min(1, skill.equipmentBase + skill.equipmentPerLevel * recoverySkillLevel(state, skill.equipmentSkillId))
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
  return shipWrecksOf(state, galaxyId).some(
    (rec) => (rec.recoveryRules === 2 && !rec.hullRolled) || rec.fitted !== undefined || rec.droneLoad !== undefined || (rec.plugs?.length ?? 0) > 0,
  )
}

/**
 * 损毁那一刻的**加固件回收率之和**（夹到 `HULL_RECOVERY_MAX`）。给 `shipyard.loseShip` 用：
 * 它手上有 `ctx` 与 `fitted`，本模块刻意不引 `equipment`（避免成环）。
 */
export function reinforceChanceOfFitted(
  fitted: FittedModules | undefined,
  ctx: SimContext,
  /** 该船装着的插件 id（**加固结构插件走"插件槽"**，故必须单独传进来；缺省 = 没有） */
  plugIds?: readonly string[],
): number {
  let sum = 0
  for (const slot of ['high', 'mid', 'low'] as const) {
    for (const id of fitted?.[slot] ?? []) {
      if (typeof id !== 'string') continue
      const v = ctx.modules.get(id)?.hullRecoveryChance
      if (v !== undefined && Number.isFinite(v) && v > 0) sum += v
    }
  }
  // 加固结构插件按定义就是"插件槽"里的一件 ⇒ 它不在 `fitted` 里（`allFittedModules` 看不见插件）
  for (const id of plugIds ?? []) {
    const v = ctx.modules.get(id)?.hullRecoveryChance
    if (v !== undefined && Number.isFinite(v) && v > 0) sum += v
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
    customName?: string | null
    damagePlugs?: readonly ShipDamageKind[]
    /** 损毁时结构残余；旧回收读取，新规则用RECOVERED_SHIP_CONDITION固定残余。 */
    durability?: number
    armorPct?: number
    fitted?: FittedModules
    droneLoad?: Record<string, number>
    /** 损毁那一刻装着的插件 id（打捞时**按件数整批换回黑匣**，不逐件掷骰） */
    plugs?: readonly string[]
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
  const plugs = (args.plugs ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  const rec: ShipWreckRecord = {
    seq,
    galaxyId: args.galaxyId,
    shipId: args.shipId,
    name: `${args.shipName}的残骸`,
    recoveryRules: 2,
    ...(args.customName !== undefined ? { customName: args.customName } : {}),
    ...(cleanShipDamage(args.damagePlugs) ? { damagePlugs: cleanShipDamage(args.damagePlugs) } : {}),
    ...(args.defId !== undefined ? { defId: args.defId } : {}),
    ...(args.fitted !== undefined ? { fitted: args.fitted } : {}),
    ...(hasDrones ? { droneLoad: args.droneLoad } : {}),
    ...(plugs.length > 0 ? { plugs: [...plugs] } : {}),
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
      if (rec.recoveryRules === 2) fitted[slot][i] = null
      else fitted[slot].splice(i, 1)
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
  /**
   * **插件换回的黑匣**（**2026-09-26 船长令**「**玩家回收按插件数量直接回收成黑匣**」）——
   * 与"逐件掷骰捞回一件"**是两本账**：这一支**不掷骰、不问概率**，残骸里还留着插件就先整批给回，
   * 同一轮接着走正常的逐件掷骰。
   */
  | { kind: 'plugs'; blackBoxes: number }
  /** **整船回收**（加固结构插件命中）：船回港，残骸消失 */
  | { kind: 'ship'; wreckName: string; defId?: string; durability?: number; armorPct?: number; plugs?: string[];
      customName?: string | null; recoveryRules?: 2; fitted?: FittedModules; droneLoad?: Record<string, number>;
      damagePlugs?: ShipDamageKind[]; keptModules?: number; lostModules?: number }

/** 新规则先逐件筛出可回收模块；空位原样保留，重复模块各判一次。 */
function rollWreckEquipment(state: GameState, rec: ShipWreckRecord, ctx: SimContext, shipRecovered: boolean): FittedModules {
  const source = rec.fitted ?? { high: [], mid: [], low: [] }
  const rate = shipRecovered ? wreckEquipmentRecoveryChanceOf(state) : undefined
  const fitted = { high: [...source.high], mid: [...source.mid], low: [...source.low] }
  const candidates: Array<{ rack: keyof FittedModules; at: number; id: string }> = []
  let kept = 0
  for (const rack of ['high', 'mid', 'low'] as const) {
    for (let at = 0; at < fitted[rack].length; at++) {
      const id = fitted[rack][at]
      if (!id) continue
      candidates.push({ rack, at, id })
      if (nextRandom(state.rng) < (rate ?? moduleRateOf(id, ctx))) kept++
      else fitted[rack][at] = null
    }
  }
  // 拆捞仍保留至少一件；整船保全的80%不额外套用装备保底。
  if (!shipRecovered && kept === 0 && candidates.length > 0) {
    const pick = candidates[nextInt(state.rng, candidates.length)]!
    fitted[pick.rack][pick.at] = pick.id
  }
  return fitted
}

/**
 * 首轮判定舰体；失败后新规则普通模块只筛一次，后续轮次依位序交付已保全件。
 * 正常插件整批换黑匣，无人机保留原来的逐型独立判定；旧残骸逐轮尝试不变。
 */
export function trySalvagePlayerWreckOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): PlayerWreckSalvage {
  const map = state.shipWrecks
  let rec = shipWreckFor(state, galaxyId)
  if (!map || !rec) return { kind: 'none' }

  // ① 舰体每具只判定一次；无效船型不产生舰体奖励。
  if (rec.hullRolled !== true) {
    const canRecover = rec.recoveryRules !== 2 || !!rec.defId && ctx.ships.has(rec.defId)
    const chance = canRecover ? hullRecoveryChanceOf(rec, state) : 0
    if (chance <= 0) {
      // 没有插件接口 ⇒ 标记已掷（免得日后插件上线时，老残骸补掷一次）
      rec = { ...rec, hullRolled: true }
      map[rec.shipId] = rec
    } else if (nextRandom(state.rng) < chance) {
      delete map[rec.shipId]
      markWreckRecovered(state, rec.shipId) // 整船捞回 ⇒ 沉船记录标「已回收」
      const fitted = rec.recoveryRules === 2 ? rollWreckEquipment(state, rec, ctx, true) : undefined
      const droneLoad = rec.recoveryRules === 2 ? Object.fromEntries(Object.entries(rec.droneLoad ?? {})
        .filter(([id, n]) => ctx.items.has(id) && n > 0 && nextRandom(state.rng) < WRECK_RECOVERY_RATE.drone)) : undefined
      const count = (fit: FittedModules | undefined): number => fit ? [...fit.high, ...fit.mid, ...fit.low].filter(Boolean).length : 0
      const damagePlugs = rec.recoveryRules === 2 ? rollShipDamage(state, rec.damagePlugs) : cleanShipDamage(rec.damagePlugs)
      return {
        kind: 'ship',
        wreckName: rec.name,
        ...(rec.defId !== undefined ? { defId: rec.defId } : {}),
        ...(rec.durability !== undefined ? { durability: rec.durability } : {}),
        ...(rec.armorPct !== undefined ? { armorPct: rec.armorPct } : {}),
        ...(rec.customName !== undefined ? { customName: rec.customName } : {}),
        ...(rec.recoveryRules === 2 ? { recoveryRules: 2 as const, fitted, droneLoad,
          keptModules: count(fitted), lostModules: count(rec.fitted) - count(fitted) } : {}),
        ...(damagePlugs?.length ? { damagePlugs } : {}),
        // 整船捞回来了 ⇒ **插件跟着船回去**（不换黑匣；船已经不在残骸里了）
        ...((rec.plugs?.length ?? 0) > 0 ? { plugs: [...(rec.plugs ?? [])] } : {}),
      }
    } else {
      rec = { ...rec, hullRolled: true }
      map[rec.shipId] = rec
    }
  }

  // ② 逐行掷骰
  if (rec.recoveryRules === 2 && rec.equipmentRolled !== true) {
    rec = { ...rec, fitted: rollWreckEquipment(state, rec, ctx, false), equipmentRolled: true }
    map[rec.shipId] = rec
  }
  const rows = wreckLootRowsOf(rec, ctx)
  /**
   * **②★ 插件整批换黑匣**（船长：「**玩家回收按插件数量直接回收成黑匣**」）。
   *
   * ⚠ **顺序**：排在"整船回收"**之后**——船都捞回来了，插件是跟着船走的，不该再换黑匣；
   * 排在"逐件掷骰"**之前**且**不占本轮产出**——它不掷骰、不消耗随机数，**捞到就是捞到**
   * （契合船长「**总能回收舰船插件**」）。换完即清字段 ⇒ 第二轮回落到普通的逐件掷骰。
   */
  const plugIds = rec.plugs ?? []
  if (plugIds.length > 0) {
    const blackBoxes = plugIds.filter((id) => typeof id === 'string' && id.length > 0).length
    /**
     * ⚠ **顺手把 `hullRolled` 置位**：插件都被拆成黑匣了，"这艘船还能整船捞回来"这件事就**翻篇了**
     * ——不置位的话，后面每一轮都会再掷一次整船回收（自己刷自己的概率）。
     */
    if (rows.length === 0) {
      delete map[rec.shipId]
      markWreckRecovered(state, rec.shipId) // 拆完空壳 ⇒ 标「已回收」
    } else map[rec.shipId] = { ...rec, plugs: [], hullRolled: true }
    return { kind: 'plugs', blackBoxes }
  }

  if (rows.length === 0) {
    delete map[rec.shipId] // 空壳：不该留（正常路径应在取走最后一件时删掉）
    markWreckRecovered(state, rec.shipId)
    return { kind: 'none' }
  }
  let row = rows.find((r) => (rec!.recoveryRules === 2 && r.isModule) || nextRandom(state.rng) < r.rate)
  const usedPity = row === undefined
  // ③ 保底：整具残骸一次都没给过东西 ⇒ 至少给回一件
  if (!row && rec.pityUsed !== true) row = rows[nextInt(state.rng, rows.length)]
  if (!row) return { kind: 'none' }

  // ④ 扣减与收口
  const after = removedLootFrom(rec, row)
  const left = wreckLootRowsOf(after, ctx)
  if (left.length === 0) {
    delete map[rec.shipId]
    markWreckRecovered(state, rec.shipId) // 逐件捞空 ⇒ 标「已回收」
  } else {
    map[rec.shipId] = { ...after, hullRolled: true, ...(usedPity ? { pityUsed: true } : {}) }
  }
  return { kind: 'item', itemId: row.itemId, units: row.units, isModule: row.isModule }
}
