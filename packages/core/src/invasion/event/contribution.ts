/** 功能域职责拆分，保持原计算与顺序。 */
import type { WeekendEventState } from './model'
import { WEEKEND_STANDING_BEACON, WEEKEND_STANDING_MAX, clamp01, WEEKEND_PROGRESS_ISK_PER_PCT, weekendOccupiedIds, WEEKEND_CONTRIBUTION_BOSS_WEIGHT } from './constants'
import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import { weekendProgressAt } from './progress'
import { weekendFlagshipSharesOf } from './boss'

/**
 * **旗舰黑匣：击杀 BOSS 就得**（**2026-09-28 船长令**）。
 *
 * 船长原话（照抄）：「**我想了下，算了，让玩家击杀BOSS就能获得黑匣，取消之前的复杂判定，
 * 但是贡献权重要进行倾斜，BOSS输出的贡献占总贡献的60%。**」
 *
 * 口径（同日七答，条条已确认）：
 * - **击杀 ⇒ 必给 1 枚**；**没击杀 ⇒ 一定是 0**（章鱼人抢收 / 窗口到点旗舰撤走**都不再掷骰**）；
 * - 判据 = `weekendLastHitByPlayer`（**留档优先**的唯一判据）；
 * - ⚠ **旧的"爆率表"整套作废并删除**：`WEEKEND_BLACKBOX_MIN_ON_LAST_HIT` /
 *   `WEEKEND_BLACKBOX_MAX_OFF_LAST_HIT` / `weekendBlackBoxChanceOf` / `WEEKEND_BLACKBOX_SALT`
 *   掷骰子流 / `weekendRollBlackBox` / 字段 `flagshipBlackBoxByPlayer` —— 一个不留。
 *   它曾按「抢到最后一下 × 输出占比」掷概率（2026-09-25 船长令），2026-09-28 由上面那条取代。
 * - ⚠ **已知放宽**（当日已报船长确认，不是漏改）：「只抢最后一下」（输出接近 0、但母舰是你打爆的）
 *   现在也**必得**；旧口径下这种只有 10%。
 */

/**
 * **"是不是玩家击杀了 BOSS" —— 唯一判据**（**2026-09-28 船长重申＋当日改口径**）。
 *
 * 船长原话（照抄，先重申后放宽）：
 * 1. 「**规则应该很清楚记录了：输出超过50%血量，完成最后击杀，就给黑匣。**」
 * 2. 「**我想了下，算了，让玩家击杀BOSS就能获得黑匣，取消之前的复杂判定**」
 * ⇒ 现在只判**击杀**这一件事（`>50%` 那一档随爆率表一起取消）：**是 ⇒ 必给黑匣（1 枚）**。
 *
 * ⚠ **判据只能取"留档"，不能取"谁把共享血池顶满"**：
 * - `ev.flagshipPlayerKill` = **母舰在玩家的战斗里爆炸那一刻**置位（`combat` 的 `bossDownAtMs` 抄进场次记录），
 *   与池子算术无关 —— 这就是"玩家击杀了 BOSS"这个事实本身；
 * - 而"池子被谁顶满"是**章鱼人也在跑的另一本账**：玩家这一场把母舰打爆了、伤害却要等收尾才进账
 *   ⇒ 章鱼人可能抢先补掉池子里剩下的那几点 ⇒ 若按它判，**明明亲手打爆的玩家会被判成"没击杀"**
 *   （2026-09-28 玩家报障：占比 93.2% ＋ 亲手打爆）。
 */
export function weekendLastHitByPlayer(ev: WeekendEventState | undefined): boolean {
  if (!ev) return false
  return ev.flagshipPlayerKill !== undefined || ev.flagshipDown === 'player'
}

/**
 * **本场黑匣结清了没有** —— `ev.flagshipBlackBox` 自 2026-09-28 起的**新语义**：
 * `true` = 这一枚**已经落到玩家手里并记了账**；缺省 / `false` = **还没结清**。
 *
 * 结清标记由正常击沉发奖路径写入；旧场次不再由后续登录追补。
 *
 */
export function weekendBlackBoxSettledOf(ev: WeekendEventState | undefined): boolean {
  return ev?.flagshipBlackBox === true
}

/**
 * **这一场结算该发多少协会声望**（唯一判据 · 发与写快照同源）：
 * - 玩家用信号发射器点起来的（`ev.beaconLit`）⇒ **固定 `WEEKEND_STANDING_BEACON`**；
 * - 每周自己爆发的那场 ⇒ 按贡献占比最终向上取整（单场0~15点）。
 */
export function weekendStandingGainOf(ev: Pick<WeekendEventState, 'beaconLit'>, share: number): number {
  return ev.beaconLit === true ? WEEKEND_STANDING_BEACON : ceilFinalQuantity(share * WEEKEND_STANDING_MAX)
}

/** 记一笔玩家推进（主动胜利 / 击退遇袭 / 离线击退） */
export function weekendNoteContribution(ev: WeekendEventState, galaxyId: string, gain: number): void {
  ev.contributed[galaxyId] = clamp01((ev.contributed[galaxyId] ?? 0) + gain)
}

/** 玩家累计投入的进度合计（贡献占比的分子） */
export function weekendPlayerContribution(ev: WeekendEventState): number {
  return Object.values(ev.contributed).reduce((a, b) => a + b, 0)
}

/** 本场活动的进度收入合计（ISK） = 玩家投入进度（1 = 100%）× 100 × 单价 */
export function weekendProgressIncomeIsk(ev: WeekendEventState): number {
  return ceilFinalQuantity(weekendPlayerContribution(ev) * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)
}

/**
 * **贡献占比**（**2026-09-28 船长令改口径**：给 BOSS 输出加权）：
 *
 * ```
 * boss  = clamp01(旗舰HpDone ÷ 旗舰HpMax)      // 玩家对母舰的**实际输出占比**（玩家优先口径）
 * clear = 玩家投入进度 ÷（玩家投入 ＋ NPC 铺底） // 清缴那一份（2026-09-25 起的原口径，未动）
 * share = 0.6 × boss ＋ 0.4 × clear            // 权重见 WEEKEND_CONTRIBUTION_BOSS_WEIGHT
 * ```
 *
 * ⚠ 三条边界（船长 2026-09-28 逐条定过，不是漏改）：
 * - **没打 BOSS**（或本族没有共享池）⇒ `boss = 0` ⇒ 占比**上限 0.4**（最高 B 档）。
 *   船长原话：「**三、不管ACG族，因为之后入侵的不一定是他们**」⇒ **不为占位族开特例分支**；
 * - 「BOSS 输出」按**实际输出占比**算（打了 93% 就是 0.93），**不是**"击杀了就算满"；
 * - 三处下游**同源**（贡献四档奖 · 结算声望 `round(share×15)` · 快照/面板显示的占比）；
 *   **进度收入与夺回奖不受影响**（前者按进度台账算、后者按星系算）。
 * ⚠ NPC 铺底总量按"结算时刻各占领区的铺底之和"计 ⇒ 抢得越多、清缴那份占比越高。
 */
export function weekendContributionShareAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const ids = weekendOccupiedIds(ev)
  const npc = ids.reduce((sum, id) => {
    const p = weekendProgressAt(state, ev, id, nowWallMs)
    const put = ev.contributed[id] ?? 0
    return sum + Math.max(0, p - put)
  }, 0)
  const mine = weekendPlayerContribution(ev)
  const total = npc + mine
  const clear = total <= 0 ? 0 : clamp01(mine / total)
  const boss = weekendFlagshipSharesOf(ev).player
  return clamp01(WEEKEND_CONTRIBUTION_BOSS_WEIGHT * boss + (1 - WEEKEND_CONTRIBUTION_BOSS_WEIGHT) * clear)
}

/** 贡献奖档位（Q5 四档） */
export function weekendContributionTier(share: number): { tier: 'A' | 'B' | 'C' | 'D' | 'none'; wreck: number; isk: number } {
  if (share >= 0.8) return { tier: 'A', wreck: 12, isk: 8_000_000 }
  if (share >= 0.5) return { tier: 'B', wreck: 8, isk: 5_000_000 }
  if (share >= 0.2) return { tier: 'C', wreck: 4, isk: 2_000_000 }
  if (share > 0) return { tier: 'D', wreck: 1, isk: 0 }
  return { tier: 'none', wreck: 0, isk: 0 }
}
