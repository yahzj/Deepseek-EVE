import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/fleetBook'
import { createInitialState } from '../src/state'
import { advanceBattleFor, battleArcsFor, startBattleFor, startFleetBattleFor } from '../src/combat'
import { cleanBattle } from '../src/saveBattleClean'

const ctx = buildSimContext()
const card = ctx.anomalies.get('alien-main')!

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 611 })
  const fleet = [0, 1, 2].map(() => addShipToFleet(state, 'sh-megalodon'))
  state.shipId = fleet[0]!
  for (const shipId of fleet) state.fleet[shipId]!.fitted = { high: [], mid: [], low: [] }
  state.fleet[fleet[0]!]!.fitted.mid = ['mod-prop-1']
  state.fleet[fleet[1]!]!.fitted.mid = ['mod-mwd-1']
  const battle = startFleetBattleFor(state, ctx, fleet, card.id, 0, 9000)!
  const view = () => battleArcsFor(state, ctx, { battle, anomaly: card, leaderShipId: state.shipId })!
  return { state, fleet, battle, view }
}

describe('战斗视图逐舰加速状态', () => {
  it.each([[0, true, true], [9999, true, true], [10000, true, false], [60000, false, false],
    [70000, false, true], [120000, true, false]])('周期%s：长点火%s、短点火%s，无推进器不亮', (time, long, short) => {
    const { battle, view } = world()
    battle.lastTickGameMs = time
    expect(view().myUnits.map(unit => unit.boosting)).toEqual([long, short, false])
  })

  it('捕获网只关被钉舰点火，死亡或结束不显示，视图不改战斗和随机状态', () => {
    const { state, battle, view } = world()
    const tag = battle.myFleet![1]!.tag
    battle.meWebDebuffs = { [tag]: { byTag: 'foe-0', slowMul: .5, noThruster: true, noEvasion: true, rangeDownM: 1000, atMs: 0 } }
    const before = structuredClone(state)
    const beforeBattle = structuredClone(battle)
    expect(view().myUnits.map(unit => unit.boosting)).toEqual([true, false, false])
    expect(state).toEqual(before)
    expect(battle).toEqual(beforeBattle)
    const livingHp = { ...battle.units.player!.hp }
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    expect(view().myUnits.every(unit => !unit.boosting)).toBe(true)
    battle.units.player!.hp = livingHp
    expect(view().myUnits[0]!.boosting).toBe(true)
    battle.ended = 'foe'
    expect(view().myUnits.every(unit => !unit.boosting)).toBe(true)
  })

  it('单舰与编队用同一状态口，战斗重载按原时钟续算点火', () => {
    const { state } = world()
    const battle = startBattleFor(state, ctx, state.shipId, card.id, 0, 9000)!
    battle.lastTickGameMs = 45000
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle }
    expect(battleArcsFor(state, ctx)!.myUnits[0]!.boosting).toBe(true)
    state.expedition.battle = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(battleArcsFor(state, ctx)!.myUnits[0]!.boosting).toBe(true)
    state.expedition.battle.lastTickGameMs = 60000
    expect(battleArcsFor(state, ctx)!.myUnits[0]!.boosting).toBe(false)
  })

  it('真实冲锋只列正在冲的舰，死亡、关闭、冷却和结束均移除', () => {
    const { state, battle, view } = world()
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, card.id)
    const charging = Object.entries(battle.foeCharges!).filter(([, value]) => value.on).map(([tag]) => tag)
    expect(charging.length).toBeGreaterThan(1)
    expect(view().foeChargingTags).toEqual(charging)
    battle.foeCharges![charging[0]!] = { on: false, cdUntilMs: 10000 }
    battle.units[charging[1]!]!.hp = { s: 0, a: 0, h: 0 }
    expect(view().foeChargingTags).toEqual(charging.slice(2))
    battle.ended = 'me'
    expect(view().foeChargingTags).toEqual([])
  })
})
