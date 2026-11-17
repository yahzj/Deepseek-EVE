import { ceilFinalQuantity } from './quantity'
import {
  HEX_DIRS,
  gridCellAt,
  gridTally,
  hexDiskAround,
  hexDiskCells,
  hexDistance,
  hexKey,
  isExitCell,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  type HexCell,
  type WormholePlace,
} from './wormholeGrid'
import { WORMHOLE_TURN_PER_MOVE, WORMHOLE_TURN_PER_SCAN } from './wormholeGrid'
import { WORMHOLE_PILE_UNITS_BASE } from './wormhole'
import { WORMHOLE_WRECK_PILE_M3_BASE, WORMHOLE_GRAVEYARD_COMMONS_MIN, WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_VEIN_PILES_MIN, WORMHOLE_VEIN_PILES_MAX, wormholeRelicChanceOf } from './wormholeSalvage'
import { signalSpaceResourcePileBonus, wormholeLayerRewardMul } from './wormholeFoes'
import { wormholeTurnBudget, wormholeStepCost } from './wormhole'

const STEP_COST = WORMHOLE_TURN_PER_MOVE

export const WORMHOLE_AUTO_SIM_YIELD_MUL = 0.8
const EXTRACT_RESERVE_TURNS = 2

export interface WormholeAutoDescend {
  depthReached: number
  cellsExplored: number
  fightsWon: number
  fightsAvoided: number
  wreckM3: number
  oreUnits: number
  rareItems: number
  relicBoxes: number
  matterDevices: number
  holdFull: boolean
  outOfTurns: boolean
  turnsOnScan: number
  turnsOnMove: number
}

export interface WormholeAutoPower {
  dps: number
  ehp: number
}

export function wormholeAutoDescend(opts: {
  seed: number
  startDepth: number
  totalMass: number
  holdM3: number
  oreUnitM3: number
  miners: number
  salvagers: number
  power: WormholeAutoPower
  scanRadius: number
  guardPowerOf: (depth: number) => WormholeAutoPower
  techTurnBonus?: number
  tech: { wreck: number; ore: number }
  yieldMul?: number
  blankShareFactor?: number
}): WormholeAutoDescend {
  const { seed, startDepth, totalMass, holdM3, oreUnitM3, miners, salvagers, power, guardPowerOf, tech, scanRadius,
    blankShareFactor = 1 } = opts
  const rng = mulberry(seed * 6364136223846793005 + 1442695040888963407)
  const yieldMul = opts.yieldMul ?? WORMHOLE_AUTO_SIM_YIELD_MUL
  let turns = wormholeTurnBudget(totalMass, opts.techTurnBonus ?? 0)

  const out: WormholeAutoDescend = {
    depthReached: Math.max(1, Math.min(9, startDepth)),
    cellsExplored: 0,
    fightsWon: 0,
    fightsAvoided: 0,
    wreckM3: 0,
    oreUnits: 0,
    rareItems: 0,
    relicBoxes: 0,
    matterDevices: 0,
    holdFull: false,
    outOfTurns: false,
    turnsOnScan: 0,
    turnsOnMove: 0,
  }
  let holdUsed = 0

  for (let depth = Math.max(1, startDepth); depth <= 9; depth++) {
    const grid = wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0, blankShareFactor, undefined, true)
    const mul = wormholeLayerRewardMul(depth)
    const radius = wormholeGridRadiusFor(depth)

    const worth: Array<{ cell: HexCell; place: WormholePlace }> = []
    for (const cell of hexDiskCells(radius)) {
      const g = gridCellAt(grid, cell)
      if (!g) continue
      if (isExitCell(grid, cell)) continue
      const place = g.place
      if (place === 'vein' && miners <= 0) continue
      if ((place === 'graveyard' || place === 'ruins') && salvagers <= 0) continue
      if (place === 'vein' || place === 'graveyard' || place === 'ruins' || place === 'ship' || place === 'matter') {
        worth.push({ cell, place })
      }
    }

    let pos: HexCell = grid.start

    const scanR = Math.max(1, Math.floor(scanRadius))
    const cellsInLayer = hexDiskCells(radius).length
    const scansNeeded = Math.max(1, Math.ceil(cellsInLayer / (3 * scanR * scanR + 3 * scanR + 1)))
    const scanCost = scansNeeded * WORMHOLE_TURN_PER_SCAN
    if (turns - scanCost < EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }
    turns -= scanCost
    out.turnsOnScan += scanCost

    while (turns > EXTRACT_RESERVE_TURNS) {
      let bestIdx = -1
      let bestD = Infinity
      let bestRank = -1
      for (let i = 0; i < worth.length; i++) {
        const w = worth[i]!
        if (holdUsed >= holdM3 && w.place !== 'ruins' && w.place !== 'matter') continue
        const rank = w.place === 'ruins' || w.place === 'matter' ? 2 : w.place === 'ship' ? 1 : 0
        const d = hexDistance(pos, w.cell)
        if (rank > bestRank || (rank === bestRank && d < bestD)) {
          bestRank = rank
          bestD = d
          bestIdx = i
        }
      }
      if (bestIdx < 0) break
      const target = worth[bestIdx]!
      const need = bestD * STEP_COST
      if (turns - need < EXTRACT_RESERVE_TURNS) break

      if (bestD > scanR && turns - WORMHOLE_TURN_PER_SCAN < EXTRACT_RESERVE_TURNS) break
      const revealCost = bestD > scanR ? WORMHOLE_TURN_PER_SCAN : 0

      if (target.place === 'ship') {
        const gp = guardPowerOf(depth)
        if (!canWin(power, gp)) {
          out.fightsAvoided += 1
          worth.splice(bestIdx, 1)
          continue
        }
        const cost = wormholeStepCost(2, 0)
        if (turns - need - cost - revealCost < EXTRACT_RESERVE_TURNS) break
        turns -= need + cost
        out.fightsWon += 1
        const wreck = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
        out.wreckM3 += wreck
        holdUsed += wreck
        pos = target.cell
        out.cellsExplored += 1
        worth.splice(bestIdx, 1)
        continue
      }

      turns -= need + revealCost
      out.turnsOnScan += revealCost
      out.turnsOnMove += need
      pos = target.cell
      out.cellsExplored += 1
      worth.splice(bestIdx, 1)

      if (target.place === 'matter') {
        out.matterDevices += 1
        continue
      }

      const extra = signalSpaceResourcePileBonus(depth)
      const piles = target.place === 'vein'
        ? WORMHOLE_VEIN_PILES_MIN + Math.floor(rng() * (WORMHOLE_VEIN_PILES_MAX - WORMHOLE_VEIN_PILES_MIN + 1)) + extra
        : target.place === 'graveyard'
          ? WORMHOLE_GRAVEYARD_COMMONS_MIN + Math.floor(rng() * (WORMHOLE_GRAVEYARD_COMMONS_MAX - WORMHOLE_GRAVEYARD_COMMONS_MIN + 1)) + extra
          : 2
      const rigs = target.place === 'vein' ? miners : target.place === 'graveyard' ? salvagers : 1
      const trips = Math.max(1, Math.ceil(piles / rigs))
      for (let t = 0; t < trips; t++) {
        if (turns <= EXTRACT_RESERVE_TURNS || (holdUsed >= holdM3 && target.place !== 'ruins')) break
        turns -= 1
        const batch = target.place === 'ruins' ? 1 : Math.min(rigs, piles - t * rigs)
        for (let p = 0; p < batch; p++) {
          if (target.place !== 'ruins' && holdUsed >= holdM3) break
          if (target.place === 'vein') {
            const units = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed) / oreUnitM3),
              Math.max(1, ceilFinalQuantity(WORMHOLE_PILE_UNITS_BASE * mul * (0.8 + rng() * 0.4) * tech.ore)))
            out.oreUnits += units
            holdUsed += units * oreUnitM3
          } else if (target.place === 'graveyard') {
            const m3 = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
            out.wreckM3 += m3
            holdUsed += m3
          } else {
            if (rng() < wormholeRelicChanceOf(depth)) out.rareItems += 1
            else if (depth >= 2) out.relicBoxes += 1
          }
        }
      }
    }

    if (holdUsed >= holdM3) {
      out.holdFull = true
      break
    }
    if (turns <= EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }

    const toExit = hexDistance(pos, grid.exit) * STEP_COST
    const guard = guardPowerOf(depth)
    const guardCost = wormholeStepCost(2, 0)
    if (turns - toExit - guardCost < EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }
    if (!canWin(power, guard)) {
      out.fightsAvoided += 1
      continue
    }
    turns -= toExit + guardCost
    out.fightsWon += 1
    out.depthReached = depth + 1
    const wreck = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
    out.wreckM3 += wreck
    holdUsed += wreck
  }

  return {
    depthReached: out.depthReached,
    cellsExplored: out.cellsExplored,
    fightsWon: out.fightsWon,
    fightsAvoided: out.fightsAvoided,
    wreckM3: ceilFinalQuantity(out.wreckM3 * yieldMul),
    oreUnits: ceilFinalQuantity(out.oreUnits * yieldMul),
    rareItems: out.rareItems * yieldMul,
    relicBoxes: out.relicBoxes * yieldMul,
    matterDevices: out.matterDevices * yieldMul,
    holdFull: out.holdFull,
    outOfTurns: out.outOfTurns,
    turnsOnScan: out.turnsOnScan,
    turnsOnMove: out.turnsOnMove,
  }
}

function pileM3(mul: number, rng: () => number, techWreck: number): number {
  return ceilFinalQuantity(WORMHOLE_WRECK_PILE_M3_BASE * mul * techWreck * (0.8 + rng() * 0.4))
}

function canWin(me: WormholeAutoPower, foe: WormholeAutoPower): boolean {
  const mine = me.dps * me.ehp
  const his = foe.dps * foe.ehp
  if (his <= 0) return true
  return mine / his >= 1.15
}

export function wormholeAutoLayerTally(
  seed: number,
  depth: number,
  blankShareFactor = 1,
): ReturnType<typeof gridTally> {
  return gridTally(wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0, blankShareFactor))
}

function mulberry(seed: number): () => number {
  let a = (seed | 0) >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function wormholeAutoNeighbors(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }))
}

export const wormholeAutoCellKey = hexKey

export const wormholeAutoRing = hexDiskAround
