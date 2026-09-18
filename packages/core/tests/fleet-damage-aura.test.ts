/**
 * **全舰单发伤害光环（指挥舰「全舰单发伤害 +15%」）**——2026-09-13 船长口径：「提高全舰的单发伤害 15%」
 * （**取最高、不叠加**）；数据 = `ShipDef.fleetDamageBonusPct`（现只有陵卫指挥舰 `sh-wh-d-destroyer` 0.15）。
 *
 * ⚠ **本文件同时是 2026-09-17 那个真 BUG 的回归守卫**：光环原先只在 `startFleetBattleFor` 里乘进
 * «开战那一刻» 的规格，而战斗是**逐拍重建规格**的（`buildMyUnitSpecs` → `createPlayerSpec`，其不认识
 * `fleetDamageBonusPct`）⇒ 被乘过的值**一拍都没用上**（真引擎 A/B：每发均值 91.640 vs 91.640，比值 1.000）。
 * 修法 = 与谜质增益/捕获网/教学战加成/锁定全队光环同一处纪律：**在每拍重建处施加**。
 *
 * **读数口径（两条，实测各踩过一次）**：
 * ① `stats.meDmg` 是"实际扣掉的血"⇒ **敌舰被打死时两跑会双双收敛到敌舰满血**，拿合计值判断会**假阴性**；
 * ② 高血量夹具下拔河走不进射程（15 秒 `meHits = 0`）⇒ 必须**逐拍把距离钉住**。
 * ⇒ 本文件一律：敌我血量都抬高 ＋ 只跑 15 秒（双方都活着）＋ 钉距离 ＋ **只比每发均值**。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceBattleFor, startBattleFor, startFleetBattleFor } from '../src/combat'
import { addShipToFleet } from '../src/shipyard'
import type { SimContext } from '../src/types'
import type { ModuleDef } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function laserDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'laser', 0, { rack: 'high', damageType: 'plasma', maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 0.3, reloadMs: 600, dmgMult, cpuUse: 10, ammoPerEngagement: 20 })
}

const BIG = 200_000
/** 光环船（传了 `aura` 才带 `fleetDamageBonusPct`）与炮舰（2×必中激光）——两者除光环外逐字相同。
 *  ⚠ `tests/helpers.ts` 的 `ship()` 只收一小组可选字段 ⇒ 这里用展开补上光环字段（不动公共夹具）。 */
const deck = (id: string, aura?: number) => ({
  ...ship(id, { cpu: 300, slots: { high: 4, mid: 0, low: 0 }, shieldHp: BIG, armorHp: BIG, hullHp: BIG }),
  ...(aura !== undefined ? { fleetDamageBonusPct: aura } : {}),
})

function world(opts: { leadAura?: number; wingAura?: number; solo?: boolean }): {
  state: ReturnType<typeof createInitialState>
  ctx: SimContext
  ids: string[]
} {
  const ctx: SimContext = makeTestCtx({
    ships: [deck('aura', opts.leadAura), deck('wing', opts.wingAura)],
    modules: [laserDef('mod-laser-3', 6)],
    anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 1200 })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const lead = addShipToFleet(state, 'aura')
  const wing = addShipToFleet(state, 'wing')
  state.shipId = lead
  state.fleet[lead]!.fitted = { high: ['mod-laser-3', 'mod-laser-3', null, null], mid: [], low: [] }
  state.fleet[wing]!.fitted = { high: ['mod-laser-3', 'mod-laser-3', null, null], mid: [], low: [] }
  state.moduleBay['mod-laser-3'] = 4
  state.warehouse.items['ammo-plasma-l'] = 50_000
  return { state, ctx, ids: opts.solo ? [lead] : [lead, wing] }
}

/** 打 15 秒（双方都不死）：返回每发均值 */
function perHit(state: ReturnType<typeof createInitialState>, ctx: SimContext, ids: readonly string[]): number {
  const battle =
    ids.length === 1 ? startBattleFor(state, ctx, ids[0]!, 'ano-x', 0)! : startFleetBattleFor(state, ctx, ids, 'ano-x', 0)!
  for (let i = 0; i < 150; i++) {
    battle.distanceM = 1_000 // 钉距离（见文件头口径②）
    state.gameMs += 100
    advanceBattleFor(state, ctx, battle, ids[0]!, 'ano-x')
    if (battle.ended) break
  }
  expect(battle.ended, '双方有一方没活满 15 秒 ⇒ 本文件读数口径失效').toBeFalsy()
  return battle.stats.meDmg / Math.max(1, battle.stats.meHits)
}

describe('全舰单发伤害光环（指挥舰 +15%）', () => {
  it('**编队里平摊到每一艘**：光环船的 15% 让全队每发均值 ×1.15（同种子 A/B）', () => {
    const withAura = world({ leadAura: 0.15 })
    const plain = world({})
    const a = perHit(withAura.state, withAura.ctx, withAura.ids)
    const b = perHit(plain.state, plain.ctx, plain.ids)
    const ratio = a / b
    expect(ratio, `每发均值 ${a.toFixed(3)} / ${b.toFixed(3)} = ${ratio.toFixed(3)}`).toBeGreaterThan(1.1)
    expect(ratio, `每发均值 ${a.toFixed(3)} / ${b.toFixed(3)} = ${ratio.toFixed(3)}`).toBeLessThan(1.2)
  })

  it('**每拍都在**（BUG 回归）：第 2 拍之后开的火同样吃光环（不是"只有开战那一刻"）', () => {
    // 只跑 3 拍：若光环只写在开战规格上，开火（读每拍重建规格）那一侧一点都吃不到 ⇒ 比值 ≈1.000
    const run = (aura: number): number => {
      const { state, ctx, ids } = world({ leadAura: aura })
      const battle = startFleetBattleFor(state, ctx, ids, 'ano-x', 0)!
      for (let i = 0; i < 3; i++) {
        battle.distanceM = 1_000
        state.gameMs += 100
        advanceBattleFor(state, ctx, battle, ids[0]!, 'ano-x')
      }
      return battle.stats.meDmg / Math.max(1, battle.stats.meHits)
    }
    const ratio = run(0.15) / run(0)
    expect(ratio, `三拍内每发均值比 ${ratio.toFixed(3)}（应 ≈1.15；修前 = 1.000）`).toBeGreaterThan(1.1)
  })

  it('**取最高一份、不叠加**：两艘各带 15% ⇒ 全队仍是 ×1.15（不是 ×1.30）', () => {
    const both = world({ leadAura: 0.15, wingAura: 0.15 })
    const one = world({ leadAura: 0.15 })
    const a = perHit(both.state, both.ctx, both.ids)
    const b = perHit(one.state, one.ctx, one.ids)
    expect(a, `两艘光环 ${a.toFixed(3)} vs 一艘 ${b.toFixed(3)}`).toBe(b)
  })

  it('**僚舰带光环也照旧**：光环只在僚舰上 ⇒ 全队（含主控）都吃', () => {
    const wingOnly = world({ wingAura: 0.15 })
    const plain = world({})
    const ratio = perHit(wingOnly.state, wingOnly.ctx, wingOnly.ids) / perHit(plain.state, plain.ctx, plain.ids)
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeGreaterThan(1.1)
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeLessThan(1.2)
  })

  it('**单舰路径**：指挥舰单人出场时，光环对自己生效（全队 = 它自己）', () => {
    const solo = world({ leadAura: 0.15, solo: true })
    const plain = world({ solo: true })
    const ratio = perHit(solo.state, solo.ctx, solo.ids) / perHit(plain.state, plain.ctx, plain.ids)
    expect(ratio, `单舰每发均值比 ${ratio.toFixed(3)}`).toBeGreaterThan(1.1)
    expect(ratio, `单舰每发均值比 ${ratio.toFixed(3)}`).toBeLessThan(1.2)
  })

  it('**数据侧**：只有陵卫指挥舰带这个字段（值为 0.15），其余船一个都不带', () => {
    const ctx = makeTestCtx({ ships: [deck('aura', 0.15), deck('wing')] })
    expect(ctx.ships.get('aura')!.fleetDamageBonusPct).toBe(0.15)
    expect(ctx.ships.get('wing')!.fleetDamageBonusPct).toBeUndefined()
  })
})
