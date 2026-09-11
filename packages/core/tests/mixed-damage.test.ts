/**
 * 敌方混伤（2026-09-10 船长：「给所有赏金任务的敌人添加额外攻击的副伤害类型，让其攻击造成混伤
 * （主类型占大部分），并需要在任务中告知玩家」→ 同日追定「常驻悬赏也改，比例约 8:2」）：
 * - **常驻悬赏 / 低安遇袭** = 主 **8 : 副 2**（80% / 20%）；**窝点派生卡** = 主 **6 : 副 4**（60% / 40%）；
 * - **教学卡（演习场驱逐令）保持纯系**（不给新手第一场上混伤）；
 * - 敌**总伤不变**（只改构成）；武器形态/命中/近盲/衰减仍按**主系**；
 * - 各系各自吃自己的层位克制与层抗 → 只堆主系抗会被副系穿透（本测试直接验证这一点）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  applyFoeShot,
  createFoeSpecs,
  foeDamageComposition,
  foeMainDamageType,
  LAIR_SUB_DMG_SHARE,
  lairAnomalyOf,
  splitShotByComposition,
  subDamageTypeOf,
} from '../src/index'
import type { DamageType } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle

describe('敌方混伤：构成（2026-09-10 船长）', () => {
  it('常驻悬赏卡 = 两系 80% / 20%，主系在前（降序）', () => {
    const card = ctx.anomalies.get('ano-pirate-post')! // 海盗前哨：主爆炸、副动能
    const comp = foeDamageComposition(card)
    expect(comp).toHaveLength(2)
    expect(comp[0]).toEqual({ type: 'explosive', share: 0.8 })
    expect(comp[1]).toEqual({ type: 'kinetic', share: 0.2 })
    expect(foeMainDamageType(card)).toBe('explosive') // 主系不变
  })

  it('教学卡保持纯系（单条 100%）', () => {
    const card = ctx.anomalies.get('ano-training')!
    const comp = foeDamageComposition(card)
    expect(comp).toEqual([{ type: 'kinetic', share: 1 }])
  })

  it('窝点派生卡 = 同一主系 + 60% / 40%（副系按族签名）', () => {
    expect(LAIR_SUB_DMG_SHARE).toBe(0.4)
    const card = ctx.anomalies.get('ano-vault-sentinel')! // D 族：主动能 → 副等离子
    const lair = lairAnomalyOf(card, 3)
    expect(foeMainDamageType(lair)).toBe(foeMainDamageType(card))
    const comp = foeDamageComposition(lair)
    expect(comp[0]).toEqual({ type: 'kinetic', share: 0.6 })
    expect(comp[1]).toEqual({ type: 'plasma', share: 0.4 })
    expect(subDamageTypeOf(card)).toBe('plasma')
  })

  it('副系永远与主系不同（19 张窝点候选全遍历）', () => {
    let checked = 0
    for (const card of ctx.anomalies.values()) {
      const main = foeMainDamageType(card)
      const sub = subDamageTypeOf(card, main)
      expect(sub).not.toBe(main)
      const lair = lairAnomalyOf(card, 1)
      const mix = lair.dmgMix!
      expect(Object.values(mix).filter((v) => (v ?? 0) > 0)).toHaveLength(2)
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(19)
  })
})

describe('敌方混伤：拆分与结算（总伤不变、各系各吃克制）', () => {
  it('splitShotByComposition：Σ = 总单发（取整不多不少）', () => {
    const comp = [
      { type: 'kinetic' as DamageType, share: 0.6 },
      { type: 'explosive' as DamageType, share: 0.4 },
    ]
    for (const total of [1, 3, 7, 10, 99, 100, 1237]) {
      const rows = splitShotByComposition(total, comp)
      expect(rows.reduce((s, r) => s + r.dmg, 0)).toBe(total) // 总量守恒（取整不多不少）
      if (total >= 10) expect(rows).toHaveLength(2) // 单发极小时副系会取整成 0 → 合并为一条（不产生 0 伤害条目）
      for (const r of rows) expect(r.dmg).toBeGreaterThan(0)
    }
    // 单系 = 原样一条
    expect(splitShotByComposition(50, [{ type: 'plasma', share: 1 }])).toEqual([{ type: 'plasma', dmg: 50 }])
    expect(splitShotByComposition(0, comp)).toEqual([])
  })

  it('createFoeSpecs：混伤卡武器带两键 shotsByType 且 Σ = shotDmg；教学卡无多键', () => {
    const mixed = createFoeSpecs(ctx.anomalies.get('ano-pirate-post')!, bal)[0]!.weapons[0]!
    const shots = mixed.shotsByType!
    expect(Object.keys(shots).sort()).toEqual(['explosive', 'kinetic'])
    expect(shots.explosive! + shots.kinetic!).toBe(mixed.shotDmg)
    expect(shots.explosive!).toBeGreaterThan(shots.kinetic!) // 主系占大部分
    expect(mixed.fixedType).toBe('explosive') // 形态/命中口径仍按主系
    const pure = createFoeSpecs(ctx.anomalies.get('ano-training')!, bal)[0]!.weapons[0]!
    expect(pure.shotsByType).toBeUndefined()
  })

  it('混伤结算：只堆主系抗的目标，承伤高于纯主系（副系绕开主抗）', () => {
    const hp = { s: 1000, a: 1000, h: 1000 }
    // 极端化：目标对动能抗 90%（其余 0）——纯动能打不动，混伤能绕
    const resists = { shield: { kinetic: 0.9 }, armor: { kinetic: 0.9 }, hull: { kinetic: 0.9 } }
    const pureWeapon = { label: 'x', kind: 'fixed' as const, fixedType: 'kinetic' as const, shotDmg: 100, maxRangeM: 1, minRangeM: 0, hitRate: 1, falloff: 1, reloadMs: 1000 }
    const mixedWeapon = { ...pureWeapon, shotsByType: { kinetic: 60, explosive: 40 } }
    const pureDealt = 3000 - (applyFoeShot(hp, resists, pureWeapon, 100, 'kinetic').s + applyFoeShot(hp, resists, pureWeapon, 100, 'kinetic').a + applyFoeShot(hp, resists, pureWeapon, 100, 'kinetic').h)
    const m = applyFoeShot(hp, resists, mixedWeapon, 100, 'kinetic')
    const mixedDealt = 3000 - (m.s + m.a + m.h)
    expect(mixedDealt).toBeGreaterThan(pureDealt)
  })

  it('混伤结算：零份额键被忽略（只剩一系时按纯系口径结算，结果与纯系一致）', () => {
    const hp = { s: 1000, a: 1000, h: 1000 }
    const pure = {
      label: 'x',
      kind: 'fixed' as const,
      fixedType: 'plasma' as const,
      shotDmg: 100,
      maxRangeM: 1,
      minRangeM: 0,
      hitRate: 1,
      falloff: 1,
      reloadMs: 1000,
    }
    const withZeroKey = { ...pure, shotsByType: { plasma: 100, kinetic: 0 } as Partial<Record<DamageType, number>> }
    expect(applyFoeShot(hp, {}, withZeroKey, 100, 'plasma')).toEqual(applyFoeShot(hp, {}, pure, 100, 'plasma'))
  })
})
