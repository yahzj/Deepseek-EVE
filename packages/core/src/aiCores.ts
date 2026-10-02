/**
 * AI 核心账本 + 任务取消（2026-10-02 从 `ai.ts` 拆出，破 `ai ↔ shipyard` 运行期环）。
 *
 * 这里放"核心档位序 / 核心名 / 入库 / 取消任务归还核心"四件被跨模块借用的账本件：
 * `shipyard` / `encounters` 只借 `cancelAiTask`，`market` / `industry` / `wormholeAuto` /
 * `wormholeBattle` 只借 `gainAiCore`；它们都不依赖 `ai.ts` 的调度逻辑。
 * `ai.ts` 原样再导出（先例：fitted.ts），存量引用零改动；`shipyard` / `encounters`
 * 改从本模块读（不留在 ai 再导出——那会让运行期边原样保留）。
 */
import { peakFirst } from './firstTasks'
import { shipDisplayName } from './instances'
import { addLog } from './state'
import type { GameState } from './state'
import type { AiCoreType, SimContext } from './types'

/** 核心类型展示顺序 */
export const AI_CORE_ORDER: readonly AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 核心中文名 */
export function aiCoreName(type: AiCoreType): string {
  return type === 'basic' ? '基础 AI 核心' : type === 'gamma' ? '伽马 AI 核心' : type === 'beta' ? '贝塔 AI 核心' : '阿尔法 AI 核心'
}

/**
 * **核心档位名 → 本地化 id**（**2026-10-02 加** · 船长「按你建议来修」的「列表槽」批）：
 * `aiCoreName` 是纯中文名表，一旦当**参数**喂进模板（日志/附注），参数值不会再被翻译 ⇒
 * 英文界面会夹中文。这里给出 id，调用点按 `p{n}p{k}Id` 挂上（渲染层先翻再用）。
 * ⚠ 与渲染层 `ui/labelsText.ts` 的 `aiCoreText()` **同一张表**（那边已改为 import 本表）。
 */
export const AI_CORE_IDS: Readonly<Record<AiCoreType, string>> = {
  basic: 'ui.labelsText.009',
  gamma: 'ui.labelsText.010',
  beta: 'ui.labelsText.011',
  alpha: 'ui.labelsText.012',
}

/** 核心库数量 */
export function countAiCore(state: GameState, type: AiCoreType): number {
  return state.aiCores[type] ?? 0
}

/** 入库 */
export function gainAiCore(state: GameState, type: AiCoreType, count = 1): void {
  state.aiCores[type] = (state.aiCores[type] ?? 0) + count
  /**
   * **里程碑「AI 核心」的计数点**（成就系统第二批 · 船长 2026-09-20）。
   *
   * 记的是**库存里拥有过的类数**（本函数是全仓唯一的入库点 ⇒ 天然覆盖所有获得途径：
   * 遗迹核心、虫洞战果、掉落…），并按**峰值**记（`peakFirst`）——
   * 这样"曾集齐四类、后来花掉一枚"**不会把纪录改小**（记录的是"见过/拿过"，不是"此刻持有"）。
   */
  let kinds = 0
  for (const t of AI_CORE_ORDER) if ((state.aiCores[t] ?? 0) > 0) kinds += 1
  peakFirst(state, 'aiCoreKinds', kinds)
}

/** 出库 */
export function spendAiCore(state: GameState, type: AiCoreType): boolean {
  const current = state.aiCores[type] ?? 0
  if (current <= 0) return false
  state.aiCores[type] = current - 1
  return true
}

/** 批量出库 N 枚（市场挂卖/出售锁定用；库存不足整批不动并返回 false） */
export function spendAiCores(state: GameState, type: AiCoreType, count: number): boolean {
  const current = state.aiCores[type] ?? 0
  if (count <= 0 || current < count) return false
  state.aiCores[type] = current - count
  return true
}

/** 玩家指令：取消 AI 任务（核心归还）；掩护巡逻/远征/采矿通用 */
export function cancelAiTask(state: GameState, shipId: string, ctx: SimContext): boolean {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return false
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(state, 'fleet', `[AI] 已召回 ${shipName}（${aiCoreName(assignment.coreType)} 归还核心库）。`, 'core.ai.015', {
    p1: shipName,
    p2: aiCoreName(assignment.coreType),
  })
  return true
}
