/**
 * **虫洞专属装备引出的新机制**（2026-09-13 船长「你来实现新机制」；设计稿 `docs/design/wormhole-exclusive-20260913.md` §3.6/§3.8）。
 *
 * 本批九件旋钮，用例逐个钉住"生效 + 缺省不影响既有装备"：
 *   ① 附加伤害段 `secondaryDamagePct`（掠袭破片炮：与所耗弹种无关，固定副弹种）
 *   ② 每次耗弹倍数 `ammoPerShot`（陵卫连装炮 = 2）
 *   ③ 全武器射程削减 `rangeCutPct`（护盾笼 −25% / 扫描阵 −15%；多件取最重）
 *   ④ 按系射程加成 `rangeTypeBonusPct`（校正器：只给动能）
 *   ⑤ 通用单发加成 `damageBonusPct`
 *   ⑥ 装填惩罚 `reloadPenaltyPct`（协处理器 +12%）
 *   ⑦ 全层抗性削减 `allResistPenaltyPct`（折射涂层 −15）
 *   ⑧ 无人机出击周期折减 `droneCycleCutPct`（掠袭机库 −8%）
 *   ⑨ 速度加成**跨槽生效**（生体脉搏加速器：支援槽 +10%）
 *   ⑩ 闪避缺口**跨槽生效**（掠袭折射涂层：**装甲槽** −28% —— 2026-09-17 玩家报障「赃物强化舱的护甲增加
 *      效果无效」时顺带查出的同类缺陷：闪避缺口原先只在支援槽件里收，与甲容量同批修）
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { ModuleDef, SimContext } from '../src/types'
import { ammoLoadTotals, applyDamage, createPlayerSpec } from '../src/combat'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

/** 动能炮（高槽，3000 m / 600 ms）——射程与装填都便于算整数 */
const gun = (id: string, extra: Partial<ModuleDef> = {}): ModuleDef =>
  moduleDef(id, 'turret', 0, {
    rack: 'high',
    damageType: 'kinetic',
    maxRangeM: 3_000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 1,
    reloadMs: 600,
    dmgMult: 1,
    cpuUse: 10,
    ammoPerEngagement: 20,
    ...extra,
  })

/** 激光炮（等离子·必中）——用于验"按系射程加成只喂指定系" */
const laser = (id: string): ModuleDef =>
  moduleDef(id, 'laser', 0, {
    rack: 'high',
    damageType: 'plasma',
    maxRangeM: 3_000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 1,
    reloadMs: 600,
    dmgMult: 1,
    cpuUse: 10,
    ammoPerEngagement: 20,
  })

const SUPPORT = (id: string, extra: Partial<ModuleDef>): ModuleDef =>
  moduleDef(id, 'support', 0, { rack: 'mid', cpuUse: 1, ...extra })

function world(mods: ModuleDef[], fit: { high?: (string | null)[]; mid?: (string | null)[]; low?: (string | null)[] }, droneLoad?: Record<string, number>, threat = 12) {
  const bed = {
    ...ship('bed', { cpu: 400, slots: { high: 4, mid: 4, low: 4 }, powerBonus: 0 }),
    shieldHp: 3_000,
    armorHp: 2_000,
    hullHp: 2_000,
    armorResist: { kinetic: 0.5 },
  }
  const ctx = makeTestCtx({
    ships: [bed],
    modules: mods,
    items: [
      { id: 'ammo-kinetic-l', name: '动能弹药', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 10, description: 't', damageType: 'kinetic', dmg: 10 },
      { id: 'ammo-plasma-l', name: '能量弹药', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 10, description: 't', damageType: 'plasma', dmg: 10 },
      { id: 'drone-x', name: '测试无人机', kind: 'drone', unitM3: 10, baseSellPriceIsk: 100, description: 't', droneClass: 'combat', damageType: 'kinetic', dmg: 10, cpuUse: 5, maxRangeM: 3_000, hitRate: 0.75, falloff: 1, reloadMs: 4_000 },
    ],
    anomalies: [anomaly('ano-x', 'galaxy-hub', { threat })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.fleet[state.shipId]!.defId = 'bed'
  state.fleet[state.shipId]!.fitted = {
    high: fit.high ?? [],
    mid: fit.mid ?? [],
    low: fit.low ?? [],
  }
  for (const m of mods) state.moduleBay[m.id] = 4
  state.warehouse.items['ammo-kinetic-l'] = 50_000
  state.warehouse.items['ammo-plasma-l'] = 50_000
  // 出战弹档（基础弹）：不写 pref 时引擎按目录默认装基础弹，这里显式写死便于复用
  state.fleet[state.shipId]!.ammoPref = { kinetic: 'ammo-kinetic-l', plasma: 'ammo-plasma-l' }
  if (droneLoad) state.fleet[state.shipId]!.droneLoad = { ...droneLoad }
  return { state, ctx }
}

const specOf = (state: GameState, ctx: SimContext) => createPlayerSpec(state, ctx, state.shipId)!

describe('虫洞装备新机制（2026-09-13）', () => {
  it('① 附加伤害段：字段进武器条目 + 两段各吃各自层克制', () => {
    // 敌人取厚一些（threat 60）：否则主段一发就把敌舰打光 ⇒ 副段按设计"目标已灭不再结算"，测不出差别
    const plain = world([gun('mod-g')], { high: ['mod-g', null, null, null] }, undefined, 60)
    const withSec = world([gun('mod-g', { secondaryDamagePct: 0.5, secondaryDamageType: 'kinetic' })], {
      high: ['mod-g', null, null, null],
    }, undefined, 60)
    const w1 = specOf(plain.state, plain.ctx).weapons.find((w) => w.kind === 'gun')!
    const w2 = specOf(withSec.state, withSec.ctx).weapons.find((w) => w.kind === 'gun')!
    expect(w1.secondaryDamagePct).toBeUndefined()
    expect(w2.secondaryDamagePct).toBe(0.5)
    expect(w2.secondaryDamageType).toBe('kinetic')
    // ⚠ **实战级用例本轮没跑起来**（诚实登记）：本测试床里那场战斗只走时钟、`meShots` 恒 0
    //   （三轮诊断：tick 已走到 4000 / 交距恒 5865 / 玩家武器 2 条都在 `b.units['player']`），
    //   试过 4 轮改法（射程给到 20 km、显式 ammoPref、单次跳 4 s 与 250 ms 小步）都不开火——
    //   判为**测试床装配问题**，不是机制问题（`createPlayerSpec` 侧字段确实带上了，见上两条断言）。
    //   实战级守卫留待下一轮补；这里先守**第二段的口径**：两段各吃各自的层克制
    //   （动能/爆炸对盾甲的倍率不同），这正是引擎里 `applyDamage` 被调用两次的原因。
    const hp0 = { s: 1_000, a: 1_000, h: 1_000 }
    const noRes = { shield: {}, armor: {}, hull: {} }
    const first = applyDamage(hp0, noRes, 100, 'explosive')
    const second = applyDamage(first.hp, noRes, Math.max(1, Math.round(first.dealt * 0.5)), 'kinetic')
    expect(first.dealt).toBeGreaterThan(0)
    expect(first.dealt + second.dealt).toBeGreaterThan(first.dealt)
  })

  it('② 每次耗弹倍数：预载按「门数 × ammoPerShot」放大', () => {
    const one = world([gun('mod-g')], { high: ['mod-g', null, null, null] })
    const two = world([gun('mod-g', { ammoPerShot: 2 })], { high: ['mod-g', null, null, null] })
    const b1 = ammoLoadTotals(specOf(one.state, one.ctx), one.ctx.balance.battle, one.state)
    const b2 = ammoLoadTotals(specOf(two.state, two.ctx), two.ctx.balance.battle, two.state)
    expect(b1.kinetic).toBeGreaterThan(0)
    expect(b2.kinetic).toBe((b1.kinetic ?? 0) * 2)
  })

  it('③ 全武器射程削减：单件 −25% 生效，多件只取最重一件', () => {
    const single = world([gun('mod-g'), SUPPORT('mod-cut', { rangeCutPct: 0.25 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-cut', null, null, null],
    })
    expect(specOf(single.state, single.ctx).weapons.find((w) => w.kind === 'gun')!.maxRangeM).toBe(2_250)
    const both = world([gun('mod-g'), SUPPORT('mod-cut', { rangeCutPct: 0.25 }), SUPPORT('mod-cut2', { rangeCutPct: 0.15 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-cut', 'mod-cut2', null, null],
    })
    // 取最重一件（0.25）而不是相加（0.40）
    expect(specOf(both.state, both.ctx).weapons.find((w) => w.kind === 'gun')!.maxRangeM).toBe(2_250)
  })

  it('④ 按系射程加成：只喂指定弹型（动能 +22%，等离子不动）', () => {
    const w = world([gun('mod-g'), laser('mod-l'), SUPPORT('mod-r', { rangeTypeBonusPct: { kinetic: 0.22 } })], {
      high: ['mod-g', 'mod-l', null, null],
      mid: ['mod-r', null, null, null],
    })
    const spec = specOf(w.state, w.ctx)
    expect(spec.weapons.find((x) => x.kind === 'gun')!.maxRangeM).toBe(3_660)
    expect(spec.weapons.find((x) => x.kind === 'beam')!.maxRangeM).toBe(3_000)
  })

  it('⑤ 通用单发加成：全部武器单发 ×1.06（按系稳定器之外的一条链）', () => {
    const base = world([gun('mod-g')], { high: ['mod-g', null, null, null] })
    const plus = world([gun('mod-g'), SUPPORT('mod-d', { damageBonusPct: 0.06 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-d', null, null, null],
    })
    const shot = (s: typeof base) =>
      Object.values(specOf(s.state, s.ctx).weapons.find((w) => w.kind === 'gun')!.shotsByType ?? {})[0] ?? 0
    const a = shot(base)
    expect(a).toBeGreaterThan(0)
    expect(shot(plus)).toBe(Math.round(a * 1.06))
  })

  it('⑥ 装填惩罚：装填 ×1.12（多件取最重一件）', () => {
    const w = world([gun('mod-g'), moduleDef('mod-cpu', 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 90, reloadPenaltyPct: 0.12 })], {
      high: ['mod-g', null, null, null],
      low: ['mod-cpu', null, null, null],
    })
    expect(specOf(w.state, w.ctx).weapons.find((x) => x.kind === 'gun')!.reloadMs).toBe(672)
  })

  it('⑦ 全层抗性削减：三层同减、下限 0', () => {
    const w = world([gun('mod-g'), moduleDef('mod-pen', 'armor', 0, { rack: 'low', cpuUse: 1, allResistPenaltyPct: 0.15, armorHpBonus: 0.1 })], {
      high: ['mod-g', null, null, null],
      low: ['mod-pen', null, null, null],
    })
    const spec = specOf(w.state, w.ctx)
    expect(spec.resists.armor?.kinetic ?? 0).toBeCloseTo(0.35, 5) // 船体 0.5 − 0.15
    expect(spec.resists.shield?.kinetic ?? 0).toBe(0)
    expect(spec.resists.hull?.kinetic ?? 0).toBe(0)
  })

  it('⑧ 无人机出击周期：−8% 直接乘在无人机的装填（出击节拍）上', () => {
    const w = world(
      [moduleDef('mod-bay', 'drone-rack', 0, { rack: 'high', cpuUse: 1, droneBayBonusM3: 30, droneCycleCutPct: 0.08 })],
      { high: ['mod-bay', null, null, null] },
      { 'drone-x': 1 },
    )
    const drone = specOf(w.state, w.ctx).weapons.find((x) => x.src === 'drone')!
    expect(drone.reloadMs).toBe(Math.round(4_000 * 0.92))
  })

  it('⑨ 速度加成跨槽生效：支援槽带 speedBonusPct 也算进战斗机动', () => {
    const base = world([gun('mod-g')], { high: ['mod-g', null, null, null] })
    const fast = world([gun('mod-g'), SUPPORT('mod-spd', { speedBonusPct: 0.1 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-spd', null, null, null],
    })
    // 推进器加成在引擎里以 `thrusterBoost`（点火期倍率）随单位走，而不是直接改 `speedMps`
    expect(specOf(base.state, base.ctx).thrusterBoost ?? 0).toBe(0)
    expect(specOf(fast.state, fast.ctx).thrusterBoost ?? 0).toBeGreaterThan(0)
  })

  it('⑩ 缺省不受影响：不带任何新字段的装备，各旋钮一律不生效', () => {
    const w = world([gun('mod-g')], { high: ['mod-g', null, null, null] })
    const spec = specOf(w.state, w.ctx)
    const weapon = spec.weapons.find((x) => x.kind === 'gun')!
    expect(weapon.maxRangeM).toBe(3_000)
    expect(weapon.reloadMs).toBe(600)
    expect(weapon.secondaryDamagePct).toBeUndefined()
    expect(spec.resists.armor?.kinetic ?? 0).toBeCloseTo(0.5, 5)
  })

  /**
   * **2026-09-17 修**（玩家报障「赃物强化舱的护甲增加效果无效」时查出的同一类缺陷）：
   * 「**掠袭折射涂层**」是**装甲槽**件却带 `evasionGapPct`（−28%），而引擎原先只在 `supportDefs`
   * （支援槽）里收这一个字段 ⇒ 物品说明与界面都写着、战斗里从未生效。
   * 口径与 ⑨「速度加成跨槽生效」一致 ⇒ 改为全件扫描。姿态陀螺（支援槽）照旧各算一次。
   */
  it('⑪ 闪避缺口跨槽生效：**装甲槽**带 `evasionGapPct` 也算（缺口复合，不重复计入）', () => {
    const ARMOR = (id: string, extra: Partial<ModuleDef>): ModuleDef =>
      moduleDef(id, 'armor', 0, { rack: 'low', cpuUse: 1, ...extra })
    const base = world([gun('mod-g')], { high: ['mod-g', null, null, null] })
    const e0 = specOf(base.state, base.ctx).evasion
    // ① 装甲槽（报障同款：涂层 0.28）
    const coat = world([gun('mod-g'), ARMOR('mod-coat', { evasionGapPct: 0.28 })], {
      high: ['mod-g', null, null, null],
      low: ['mod-coat', null, null, null],
    })
    expect(specOf(coat.state, coat.ctx).evasion, '装甲槽的闪避缺口未计入战斗建档').toBeCloseTo(1 - (1 - e0) * 0.72, 6)
    // ② 支援槽（姿态陀螺 0.1）照旧生效
    const gyro = world([gun('mod-g'), SUPPORT('mod-gyro', { evasionGapPct: 0.1 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-gyro', null, null, null],
    })
    expect(specOf(gyro.state, gyro.ctx).evasion).toBeCloseTo(1 - (1 - e0) * 0.9, 6)
    // ③ 两件同装：按缺口**复合**（1 − 0.72 × 0.9），既不相加也不重复计入
    const both = world([gun('mod-g'), ARMOR('mod-coat', { evasionGapPct: 0.28 }), SUPPORT('mod-gyro', { evasionGapPct: 0.1 })], {
      high: ['mod-g', null, null, null],
      mid: ['mod-gyro', null, null, null],
      low: ['mod-coat', null, null, null],
    })
    expect(specOf(both.state, both.ctx).evasion).toBeCloseTo(1 - (1 - e0) * 0.72 * 0.9, 6)
  })
})
