import { type GameState, type BattleState, addLog } from '../state'
import type { CoreBlockReason } from '../engine'
import { combatRosterOf } from '../combat/command/roster'

export function droneBattleOutcome(
  state: GameState,
  battle: BattleState,
): { before: number; after: number; attrition: boolean } {
  const before = Object.values(battle.droneLoadAtStartBy
    ? Object.values(battle.droneLoadAtStartBy).reduce<Record<string, number>>((all, load) => {
      for (const [id, n] of Object.entries(load)) all[id] = (all[id] ?? 0) + n
      return all
    }, {}) : battle.droneLoadAtStart ?? {}).reduce((s, n) => s + n, 0)
  const rep =
    state.droneLossReport && state.droneLossReport.battleStartedAtGameMs === battle.startedAtGameMs
      ? state.droneLossReport
      : null
  const after = Math.max(0, rep?.survivors ?? before - (rep?.gone ?? 0))
  return { before, after, attrition: before > 0 && after / before < 0.5 }
}

export function autoLoopDroneShortfall(
  state: GameState,
  shipId: string = state.shipId,
): { now: number; floor: number; need: number } | null {
  const floor = state.autoLoopDroneFloor
  if (typeof floor !== 'number') return null
  const now = combatRosterOf(state, shipId).reduce((sum, id) => sum + Object.values(state.fleet[id]?.droneLoad ?? {}).reduce((s, n) => s + n, 0), 0)
  return now <= floor ? { now, floor, need: floor + 1 } : null
}

export function autoLoopReopenBlockReason(state: GameState): CoreBlockReason | null {
  const fs = state.fleet[state.shipId]
  if (!fs) return { error: '舰队里找不到当前驾驶舰船。', errorId: 'core.expedition.032' }
  if ((fs.armorPct ?? 1) < 0.5 || fs.durability < 0.5) {
    return { error: '装甲或结构低于 50%：先修回 50% 以上，或装上船体维修装置并带够组件。', errorId: 'core.expedition.033' }
  }
  const short = autoLoopDroneShortfall(state)
  if (short) {
    return short.floor <= 0
      ? { error: '机群已全灭：货仓与物品仓库都没有可补充的无人机——先在装配页装入（购买或制造）再开启重复清剿。', errorId: 'core.expedition.034' }
      : {
          error: `机群尚未补充（现 ${short.now} 架 · 停环时 ${short.floor} 架）：需补到 ${short.need} 架以上才可再开——先在装配页装入无人机。`,
          errorId: 'core.expedition.035',
          errorParams: { p1: short.now, p2: short.floor, p3: short.need },
        }
  }
  return null
}

export function stopAutoLoopReason(state: GameState, reason: string, droneFloor: number | null = null): void {
  state.autoLoopAnomalyId = null
  state.autoLoopDroneFloor = droneFloor
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复清剿已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text)
  state.autoLoopStopNotice = text
}

export function autoLoopWaitLabel(state: GameState): string | null {
  if (state.pendingBattleRange) return '战前准备'
  if (state.expedition.active) return '本次出击'
  if (state.mining.active) return '采矿'
  if (state.salvaging.active) return '残骸打捞'
  if (state.transit.active) return '航行'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开炉'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开线'
  return null
}

export function autoLoopInvasionGalaxy(state: GameState): string | null {
  const gid = state.weekendEvent?.autoLoopGalaxyId
  return typeof gid === 'string' && gid.length > 0 ? gid : null
}

export function stopAutoLoopInvasion(state: GameState, reason: string, reasonId?: string, reasonParams?: Record<string, string | number>): void {
  if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复出击已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text, 'core.invasionLoop.006', {
    p1: reason, p2: armorPct, p3: structPct,
    ...(reasonId ? { p1Id: reasonId } : {}),
    ...Object.fromEntries(Object.entries(reasonParams ?? {}).map(([key, value]) => [`p1${key}`, value])),
  })
  state.autoLoopStopNotice = text
}
