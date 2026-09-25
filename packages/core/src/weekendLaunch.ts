/**
 * **周末入侵 · 开战入口**（2026-09-23 船长令「继续补」）：把 core 的入侵规格接到**真实战斗**上。
 *
 * 为什么单独一层：`combat.ts` 不 import 入侵模块，而这里要同时用「战斗入口」与「入侵规格」⇒
 * 单独一个薄模块避免 `combat ←→ weekendBattle` 的相互导入。
 *
 * 口径：**旗舰 = 120 威胁 · 4 波 · 4 艘小队战**（口径定稿 #8）——4 波通过 `FoeOverride.waves`
 * 覆写成 `[{units:4, hpShare:0.25}] × 4`（整场总血不变，分 4 批入场）；我方编队取「主控 + 其余自有舰」，上限 4 艘。
 */
import type { GameState } from './state'
import type { AnomalyDef, SimContext } from './types'
import { startFleetBattleFor } from './combat'
import { weekendFlagshipEncounterOf, weekendFlagshipSpecOf } from './weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_FLAGSHIP_SHIP_ID,
  weekendBossPoolView,
  weekendFlagshipHpRemaining,
  weekendFlagshipView,
} from './weekendEvent'
import type { WeekendBossPoolView } from './weekendEvent'
import type { FoeOverride } from './combat'
import { shipDisplayName } from './instances'
import { calcPower } from './expedition'

/** 参战舰船**上限**（旗舰战 = 4 艘小队战；语义是上限、不是"必须带满"——与虫洞 `WORMHOLE_MAX_SHIPS` 同款口径） */
export const WEEKEND_FLAGSHIP_MAX_SHIPS = 4
/** 装甲 / 结构"偏低"的告警线（与既有文案「出征前把装甲与结构补到六成」同口径） */
export const WEEKEND_PREP_LOW_HULL_FRAC = 0.6

/** 战前准备里的"缺口"标记（只说事实、不拦人） */
export type WeekendPrepIssue = 'no-weapon' | 'no-ammo' | 'low-armor' | 'low-hull'

/** 准备界面里的一条候选舰船 */
export interface WeekendPrepCandidate {
  /** 舰队实例 uid（`state.fleet` 的键） */
  shipId: string
  /** 船型 id */
  defId: string
  name: string
  /** 骨架战力（技能 ＋ 船体；与站内既有展示同口径，**不是胜率**） */
  power: number
  armorPct: number
  hullPct: number
  issues: WeekendPrepIssue[]
}

/** 战前准备视图（界面只读它渲染；判定与读数都在 core） */
export interface WeekendFlagshipPrepView {
  /** 敌方卡 id（界面按它取**本地化**的编成与舰名：`ctx.anomalies.get(cardId).ships`） */
  cardId: string
  threat: number
  waves: number
  /** 母舰血池读数（**共享血条**：`hpLeft / hpMax` ＋ 各自份额，见 `WeekendBossPoolView`） */
  pool: WeekendBossPoolView
  /**
   * 击毁时限（缺省 = 还没起算）——**只作 core 侧读数**：2026-09-25 船长令「章鱼人 = 真实削减血量
   * 所以并不需要显示章鱼人削减进度和倒计时」⇒ **界面不再显示这一格**（血条本身就是那个读数）。
   */
  deadlineWallMs?: number
  maxShips: number
  /** 可选舰船（**只有舰队在编的船**；主控船也在其中、不特殊） */
  candidates: WeekendPrepCandidate[]
  /** 默认勾选：落盘的编队优先（已不在编的自动剔掉）；没有落盘 ⇒ 现有自动编队口径 */
  defaultSquad: string[]
}

/** 有武装的槽位（判断"未装武器"用） */
const WEAPON_SLOTS: ReadonlySet<string> = new Set(['turret', 'missile', 'laser', 'drone-rack', 'drone-tac'])

/**
 * **一艘船的"缺口"**（准备界面照它出警告条；口径都是**既有的、看得见的事实**）：
 * - `no-weapon`：高/中/低槽里**没有一件武器类模块**（炮台/导弹/激光/无人机舱）；
 * - `no-ammo`：**有武器**但**货舱与仓库里一件弹药都没有**（粗判：只可能少报，不会误报"有弹"）；
 * - `low-armor` / `low-hull`：当前装甲 / 结构低于 `WEEKEND_PREP_LOW_HULL_FRAC`（六成）。
 */
export function weekendPrepIssuesOf(state: GameState, ctx: SimContext, shipId: string): WeekendPrepIssue[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: WeekendPrepIssue[] = []
  const armed = [...ship.fitted.high, ...ship.fitted.mid, ...ship.fitted.low].some((id) => {
    if (id === null) return false
    const slot = ctx.modules.get(id)?.slot
    return slot !== undefined && WEAPON_SLOTS.has(slot)
  })
  if (!armed) out.push('no-weapon')
  else {
    const hasAmmo =
      Object.keys(ship.cargo).some((id) => id.startsWith('ammo-')) ||
      Object.keys(state.warehouse.items).some((id) => id.startsWith('ammo-'))
    if (!hasAmmo) out.push('no-ammo')
  }
  if ((ship.armorPct ?? 1) < WEEKEND_PREP_LOW_HULL_FRAC) out.push('low-armor')
  if (ship.durability < WEEKEND_PREP_LOW_HULL_FRAC) out.push('low-hull')
  return out
}

/**
 * **战前准备视图**（界面渲染用；`null` = 现在不该出现这个入口）。
 *
 * 出现条件 = **旗舰已现身且未落定局**（`weekendFlagshipView().shown && down === undefined`）⇒ 与活动框里
 * 那行「旗舰现身」同一判据；候选 = **舰队在编的全部船**（含主控），默认勾选 = 落盘编队或现有自动编队。
 */
export function weekendFlagshipPrepView(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): WeekendFlagshipPrepView | null {
  const ev = state.weekendEvent
  if (!ev) return null
  const view = weekendFlagshipView(state, ev, nowWallMs, nowWallMs)
  if (!view.shown || view.down !== undefined) return null
  const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
  if (!spec) return null
  /**
   * 血池读数：**还没跟母舰交手过**（`flagshipHpMax` 未锁定）时 `weekendBossPoolView` 返回 `null`
   * ——准备界面是"第一次开打之前"就要看的东西 ⇒ 这里按**池子常量**兜一个满池读数
   * （活动框那边仍按老口径"接战后才显示池子行"，两处语义各自成立）。
   */
  const pool: WeekendBossPoolView = weekendBossPoolView(state, ev) ?? {
    hpMax: WEEKEND_FLAGSHIP_POOL_HP,
    hpDone: 0,
    hpLeft: WEEKEND_FLAGSHIP_POOL_HP,
    octopusDone: 0,
    playerFrac: 0,
    octopusFrac: 0,
    needDmg: WEEKEND_FLAGSHIP_POOL_HP,
  }
  const candidates: WeekendPrepCandidate[] = []
  for (const shipId of Object.keys(state.fleet)) {
    const defId = state.fleet[shipId]?.defId ?? shipId
    const ship = state.fleet[shipId]!
    candidates.push({
      shipId,
      defId,
      name: shipDisplayName(state, ctx, shipId),
      power: calcPower(state, ctx, shipId),
      armorPct: ship.armorPct ?? 1,
      hullPct: ship.durability,
      issues: weekendPrepIssuesOf(state, ctx, shipId),
    })
  }
  return {
    cardId: spec.cardId,
    threat: spec.threat,
    waves: spec.waves,
    pool,
    ...(view.deadlineWallMs !== undefined ? { deadlineWallMs: view.deadlineWallMs } : {}),
    maxShips: WEEKEND_FLAGSHIP_MAX_SHIPS,
    candidates,
    defaultSquad: weekendPrepSquadOf(state),
  }
}

/**
 * **落盘编队**（可选字段 `state.weekendPrepSquad`，零迁移）：命中"仍在编"的才要，
 * 一个都不剩 ⇒ 回落到现有自动编队。**开战前与准备界面都调它**，界面显示什么、开战就用什么。
 */
export function weekendPrepSquadOf(state: GameState): string[] {
  const saved = (state.weekendPrepSquad ?? []).filter((id) => state.fleet[id] !== undefined)
  return saved.length > 0 ? saved.slice(0, WEEKEND_FLAGSHIP_MAX_SHIPS) : weekendFlagshipSquadOf(state)
}

/** 记住玩家选的编队（只留在编的船、去重、截到上限；空编队 = 不写） */
export function weekendNoteFlagshipSquad(state: GameState, squad: readonly string[]): void {
  const clean = weekendSanitizeFlagshipSquad(state, squad)
  if (clean.length === 0) return
  state.weekendPrepSquad = clean
}

/**
 * **编队净化**（纯函数 · 开战与落盘共用）：只认**舰队在编**的船、去重、截到上限。
 * 不在编的 id 一律丢掉（旧档残 id / 玩家手改存档都不至于把战斗打崩）。
 */
export function weekendSanitizeFlagshipSquad(state: GameState, squad: readonly string[]): string[] {
  const out: string[] = []
  for (const id of squad) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (state.fleet[id] === undefined) continue
    if (out.includes(id)) continue
    out.push(id)
    if (out.length >= WEEKEND_FLAGSHIP_MAX_SHIPS) break
  }
  return out
}

/** **按战力自动选**（准备界面那颗按钮）：候选里战力最高的至多 4 艘（并列按舰队顺序，稳定） */
export function weekendBestFlagshipSquad(state: GameState, ctx: SimContext): string[] {
  return Object.keys(state.fleet)
    .map((shipId) => ({ shipId, power: calcPower(state, ctx, shipId) }))
    .sort((a, b) => b.power - a.power)
    .slice(0, WEEKEND_FLAGSHIP_MAX_SHIPS)
    .map((c) => c.shipId)
}

/** 旗舰的 4 波（每波 4 艘、各占 1/4 总血） */
export function weekendFlagshipWavesOf(): ReadonlyArray<{ units: number; hpShare: number }> {
  return Array.from({ length: 4 }, () => ({ units: 4, hpShare: 0.25 }))
}

/** 我方编队：主控置首 + 其余自有舰，最多 4 艘（与"4 艘小队战"口径一致） */
export function weekendFlagshipSquadOf(state: GameState): string[] {
  const ids: string[] = []
  for (const id of [state.shipId, ...Object.keys(state.fleet)]) {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  return ids.slice(0, 4)
}

/**
 * **挑战旗舰**（准备界面的「开战」调它）：核心条满才成立；返回 battle 表示开打成功
 * （`null` = 条件不满足/无法开战）。
 *
 * `squad`（2026-09-25 加）：**玩家在战前准备界面选的编队** —— 会过 `weekendSanitizeFlagshipSquad`
 * 净化（只认在编船只 · 去重 · 截 4 艘）并**落盘**（下次进来默认还是这几艘）；
 * 缺省 / 净化后为空 ⇒ 回落 `weekendPrepSquadOf`（落盘编队或自动编队）⇒ 老调用方逐字不变。
 *
 * ⚠ 只负责"开战"——结果结算走 `weekendApplyBattleOutcome`（引擎在战斗收尾时调）。
 */
export function weekendStartFlagshipBattle(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  squad?: readonly string[],
): ReturnType<typeof startFleetBattleFor> {
  const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
  if (!spec) return null
  const clean = squad !== undefined ? weekendSanitizeFlagshipSquad(state, squad) : []
  if (clean.length > 0) weekendNoteFlagshipSquad(state, clean)
  const use = clean.length > 0 ? clean : weekendPrepSquadOf(state)
  if (use.length === 0) return null
  /**
   * **母舰血条 = 池子剩余**（船长 2026-09-25 选「甲」）：开战这一刻把 `weekendFlagshipHpRemaining(ev)`
   * 传进覆写口 ⇒ 战斗里母舰的满血就是池子剩余（单场不死名副其实；打空即击沉）。
   * 覆写随档存进 `BattleState.foeOverride` ⇒ 逐拍重建母舰、读档续战都吃同一份。
   *
   * ⚠ **另带 `bossHpMax` = 池子总量**（船长同日第二条：「**母舰哪怕残血，在战斗中血上限依旧保持不变**」）：
   * 血条分母恒定用池子总量 ⇒ 残血就显示残血（否则最后一仗开打时血条又是满的）。
   * 它**只喂界面**（`battleArcsFor` 的 `maxHp.foe`），台账仍按本场满值算。
   */
  const bossHp = weekendFlagshipHpRemaining(state.weekendEvent)
  const override: FoeOverride = {
    threat: spec.threat,
    waves: weekendFlagshipWavesOf(),
    bossHp,
    bossHpMax: state.weekendEvent?.flagshipHpMax ?? WEEKEND_FLAGSHIP_POOL_HP,
    bossShipId: WEEKEND_FLAGSHIP_SHIP_ID,
  }
  return startFleetBattleFor(state, ctx, use, spec.cardId, state.gameMs, undefined, undefined, override)
}

/* ═══════════════ 旗舰战的"战斗宿主"解析（界面侧） ═══════════════
 *
 * **船长 2026-09-25 报障：「旗舰战无法进入战斗画面」**。
 *
 * 病根（架构层）：旗舰战是**编队战**（`startFleetBattleFor`，与虫洞同款），但它**承载在遭遇槽**
 * （`state.encounter.battle`，见引擎 `challengeWeekendFlagship`）——而界面那几处"在不在打"的判据
 * 一直只认**远征**（`expedition.battle`）与**虫洞**（`wormhole.run.battle`）两个宿主 ⇒
 * 旗舰战一开打，`inBattle` 为假：战斗屏不挂载、不自动上屏、心跳也不切到 100ms 战场节奏，
 * 玩家只看到遭遇横幅上的"交火中"，没有战场可看（战斗本身在后台照常打完、战报照常出）。
 *
 * 这里给出**第三个宿主的唯一解析口**，与 `wormholeBattleViewOf` 同形（战斗窗口两套来源共用一套渲染）：
 * 界面一律读本函数，**不许各自猜宿主**（与 `battleFoeAnomaly` 同一条纪律，见 content-check
 * 「战斗宿主双口径契约」）。
 */

/** 旗舰战视图（形状与 `wormholeBattleViewOf` / `expeditionStatus().combat` 对齐：战斗窗口共用一套渲染） */
export interface WeekendFlagshipBattleView {
  battle: import('./state').BattleState
  anomaly: AnomalyDef
  /** 视图锚 = 编队首舰（准备界面选的主控；缺省退 `state.shipId`） */
  leaderShipId: string
  /** 战场标题 = **敌卡本地化名**（「墨潮旗舰部队」；与远征口径同源，不另造中文串） */
  name: string
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
}

/**
 * **旗舰战是否正在进行**（廉价判据，供每拍/每渲染的"在不在打"闸门用）。
 * 判据 = 遭遇槽里挂着旗舰卡 + 那场战斗还在（`weekendFlagshipEncounterOf` + `enc.battle`）。
 */
export function weekendFlagshipBattleActive(state: GameState): boolean {
  const enc = state.encounter
  if (!enc.active || !enc.battle) return false
  return weekendFlagshipEncounterOf(state, enc)
}

/** 旗舰战的战斗视图（无 / 还没开打 ⇒ `null`）。 */
export function weekendFlagshipBattleViewOf(state: GameState, ctx: SimContext): WeekendFlagshipBattleView | null {
  const enc = state.encounter
  const battle = enc.battle
  if (!battle || !enc.active) return null
  if (!weekendFlagshipEncounterOf(state, enc)) return null
  const anomaly = enc.anomalyId !== null ? ctx.anomalies.get(enc.anomalyId) : undefined
  if (!anomaly) return null
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? enc.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  /** 敌舰逐艘血量（**阵亡的也留着**：界面靠"血量 >0 → 0"的落差播爆炸，与洞内/洞外同一处口径） */
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  return {
    battle,
    anomaly,
    leaderShipId,
    name: anomaly.name,
    // ⚠ `ended` 之后仍要给 `combat`（与洞内/远征同款）：分胜负那一刻要留击杀慢镜与战报演出窗口
    combat: {
      distanceM: battle.distanceM,
      myDesireM: battle.myDesireM,
      meHp: leaderRt ? { ...leaderRt.hp } : { s: 0, a: 0, h: 0 },
      foeHp,
      shots: battle.stats.meShots,
      hits: battle.stats.meHits,
      lockTag: null,
    },
  }
}
