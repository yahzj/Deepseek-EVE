/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { weekendDebugOn, weekendT0Of, weekendWindowOpen } from './time'
import { WEEKEND_DEBUG_AUTO_START_ENABLED, WEEKEND_FIRST_T0_WALL_MS, WEEKEND_WINDOW_MS, WEEKEND_DEBUG_ONLY, WEEKEND_DEBUG_RESTART_MS } from './constants'
import { weekendInvasionAllowedFor, weekendRollOccupation, weekendPeriodSealedByKill } from './occupation'
import { weekendLockedFamilyOf, weekendFamilyForWindow } from './family'
import type { WeekendEventState } from './model'
import { weekendCoreProgressAt } from './progress'

/**
 * **确保当前时刻有一场该有的入侵**（幂等）：
 * - 正常模式：窗口（周五 20:00 ~ +96h）内若 `startedAtWallMs` 不是本周 T0 ⇒ 开新一场（编号 +1）；
 * - 调试模式：自动开场开关开启时，上一场结束 + 1h 后刷新（无历史 ⇒ 首次调用即开）；
 * - 返回是否发生了变化（供调用方决定是否落盘/记日志）。
 */
export function ensureWeekendEvent(state: GameState, ctx: SimContext, nowWallMs: number): boolean {
  if (weekendDebugOn(state) && !WEEKEND_DEBUG_AUTO_START_ENABLED) return false
  const ev = state.weekendEvent
  /**
   * **首场一次性 T0**（**船长 2026-09-25 令**：「**现在可以解除限制，并在一会 22 点开始第一次入侵
   * 活动。**」＋ 二答「**只今晚这一次 22:00**」）——`WEEKEND_FIRST_T0_WALL_MS` 只在这一晚生效：
   * 到点、且"手上还没有从这一刻起开过的场"⇒ 按它开首场；此后一律回落到**每周五 20:00** 的周排期。
   *
   * 位置刻意放在**调试分支之前**：船长要的是"22 点开始第一次入侵"，与他客户端是否还开着调试模式无关
   * （开着调试也只是这一场按调试节奏跑；下一场起调试模式照旧走"结束后 1 小时刷新"）。
   */
  const firstT0 = WEEKEND_FIRST_T0_WALL_MS
  if (
    firstT0 !== null &&
    nowWallMs >= firstT0 - 2 * 3_600_000 && // 从首场那天的周排期 T0（20:00）起进入"首场时段"
    nowWallMs < firstT0 + WEEKEND_WINDOW_MS
  ) {
    /**
     * ① **首场时刻之前**：这一场留给 22:00 ⇒ **周排期让位**（20:00~22:00 这段不开局，
     * 否则会在 20:00 先开一场、22:00 又被首场覆盖一次）。
     * ⚠ 调试档不放让位（船长令「调试模式不受限」的同一精神）：调试玩家这段照旧能开局。
     */
    if (nowWallMs < firstT0 && !weekendDebugOn(state)) return false
    /** ② **到点 ＋ 手上还没有"从这一刻起"开过的场** ⇒ 开首场（T0 = 22:00，不是周排期的 20:00） */
    if (nowWallMs >= firstT0 && (ev === undefined || ev.startedAtWallMs < firstT0) && weekendInvasionAllowedFor(state)) {
      const seq = (ev?.seq ?? 0) + 1
      const rolled = weekendRollOccupation(state, ctx, seq)
      if (rolled) {
        state.weekendEvent = { seq, startedAtWallMs: firstT0, ...rolled, contributed: {} }
        return true
      }
    }
    // ③ 到点但已经开过（或抽不出核心）⇒ 落回下面的正常 / 调试路径
  }
  // 船长 2026-09-23 起"仅调试模式可见"的闸；**2026-09-25 船长解除**（见 `WEEKEND_DEBUG_ONLY`）
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return false
  if (weekendDebugOn(state)) {
    /**
     * **锁定族的自愈**（沿用2026-09-25船长令）：手上那一场若是**锁定前开的历史场**，
     * 就地**改判族**——进度台账、场次号、旗舰池全留着，只换成`weekendLockedFamilyOf`指定的族。
     * ⚠ 只在调试模式做：正常模式的老场不追改。
     */
    if (
      ev !== undefined &&
      ev.endedAtWallMs === undefined &&
      weekendLockedFamilyOf(state) !== null &&
      ev.family !== weekendLockedFamilyOf(state)
    ) {
      ev.family = weekendLockedFamilyOf(state)!
    }
    if (ev && ev.endedAtWallMs === undefined) return false
    if (ev && nowWallMs - ev.endedAtWallMs! < WEEKEND_DEBUG_RESTART_MS) return false
    const seq = (ev?.seq ?? 0) + 1
    const rolled = weekendRollOccupation(state, ctx, seq)
    if (!rolled) return false
    state.weekendEvent = { seq, startedAtWallMs: nowWallMs, ...rolled, contributed: {} }
    return true
  }
  const t0 = weekendT0Of(nowWallMs)
  if (!weekendWindowOpen(nowWallMs, t0)) return false // 窗口外：入侵不存在
  /**
   * **声望前提**（**船长 2026-09-25 令**：「给入侵触发加一个前提，需要拥有至少40声望，才会触发入侵。」
   * ＋ 四答：只在开新场那一刻判 · 不足静默不开 · 调试模式不受限）。
   * 位置刻意留在**调试分支之后**：调试模式走上面那条路、压根到不了这里。
   */
  if (!weekendInvasionAllowedFor(state)) return false
  /**
   * **🔴 「一个窗口只开一场」已作废**（**船长 2026-10-02 令「甲」**）——原话：
   * 「**一个窗口只开一场：距上一场开始不足 96h ⇒ 不开。进行修改。不应该看间隔，而应该看当前有没有入侵
   * 正在进行。**」（我按 §5.2 摆出下面那段 2026-09-25 的沿革与锁它的三条用例后，船长裁「甲」＝照字面落地。）
   *
   * **删掉的那条判据**（2026-09-25 加，现**作废**）：
   * ```ts
   * if (ev && nowWallMs - ev.startedAtWallMs < WEEKEND_WINDOW_MS) return false
   * ```
   * 它的来历：更早的判据要求"未结束" ⇒ 旗舰被击沉、窗口还没到点时**下一拍就会立刻又开一场**，
   * 当时的定稿是「每周末一次」⇒ 改成按窗口（96h 间隔）判。
   *
   * **船长 2026-10-02 改判的理由（"看间隔"的错处）**：`startedAtWallMs` **不一定是某期 T0** ——
   * 调试档分支写的是 `nowWallMs`（任意时刻），首场特例写的是 09-25 22:00。这时间隔判据会**误挡**：
   * 调试档周三 20:00 开一场、21:00 打完并关掉调试 ⇒ **本周五 20:00 那一期被挡住**（只隔 48h ＜ 96h），
   * 整个周末不开入侵。⇒ 判据改为**只看状态**：**当前有没有正在进行的那一场**（下面那一句）。
   *
   * ⚠ **甲的必然后果**（船长已知情并选甲）：窗口内**上一场一结束，下一拍就开新的一场**
   * （`seq+1`、重抽核心、`contributed` 归零），一直连到窗口关（周二 20:00）为止 ⇒ **夺回奖 /
   * 进度收入 / 协会声望 / 旗舰黑匣每场各发一次**；族按**本期 T0** 定 ⇒ 窗口内连开的每一场**同族**。
   * 换场只换**已结束**的场（下一句兜住）⇒ 不存在"未结算的场被顶掉"。
   */
  /**
   * **上一场还没结束 ⇒ 本周入侵取消**（**船长 2026-09-27 令**：「**假设，入侵我拖了一周，到下周该开入侵
   * 的时候，我还没结束。那么下周的入侵就应该取消。**」）。
   *
   * ⚠ **2026-10-02 船长令「乙」之后本条在正常流程里已不可达**：到点收场已改为"**下一期 T0 已到**"
   * （周排期场）⇒ 旧场就是在下一期 T0 那一拍被强制收场的，**不存在"拖过 T0 还活着"**。
   * 判据**保留**在这里的价值只剩一条：**绝不覆盖未结束的场**（`weekendSettleAndGrant` 要求
   * `endedAtWallMs` 有值 ⇒ 被顶掉的未结束场永远结不了算：贡献四档奖 / 待到账夺回奖励 / 协会声望 /
   * 结束通讯一起静默丢掉）。⇒ 任何将来新增的"收场触发点"都必须与它并存，不许绕开。
   *
   * 口径：**开新场的前提 = 上一场已经结束**（= 船长 2026-10-02「应该看当前有没有入侵正在进行」那句的实现）。
   * 旧的这一场照旧活着、照旧由玩家打完 —— 打完收场后只要还落在某一周的窗口内，当周照常补开。
   */
  if (ev && ev.endedAtWallMs === undefined) return false
  /**
   * 🔴 **本期封盘**（**船长 2026-10-02 令「甲」**）：**本期已经击杀过旗舰 ⇒ 本期不再开新场**。
   * 起因与口径见 {@link weekendPeriodSealedByKill} 头注（玩家报障「击败旗舰打空血量后……旗舰血量全满」）。
   * 位置：放在"上一场未结束"那道门**之后**（那条必须先判：绝不用新场覆盖未结算的旧场），
   * 在**抽核心 / 定族之前**（封盘了就一步都不做，连随机子流都不消费）。
   */
  if (weekendPeriodSealedByKill(state, t0)) return false
  const seq = (ev?.seq ?? 0) + 1
  /**
   * **本期族**（**船长 2026-10-02 令**：「一会8点开启入侵，设置为R族，下周如果没有特意设置，
   * 就采用循环敌对势力。」）——按**本期窗口 T0** 算：特意设置优先，否则按循环顺延。
   */
  const rolled = weekendRollOccupation(state, ctx, seq, weekendFamilyForWindow(t0))
  if (!rolled) return false
  state.weekendEvent = { seq, startedAtWallMs: t0, ...rolled, contributed: {} }
  return true
}

/** 结束本场（旗舰被摧毁 / 章鱼人摧毁 / T0+96h）：清占领、留编号与台账（结算由调用方做） */
export function endWeekendEvent(state: GameState, nowWallMs: number): WeekendEventState | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return ev
  ev.endedAtWallMs = nowWallMs
  return ev
}

/**
 * **玩家击毁旗舰**：记结局并结束本场（黑匣与贡献奖由调用方结算）。
 * ⚠ 核心门禁：**核心条未满**（`weekendCoreProgressAt < 1`）⇒ 不认（返回 `false`）。
 */
export function weekendNoteFlagshipKilled(state: GameState, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return false
  ev.flagshipDown = 'player'
  endWeekendEvent(state, nowWallMs)
  return true
}

/**
 * **章鱼人得手的唯一收口**（**2026-09-27 二号整理**：此前这段三行在两条路径里各写了一遍，
 * 2026-09-26 就是因为**只有一处掷骰**而吞掉了玩家该拿的黑匣 —— 玩家报障「**入侵活动里没有判定击杀**」）。
 *
 * 三件事，顺序固定：
 * 1. **掷黑匣**（"没抢到最后一下"那一档：`25% × 输出占比`；船长 2026-09-25 令 ＋ 四答之二"照发"）
 *    —— 掷骰幂等（`ev.flagshipBlackBox` 有值即返回），走场次子流、读档重打结果相同；
 * 2. 写归属 `ev.flagshipDown = 'octopus'`；
 * 3. 结束本场（贡献奖由调用方结算）。
 *
 * 两条到点路径都走它：**逐拍削血**（`weekendTickBoss` → `weekendOctopusTick`，在线那一路）与
 * **视图/离线判定**（`weekendTick` ③ 读 `weekendFlagshipView` 的 `down`，离线保护失效 ＋ 窗口到点那一路）。
 * ⚠ **窗口到点（旗舰撤走、没被摧毁）不走这里、也不掷骰**：没有残骸可捞。
 *
 * @returns 真认领了才 `true`（已有归属 / 已结束 ⇒ `false`）
 */
export function weekendClaimOctopus(state: GameState, ev: WeekendEventState, nowWallMs: number): boolean {
  if (ev.flagshipDown !== undefined || ev.endedAtWallMs !== undefined) return false
  /**
   * **不再掷骰**（**2026-09-28 船长令**「取消之前的复杂判定」）：黑匣只跟"击杀"挂钩 ⇒
   * 章鱼人把池子收尾 = **玩家没击杀** ⇒ 本场黑匣为 0，这里什么都不发、也不写 `flagshipBlackBox`
   * （它现在的含义是"已结清"）。
   *
   * ⚠ 与玩家的击杀**不冲突**：玩家若在别处已经把母舰打爆（留档 `flagshipPlayerKill`），
   * 那一枚已由 `weekendApplyBattleOutcome` 的正常击沉分支发放。
   */
  ev.flagshipDown = 'octopus'
  endWeekendEvent(state, nowWallMs)
  return true
}
