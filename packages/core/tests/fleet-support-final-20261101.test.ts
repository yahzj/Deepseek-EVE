import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/combat/player/create'
import { applyFleetLockAura } from '../src/combat/lockAura'
import { lockAwareFoe } from '../src/combat/targeting'
import { createBattleState } from '../src/combat/foes/state'
import { pulseShieldFieldFor, SHIELD_FIELD_COST_PCT } from '../src/combat/combatRepair'
import type { UnitSpec } from '../src/combat/model'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
function world(mods: string[][] = [[]]) {
  const state = createInitialState({ nowWallMs: 0, seed: 83 })
  state.fleet = {}
  const specs = mods.map((high, index) => {
    const id = addShipToFleet(state, 'sh-megalodon')
    state.fleet[id]!.fitted = { high, mid: [], low: [] }
    if (!index) state.shipId = id
    return { ...createPlayerSpec(state, ctx, id)!, tag: index ? `ally-${index}` : 'player' }
  })
  const foes: UnitSpec[] = [0, 1, 2].map(index => ({ ...specs[0]!, tag: `foe-${index}`, side: 'foe' as const }))
  const battle = createBattleState(specs[0]!, foes, 0, 1000, specs.slice(1))
  battle.distanceM = 1000
  return { state, specs, foes, battle }
}

describe('编队支援最终参数', () => {
  it.each([['mod-shieldfield-2', 12000, 50], ['mod-shieldfield-3', 10000, 75]] as const)('%s名称、周期、CPU与恢复/支付为现行值，ID不变', (id, ms, cpu) => {
    expect(ctx.modules.get(id)).toMatchObject({ shieldFieldPct: .1, shieldFieldMs: ms, cpuUse: cpu })
    expect(ctx.modules.get(id)!.name).toContain('护盾投送力场')
    expect(ctx.blueprints.get(id.replace('mod-', 'bp-'))!.name).toContain('护盾投送力场')
    expect(SHIELD_FIELD_COST_PCT).toBe(.1)
  })

  it('按缺盾比例最高选两舰，比例并列保持编队序，施放者仅付一次', () => {
    const { specs, battle } = world([[], [], [], [], []])
    const fractions = [1, .3, .1, .1, .2]
    for (let i = 0; i < specs.length; i++) {
      const rt = battle.units[specs[i]!.tag]!
      rt.hpMax!.s = 1000
      rt.hp.s = fractions[i]! * 1000
    }
    pulseShieldFieldFor(battle, specs, { pct: .1 }, specs[0]!)
    expect(specs.map(s => battle.units[s.tag]!.hp.s)).toEqual([900, 300, 200, 200, 200])
  })

  it.each([['mod-lock-1', .08, .04, .6], ['mod-lock-2', .12, .06, .7], ['mod-lock-3', .2, .1, .8], ['mod-wh-d-lock', .3, .2, .6]] as const)('%s本舰原增伤、队友共享和概率分别生效', (id, own, shared, chance) => {
    const { specs } = world([[id], []])
    applyFleetLockAura(specs)
    expect(specs[0]!.lockedDmgBonus).toBeCloseTo(own)
    expect(specs[1]!.lockedDmgBonus).toBeCloseTo(shared)
    expect(specs.map(s => s.lockTargetChance)).toEqual([chance, chance])
    applyFleetLockAura(specs)
    expect(specs[1]!.lockedDmgBonus).toBeCloseTo(shared)
  })

  it('多件常规共享封顶15%，丧钟共享20%，概率不相加，自身与共享只取高', () => {
    const { specs, battle } = world([['mod-lock-3', 'mod-lock-3', 'mod-lock-3'], ['mod-wh-d-lock'], ['mod-lock-1'], []])
    applyFleetLockAura(specs, battle)
    expect(specs[0]!.lockedDmgBonus).toBeGreaterThan(.2)
    expect(specs[1]!.lockedDmgBonus).toBeCloseTo(.3)
    expect(specs[2]!.lockedDmgBonus).toBeCloseTo(.2)
    expect(specs[3]!.lockedDmgBonus).toBeCloseTo(.2)
    expect(specs.map(s => s.lockTargetChance)).toEqual([.8, .8, .8, .8])
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    applyFleetLockAura(specs, battle)
    expect(specs[3]!.lockedDmgBonus).toBeCloseTo(.15)
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    applyFleetLockAura(specs, battle)
    expect(specs[3]!.lockedDmgBonus).toBeCloseTo(.04)
    expect(specs[3]!.lockTargetChance).toBe(.6)
    battle.units['ally-2']!.hp = { s: 0, a: 0, h: 0 }
    applyFleetLockAura(specs, battle)
    expect(specs[3]!.lockedDmgBonus).toBe(0)
    expect(specs[3]!.lockTargetChance).toBe(0)
  })

  it.each([.6, .7, .8])('%s概率选首位，余下概率只选其他目标，可复现且不会必定集火', chance => {
    const { state, specs, foes, battle } = world()
    specs[0]!.lockTargetChance = chance
    const counts = [0, 0, 0]
    for (let i = 0; i < 20000; i++) {
      const target = lockAwareFoe(state, battle, foes, specs[0]!)!
      counts[Number(target.tag.slice(-1))]!++
    }
    expect(counts[0]! / 20000).toBeCloseTo(chance, 1)
    expect(counts[1]).toBeGreaterThan(0)
    expect(counts[2]).toBeGreaterThan(0)
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    expect(Array.from({ length: 200 }, () => lockAwareFoe(state, battle, foes, specs[0]!)!.tag)).not.toContain('foe-0')
  })

  it('单目标不额外掷倾向骰；存档重载后后续随机选择相同', () => {
    const { state, specs, foes, battle } = world([['mod-lock-3']])
    state.expedition = { ...state.expedition, active: true, phase: 'battle', battle, anomalyId: 'ano-training' }
    const read = loadSaveFile(serializeSaveFile(state)).state
    const expected = Array.from({ length: 100 }, () => lockAwareFoe(state, battle, foes, specs[0]!)!.tag)
    const actual = Array.from({ length: 100 }, () => lockAwareFoe(read, read.expedition.battle!, foes, specs[0]!)!.tag)
    expect(actual).toEqual(expected)
    const rng = { ...state.rng }
    lockAwareFoe(state, battle, [foes[0]!], specs[0]!)
    expect(state.rng).toEqual(rng)
  })
})
