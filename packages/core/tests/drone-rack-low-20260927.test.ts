/**
 * 无人机扩舱件改归低槽（**2026-09-27 船长令**：「将扩大无人机舱的装备从高槽移动到低槽，掠袭机库的
 * 无人机舱扩展提高到 40」＋「反而 2 艘势力的无人机，需要将一个中槽移动到低槽」）。
 *
 * 口径：六件扩舱件 `rack = low`（战术导控 / 中继天线仍 `high`）；掠袭机库扩舱 30 → 40；
 * 机库无人机作战舰 4/2/4、巨构无人机作战舰 5/3/4（各挪一个中槽到低槽）；
 * 旧档里停在高/中槽的扩舱件由 `repairDeprecatedModules` 归位低槽（镜像"作业装备归位高槽"那条）。
 */
import { describe, expect, it } from 'vitest'
import { EN_MODULES, MODULES, SHIPS } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { countModule, repairDeprecatedModules } from '../src/equipment'
import { rackOf } from '../src/labels'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const RACK_IDS = [
  'mod-drone-rack-1',
  'mod-drone-rack-2',
  'mod-drone-rack-3',
  'mod-lair-hangar-e',
  'mod-wh-a-hangar',
  'mod-wh-g-hangar',
] as const

describe('无人机扩舱件改归低槽（2026-09-27）', () => {
  it('六件扩舱件 rack = low，且与 rackOf 推导一致', () => {
    for (const id of RACK_IDS) {
      const def = MODULES.find((m) => m.id === id)!
      expect(def.slot, id).toBe('drone-rack')
      expect(def.rack, id).toBe('low')
      expect(rackOf(def), `${id} 的 rackOf`).toBe('low')
    }
  })

  it('默认口径：drone-rack 归低槽；战术导控与中继天线仍归高槽', () => {
    expect(rackOf({ slot: 'drone-rack' })).toBe('low')
    expect(rackOf({ slot: 'drone-tac' })).toBe('high')
    expect(rackOf({ slot: 'drone-relay' })).toBe('high')
  })

  it('掠袭机库：扩舱 30 → 40，说明中英同步', () => {
    const def = MODULES.find((m) => m.id === 'mod-wh-a-hangar')!
    expect(def.droneBayBonusM3).toBe(40)
    expect(def.description).toContain('扩展无人机舱')
    expect(EN_MODULES['mod-wh-a-hangar']?.description).toContain('drone bay capacity')
  })

  it('两艘无人机专用舰：各挪一个中槽到低槽，槽位总数不变', () => {
    const des = SHIPS.find((s) => s.id === 'sh-wh-e-destroyer')!
    const car = SHIPS.find((s) => s.id === 'sh-wh-e-carrier')!
    expect(des.slots).toEqual({ high: 4, mid: 2, low: 4 }) // T2 专属 = 10 槽
    expect(car.slots).toEqual({ high: 5, mid: 3, low: 4 }) // T3 专属 = 12 槽
    for (const s of [des, car]) {
      const sl = s.slots!
      expect(sl.high + sl.mid + sl.low, s.name).toBe([0, 7, 9, 11, 14, 18][s.tier!]! + 1)
    }
  })

  it('旧档归位：高槽里停着的扩舱件读档时搬进低槽', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 91 })
    const uid = addShipToFleet(state, 'sh-wh-e-destroyer')
    state.fleet[uid]!.fitted = {
      high: ['mod-drone-rack-3', 'mod-drone-tac-2', null, null],
      mid: [null, null, null],
      low: [null, null, null],
    }
    repairDeprecatedModules(state, ctx)
    const fitted = state.fleet[uid]!.fitted
    expect(fitted.low.filter(Boolean)).toEqual(['mod-drone-rack-3'])
    expect(fitted.high.filter(Boolean)).toEqual(['mod-drone-tac-2'])
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[uid]!.fitted.low.filter(Boolean)).toEqual(['mod-drone-rack-3'])
  })

  it('低槽满时腾位：从最后装上的那件往前找非扩舱件，退回装备库（件不丢）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 92 })
    const uid = addShipToFleet(state, 'sh-wh-e-carrier')
    state.fleet[uid]!.fitted = {
      high: [null, 'mod-drone-rack-2', null, null, null],
      mid: [null, null, null],
      low: ['mod-armor-exp-3', 'mod-cpu-3', 'mod-armor-exp-3', 'mod-cpu-3'], // 4/4 装满
    }
    state.moduleBay['mod-armor-exp-3'] = 0
    state.moduleBay['mod-cpu-3'] = 0
    repairDeprecatedModules(state, ctx)
    const fitted = state.fleet[uid]!.fitted
    // 低槽满 ⇒ 从最后装上的那件（位序最靠后的 mod-cpu-3）腾位，扩舱件搬进去；腾出的件退回装备库
    expect(fitted.low.filter(Boolean)).toEqual([
      'mod-armor-exp-3',
      'mod-cpu-3',
      'mod-armor-exp-3',
      'mod-drone-rack-2',
    ])
    expect(countModule(state, 'mod-cpu-3')).toBe(1)
    expect(fitted.high.filter(Boolean)).toEqual([])
  })
})
