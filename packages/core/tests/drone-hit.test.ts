/**
 * 无人机命中与衰减（2026-09-10 船长拍板）：
 * - 侦察/战斗/攻坚三型（蜂鸟/赤鸢/猎鹰）：基础命中 0.75 且**命中不随距离衰减**（falloff 1
 *   → 射程带内命中恒定）；
 * - 哨戒（雷鸥）：基础命中 1.10（近距被 100% 上限截断），**保留正常衰减** falloff 0.35
 *   （射程端点命中倍率）；
 * - 命中/衰减读机型本体（ItemDef.hitRate / falloff），combat 缺省兜底 0.6 / 0.35（旧档兼容）；
 * - 联动：中继天线延长射程带后，三型同距离命中不变（无衰减），哨戒同距离命中**上升**
 *   （衰减按 min→max 线性摊薄）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec, hitChance } from '../src/combat'
import { makeTestCtx, moduleDef, ship } from './helpers'
import type { BattleBalance, ItemDef } from '../src/types'

const DRONES_TEST: ItemDef[] = [
  { id: 'drone-scout', name: '蜂鸟', kind: 'drone', unitM3: 5, baseSellPriceIsk: 900, description: '测试', damageType: 'kinetic', dmg: 3, cpuUse: 4, maxRangeM: 2500, hitRate: 0.75, falloff: 1, defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 } },
  { id: 'drone-assault', name: '赤鸢', kind: 'drone', unitM3: 10, baseSellPriceIsk: 2200, description: '测试', damageType: 'explosive', dmg: 6, cpuUse: 7, maxRangeM: 3000, hitRate: 0.75, falloff: 1, defense: { shieldHp: 10, armorHp: 6, hullHp: 18, evasion: 0.4 } },
  { id: 'drone-heavy', name: '猎鹰', kind: 'drone', unitM3: 20, baseSellPriceIsk: 5000, description: '测试', damageType: 'plasma', dmg: 12, cpuUse: 11, maxRangeM: 3500, hitRate: 0.75, falloff: 1, defense: { shieldHp: 20, armorHp: 12, hullHp: 34, evasion: 0.32 } },
  { id: 'drone-sentry', name: '雷鸥', kind: 'drone', unitM3: 40, baseSellPriceIsk: 9500, description: '测试', damageType: 'plasma', dmg: 20, cpuUse: 16, maxRangeM: 5000, hitRate: 1.1, falloff: 0.35, defense: { shieldHp: 30, armorHp: 20, hullHp: 55, evasion: 0.25 } },
  // 旧档兼容：无 hitRate / falloff（应兜底 0.6 / 0.35）
  { id: 'drone-legacy', name: '旧型', kind: 'drone', unitM3: 10, baseSellPriceIsk: 100, description: '测试', damageType: 'kinetic', dmg: 5, cpuUse: 5, maxRangeM: 2600, defense: { shieldHp: 5, armorHp: 5, hullHp: 5, evasion: 0.3 } },
]

function world(opts: { relays?: string[]; load: Record<string, number> }) {
  const bed = {
    ...ship('bed', { cpu: 500, slots: { high: 6, mid: 2, low: 2 }, powerBonus: 0, droneBayM3: 320 }),
    shieldHp: 3000,
    armorHp: 1000,
    hullHp: 1000,
  }
  const mods = [
    moduleDef('mod-relay-1', 'drone-relay', 0, { rack: 'high', droneRangeBonusPct: 0.2, cpuUse: 6 }),
    moduleDef('mod-relay-3', 'drone-relay', 0, { rack: 'high', droneRangeBonusPct: 0.8, cpuUse: 38 }),
  ]
  const ctx = makeTestCtx({ ships: [bed], modules: mods, items: [...DRONES_TEST] })
  const state = createInitialState({ nowWallMs: 0, seed: 9 })
  state.fleet[state.shipId]!.defId = 'bed'
  state.fleet[state.shipId]!.fitted = {
    high: [...(opts.relays ?? []), null, null, null, null, null].slice(0, 6) as (string | null)[],
    mid: [],
    low: [],
  }
  for (const id of opts.relays ?? []) state.moduleBay[id] = 1
  state.fleet[state.shipId]!.droneLoad = { ...opts.load }
  return { state, ctx }
}

function weaponOf(
  state: ReturnType<typeof world>['state'],
  ctx: ReturnType<typeof world>['ctx'],
  name: string,
): { hitRate: number; falloff: number; maxRangeM: number; minRangeM: number } {
  const spec = createPlayerSpec(state, ctx as never, state.shipId)!
  const w = spec.weapons.find((x) => x.kind === 'fixed' && x.label === name)
  expect(w, `未找到放飞条目 ${name}`).toBeTruthy()
  return w as never
}

const FOE = { evasion: 0.12 }
const ME = { hitBonus: 0.16 } // 满技能近似（船体加成 × 瞄准集成）

describe('无人机命中与衰减（2026-09-10 船长拍板）', () => {
  it('三型命中/衰减入本体：0.75 且 falloff=1（不随距离衰减）', () => {
    const { state, ctx } = world({ load: { 'drone-scout': 1, 'drone-assault': 1, 'drone-heavy': 1 } })
    for (const name of ['蜂鸟', '赤鸢', '猎鹰']) {
      const w = weaponOf(state, ctx, name)
      expect(w.hitRate).toBe(0.75)
      expect(w.falloff).toBe(1)
    }
  })

  it('哨戒：基础命中 1.10、保留衰减 0.35', () => {
    const { state, ctx } = world({ load: { 'drone-sentry': 1 } })
    const w = weaponOf(state, ctx, '雷鸥')
    expect(w.hitRate).toBe(1.1)
    expect(w.falloff).toBe(0.35)
  })

  it('旧档兜底：机型缺 hitRate/falloff → 0.6 / 0.35（向后兼容）', () => {
    const { state, ctx } = world({ load: { 'drone-legacy': 1 } })
    const w = weaponOf(state, ctx, '旧型')
    expect(w.hitRate).toBe(0.6)
    expect(w.falloff).toBe(0.35)
  })

  it('三型命中不随距离：射程带内各距离命中恒等（= 0.75 + 攻方加成 − 回避）', () => {
    const { state, ctx } = world({ load: { 'drone-heavy': 1 } })
    const bal = ctx.balance.battle as BattleBalance
    const w = weaponOf(state, ctx, '猎鹰')
    const near = hitChance(w, ME, FOE, 500, bal)
    const mid = hitChance(w, ME, FOE, 2000, bal)
    const far = hitChance(w, ME, FOE, 3500, bal)
    expect(near).toBeCloseTo(0.75 + 0.16 - 0.12, 6)
    expect(mid).toBe(near)
    expect(far).toBe(near)
  })

  it('哨戒命中随距离下降：近距被 100% 上限截断，射程端点显著跌落', () => {
    const { state, ctx } = world({ load: { 'drone-sentry': 1 } })
    const bal = ctx.balance.battle as BattleBalance
    const w = weaponOf(state, ctx, '雷鸥')
    const near = hitChance(w, ME, FOE, 200, bal)
    const mid = hitChance(w, ME, FOE, 2500, bal)
    const far = hitChance(w, ME, FOE, 5000, bal)
    expect(near).toBe(1) // (1.10 + 0.16) × 1 − 0.12 = 1.14 → 上限 1
    expect(mid).toBeGreaterThan(far)
    expect(far).toBeCloseTo(Math.max(0, (1.1 + 0.16) * 0.35 - 0.12), 6)
  })

  it('联动：中继天线延长射程带后——三型同距离命中不变（79%），哨戒同距离命中上升', () => {
    const bal = () => world({ relays: [], load: {} }).ctx.balance.battle as BattleBalance
    const base = world({ load: { 'drone-heavy': 1, 'drone-sentry': 1 } })
    const relayed = world({ relays: ['mod-relay-3'], load: { 'drone-heavy': 1, 'drone-sentry': 1 } })
    const w0 = weaponOf(base.state, base.ctx, '猎鹰')
    const w1 = weaponOf(relayed.state, relayed.ctx, '猎鹰')
    expect(w1.maxRangeM).toBe(Math.round(3500 * 1.8))
    // 无衰减 → 拉长射程带不改变同距离命中
    expect(hitChance(w1, ME, FOE, 3000, bal())).toBe(hitChance(w0, ME, FOE, 3000, bal()))

    const s0 = weaponOf(base.state, base.ctx, '雷鸥')
    const s1 = weaponOf(relayed.state, relayed.ctx, '雷鸥')
    expect(s1.maxRangeM).toBe(9000)
    // 有衰减 → 射程带拉长，衰减按 min→max 摊薄，同距离命中上升
    expect(hitChance(s1, ME, FOE, 5000, bal())).toBeGreaterThan(hitChance(s0, ME, FOE, 5000, bal()))
  })
})
