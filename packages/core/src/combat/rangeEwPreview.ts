import type { GameState, BattleState } from '../state'
import type { SimContext, AnomalyDef } from '../types'
import { createPlayerSpec } from './player/create'
import { activeFoeSpecsOf } from './foes/catalog'
import { createBattleState, seedUnit } from './foes/state'
import { foesWithSupport } from './foes/reinforcements'
import { buildMyUnitSpecs } from './fleetSpecs'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeUnitDeadOf } from './foeRange'
import { battleRangeEwOf, rangeEwContestOf, syncRangeEw, type RangeEwContest } from './rangeEw'
import { fleetDefOf, shipDisplayName } from '../instances'
import { combatRosterOf } from './command/roster'
import { isExitCell, gridContentIndex, revealOf } from '../wormholeGrid'
import { wormholeCardIdForRun } from '../wormhole/foes/pool'
import { wormholeDerivedAnomaly } from './cards'
import { wormholeMatterBattleModsOf } from './fleetSpecs'
import { isAlive } from './combatMath'
import { playerGravekeeperSpecOf } from './gravekeeperGear'

export interface RangeEwWeapon {
  id: string
  side: 'me' | 'foe'
  owner: string
  label: string
  beforeM: number
  currentM: number
  reduction: number
  floorLimited?: boolean
  count: number
}
export interface RangeEwView extends RangeEwContest { weapons: RangeEwWeapon[] }

/** 只移除本次电子战，其他增程、捕获网和本拍减益保持原值。 */
export function rangeEwBattleView(state: GameState, ctx: SimContext, battle: BattleState,
  anomaly: AnomalyDef, leader = state.shipId): RangeEwView | undefined {
  if (battle.rangeEwVersion !== 1) return undefined
  const foes = foesWithSupport(battle, activeFoeSpecsOf(anomaly, ctx.balance.battle, battle.waveIdx))
  const contest = battle.rangeEw ? rangeEwContestOf(battle.rangeEw.me, battle.rangeEw.foe)
    : battleRangeEwOf(state, ctx, battle, foes, leader)
  const current = { ...battle, rangeEw: contest, meFoeRangeDebuff: contest.foeCut }
  const before = { ...current, rangeEw: { ...contest, meCut: 0, foeCut: 0 }, meFoeRangeDebuff: 0 }
  // 详情按需生成；分别走引擎建档，保留逐武器增程基准与本拍捕获网，不缓存可变规格。
  const raw = buildMyUnitSpecs(state, ctx, before, leader, anomaly.id, foes).map(spec => playerGravekeeperSpecOf(before, spec, true))
  const rangedActual = buildMyUnitSpecs(state, ctx, current, leader, anomaly.id, foes).map(spec => playerGravekeeperSpecOf(current, spec, true))
  const weapons: RangeEwWeapon[] = []
  const append = (id: string, side: 'me' | 'foe', owner: string, label: string, beforeM: number, currentM: number, count: number) => {
    const previous = weapons.find(row => row.id === id && row.beforeM === beforeM && row.currentM === currentM)
    if (previous) { previous.count += count; return }
    const cut = side === 'me' ? contest.meCut : contest.foeCut
    weapons.push({ id, side, owner, label, beforeM, currentM, reduction: beforeM > 0 ? Math.max(0, 1 - currentM / beforeM) : 0, count,
      ...(cut > 0 && (side === 'foe' && currentM <= 3000 || side === 'me' && currentM <= 2) ? { floorLimited: true } : {}) })
  }
  for (const spec of rangedActual) {
    if (!battle.units[spec.tag] || !isAlive(battle, spec.tag) || (battle.units[spec.tag]!.enteredAtMs ?? 0) > battle.lastTickGameMs) continue
    const original = raw.find(row => row.tag === spec.tag)!
    const uid = battle.myFleet?.find(row => row.tag === spec.tag)?.shipId ?? leader
    spec.weapons.forEach((weapon, i) => {
      if (weapon.disabled || weapon.reserve) return
      append(`${spec.tag}:${weapon.moduleId ?? weapon.artId ?? weapon.label}`, 'me', shipDisplayName(state, ctx, uid),
        weapon.moduleId ? ctx.modules.get(weapon.moduleId)?.name ?? weapon.label : weapon.label,
        original.weapons[i]!.maxRangeM, weapon.maxRangeM, weapon.count ?? 1)
    })
  }
  for (const spec of foes) {
    const rt = battle.units[spec.tag]
    if (!rt || foeUnitDeadOf(battle, spec.tag)) continue
    for (const weapon of spec.weapons) {
      if (weapon.disabled || weapon.reserve) continue
      const reach = weapon.src === 'drone' ? foeDroneRangeOf : (b: BattleState, w: typeof weapon) => foeGunMaxRangeOf(b, spec, w)
      append(`${spec.tag}:${weapon.artId ?? weapon.label}`, 'foe', spec.name, weapon.label,
        reach(before, weapon, spec), reach(current, weapon, spec), weapon.count ?? 1)
    }
  }
  return { ...contest, weapons }
}

/** 不开战、不抽签、不写入真实状态；已知目标逐波独立预览，延迟支援不算开场来源。 */
export function rangeEwPreviewOf(state: GameState, ctx: SimContext, card: AnomalyDef,
  ids: readonly string[] = combatRosterOf(state), wormhole?: NonNullable<BattleState['wormhole']>): Array<{ wave: number; phase: 'opening' | 'inside' | 'outside'; view: RangeEwView }> {
  const local = { ...state, fleet: state.fleet }
  const ordered = [...new Set(ids)].filter(id => fleetDefOf(state, ctx, id))
  const leaderAt = ordered.indexOf(state.shipId)
  if (leaderAt > 0) ordered.unshift(...ordered.splice(leaderAt, 1))
  const specs = ordered.flatMap((id, i) => {
    const spec = createPlayerSpec(local, ctx, id)
    return spec ? [{ ...spec, tag: i ? `ally-${i}` : 'player' }] : []
  })
  if (!specs.length) return []
  const waves = card.waves?.length ? card.waves.map((_, i) => i) : [...new Set((card.ships ?? []).map(slot => slot.wave ?? 0))]
  if (!waves.length) waves.push(0)
  return waves.flatMap(wave => {
    const foes = activeFoeSpecsOf(card, ctx.balance.battle, wave)
    const battle = createBattleState(specs[0]!, foes, state.gameMs, 0, specs.slice(1))
    battle.rangeEwVersion = 1
    battle.waveIdx = wave
    battle.myFleet = ordered.map((shipId, i) => ({ tag: i ? `ally-${i}` : 'player', shipId }))
    if (wormhole) battle.wormhole = wormhole
    // 各波从本波到场时刻独立预览；延迟支援没有运行态，不提前计入。
    for (const foe of foes) {
      const unit = battle.units[foe.tag]
      if (!unit) continue
      unit.enteredAtMs = state.gameMs
    }
    syncRangeEw(local, ctx, battle, foes, ordered[0]!)
    const rows = [{ wave, phase: 'opening' as const, view: rangeEwBattleView(local, ctx, battle, card, ordered[0]!)! }]
    if (!foes.some(foe => foe.foeReinforceBranch)) return rows
    return [...rows, ...(['inside', 'outside'] as const).map(phase => {
      const branch = structuredClone(battle)
      for (const foe of foes.filter(foe => foe.foeReinforceBranch === phase)) seedUnit(branch, foe)
      syncRangeEw(local, ctx, branch, foes, ordered[0]!)
      return { wave, phase, view: rangeEwBattleView(local, ctx, branch, card, ordered[0]!)! }
    })]
  })
}

/** 层末守卫在玩家已抵达入口后可预览；不推测随机节点、未揭示卡或未来分支。 */
export function rangeEwSignalTargetOf(state: GameState, ctx: SimContext): {
  card: AnomalyDef; ids: readonly string[]; wormhole: NonNullable<BattleState['wormhole']>
} | undefined {
  const run = state.wormhole.run, grid = run?.grid
  if (!run || run.battle || !grid || !isExitCell(grid, grid.pos) || revealOf(grid, grid.pos).kind !== 'known'
    || (run.bossCleared ?? 0) >= run.depth) return undefined
  const cardId = wormholeCardIdForRun({ family: run.family, seed: run.seed,
    depth: run.expeditionRules === 2 ? 1 : run.depth, kind: 'boss', nodeIndex: gridContentIndex(grid, grid.pos) })
  const base = ctx.anomalies.get(cardId)
  if (!base) return undefined
  const mods = wormholeMatterBattleModsOf(state, ctx, base, 'boss')
  const wormhole = { cardId, depth: run.depth, kind: 'boss' as const, waves: 1,
    ...(run.expeditionRules === 2 ? { expeditionRules: 2, expeditionRole: 'guard' as const,
      guardSupportDisabled: run.guardSupportDisabled, desireRangeMul: run.nextBattleRangeMul } : {}),
    ...mods }
  return { card: wormholeDerivedAnomaly(ctx, base, wormhole), ids: run.fleet, wormhole }
}
