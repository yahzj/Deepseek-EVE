/**
 * 新增中槽装备「无人机护盾投射仪」MK2 / MK3（**2026-09-27 船长令**）：
 * 「添加新的中槽装备，无人机护盾投射仪，效果是增加无人机的护盾值，只有 MK2 和 MK3，
 * 效果值为 +70% +100%」＋「MK3 蓝图放奇货」＋「MK3 成品留在普通稀有单」。
 *
 * 口径：新家族 `drone-shield`（**中槽**）；只加**放飞无人机的护盾层**，与耐久学/强化学乘算；
 * 多件**线性相加、不设上限**；市场两行成品（rare）+ 两张蓝图（MK2 rare / MK3 exotic）。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, EN_BLUEPRINTS, EN_MODULES, MARKET_GOODS, MODULES, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { stackingOf } from '../src/equipment'
import { createPlayerSpec, startBattleFor } from '../src/combat'
import { rackOf } from '../src/labels'

const ctx = buildSimContext()
const SHIP = 'sh-sentinel' // 王鲭 4 高 / 5 中 / 2 低
const LOAD = { 'drone-heavy': 2, 'drone-sentry': 2 }
const LOW = 'ano-pirate-post' // 低威胁、无点防
const HEAVY = 'drone-heavy' // 护盾 60 / 装甲 44 / 结构 90
const SENTRY = 'drone-sentry' // 护盾 16 / 装甲 10 / 结构 20

/** 王鲭船：中槽按 midIds 依次装上（其余留空） */
function worldWith(midIds: readonly string[]): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 41 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const mid: Array<string | null> = [null, null, null, null, null]
  midIds.forEach((id, i) => (mid[i] = id))
  state.fleet[uid]!.fitted = { high: [null, null, null, null], mid, low: [null, null] }
  state.fleet[uid]!.droneLoad = { ...LOAD }
  return { state, uid }
}

/** 起一场低威胁战斗，取机群生存池里某机型的 {s 护盾, a 装甲, h 结构} */
function poolOf(state: GameState, uid: string, artId: string): { s: number; a: number; h: number } {
  const battle = startBattleFor(state, ctx, uid, LOW, 0)
  expect(battle?.dronePools, '机群生存池应已建立').toBeTruthy()
  const entry = Object.values(battle!.dronePools!).find((p) => p.artId === artId)
  expect(entry, `${artId} 应有池条目`).toBeTruthy()
  return { s: entry!.s, a: entry!.a, h: entry!.h }
}

describe('无人机护盾投射仪 · 数据与槽位', () => {
  it('两件都是新家族 drone-shield，归中槽，字段 0.7 / 1.0，CPU 20 / 45', () => {
    for (const [id, per, cpu] of [
      ['mod-drone-shield-2', 0.7, 20],
      ['mod-drone-shield-3', 1.0, 45],
    ] as const) {
      const def = MODULES.find((m) => m.id === id)!
      expect(def.slot, id).toBe('drone-shield')
      expect(def.rack, id).toBe('mid')
      expect(rackOf(def), `${id} 的 rackOf`).toBe('mid')
      expect(def.droneShieldHpBonusPct, id).toBeCloseTo(per, 10)
      expect(def.cpuUse, id).toBe(cpu)
      expect(def.droneBayBonusM3, `${id} 不带扩舱`).toBeUndefined()
      expect(def.droneDmgBonus, `${id} 不带伤害`).toBeUndefined()
    }
  })

  it('收敛分组：加算线性（多件不衰减），与结构层同类待遇', () => {
    expect(stackingOf(MODULES.find((m) => m.id === 'mod-drone-shield-2')!)).toEqual({
      group: 'flat',
      kind: 'drone-shield',
    })
  })

  it('市场与蓝图：成品普通稀有；MK2 蓝图稀有、MK3 蓝图走奇货（书价 = 产物 ×4）', () => {
    const row = (refId: string) => MARKET_GOODS.find((r) => (r as { refId?: string }).refId === refId) as
      | { rarity: string; basePrice: number }
      | undefined
    expect(row('mod-drone-shield-2')).toMatchObject({ rarity: 'rare', basePrice: 450_000 })
    expect(row('mod-drone-shield-3')).toMatchObject({ rarity: 'rare', basePrice: 2_000_000 })
    expect(row('bp-drone-shield-2')).toMatchObject({ rarity: 'rare', basePrice: 1_125_000 })
    expect(row('bp-drone-shield-3')).toMatchObject({ rarity: 'exotic', basePrice: 8_000_000 })
    const bp2 = BLUEPRINTS.find((b) => b.id === 'bp-drone-shield-2')!
    const bp3 = BLUEPRINTS.find((b) => b.id === 'bp-drone-shield-3')!
    expect(bp2.moduleId).toBe('mod-drone-shield-2')
    expect(bp3.moduleId).toBe('mod-drone-shield-3')
    expect(bp2.priceIsk).toBe(1_125_000) // 450,000 ×2.5
    expect(bp3.priceIsk).toBe(8_000_000) // 2,000,000 ×4（奇货档）
    expect(bp2.buildSeconds).toBe(900)
    expect(bp3.buildSeconds).toBe(2000)
  })

  it('中英说明齐：中文含 +70% / +100%，英文含 ⟦70%⟧ / ⟦100%⟧', () => {
    expect(MODULES.find((m) => m.id === 'mod-drone-shield-2')!.description).toContain('+⟦70%⟧')
    expect(MODULES.find((m) => m.id === 'mod-drone-shield-3')!.description).toContain('+⟦100%⟧')
    expect(EN_MODULES['mod-drone-shield-2']?.description).toContain('⟦70%⟧')
    expect(EN_MODULES['mod-drone-shield-3']?.description).toContain('⟦100%⟧')
    expect(EN_BLUEPRINTS['bp-drone-shield-3']).toBeTruthy()
  })
})

describe('无人机护盾投射仪 · 战斗接线（只动护盾层）', () => {
  it('不装：护盾层就是机型基础值（猎鹰 60 · 哨戒 16）', () => {
    const { state, uid } = worldWith([])
    expect(createPlayerSpec(state, ctx, uid)!.droneShieldBonusPct).toBe(0)
    expect(poolOf(state, uid, HEAVY)).toEqual({ s: 60, a: 44, h: 90 })
    expect(poolOf(state, uid, SENTRY)).toEqual({ s: 16, a: 10, h: 20 })
  })

  it('装一件 MK2：护盾层 ×1.7；装甲与结构一个数都不动', () => {
    const { state, uid } = worldWith(['mod-drone-shield-2'])
    expect(createPlayerSpec(state, ctx, uid)!.droneShieldBonusPct).toBeCloseTo(0.7, 10)
    expect(poolOf(state, uid, HEAVY)).toEqual({ s: Math.round(60 * 1.7), a: 44, h: 90 })
    expect(poolOf(state, uid, SENTRY)).toEqual({ s: Math.round(16 * 1.7), a: 10, h: 20 })
  })

  it('MK2 + MK3 同装：线性相加 +170%（不设上限），护盾层 ×2.7', () => {
    const { state, uid } = worldWith(['mod-drone-shield-2', 'mod-drone-shield-3'])
    expect(createPlayerSpec(state, ctx, uid)!.droneShieldBonusPct).toBeCloseTo(1.7, 10)
    expect(poolOf(state, uid, HEAVY)).toEqual({ s: Math.round(60 * 2.7), a: 44, h: 90 })
    expect(poolOf(state, uid, SENTRY)).toEqual({ s: Math.round(16 * 2.7), a: 10, h: 20 })
  })
})
