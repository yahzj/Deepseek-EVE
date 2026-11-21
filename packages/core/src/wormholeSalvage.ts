import { ceilFinalQuantity } from './quantity'
import { encryptedBlueprintDraw, encryptedBlueprintGroups, encryptedFamilyOf } from './encryptedContainer'
import { signalSpaceResourcePileBonus } from './wormholeFoes'
import type { CommandResult } from './engine'
import { rareDropRateMulOf, tuningMul } from './tuning'
import type { GameState, RngState } from './state'
import { addLog } from './state'
import type { AnomalyDef, SimContext } from './types'
import { salvagerCyclesOf } from './salvaging'
import { RARE_BOX_DRONE_UNITS } from './salvage'
import { addWare } from './inventory'
import { nextInt, nextRandom } from './rng'
import { allFittedModules } from './equipment'
import { addModule } from './equipment'
import {
  RARE_WRECK_VOLUME_M3,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_YIELD_PER_M3,
  isRareWreck,
  rareWreckItemIdOf,
  recycleProfileOf,
  wreckGroupOfCard,
  wreckItemIdOf,
} from './salvage'
import type { WreckRegion } from './wreckGroups'
import {
  canPlace,
  cargoBlockArea,
  findCargoSpot,
  holdAdd,
  holdAddCargo,
  holdDropWithGrab,
  holdRemove,
  holdTransferTo,
  makeHoldState,
  WORMHOLE_CARGO_PIECE,
  wormholeShapeOf,
  placementCellsCount,
  placementInBounds,
  wormholeIsShapedItem,
} from './wormholeHold'
import type { WormholeHoldPlacement, WormholeHoldState } from './wormholeHold'
import { wormholeMatterBuffs, wormholeMatterDiscardHint } from './wormholeMatter'
import { wormholeSpawnAfterTurns } from './wormholeSpawn'
import { wormholePatrolAfterAction, wormholeRaiseAlert } from './wormholePatrol'
import { matterTechWhBuffs, matterTechWorkEffBonus } from './matterTech'
import {
  WORMHOLE_TURN_PER_WORK,
  gridCellAt,
  wormholeStream,
} from './wormholeGrid'
import type { WormholeCellPile, WormholeGridCell } from './wormholeGrid'
import {
  wormholeBagSlotsOfFleet,
  wormholeCardIdOfFamily,
  wormholeLayerRewardMul,
  wormholeNodePiles,
  mergeIntoBag,
  wormholeTrimBag,
  wormholeUnitsPerSlot,
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
  WORMHOLE_TEMP_ROWS,
  noCommonWreckSalvageOn,
  wormholePendingBattleReason,
  WORMHOLE_ORE_ITEM_ID,
} from './wormhole'
import type { WormholeBagSlot, WormholePile } from './wormhole'
import type { WormholeActivateEffect, WormholeRunState } from './wormhole'
import { wormholeSupplyCells } from './wormholeSupplies'
import { wormholeGroundAddShape, wormholeGroundAddCargo, wormholeGroundBoard } from './wormholeGround'


export const WORMHOLE_WRECK_PILE_M3_BASE = 200
export const WORMHOLE_GRAVEYARD_COMMONS_MIN = 3
export const WORMHOLE_GRAVEYARD_COMMONS_MAX = 10
export const WORMHOLE_RARE_JUDGE_PER_COMMONS = 3
export const WORMHOLE_RARE_JUDGE_CHANCE = 0.35
export const WORMHOLE_RUINS_RARES_MIN = 2
export const WORMHOLE_RUINS_RARES_MAX = 3
export const WORMHOLE_RELIC_MIN_DEPTH = 2
export const WORMHOLE_RELIC_BOX_CHANCE = 0.7
export const WORMHOLE_RELIC_VALUABLES_SHARE = 0.5
export const WORMHOLE_RELIC_VALUABLES_SHARE_DEEP = 0.25
export const WORMHOLE_RELIC_VALUABLES_CUT_DEPTH = 8
export function wormholeRelicValuablesShareOf(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return d >= WORMHOLE_RELIC_VALUABLES_CUT_DEPTH
    ? WORMHOLE_RELIC_VALUABLES_SHARE_DEEP
    : WORMHOLE_RELIC_VALUABLES_SHARE
}

export function wormholeRelicChanceOf(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return d < WORMHOLE_RELIC_MIN_DEPTH ? 0 : WORMHOLE_RELIC_BOX_CHANCE
}
export const WORMHOLE_RUINS_BATTLE_CHANCE = 0.7
export const WORMHOLE_SHIP_SPOIL_COMMONS = 2
export const WORMHOLE_SHIP_SPOIL_RARES = 1
export const WORMHOLE_VEIN_PILES_MIN = 1
export const WORMHOLE_VEIN_PILES_MAX = 3

export function wormholeRelicWeightsOf(depth: number): { modules: number; moduleBlueprints: number; shipBlueprints: number } {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_RELIC_MIN_DEPTH) return { modules: 0, moduleBlueprints: 0, shipBlueprints: 0 }
  if (d <= 4) return { modules: 60, moduleBlueprints: 25, shipBlueprints: 15 }
  if (d <= 6) return { modules: 45, moduleBlueprints: 30, shipBlueprints: 25 }
  return { modules: 30, moduleBlueprints: 35, shipBlueprints: 35 }
}


export const WORMHOLE_FAMILIES = ['A', 'C', 'D', 'E', 'G'] as const

export interface WormholeFamilyPool {
  modules: string[]
  moduleBlueprints: string[]
  shipBlueprints: string[]
  drones: string[]
}

export function wormholeFamilyPoolOf(ctx: SimContext, family: string): WormholeFamilyPool {
  const tag = `-wh-${family.toLowerCase()}-`
  const pick = (ids: Iterable<string>, head: string): string[] =>
    [...ids].filter((id) => id.startsWith(head) && id.includes(tag)).sort()
  return {
    modules: pick(ctx.modules.keys(), 'mod'),
    moduleBlueprints: pick(ctx.blueprints.keys(), 'bp'),
    shipBlueprints: pick(ctx.shipBlueprints.keys(), 'sbp'),
    drones: pick(ctx.items.keys(), 'drone'),
  }
}

export function wormholePoolGrantUnitsOf(itemId: string): number {
  return itemId.startsWith('drone-wh-') ? RARE_BOX_DRONE_UNITS : 1
}

export function wormholeFamilyPoolGaps(ctx: SimContext): string[] {
  const gaps: string[] = []
  for (const f of WORMHOLE_FAMILIES) {
    const p = wormholeFamilyPoolOf(ctx, f)
    if (p.modules.length === 0) gaps.push(`${f} 族没有专属装备`)
    if (p.moduleBlueprints.length === 0) gaps.push(`${f} 族没有专属装备图纸`)
    if (p.shipBlueprints.length === 0) gaps.push(`${f} 族没有专属舰船图纸`)
  }
  return gaps
}


export const WORMHOLE_DILUTION_SHARE = 0.3

export const WORMHOLE_DILUTION_MIN_DEPTH: Readonly<Record<3 | 4 | 5, number>> = { 3: 2, 4: 3, 5: 5 }
export const WORMHOLE_DILUTION_MIN_DEPTH_FLOOR = 2

export function wormholeLootShares(): { family: number; dilution: number } {
  return { family: 1 - WORMHOLE_DILUTION_SHARE, dilution: WORMHOLE_DILUTION_SHARE }
}

export function wormholeDilutionPoolOf(ctx: SimContext, depth: number): string[] {
  const d = Math.max(1, Math.floor(depth))
  const allowed = (Object.keys(WORMHOLE_DILUTION_MIN_DEPTH) as unknown as string[])
    .map((k) => Number(k) as 3 | 4 | 5)
    .filter((tier) => d >= WORMHOLE_DILUTION_MIN_DEPTH[tier])
  const out: string[] = []
  for (const id of ctx.shipBlueprints.keys()) {
    if (!id.startsWith('sbp-once-')) continue
    const bp = ctx.shipBlueprints.get(id)
    if (!bp || bp.singleUse !== true) continue
    const tier = ctx.ships.get(bp.shipId)?.tier
    if (tier === undefined || !allowed.includes(tier as 3 | 4 | 5)) continue
    out.push(id)
  }
  return out.sort()
}


export const WORMHOLE_BP_BOX_SHALLOW = 'box-bp-shallow'
export const WORMHOLE_BP_BOX_MID = 'box-bp-mid'
export const WORMHOLE_BP_BOX_DEEP = 'box-bp-deep'
export const WORMHOLE_BP_BOX_IDS = [WORMHOLE_BP_BOX_SHALLOW, WORMHOLE_BP_BOX_MID, WORMHOLE_BP_BOX_DEEP] as const
export const WORMHOLE_BP_BOX_DEPTH: Readonly<Record<string, number>> = {
  [WORMHOLE_BP_BOX_SHALLOW]: 2,
  [WORMHOLE_BP_BOX_MID]: 3,
  [WORMHOLE_BP_BOX_DEEP]: 5,
}
export const WORMHOLE_BP_BOX_MIN_DEPTH: Readonly<Record<string, number>> = {
  [WORMHOLE_BP_BOX_SHALLOW]: 1,
  [WORMHOLE_BP_BOX_MID]: 5,
  [WORMHOLE_BP_BOX_DEEP]: 7,
}
export function wormholeBpBoxIdsForDepth(depth: number): string[] {
  const d = Math.max(1, Math.floor(depth))
  return WORMHOLE_BP_BOX_IDS.filter((id) => d >= (WORMHOLE_BP_BOX_MIN_DEPTH[id] ?? 1))
}
export const WORMHOLE_ESSENCE_ITEM_ID = 'mat-wh-essence'
export const WORMHOLE_ESSENCE_PER_DEVICE = 1


export const WORMHOLE_VALUABLES_BOX_ID = 'box-valuables'
export const WORMHOLE_MILITARY_BOX_ID = 'box-military'
export const WORMHOLE_LUXURY_ITEM_IDS = [
  'lux-1',
  'lux-2',
  'lux-3',
  'lux-4',
  'lux-5',
  'lux-6',
  'lux-7',
  'lux-8',
  'lux-9',
  'lux-10',
] as const
export function wormholeRelicBoxPoolOf(ctx: SimContext, depth: number, family: string): string[] {
  const own = wormholeRelicBoxIdOf(family)
  const safe = ctx.items.has(own) ? [own] : []
  return [WORMHOLE_VALUABLES_BOX_ID, ...safe, ...wormholeBpBoxIdsForDepth(depth), WORMHOLE_MILITARY_BOX_ID]
}
export const WORMHOLE_VALUABLES_UNITS_MIN = 5
export const WORMHOLE_VALUABLES_UNITS_MAX = 30
export const WORMHOLE_MILITARY_PIECES_MIN = 1
export const WORMHOLE_MILITARY_PIECES_MAX = 3

export function wormholeMk3PoolOf(ctx: SimContext): string[] {
  const out: string[] = []
  for (const [id, def] of ctx.modules) {
    if (!id.endsWith('-3')) continue
    if (id.includes('-wh-') || id.startsWith('mod-lair-')) continue
    if (def.unreleased === true) continue
    out.push(id)
  }
  return out.sort()
}

export function wormholeRareBoxThemePoolOf(ctx: SimContext, region: WreckRegion): string[] {
  return region === 'wh' ? wormholeMk3PoolOf(ctx) : []
}

export function wormholeRareBoxThemeGroupsOf(
  ctx: SimContext,
  region: WreckRegion,
): Array<{ ids: string[]; weight: number }> {
  if (region !== 'wh') return []
  const poolOf = (suffix: string): string[] => {
    const out: string[] = []
    for (const [id, def] of ctx.modules) {
      if (!id.endsWith(suffix)) continue
      if (id.includes('-wh-') || id.startsWith('mod-lair-')) continue
      if (def.unreleased === true) continue
      out.push(id)
    }
    return out.sort()
  }
  return [
    { ids: poolOf('-2'), weight: 1 },
    { ids: poolOf('-3'), weight: 0.25 },
  ]
}

export const WORMHOLE_BPBOX_PERMANENT_CHANCE = 0.05
export const WORMHOLE_PERMANENT_MIN_DEPTH: Readonly<Record<3 | 4, number>> = { 3: 2, 4: 3 }

export function wormholeBpBoxIdOf(depth: number): string {
  const d = Math.max(1, Math.floor(depth))
  if (d <= 2) return WORMHOLE_BP_BOX_SHALLOW
  if (d <= 4) return WORMHOLE_BP_BOX_MID
  return WORMHOLE_BP_BOX_DEEP
}

export function wormholeBpBoxDepthOf(boxItemId: string): number | null {
  return WORMHOLE_BP_BOX_DEPTH[boxItemId] ?? null
}


export const WORMHOLE_CORE_GAMMA = 'ai-core-gamma'
export const WORMHOLE_CORE_BETA = 'ai-core-beta'
export const WORMHOLE_CORE_ALPHA = 'ai-core-alpha'
export const WORMHOLE_CORE_ITEM_IDS = [WORMHOLE_CORE_GAMMA, WORMHOLE_CORE_BETA, WORMHOLE_CORE_ALPHA] as const
export const WORMHOLE_CORE_TYPE: Readonly<Record<string, 'gamma' | 'beta' | 'alpha'>> = {
  [WORMHOLE_CORE_GAMMA]: 'gamma',
  [WORMHOLE_CORE_BETA]: 'beta',
  [WORMHOLE_CORE_ALPHA]: 'alpha',
}
export const WORMHOLE_CORE_SHARE = 0.1
export const WORMHOLE_CORE_WEIGHTS: Readonly<Record<'gamma' | 'beta' | 'alpha', number>> = {
  gamma: 60,
  beta: 30,
  alpha: 10,
}

export function wormholeCoreItemIdOf(type: 'gamma' | 'beta' | 'alpha'): string {
  return `ai-core-${type}`
}

export function wormholeCoreTypeOfItemId(itemId: string): 'gamma' | 'beta' | 'alpha' | null {
  return WORMHOLE_CORE_TYPE[itemId] ?? null
}

export function wormholeRollCore(state: GameState, cell: WormholeGridCell): string | undefined {
  const run = state.wormhole.run
  if (!run?.grid) return undefined
  const rng = wormholeStream(runSeedOf(state) * 71 + run.depth * 733 + (cell.q * 31 + cell.r * 37) * 17 + 13)
  if (rng() >= WORMHOLE_CORE_SHARE) return undefined
  const total = WORMHOLE_CORE_WEIGHTS.gamma + WORMHOLE_CORE_WEIGHTS.beta + WORMHOLE_CORE_WEIGHTS.alpha
  let pick = rng() * total
  for (const type of ['gamma', 'beta', 'alpha'] as const) {
    pick -= WORMHOLE_CORE_WEIGHTS[type]
    if (pick < 0) return wormholeCoreItemIdOf(type)
  }
  return WORMHOLE_CORE_GAMMA
}

export const WORMHOLE_SALVAGE_BOX_CHANCE = 0.05
export const WORMHOLE_LOOT_BOX_CHANCE = 0.05
export const WORMHOLE_SALVAGE_BOX_MAX = 1

export function wormholeSalvageBoxClassesOf(family: string, depth: number): readonly (readonly string[])[] {
  return [[wormholeRelicBoxIdOf(family)], wormholeBpBoxIdsForDepth(depth), ['box-valuables'], ['box-military']]
}

export function wormholeRollSalvageBox(
  state: GameState,
  ctx: SimContext,
  cell: WormholeGridCell,
  pilesLeft: number,
): string | undefined {
  const run = state.wormhole.run
  if (!run?.grid) return undefined
  if (cell.place !== 'graveyard') return undefined
  const rng = wormholeStream(
    runSeedOf(state) * 89 + run.depth * 811 + (cell.q * 29 + cell.r * 43) * 19 + Math.max(0, pilesLeft) * 7 + 23,
  )
  if (rng() >= WORMHOLE_SALVAGE_BOX_CHANCE) return undefined
  const family = familyOfCard(ctx, wormholeCellCardIdOf(run, cell))
  const classes = wormholeSalvageBoxClassesOf(family, run.depth)
  const cls = classes[Math.min(classes.length - 1, Math.floor(rng() * classes.length))]!
  return cls[Math.min(cls.length - 1, Math.floor(rng() * cls.length))]!
}

export function wormholePermanentPoolOf(ctx: SimContext, depth: number): string[] {
  const d = Math.max(1, Math.floor(depth))
  const out: string[] = []
  for (const id of ctx.shipBlueprints.keys()) {
    if (!id.startsWith('sbp-')) continue
    if (id.startsWith('sbp-once-') || id.startsWith('sbp-wh-')) continue
    const bp = ctx.shipBlueprints.get(id)
    if (!bp || bp.singleUse === true) continue
    const tier = ctx.ships.get(bp.shipId)?.tier
    if (tier !== 3 && tier !== 4) continue
    if (d < WORMHOLE_PERMANENT_MIN_DEPTH[tier]) continue
    out.push(id)
  }
  return out.sort()
}


export function wormholeSalvagersInFleet(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let n = 0
  for (const uid of shipIds) n += salvagerCyclesOf(state, ctx, uid).length
  return n
}

export function wormholeSalvagersOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  return wormholeSalvagersInFleet(state, ctx, run.fleet)
}

function runSeedOf(state: GameState): number {
  return state.wormhole.run?.seed ?? state.rng.seed
}

export function wormholeCellCardIdOf(run: WormholeRunState, cell: WormholeGridCell): string {
  void cell
  return wormholeCardIdOfFamily(run.family, run.seed)
}

export function familyOfCard(ctx: SimContext, cardId: string): string {
  const card: AnomalyDef | undefined = ctx.anomalies.get(cardId)
  const f = String(card?.foeFamily ?? 'A')
  return (WORMHOLE_FAMILIES as readonly string[]).includes(f) ? f : 'A'
}

function signalSpaceResourcePilesReady(run: WormholeRunState, cell: WormholeGridCell): boolean {
  if (cell.resourcePilesGenerated === true) return true
  const existing = cell.piles ?? []
  const hasOriginal = cell.place === 'vein'
    ? existing.some(p => p.itemId === WORMHOLE_ORE_ITEM_ID)
    : existing.length > 0
  if (run.grid?.activated.includes(cell.key) || hasOriginal) {
    cell.resourcePilesGenerated = true
    return true
  }
  return false
}

export function wormholeEnsureSalvagePiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if (cell.place !== 'graveyard' && cell.place !== 'ruins') return
  if (run.expeditionRules === undefined) {
    if (signalSpaceResourcePilesReady(run, cell)) return
  } else if ((cell.piles ?? []).length > 0) return
  if (grid.activated.includes(cell.key)) return
  const cardId = wormholeCellCardIdOf(run, cell)
  const group = wreckGroupOfCard(cardId)
  if (!group) return
  const common = wreckItemIdOf(group.key)
  const rare = rareWreckItemIdOf(group.key)
  const mul = wormholeLayerRewardMul(run.depth, run.expeditionRules)
  const rng = wormholeStream(runSeedOf(state) * 31 + run.depth * 7919 + (cell.q * 131 + cell.r * 17) * 7)
  const piles: WormholeCellPile[] = []
  if (cell.place === 'graveyard') {
    const span = WORMHOLE_GRAVEYARD_COMMONS_MAX - WORMHOLE_GRAVEYARD_COMMONS_MIN + 1
    const baseCommons = WORMHOLE_GRAVEYARD_COMMONS_MIN + Math.floor(rng() * span)
    const commons = baseCommons + signalSpaceResourcePileBonus(run.depth, run.expeditionRules)
    const rolls = Math.floor(baseCommons / WORMHOLE_RARE_JUDGE_PER_COMMONS)
    for (let i = 0; i < rolls; i++) {
      if (rng() < Math.min(1, WORMHOLE_RARE_JUDGE_CHANCE * rareDropRateMulOf(state))) piles.push({ itemId: rare, units: ceilFinalQuantity(RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume')) })
    }
    for (let i = 0; i < commons; i++) {
      piles.push({ itemId: common, units: Math.max(1, ceilFinalQuantity(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
    }
  } else {
    const span = WORMHOLE_RUINS_RARES_MAX - WORMHOLE_RUINS_RARES_MIN + 1
    const rares = WORMHOLE_RUINS_RARES_MIN + Math.floor(rng() * span)
    for (let i = 0; i < rares; i++) piles.push({ itemId: rare, units: ceilFinalQuantity(RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume')) })
  }
  cell.piles = [...piles, ...(cell.piles ?? [])]
  if (run.expeditionRules === undefined) cell.resourcePilesGenerated = true
}


export const WORMHOLE_RARE_CHEST_NOMINAL_ISK = 1_000_000

export function wormholeWreckRecycleIskPerM3(ctx: SimContext, itemId: string): number {
  const p = recycleProfileOf(ctx, itemId)
  if (!p) return 0
  return RECYCLE_YIELD_PER_M3[p.tier] * RECYCLE_POOL_AVG_ISK[p.tier]
}

export function wormholeLootValueIsk(
  ctx: SimContext,
  itemId: string,
  units: number,
  opts?: { rareChestNominal?: boolean },
): number {
  const n = Math.max(0, units)
  if (itemId.startsWith('wreck-')) {
    const base = n * wormholeWreckRecycleIskPerM3(ctx, itemId)
    return isRareWreck(itemId) && opts?.rareChestNominal === true ? base + WORMHOLE_RARE_CHEST_NOMINAL_ISK : base
  }
  return n * (ctx.items.get(itemId)?.baseSellPriceIsk ?? 0)
}

export function wormholeLootTierOf(itemId: string): 0 | 1 | 2 {
  if (isRareWreck(itemId)) return 2
  if (itemId.startsWith('wreck-')) return 0
  return 1
}


export function wormholeHoldCapacityOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  return Math.max(0, wormholeBagSlotsOfFleet(state, ctx, run.fleet) + wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx)).holdCells - wormholeSupplyCells(state, ctx))
}

export function wormholeCargoCellsOf(ctx: SimContext, itemId: string, units: number): number {
  const per = wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  return Math.max(1, Math.ceil(Math.max(0, units) / Math.max(1, per)))
}

export function wormholeCargoSlotsOf(ctx: SimContext, itemId: string, units: number): number {
  return cargoBlockArea(wormholeCargoCellsOf(ctx, itemId, units))
}

export function wormholeCargoPieceUnitsOf(ctx: SimContext, itemId: string, units: number): number[] {
  const per = Math.max(1, wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0))
  const total = Math.max(0, Math.floor(units))
  const out: number[] = []
  let left = total
  while (left > 0) {
    const take = Math.min(per, left)
    out.push(take)
    left -= take
  }
  return out
}

export function wormholeHoldSyncCargo(
  state: GameState,
  ctx: SimContext,
): { unplaced: string[]; moved: number } {
  const run = state.wormhole.run
  if (!run) return { unplaced: [], moved: 0 }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  run.hold = run.hold ?? makeHoldState()
  const hold = run.hold
  const temp = run.supplyVersion === 1 ? makeHoldState(WORMHOLE_TEMP_COLS) : (run.tempGrid = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS))
  const boards: Array<{ board: WormholeHoldState; capacity: number }> = [
    { board: hold, capacity },
    ...(run.supplyVersion === 1 ? [] : [{ board: temp, capacity: WORMHOLE_TEMP_CELLS }]),
  ]
  const unplaced: string[] = []
  let moved = 0
  const inBag = new Set(run.bag.map((s) => s.itemId))
  for (const { board } of boards) {
    board.placements = board.placements.filter((p) => p.kind !== 'cargo' || inBag.has(p.itemId))
  }
  for (const slot of run.bag) {
    const want = wormholeCargoPieceUnitsOf(ctx, slot.itemId, slot.units)
    const existing = boards.flatMap(({ board }) =>
      board.placements.filter((p) => p.kind === 'cargo' && p.itemId === slot.itemId).map((p) => ({ p, board })),
    )
    const spots = existing
      .map(({ p, board }) => ({ x: p.x, y: p.y, board }))
      .sort((a, b) => (a.board === b.board ? a.y - b.y || a.x - b.x : a.board === hold ? -1 : 1))
    for (const { board } of boards) {
      board.placements = board.placements.filter((q) => !(q.kind === 'cargo' && q.itemId === slot.itemId))
    }
    let kept = 0
    for (const units of want) {
      const id = `${slot.itemId}#${kept}`
      const prev = spots[kept]
      if (prev && canPlace(prev.board, prev.x, prev.y, WORMHOLE_CARGO_PIECE, prev.board === hold ? capacity : WORMHOLE_TEMP_CELLS)) {
        prev.board.placements.push({ id, itemId: slot.itemId, kind: 'cargo', units, x: prev.x, y: prev.y, w: 1, h: 1 })
        if (existing[kept]?.p.units !== units) moved += 1
        kept += 1
        continue
      }
      let placed: { x: number; y: number; board: WormholeHoldState } | null = null
      for (const { board, capacity: cap } of boards) {
        const spot = findCargoSpot(board, WORMHOLE_CARGO_PIECE, undefined, cap)
        if (spot) {
          placed = { x: spot.x, y: spot.y, board }
          break
        }
      }
      if (!placed) break
      placed.board.placements.push({ id, itemId: slot.itemId, kind: 'cargo', units, x: placed.x, y: placed.y, w: 1, h: 1 })
      moved += 1
      kept += 1
    }
    if (kept < want.length) unplaced.push(slot.itemId)
  }
  return { unplaced, moved }
}

export function wormholeHoldUsage(
  state: GameState,
  ctx: SimContext,
): {
  used: number
  capacity: number
  cargoCells: number
  shapeCells: number
  unplacedCells: number
  overload: boolean
} {
  const run = state.wormhole.run
  if (!run) return { used: 0, capacity: 0, cargoCells: 0, shapeCells: 0, unplacedCells: 0, overload: false }
  const runCapacity = wormholeBagSlotsOfFleet(state, ctx, run.fleet) + wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx)).holdCells
  const supplyCells = wormholeSupplyCells(state, ctx)
  const capacity = runCapacity
  let cargoCells = 0
  let shapeCells = 0
  for (const p of run.hold?.placements ?? []) {
    if (p.kind === 'cargo') cargoCells += placementCellsCount(p)
    else shapeCells += placementCellsCount(p)
  }
  let unplacedCells = 0
  const cargoBoards = run.supplyVersion === 1 ? [run.hold] : [run.hold, run.tempGrid]
  for (const slot of run.bag) {
    const want = wormholeCargoPieceUnitsOf(ctx, slot.itemId, slot.units).length
    let haveCells = 0
    for (const board of cargoBoards) {
      haveCells += (board?.placements ?? [])
        .filter((p) => p.kind === 'cargo' && p.itemId === slot.itemId)
        .reduce((n, p) => n + placementCellsCount(p), 0)
    }
    unplacedCells += Math.max(0, want - haveCells)
  }
  const used = cargoCells + shapeCells + unplacedCells + supplyCells
  return { used, capacity, cargoCells, shapeCells, unplacedCells, overload: used > capacity }
}

export function wormholeHoldOverloaded(state: GameState, ctx: SimContext): boolean {
  return wormholeHoldUsage(state, ctx).overload
}



export function wormholeTempBoard(run: WormholeRunState): WormholeHoldState {
  if (run.supplyVersion === 1) return wormholeGroundBoard(run, true) ?? makeHoldState(WORMHOLE_TEMP_COLS)
  return (run.tempGrid = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS))
}

export function wormholeTempUsage(
  state: GameState,
  ctx: SimContext,
): { cells: number; capacity: number; placements: WormholeHoldPlacement[]; full: boolean } {
  void ctx
  const run = state.wormhole.run
  const placements = run?.supplyVersion === 1 ? wormholeGroundBoard(run)?.placements ?? [] : run?.tempGrid?.placements ?? []
  let cells = 0
  for (const p of placements) cells += placementCellsCount(p)
  return { cells, capacity: WORMHOLE_TEMP_CELLS, placements, full: cells >= WORMHOLE_TEMP_CELLS }
}

export function wormholeTempPending(
  state: GameState,
  ctx: SimContext,
): { count: number; cells: number; placements: WormholeHoldPlacement[] } {
  const u = wormholeTempUsage(state, ctx)
  return { count: u.placements.length, cells: u.cells, placements: u.placements }
}

export function wormholeTempAddShape(
  state: GameState,
  ctx: SimContext,
  itemId: string,
): {
  ok: boolean
  cells?: number
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
} {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormhole.003' }
  if (!wormholeIsShapedItem(itemId)) return { ok: false, error: '这件东西不是形状件。', errorId: 'core.wormholeSalvage.001' }
  if (run.supplyVersion === 1) {
    const shape = wormholeShapeOf(itemId)
    return { ok: wormholeGroundAddShape(run, itemId), cells: shape.w * shape.h }
  }
  const board = wormholeTempBoard(run)
  const r = holdAdd(board, itemId, WORMHOLE_TEMP_CELLS)
  if (!r.ok) {
    const shape = wormholeShapeOf(itemId)
    const cur = wormholeTempUsage(state, ctx)
    return {
      ok: false,
      error: `临时空间也放不下（${cur.cells}/${cur.capacity} 格，这件要 ${shape.w * shape.h} 格）。`,
        errorId: 'core.wormholeSalvage.002',
        errorParams: { p1: cur.cells, p2: cur.capacity, p3: shape.w * shape.h },
    }
  }
  const need = wormholeShapeOf(itemId).w * wormholeShapeOf(itemId).h
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'salvage',
    `🕳 放进临时空间：${name}（占 ${need} 格）——到「货仓」页整理进货仓或丢弃（离开货仓页前必须处理）。`,
    'core.wormholeSalvage.046',
    { p1: name, p2: need },
  )
  return { ok: true, cells: need }
}

export function wormholeTempStowPiece(
  state: GameState,
  ctx: SimContext,
  id: string,
  x?: number,
  y?: number,
  grab?: { dx: number; dy: number },
): CommandResult {
  const run = state.wormhole.run
  if (run?.supplyVersion === 1 && (run.battle || wormholePendingBattleReason(state))) return { ok: false, errorId: 'core.wormhole.035' }
  const temp = run?.supplyVersion === 1 ? wormholeGroundBoard(run) : run?.tempGrid
  if (!run || !temp) return { ok: false, error: '临时空间是空的。', errorId: 'core.wormholeSalvage.003' }
  const p = temp.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '临时空间里没有这件东西。', errorId: 'core.wormholeSalvage.004' }
  run.hold = run.hold ?? makeHoldState()
  const capacity = wormholeHoldCapacityOf(state, ctx)
  if (p.kind === 'box') {
    const before = wormholeHoldUsage(state, ctx)
    const need = placementCellsCount(p)
    if (before.used + need - before.unplacedCells > before.capacity && before.used + need > before.capacity) {
      return {
        ok: false,
        error: `货仓放不下：这件要占 ${need} 格（现在 ${before.used}/${before.capacity} 格）。`,
        errorId: 'core.wormholeSalvage.005',
        errorParams: { p1: need, p2: before.used, p3: before.capacity },
      }
    }
  }
  if (run.supplyVersion === 1 && p.kind === 'cargo') {
    const kind = ctx.items.get(p.itemId)?.kind
    if ((p.supply || kind === 'ammo' || kind === 'kit' || kind === 'drone') && run.supplies) {
      const n = p.units ?? 0
      const previous = { ...run.supplies.items }
      run.supplies.items[p.itemId] = (run.supplies.items[p.itemId] ?? 0) + n
      const geometryInvalid = run.hold.placements.some((piece) => !placementInBounds(piece.x, piece.y, piece, wormholeHoldCapacityOf(state, ctx), run.hold!.cols, piece.fill))
      if (wormholeHoldUsage(state, ctx).overload || geometryInvalid) {
        run.supplies.items = previous
        return { ok: false, errorId: 'core.wormholeHold.010' }
      }
      if (p.supply) {
        const left = (run.supplies.leftBehind[p.itemId] ?? 0) - n
        if (left > 0) run.supplies.leftBehind[p.itemId] = left
        else delete run.supplies.leftBehind[p.itemId]
      } else run.supplies.found[p.itemId] = (run.supplies.found[p.itemId] ?? 0) + n
      holdRemove(temp, id)
      return { ok: true }
    }
    const before = run.bag.map((s) => ({ ...s }))
    const holdBefore = structuredClone(run.hold)
    const tempBefore = structuredClone(temp)
    if (x !== undefined && y !== undefined && !holdTransferTo(temp, run.hold, id, capacity, x, y, grab).ok) return { ok: false, errorId: 'core.wormholeHold.010' }
    run.bag = mergeIntoBag(run.bag, { itemId: p.itemId, units: p.units ?? 0 })
    if (wormholeHoldSyncCargo(state, ctx).unplaced.length > 0) {
      run.bag = before
      run.hold = holdBefore
      temp.placements = tempBefore.placements
      return { ok: false, errorId: 'core.wormholeHold.010' }
    }
    holdRemove(temp, id)
    return { ok: true }
  }
  const r = holdTransferTo(temp, run.hold, id, capacity, x, y, grab)
  if (!r.ok) return { ok: false, error: r.error }
  wormholeSyncMatterTurns(state, ctx)
  if (run.supplyVersion === 1) return { ok: true }
  const name = ctx.items.get(p.itemId)?.name ?? p.itemId
  addLog(state, 'salvage', `🕳 整理：${name} 从临时空间进货仓。`, 'core.wormholeSalvage.023', { p1: name })
  return { ok: true }
}

export function wormholeTempDiscardPiece(
  state: GameState,
  ctx: SimContext,
  id: string,
): CommandResult {
  const run = state.wormhole.run
  if (run?.supplyVersion === 1 && (run.battle || wormholePendingBattleReason(state))) return { ok: false, errorId: 'core.wormhole.035' }
  const temp = run?.supplyVersion === 1 ? wormholeGroundBoard(run) : run?.tempGrid
  if (!run || !temp) return { ok: false, error: '临时空间是空的。', errorId: 'core.wormholeSalvage.003' }
  const p = temp.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '临时空间里没有这件东西。', errorId: 'core.wormholeSalvage.004' }
  temp.placements = temp.placements.filter((q) => q.id !== id)
  if (p.kind === 'cargo' && run.supplyVersion !== 1) {
    const cut = Math.max(1, Math.floor(p.units ?? 0))
    const slot = run.bag.find((s) => s.itemId === p.itemId)
    if (slot) {
      slot.units = Math.max(0, slot.units - cut)
      if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== p.itemId)
    }
  }
  wormholeSyncMatterTurns(state, ctx)
  if (run.supplyVersion === 1) return { ok: true }
  const name = ctx.items.get(p.itemId)?.name ?? p.itemId
  addLog(state, 'warn', `🕳 丢弃（临时空间）：${name}${(p.units ?? 0) > 1 ? `×${Math.floor(p.units ?? 0)}` : ''}。`, 'core.wormholeSalvage.024', { p1: `${name}${(p.units ?? 0) > 1 ? `×${Math.floor(p.units ?? 0)}` : ''}` })
  return { ok: true }
}

export function wormholeTempStowAll(state: GameState, ctx: SimContext): { moved: number; stuck: string[] } {
  const run = state.wormhole.run
  const stuck: string[] = []
  let moved = 0
  for (const p of [...(run ? wormholeTempPending(state, ctx).placements : [])]) {
    const r = wormholeTempStowPiece(state, ctx, p.id)
    if (r.ok) moved += 1
    else stuck.push(p.id)
  }
  return { moved, stuck }
}

export function wormholeTempDiscardAll(state: GameState, ctx: SimContext): { moved: number } {
  const run = state.wormhole.run
  let moved = 0
  for (const p of [...(run ? wormholeTempPending(state, ctx).placements : [])]) {
    const r = wormholeTempDiscardPiece(state, ctx, p.id)
    if (r.ok) moved += 1
  }
  return { moved }
}

export function wormholeNormalizeLegacyTemp(
  state: GameState,
  ctx: SimContext,
): { moved: number } {
  const run = state.wormhole.run
  if (!run?.temp?.length) {
    if (run) run.temp = undefined
    return { moved: 0 }
  }
  const legacy = [...run.temp]
  run.temp = undefined
  const board = wormholeTempBoard(run)
  let moved = 0
  for (const slot of legacy) {
    if (wormholeIsShapedItem(slot.itemId)) {
      if (holdAdd(board, slot.itemId, WORMHOLE_TEMP_CELLS).ok) moved += 1
      continue
    }
    const hit = run.bag.find((s) => s.itemId === slot.itemId)
    if (hit) hit.units += slot.units
    else run.bag.push({ itemId: slot.itemId, units: slot.units })
    moved += 1
  }
  wormholeHoldSyncCargo(state, ctx)
  return { moved }
}

export function wormholeStowOrTemp(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  units = 1,
): CommandResult & { where?: 'hold' | 'temp' } {
  if (state.wormhole.run?.supplyVersion === 1) {
    if (!Number.isSafeInteger(units) || units <= 0 || !ctx.items.has(itemId)) return { ok: false }
    if (wormholeIsShapedItem(itemId) && units !== 1) return { ok: false }
  }
  if (wormholeIsShapedItem(itemId)) {
    const stowed = wormholeHoldStow(state, ctx, itemId)
    if (stowed.ok) {
      wormholeSyncMatterTurns(state, ctx)
      return { ok: true, where: 'hold' }
    }
    const temp = wormholeTempAddShape(state, ctx, itemId)
    if (temp.ok) return { ok: true, where: 'temp' }
    return { ok: false, error: `${stowed.error ?? '货仓放不下'} ${temp.error ?? ''}`.trim() }
  }
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormhole.003' }
  if (run.supplyVersion === 1) {
    const kind = ctx.items.get(itemId)?.kind
    if (kind === 'ammo' || kind === 'kit' || kind === 'drone') {
      const board = wormholeGroundBoard(run, true)
      const existing = new Set(board?.placements.map((p) => p.id))
      if (!wormholeGroundAddCargo(run, ctx, itemId, units)) return { ok: false }
      const pieces = wormholeGroundBoard(run)!.placements.filter((p) => !existing.has(p.id))
      let pending = false
      for (const piece of pieces) if (!wormholeTempStowPiece(state, ctx, piece.id).ok) pending = true
      return { ok: true, where: pending ? 'temp' : 'hold' }
    }
  }
  const groundCount = wormholeGroundBoard(run)?.placements.length ?? 0
  if (tryMergeIntoBag(state, ctx, run, { itemId, units })) {
    const landedOnGround = (wormholeGroundBoard(run)?.placements.length ?? 0) > groundCount
    return { ok: true, where: landedOnGround ? 'temp' : 'hold' }
  }
  return { ok: false, error: '货仓与临时空间都放不下（先整理或丢弃腾位置）。', errorId: 'core.wormholeSalvage.006' }
}

export function wormholeHoldStow(
  state: GameState,
  ctx: SimContext,
  itemId: string,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  placementId?: string
} {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormhole.003' }
  if (!wormholeIsShapedItem(itemId)) return { ok: false, error: '这件东西不占形状格。', errorId: 'core.wormholeSalvage.007' }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  run.hold = run.hold ?? makeHoldState()
  const shape = wormholeShapeOf(itemId)
  const before = wormholeHoldUsage(state, ctx)
  if (before.used + shape.w * shape.h > before.capacity) {
    const left = Math.max(0, before.capacity - before.used)
    return {
      ok: false,
      error: `货仓只剩 ${left} 格，装不下这件（${shape.w}×${shape.h} = ${shape.w * shape.h} 格）。`,
      errorId: 'core.wormholeSalvage.008',
      errorParams: { p1: left, p2: shape.w, p3: shape.h, p4: shape.w * shape.h },
    }
  }
  const r = holdAdd(run.hold, itemId, capacity)
  if (!r.ok) return { ok: false, error: r.error }
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'salvage',
    `🕳 装舱：${name}（占 ${r.placement!.w}×${r.placement!.h} 格）· 货仓 ${wormholeHoldUsage(state, ctx).used}/${capacity} 格。`,
    'core.wormholeSalvage.047',
    {
      p1: name,
      p2: r.placement!.w,
      p3: r.placement!.h,
      p4: wormholeHoldUsage(state, ctx).used,
      p5: capacity,
    },
  )
  return { ok: true, placementId: r.placement!.id }
}

export function wormholeHoldDiscard(
  state: GameState,
  ctx: SimContext,
  placementId: string,
  units?: number,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>>; dropped?: number } {
  const run = state.wormhole.run
  if (!run?.hold) return { ok: false, error: '货仓里没有可抛弃的件。', errorId: 'core.wormholeSalvage.009' }
  const target = run.hold.placements.find((p) => p.id === placementId)
  if (!target) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeSalvage.038' }
  const name = ctx.items.get(target.itemId)?.name ?? target.itemId
  if (target.kind === 'box' || units === undefined) {
    const gone = holdRemove(run.hold, placementId)
    if (!gone) return { ok: false, error: '没有这个件。', errorId: 'core.wormholeSalvage.038' }
    wormholeSyncMatterTurns(state, ctx)
    const hint = wormholeMatterDiscardHint(gone.itemId)
    if (hint) addLog(state, 'warn', `🕳 ${hint}`)
    if (gone.kind === 'cargo') {
      const slot = run.bag.find((s) => s.itemId === gone.itemId)
      if (slot) {
        slot.units -= gone.units ?? 0
        if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== gone.itemId)
      }
      wormholeHoldSyncCargo(state, ctx)
    }
    addLog(
      state,
      'warn',
      `🕳 抛弃：${name}${gone.kind === 'cargo' ? ` ×${Math.floor(gone.units ?? 0)}` : ''}` +
        `（货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格）。`,
    )
    return { ok: true, dropped: Math.floor(gone.units ?? 0) }
  }
  const have = Math.max(0, Math.floor(target.units ?? 0))
  const cut = Math.max(1, Math.min(have, Math.floor(units)))
  target.units = have - cut
  const slot = run.bag.find((s) => s.itemId === target.itemId)
  if (slot) {
    slot.units -= cut
    if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== target.itemId)
  }
  if ((target.units ?? 0) <= 0) holdRemove(run.hold, placementId)
  wormholeHoldSyncCargo(state, ctx)
  wormholeSyncMatterTurns(state, ctx)
  addLog(
    state,
    'warn',
    `🕳 抛弃：${name} ×${cut.toLocaleString('zh-CN')}（这一件还剩 ${Math.max(0, target.units ?? 0).toLocaleString('zh-CN')}）·` +
      ` 货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格。`,
  )
  return { ok: true, dropped: cut }
}

export function wormholeDiscardCargo(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  units?: number,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>>; dropped?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormhole.003' }
  const slot = run.bag.find((s) => s.itemId === itemId)
  if (!slot) return { ok: false, error: '货仓里没有这种货。', errorId: 'core.wormholeSalvage.010' }
  const cut = Math.max(1, Math.min(slot.units, Math.floor(units ?? slot.units)))
  slot.units -= cut
  if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== itemId)
  wormholeHoldSyncCargo(state, ctx)
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'warn',
    `🕳 抛弃：${name} ×${cut}（货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格）。`,
    'core.wormholeSalvage.048',
    {
      p1: name,
      p2: cut,
      p3: wormholeHoldUsage(state, ctx).used,
      p4: wormholeHoldCapacityOf(state, ctx),
    },
  )
  return { ok: true, dropped: cut }
}

export function wormholeOverloadBlockReason(state: GameState, ctx: SimContext): string | null {
  const u = wormholeHoldUsage(state, ctx)
  if (!u.overload) return null
  return `货仓超载（${u.used}/${u.capacity} 格）：先抛货再继续（货仓页可以抛弃）。`
}

export function wormholeTempBlockReason(state: GameState, ctx: SimContext): string | null {
  if (state.wormhole.run?.supplyVersion === 1) return null
  const pending = wormholeTempPending(state, ctx)
  if (pending.count <= 0) return null
  return (
    `临时空间里有 ${pending.count} 件没处理（${pending.cells}/${WORMHOLE_TEMP_CELLS} 格）：` +
    `先到「货仓」页把它们放回货仓或丢弃，再继续。`
  )
}

export function wormholeActionBlockReason(state: GameState, ctx: SimContext): string | null {
  if (state.departure?.kind === 'wormhole') return '正在离港'
  return wormholeTempBlockReason(state, ctx) ?? wormholeOverloadBlockReason(state, ctx)
}

export function wormholeDiscardToFit(state: GameState, ctx: SimContext): { ok: boolean; dropped: WormholeBagSlot[] } {
  const run = state.wormhole.run
  if (!run) return { ok: false, dropped: [] }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  const shapeCells = wormholeHoldUsage(state, ctx).shapeCells
  const cargoCap = Math.max(0, capacity - shapeCells)
  const trimmed = wormholeTrimBag(ctx, run.bag, cargoCap, (slot) => {
    const def = ctx.items.get(slot.itemId)
    const per = Math.max(1, wormholeUnitsPerSlot(def?.unitM3 ?? 0))
    return {
      tier: wormholeLootTierOf(slot.itemId),
      iskPerSlot: wormholeLootValueIsk(ctx, slot.itemId, per, { rareChestNominal: true }),
    }
  })
  if (trimmed.dropped.length === 0) return { ok: false, dropped: [] }
  run.bag = trimmed.bag
  wormholeHoldSyncCargo(state, ctx)
  const names = trimmed.dropped
    .map((s) => `${ctx.items.get(s.itemId)?.name ?? s.itemId}×${Math.floor(s.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(state, 'warn', `🕳 抛货（按每格价值从低到高）：${names}。`, 'core.wormholeSalvage.025', { p1: names })
  return { ok: true, dropped: trimmed.dropped }
}
export function wormholeTakePileAt(
  state: GameState,
  ctx: SimContext,
  pileIndex: number,
): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>>; taken?: WormholePile; used?: number; capacity?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormhole.003' }
  const blocked = wormholeActionBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const grid = run.grid
  const holder: { piles?: WormholePile[] } | undefined = grid
    ? gridCellAt(grid, grid.pos)
    : (run.pendingNode ?? undefined)
  const pile = holder?.piles?.[pileIndex]
  if (!pile) return { ok: false, error: '这里没有可拾取的东西。', errorId: 'core.wormholeSalvage.011' }
  if (wormholeIsShapedItem(pile.itemId)) {
    const landed = wormholeStowOrTemp(state, ctx, pile.itemId, pile.units)
    if (!landed.ok) return { ok: false, error: landed.error }
    holder!.piles!.splice(pileIndex, 1)
    const u = wormholeHoldUsage(state, ctx)
    return { ok: true, taken: pile, used: u.used, capacity: u.capacity }
  }
  if (grid) {
    return { ok: false, error: '网格层不能逐堆拾取：残骸用「打捞」、母矿用「采集」（都要对应装备）。', errorId: 'core.wormholeSalvage.012' }
  }
  if (!tryMergeIntoBag(state, ctx, run, pile)) {
    const cap = wormholeHoldCapacityOf(state, ctx)
    const used = wormholeHoldUsage(state, ctx).used
    return { ok: false, error: `货仓放不下：已占 ${used} / 共 ${cap} 格。`, errorId: 'core.wormholeSalvage.013', errorParams: { p1: used, p2: cap } }
  }
  holder!.piles!.splice(pileIndex, 1)
  const u = wormholeHoldUsage(state, ctx)
  const name = ctx.items.get(pile.itemId)?.name ?? pile.itemId
  addLog(state, 'salvage', `🕳 拾取：${name} ×${pile.units}（货仓 ${u.used}/${u.capacity} 格）。`, 'core.wormholeSalvage.026', { p1: name, p2: pile.units, p3: u.used, p4: u.capacity })
  return { ok: true, taken: pile, used: u.used, capacity: u.capacity }
}

export function wormholeWorkEfficiencyOf(
  state: GameState,
  ctx: SimContext,
  kind: 'salvager' | 'miner',
): number {
  const run = state.wormhole.run
  if (!run) return 0
  return wormholeWorkEfficiencyOfFleet(state, ctx, run.fleet, kind)
}

export function wormholeWorkEfficiencyOfFleet(
  state: GameState,
  ctx: SimContext,
  fleet: readonly string[],
  kind: 'salvager' | 'miner',
): number {
  let sum = 0
  for (const uid of fleet) {
    const ship = state.fleet[uid]
    if (!ship) continue
    for (const m of allFittedModules(ship.fitted, ctx)) {
      if (m.slot !== kind) continue
      sum += m.workEfficiency ?? 0
    }
  }
  return sum + matterTechWorkEffBonus(state, ctx, kind === 'salvager' ? 'salvage' : 'collect')
}

function workExtraPiles(state: GameState, eff: number, cellKey: string, depth: number): number {
  if (!(eff > 0)) return 0
  const whole = Math.floor(eff)
  const frac = eff - whole
  if (frac <= 0) return whole
  let h = Math.imul(runSeedOf(state) | 0, 2654435761) ^ Math.imul(depth | 0, 40503)
  h = Math.imul(h ^ ((state.wormhole.run?.turnsLeft ?? 0) | 0), 16777619) >>> 0
  for (let i = 0; i < cellKey.length; i++) h = Math.imul(h ^ cellKey.charCodeAt(i), 16777619) >>> 0
  return whole + ((h % 10_000) / 10_000 < frac ? 1 : 0)
}
export function wormholeMinersInFleet(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let n = 0
  for (const uid of shipIds) {
    const ship = state.fleet[uid]
    if (!ship) continue
    n += allFittedModules(ship.fitted, ctx).filter((m) => m.slot === 'miner').length
  }
  return n
}

export function wormholeMinersOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  return wormholeMinersInFleet(state, ctx, run.fleet)
}

export function wormholeEnsureArrivalPiles(state: GameState, ctx: SimContext): void {
  void ctx
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return
  if (cell.place === 'graveyard' || cell.place === 'ruins') wormholeEnsureSalvagePiles(state, cell)
  else if (cell.place === 'vein') wormholeEnsureVeinPiles(state, cell)
}

export interface WormholeCollectResult {
  ok: boolean
  code?: 'unsupported-rules'
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  spent?: number
  taken?: WormholeCellPile[]
  left?: number
  finished?: boolean
  mustExtract?: boolean
}

export function wormholeCollectOreAt(state: GameState, ctx: SimContext): WormholeCollectResult {
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const grid = run?.grid
  if (!run || !grid) return { ok: false, error: '本层没有网格：无法采集。', errorId: 'core.wormholeSalvage.014' }
  if (run.battle) return { ok: false, error: '战斗中：先打完这一场。', errorId: 'core.wormholeSalvage.016' }
  const blocked = wormholeActionBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。', errorId: 'core.wormhole.018' }
  if (cell.place !== 'vein') return { ok: false, error: '这个地点没有可采集的矿脉。', errorId: 'core.wormholeSalvage.017' }
  const baseMiners = wormholeMinersOf(state, ctx)
  if (baseMiners <= 0) return { ok: false, error: '编队里没有采集器：矿脉挖不动（至少装 1 台）。', errorId: 'core.wormholeSalvage.019' }
  const miners = baseMiners + wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx)).collectPiles
  const collectEff = wormholeWorkEfficiencyOf(state, ctx, 'miner')
  const minersWant = miners + workExtraPiles(state, collectEff, cell.key, run.depth)
  wormholeEnsureVeinPiles(state, cell)
  const piles = cell.piles ?? []
  const mineable = (p: WormholeCellPile): boolean => run.expeditionRules !== undefined || p.itemId === WORMHOLE_ORE_ITEM_ID
  const oreLeft = (): number => piles.filter(mineable).length
  if (oreLeft() === 0) return { ok: false, error: '这条矿脉已经采空了。', errorId: 'core.wormholeSalvage.021' }
  if (run.turnsLeft < WORMHOLE_TURN_PER_WORK) return { ok: false, error: '回合不足：只能撤离。', errorId: 'core.wormhole.002', mustExtract: true }
  run.turnsLeft -= WORMHOLE_TURN_PER_WORK
  wormholeSpawnAfterTurns(state, WORMHOLE_TURN_PER_WORK)
  const taken: WormholeCellPile[] = []
  let full = false
  for (let i = 0; i < minersWant; i++) {
    const index = piles.findIndex(mineable)
    if (index < 0) break
    const pile = piles[index]!
    if (!tryMergeIntoBag(state, ctx, run, pile)) {
      full = true
      break
    }
    piles.splice(index, 1)
    taken.push(pile)
  }
  const names = taken
    .map((p) => `${ctx.items.get(p.itemId)?.name ?? p.itemId}×${Math.floor(p.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(
    state,
    'salvage',
    `🕳 采集（${miners} 台采集器）：回收 ${taken.length} 堆${names.length > 0 ? `——${names}` : ''}` +
      ` · 剩 ${oreLeft()} 堆 · 剩 ${run.turnsLeft} 回合。`,
  )
  if (full) addLog(state, 'warn', `🕳 货仓放不下：这一批只回收了 ${taken.length} 堆，剩下的仍留在原处。`, 'core.wormholeSalvage.027', { p1: taken.length })
  const finished = oreLeft() === 0
  if (finished && !grid.activated.includes(cell.key)) grid.activated.push(cell.key)
  wormholePatrolAfterAction(state)
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_WORK,
    taken,
    left: oreLeft(),
    finished,
    mustExtract: run.turnsLeft <= 0,
  }
}

export interface WormholeSalvageResult {
  ok: boolean
  code?: 'unsupported-rules'
  alarm?: { alertLevel: number }
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  spent?: number
  taken?: WormholeCellPile[]
  left?: number
  finished?: boolean
  relics?: string[]
  boxes?: string[]
  cores?: string[]
  effect?: WormholeActivateEffect
  mustExtract?: boolean
}

function tryMergeIntoBag(state: GameState, ctx: SimContext, run: WormholeRunState, pile: WormholeCellPile): boolean {
  const before = run.bag.map((s) => ({ ...s }))
  const holdBefore = run.supplyVersion === 1 ? structuredClone(run.hold) : undefined
  run.bag = mergeIntoBag(run.bag, pile)
  const sync = wormholeHoldSyncCargo(state, ctx)
  if (sync.unplaced.length > 0) {
    run.bag = before
    if (run.supplyVersion === 1) {
      run.hold = holdBefore
      return wormholeGroundAddCargo(run, ctx, pile.itemId, pile.units)
    }
    wormholeHoldSyncCargo(state, ctx)
    return false
  }
  return true
}

export function wormholeLeaveHoldPiece(
  state: GameState, ctx: SimContext, id: string,
  x?: number, y?: number, grab?: { dx: number; dy: number },
): { ok: boolean } {
  const run = state.wormhole.run
  if (run?.supplyVersion !== 1 || run.battle || wormholePendingBattleReason(state)) return { ok: false }
  const piece = run.hold?.placements.find((p) => p.id === id)
  if (!piece) return { ok: false }
  const ground = structuredClone(wormholeGroundBoard(run) ?? makeHoldState(WORMHOLE_TEMP_COLS))
  const capacity = ground.cols * (Math.max(WORMHOLE_TEMP_ROWS, ...ground.placements.map((p) => p.y + p.h)) + piece.h + 2)
  if (piece.kind === 'box') {
    if (!holdTransferTo(run.hold!, ground, id, capacity, x, y, grab).ok) return { ok: false }
  } else {
    const added = holdAddCargo(ground, piece.itemId, piece.units ?? 0, placementCellsCount(piece), capacity)
    if (!added.ok || !added.placement) return { ok: false }
    if (x !== undefined && y !== undefined && !holdDropWithGrab(ground, added.placement.id, x, y, capacity, grab ?? { dx: 0, dy: 0 }).ok) return { ok: false }
    holdRemove(run.hold!, id)
  }
  wormholeGroundBoard(run, true)!.placements = ground.placements
  if (piece.kind === 'cargo') {
    const slot = run.bag.find((s) => s.itemId === piece.itemId)
    if (slot) {
      slot.units -= piece.units ?? 0
      if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== piece.itemId)
    }
  }
  wormholeSyncMatterTurns(state, ctx)
  return { ok: true }
}

export function wormholeLeaveSupply(state: GameState, ctx: SimContext, id: string, count: number): { ok: boolean } {
  const run = state.wormhole.run
  const supplies = run?.supplies
  if (run?.supplyVersion !== 1 || run.battle || wormholePendingBattleReason(state) || !supplies || !Number.isSafeInteger(count) || count <= 0 || (supplies.items[id] ?? 0) < count) return { ok: false }
  if (!wormholeGroundAddCargo(run, ctx, id, count, true)) return { ok: false }
  const left = supplies.items[id]! - count
  if (left > 0) supplies.items[id] = left
  else delete supplies.items[id]
  supplies.leftBehind[id] = (supplies.leftBehind[id] ?? 0) + count
  return { ok: true }
}

export function wormholeSalvageAt(state: GameState, ctx: SimContext): WormholeSalvageResult {
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const grid = run?.grid
  if (!run || !grid) return { ok: false, error: '本层没有网格：无法打捞。', errorId: 'core.wormholeSalvage.015' }
  if (run.battle) return { ok: false, error: '战斗中：先打完这一场。', errorId: 'core.wormholeSalvage.016' }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。', errorId: 'core.wormhole.018' }
  if (cell.place === 'research' && grid.activated.includes(cell.key)
    && !(cell.piles ?? []).some(p => !wormholeIsShapedItem(p.itemId))) return { ok: false, errorId: 'core.wormholeSalvage.022' }
  if (cell.place === 'research' && !grid.activated.includes(cell.key)) {
    const blocked = wormholeActionBlockReason(state, ctx)
    if (blocked) return { ok: false, error: blocked }
    if (wormholeSalvagersOf(state, ctx) <= 0) return { ok: false, errorId: 'core.wormholeSalvage.020' }
    if (run.turnsLeft < WORMHOLE_TURN_PER_WORK) return { ok: false, errorId: 'core.wormhole.002', mustExtract: true }
    const boxId = wormholeResearchBox(state, ctx, cell)
    if (!boxId) return { ok: false, errorId: 'core.researchLab.001' }
    const landed = wormholeStowOrTemp(state, ctx, boxId, 1)
    if (!landed.ok) cell.piles = [...(cell.piles ?? []), { itemId: boxId, units: 1 }]
    run.turnsLeft -= WORMHOLE_TURN_PER_WORK
    grid.activated.push(cell.key)
    addLog(state, 'salvage', '', 'core.researchLab.002', { p1: ctx.items.get(boxId)?.name ?? boxId })
    wormholeSpawnAfterTurns(state, WORMHOLE_TURN_PER_WORK)
    wormholePatrolAfterAction(state)
    return { ok: true, spent: WORMHOLE_TURN_PER_WORK, taken: [], boxes: [boxId], relics: [boxId], finished: true,
      left: cell.piles?.length ?? 0, mustExtract: run.turnsLeft <= 0 }
  }
  if (cell.place !== 'graveyard' && cell.place !== 'ruins' && cell.place !== 'research') return { ok: false, error: '这个地点没有可打捞的残骸。', errorId: 'core.wormholeSalvage.018' }
  const baseRigs = wormholeSalvagersOf(state, ctx)
  if (baseRigs <= 0) {
    return { ok: false, error: '编队里没有打捞器：打捞作业干不了（至少装 1 台）。', errorId: 'core.wormholeSalvage.020' }
  }
  const rigs = baseRigs + wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx)).salvagePiles
  const salvageEff = wormholeWorkEfficiencyOf(state, ctx, 'salvager')
  const rigsWant = rigs + workExtraPiles(state, salvageEff, cell.key, run.depth)
  wormholeEnsureSalvagePiles(state, cell)
  const piles = cell.piles ?? []
  if (piles.length === 0) {
    if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
    return { ok: false, error: '这个地点已经捞空了。', errorId: 'core.wormholeSalvage.022' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_WORK) {
    return { ok: false, error: '回合不足：只能撤离。', errorId: 'core.wormhole.002', mustExtract: true }
  }
  const rareOnly = noCommonWreckSalvageOn(state)
  const rareLeft = piles.some((p) => !wormholeIsShapedItem(p.itemId) && isRareWreck(p.itemId))
  const commonLeft = piles.some((p) => !wormholeIsShapedItem(p.itemId) && !isRareWreck(p.itemId))
  if (rareOnly && !rareLeft && commonLeft) {
    return { ok: false, error: '当前禁止打捞普通残骸。', errorId: 'core.wormholeSalvage.044' }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_WORK
  wormholeSpawnAfterTurns(state, WORMHOLE_TURN_PER_WORK)
  const taken: WormholeCellPile[] = []
  let full = false
  let boxLeft = 0
  const foundBoxes: string[] = []
  let boxFound = 0
  for (let i = 0; i < rigsWant && piles.length > 0; i++) {
    const idx = rareOnly ? piles.findIndex((p) => !wormholeIsShapedItem(p.itemId) && isRareWreck(p.itemId))
      : cell.place === 'research' ? piles.findIndex(p => !wormholeIsShapedItem(p.itemId)) : 0
    if (idx < 0) break
    const pile = piles[idx]!
    if (wormholeIsShapedItem(pile.itemId)) {
      boxLeft = piles.filter((p) => wormholeIsShapedItem(p.itemId)).length
      break
    }
    if (!tryMergeIntoBag(state, ctx, run, pile)) {
      full = true
      break
    }
    piles.splice(idx, 1)
    taken.push(pile)
    if (boxFound < WORMHOLE_SALVAGE_BOX_MAX) {
      const boxId = wormholeRollSalvageBox(state, ctx, cell, piles.length)
      if (boxId) {
        boxFound += 1
        foundBoxes.push(boxId)
        const name = ctx.items.get(boxId)?.name ?? boxId
        const shp = wormholeShapeOf(boxId)
        const landed = wormholeStowOrTemp(state, ctx, boxId, 1)
        if (landed.where === 'hold') {
          addLog(state, 'salvage', `🕳 残骸堆里翻出${name}：已装进货仓（占 ${shp.w}×${shp.h} = ${shp.w * shp.h} 格）。`, 'core.wormholeSalvage.028', { p1: name, p2: shp.w, p3: shp.h, p4: shp.w * shp.h })
        } else if (landed.where === 'temp') {
          addLog(
            state,
            'salvage',
            `🕳 残骸堆里翻出${name}：货仓腾不出 ${shp.w}×${shp.h} ⇒ 先放进临时空间（到「货仓」页整理进货仓）。`,
            'core.wormholeSalvage.049',
            { p1: name, p2: shp.w, p3: shp.h },
          )
        } else {
          cell.piles = [...(cell.piles ?? []), { itemId: boxId, units: 1 }]
          addLog(state, 'warn', `🕳 残骸堆里翻出${name}：货仓与临时空间都放不下 ⇒ 先散落在该地点（腾出空间后回来拾取）。`, 'core.wormholeSalvage.029', { p1: name })
        }
      }
    }
  }
  const names = taken
    .map((p) => `${ctx.items.get(p.itemId)?.name ?? p.itemId}×${Math.floor(p.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(
    state,
    'salvage',
    `🕳 打捞（${rigs} 台打捞器）：回收 ${taken.length} 堆${names.length > 0 ? `——${names}` : ''}` +
      ` · 剩 ${piles.length} 堆 · 剩 ${run.turnsLeft} 回合。`,
  )
  if (full) addLog(state, 'warn', `🕳 货仓放不下：这一批只回收了 ${taken.length} 堆，剩下的仍留在原处。`, 'core.wormholeSalvage.027', { p1: taken.length })
  if (rareOnly) {
    const commonLeftNow = piles.filter((p) => !wormholeIsShapedItem(p.itemId) && !isRareWreck(p.itemId)).length
    if (commonLeftNow > 0) {
      addLog(state, 'salvage', `🕳 本次打捞跳过 ${commonLeftNow} 堆普通残骸。`, 'core.wormholeSalvage.045', { p1: commonLeftNow })
    }
  }
  if (boxLeft > 0) {
    addLog(
      state,
      'warn',
      `🕳 这一格还有 ${boxLeft} 件货柜：它不是散货、打捞器搬不动——` +
        `点堆位自己拾取装舱（形状件按占地占货仓格；货仓腾不出会先进临时空间）。`,
    )
  }
  wormholePatrolAfterAction(state)
  const ruinsFirstPull = cell.place === 'ruins' && taken.length > 0 && !(grid.ruinsRolled ?? []).includes(cell.key)
  const ruinsBoxes: string[] = []
  let ruinsCores: string[] | undefined
  let ruinsBattle = false
  let resultRelics: string[] | undefined
  if (ruinsFirstPull) {
    grid.ruinsRolled = [...(grid.ruinsRolled ?? []), cell.key]
    const ruinsBoxId = wormholeRollRelicBox(state, ctx, cell)
    if (ruinsBoxId) {
      const name = ctx.items.get(ruinsBoxId)?.name ?? ruinsBoxId
      const shp = wormholeShapeOf(ruinsBoxId)
      const landed = wormholeStowOrTemp(state, ctx, ruinsBoxId, 1)
      if (landed.where === 'hold') {
        addLog(state, 'salvage', `🕳 遗迹深处发现${name}：已装进货仓（占 ${shp.w}×${shp.h} = ${shp.w * shp.h} 格）。`, 'core.wormholeSalvage.030', { p1: name, p2: shp.w, p3: shp.h, p4: shp.w * shp.h })
      } else if (landed.where === 'temp') {
        addLog(
          state,
          'salvage',
          `🕳 遗迹深处发现${name}：货仓腾不出 ${shp.w}×${shp.h} ⇒ 先放进临时空间（到「货仓」页整理进货仓）。`,
          'core.wormholeSalvage.050',
          { p1: name, p2: shp.w, p3: shp.h },
        )
      } else {
        cell.piles = [...(cell.piles ?? []), { itemId: ruinsBoxId, units: 1 }]
        addLog(
          state,
          'warn',
          `🕳 遗迹深处发现${name}：货仓与临时空间都放不下 ⇒ 先散落在该地点（腾出空间后回来拾取）。`,
          'core.wormholeSalvage.051',
          { p1: name },
        )
      }
      ruinsBoxes.push(ruinsBoxId)
      resultRelics = [ruinsBoxId]
    }
    const coreId = wormholeRollCore(state, cell)
    if (coreId) {
      const name = ctx.items.get(coreId)?.name ?? coreId
      const landed = wormholeStowOrTemp(state, ctx, coreId, 1)
      if (landed.where === 'hold') {
        addLog(state, 'salvage', `🕳 遗迹深处发现${name}：已装进货仓（占 1 格）。`, 'core.wormholeSalvage.031', { p1: name })
      } else if (landed.where === 'temp') {
        addLog(state, 'salvage', `🕳 遗迹深处发现${name}：货仓腾不出 1 格 ⇒ 先放进临时空间（到「货仓」页整理进货仓）。`, 'core.wormholeSalvage.032', { p1: name })
      } else {
        cell.piles = [...(cell.piles ?? []), { itemId: coreId, units: 1 }]
        addLog(state, 'warn', `🕳 遗迹深处发现${name}：货仓与临时空间都放不下 ⇒ 先散落在该地点（腾出空间后回来拾取）。`, 'core.wormholeSalvage.033', { p1: name })
      }
      ruinsCores = [coreId]
    }
    const battleRng = wormholeStream(runSeedOf(state) * 17 + run.depth * 613 + (cell.q * 41 + cell.r * 53) * 11 + 5)
    if (run.expeditionRules === 2) {
      if (!cell.alarmDisabled) {
        wormholeRaiseAlert(state, 1)
        addLog(state, 'warn', '', 'core.whExpedition.005', { p1: run.alertLevel ?? 0 })
      }
      if (run.expeditionProgress) run.expeditionProgress.ruins += 1
    } else if (battleRng() < WORMHOLE_RUINS_BATTLE_CHANCE) {
      ruinsBattle = true
      run.pendingRuinsBattle = true
      addLog(state, 'salvage', '🕳 遗迹深处的守备被惊动了：交火在即——这一场必须打完。', 'core.wormholeSalvage.034')
    }
  }
  const finished = piles.length === 0
  const foundAll = [...foundBoxes, ...ruinsBoxes]
  const result: WormholeSalvageResult = {
    ok: true,
    spent: WORMHOLE_TURN_PER_WORK,
    taken,
    left: piles.length,
    finished,
    mustExtract: run.turnsLeft <= 0,
    ...(foundAll.length > 0 ? { boxes: foundAll } : {}),
    ...(ruinsCores !== undefined ? { cores: ruinsCores } : {}),
    ...(resultRelics !== undefined ? { relics: resultRelics } : {}),
    ...(ruinsBattle ? { effect: { kind: 'ruinsBattle', key: cell.key } as WormholeActivateEffect } : {}),
    ...(run.expeditionRules === 2 && ruinsFirstPull && !cell.alarmDisabled ? { alarm: { alertLevel: run.alertLevel ?? 0 } } : {}),
  }
  if (!finished) return result
  if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
  return result
}

export function wormholeRelicBoxIdOf(family: string): string {
  return `box-relic-${family.toLowerCase()}`
}

export function wormholeResearchBox(state: GameState, ctx: SimContext, cell: WormholeGridCell): string | undefined {
  const run = state.wormhole.run
  if (!run || run.depth < 8 || cell.place !== 'research') return undefined
  const family = (run.family ?? familyOfCard(ctx, wormholeCellCardIdOf(run, cell))).toUpperCase()
  const rng = wormholeStream(runSeedOf(state) * 739 + run.depth * 947 + (cell.q * 61 + cell.r * 83) * 17)
  const encrypted = `box-encrypted-${family.toLowerCase()}`
  if (rng() < .5) {
    const own = encryptedFamilyOf(encrypted)
    return own && ctx.items.get(encrypted)?.kind === 'container' && encryptedBlueprintGroups(ctx, own) ? encrypted : undefined
  }
  const safe = wormholeRelicBoxIdOf(family)
  return encryptedFamilyOf(encrypted) && ctx.items.get(safe)?.kind === 'container' ? safe : undefined
}

export function wormholeRollRelicBox(
  state: GameState,
  ctx: SimContext,
  cell: WormholeGridCell,
): string | undefined {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return undefined
  if (run.depth < WORMHOLE_RELIC_MIN_DEPTH) return undefined
  const rng = wormholeStream(runSeedOf(state) * 53 + run.depth * 911 + (cell.q * 23 + cell.r * 29) * 13 + 7)
  if (rng() >= wormholeRelicChanceOf(run.depth)) return undefined
  return wormholeRollRelicBoxKind(rng, ctx, run.depth, familyOfCard(ctx, wormholeCellCardIdOf(run, cell)))
}

export function wormholeRollRelicBoxKind(
  rng: () => number,
  ctx: SimContext,
  depth: number,
  family: string,
): string | undefined {
  if (rng() < wormholeRelicValuablesShareOf(depth)) return WORMHOLE_VALUABLES_BOX_ID
  const others = wormholeRelicBoxPoolOf(ctx, depth, family).filter((id) => id !== WORMHOLE_VALUABLES_BOX_ID)
  if (others.length === 0) return undefined
  return others[Math.min(others.length - 1, Math.floor(rng() * others.length))]!
}

export interface WormholeUnboxDraw {
  itemId: string
  units: number
  source: 'family' | 'once' | 'permanent' | 'valuables' | 'military'
  extra?: ReadonlyArray<{ itemId: string; units: number }>
}

export function wormholeUnboxRoll(
  state: GameState,
  ctx: SimContext,
  boxItemId: string,
): WormholeUnboxDraw | null {
  const rng: RngState = {
    seed: (state.rng.seed ^ Math.imul((state.rng.box ?? 0) + 1, 0x9e3779b9)) >>> 0,
    count: 0,
  }
  const encryptedFamily = encryptedFamilyOf(boxItemId)
  if (encryptedFamily) {
    const ids = encryptedBlueprintDraw(ctx, encryptedFamily, rng)
    if (!ids?.length) return null
    state.rng.box = (state.rng.box ?? 0) + 1
    return { itemId: ids[0]!, units: 1, source: 'once',
      ...(ids.length > 1 ? { extra: ids.slice(1).map(itemId => ({ itemId, units: 1 })) } : {}) }
  }
  state.rng.box = (state.rng.box ?? 0) + 1
  const bpDepth = wormholeBpBoxDepthOf(boxItemId)
  if (bpDepth !== null) {
    const permanent = nextRandom(rng) < WORMHOLE_BPBOX_PERMANENT_CHANCE
    const pool = permanent ? wormholePermanentPoolOf(ctx, bpDepth) : wormholeDilutionPoolOf(ctx, bpDepth)
    if (pool.length === 0) return null
    const id = pool[nextInt(rng, pool.length)]!
    return { itemId: id, units: wormholePoolGrantUnitsOf(id), source: permanent ? 'permanent' : 'once' }
  }
  if (boxItemId === WORMHOLE_VALUABLES_BOX_ID) {
    const pool = WORMHOLE_LUXURY_ITEM_IDS.filter((id) => ctx.items.has(id))
    if (pool.length === 0) return null
    const id = pool[nextInt(rng, pool.length)]!
    const span = WORMHOLE_VALUABLES_UNITS_MAX - WORMHOLE_VALUABLES_UNITS_MIN + 1
    const units = WORMHOLE_VALUABLES_UNITS_MIN + nextInt(rng, span)
    return { itemId: id, units, source: 'valuables' }
  }
  if (boxItemId === WORMHOLE_MILITARY_BOX_ID) {
    const pool = wormholeMk3PoolOf(ctx)
    if (pool.length === 0) return null
    const span = WORMHOLE_MILITARY_PIECES_MAX - WORMHOLE_MILITARY_PIECES_MIN + 1
    const pieces = WORMHOLE_MILITARY_PIECES_MIN + nextInt(rng, span)
    const picks = Array.from({ length: pieces }, () => pool[nextInt(rng, pool.length)]!)
    const [first, ...rest] = picks
    return {
      itemId: first!,
      units: 1,
      source: 'military',
      ...(rest.length > 0 ? { extra: rest.map((itemId) => ({ itemId, units: 1 })) } : {}),
    }
  }
  const family = wormholeFamilyOfBox(boxItemId)
  if (!family) return null
  const pool = wormholeFamilyPoolOf(ctx, family)
  const w = wormholeRelicWeightsOf(WORMHOLE_DILUTION_MIN_DEPTH_FLOOR)
  const buckets: Array<{ ids: string[]; weight: number }> = [
    { ids: pool.modules, weight: w.modules },
    { ids: pool.moduleBlueprints, weight: w.moduleBlueprints },
    { ids: pool.shipBlueprints, weight: w.shipBlueprints },
    { ids: pool.drones ?? [], weight: Math.max(1, Math.min(w.modules, w.moduleBlueprints, w.shipBlueprints)) },
  ].filter((b) => b.ids.length > 0 && b.weight > 0)
  if (buckets.length === 0) return null
  const total = buckets.reduce((s, b) => s + b.weight, 0)
  let roll = nextRandom(rng) * total
  let hit = buckets[buckets.length - 1]!
  for (const b of buckets) {
    roll -= b.weight
    if (roll <= 0) {
      hit = b
      break
    }
  }
  const id = hit.ids[nextInt(rng, hit.ids.length)]!
  return { itemId: id, units: wormholePoolGrantUnitsOf(id), source: 'family' }
}

export function wormholeFamilyOfBox(boxItemId: string): string | null {
  const m = /^box-relic-([a-g])$/i.exec(boxItemId)
  return m ? m[1]!.toUpperCase() : null
}
export function wormholeDeliverRelics(
  state: GameState,
  ctx: SimContext,
  relics: readonly string[],
  unitsOf?: Readonly<Record<string, number>>,
): string[] {
  const done: string[] = []
  for (const id of relics) {
    if (ctx.modules.has(id)) {
      addModule(state, id)
      done.push(ctx.modules.get(id)?.name ?? id)
    } else if (ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)) {
      state.blueprintStock[id] = (state.blueprintStock[id] ?? 0) + 1
      done.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    } else if (ctx.items.has(id)) {
      const units = Math.max(1, ceilFinalQuantity(unitsOf?.[id] ?? wormholePoolGrantUnitsOf(id)))
      addWare(state, id, units)
      done.push(`${ctx.items.get(id)?.name ?? id}×${units}`)
    }
  }
  if (done.length > 0) addLog(state, 'salvage', `🕳 随行战利品入库：${done.join('、')}。`, 'core.wormholeSalvage.035', { p1: done.join('、') })
  return done
}


export type WormholeSpoilsShape = 'node' | 'boss' | 'ruins' | 'spawn' | 'elite'

export const WORMHOLE_SPOILS_TABLE: Readonly<Record<WormholeSpoilsShape, { commons: number; rares: number }>> = {
  node: { commons: WORMHOLE_SHIP_SPOIL_COMMONS, rares: 2 },
  boss: { commons: 3, rares: 3 },
  ruins: { commons: 2, rares: 2 },
  spawn: { commons: 1, rares: 0 },
  elite: { commons: 0, rares: 2 },
}

export function wormholeGrantShipSpoils(
  state: GameState,
  ctx: SimContext,
  shape: WormholeSpoilsShape,
): { bagged: number; leftOnCell: number; box?: string } {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { bagged: 0, leftOnCell: 0 }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { bagged: 0, leftOnCell: 0 }
  if (shape === 'spawn' && run.expeditionRules === undefined) wormholeEnsureArrivalPiles(state, ctx)
  const cardId = cell.foe?.card ?? wormholeCellCardIdOf(run, cell)
  const group = wreckGroupOfCard(cardId, ctx)
  if (!group) return { bagged: 0, leftOnCell: 0 }
  const mul = wormholeLayerRewardMul(run.depth, run.expeditionRules)
  const rng = wormholeStream(runSeedOf(state) * 7 + run.depth * 331 + (cell.q * 61 + cell.r * 67) * 3 + 11)
  const row = run.expeditionRules === 2 && shape === 'node' ? { commons: 2, rares: 1 } : WORMHOLE_SPOILS_TABLE[shape]
  const spoils: WormholeCellPile[] = []
  const commons = noCommonWreckSalvageOn(state) ? 0 : row.commons
  if (row.commons > 0 && commons === 0) {
    addLog(
      state,
      'salvage',
      `🕳 战果里的普通残骸按开关跳过（${row.commons} 堆）——只收稀有残骸。`,
      'core.wormholeSalvage.052',
      { p1: row.commons },
    )
  }
  for (let i = 0; i < commons; i++) {
    spoils.push({ itemId: wreckItemIdOf(group.key), units: Math.max(1, ceilFinalQuantity(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
  }
  for (let i = 0; i < row.rares; i++) spoils.push({ itemId: rareWreckItemIdOf(group.key), units: RARE_WRECK_VOLUME_M3 })
  let bagged = 0
  const leftovers: WormholeCellPile[] = []
  for (const s of spoils) {
    if (bagged < spoils.length && tryMergeIntoBag(state, ctx, run, s)) bagged += 1
    else leftovers.push(s)
  }
  if (leftovers.length > 0) {
    cell.piles = [...(cell.piles ?? []), ...leftovers]
    addLog(state, 'warn', `🕳 战果里有 ${leftovers.length} 堆装不下：先散落在该地点，可以照打捞规则回收。`, 'core.wormholeSalvage.036', { p1: leftovers.length })
  }
  if (bagged > 0) addLog(state, 'salvage', `🕳 战果入库：${bagged} 堆残骸（含稀有）。`, 'core.wormholeSalvage.037', { p1: bagged })
  let box: string | undefined
  const boxRng = wormholeStream(runSeedOf(state) * 53 + run.depth * 613 + (cell.q * 41 + cell.r * 59) * 23 + (cell.foe?.seq ?? 0) * 17 + 29)
  if (shape === 'elite' && run.expeditionRules === 2) {
    const eligible = wormholeBpBoxIdsForDepth(run.depth)
    const boxId = eligible[Math.floor(boxRng() * eligible.length)]
    if (boxId) { wormholeGroundAddShape(run, boxId); box = boxId }
  } else if (!(run.expeditionRules === 2 && shape === 'spawn') && boxRng() < WORMHOLE_LOOT_BOX_CHANCE) {
    const classes = wormholeSalvageBoxClassesOf(familyOfCard(ctx, cardId), run.depth)
    const pool = classes[Math.min(classes.length - 1, Math.floor(boxRng() * classes.length))]!
    const boxId = pool[Math.min(pool.length - 1, Math.floor(boxRng() * pool.length))]!
    const name = ctx.items.get(boxId)?.name ?? boxId
    const landed = wormholeStowOrTemp(state, ctx, boxId, 1)
    box = boxId
    if (landed.where === 'hold') {
      addLog(state, 'salvage', `🕳 战果里翻出${name}：已装进货仓。`, 'core.wormholeSalvage.041', { p1: name })
    } else if (landed.where === 'temp') {
      addLog(state, 'salvage', `🕳 战果里翻出${name}：货仓腾不出地方 ⇒ 先放进临时空间（到「货仓」页整理进货仓）。`, 'core.wormholeSalvage.042', { p1: name })
    } else {
      cell.piles = [...(cell.piles ?? []), { itemId: boxId, units: 1 }]
      addLog(state, 'warn', `🕳 战果里翻出${name}：货仓与临时空间都放不下 ⇒ 先散落在该地点（腾出空间后回来拾取）。`, 'core.wormholeSalvage.043', { p1: name })
    }
  }
  return { bagged, leftOnCell: leftovers.length, ...(box !== undefined ? { box } : {}) }
}


export function wormholeEnsureVeinPiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if (cell.place !== 'vein') return
  if (run.expeditionRules === undefined) {
    if (signalSpaceResourcePilesReady(run, cell)) return
  } else if ((cell.piles ?? []).length > 0) return
  if (grid.activated.includes(cell.key)) return
  const rng = wormholeStream(runSeedOf(state) * 97 + run.depth * 577 + (cell.q * 89 + cell.r * 71) * 19)
  const span = WORMHOLE_VEIN_PILES_MAX - WORMHOLE_VEIN_PILES_MIN + 1
  const count = WORMHOLE_VEIN_PILES_MIN + Math.floor(rng() * span) + signalSpaceResourcePileBonus(run.depth, run.expeditionRules)
  const piles = wormholeNodePilesFor(state, cell, count)
  const mul = wormholeMatterBuffs(run.hold).oreYieldMul
  const original = mul === 1 ? piles : piles.map((p) => ({ ...p, units: Math.max(1, ceilFinalQuantity(p.units * mul)) }))
  cell.piles = [...original, ...(cell.piles ?? [])]
  if (run.expeditionRules === undefined) cell.resourcePilesGenerated = true
}

export function wormholeSyncMatterTurns(state: GameState, ctx: SimContext): void {
  const run = state.wormhole.run
  if (!run) return
  const bonus = wormholeMatterBuffs(run.hold).turnBonus
  const techNow = matterTechWhBuffs(state, ctx).turnBonus
  const base = run.turnsBase ?? run.turnsTotal - bonus - techNow
  run.turnsBase = base
  run.turnsTechBonus = techNow
  const want = Math.max(0, Math.round(base + bonus + techNow))
  const spent = Math.max(run.turnsSpent ?? 0, run.turnsTotal - run.turnsLeft)
  run.turnsSpent = spent
  run.turnsTotal = want
  run.turnsLeft = Math.min(want, Math.max(0, Math.round(want - spent)))
}

function wormholeNodePilesFor(state: GameState, cell: WormholeGridCell, count: number): WormholeCellPile[] {
  const run = state.wormhole.run!
  const index = Math.abs(cell.q * 13 + cell.r * 29) % 97
  return wormholeNodePiles(runSeedOf(state), run.depth, index, count, run.expeditionRules)
}

