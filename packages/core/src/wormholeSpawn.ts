import { addLog } from './state'
import type { GameState } from './state'
import {
  WORMHOLE_SPAWN_MIN_DEPTH,
  spawnAliveCount,
  spawnCapOf,
  spawnTargetsOf,
  wormholeStream,
} from './wormholeGrid'
import { wormholeCardIdForRun } from './wormholeFoes'

export interface WormholeSpawnResult {
  spawned: number
  ambush: boolean
  lastKey?: string
}

export function wormholeSpawnAfterTurns(state: GameState, turns: number): WormholeSpawnResult {
  const none: WormholeSpawnResult = { spawned: 0, ambush: false }
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return none
  if (run.expeditionRules === 2) return none
  if (run.depth < WORMHOLE_SPAWN_MIN_DEPTH) return none
  const n = Math.max(0, Math.floor(turns))
  if (n === 0) return none
  const cap = spawnCapOf(grid)
  const hereKey = grid.cells.find((c) => c.q === grid.pos.q && c.r === grid.pos.r)?.key
  let spawned = 0
  let ambush = false
  let lastKey: string | undefined
  for (let i = 0; i < n; i++) {
    if (spawnAliveCount(grid) >= cap) break
    const targets = spawnTargetsOf(grid)
    if (targets.length === 0) break
    const seq = Math.max(0, Math.floor(grid.spawnSeq ?? 0))
    const rng = wormholeStream((run.seed ?? 1) * 131 + run.depth * 977 + seq * 7919 + 41)
    const cell = targets[Math.min(targets.length - 1, Math.floor(rng() * targets.length))]!
    cell.foe = {
      card: wormholeCardIdForRun({
        family: run.family,
        seed: run.seed,
        depth: run.depth,
        kind: 'spawn',
        nodeIndex: seq * 7 + 3,
      }),
      seq,
    }
    if (cell.nebula === true && !(grid.dispersed ?? []).includes(cell.key)) {
      grid.dispersed = [...(grid.dispersed ?? []), cell.key]
    }
    grid.spawnSeq = seq + 1
    spawned += 1
    lastKey = cell.key
    if (cell.key === hereKey) ambush = true
  }
  if (ambush) {
    addLog(state, 'combat', '🕳 围剿者扑到你所在的位置：交火开始。', 'core.wormholeSpawn.001')
  }
  return { spawned, ambush, ...(lastKey !== undefined ? { lastKey } : {}) }
}
