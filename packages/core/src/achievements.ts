/**
 * **成就徽章**（船长 2026-09-18 预留接口 ＋ 2026-09-20「继续之前的成就系统」）。
 *
 * 第一批 = **徽章框架**：徽章表在 `data/src/achievements.ts`（63 枚），本模块只管
 * **判定 / 发放 / 去重**；图案与配色是数据侧字段，界面读它。
 *
 * 三条口径（设计稿 `docs/design/achievements-20260920.md` §3）：
 * 1. **纯展示**（船长 2026-09-20 裁定）：徽章**不发任何 ISK / 物品 / 数值加成** ⇒ 本模块
 *    **不碰钱包/仓库/货舱**，只写 `state.achievements.earned[id]`。这也是它敢"每拍判定"的原因。
 * 2. **达成即自动发**（船长裁定）：任务徽章在任务 `done` 那一刻发；链徽章在链进度**达到档位**时发。
 * 3. **只置一次**：`earned[id]` 已有则跳过（与 `importantTasks.done` / 任务奖励同款去重口径）——
 *    所以读档、重复判定、离线结算都不会重复发。
 *
 * ⚠ **挂点**（与 `firstTasks.ts:355` 预留接口说明一致）：`engine.ts` 里
 * `advanceFirstTasks` 那个循环**之后**调用本模块 ⇒ 任务达成与链升级都在同一拍可见。
 *
 * `⟪未完成 2026-09-20⟫` **第二批（里程碑成就内容）尚未实现**：数据表里 `category: 'milestone'`
 * 一枚都没有，`advanceAchievements` 也只认任务与链两种来源。第二批落地时在本模块加一支
 * `milestone` 判定即可，`earned` 账本与界面都不用动（本地化排队豁免见约定 §十一之二）。
 * **第一批（任务 ＋ 链共 63 枚）已完成并合入 main ⇒ 不再挂未完成记号。**
 */
import type { GameState } from './state'
import type { AchievementDef, AchievementSource } from './types'
import { FIRST_TASKS } from './firstTasks'

/** 徽章表：由数据层注入（`SimContext.achievements`），core 不自带内容 */
function tableOf(defs: readonly AchievementDef[] | undefined): readonly AchievementDef[] {
  return defs ?? []
}

/**
 * **该来源是否已达成**（`state` 现算，不看徽章账本）：
 * - `task`：任务已完成（`importantTasks[taskId].done === true`）；
 * - `chain`：链进度 ≥ 该档（进度记在 `importantTasks['chain-<id>'].delivered`，见 `advanceFirstChains`）。
 */
export function achievementReached(state: GameState, source: AchievementSource): boolean {
  if (source.kind === 'task') return state.importantTasks[source.taskId]?.done === true
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
): AchievementDef[] {
  const earned = (state.achievements ??= { earned: {} }).earned
  const newly: AchievementDef[] = []
  for (const def of tableOf(defs)) {
    if (earned[def.id] !== undefined) continue
    if (!achievementReached(state, def.source)) continue
    earned[def.id] = state.gameMs
    newly.push(def)
  }
  return newly
}

/**
 * **界面读数**：徽章总览（按数据表顺序）——每枚给"是否到手 / 到手时刻 / 是否已达成的当前状态"。
 *
 * `reached` 与 `earned[..] !== undefined` 在**正常流程下恒等**（每拍判定会把达成的补上）；
 * 分开给是为了让界面能显示"达成了但这一拍还没发"的中间态（例如刚读档的那一瞬）。
 */
export function achievementOverview(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
): Array<{ def: AchievementDef; earnedAt: number | null; reached: boolean }> {
  const earned = state.achievements?.earned ?? {}
  return tableOf(defs).map((def) => ({
    def,
    earnedAt: earned[def.id] ?? null,
    reached: achievementReached(state, def.source),
  }))
}

/** 已到手枚数（界面读数用；不含"已达未发"的中间态） */
export function achievementCount(state: GameState): number {
  return Object.keys(state.achievements?.earned ?? {}).length
}

/**
 * **链的档位徽章**（界面按链分组时用）：给某条链的全部徽章 ＋ 该链当前进度。
 *
 * ⚠ 链的展示名只有一个来源（`FIRST_TASKS` 里那条链的 `name`）⇒ 这里顺带给出来，
 * 免得界面再从数据表捞一遍。
 */
export function chainAchievementGroups(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
): Array<{ chainId: string; name: string; progress: number; badges: AchievementDef[] }> {
  const out: Array<{ chainId: string; name: string; progress: number; badges: AchievementDef[] }> = []
  for (const task of FIRST_TASKS) {
    const chain = task.chain
    if (!chain) continue
    const badges = tableOf(defs).filter((d) => d.source.kind === 'chain' && d.source.chainId === chain.id)
    if (badges.length === 0) continue
    out.push({
      chainId: chain.id,
      name: chain.name,
      progress: chainProgress(state, chain.id),
      badges,
    })
  }
  // 链的进度以 `importantTasks['chain-<id>'].delivered` 为**唯一账本**（`advanceFirstChains` 写它）。
  // ⚠ 不在这里另算一遍 `chainProgressOf`：那是"按计数现推"的另一把尺，两把尺并存迟早会对不上。
  return out
}
