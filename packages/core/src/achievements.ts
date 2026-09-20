/**
 * **成就徽章**（船长 2026-09-18 预留接口 ＋ 2026-09-20「继续之前的成就系统」）。
 *
 * 两批**都已完成**（2026-09-20）：第一批 = 徽章框架（任务 ＋ 链，63 枚）；
 * 第二批 = **里程碑成就**（18 枚，判据 = 终身计数）。徽章表在 `data/src/achievements.ts`（**81 枚**），
 * 本模块只管**判定 / 发放 / 去重**；图案与配色是数据侧字段，界面读它。
 *
 * 三条口径（设计稿 `docs/design/achievements-20260920.md` §3 ＋ 展示改版
 * `docs/design/achievement-display-20260920.md`）：
 * 1. **纯展示**（船长 2026-09-20 裁定）：徽章**不发任何 ISK / 物品 / 数值加成** ⇒ 本模块
 *    **不碰钱包/仓库/货舱**，只写 `state.achievements.earned[id]`。这也是它敢"每拍判定"的原因。
 * 2. **达成即自动发**（船长裁定）：任务徽章在任务 `done` 那一刻发；链徽章在链进度**达到档位**时发；
 *    里程碑徽章在**终身计数达到阈值**时发（三种来源同拍、同一套账）。
 * 3. **只置一次**：`earned[id]` 已有则跳过（与 `importantTasks.done` / 任务奖励同款去重口径）——
 *    所以读档、重复判定、离线结算都不会重复发。
 *
 * ⚠ **挂点**（与 `firstTasks.ts` 预留接口说明一致）：`engine.ts` 里
 * `advanceFirstTasks` 那个循环**之后**调用本模块 ⇒ 任务达成、链升级、里程碑达标都在同一拍可见。
 *
 * **里程碑为什么零新增通路**：它的判据读 `firstStatOf`（`state.firstStats`）——与「第一次」任务、
 * 次数链**同一本账**；而那本账是**可选字段 + 缺省 0** ⇒ 老档天然自愈（载入后第一拍把够格的补齐），
 * 既不用写迁移、也不用升级存档版本。四个新计数键（`rareBoxes` / `whMaxDepth` / `whBossClears` /
 * `matterTechMaxed`）见 `FirstStatKey`；其中两个是**峰值型**（`peakFirst`，只升不降、幂等）。
 */
import type { GameState } from './state'
import type { AchievementDef, AchievementSource } from './types'
import { firstStatOf } from './firstTasks'
import type { FirstStatKey } from './firstTasks'

/** 徽章表：由数据层注入（`SimContext.achievements`），core 不自带内容 */
function tableOf(defs: readonly AchievementDef[] | undefined): readonly AchievementDef[] {
  return defs ?? []
}

/**
 * **该来源是否已达成**（`state` 现算，不看徽章账本）：
 * - `task`：任务已完成（`importantTasks[taskId].done === true`）；
 * - `chain`：链进度 ≥ 该档（进度记在 `importantTasks['chain-<id>'].delivered`，见 `advanceFirstChains`）；
 * - `milestone`：终身计数 ≥ `target`（`firstStatOf`）——与「第一次」任务、链**同一本账**
 *   （`state.firstStats`）⇒ 里程碑自动享受"每拍现算补发 · 老档自愈 · 幂等"那整套，不需要另写一条通路。
 */
export function achievementReached(state: GameState, source: AchievementSource): boolean {
  if (source.kind === 'task') return state.importantTasks[source.taskId]?.done === true
  if (source.kind === 'milestone') return firstStatOf(state, source.stat as FirstStatKey) >= source.target
  return chainProgress(state, source.chainId) >= source.level
}

/**
 * **某条链已达成到第几级**（0 = 一级未达）。
 *
 * ⚠ 与 `advanceFirstChains` 的记账**同一把尺**：它写 `importantTasks['chain-<id>'].delivered`，
 * 本函数读同一个键。老档缺这个键 ⇒ 读作 0（链从 0 起算；补发逻辑见 `save.ts` 的 `MIGRATIONS[29]`）。
 */
export function chainProgress(state: GameState, chainId: string): number {
  return state.importantTasks[`chain-${chainId}`]?.delivered ?? 0
}

/**
 * **补发 + 每拍判定**（引擎每拍调用）：把"已达成但账上没有"的徽章补进 `earned`，
 * 返回**本次新到手**的徽章定义列表（调用方据此发通讯/日志；不发任何奖励）。
 *
 * 为什么用"现算补发"而不是"只在事件点发"：老档（迁移时补发）与**任何漏发场景**
 * （读档、异常中断、以后新增判定支线）都靠这条自愈 —— 判定是幂等的，多发不了。
 */
export function advanceAchievements(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
  /** 现实墙钟（毫秒时间戳）——由引擎传入（`advanceGame` 的 `opts.nowWallMs`，与 `advanceSideTasks` 同源） */
  nowWallMs?: number,
): AchievementDef[] {
  const earned = (state.achievements ??= { earned: {} }).earned
  const newly: AchievementDef[] = []
  for (const def of tableOf(defs)) {
    if (earned[def.id] !== undefined) continue
    if (!achievementReached(state, def.source)) continue
    /**
     * **记两个时刻**（船长 2026-09-20：「还要记录成就完成时间」）：
     * - `atGameMs` = `state.gameMs`（游戏内时间，与日志 `LogEntry.atGameMs` 同一把尺）；
     * - `atWallMs` = 引擎传入的**现实墙钟**。
     *
     * ⚠ **不在这里调 `Date.now()`**：core 保持确定性（用例/工具能钉住时间）；
     * 未传墙钟（用例、工具、离线首拍前的极端态）⇒ 记 **0 = 未记录**，界面据此显示"时间未记录"，
     * 而不是编一个假时间。
     */
    earned[def.id] = { atGameMs: state.gameMs, atWallMs: wallNowOf(nowWallMs) }
    newly.push(def)
  }
  return newly
}

/** 现实墙钟（非有限正数一律当"未记录"= 0） */
function wallNowOf(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * **界面读数**：徽章总览（按数据表顺序）——每枚给"是否到手 / 到手时刻 / 是否已达成的当前状态"。
 *
 * `reached` 与 `earned[..] !== undefined` 在**正常流程下恒等**（每拍判定会把达成的补上）；
 * 分开给是为了让界面能显示"达成了但这一拍还没发"的中间态（例如刚读档的那一瞬）。
 *
 * `earnedAt` = **游戏内时间**（毫秒；`null` = 未到手）；`earnedWallMs` = 真实时间（0 = 未记录）。
 * `legacy` = 老档补发（两个时刻都为 0）⇒ 界面显示"时间未记录"。
 */
export function achievementOverview(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
): Array<{ def: AchievementDef; earnedAt: number | null; earnedWallMs: number; legacy: boolean; reached: boolean }> {
  const earned = state.achievements?.earned ?? {}
  return tableOf(defs).map((def) => {
    const rec = earned[def.id]
    return {
      def,
      earnedAt: rec ? rec.atGameMs : null,
      earnedWallMs: rec?.atWallMs ?? 0,
      legacy: rec !== undefined && rec.atGameMs === 0 && rec.atWallMs === 0,
      reached: achievementReached(state, def.source),
    }
  })
}

/** 已到手枚数（界面读数用；不含"已达未发"的中间态） */
export function achievementCount(state: GameState): number {
  return Object.keys(state.achievements?.earned ?? {}).length
}
