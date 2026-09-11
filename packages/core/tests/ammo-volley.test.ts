/**
 * 弹药齐射扣弹（2026-09-11 修复；船长反馈「多个武器开火只消耗一次弹药」）
 *
 * 根因：同 id 同参炮台/激光在构建期被合并为「×N 齐射」**一条**武器条目（避免 UI 弧线爆炸），
 * 但开火循环里每轮只 `-1` 发弹药 → 5 门炮一轮齐射只吃掉 1 发，等于白嫖弹药。
 *
 * 本文件锁定三条不变量：
 * 1. **一轮齐射按门数扣弹**（炮台与激光同口径）——用「同卡同种子、N 门 vs 1 门」对照：
 *    两者装填相同 → 全程开火轮数相同 → 耗弹应正好是 N 倍；
 * 2. **出发预载按门数放大**（否则多门船会在战斗中途莫名打光）；
 * 3. **余弹不足一轮齐射 → 该武器停火**（不发射、也不扣余弹）。
 *
 * 注：每条船恒带一条「基础舰炮」（kind=fixed、不耗弹），故断言一律基于**耗弹量**与
 * 「有炮 / 无炮」的对照，不用 `stats.meShots` 总数（它把基础舰炮的开火也算进去）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceBattleFor, ammoLoadTotals, createPlayerSpec, startBattleFor } from '../src/combat'
import { fitModule, repairDeprecatedModules } from '../src/equipment'
import type { AnomalyDef, DamageType, ModuleSlot } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function bedCtx(mods: ReturnType<typeof moduleDef>[]) {
  const bed = ship('bed', {
    cpu: 500,
    slots: { high: 8, mid: 2, low: 4 },
    droneBayM3: 0,
    powerBonus: 0,
    evasion: 0.1,
  })
  return makeTestCtx({ ships: [bed], modules: mods })
}
type BedCtx = ReturnType<typeof bedCtx>

function gunDef(
  id: string,
  reloadMs = 2000,
  type: DamageType = 'kinetic',
  slot: ModuleSlot = 'turret',
): ReturnType<typeof moduleDef> {
  return moduleDef(id, slot, 0, {
    rack: 'high',
    damageType: type,
    maxRangeM: 5000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 1, // 无距离衰减：结果只与门数有关
    reloadMs,
    dmgMult: 0.05, // 极低单发：保证谁都打不死谁 → 全程打满，两种门数的开火轮数一致
    cpuUse: 10,
  })
}

/** 床船 + n 件同型炮（弹药由调用方给足） */
function bedWithGuns(n: number, def: ReturnType<typeof moduleDef>, ammoId = 'ammo-kinetic-l', ammoStock = 20_000) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const ctx = bedCtx([def])
  state.fleet[state.shipId]!.defId = 'bed'
  repairDeprecatedModules(state, ctx)
  if (n > 0) {
    state.moduleBay[def.id] = n
    for (let i = 0; i < n; i++) expect(fitModule(state, def.id, ctx).ok).toBe(true)
  }
  state.warehouse.items[ammoId] = ammoStock
  return { state, ctx }
}

/** 不可击杀的弱敌：威胁低（打不死玩家）但血极高（玩家打不死它）→ 战斗打满全程 */
function endlessFoe(): AnomalyDef {
  const base = anomaly('ano-x', 'galaxy-hub', { threat: 20, reward: 50_000 })
  return { ...base, foeHpOverride: 1_000_000_000 }
}

function runBattle(
  state: ReturnType<typeof createInitialState>,
  ctx: BedCtx,
): { consumed: number; meShots: number; foeHpLeft: number; loaded: number } {
  const ano = endlessFoe()
  const c = { ...ctx, anomalies: new Map([...ctx.anomalies, [ano.id, ano]]) }
  const battle = startBattleFor(state, c, state.shipId, ano.id, 0)!
  const loaded = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  state.gameMs = c.balance.battle.maxBattleMs + 5_000
  advanceBattleFor(state, c, battle, state.shipId, ano.id)
  const left = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const foe = battle.units['foe-0']
  return {
    consumed: loaded - left,
    meShots: battle.stats.meShots,
    foeHpLeft: foe ? foe.hp.s + foe.hp.a + foe.hp.h : 0,
    loaded,
  }
}

describe('弹药齐射扣弹（2026-09-11 修复）', () => {
  it('炮台：5 门同型齐射的耗弹量 = 1 门的 5 倍（修复前是 1 倍）', () => {
    const def = gunDef('mod-gun-1')
    const one = bedWithGuns(1, def)
    const five = bedWithGuns(5, def)
    // 条目形态：同型合并为一条并带门数
    const spec5 = createPlayerSpec(five.state, five.ctx, five.state.shipId)!
    const guns = spec5.weapons.filter((w) => w.kind === 'gun')
    expect(guns).toHaveLength(1)
    expect(guns[0]!.count).toBe(5)

    const r1 = runBattle(one.state, one.ctx)
    const r5 = runBattle(five.state, five.ctx)
    expect(r1.consumed).toBeGreaterThan(0)
    // 全程打满 → 两者轮数相同 → 耗弹正好 5 倍（旧口径下这里会是 1:1）
    expect(r5.consumed).toBe(r1.consumed * 5)
  })

  it('激光同口径：3 门激光齐射的耗弹量 = 1 门的 3 倍', () => {
    const laser = gunDef('mod-laser-1', 2000, 'plasma', 'laser')
    const one = bedWithGuns(1, laser, 'ammo-plasma-l')
    const three = bedWithGuns(3, laser, 'ammo-plasma-l')
    const spec3 = createPlayerSpec(three.state, three.ctx, three.state.shipId)!
    const beams = spec3.weapons.filter((w) => w.kind === 'beam')
    expect(beams).toHaveLength(1)
    expect(beams[0]!.count).toBe(3)
    const r1 = runBattle(one.state, one.ctx)
    const r3 = runBattle(three.state, three.ctx)
    expect(r1.consumed).toBeGreaterThan(0)
    expect(r3.consumed).toBe(r1.consumed * 3)
  })

  it('出发预载按门数放大：5 门炮的预载 = 1 门的 5 倍', () => {
    const def = gunDef('mod-gun-1')
    const one = bedWithGuns(1, def)
    const five = bedWithGuns(5, def)
    const bal = one.ctx.balance.battle
    const need1 = ammoLoadTotals(createPlayerSpec(one.state, one.ctx, one.state.shipId)!, bal, one.state).kinetic ?? 0
    const need5 = ammoLoadTotals(createPlayerSpec(five.state, five.ctx, five.state.shipId)!, bal, five.state).kinetic ?? 0
    expect(need1).toBeGreaterThan(0)
    expect(need5).toBe(need1 * 5)
  })

  it('余弹不足一轮齐射 → 该武器停火：与"不带炮"打出的战果完全一致，且不扣余弹', () => {
    const def = gunDef('mod-gun-1')
    // 仓库只有 3 发，而 5 门炮一轮需要 5 发
    const armed = bedWithGuns(5, def, 'ammo-kinetic-l', 3)
    const bare = bedWithGuns(0, def, 'ammo-kinetic-l', 0)
    const rArmed = runBattle(armed.state, armed.ctx)
    const rBare = runBattle(bare.state, bare.ctx)
    expect(rArmed.loaded).toBe(3) // 预载受库存上限约束
    expect(rArmed.consumed).toBe(0) // 一发未耗（不打半个齐射）
    expect(rArmed.foeHpLeft).toBe(rBare.foeHpLeft) // 该炮台零伤害 → 战果等同无炮
  })
})
