import type { GameState } from './state'
import type { WormholeRunState } from './wormhole'
import { gridCellAt, hasLiveFoe, hexDistance, hexKey, hexNeighbors, wormholeStream } from './wormholeGrid'
import { wormholeCardIdForRun } from './wormholeFoes'

export interface WormholePatrolState {
  id: number
  threshold: 2 | 4
  status: 'warning' | 'active' | 'cancelled' | 'cleared'
  warnedAt: number
  nextMoveAt: number
  card: string
  cellKey?: string
}

export interface WormholePatrolResult { spawned: boolean; moved?: boolean; ambush?: boolean; key?: string }

function syncWarnings(run: WormholeRunState): void {
  const patrols = run.patrols ??= []
  const seq = run.patrolActionSeq ?? 0
  for (let id = 0; id < Math.min(2, run.patrolsSpawned ?? 0); id++) {
    if (!patrols.some(p => p.id === id)) patrols.push({ id, threshold: id === 0 ? 2 : 4, status: 'cancelled', warnedAt: seq, nextMoveAt: seq + 2, card: '' })
  }
  for (const threshold of [2, 4] as const) {
    if ((run.alertLevel ?? 0) >= threshold && !patrols.some(p => p.threshold === threshold)) {
      const id = threshold === 2 ? 0 : 1
      patrols.push({
        id, threshold, status: 'warning', warnedAt: seq, nextMoveAt: seq + 2,
        card: wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: 1, kind: 'spawn', nodeIndex: id + 97 }),
      })
    }
  }
  for (const p of patrols) {
    if (p.status === 'warning' && (run.alertLevel ?? 0) < p.threshold) p.status = 'cancelled'
  }
  // 终结实例仍占名额；击败或取消不会刷新阈值。
  run.patrolsSpawned = patrols.length
  run.patrolsCleared = patrols.filter(p => p.status === 'cleared').length
}

export function wormholePatrolLayerReset(run: WormholeRunState): void {
  run.alertLevel = run.depth <= 3 ? 0 : run.depth <= 6 ? 1 : 2
  run.patrolActionSeq = 0
  run.patrols = []
  run.patrolsSpawned = 0
  run.patrolsCleared = 0
  syncWarnings(run)
}

/** 只由成功的移动/扫描/作业调用，一次动作一拍，不以费用或真实时间代替节拍。 */
export function wormholePatrolAfterAction(state: GameState, opts?: { deferMovement?: boolean }): WormholePatrolResult {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || run.expeditionRules !== 2 || !grid || run.battle) return { spawned: false }
  run.patrolActionSeq = (run.patrolActionSeq ?? 0) + 1
  syncWarnings(run)
  const seq = run.patrolActionSeq
  const result: WormholePatrolResult = { spawned: false }
  if (opts?.deferMovement) return result
  const exitKey = hexKey(grid.exit.q, grid.exit.r)
  const hereKey = hexKey(grid.pos.q, grid.pos.r)
  for (const p of run.patrols ?? []) {
    if (p.status === 'warning' && seq >= p.nextMoveAt) {
      const candidates = grid.cells.filter(c =>
        (grid.scanned.includes(c.key) || grid.visited.includes(c.key)) && c.key !== hereKey && c.key !== exitKey &&
        !hasLiveFoe(c) && (c.place !== 'ship' || grid.activated.includes(c.key)),
      )
      const rng = wormholeStream((run.seed ?? 0) * 31 + run.depth * 7919 + p.id * 131)
      const target = candidates[Math.floor(rng() * candidates.length)]
      if (!target) continue
      target.foe = { card: p.card, seq: p.id, patrolId: p.id }
      p.status = 'active'
      p.cellKey = target.key
      p.nextMoveAt = seq + 2
      if (target.nebula) grid.dispersed = [...new Set([...(grid.dispersed ?? []), target.key])]
      result.spawned = true
      result.key = target.key
    } else if (p.status === 'active' && seq >= p.nextMoveAt) {
      const old = grid.cells.find(c => c.key === p.cellKey)
      if (!old || old.foe?.patrolId !== p.id || old.foe.cleared) continue
      const target = hexNeighbors(old).map(c => gridCellAt(grid, c)).filter(c =>
        c !== undefined && c.key !== exitKey && !hasLiveFoe(c) && (c.place !== 'ship' || grid.activated.includes(c.key)),
      ).sort((a, b) => hexDistance(a!, grid.pos) - hexDistance(b!, grid.pos) || a!.key.localeCompare(b!.key))[0]
      p.nextMoveAt = seq + 2
      if (!target) continue
      delete old.foe
      target.foe = { card: p.card, seq: p.id, patrolId: p.id }
      p.cellKey = target.key
      if (!grid.scanned.includes(target.key)) grid.scanned.push(target.key)
      if (target.nebula) grid.dispersed = [...new Set([...(grid.dispersed ?? []), target.key])]
      result.moved = true
      result.key = target.key
      if (target.key === hereKey) {
        run.pendingNodeBattle = true
        result.ambush = true
      }
    }
  }
  return result
}

/** 警戒变化不推进巡逻；免费选项/拖货/暂停均不会调用动作节拍。 */
export function wormholeRaiseAlert(state: GameState, delta: number): void {
  const run = state.wormhole.run
  if (!run || run.expeditionRules !== 2 || !Number.isFinite(delta)) return
  run.alertLevel = Math.max(0, Math.min(6, (run.alertLevel ?? 0) + Math.floor(delta)))
  syncWarnings(run)
}

export function wormholeCancelPatrol(run: WormholeRunState): boolean {
  const warning = run.patrols?.find(p => p.status === 'warning')
  if (!warning) return false
  warning.status = 'cancelled'
  return true
}

export function wormholePatrolDefeated(run: WormholeRunState, id: number): void {
  const patrol = run.patrols?.find(p => p.id === id)
  if (patrol) patrol.status = 'cleared'
  syncWarnings(run)
}
