import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { advanceBattleFor, createPlayerSpec, pickMyUnitTarget, startBattleFor, thrusterPhase, unitThrusterCycle } from '../src/combat'
import { battleDeviceCyclesOf } from '../src/battleDeviceView'
import type { AnomalyDef, SimContext } from '../src/types'

const base = buildSimContext()
const card: AnomalyDef = {
  id: 'stealth-web-blink-test', name: '隐秘配装核查', galaxyId: 'galaxy-hub',
  threat: 20, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 600,
  tactic: 'orbit', foeFamily: 'A', description: '合成核查卡',
  ships: [{ count: 1, ship: {
    id: 'stealth-web-blink-foe', name: '核查靶舰', family: 'A', hullClassTier: 1,
    speedRatio: 1, hp: 40000, split: { s: .2, a: .55, h: .25 },
    shotDmg: 12, hitRate: 1, reloadMs: 1000, rangeMinM: 1, rangeMaxM: 30000,
    falloff: 1, dmgMix: { kinetic: 8, explosive: 2 }, tactic: 'orbit',
  } }], waves: [{ units: 1, hpShare: 1 }],
}
const ctx: SimContext = { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) }

function world(ship: string, web: boolean, blink: boolean, gun = false, drone = false, propulsion = false) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, ship)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: ['mod-stealth-3', ...(web ? ['mod-lair-web-h'] : []), ...(gun ? ['mod-turret-kin-3'] : [])],
    mid: [...(blink ? ['mod-lair-blink-r'] : []), ...(propulsion ? ['mod-prop-1'] : [])], low: [],
  }
  if (drone) state.fleet[uid]!.droneLoad = { 'drone-scout': 1 }
  state.warehouse.items['ammo-kinetic-l'] = 5000
  const spec = createPlayerSpec(state, ctx, uid)!
  const battle = startBattleFor(state, ctx, uid, card.id, 0)!
  expect(battle).toBeTruthy()
  battle.distanceM = 1000
  battle.myDesireM = 6000
  function step() {
    state.gameMs += 100
    advanceBattleFor(state, ctx, battle, uid, card.id)
  }
  function stealthView() {
    const current = createPlayerSpec(state, ctx, uid)!
    return battleDeviceCyclesOf(state, ctx, battle, [{ spec: current, shipId: uid, name: current.name }],
      unit => thrusterPhase(battle, ctx.balance.battle, unitThrusterCycle(unit, ctx.balance.battle)))
      .find(row => row.kind === 'stealth')!
  }
  return { state, uid, spec, battle, step, stealthView }
}

describe('捕获网与跃迁规避导致现形的核查', () => {
  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('普通舰：网=%s、规避=%s，支援装置不触发推进器隐秘互斥', (web, blink) => {
    const w = world('sh-whiteshark', web, blink)
    expect(base.modules.get('mod-lair-blink-r')!.slot).toBe('support')
    expect(base.modules.get('mod-lair-web-h')!.slot).toBe('support')
    expect(w.spec.stealthMs).toBe(30000)
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
    expect(w.stealthView().state).toBe('active')
    w.step()
    if (web) expect(w.battle.myWebs?.player?.targetTag).toBeTruthy()
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
  })

  it('普通舰投网并携带跃迁规避，10秒内仍隐秘且不被选为目标', () => {
    const w = world('sh-whiteshark', true, true)
    for (let i = 0; i < 100; i++) w.step()
    expect(w.battle.myWebs?.player?.targetTag).toBeTruthy()
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
    expect(w.battle.stats.meShots).toBe(0)
    expect(w.battle.stats.foeShots).toBe(0)
    expect(w.battle.meBlinks?.player).toBeUndefined()
    expect(pickMyUnitTarget(w.state, w.battle, [w.spec], 'random')).toBeNull()
    expect(w.stealthView().state).toBe('active')
  })

  it('普通舰另装真正推进器时仍在装配期失去隐秘窗口', () => {
    const w = world('sh-whiteshark', true, true, false, false, true)
    expect(base.modules.get('mod-prop-1')!.slot).toBe('propulsion')
    expect(w.spec.stealthMs).toBeUndefined()
    expect(w.battle.units.player!.stealthUntilMs).toBeUndefined()
    expect(w.stealthView().state).toBe('stopped')
    w.step()
    expect(w.battle.myWebs?.player?.targetTag).toBeTruthy()
    expect(w.battle.units.player!.stealthUntilMs).toBeUndefined()
  })

  it.each(['sh-nautilus', 'sh-wh-g-frigate'])('%s：投网不现形；30秒到期后受击才闪避', ship => {
    const w = world(ship, true, true)
    expect(w.spec.stealthMs).toBe(30000)
    for (let i = 0; i < 100; i++) w.step()
    expect(w.battle.myWebs?.player?.targetTag).toBeTruthy()
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
    expect(w.battle.stats.meShots).toBe(0)
    expect(w.battle.stats.foeShots).toBe(0)
    expect(w.battle.meBlinks?.player).toBeUndefined()
    expect(pickMyUnitTarget(w.state, w.battle, [w.spec], 'random')).toBeNull()
    expect(w.stealthView().state).toBe('active')
    for (let i = 0; i < 350 && !w.battle.meBlinks?.player; i++) w.step()
    const blinkAt = w.battle.meBlinkQueue?.player?.queuedMs
    expect(blinkAt).toBeDefined()
    expect(blinkAt!).toBeGreaterThanOrEqual(30000)
    expect(w.battle.units.player!.stealthUntilMs).toBeUndefined()
    expect(w.stealthView().state).toBe('used')
  })

  it('侦察舰主动开火即现形，不需要捕获网或闪避清除隐身', () => {
    const w = world('sh-nautilus', true, true, true)
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
    w.battle.units.player!.weapons = w.battle.units.player!.weapons.map(() => 0)
    w.step()
    expect(w.battle.myWebs?.player?.targetTag).toBeTruthy()
    expect(w.battle.stats.meShots).toBeGreaterThan(0)
    expect(w.battle.units.player!.stealthUntilMs).toBeUndefined()
    expect(w.battle.notices?.some(notice => notice.text === '隐秘行动结束：本舰开火现形')).toBe(true)
    expect(w.stealthView().state).toBe('used')
  })

  it('侦察舰只有无人机时，无人机首次开火同样会现形', () => {
    const w = world('sh-nautilus', true, true, false, true)
    expect(w.spec.weapons.some(weapon => weapon.src === 'drone')).toBe(true)
    expect(w.battle.units.player!.stealthUntilMs).toBe(30000)
    for (let i = 0; i < 200 && !w.battle.stats.meShots; i++) w.step()
    expect(w.battle.stats.meShots).toBeGreaterThan(0)
    expect(w.battle.lastTickGameMs).toBeLessThan(30000)
    expect(w.battle.units.player!.stealthUntilMs).toBeUndefined()
    expect(w.battle.notices?.some(notice => notice.text === '隐秘行动结束：本舰开火现形')).toBe(true)
  })
})
