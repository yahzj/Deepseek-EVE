/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import type { WeekendTickResult } from './model'
import { ensureWeekendEvent, weekendClaimOctopus, endWeekendEvent } from './lifecycle'
import { weekendFlagshipView, weekendIsBossFamily, weekendOctopusTick } from './boss'
import { weekendDebugOn, weekendT0Of } from './time'
import { WEEKEND_WINDOW_MS, WEEKEND_WINDOW_END_HOLD_MS, weekendOccupiedIds, WEEKEND_OCTOPUS_HOLD_MS, WEEKEND_BOSS_TICK_MAX_MS } from './constants'
import { weekendEncounterChanceAt } from './progress'

/**
 * **引擎每拍调用一次**（M1-b）：
 * 1. `ensureWeekendEvent` 开局面（正常模式：周五 20:00 的周排期 ＋ 声望前提；调试档：结束 +1h；
 * 2. 旗舰 anchor **落盘**（首次满分且在线那一拍 ⇒ 倒计时从此稳定，不再随 tick 漂移）；
 * 3. 章鱼人得手（`view.down === octopus`）⇒ 写 `flagshipDown` 并结束本场
 *    （⚠ **还有没打完的旗舰战时不判**：见 `flagshipBattleActive`，船长 2026-09-27 裁定「要一起闸」）；
 * 4. **本场该收场了吗**（**2026-10-02 船长令「乙」改口径**，见 `weekendTick` ④ 那一段与
 *    `docs/design/weekend-invasion.md`的现行排期章节）：
 *    - **周排期场** ⇒ **下一期 T0 到了**（不再是"自己 +96h＝周二 20:00"）；
 *    - **玩家召唤场**（`beaconLit`）⇒ **豁免周排期收场**（船长令「玩家召唤的不算在下一期」），
 *      改看**它自己那 96 小时**；
 *    - 两者都：还有没打完的旗舰战 ⇒ **顺延到"打完 + 60 秒"**（船长 2026-09-27 令「到点的延期到玩家
 *      打完1分钟后」，见 `WEEKEND_WINDOW_END_HOLD_MS` —— 该令本次**只换触发点、不废**）；
 * 5. 交出"该掷遇袭骰的星系与概率"（**不在本函数里掷**：随机源归引擎）。
 *
 * 🔴 **2026-10-02 补闸（一号 · 船长令「按你推荐来」）**：① 那一步（开新场）**也要过"还在打吗"这道闸** ——
 * 手上那一场若是**玩家亲手击沉后刚结束**（`weekendNoteFlagshipKilled` 会当场收场），而玩家还停在那一场
 * 旗舰战的战斗画面里，旧代码会在**同一拍**给他开一场新的：新场拿到的是**旧战斗的结算**
 * （伤害 / 击沉 / 封盘全落到新场头上）——正是报障那类"打完了入侵却还在 / 旗舰血条不对"的温床。
 * 现在：`flagshipBattleActive` 为真 ⇒ **本拍不开新场**；战斗一收场，下一拍照常开（延迟 ≤ 一拍）。
 * 同一道闸只适用于普通周排期开局。
 *
 * ⚠ 纯函数（除改 `state.weekendEvent` 的落盘字段外不碰别处）⇒ 用例可对任意时刻断言。
 *
 * @param flagshipBattleActive 入侵旗舰战是否正在进行（**唯一会触发顺延的那一场**；缺省 = 否）
 */
export function weekendTick(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  lastSeenWallMs: number,
  flagshipBattleActive = false,
): WeekendTickResult {
  /** ⚠ **还有没打完的旗舰战 ⇒ 本拍不开新场**（2026-10-02 补闸；见上面 ① 那段） */
  const started = flagshipBattleActive ? false : ensureWeekendEvent(state, ctx, nowWallMs)
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { started, flagshipShown: false, flagshipAnchored: false, ended: false, encounterRolls: [] }
  }

  // ② 旗舰 anchor 落盘（只在"未落盘 + 未过期"时写）
  const view = weekendFlagshipView(state, ev, nowWallMs, lastSeenWallMs)
  let flagshipAnchored = false
  if (view.shown && ev.flagshipAtWallMs === undefined && view.down === undefined) {
    ev.flagshipAtWallMs = view.atWallMs ?? nowWallMs
    flagshipAnchored = true
  }

  // ③ 章鱼人得手 ⇒ 结束本场（贡献奖照给——结算由调用方做）
  //    ⚠ **还有没打完的旗舰战 ⇒ 本拍不判**（船长 2026-09-27 裁定「要一起闸」）：否则掉线超 24h
  //      回来的那一拍，章鱼可能先把玩家正在打的那一场判走 —— 等于白延期（与 ④ 用同一把闸）。
  let ended = false
  let flagshipDown: WeekendTickResult['flagshipDown']
  if (!flagshipBattleActive && view.down === 'octopus' && weekendClaimOctopus(state, ev, nowWallMs)) {
    flagshipDown = 'octopus'
    ended = true
  }

  /**
   * ④ **本场该收场了吗**（**🔴 船长 2026-10-02 令「乙」改口径**）：
   *
   * 原话：「**周二 20:00 关窗的机制取消。**」＋（我摆出"软锁"风险、给三档后）「**乙。玩家召唤的不算在
   * 下一期。**」⇒ 定稿：
   *
   * - **周排期场**（每周五 20:00 开的那一场）：**不再按"自己 +96h（＝周二 20:00）"收场**，
   *   改为**下一期 T0 已到**（`weekendT0Of(now) > ev.startedAtWallMs`）⇒ 收场。
   *   这就是"乙"里那条**兜底**：既不半路掐断玩家，又不会让一场打不完的入侵**永远占住**"有进行中的场
   *   就不开新场"那条判据（那会让周排期入侵再也不开＝软锁）。
   *   ⚠ **连带作废**：2026-09-27 船长令「**假设，入侵我拖了一周，到下周该开入侵的时候，我还没结束。
   *   那么下周的入侵就应该取消。**」—— 新口径下旧场在**下一期 T0 那一拍就被强制收场**，
   *   不可能再拖到挡住下一期 ⇒ 那条"取消下一期"**已不可达**（`ensureWeekendEvent` ④ 保留为
   *   "不覆盖未结束的场"的保险，但正常流程走不到）。
   * - **玩家召唤场**（信号发射器，`beaconLit`）：**豁免上面那条**（船长令「玩家召唤的不算在下一期」）
   *   —— 玩家花道具点的场不该被周排期收掉；改为看**它自己那 96 小时**（＝发射器既有口径
   *   "这一场按既有规则活满 96 小时窗口"）。⚠ 这条自到点**必须留着**：否则"核心条没打满"的召唤场
   *   就永远没有收场机制 ⇒ 它会一直占位 ⇒ 周排期入侵再也不开（软锁）。
   * - 两者共用下面的**顺延**：收场点到了但还有没打完的旗舰战 ⇒ 顺延（不设上限）。
   *
   * **顺延**（**船长 2026-09-27 令**：「**到点的延期到玩家打完1分钟后**」——本条令**只换触发点、不废**）：
   * 收场点那一刻还有没打完的旗舰战 ⇒ 本拍**不结束**，把顺延终点推到 `now + 60 秒`；战斗结束后这
   * 60 秒走完才结束。于是"该收场那一场"照常结算（伤害/判沉/黑匣/残骸/日志），不再整场作废。
   * ⚠ 不设上限（船长同日裁定「甲」）：那场没打完就一直等，弃场由"下一期强制收场"自然兜住。
   */
  if (!ended && !weekendDebugOn(state)) {
    const summoned = ev.beaconLit === true
    const due = summoned
      ? nowWallMs >= ev.startedAtWallMs + WEEKEND_WINDOW_MS
      : weekendT0Of(nowWallMs) > ev.startedAtWallMs
    if (due) {
      if (flagshipBattleActive) {
        ev.windowEndHoldUntilWallMs = nowWallMs + WEEKEND_WINDOW_END_HOLD_MS
      } else if (nowWallMs >= (ev.windowEndHoldUntilWallMs ?? 0)) {
        endWeekendEvent(state, nowWallMs)
        ended = true
      }
    }
  }

  // ⑤ 交出遇袭候选（未夺回的占领区）
  const encounterRolls = weekendOccupiedIds(ev)
    .map((id) => ({ galaxyId: id, chance: weekendEncounterChanceAt(state, ev, id, nowWallMs) }))
    .filter((x) => x.chance > 0)

  return { started, flagshipShown: view.shown, flagshipAnchored, ...(flagshipDown !== undefined ? { flagshipDown } : {}), ended, encounterRolls }
}

/**
 * **章鱼人每拍推进**（引擎心跳调一次；`nowWallMs` 缺省 = 离线结算 / 工具 ⇒ **整拍不推进**，
 * 与船长"离线时章鱼也停"同口径）。
 *
 * 三件事：
 * 1. 首次满分且在线那一拍把 `flagshipAtWallMs` 锚点落盘（与 M1 的 `weekendTick` 同一条判据，
 *    只是这里**顺带**落 —— 让 Boss 池的削血窗口有一个不漂移的起点（窗口 2026-09-26 起正常档 = 24h））；
 * 2. 章鱼削血（`inBattle` 或**停工期** ⇒ 暂停）；
 * 3. 削到 100% ⇒ 写 `flagshipDown = 'octopus'` 并结束本场。
 *
 * 🔴 **2026-09-26 船长令（本函数新增第 4 参 · 冷却闸）**：「**给章鱼人进攻削血加个冷却，玩家战斗结束
 * 1 分钟后，章鱼人才开始削血和判定。这样玩家就能正常收掉 BOSS**」——
 * `flagshipBattleActive` = 旗舰战正在进行 ⇒ 本拍把停工终点推后到 `now + 60 秒`（`WEEKEND_OCTOPUS_HOLD_MS`）。
 * 于是旗舰战**打完那 60 秒里它既不削血、也不判得手**（一条守卫同时管住船长要的两件事）。
 * ⚠ 只有**旗舰战**推它（其它战斗照旧只走 `inBattle` 的"暂停"，不加尾巴）；
 * ⚠ 停工期**不吃事后补算**：拍基线（`bossTickWallMs`）照常同步到本拍。
 *
 * @param inBattle 玩家此刻是否在战斗中（含普通入侵战斗 ⇒ 都暂停）——2026-09-24 旧口径，逐字不变
 * @param flagshipBattleActive 入侵旗舰战是否正在进行（**唯一会起算冷却的那一场**；缺省 = 否）
 * @returns 本拍是否由章鱼人结束（引擎据此走 M1 的收尾：黑匣归零 + 贡献奖结算）
 */
export function weekendTickBoss(
  state: GameState,
  nowWallMs: number | undefined,
  inBattle: boolean,
  flagshipBattleActive = false,
): { down?: 'octopus' } {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return {}
  if (!weekendIsBossFamily(ev)) return {}
  if (ev.flagshipDown !== undefined) return {}
  // 离线结算 / 工具调用（不传墙钟）⇒ 整拍不推进（与"离线时章鱼也停"同口径）
  if (nowWallMs === undefined || !Number.isFinite(nowWallMs)) return {}
  const last = ev.bossTickWallMs
  const gap = Math.max(0, nowWallMs - (last ?? nowWallMs))
  ev.bossTickWallMs = nowWallMs
  /** **旗舰战进行中 ⇒ 每拍把停工终点推后 60 秒**（战斗一结束，剩下那截就是"结束后 60 秒"） */
  if (flagshipBattleActive) ev.octopusHoldUntilWallMs = nowWallMs + WEEKEND_OCTOPUS_HOLD_MS
  if (last === undefined) return {} // 本拍只是立基线：没有"上一拍"就没有可累计的时长
  // ⚠ 大步长（离线补算后的一次大跳 / 后台标签页）**只按一拍的合理上限累计**：
  // 章鱼削血是"在线陪着打"的机制，不能因为一次长跳就整段削掉（离线那部分本来就该停）。
  const dt = Math.min(gap, WEEKEND_BOSS_TICK_MAX_MS)
  if (ev.flagshipHpMax === undefined) return {} // 还没跟母舰交手过 ⇒ 池子未锁定（章鱼人也没有可削的目标）
  /**
   * **停工期**（战斗中 ＋ **旗舰战结束后 60 秒**）⇒ 不削血、**也不判得手**（船长 2026-09-26 令）。
   * ⚠ 放在 `dt` 之后、基线同步之后 ⇒ 这 60 秒不会被"解禁那一拍"当成掉线时长补削进来。
   */
  if (inBattle || nowWallMs < (ev.octopusHoldUntilWallMs ?? 0)) return {}
  if (weekendOctopusTick(state, ev, dt, inBattle)) {
    // 得手收口（掷黑匣 ＋ 写归属 ＋ 结束本场）只有一处：`weekendClaimOctopus`
    return weekendClaimOctopus(state, ev, nowWallMs) ? { down: 'octopus' } : {}
  }
  return {}
}
