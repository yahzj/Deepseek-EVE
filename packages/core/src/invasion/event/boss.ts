/** 功能域职责拆分，保持原计算与顺序。 */
import type { AnomalyDef, FoeShipSlot } from '../../types'
import { WEEKEND_FLAGSHIP_SHIP_ID, WEEKEND_FLAGSHIP_POOL_HP, WEEKEND_OFFLINE_SHIELD_MS, WEEKEND_BOSS_FAMILIES, clamp01 } from './constants'
import type { WeekendEventState, WeekendFlagshipView, WeekendBossPoolView } from './model'
import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import { weekendCoreProgressAt } from './progress'
import { weekendFlagshipWindowMs, weekendDebugOn } from './time'

/**
 * **这张旗舰卡里的"母舰"是哪一条舰级**（**唯一取数口** · **族无关** · **从卡自身认**）。
 *
 * 判据 = **卡里唯一那艘 `hullClassTier === 5`**（旗舰；两族的旗舰卡都满足：母舰 T5、僚舰 T3/T4）
 * ⇒ 加新族**不用改 core**（旧的写死常量正是"加族忘改"的典型）。认不出时回落遗留常量
 * `WEEKEND_FLAGSHIP_SHIP_ID`（老档 / 构造卡兜底）。
 *
 * 三个消费方（都是同一条链）：伤害台账挑母舰（`weekendBattle` 的 `flagshipBattleLedger` 入参）·
 * 开战时 `FoeOverride.bossShipId`（决定 `hpMul` 与血条分母认哪一条）· 三层容量用的 `split`。
 */
export function weekendFlagshipSlotOf(card: AnomalyDef | undefined): FoeShipSlot | undefined {
  const slots = card?.ships ?? []
  return slots.find((s) => s.ship.hullClassTier === 5) ?? slots.find((s) => s.ship.id === WEEKEND_FLAGSHIP_SHIP_ID)
}

/**
 * **"这条舰级算不算'旗舰'（BOSS 本体）"**——**遗留判据**（只认 H 族那一艘）。
 *
 * ⚠ 2026-10-02 起**生产路径不再用它**（改用 {@link weekendFlagshipSlotOf} 从卡自身认，见其头注的报障）；
 * 保留导出只为兼容既有调用方 / 老测试。新代码请用 `weekendFlagshipSlotOf(card)`。
 */
export function weekendIsFlagshipShipId(shipId: string): boolean {
  return shipId === WEEKEND_FLAGSHIP_SHIP_ID
}

/**
 * **战斗里母舰的血条**（船长 2026-09-25 选「甲：母舰血条 = 池子剩余」，同日再改口径 ⇒ **共享血条**）。
 *
 * ⚠ **2026-09-25 船长两条口径**：
 * 1.「**章鱼人削减母舰血条是真实削减，玩家假设打完一场放一会，母舰血量是会真实减少。**」
 * 2.「**章鱼人 = 真实削减血量所以并不需要显示章鱼人削减进度和倒计时。（因为削到 0% 就代表母舰被章鱼人摧毁。）**」
 *
 * ⇒ **一条共享血条**：`剩余 = 池子总量 −（玩家已造成 ＋ 章鱼人已削）`，下限 1
 * （= 0 表示已被摧毁，开战入口先拒）。玩家的实战伤害与章鱼人的侵蚀**都真实减少同一条血**——
 * 于是"打完一场放一会，母舰血量真减少"成立，也不再需要单独的章鱼进度与倒计时读数。
 * 由 `weekendLaunch.weekendStartFlagshipBattle` 传进 `FoeOverride.bossHp` ⇒ 逐拍重建也吃同一份
 * （覆写随档存进 `BattleState.foeOverride`）。
 */
export function weekendFlagshipHpRemaining(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return WEEKEND_FLAGSHIP_POOL_HP
  return Math.max(1, ceilFinalQuantity(flagshipRawLeftOf(ev)))
}

/**
 * **血条还剩多少**（共享血条的**原始读数**；`2026-09-27 整理`：把原先散在三处的同一算式收成一处）：
 * `池子总量 −（玩家已造成 ＋ 章鱼人已削）`，可 ≤ 0（= 已被摧毁）。三处读法都由它派生：
 * `weekendFlagshipHpRemaining`（抬到 ≥ 1，给开战入口与界面）· `weekendFlagshipDefeated`（≤ 0 即击沉）·
 * `weekendBossPoolView` 的 `hpLeft`。
 * ⚠ 名字刻意与那个公开读数**拉开**：本函数是"原始剩余"（可负），那个是"抬到 ≥ 1 的展示值"。
 * ⚠ `weekendOctopusTick` 里的 `need`（= `池子 − 玩家已造成`）**语义不同**：那是"章鱼还差多少才够得手"，
 * 不是血条剩余 ⇒ 不由本函数派生（血条已被玩家打空时它 ≤ 0，那一档归玩家、章鱼不认领）。
 */
export function flagshipRawLeftOf(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return WEEKEND_FLAGSHIP_POOL_HP
  const hpMax = ev.flagshipHpMax ?? WEEKEND_FLAGSHIP_POOL_HP
  return hpMax - Math.max(0, ev.flagshipHpDone ?? 0) - weekendOctopusDone(ev)
}

/**
 * **章鱼人已削掉的血量**（共享血条里的那一份，与玩家的 `flagshipHpDone` 相加即"血条已经掉了多少"）。
 * 字段本身就是血量（`octopusHpDone`）⇒ 读侧**不需要知道窗口长度**（窗口只在推进时用一次）。
 */
export function weekendOctopusDone(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return 0
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return 0
  return Math.min(hpMax, Math.max(0, ev.octopusHpDone ?? 0))
}

/**
 * **母舰三层血的容量**（护盾/装甲/结构）= 池子总量 × 卡面 `split`（母舰 = 0.2 / 0.55 / 0.25）。
 * 这是血条三行的**分母**（恒为池子口径）——与"当前剩多少"分开算，见下。
 */
export function weekendFlagshipLayerCaps(
  hpMax: number,
  split: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const total = Math.max(0, hpMax)
  return { s: total * split.s, a: total * split.a, h: total * split.h }
}

/**
 * **母舰三层血的"当前值" = 按 护盾 → 装甲 → 结构 的顺序扣除**（**船长 2026-09-25 令**：
 * 「**母舰当前血条不要按照三个等比扣除，应该按照护盾-装甲-结构的顺序扣除**」）。
 *
 * 口径：池子剩余 `remaining` **从最后一层往回灌**——先灌满**结构**，再灌**装甲**，剩下才落在**护盾**上。
 * 等价说法：池子挨过的伤害**先打光护盾**（第一层），打光了才开始打装甲，最后打结构。
 *
 * 于是"池子剩 50%"不是说三层各半，而是：护盾 **0** · 装甲 `75000−37500=37500` · 结构 **满**——
 * 血条三行一眼就能看出"盾已经没了、正在啃装甲"。
 * ⚠ 这**不只是显示**：三层各自的抗性与层克制不同（`applyDamage` 逐层乘系数）⇒
 * 母舰开打时的分层血量决定了每一发的实收伤害，"护盾先空"与"三层等比"打架手感不同。
 */
export function weekendFlagshipLayersOf(
  remaining: number,
  cap: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const rest = Math.max(0, Math.min(cap.s + cap.a + cap.h, remaining))
  const h = Math.min(cap.h, rest)
  const a = Math.min(cap.a, Math.max(0, rest - h))
  const s = Math.min(cap.s, Math.max(0, rest - h - a))
  return { s, a, h }
}

/**
 * **旗舰视图（含离线保护）**（第 8/10 条 ＋ Q3/Q7）：
 *
 * - **核心条满 ⇒ 现身**；
 * - **得手判据 = 共享血条被削空**（**真实削减**：船长 2026-09-24「2小时内按时间削掉100%母舰血量。
 *   当玩家正在战斗时，会暂停削血」＋ 2026-09-25「章鱼人削减母舰血条是真实削减，玩家假设打完一场放一会，
 *   母舰血量是会真实减少」）⇒ `血条 = 池子总量 −（玩家已造成 ＋ 章鱼已削）`，与 `weekendTickBoss`
 *   的削血进度**同一把尺**，不再是"墙钟到点"；
 * - **离线保护**（Q3）：离线 **满 24h** 即视为保护失效 ⇒ 自那一刻起算，窗口到点即视为已被摧毁
 *   （离线期间削血是暂停的，这条是"人不在就别无限期挂着"的那道闸）；
 * - 调试模式**关掉离线保护**（Q7）且窗口 = **10 分钟**（船长 2026-09-25：「保留到点即判，把调试窗口调长」）。
 */
export function weekendFlagshipView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendFlagshipView {
  /**
   * 🔴 **活动已结束 ⇒ 一律"没现身"**（**2026-10-02 修 · 玩家报障「旗舰战斗后仍然无法结束入侵」**）。
   *
   * 真因：本函数原先只判 `flagshipDown` 与核心条，而**"到点收场"那条路不写 `flagshipDown`**
   * （结局是 `'window'`）⇒ 已结束的活动只要核心条满过，就仍然报 `shown: true` ⇒ 星系详细里的
   * 「发现敌方旗舰 → 战前准备」入口与母舰血条**一直挂着**（点进去只会被 `weekendFlagshipSpecOf`
   * 的结束门弹回一个错误提示）⇒ 玩家看到的就是"入侵打完了却还在、还结束不了"。
   * ⚠ 与 `StarMap` 那句既有注释对齐（「母舰被摧毁 ⇒ 活动收场（`endedAtWallMs`）⇒ 红光与 ★ 一起消失
   * （上面两道判据都先查它）」）—— 那句**本来就得靠本条才成立**（那两处自己查了，本视图没查）。
   * ⚠ 本批（"击杀 ⇒ 本期封盘"）让"已结束的活动对象"在本期**一直留着**（改前当拍就被新场替换）
   * ⇒ 这处漏门才显形；顺手把同一类的 `weekendBossPoolView` 也补上（下面那段）。
   */
  if (ev.endedAtWallMs !== undefined) return { shown: false }
  if (ev.flagshipDown) return { shown: true, atWallMs: ev.flagshipAtWallMs, down: ev.flagshipDown }
  const full = weekendCoreProgressAt(state, ev, nowWallMs) >= 1
  if (!full) return { shown: false }
  const windowMs = weekendFlagshipWindowMs(state)
  /**
   * **共享血条**（2026-09-25 口径）：`已掉 = 玩家已造成 ＋ 章鱼已削`。
   * 见底 ⇒ 母舰已被摧毁（玩家打完 ⇒ 玩家击沉；章鱼削空 ⇒ 章鱼人得手，仇敌归属由各自那条路径写）。
   */
  const hpMax = ev.flagshipHpMax ?? 0
  const hpLeft =
    hpMax > 0 ? Math.max(0, hpMax - Math.max(0, ev.flagshipHpDone ?? 0) - weekendOctopusDone(ev)) : 0
  /** **血条见底** ⇒ 得手（与 `weekendTickBoss` 同一判据） */
  const drainDone = weekendFlagshipDefeated(ev)
  const offline = Math.max(0, nowWallMs - lastSeenWallMs)
  /**
   * **倒计时起算点 anchor**——**只在"首次满分且玩家在线"那一拍落盘**（`flagshipAtWallMs`），落盘后不再变：
   * - 已落盘 ⇒ 直接用它；
   * - 未落盘 ＋ 调试模式 ⇒ 此刻（**Q7：关掉离线保护**）；
   * - 未落盘 ＋ 离线 ≤60 秒（视为在线，tick 会落盘）⇒ 此刻；
   * - 未落盘 ＋ 离线 ≤24h（**离线保护**，第 10 条）⇒ **上线第一拍**起算；
   * - 未落盘 ＋ 离线 >24h（**Q3**）⇒ **自"离线满 24h"那一刻**起算 ⇒ 上线时若已过期，旗舰已被章鱼人摧毁。
   */
  let anchor = ev.flagshipAtWallMs
  if (anchor === undefined) {
    if (weekendDebugOn(state) || offline <= 60_000 || offline <= WEEKEND_OFFLINE_SHIELD_MS) anchor = nowWallMs
    else anchor = lastSeenWallMs + WEEKEND_OFFLINE_SHIELD_MS
  }
  /** 离线 **超过** 24h 保护期：窗口按 anchor 起算（人不在的那段不削血，但也不能无限期挂着） */
  const offlineLapsed = offline > WEEKEND_OFFLINE_SHIELD_MS
  /**
   * **停工期**（战斗中 ＋ **旗舰战结束后 60 秒**，2026-09-26 船长令）⇒ 章鱼人**不判定得手**。
   * ⚠ `drainDone`（血条见底）在停工期里不可能**新**变真（停工期不削血）⇒ 这里只需管"到点即判"那一路。
   */
  const octopusHeld = nowWallMs < (ev.octopusHoldUntilWallMs ?? 0)
  const down =
    drainDone || (!octopusHeld && offlineLapsed && nowWallMs >= anchor + windowMs) ? ('octopus' as const) : undefined
  /**
   * **倒计时（展示口径）**：
   * - 在线 ⇒ 从**此刻**起算、按"还差多少在线非战斗时间才能把**剩下的血**削空"算
   *   （`剩余 × 窗口 ÷ 池子总量`）——削血是真实削减，所以玩家打掉的越多、剩下的越快被削空；
   * - 离线保护失效那一档 ⇒ 按 anchor 快照展示（Q3 的"自离线满 24h 起算"）；
   * - ⚠ **池子未锁定**（还没跟母舰交手过）⇒ 章鱼人没有可削的目标（与 `weekendTickBoss` 同口径），
   *   读数就是"从现在起整整一个窗口"。
   */
  const deadlineWallMs = offlineLapsed
    ? anchor + windowMs
    : hpMax > 0
      ? nowWallMs + Math.round((hpLeft * windowMs) / hpMax)
      : nowWallMs + windowMs
  return { shown: true, atWallMs: anchor, deadlineWallMs, ...(down !== undefined ? { down } : {}) }
}

/** 本场入侵的族是否走 **BOSS 池子口径**（只有 `WEEKEND_BOSS_FAMILIES` 里的族） */
export function weekendIsBossFamily(ev: WeekendEventState | undefined): boolean {
  return ev !== undefined && WEEKEND_BOSS_FAMILIES.includes(ev.family)
}

/**
 * **章鱼人每毫秒削掉池子的比例** = 100% ÷ 削血窗口（船长：「按时间削掉100%母舰血量」；
 *   ⚠ 窗口 2026-09-26 起正常档 = **24 小时**（船长令「延长到默认最多24小时才能削完」，原 2h））。
 * 线性同比：`章鱼已削 = 削血时长 / 窗口 × 池子总量`（削血时长只计"在线且非战斗"）。
 * ⚠ 窗口走 `weekendFlagshipWindowMs`（正常 **24h** / 调试 10min）——与倒计时、池子读数、收口四处同源。
 */
export function weekendOctopusDrainPerMs(state: Pick<GameState, 'debugQuick'>, hpTotal: number): number {
  return hpTotal / weekendFlagshipWindowMs(state)
}

/**
 * **旗舰结局的唯一判据**（`player` / `octopus` / `window`）——结算快照与引擎结束日志**共用它**。
 *
 * 判据顺序（**2026-09-27 船长令**：「都有开关记录了，为什么还会显示被章鱼人抢头？」）：
 * 1. **有"玩家亲手击沉"的留档 ⇒ 一律 `player`**（`ev.flagshipPlayerKill`：母舰在玩家的战斗里爆炸那一刻
 *    置位、与池子算术无关）——从此不会出现"玩家的战斗明明打沉了母舰、报告却说章鱼抢头"；
 * 2. 否则读 `ev.flagshipDown`（`player` = 玩家把血条打空 · `octopus` = 章鱼收走）；
 * 3. 都没有 ⇒ `window`（窗口到点，旗舰撤走、未判定击沉）。
 */
export function weekendFlagshipOutcomeOf(ev: WeekendEventState | undefined): 'player' | 'octopus' | 'window' {
  if (ev?.flagshipPlayerKill !== undefined) return 'player'
  if (ev?.flagshipDown === 'player') return 'player'
  if (ev?.flagshipDown === 'octopus') return 'octopus'
  return 'window'
}

/**
 * **旗舰血条的两份占比 · 玩家优先口径**（**2026-09-27 船长令**：「**关于章鱼人的输出，优先计算玩家的，
 * 玩家允许挤掉章鱼人的输出（最终输出占比）**」）。
 *
 * 口径：**先算玩家那份** `玩家已造成 ÷ 池子`（封顶 100%）；章鱼那份取 `min(章鱼已削, 池子 − 玩家已造成)`。
 * ⇒ 两份相加**恒 ≤ 100%**，且**玩家那份永不被章鱼挤掉**——两条账都越线时，多出来的那一截算章鱼的，
 * 不回头啃玩家的占比（血条见底时读数上就表现为"章鱼那份被玩家挤掉"）。
 *
 * 唯一出处：血条视图（`weekendBossPoolView`）与结算快照（`weekendResultSnapshotOf`）都读它，
 * 免得界面一处、报告一处各算一遍。
 */
export function weekendFlagshipSharesOf(ev: WeekendEventState | undefined): { player: number; octopus: number } {
  if (!ev || !weekendIsBossFamily(ev)) return { player: 0, octopus: 0 }
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return { player: 0, octopus: 0 }
  const done = Math.max(0, ev.flagshipHpDone ?? 0)
  const player = clamp01(done / hpMax)
  return { player, octopus: clamp01(Math.min(weekendOctopusDone(ev), Math.max(0, hpMax - done)) / hpMax) }
}

/** **池子总量**（缺省 = 还没跟母舰交手过 ⇒ `undefined`；`floorHp` = 由卡面折算的下限） */
export function weekendFlagshipPoolTotal(ev: WeekendEventState | undefined): number | undefined {
  if (!ev || !weekendIsBossFamily(ev)) return undefined
  return ev.flagshipHpMax
}

/**
 * **BOSS 池读数**（`undefined` = 尚未接战 ⇒ 界面显示"待接战"；`null` 之外不可能）。
 * ⚠ 章鱼那一份**走同一条血条**（共享）：它削掉多少，血条就少多少——玩家接着打的是剩下的那截。
 */
export function weekendBossPoolView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState | undefined,
): WeekendBossPoolView | null {
  /**
   * ⚠ **活动已结束 ⇒ 没有血条**（**2026-10-02 修**，与 `weekendFlagshipView` 同一处漏门、同一个报障）：
   * 结束时池子还剩多少是**历史读数** ⇒ 已经结束的活动不该再在星系详细/核心节点上挂着血条
   * （玩家看到的是"0% / 40% 的血条还在"＝"入侵还没结束"）。结算面板与结算通讯读的是**战果快照**
   * （`weekendLastResult`），不读本函数 ⇒ 关掉它不影响任何结算呈现。
   */
  if (!ev || ev.endedAtWallMs !== undefined || !weekendIsBossFamily(ev)) return null
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return null
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  // ⚠ 章鱼那一份折成血量走 `weekendOctopusDone`（窗口常量口径，与 `state.debugQuick` 无关）
  const octopusDone = weekendOctopusDone(ev)
  /** 两份占比走**玩家优先**口径（2026-09-27 船长令：玩家允许挤掉章鱼人的输出） */
  const shares = weekendFlagshipSharesOf(ev)
  /**
   * 血条剩余走**单一算式**（`2026-09-27 整理`）。⚠ 原先这里还有一个 `needDmg` 字段与 `hpLeft` **恒同值**
   * （同一算式算两遍）⇒ 已删（全仓无消费点，只有一条用例在断言它）——要"还差多少打空"就读 `hpLeft`。
   */
  const left = Math.max(0, flagshipRawLeftOf(ev))
  void state
  return {
    hpMax,
    hpDone,
    // **共享血条**：玩家那份与章鱼那份都真实减少它
    hpLeft: left,
    octopusDone,
    playerFrac: shares.player,
    octopusFrac: shares.octopus,
  }
}

/**
 * **记一场对母舰的伤害**（船长：「按对母舰造成的伤害决定，如果母舰没有受伤就是0输出」）。
 *
 * @param rawDmg 该场**打进母舰的原始伤害**（未截断；`0` = 该场没打到它）
 * @returns 本次是否**把池子打空**（= 旗舰被玩家击沉）
 *
 * ⚠ **2026-09-25 改口径**：池子 = **固定常量** `WEEKEND_FLAGSHIP_POOL_HP`（150,000），首次接战即立起
 * （原先按"5 × 首战最高伤害"与"母舰卡面血 ×5"自适应，母舰 ×10 后已脱节）。
 * ⚠ **2026-09-27 清理**：原先还顺手记的 `flagshipBestRunDmg`（"单场最高伤害读数"）**没有任何读取点**，
 * 已随 `flagshipDmgLogged` 一起删除 —— 别再往本函数里加"只写不读"的读数。
 */
export function weekendNoteFlagshipDamage(
  ev: WeekendEventState,
  rawDmg: number,
  /**
   * **这一场的身份**（缺省 = 沿用上一场）：引擎传 `battle.startedAtGameMs`（同一场战斗恒同值）。
   * 用途 = **幂等**：同一场可能被结算两次（战斗收尾 + 遇袭收尾）⇒ 只在"换了新的一场"时才累计，
   * 同场重复调用一律忽略（否则同一场的伤害会被记两遍）。
   */
  runId?: number,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  const dmg = Math.max(0, ceilFinalQuantity(rawDmg))
  const sameRun = runId !== undefined && ev.flagshipRunId === runId
  if (sameRun) return weekendFlagshipDefeated(ev) // 同一场的重复结算 ⇒ 已记过，不再叠加
  if (runId !== undefined) ev.flagshipRunId = runId
  if (ev.flagshipHpMax === undefined) ev.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
  if (dmg > 0) {
    ev.flagshipHpDone = Math.max(0, (ev.flagshipHpDone ?? 0) + dmg)
  }
  return weekendFlagshipDefeated(ev)
}

/**
 * **玩家是否已把母舰血条打空**（= 击沉）。
 *
 * ⚠ **2026-09-25 共享血条口径**：血条 = `池子总量 −（玩家已造成 ＋ 章鱼人已削）` ⇒
 * **玩家的这一击把血条打空**（哪怕前面已被章鱼削掉一半）就算**玩家击沉**（黑匣归玩家）。
 * 池子未锁定时（还没接战）恒 `false`。
 */
export function weekendFlagshipDefeated(ev: WeekendEventState | undefined): boolean {
  if (!ev || !weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return false
  /** 判据与血条剩余**同一算式**（`flagshipRawLeftOf`）：见底（≤ 0）即击沉 */
  return flagshipRawLeftOf(ev) <= 0
}

/**
 * **章鱼人推进一拍**（只累计"在线且非战斗"的时长；船长：「玩家正在战斗时，会暂停削血」＋
 * 离线「挂起：离线时章鱼也停」）。
 *
 * @param dtMs 本拍墙钟增量（调用方按 `nowWallMs − lastSeenWallMs` 且**离线保护未失效**时传入；
 *             离线/保护失效时传 0）
 * @param inBattle 玩家此刻是否在战斗中（含普通入侵战斗 ⇒ 都暂停）
 * @returns 本拍是否**章鱼人把旗舰削沉了**
 */
export function weekendOctopusTick(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  dtMs: number,
  inBattle: boolean,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  if (inBattle || dtMs <= 0) return false
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return false
  // ⚠ 窗口按**本档的实际长度**取（`weekendFlagshipWindowMs`：正常 2h / 调试 10min，
  //   与 `weekendBossPoolView`、倒计时、收口四处同一把尺）
  const d = Math.max(0, dtMs)
  if (d <= 0) return false
  /**
   * ⚠ **2026-09-25 共享血条**：章鱼那一份**直接记成血量**（`octopusHpDone`），
   * 速率 = `池子总量 ÷ 窗口` ⇒ 整整一个窗口的在线非战斗时间能把**满血**削空。
   * 玩家已经打掉的部分不重复算：血条见底 = `玩家 ＋ 章鱼 ≥ 总量`。
   */
  const playerDone = Math.max(0, ev.flagshipHpDone ?? 0)
  const need = hpMax - playerDone
  // 血条已被玩家打空 ⇒ 归属玩家（本拍不由章鱼人认领，避免仇敌记错）
  if (need <= 0) return false
  ev.octopusHpDone = Math.min(hpMax, weekendOctopusDone(ev) + d * weekendOctopusDrainPerMs(state, hpMax))
  return (ev.octopusHpDone ?? 0) >= need
}
