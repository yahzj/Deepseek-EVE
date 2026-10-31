import type { GameState } from '../../state'
import { shipLockedInWormhole, wormholeAutoRunsOf } from '../../state'
import type { SimContext } from '../../types'
import type { CoreBlockReason } from '../../engine'
import { busyLabel } from '../../busyLabels'
import { wormholeAdmission, WORMHOLE_ADMISSION_TEXT } from '../fleet/admission'
import { commandShipDeployed } from '../../combat/command/locks'
import { combatShipLimit, commandBudgetOf } from '../../combat/command/rules'
const WORMHOLE_AUTO_MAX_SHIPS = combatShipLimit(true)

export function wormholeAutoShipBlockReason(
  state: GameState,
  shipId: string,
  opts?: { mainMayJoin?: boolean },
): CoreBlockReason | null {
  const ship = state.fleet[shipId]
  if (commandShipDeployed(state, shipId)) return busyLabel('expedition')
  if (state.shipReturns[shipId]) return busyLabel('unload')
  if ((state.planetary?.deliveries ?? []).some(row => row.shipUid === shipId)) return busyLabel('planetDelivery')
  if (!ship) return { error: '舰队里没有这艘船。', errorId: 'core.wormholeAuto.004' }
  if (shipId === state.shipId && !opts?.mainMayJoin)
    return { error: '主控船不参与自动探索（主控要留在站内）。', errorId: 'core.wormholeAuto.005' }
  if (shipLockedInWormhole(state, shipId)) return { error: '该舰在虫洞里：等它出洞再派。', errorId: 'core.wormholeAuto.006' }
  if (state.aiAssignments[shipId]) return { error: '该舰已在别的 AI 副船任务里：先撤回它。', errorId: 'core.wormholeAuto.007' }
  if (wormholeAutoRunsOf(state).some(run => run.shipIds.includes(shipId))) return { error: '该舰已在另一处虫洞的自动探索里。', errorId: 'core.wormholeAuto.008' }
  return null
}

/** 一条候选（界面用）：船 id + 显示名 + 是否默认选中 + 不可选时的原因 */
export interface WormholeAutoCandidate {
  shipId: string
  /** 显示名（玩家起的名 > 船型名 > id） */
  name: string
  /** 自动配置是否默认选它 */
  picked: boolean
  /** 不可派的原因（null = 可派；**2026-10-02 批⑫ 由 string 改结构化**，界面走 `cmdText` 按语言渲染） */
  blocked: CoreBlockReason | null
}

/**
 * **自动配置参与舰**（船长：「界面自动配置参与舰（按船型/装配挑最多 4 条非主控船，可手动改）」）。
 *
 * 排序口径（同分再按 id 稳定排序 ⇒ 同档可复现）：
 * ① **能打**：高槽里带武器的件数（炮台/导弹架/激光炮/无人机装置）多者优先；
 * ② **耐打**：`durability` 高者优先（刚修好的船先上）；
 * ③ **船型档位**（`tier`）高者优先。
 * 不可派的船**照旧列出**（界面置灰 + 显示原因）——玩家能看到"为什么它不能去"。
 */
/**
 * **自动配置的评分**（能打 → 耐打 → 船型档位；同分再按 id 稳定排序 ⇒ 同档可复现）。
 * 抽成单点：`wormholeAutoCandidates`（挑参与舰）与 `wormholeAutoMainHandover`（挑接任主控）共用同一把尺。
 */
export function wormholeAutoScore(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]!
  const def = ctx.ships.get(ship.defId ?? shipId)
  let guns = 0
  for (const id of ship.fitted?.high ?? []) {
    if (!id) continue
    const slot = ctx.modules.get(id)?.slot
    if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') guns += 1
  }
  return guns * 100 + Math.round((ship.durability ?? 1) * 10) * 5 + (def?.tier ?? 1) * 3
}

export function wormholeAutoCandidates(state: GameState, ctx: SimContext, exclude?: readonly string[]): WormholeAutoCandidate[] {
  const skip = new Set(exclude ?? [])
  const rows: Array<{ shipId: string; name: string; score: number; blocked: CoreBlockReason | null }> = []
  for (const shipId of Object.keys(state.fleet)) {
    if (skip.has(shipId)) continue
    const ownBlock = wormholeAutoShipBlockReason(state, shipId)
    const singleAdmission = wormholeAdmission(ctx, [shipId])
    const blocked = ownBlock ?? (singleAdmission.ok ? null : { error: WORMHOLE_ADMISSION_TEXT[singleAdmission.code] })
    rows.push({ shipId, name: shipNameOf(state, ctx, shipId), score: wormholeAutoScore(state, ctx, shipId), blocked })
  }
  rows.sort((a, b) => b.score - a.score || a.shipId.localeCompare(b.shipId))
  let picked = 0
  /**
   * 编队规模**不再受核心数限制**（2026-09-26 船长令「整队一趟只占 1 枚」）：
   * 占用是"每趟 1 枚"，与派几条船无关 ⇒ 这里只收口在参与舰上限上。
   * 改前是 `min(4, 当前可派核心数)` ⇒ **只有 1 枚核心时只能派 1 条**（明明允许 4 条），
   * 一趟收益跟着掉到 1/4 ——"核心少"被错误地转嫁成了"队伍小"。
   */
  const budget = WORMHOLE_AUTO_MAX_SHIPS
  const pickedIds: string[] = []
  return rows.map((r) => {
    if (r.blocked !== null || picked >= budget) return { shipId: r.shipId, name: r.name, picked: false, blocked: r.blocked }
    const admission = wormholeAdmission(ctx, [...pickedIds, r.shipId])
    if (!admission.ok || !commandBudgetOf(state, ctx, [...pickedIds, r.shipId], true).ok) {
      return {
        shipId: r.shipId,
        name: r.name,
        picked: false,
        // 加入推荐队会超重不等于该舰禁用，玩家仍可替换队伍后手动选择。
        blocked: r.blocked,
      }
    }
    picked += 1
    pickedIds.push(r.shipId)
    return { shipId: r.shipId, name: r.name, picked: true, blocked: null }
  })
}

/** 自动配置的默认参与舰（最多4条，沿真实质量及单舰忙态筛选） */
export function wormholeAutoDefaultShips(state: GameState, ctx: SimContext): string[] {
  return wormholeAutoCandidates(state, ctx)
    .filter((c) => c.picked)
    .map((c) => c.shipId)
}

/** 名称（日志/报告用；没起名就用船型名，再取不到就用 id） */
export function shipNameOf(state: GameState, ctx: SimContext, shipId: string): string {
  const ship = state.fleet[shipId]
  if (!ship) return shipId
  return ship.customName ?? ctx.ships.get(ship.defId ?? shipId)?.name ?? shipId
}
