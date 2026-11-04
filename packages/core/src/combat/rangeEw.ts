import type { BattleState, GameState } from '../state'
import type { SimContext } from '../types'
import type { UnitSpec } from './model'
import { isAlive } from './combatMath'
import { allFittedModules } from '../fitted'
import { moduleAllowedOnShip } from '../shipFitting'
import { fleetDefOf, shipDisplayName } from '../instances'

export interface RangeEwPart {
  id: string
  name: string
  base: number
  extra: number
  equipment: number
  equipmentMul: number
  total: number
}
export interface RangeEwContest {
  me: RangeEwPart[]
  foe: RangeEwPart[]
  meStrength: number
  foeStrength: number
  net: number
  meCut: number
  foeCut: number
}
export function rangeEwBattleSummaryOf(battle: BattleState): RangeEwContest | undefined {
  if (battle.rangeEwVersion !== 1 || !battle.rangeEw) return undefined
  return { ...battle.rangeEw, me: battle.rangeEw.me.map(row => ({ ...row })),
    foe: battle.rangeEw.foe.map(row => ({ ...row })) }
}

export function rangeEwBaseOf(tier: number | undefined): number {
  return [5, 10, 15, 20, 30][Math.max(0, Math.min(4, Math.floor(tier ?? 1) - 1))] ?? 5
}

export function rangeEwCutOf(strength: number): number {
  if (!(strength > 0) || !Number.isFinite(strength)) return 0
  const ratio = 120 / strength
  return .6 / (1 + ratio * ratio)
}

export function playerRangeEwOf(state: GameState, ctx: SimContext, ids: readonly string[]): RangeEwPart[] {
  return [...new Set(ids)].flatMap(id => {
    const ship = fleetDefOf(state, ctx, id), entry = state.fleet[id]
    if (!ship || !entry) return []
    const base = rangeEwBaseOf(ship.tier), extra = ship.rangeEwBonus ?? 0
    const equipmentMul = 1 + (ship.rangeEwEquipmentBonusPct ?? 0)
    const equipment = allFittedModules(entry.fitted, ctx).filter(mod => moduleAllowedOnShip(ship, mod))
      .reduce((sum, mod) => sum + Math.max(0, mod.rangeEwStrength ?? 0), 0)
    return [{ id, name: shipDisplayName(state, ctx, id), base, extra, equipment, equipmentMul,
      total: base + extra + equipment * equipmentMul }]
  })
}

export function foeRangeEwOf(spec: UnitSpec): RangeEwPart {
  const base = rangeEwBaseOf(spec.hullClassTier), extra = spec.rangeEwBonus ?? 0
  const equipment = spec.rangeEwStrength ?? 0, equipmentMul = 1 + (spec.rangeEwEquipmentBonusPct ?? 0)
  return { id: spec.tag, name: spec.name, base, extra, equipment, equipmentMul,
    total: base + extra + equipment * equipmentMul }
}

export function rangeEwContestOf(me: RangeEwPart[], foe: RangeEwPart[]): RangeEwContest {
  const meStrength = me.reduce((sum, row) => sum + row.total, 0)
  const foeStrength = foe.reduce((sum, row) => sum + row.total, 0)
  const net = meStrength - foeStrength
  return { me, foe, meStrength, foeStrength, net, meCut: rangeEwCutOf(-net), foeCut: rangeEwCutOf(net) }
}

/** 仅实际在场存活舰体计入；无运行态单位的未来波与支援不提前贡献。 */
export function battleRangeEwOf(state: GameState, ctx: SimContext, battle: BattleState,
  foes: readonly UnitSpec[], leader = state.shipId): RangeEwContest {
  const alive = (tag: string) => {
    const unit = battle.units[tag]
    return !!unit && isAlive(battle, tag)
      && (unit.enteredAtMs === undefined || unit.enteredAtMs <= battle.lastTickGameMs)
  }
  const roster = battle.myFleet ?? [{ tag: 'player', shipId: leader }]
  return rangeEwContestOf(playerRangeEwOf(state, ctx, roster.filter(row => alive(row.tag)).map(row => row.shipId)),
    foes.filter(row => alive(row.tag)).map(foeRangeEwOf))
}

const rangeEwCache = new WeakMap<BattleState, { signature: string; view: RangeEwContest }>()
export function syncRangeEw(state: GameState, ctx: SimContext, battle: BattleState,
  foes: readonly UnitSpec[], leader = state.shipId): RangeEwContest {
  const roster = battle.myFleet ?? [{ tag: 'player', shipId: leader }]
  const signature = JSON.stringify([battle.lastTickGameMs, roster.map(row => {
    const ship = fleetDefOf(state, ctx, row.shipId)
    return [row.tag, row.shipId, ship?.tier, ship?.rangeEwBonus, ship?.rangeEwEquipmentBonusPct,
      shipDisplayName(state, ctx, row.shipId), state.fleet[row.shipId]?.fitted,
      battle.units[row.tag]?.enteredAtMs, battle.units[row.tag] ? isAlive(battle, row.tag) : false]
  }), foes.map(row => [row.tag, row.hullClassTier, row.rangeEwBonus, row.rangeEwEquipmentBonusPct, row.rangeEwStrength,
    battle.units[row.tag]?.enteredAtMs, battle.units[row.tag] ? isAlive(battle, row.tag) : false])])
  const cached = rangeEwCache.get(battle)
  if (cached?.signature === signature) return cached.view
  const view = battleRangeEwOf(state, ctx, battle, foes, leader)
  battle.rangeEw = view
  if (view.foeCut > 0) battle.meFoeRangeDebuff = view.foeCut
  else delete battle.meFoeRangeDebuff
  rangeEwCache.set(battle, { signature, view })
  return view
}
