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
import { advanceBattleFor, ammoLoadTotals, battleArcsFor, createPlayerSpec, startBattleFor } from '../src/combat'
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

/**
 * **弹种归属：一门武器只用自己的那一型弹**（**2026-09-24 船长转述玩家反馈**：
 * 「他的**动能武器和高爆打能量弹药**」）。
 *
 * 排查结论：**引擎侧没有错配**——该观感的真因是**界面伤害类型徽标配色错位**
 * （`app-d-*` 那套按"层位"配色：动能→盾蓝、能量→结构黄，与弹药徽标的"类型色"正好相反，
 * 玩家把蓝色那枚读成了能量弹；见 `tools/dmg-color-check.ts` 与 `styles.css` 的口径注释）。
 *
 * 本条把"引擎侧确实没错"钉死：**动能炮 → kin · 高爆导弹 → exp · 激光 → pla**，
 * 预载只装本型、开火也只扣本型（其余两桶全程一动不动）。
 */
describe('弹种归属：动能 / 高爆 / 能量各进各的桶（玩家反馈的引擎侧对照）', () => {
  const CASES = [
    { id: 'w-kin', type: 'kinetic' as DamageType, slot: 'turret' as ModuleSlot, key: 'kin' as const, ammo: 'ammo-kinetic-l' },
    { id: 'w-exp', type: 'explosive' as DamageType, slot: 'missile' as ModuleSlot, key: 'exp' as const, ammo: 'ammo-explosive-l' },
    { id: 'w-pla', type: 'plasma' as DamageType, slot: 'laser' as ModuleSlot, key: 'pla' as const, ammo: 'ammo-plasma-l' },
  ]
  const KEYS = ['kin', 'exp', 'pla'] as const

  for (const c of CASES) {
    it(`${c.slot}（${c.type}）⇒ 只预载与只消耗 ${c.key}`, () => {
      const { state, ctx } = bedWithGuns(1, gunDef(c.id, 2000, c.type, c.slot), c.ammo)
      const ano = endlessFoe()
      const c2 = { ...ctx, anomalies: new Map([...ctx.anomalies, [ano.id, ano]]) }
      const battle = startBattleFor(state, c2, state.shipId, ano.id, 0)!
      // ① 预载：只有本型的桶非零
      for (const k of KEYS) {
        if (k === c.key) expect(battle.ammo[k], `${c.id} 应预载 ${c.key}`).toBeGreaterThan(0)
        else expect(battle.ammo[k], `${c.id} 不该有 ${k} 弹`).toBe(0)
      }
      // ② 开火：只扣本型，其余两桶一发不动
      const before = { ...battle.ammo }
      state.gameMs = 30_000
      advanceBattleFor(state, c2, battle, state.shipId, ano.id)
      expect(battle.ammo[c.key], `${c.id} 开火应扣 ${c.key}`).toBeLessThan(before[c.key])
      for (const k of KEYS) {
        if (k !== c.key) expect(battle.ammo[k], `${c.id} 不该动 ${k} 桶`).toBe(before[k])
      }
    })
  }
})

/**
 * **武器弹种徽标 = 这件武器自己的那一型**（**2026-09-24 船长报障（玩家截图）**：
 * 「攻坚炮台 MK3·动能型后面写着的是**能量弹药**，巡航导弹架 MK3 也写着」）。
 *
 * 根因：`battleArcsFor` 给**每一门炮**的 `type` 取了 `nextAmmoType(battle.ammo)`——即**全船剩余最多的
 * 那一型**（旧单弹种时代的遗留口径）。于是只要船上能量弹占多数（装激光就会），**动能炮与导弹架的
 * 弹种徽标、射程弧颜色全被写成"能量"**。现改为按武器自己的 `shotsByType` 判（与 `stepBattle` 取弹同源），
 * 该型打光 ⇒ `null`（界面照既有口径显示"无弹/虚线弧"）。
 */
describe('武器弹种徽标按"自己那一型"报（船长 2026-09-24 玩家截图报障）', () => {
  it('混装船：能量弹占多数时，动能炮仍报 kinetic、导弹架仍报 explosive', () => {
    // 1 门动能炮（慢装填）+ 1 个导弹架 + 3 门激光（快装填）⇒ **能量弹预载必然占多数**（旧口径必错的条件）
    const gun = gunDef('w-kin-slow', 6000, 'kinetic', 'turret')
    const mis = gunDef('w-exp-slow', 6000, 'explosive', 'missile')
    const laser = gunDef('w-pla-fast', 1000, 'plasma', 'laser')
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = bedCtx([gun, mis, laser])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay[gun.id] = 1
    state.moduleBay[mis.id] = 1
    state.moduleBay[laser.id] = 3
    expect(fitModule(state, gun.id, ctx).ok).toBe(true)
    expect(fitModule(state, mis.id, ctx).ok).toBe(true)
    for (let i = 0; i < 3; i++) expect(fitModule(state, laser.id, ctx).ok).toBe(true)
    state.warehouse.items['ammo-kinetic-l'] = 20_000
    state.warehouse.items['ammo-explosive-l'] = 20_000
    state.warehouse.items['ammo-plasma-l'] = 20_000

    const ano = endlessFoe()
    const c = { ...ctx, anomalies: new Map([...ctx.anomalies, [ano.id, ano]]) }
    const battle = startBattleFor(state, c, state.shipId, ano.id, 0)!
    // 前提：能量弹确实多于动能弹（旧口径下"主流弹种"= 能量 ⇒ 每门炮都会被写成能量）
    expect(battle.ammo.pla).toBeGreaterThan(battle.ammo.kin)

    const arcs = battleArcsFor(state, c, { battle, anomaly: ano, leaderShipId: state.shipId })!
    const arcOf = (frag: string): (typeof arcs.me)[number] => {
      const a = arcs.me.find((x) => x.label.includes(frag))
      expect(a, `射程弧里应有 ${frag}`).toBeTruthy()
      return a!
    }
    expect(arcOf('w-kin-slow').type, '动能炮必须报 kinetic（界面据此写「动能弹药」）').toBe('kinetic')
    expect(arcOf('w-exp-slow').type, '导弹架必须报 explosive（界面据此写「爆破弹药」）').toBe('explosive')
    expect(arcOf('w-pla-fast').type, '激光报 plasma').toBe('plasma')

    // 该型打光 ⇒ 报 null（界面照既有口径显示"无弹/虚线弧"，不再借别型的弹假装有弹）
    battle.ammo.kin = 0
    const arcs2 = battleArcsFor(state, c, { battle, anomaly: ano, leaderShipId: state.shipId })!
    expect(arcs2.me.find((x) => x.label.includes('w-kin-slow'))!.type, '动能弹打光 ⇒ 不再报任何弹种').toBeNull()
    expect(arcs2.me.find((x) => x.label.includes('w-pla-fast'))!.type, '能量弹还有 ⇒ 激光照常报 plasma').toBe('plasma')
  })
})
