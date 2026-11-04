import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { adjustDroneLoad, droneLoadM3 } from '../src/equipment'
import { plugEffectsOf } from '../src/plugs'
import { createPlayerSpec } from '../src/combat/player/create'
import { createBattleState } from '../src/combat/foes/state'
import { applyDroneCommandAura, droneCommandVolumeM3Of } from '../src/combat/droneCommand'
import { applyFleetDamageAura, applyMatterPlayerBuffs, buildMyUnitSpecs } from '../src/combat/fleetSpecs'
import { startBattleFor } from '../src/combat/startSingle'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { wormholeMatterBuffs } from '../src/wormholeMatter'
import { signalAutoCombatRatio } from '../src/signalAuto/combat'
import type { UnitSpec, WeaponSpec } from '../src/combat/model'

const ctx = buildSimContext()
const plug = 'plug-titan-drone-command'
const command = { sharePct: .5, targetWeightPerM3: .01 }
const card = 'ano-training'

function weapon(extra: Partial<WeaponSpec> = {}): WeaponSpec {
  return { label: 'test', kind: 'fixed', src: 'drone', artId: 'drone-scout', fixedType: 'kinetic',
    shotDmg: 100, maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 1, reloadMs: 100, ...extra }
}

function unit(tag: string, bonus = 0, holder = false): UnitSpec {
  return { tag, name: tag, side: 'me', hp: { s: 100, a: 100, h: 100 }, resists: {},
    speedMps: 100, agility: 1, signatureM: 30, scanResMm: 100, foeTactic: null, evasion: 0, hitBonus: 0,
    droneDamageBonusPct: bonus, ...(holder ? { droneCommand: command } : {}),
    weapons: [weapon(), weapon({ src: 'turret', shotDmg: 60 }),
      weapon({ repairDrone: { armor: 20, hull: 10, kitId: 'repairkit-mil' }, shotDmg: 0 })] }
}

function battleOf(specs: UnitSpec[]) {
  const battle = createBattleState(specs[0]!, [], 0, 1000, specs.slice(1))
  battle.myFleet = specs.map(spec => ({ tag: spec.tag, shipId: spec.tag }))
  battle.droneCommandVolumeM3 = 100
  return battle
}

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  state.fleet = {}
  const ids = ['sh-sentinel', 'sh-swarm', 'sh-wh-g-destroyer'].map(defId => addShipToFleet(state, defId))
  state.shipId = ids[0]!
  for (const id of ids) {
    state.fleet[id]!.fitted = { high: [], mid: [], low: [] }
    state.fleet[id]!.droneLoad = { 'drone-scout': 1 }
    state.fleet[id]!.cargo['drone-heavy'] = 1000
  }
  state.fleet[ids[0]!]!.fitted.high = ['mod-drone-tac-1']
  state.fleet[ids[0]!]!.plugs = [plug, plug]
  state.fleet[ids[1]!]!.plugs = [plug]
  state.fleet[ids[2]!]!.droneLoad = { 'drone-repair-mil': 1 }
  state.warehouse.items['drone-heavy'] = 1000
  state.skills.trained['drone-warfare'] = 5
  state.skills.trained['drone-strike'] = 5
  return { state, ids }
}

const droneShot = (spec: UnitSpec) => spec.weapons.find(w => w.src === 'drone' && !w.repairDrone)!.shotDmg!

describe('无人机指挥插件：共享、动态来源与开战体积', () => {
  it('全队只取最高来源，最高者不吃自身或次高者，攻击机以外的武器与维修不变', () => {
    const specs = [unit('player', 1, true), unit('ally-1', 3, true), unit('ally-2', .5)]
    const before = structuredClone(specs)
    const out = applyDroneCommandAura(specs, battleOf(specs))
    expect(out.map(droneShot)).toEqual([250, 100, 250])
    expect(out.map(spec => spec.droneDamageBonusPct)).toEqual([1, 3, .5])
    expect(out.map(spec => spec.targetWeightMul)).toEqual([2, 2, undefined])
    for (let i = 0; i < out.length; i++) expect(out[i]!.weapons.slice(1)).toEqual(before[i]!.weapons.slice(1))
    expect(specs).toEqual(before)
  })

  it('共享不递归；来源死亡立即接替，全部死亡后恢复队友基础伤害，体积代价保持', () => {
    const specs = [unit('player', 3, true), unit('ally-1', 1, true), unit('ally-2')]
    const battle = battleOf(specs)
    const first = applyDroneCommandAura(specs, battle)
    expect(applyDroneCommandAura(first, battle).map(droneShot)).toEqual([100, 250, 250])
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    const next = applyDroneCommandAura(first, battle)
    expect(next.map(droneShot)).toEqual([100, 100, 150])
    expect(next[1]!.targetWeightMul).toBe(2)
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    expect(applyDroneCommandAura(next, battle).map(droneShot)).toEqual([100, 100, 100])
    expect(droneShot(first[2]!)).toBe(250)
  })

  it('并列按固定编队次序，重排输入也不会让另一来源抢占', () => {
    const specs = [unit('player', 2, true), unit('ally-1', 2, true), unit('ally-2')]
    const battle = battleOf(specs)
    const out = applyDroneCommandAura([specs[1]!, specs[0]!, specs[2]!], battle)
    expect(out.map(droneShot)).toEqual([200, 100, 200])
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(applyDroneCommandAura(out, battle).map(droneShot)).toEqual([100, 100, 200])
  })

  it('两次调用保留舰队和谜质增伤，只分享自身M；打印惩罚与危机加速不进入贡献', () => {
    const specs = [unit('player', 1, true), unit('ally-1')]
    specs[0]!.weapons[0]!.shotDmg = 90
    specs[0]!.crisisOverload = { rangeMul: 2, damageMul: 3, speedMul: .5, droneInitialMul: .5, droneCycleMul: .5 }
    applyFleetDamageAura(specs, 1.2)
    const buffs = { ...wormholeMatterBuffs(undefined), damagePct: .3 }
    for (const spec of specs) applyMatterPlayerBuffs(spec, buffs, 'kinetic')
    const battle = battleOf(specs)
    battle.meCrisisActive = { player: true }
    const first = applyDroneCommandAura(specs, battle)
    const second = applyDroneCommandAura(first, battle)
    expect(droneShot(first[0]!)).toBeCloseTo(90 * 1.2 * 1.3)
    expect(droneShot(second[1]!)).toBeCloseTo(100 * 1.2 * 1.3 * 1.5)
    expect(second.map(droneShot)).toEqual(first.map(droneShot))
    expect(second[1]!.weapons[1]!.shotDmg).toBeCloseTo(60 * 1.2 * 1.3)
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(droneShot(applyDroneCommandAura(second, battle)[1]!)).toBeCloseTo(100 * 1.2 * 1.3)
  })

  it('每艘持有者都乘自己的既有目标权重，无玩法上限，零收益仍承担体积', () => {
    const specs = [unit('player', 0, true), unit('ally-1', 1, true), unit('ally-2')]
    specs[0]!.targetWeightMul = 3
    specs[1]!.targetWeightMul = .4
    const battle = battleOf(specs)
    battle.droneCommandVolumeM3 = 20000
    const out = applyDroneCommandAura(specs, battle)
    expect(out.map(spec => spec.targetWeightMul)).toEqual([603, .4 * 201, undefined])
    expect(applyDroneCommandAura(out, battle).map(spec => spec.targetWeightMul)).toEqual(out.map(spec => spec.targetWeightMul))
  })

  it('伤害分系和零伤害均支持乘算，不修改输入武器或分系对象', () => {
    const specs = [unit('player', 1, true), unit('ally-1')]
    specs[1]!.weapons[0] = weapon({ shotDmg: 0, shotsByType: { kinetic: 10, plasma: 20 } })
    const out = applyDroneCommandAura(specs)
    expect(out[1]!.weapons[0]).toMatchObject({ shotDmg: 0, shotsByType: { kinetic: 15, plasma: 30 } })
    expect(specs[1]!.weapons[0]!.shotsByType).toEqual({ kinetic: 10, plasma: 20 })
  })

  it('新单舰和多舰均拍已装载体积，含本舰与维修机，排除货仓、仓库及空舱', () => {
    const { state, ids } = world()
    const single = startBattleFor(state, ctx, ids[0]!, card)!
    expect(single.droneCommandVolumeM3).toBe(droneLoadM3(state.fleet[ids[0]!]!.droneLoad, ctx))
    const battle = startFleetBattleFor(state, ctx, ids, card)!
    const volume = ids.reduce((n, id) => n + droneLoadM3(state.fleet[id]!.droneLoad, ctx), 0)
    expect(battle.droneCommandVolumeM3).toBe(volume)
    expect(battle.droneLoadAtStartBy!['ally-2']).toEqual({ 'drone-repair-mil': 1 })
    const before = buildMyUnitSpecs(state, ctx, battle, ids[0]!, card)
    expect(before[0]!.targetWeightMul).toBeCloseTo(1 + volume / 100)
    expect(before[1]!.targetWeightMul).toBeCloseTo(1 + volume / 100)
    for (const id of ids) state.fleet[id]!.droneLoad = {}
    battle.droneLostBy = { player: { 'drone-scout': 1 } }
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(droneCommandVolumeM3Of(battle, ctx)).toBe(volume)
    expect(buildMyUnitSpecs(state, ctx, battle, ids[0]!, card)[1]!.targetWeightMul).toBeCloseTo(1 + volume / 100)
  })

  it('旧战斗先读逐舰初装账，不与单舰别名重复加；只剩单舰初装账时正确回退并固化', () => {
    const specs = [unit('player', 1, true), unit('ally-1')]
    const battle = battleOf(specs)
    delete battle.droneCommandVolumeM3
    battle.droneLoadAtStart = { 'drone-heavy': 999 }
    battle.droneLoadAtStartBy = { player: { 'drone-scout': 2 }, 'ally-1': { 'drone-repair-mil': 1 } }
    const expected = droneLoadM3({ 'drone-scout': 2, 'drone-repair-mil': 1 }, ctx)
    expect(applyDroneCommandAura(specs, battle, ctx)[0]!.targetWeightMul).toBeCloseTo(1 + expected / 100)
    battle.droneLoadAtStartBy = {}
    expect(droneCommandVolumeM3Of(battle, ctx)).toBe(expected)
    delete battle.droneCommandVolumeM3
    delete battle.droneLoadAtStartBy
    battle.droneLoadAtStart = { 'drone-scout': 3 }
    expect(droneCommandVolumeM3Of(battle, ctx)).toBe(droneLoadM3(battle.droneLoadAtStart, ctx))
    battle.droneCommandVolumeM3 = 0
    expect(droneCommandVolumeM3Of(battle, ctx)).toBe(0)
  })

  it('真实投影的M按装备、舰体和技能乘积，重复插件只生效一次，重建不会污染createPlayerSpec', () => {
    const { state, ids } = world()
    const own = createPlayerSpec(state, ctx, ids[0]!)!
    const other = createPlayerSpec(state, ctx, ids[1]!)!
    const multiplier = 1.12 * 1.25 * 1.25 * 1.2
    expect(own.droneDamageBonusPct).toBeCloseTo(multiplier - 1)
    expect(plugEffectsOf(state, ctx, ids[0]!).filter(def => def.droneCommand)).toHaveLength(1)
    const battle = startFleetBattleFor(state, ctx, ids, card)!
    const first = buildMyUnitSpecs(state, ctx, battle, ids[0]!, card)
    expect(droneShot(first[0]!)).toBe(droneShot(own))
    expect(droneShot(first[1]!)).toBeCloseTo(droneShot(other) * (1 + .5 * (multiplier - 1)))
    expect(buildMyUnitSpecs(state, ctx, battle, ids[0]!, card).map(spec => spec.weapons)).toEqual(first.map(spec => spec.weapons))
    expect(createPlayerSpec(state, ctx, ids[1]!)!.weapons).toEqual(other.weapons)
  })

  it('新阵容自动探索预估接共享且不改变游戏状态', () => {
    const { state, ids } = world()
    state.fleet[ids[0]!]!.plugs = [plug]
    expect(adjustDroneLoad(state, ctx, 'drone-heavy', 10, ids[0]!).ok).toBe(true)
    expect(adjustDroneLoad(state, ctx, 'drone-heavy', 5, ids[1]!).ok).toBe(true)
    const before = structuredClone(state)
    const withCommand = signalAutoCombatRatio(state, ctx, ids, 'G', 1)
    expect(state).toEqual(before)
    for (const id of ids) state.fleet[id]!.plugs = []
    const withoutCommand = signalAutoCombatRatio(state, ctx, ids, 'G', 1)
    expect(withoutCommand).toBeGreaterThan(0)
    expect(withCommand).toBeGreaterThan(withoutCommand)
  })

  it('一次advance内部击毁来源后，下拍攻击机撤销分享，沿用MC与靶场真实step路径', () => {
    const { state, ids } = world()
    state.fleet[ids[1]!]!.plugs = []
    const battle = startFleetBattleFor(state, ctx, ids.slice(0, 2), card)!
    for (const rt of Object.values(battle.units)) { delete rt.enteredAtMs; rt.weapons.fill(1e9) }
    const specs = buildMyUnitSpecs(state, ctx, battle, ids[0]!, card)
    const wing = specs[1]!
    const index = wing.weapons.findIndex(w => w.src === 'drone')
    const pool = battle.dronePools![`ally-1:${index}`]!
    pool.launched = true
    delete battle.droneLaunchBy
    battle.units['ally-1']!.weapons[index] = 0
    const shots: number[] = []
    state.gameMs = 12000
    advanceBattleFor(state, ctx, battle, ids[0]!, card, null, undefined, undefined, {
      simulation: { distanceM: 1000, layer: 'a', onShot: shot => {
        if (shot.weapon.src !== 'drone') return
        shots.push(shot.weapon.shotDmg!)
        if (shots.length === 1) battle.units.player!.hp = { s: 0, a: 0, h: 0 }
      } },
    })
    expect(shots.length).toBeGreaterThanOrEqual(2)
    expect(shots[0]).toBe(droneShot(wing))
    expect(shots[1]).toBe(droneShot(createPlayerSpec(state, ctx, ids[1]!)!))
    expect(shots[0]).toBeGreaterThan(shots[1]!)
  })
})
