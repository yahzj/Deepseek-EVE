import { describe, expect, it } from 'vitest'
import { battleFxArrivals, type BattleFxCursor } from '../../../apps/desktop/src/renderer/src/ui/battleFxCursor'
import { pushBattleFx } from '../src/combatFx'
import type { BattleState, BattleFx } from '../src/state'
import { createInitialState } from '../src/state'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/fleetBook'
import { startBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const event = (seq: number, atMs: number): BattleFx => ({ seq, atMs, tag: 'player', side: 'me', type: 'kinetic', hit: true })
const battle = (fx: BattleFx[] = []) => ({ startedAtGameMs: 0, lastTickGameMs: 1000, fxSeq: fx.length, fx })
describe('战斗演出按场续播', () => {
  it('同场序号续播、只播一次，首个seq0不丢', () => {
    const b = battle([event(0, 1000)]), cursor: BattleFxCursor = { seq: -1 }
    expect(battleFxArrivals(cursor, b).events).toEqual(b.fx)
    expect(battleFxArrivals(cursor, b).events).toEqual([])
    b.fx.push(event(1, 1010))
    expect(battleFxArrivals(cursor, b).events).toEqual([b.fx[1]])
  })
  it('跨场不沿用旧999游标，同场读档换对象也重置', () => {
    const old = battle([event(999, 1000)]), cursor: BattleFxCursor = { seq: -1 }
    battleFxArrivals(cursor, old)
    const fresh = battle([event(0, 1000)])
    expect(battleFxArrivals(cursor, fresh)).toEqual({ reset: true, events: fresh.fx })
    const reload = battle([event(0, 1000)])
    expect(battleFxArrivals(cursor, reload).events).toEqual(reload.fx)
  })
  it('同对象序号回退重置；隐藏久后不补播陈旧事件', () => {
    const b = battle([event(999, 1000)]), cursor: BattleFxCursor = { seq: -1 }
    battleFxArrivals(cursor, b)
    b.fx = [event(0, 1000)]
    expect(battleFxArrivals(cursor, b).reset).toBe(true)
    b.lastTickGameMs = 5000
    b.fx.push(event(1, 1100), event(2, 5000))
    expect(battleFxArrivals(cursor, b).events).toEqual([b.fx[2]])
  })
  it('倍速播放窗口按游戏时间放大，现实200ms不变', () => {
    const b = { ...battle([event(0, 500), event(1, 1000)]), speedX: 4 }
    expect(battleFxArrivals({ seq: -1 }, b).events).toHaveLength(2)
  })
  it('跨10ms子步保留72发到界面读取，仍保有512硬上限', () => {
    const b = battle() as BattleState
    for (let i = 0; i < 64; i++) pushBattleFx(b, { atMs: 10, tag: 'player', side: 'me', type: 'kinetic', hit: true })
    for (let i = 0; i < 8; i++) pushBattleFx(b, { atMs: 20, tag: 'foe-0', side: 'foe', type: 'kinetic', hit: true })
    expect(b.fx).toHaveLength(72)
    for (let i = 0; i < 600; i++) pushBattleFx(b, { atMs: 30 + i, tag: 'player', side: 'me', type: 'kinetic', hit: true })
    expect(b.fx).toHaveLength(512)
    pushBattleFx(b, { atMs: 5000, tag: 'player', side: 'me', type: 'kinetic', hit: true })
    expect(b.fx).toHaveLength(48)
  })
  it('读档不丢机型、武器来源、目标和机制标记，新事件继续续播', () => {
    const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 19 })
    state.shipId = addShipToFleet(state, 'sh-nautilus')
    const b = startBattleFor(state, ctx, state.shipId, 'ano-training', 0)!
    pushBattleFx(b, { atMs: 1000, side: 'me', tag: 'player', type: 'kinetic', hit: true, to: 'foe-0', src: 'drone',
      artId: 'drone-scout', droneDown: true, pd: true, web: true, blink: true, speedX: 4 })
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(back.fx[0]).toMatchObject({ src: 'drone', artId: 'drone-scout', to: 'foe-0', droneDown: true, pd: true,
      web: true, blink: true, speedX: 4 })
  })
})
