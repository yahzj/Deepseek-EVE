import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { startBattleFor, advanceBattleFor, createPlayerSpec } from '../src/combat'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import type { AnomalyDef, FoeShipDef } from '../src/types'

const base = buildSimContext()
function fixture(current: number, desire: number, mounted = true, hit = true) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  state.shipId = addShipToFleet(state, 'sh-megalodon')
  state.fleet[state.shipId]!.fitted = { high: [], mid: mounted ? ['mod-lair-blink-r'] : [], low: [] }
  const enemy: FoeShipDef = { id: 'blink-target-foe', name: '闪现测试敌舰', family: 'A', hullClassTier: 4,
    hp: 1e9, split: { s: 1, a: 0, h: 0 }, speedRatio: 0, shotDmg: 1, gunCount: 1,
    reloadMs: 1000, rangeMinM: 1, rangeMaxM: 20000, hitRate: hit ? 1 : 0, falloff: 1,
    dmgMix: { kinetic: 1 }, tactic: 'orbit', desireRangeM: current }
  const card: AnomalyDef = { ...base.anomalies.get('ano-training')!, id: 'player-blink-test', waves: undefined, ships: [{ ship: enemy, count: 1 }] }
  const ship = base.ships.get('sh-megalodon')!
  const ctx = { ...base, ships: new Map(base.ships).set(ship.id, { ...ship, maxSpeedMps: 0 }),
    anomalies: new Map(base.anomalies).set(card.id, card), balance: { ...base.balance,
      battle: { ...base.balance.battle, hitMin: hit ? 1 : 0, hitMax: hit ? 1 : 0 } } }
  const battle = startBattleFor(state, ctx, state.shipId, card.id, 0, current)!
  battle.distanceM = current
  battle.myDesireM = desire
  const tick = (time: number) => { state.gameMs = time; advanceBattleFor(state, ctx, battle, state.shipId, card.id) }
  return { state, ctx, battle, tick }
}

describe('玩家闪现朝自身期望交距', () => {
  it.each([[1000, 7000, 1], [7000, 1000, -1], [3000, 3500, 1], [3500, 3000, -1]])('距离%i目标%i方向%i，延迟位移与单跳上限保留', (current, desire, direction) => {
    const f = fixture(current, desire)
    f.tick(100)
    const q = f.battle.meBlinkQueue!.player!
    expect(Math.sign(q.to - q.from)).toBe(direction)
    expect(Math.abs(q.to - q.from)).toBeLessThanOrEqual(2000)
    expect(Math.abs(q.to - desire)).toBeLessThan(Math.abs(q.from - desire))
    if (Math.abs(current - desire) < 2000) expect(q.to).toBe(desire)
    expect(q.moveAtMs).toBeGreaterThan(q.vanishMs)
    expect(q.appearMs - q.vanishMs).toBe(f.ctx.balance.battle.foeBlinkProcessMs)
    expect(f.battle.meBlinks!.player).toBe(q.queuedMs + 16000)
    expect(f.battle.distanceM).not.toBe(q.to)
    f.tick(500)
    expect(q.moved).toBe(true)
  })
  it.each([
    ['已在目标', 3000, 3000, true, true],
    ['未装件', 1000, 7000, false, true],
    ['未命中', 1000, 7000, true, false],
  ] as const)('%s不闪不耗冷却', (_case, current, desire, mounted, hit) => {
    const f = fixture(current, desire, mounted, hit)
    f.tick(100)
    expect(f.battle.meBlinks?.player).toBeUndefined()
    expect(f.battle.meBlinkQueue?.player).toBeUndefined()
  })
  it('冷却期再受击不刷新，结束后允许下一次触发', () => {
    const f = fixture(1000, 7000)
    f.tick(100)
    const until = f.battle.meBlinks!.player!
    for (let time = 200; time <= 15000; time += 100) f.tick(time)
    expect(f.battle.meBlinks!.player).toBe(until)
    f.battle.distanceM = 1000
    f.battle.myDesireM = 7000
    for (let time = 15100; time <= 17200; time += 100) f.tick(time)
    expect(f.battle.meBlinks!.player).toBeGreaterThan(until)
  })
  it('实际装备字段16秒，敌方12秒不变', () => {
    const f = fixture(1000, 7000)
    expect(createPlayerSpec(f.state, f.ctx, f.state.shipId)!.meBlink).toEqual({ distanceM: 2000, cooldownMs: 16000 })
    expect(FOE_MOUNTS[FOE_MOUNT_IDS.coronaBlink].blink!.cooldownMs).toBe(12000)
    expect(base.modules.get('mod-lair-blink-r')!.cpuUse).toBe(40)
  })
})
