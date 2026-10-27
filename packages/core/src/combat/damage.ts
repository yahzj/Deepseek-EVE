/** 战斗域：damage，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec, WeaponSpec } from './model'
import type { DamageType, SimContext } from '../types'
import { BATTLE_VOLLEY_WINDOW_MS } from './constants'
import { gravekeeperResistsOf, advanceFoeRebirthRepair, activateFoeCapacitor } from './gravekeeperCombat'
import { acidResistsOf } from './alienEquipment'
import { type Hp3, applyDamage } from './combatMath'
import { triggerAcidBurst } from './alienCombat'
import { type GameState, addLog } from '../state'
import { wormholeSupplyForBattle, takeWormholeSupply } from '../wormholeSupplies'
import { countWare, removeWare, removeCargoOfShip } from '../inventory'
import { pushBattleNotice } from './combatFx'

/** 冷却满延迟后至截止时刻前生效；未闪现与冷却外均关闭。引擎承伤走齐射快照。 */
export function standbyShieldActiveOf(
  unit: Pick<UnitSpec, 'foeStandbyShield' | 'foeBlink'>,
  blinkReadyAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (unit.foeStandbyShield === undefined) return false
  if (blinkReadyAtMs === undefined || nowMs >= blinkReadyAtMs) return false
  const cooldown = unit.foeBlink?.cooldownMs
  if (cooldown === undefined) return false
  const triggeredAt = blinkReadyAtMs - cooldown
  return nowMs >= triggeredAt + unit.foeStandbyShield.delayMs
}

/**
 * **把「待机护盾阵列」的抗性并进层抗**——**只并护盾层**（装甲/结构两列原样返回，船长口径）。
 * 并入方式 = **乘算**：`1 − (1 − 既有) × (1 − 新增)`（与 `applyDamage` 那把"抗性夹 −0.9~0.9"的尺同域；
 * 既有为负（易伤）时同样成立）。R 族本身不带层抗 ⇒ 实况就是护盾层 50%。
 */
export function withStandbyShield(
  resists: UnitSpec['resists'],
  resistPct: number,
): UnitSpec['resists'] {
  const merge = (t: DamageType): number => 1 - (1 - (resists.shield?.[t] ?? 0)) * (1 - resistPct)
  return {
    ...resists,
    shield: { kinetic: merge('kinetic'), explosive: merge('explosive'), plasma: merge('plasma') },
  }
}

/** 同次齐射固定抗性答案；内部子步不能拆开原100毫秒承伤窗口。 */
export function foeStandbyReadyOf(
  b: {
    startedAtGameMs?: number
    lastTickGameMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foe: Pick<UnitSpec, 'tag' | 'foeStandbyShield' | 'foeBlink'>,
): boolean {
  if (foe.foeStandbyShield === undefined) return false
  const now = b.lastTickGameMs ?? 0
  const anchor = b.startedAtGameMs ?? 0
  const windowAt = anchor + Math.floor((now - anchor) / BATTLE_VOLLEY_WINDOW_MS) * BATTLE_VOLLEY_WINDOW_MS
  const reg = b.foeStandbyTick ?? (b.foeStandbyTick = {})
  const hit = reg[foe.tag]
  if (hit !== undefined && hit.atMs === windowAt) return hit.ready
  const ready = standbyShieldActiveOf(foe, b.foeBlinks?.[foe.tag], now)
  reg[foe.tag] = { atMs: windowAt, ready }
  return ready
}

/**
 * **本拍打这一艘敌舰要用的层抗**（单点）——带「待机护盾阵列」且**本拍就绪**（见 `foeStandbyReadyOf`）时，
 * 把 50% 并进**护盾层**；否则**原样返回 `foe.resists` 那个引用**（零分配、零行为变化）。
 * 只被 `applyFoeUnitDamage`（唯一收口）与 `carryVolleyOverflow`（溢火结转的"打空它要多少"）调用。
 */
export function foeResistsNow(
  b: {
    lastTickGameMs?: number
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
    foeCoatingLayers?: import('../state').BattleState['foeCoatingLayers']
  },
  foe: {
    tag: string
    resists?: UnitSpec['resists']
    foeCoatingArmor?: UnitSpec['foeCoatingArmor']
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
  },
): UnitSpec['resists'] {
  const base = foe.foeStandbyShield !== undefined && foeStandbyReadyOf(b, foe)
    ? withStandbyShield(foe.resists ?? {}, foe.foeStandbyShield.resistPct)
    : (foe.resists ?? {})
  const coated = gravekeeperResistsOf(b, foe, base, b.lastTickGameMs ?? 0)
  return b.foeAcidLayers ? acidResistsOf(b, foe.tag, coated) : coated
}

/**
 * **每拍开头：把敌阵里挂了「待机护盾阵列」的单位的就绪态定死**（船长 2026-10-03「同一拍整次齐射都算」）。
 * 放在 `stepBattle` 最前面（任何伤害结算之前）⇒ 本拍之内无论谁开火、闪没闪，读到的都是**同一份答案**。
 * 只扫"带该件"的单位（R 族那几档才有）⇒ 其余场次一次判断都不多做。
 */
export function snapshotFoeStandby(b: import('../state').BattleState, foes: readonly UnitSpec[]): void {
  for (const f of foes) foeStandbyReadyOf(b, f)
}

/**
 * **打敌舰本体的唯一收口**（**2026-09-27 船长令**：「**不能使用触发制吗？因为肯定已经有一个用于判断舰船
 * 是否死亡的点了，假设给死亡加个触发挂载点，这样之后有什么死亡效果也能添加。**」）。
 *
 * 原先玩家打敌舰的四条伤害结算（主段 / 附加段 / 全体攻击两段）＋ 齐射协调仪的溢火链**各自**
 * `applyDamage(...)` 再各自写回三层血，**没有"死亡那一刻"**——全仓的生死判据是 `isAlive` 这个纯读取，
 * 每次要用就把三层血重算一遍（无人机的"击落"反倒是有事件点的：`pool.alive = false`）。
 *
 * 本函数把四＋一处收成一个口子，只做两件事、**不改算术**：
 * 1. 照旧 `applyDamage` 并写回三层血（层抗、层克制、随机数消费顺序一字不动）；
 * 2. **算完做观测**——这一发把它的三层血打空 ⇒ 在该单位上落 `downAtMs`（死亡时刻）；
 *    若它正是本场 BOSS（`foeOverride.bossShipId`）⇒ 顺带在本场落 `BattleState.bossDownAtMs`。
 *
 * ⚠ `dealt` 仍由调用方记账（`stats.meDmg` / 飘字读数）——本函数只负责"血写回 ＋ 死亡观测"。
 * ⚠ 尸体再挨打 ⇒ `killedNow = false`（死亡时刻只记第一次）。
 *
 * @returns `dealt` = 本发实收；`killedNow` = **这一发刚刚把它打沉**（此前还活着）
 */
export function applyFoeUnitDamage(
  b: {
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('../state').BattleState['acidBursts']
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    units: Record<string, { hp: Hp3; hpMax?: Hp3; foeShipId?: string; downAtMs?: number }>
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    bossDownAtMs?: number
    /** **闪现冷却表**（敌方「瞬光跃迁仪」那一本）——「待机护盾阵列」按它判"闪现是否在冷却中" */
    foeBlinks?: Record<string, number>
    /** **「待机护盾阵列」的本拍就绪快照**（船长 2026-10-03「同一拍整次齐射都算」） */
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
    foeCoatingLayers?: import('../state').BattleState['foeCoatingLayers']
    foeRebirths?: import('../state').BattleState['foeRebirths']
    foeShieldCapacitorActive?: import('../state').BattleState['foeShieldCapacitorActive']
  },
  /** 目标单位（认 tag；`resists` 取它自己的层抗，「待机护盾阵列」也取它自己的那份） */
  foe: {
    tag: string
    hp?: Hp3
    acidBurst?: UnitSpec['acidBurst']
    resists?: UnitSpec['resists']
    /** **待机护盾阵列参数**（带该件的单位才有；判据见 `standbyShieldActiveOf`） */
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
    foeRebirthProtocol?: UnitSpec['foeRebirthProtocol']
    foeCoatingArmor?: UnitSpec['foeCoatingArmor']
    foeShieldCapacitor?: UnitSpec['foeShieldCapacitor']
  },
  dmg: number,
  type: DamageType,
  /** 这一发的时刻（缺省 = 本拍起点）；诊断用，不参与结算 */
  atMsOverride?: number,
): { dealt: number; killedNow: boolean; resistsUsed?: UnitSpec['resists'] } {
  const rt = b.units[foe.tag]
  if (!rt || rt.hp.s + rt.hp.a + rt.hp.h <= 0) return { dealt: 0, killedNow: false }
  const atMs = b.lastTickGameMs ?? atMsOverride ?? 0
  if (foe.foeRebirthProtocol && foe.hp) advanceFoeRebirthRepair(b, { ...foe, hp: foe.hp }, atMs)
  const wasAlive = rt.hp.s + rt.hp.a + rt.hp.h > 0
  const beforeHp = { ...rt.hp }
  /**
   * 待机护盾阵列只在本次冷却满延迟后至结束前保护护盾层。
   * ⚠ 放在**唯一收口**里 ⇒ 主段 / 附加段 / 全体攻击 / 齐射溢火**四条伤害路径同源**吃到它。
   * 没带该件的单位 ⇒ `foeResistsNow` 直接返回原引用 ⇒ **既有各族逐字不变**。
   */
  const resists = foeResistsNow(b, foe)
  const apply = (raw: number): Hp3 => applyDamage(rt.hp, resists, raw, type).hp
  const state = b.foeRebirths?.[foe.tag]
  const inRebirthLock = state?.lockUntilMs !== undefined && state.lockUntilMs > atMs
  const lethal = foe.foeRebirthProtocol !== undefined && dmg > 0 && apply(dmg).h <= 0
  let appliedDmg = dmg
  if (foe.foeRebirthProtocol !== undefined && inRebirthLock) {
    appliedDmg = clampRawLeavingHull(apply, dmg)
  } else if (foe.foeRebirthProtocol !== undefined && lethal && state === undefined) {
    const protocol = foe.foeRebirthProtocol
    const rebirths = b.foeRebirths ?? (b.foeRebirths = {})
    rebirths[foe.tag] = {
      lockUntilMs: atMs + DC_LOCK_MS,
      startedAtMs: atMs,
      repairUntilMs: atMs + protocol.repairMs,
      lastRepairAtMs: atMs,
      armorHealed: 0,
      hullHealed: 0,
    }
    appliedDmg = clampRawLeavingHull(apply, dmg)
  }
  const r = applyDamage(rt.hp, resists, appliedDmg, type)
  rt.hp = r.hp
  if (foe.foeShieldCapacitor !== undefined && beforeHp.s > 0 && rt.hp.s <= 0) {
    activateFoeCapacitor(b, foe.tag)
  }
  if (foe.foeCoatingArmor !== undefined && beforeHp.a > r.hp.a) {
    const layers = b.foeCoatingLayers ?? (b.foeCoatingLayers = {})
    const active = (layers[foe.tag] ?? []).filter((x) => x.untilMs > atMs)
    active.push({ untilMs: atMs + foe.foeCoatingArmor.durationMs })
    layers[foe.tag] = active
  }
  let killedNow = false
  if (rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
    const downAtMs = atMsOverride ?? atMs
    if (rt.downAtMs === undefined) rt.downAtMs = downAtMs
    killedNow = wasAlive
    if (killedNow) triggerAcidBurst(b, foe, 'killed', downAtMs)
    const bossId = b.foeOverride?.bossShipId
    if (killedNow && bossId !== undefined && rt.foeShipId === bossId) {
      b.bossDownAtMs ??= downAtMs
    }
  }
  return { dealt: r.dealt, killedNow, resistsUsed: resists }
}

/**
 * **打空这一艘所需的最小原始伤害**（F3c B2 · 谜质「齐射协调仪」的溢火结转要用）。
 *
 * 为什么不用"实收伤害"算溢出：`applyDamage` 的消费是**逐层乘系数**的（层克制 × (1−该层该系抗性)），
 * 一发超出部分的"实收"与"原始"不是一个量纲；要把多余火力转给**另一艘**（它有自己的层克制与抗性），
 * 必须把溢出量换回**原始伤害**再走一遍正常结算。
 *
 * 做法 = 对单调函数 `applyDamage(...).dealt` 做二分（`dealt` 随 dmg 单调不减）：
 * 找最小 X 使三层被打空。上限取 `总血 × 12`（抗性最多削 90% ⇒ 需求最多 ×10，留余量）。
 */
export function rawDamageToKill(hp: Hp3, resists: UnitSpec['resists'], type: DamageType): number {
  const total = hp.s + hp.a + hp.h
  if (total <= 0) return 0
  let lo = 0
  let hi = total * 12 + 8
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (applyDamage(hp, resists, mid, type).dealt >= total - 1e-9) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
 * 「**齐射协调仪改为溢出火力会转移到其他敌舰**」）。
 *
 * 口径：目标被打死后，把 `原始伤害 − 打空它所需的原始伤害` 这一截转给**下一艘存活敌舰**，
 * 并按那一艘**自己的层克制**重算（`applyDamage` 原样走一遍）；若把第二艘也打空就继续往下转
 * （`maxChain` 封顶，防一条链子无限转）。**只在本场带了该装置时调用**（`battle.wormhole.volleyOverflow`）。
 *
 * 参数刻意收成结构化小对象（`units` + `stats`）⇒ 用例可以拿一份手搓状态直接验这条机制。
 */
export function carryVolleyOverflow(
  b: {
    foeAcidLayers?: import('../state').BattleState['foeAcidLayers']
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('../state').BattleState['acidBursts']
    units: Record<string, { hp: Hp3; foeShipId?: string; downAtMs?: number }>
    stats: { meDmg: number }
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    /** **闪现冷却表**（供「待机护盾阵列」判据用；缺省 ⇒ 一律算"可用"） */
    foeBlinks?: Record<string, number>
    /** **「待机护盾阵列」的本拍就绪快照**（船长 2026-10-03「同一拍整次齐射都算」；缺省 ⇒ 现算补一份） */
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foes: readonly UnitSpec[],
  killedTag: string,
  type: DamageType,
  rawDamage: number,
  hpBefore: Hp3,
  maxChain = 3,
  resistsBefore?: UnitSpec['resists'],
): { total: number; hits: number; lastTag: string | null } {
  let raw = rawDamage
  let prevHp = hpBefore
  let prevTag = killedTag
  let total = 0
  let hits = 0
  let lastTag: string | null = null
  let previousResists = resistsBefore
  for (let n = 0; n < maxChain; n++) {
    // ⚠ 2026-09-15 修：转移伤害与"打空它需要多少"都要按**目标自己的层抗**算（此前传 `{}` ⇒ 敌抗性不生效）
    // 🔴 2026-10-02：层抗改走 `foeResistsNow` ⇒ **「待机护盾阵列」也吃进"打空它要多少"这把尺**（口径同源）
    const prevFoe = foes.find((f) => f.tag === prevTag)
    const prevRes = previousResists ?? (prevFoe ? foeResistsNow(b, prevFoe) : {})
    const excess = raw - rawDamageToKill(prevHp, prevRes, type)
    if (excess <= 0.5) break
    const next = foes.find((f) => {
      if (f.tag === prevTag) return false
      const rt = b.units[f.tag]
      return !!rt && rt.hp.s + rt.hp.a + rt.hp.h > 0
    })
    if (!next) break
    const rt = b.units[next.tag]!
    const before = { ...rt.hp }
    /** 走**敌舰伤害唯一收口**（血写回 ＋ 死亡观测；算术与随机数消费一字不变） */
    const r = applyFoeUnitDamage(b, next, excess, type)
    previousResists = r.resistsUsed
    b.stats.meDmg += r.dealt
    total += r.dealt
    hits += 1
    lastTag = next.tag
    raw = excess
    prevHp = before
    prevTag = next.tag
    if (rt.hp.s + rt.hp.a + rt.hp.h > 0) break
  }
  return { total, hits, lastTag }
}

/**
 * **我方"不被一击带走"保险**（船长 2026-09-16：「**血量 100%，单次齐射伤害最多只能造成总血量 80% 的伤害
 * （只对我方生效）**」）。
 *
 * 2026-10-16船长裁定：**同一窗口内同一艘我方舰的实际掉血合计 ≤ 满血三层总量×本比例**。
 * —— `battle.meVolleyDmg[tag]`按独立100ms窗口归组，不随内部子步缩小。
 * - **只削我方承伤**：敌方酸液爆发、机群、光束与实弹统一走`applyPlayerUnitDamage`，
 *   我方打敌人**一字不动**；
 * - **洞内洞外都生效**：挂在共用的 `stepBattle` 上 ⇒ 悬赏 / 低安遭遇 / AI 副船 / 虫洞一律吃保险；
 * - 额度在层位克制、抗性、混伤及额外破盾之后计算；损管保护后的真实掉血才入账。
 * - "一次齐射"按原100ms归组窗口计，窗口标记为 `meVolleyWindow`。
 */
export const PLAYER_VOLLEY_DMG_CAP_SHARE = 0.8

export function playerVolleyDamageRoomOf(b: import('../state').BattleState, tag: string, spec: UnitSpec): number {
  const max = b.units[tag]?.hpMax ?? spec.hp
  const full = max.s + max.a + max.h
  return full > 0 ? Math.max(0, full * PLAYER_VOLLEY_DMG_CAP_SHARE - (b.meVolleyDmg?.[tag] ?? 0)) : Infinity
}

/** 输入已结算的实际掉血，按窗口剩余额度记账，不再接收原始伤害。 */
export function cappedFoeDamage(
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  dmg: number,
): number {
  if (dmg <= 0) return dmg
  const used = b.meVolleyDmg?.[tag] ?? 0
  const out = Math.min(dmg, playerVolleyDamageRoomOf(b, tag, spec))
  // ⚠ **必须无条件记账**（哪怕这一发全额放行）：额度是"本拍累计"口径，漏记就等于给下一发多开口子
  b.meVolleyDmg = { ...(b.meVolleyDmg ?? {}), [tag]: used + out }
  return out
}

/** 敌方对玩家的唯一入伤口：先结算分层实伤，再限额和损管，最后只记真实掉血。 */
export function applyPlayerUnitDamage(
  state: GameState,
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  raw: number,
  type: DamageType,
  applyRaw?: (r: number) => Hp3,
): number {
  const rt = b.units[tag]
  if (!rt || raw <= 0) return 0
  const before = rt.hp
  const after = applyRaw ? applyRaw(raw) : applyDamage(before, spec.resists, raw, type).hp
  const loss = { s: Math.max(0, before.s - after.s), a: Math.max(0, before.a - after.a), h: Math.max(0, before.h - after.h) }
  const total = loss.s + loss.a + loss.h
  const amount = Math.min(total, playerVolleyDamageRoomOf(b, tag, spec))
  // 在已结算的掉血上按层截取，不重新计算原伤落点，避免限额反过来改变克制系数。
  const apply = (damage: number): Hp3 => {
    const hp = { ...before, ...(before.coating ? { coating: { ...before.coating } } : {}) }
    for (const key of ['s', 'a', 'h'] as const) {
      const take = Math.min(loss[key], damage)
      hp[key] -= take
      damage -= take
    }
    if (hp.coating) hp.coating.armor = Math.min(hp.coating.armor, hp.a)
    return hp
  }
  const guarded = applyDcGuard(state, b, tag, spec, before, amount, type, apply)
  rt.hp = guarded === total ? after : apply(guarded)
  return cappedFoeDamage(b, tag, spec, (before.s - rt.hp.s) + (before.a - rt.hp.a) + (before.h - rt.hp.h))
}

/** **结构锁定窗口**（1 秒；船长改判「1 秒内结构锁定 1」）——`BattleState.dc[tag].lockUntilMs` 的时长 */
export const DC_LOCK_MS = 1_000

/**
 * **损伤管制装置 · 免死判定**（船长口径：**1 秒内结构锁定 1** · **每场一次** · **启动消耗 1 枚损管修理组件**）。
 *
 * 实战由`applyPlayerUnitDamage`先限制实际承伤，再调用本函数判定保底；最终掉血才计入齐射账本。
 * - **窗口内**（`lockUntilMs > 本拍时刻`）：把本发原始伤害夹到"结算后结构 ≥ 1"⇒ **同拍/同秒多段都破不了**；
 * - **窗口外且未用过**：若本发会导致结构 ≤ 0 ⇒ ①扣 1 枚组件（没组件 ⇒ 不启动，仅记一条日志）
 *   ②开窗 1 秒 ③本场标记已用 ④把本发夹到结构 = 1 ⑤日志 ＋ 战斗提示；
 * - **已用过且出窗** ⇒ 原样放行（照常被打死 —— 丁案的既定后果）。
 *
 * `applyRaw` = 调用方自己的施加函数（单系 `applyDamage` / 混伤 `applyFoeShot`）；
 * 缺省按单系 `applyDamage(hp, spec.resists, raw, type)` 估。二分反解（`applyDamage` 对伤害单调）。
 */
export function applyDcGuard(
  state: GameState,
  b: import('../state').BattleState,
  tag: string,
  spec: UnitSpec,
  hpNow: Hp3,
  raw: number,
  type: DamageType | undefined,
  /** 调用方真正的施加函数（混伤路径传它自己的；缺省 = 单系 applyDamage） */
  applyRaw?: (r: number) => Hp3,
): number {
  if (raw <= 0 || spec.hullSaveKit === undefined) return raw
  const apply = (r: number): Hp3 => (applyRaw ? applyRaw(r) : applyDamage(hpNow, spec.resists, r, type ?? 'kinetic').hp)
  const st = b.dc?.[tag]
  const inWindow = st?.lockUntilMs !== undefined && st.lockUntilMs > b.lastTickGameMs
  const lethal = apply(raw).h <= 0
  if (inWindow) {
    // 窗口内：结构不许掉到 1 以下（本发可能直接致死 ⇒ 夹住）
    return lethal || apply(raw).h < 1 ? clampRawLeavingHull(apply, raw) : raw
  }
  if (!lethal) return raw
  if (st?.used === true) return raw
  /** 启动：扣 1 枚损管修理组件（仓库优先/关掉开关则走本舰货仓，与修理组件同一口径） */
  const kitId = spec.hullSaveKit
  const shipId = spec.shipId ?? state.shipId
  const supply = wormholeSupplyForBattle(state, b)
  const took = supply ? takeWormholeSupply(supply, kitId, 1) === 1 : state.resupplyFromWarehouse !== false
    ? countWare(state, kitId) > 0 && (removeWare(state, kitId, 1), true)
    : removeCargoOfShip(state, shipId, kitId, 1) > 0
  if (!took) {
    addLog(state, 'warn', '损伤管制装置未能启动：损管修理组件不足。', 'core.combat.003')
    return raw
  }
  b.dcKitsUsed = Math.max(0, Math.floor(b.dcKitsUsed ?? 0)) + 1
  b.dc = { ...(b.dc ?? {}), [tag]: { lockUntilMs: b.lastTickGameMs + DC_LOCK_MS, used: true } }
  if (spec.rebirthRepair) {
    const book = b.meRebirths ??= {}
    book[tag] = { repairUntilMs: b.lastTickGameMs + spec.rebirthRepair.repairMs,
      lastRepairAtMs: b.lastTickGameMs, armorHealed: 0, hullHealed: 0 }
  }
  addLog(state, 'combat', '✦ 损伤管制装置启动：结构锁定在 1 点、持续 1 秒（消耗损管修理组件 ×1）。', 'core.combat.002')
  pushBattleNotice(b, '损伤管制装置启动：结构锁定 1')
  return clampRawLeavingHull(apply, raw)
}

/**
 * **把原始伤害夹到"结算后结构 ≥ 1"的最大值**（二分；`apply` 对伤害单调不减）。
 * 结构本来就 < 1（异常/已锁死）⇒ 返回 0（不再放行任何伤害）。
 */
export function clampRawLeavingHull(apply: (r: number) => Hp3, raw: number): number {
  if (apply(0).h < 1) return 0
  if (apply(raw).h >= 1) return raw
  let lo = 0
  let hi = raw
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (apply(mid).h >= 1) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * **战后总结里的"损伤管制装置"一行**（2026-09-25 船长令：战报单列一条）。
 * 本场一次没启动 = `''`（战报不添尾巴），否则形如 `损伤管制装置启动 ×1（消耗损管修理组件 ×1）`。
 * 与 `repairUsageText` 同哲学：四处战报（远征胜/败、遭遇、AI 副船）共用。
 */
export function dcUsageText(
  battle: { dcKitsUsed?: number } | null | undefined,
  ctx: SimContext,
): string {
  const n = Math.max(0, Math.floor(battle?.dcKitsUsed ?? 0))
  if (n <= 0) return ''
  const kitName = ctx.items.get('repairkit-dc')?.name ?? '损管修理组件'
  return `损伤管制装置启动 ×${n.toLocaleString('zh-CN')}（消耗${kitName} ×${n.toLocaleString('zh-CN')}）`
}

/**
 * 结算敌人一发（2026-09-10 船长：窝点混伤）：
 * 武器带 `shotsByType`（混伤，主 60% / 副 40%）→ 按构成**逐系**调用 `applyDamage`
 * （各系吃各自的 `typeLayerMult` 与层抗，逐系依次消费 盾→甲→结构）；
 * 纯系武器（无 `shotsByType`）→ 与旧行为一字不差。
 * `totalDmg` 是本次开火的总伤害（含近盲/距离折扣），按构成比例分摊、**总量不变**。
 * 返回更新后的三层血量（调用方直接赋值）。导出供回归测试直接验证"混伤绕过单系抗"。
 */
export function applyFoeShot(
  hp: Hp3,
  resists: UnitSpec['resists'],
  weapon: WeaponSpec,
  totalDmg: number,
  mainType: DamageType,
): Hp3 {  const shots = weapon.shotsByType
  const entries = shots ? Object.entries(shots).filter(([, v]) => (v ?? 0) > 0) : []
  if (entries.length <= 1) return applyDamage(hp, resists, totalDmg, mainType).hp
  const sum = entries.reduce((s, [, v]) => s + (v ?? 0), 0)
  if (sum <= 0) return applyDamage(hp, resists, totalDmg, mainType).hp
  // 主系在前（与构成降序一致：shotsByType 由 splitShotByComposition 生成 → 主系份额最大）
  let next = hp
  let left = totalDmg
  entries.forEach(([t, v], i) => {
    // 多炮拆小单发后不逐系取整，避免低伤炮把原混伤比例改成一半一半。
    const share = (totalDmg * (v ?? 0)) / sum
    const dmg = i === entries.length - 1 ? left : (weapon.gunCount ?? 1) > 1 ? share : Math.max(1, Math.round(share))
    const take = Math.max(0, Math.min(left, dmg))
    if (take <= 0) return
    next = applyDamage(next, resists, take, t as DamageType).hp
    left -= take
  })
  return next
}
