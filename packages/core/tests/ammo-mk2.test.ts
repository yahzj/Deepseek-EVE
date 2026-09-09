/**
 * 弹药 MK2（2026-09-09 船长拍板，docs/design/ammo-mk2-20260909.md）：
 * - 出战前选档：装配档位（ammoPref）决定本场弹种，开战预载按档、连打/离线同源；
 * - 配置档库存不足 → 整族回退基础弹 + 日志（不卡远征）；
 * - battle.ammoIds 记录实装弹 id——推进/退还/视图与实际弹种对齐（退还按 id 原样退回）；
 * - 单发伤害 = 实装弹药卡的 dmg 基数（MK2 > 基础）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import type { ModuleDef } from '../src/types'
import { advanceBattleFor, createPlayerSpec, refundAmmo, startBattleFor } from '../src/combat'
import { setAmmoTier } from '../src/equipment'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function kinGunDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'turret', 0, { rack: 'high', damageType: 'kinetic', maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 0.3, reloadMs: 600, dmgMult, cpuUse: 10, ammoPerEngagement: 20 })
}

function laserDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'laser', 0, { rack: 'high', damageType: 'plasma', maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 0.3, reloadMs: 600, dmgMult, cpuUse: 10, ammoPerEngagement: 20 })
}

/** 床船（高槽 4）：动能炮 ×2（或激光）；ammoPref 可覆盖；仓库弹药可定制 */
function world(opts: { threat?: number; pref?: Record<string, string> | null; kinStock?: Record<string, number>; laser?: boolean } = {}) {
  const bed = {
    ...ship('bed', { cpu: 300, slots: { high: 4, mid: 2, low: 2 }, powerBonus: 0.2 }),
    shieldHp: 3000,
    armorHp: 1000,
    hullHp: 1000,
  }
  const items = [
    { id: 'ammo-kinetic-2', name: '动能弹 MK2', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 45, description: '测试用', damageType: 'kinetic', dmg: 8 },
    { id: 'ammo-plasma-2', name: '能量弹药 MK2', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 80, description: '测试用', damageType: 'plasma', dmg: 12 },
  ] as const
  const kin = kinGunDef('mod-kin-3', 4)
  const las = laserDef('mod-las-3', 4)
  const ctx = makeTestCtx({
    ships: [bed],
    modules: opts.laser ? [las] : [kin],
    items: [...items],
    anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: opts.threat ?? 12 })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.fleet[state.shipId]!.defId = 'bed'
  state.fleet[state.shipId]!.fitted = opts.laser
    ? { high: ['mod-las-3', null, null, null], mid: [], low: [] }
    : { high: ['mod-kin-3', 'mod-kin-3', null, null], mid: [], low: [] }
  if (opts.laser) state.moduleBay['mod-las-3'] = 1
  else state.moduleBay['mod-kin-3'] = 2
  state.warehouse.items['ammo-kinetic-l'] = opts.kinStock?.['ammo-kinetic-l'] ?? 0
  state.warehouse.items['ammo-kinetic-2'] = opts.kinStock?.['ammo-kinetic-2'] ?? 0
  state.warehouse.items['ammo-plasma-l'] = 20_000
  state.warehouse.items['ammo-plasma-2'] = 20_000
  if (opts.pref) state.fleet[state.shipId]!.ammoPref = { ...opts.pref }
  return { state, ctx }
}

function runToEnd(state: GameState, ctx: SimContext, battle: ReturnType<typeof startBattleFor>): void {
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
  advanceBattleFor(state, ctx, battle!, state.shipId, 'ano-x')
  expect(battle!.ended).toBe('me')
}

/** 快照指定船动能炮单发（createPlayerSpec 同源口径） */
function kineticShot(state: GameState, ctx: SimContext, override?: Record<string, string>): number {
  const spec = createPlayerSpec(state, ctx, state.shipId, override as never)
  const w = spec!.weapons.find((x) => x.kind === 'gun')!
  return Object.values(w.shotsByType ?? {})[0] ?? 0
}

describe('弹药 MK2（2026-09-09）', () => {
  it('档位 = MK2 且库存充足：开战预载 MK2（ammoIds 记录），整场打完并原样退还 MK2', () => {
    const { state, ctx } = world({ pref: { kinetic: 'ammo-kinetic-2' }, kinStock: { 'ammo-kinetic-2': 50_000 } })
    const prefId = state.fleet[state.shipId]!.ammoPref!.kinetic!
    expect(prefId).toBe('ammo-kinetic-2')
    const battle = startBattleFor(state, ctx as SimContext, state.shipId, 'ano-x', 0)!
    expect(battle.ammo.kin).toBeGreaterThan(0)
    expect(battle.ammoIds?.kinetic).toBe('ammo-kinetic-2')
    expect(state.logs.some((l) => l.text.includes('库存不足'))).toBe(false)
    const before = state.warehouse.items['ammo-kinetic-2'] ?? 0
    runToEnd(state, ctx as SimContext, battle)
    expect(battle.ammo.kin).toBeGreaterThan(0)
    // 退还按实装 id（MK2）原样回仓
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items['ammo-kinetic-2']!).toBe(before + battle.ammo.kin)
    expect(state.warehouse.items['ammo-kinetic-l'] ?? 0).toBe(0)
  })

  it('MK2 库存不足：整族回退基础弹 + 日志提示；实装 id = 基础；退还回基础', () => {
    const { state, ctx } = world({ pref: { kinetic: 'ammo-kinetic-2' }, kinStock: { 'ammo-kinetic-l': 50_000 } })
    const battle = startBattleFor(state, ctx as SimContext, state.shipId, 'ano-x', 0)!
    expect(battle.ammo.kin).toBeGreaterThan(0)
    expect(battle.ammoIds?.kinetic).toBe('ammo-kinetic-l') // 回退写基础 id
    expect(state.logs.some((l) => l.text.includes('库存不足') && l.text.includes('本场改用'))).toBe(true)
    const beforeBase = state.warehouse.items['ammo-kinetic-l'] ?? 0
    runToEnd(state, ctx as SimContext, battle)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items['ammo-kinetic-l']!).toBe(beforeBase + battle.ammo.kin)
  })

  it('单发伤害按实装弹档：MK2 ≈ 基础 ×(8/6)；回退局推进重建按基础口径（同种子与无档对照一致）', () => {
    // 快照口径：pref(MK2) 单发 > 基础 ×1.2
    const mk2 = world({ pref: { kinetic: 'ammo-kinetic-2' }, kinStock: { 'ammo-kinetic-2': 50_000 } })
    const base = world({ kinStock: { 'ammo-kinetic-l': 50_000 } })
    const mk2Shot = kineticShot(mk2.state, mk2.ctx as SimContext)
    const baseShot = kineticShot(base.state, base.ctx as SimContext)
    expect(mk2Shot).toBeGreaterThan(baseShot * 1.2)
    expect(mk2Shot).toBeLessThan(baseShot * 1.6)
    // 回退局：battle.ammoIds 覆盖 → 推进重建按基础口径（统计与"无档基础对照"同种子相等）
    const fallback = world({ pref: { kinetic: 'ammo-kinetic-2' }, kinStock: { 'ammo-kinetic-l': 50_000 } })
    const control = world({ kinStock: { 'ammo-kinetic-l': 50_000 } })
    const bF = startBattleFor(fallback.state, fallback.ctx as SimContext, fallback.state.shipId, 'ano-x', 0)!
    const bC = startBattleFor(control.state, control.ctx as SimContext, control.state.shipId, 'ano-x', 0)!
    expect(bF.ammoIds?.kinetic).toBe('ammo-kinetic-l')
    runToEnd(fallback.state, fallback.ctx as SimContext, bF)
    runToEnd(control.state, control.ctx as SimContext, bC)
    expect(bF.stats.meDmg).toBeGreaterThan(0)
    expect(bF.stats.meDmg).toBe(bC.stats.meDmg) // 同种子同口径：回退局 ≡ 基础局
  })

  it('激光族同样按档（能量弹药 MK2）；默认无档 = 零迁移走基础、battle.ammoIds 不写', () => {
    const mk2 = world({ laser: true, pref: { plasma: 'ammo-plasma-2' } })
    const b1 = startBattleFor(mk2.state, mk2.ctx as SimContext, mk2.state.shipId, 'ano-x', 0)!
    expect(b1.ammo.pla).toBeGreaterThan(0)
    expect(b1.ammoIds?.plasma).toBe('ammo-plasma-2')
    // 无档旧档语义：基础弹、不写 ammoIds
    const plain = world({ laser: true })
    const b2 = startBattleFor(plain.state, plain.ctx as SimContext, plain.state.shipId, 'ano-x', 0)!
    expect(b2.ammo.pla).toBeGreaterThan(0)
    expect(b2.ammoIds).toBeUndefined()
    expect(plain.state.logs.some((l) => l.text.includes('库存不足'))).toBe(false)
  })

  it('setAmmoTier：设档 / 恢复基础（null）/ 跨族与非法物品拒绝', () => {
    const { state, ctx } = world({ kinStock: { 'ammo-kinetic-2': 100 } })
    const r1 = setAmmoTier(state, ctx as SimContext, 'kinetic', 'ammo-kinetic-2')
    expect(r1.ok).toBe(true)
    expect(state.fleet[state.shipId]!.ammoPref?.kinetic).toBe('ammo-kinetic-2')
    // 跨族拒绝
    const bad = setAmmoTier(state, ctx as SimContext, 'kinetic', 'ammo-explosive-2')
    expect(bad.ok).toBe(false)
    // 恢复基础（删键）
    const r2 = setAmmoTier(state, ctx as SimContext, 'kinetic', null)
    expect(r2.ok).toBe(true)
    expect(state.fleet[state.shipId]!.ammoPref).toBeUndefined()
  })
})
