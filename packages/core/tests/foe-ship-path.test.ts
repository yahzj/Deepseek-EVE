/**
 * 舰级路径（**敌舰配置表 · A 族试点**，2026-09-11 船长定案）
 *
 * 船长原话：「给敌人单独一套**敌舰的配置表**，敌舰属性按照配置表再根据实际悬赏等进行修正，
 * 这样**不会出现动一艘船，其他跟着动**」；同日裁决「**舰级给绝对值**」「卡上用修正」
 * 「**允许混编**」「先试点」「④按四级」「⑤（精锐词缀）可以」。
 *
 * ⚠ 覆盖说明：试点的 6 张 A 族卡**刻意保持原值**（船长 ⑥「先不改数值」），因此它们
 * **没有用到「混编」与「头目档」**——这两项能力由本文件**直接构造舰级**覆盖，
 * 不靠"将来某张卡会用到"来兜底。
 *
 * 本文件验证：
 * ① **绝对值口径**：单位属性 = 舰级值 × 本条倍率，**不吃威胁份额均分、不吃 hpShare**
 *    （改威胁强度不影响同一编成的建档值）；
 * ② **允许混编**：一张卡引用多个舰级，各自按自己的舰级建档（头目厚且疼、杂鱼薄且轻）；
 * ③ **词缀**：`elite` 舰级 → 「精锐」前缀；僚机 → 「轻装」前缀；
 * ④ **tag 口径**：与旧路径同规则（首队 `foe-0` / 僚机 `foe-1`；同波后续小队 `w0-foe-{k}`）；
 * ⑤ **旧路径不受影响**：无 `ships` 的卡行为逐字不变（仍按威胁推导 + 战术×血型命名）。
 */
import { describe, expect, it } from 'vitest'
import { createFoeSpecs, FOE_ELITE_WORD, FOE_LIGHT_WORD, foeUnitNameOf } from '../src/combat'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import { anomaly, makeTestCtx } from './helpers'

const bal = makeTestCtx().balance.battle

/** 测试用舰级：头目档（精锐、厚且疼） */
const BOSS: FoeShipDef = {
  id: 't-foe-boss',
  name: '测试头目舰',
  family: 'A',
  hp: 400,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  speedMps: 380,
  shotDmg: 60,
  hitRate: 0.9,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2600,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
  elite: true,
}

/** 测试用舰级：杂鱼（薄、轻、快） */
const SKIFF: FoeShipDef = {
  id: 't-foe-skiff',
  name: '测试快艇',
  family: 'A',
  hp: 100,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  speedMps: 350,
  shotDmg: 10,
  hitRate: 0.85,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2200,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
}

/** 一张"头目 ×1 + 快艇 ×3 + 快艇僚机 ×1"的**混编**卡 */
function mixedCard(threat: number): AnomalyDef {
  return {
    ...anomaly('ano-t-mixed', 'galaxy-hub', { threat, tactic: 'brawl' }),
    ships: [
      { ship: BOSS },
      { ship: SKIFF, count: 3 },
      { ship: SKIFF, escort: true, hpMul: 0.6, dmgMul: 0.6 },
    ],
  }
}

const hpOf = (u: { hp: { s: number; a: number; h: number } }): number => u.hp.s + u.hp.a + u.hp.h

describe('舰级路径：绝对值口径', () => {
  it('单位属性 = 舰级值 × 倍率；改威胁不影响同一编成的建档值（绝对值，不吃威胁份额）', () => {
    const low = createFoeSpecs(mixedCard(10), bal)
    const high = createFoeSpecs(mixedCard(999), bal)
    expect(low.map(hpOf)).toEqual(high.map(hpOf))
    expect(low[0]!.weapons[0]!.shotDmg).toBe(high[0]!.weapons[0]!.shotDmg)
    expect(low[0]!.speedMps).toBe(high[0]!.speedMps)
  })

  it('血量/单发/速度/射程一律按"舰级 × 本条倍率"，僚机再 ×0.6', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    const boss = specs[0]!
    const skiff = specs[1]!
    const escort = specs[4]!
    expect(hpOf(boss)).toBeCloseTo(400, 6)
    expect(hpOf(skiff)).toBeCloseTo(100, 6)
    expect(hpOf(escort)).toBeCloseTo(60, 6) // 100 × 0.6
    expect(boss.weapons[0]!.shotDmg).toBe(60)
    expect(skiff.weapons[0]!.shotDmg).toBe(10)
    expect(escort.weapons[0]!.shotDmg).toBe(6) // round(10 × 0.6)
    expect(boss.speedMps).toBe(380)
    expect(skiff.speedMps).toBe(350)
    expect(boss.weapons[0]!.maxRangeM).toBe(2600)
    expect(skiff.weapons[0]!.maxRangeM).toBe(2200)
  })
})

describe('舰级路径：允许混编', () => {
  it('一张卡引用多个舰级，各自建档（头目厚且疼、杂鱼薄且轻）', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs).toHaveLength(5) // 头目 ×1 + 快艇 ×3 + 僚机 ×1
    const boss = specs.find((s) => s.tag === 'foe-0')!
    const minion = specs.find((s) => s.tag === 'w0-foe-1')!
    const bossShot: number = boss.weapons[0]!.shotDmg!
    const minionShot: number = minion.weapons[0]!.shotDmg!
    expect(hpOf(boss)).toBeGreaterThan(hpOf(minion) * 3)
    expect(bossShot).toBeGreaterThan(minionShot * 3)
  })

  it('tag 口径与旧路径同规则：首队 foe-0、同波后续小队 w0-foe-{k}、僚机跟最近主体', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs.map((s) => s.tag)).toEqual(['foe-0', 'w0-foe-1', 'w0-foe-2', 'w0-foe-3', 'w0-foe-3-e1'])
  })

  it('分波：slot.wave 指定第几波，前缀 w{n}- 与旧多波口径一致', () => {
    const w1 = createFoeSpecs({ ...mixedCard(40), ships: [{ ship: BOSS, wave: 1 }] }, bal, { tagPrefix: 'w1-' })
    expect(w1.map((s) => s.tag)).toEqual(['w1-foe-0'])
    // 第 1 波只建该波条目（第 0 波的条目不会重复出现）
    expect(createFoeSpecs({ ...mixedCard(40), ships: [{ ship: BOSS, wave: 1 }] }, bal, { tagPrefix: 'w1-' })).toHaveLength(1)
  })
})

describe('舰级路径：词缀与显示名', () => {
  it('头目档挂「精锐」、僚机挂「轻装」（2026-09-11 船长裁决实装精锐档）', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs[0]!.name).toBe(`${FOE_ELITE_WORD}测试头目舰`)
    expect(specs[1]!.name).toBe('测试快艇')
    expect(specs[4]!.name).toBe(`${FOE_LIGHT_WORD}测试快艇`)
  })

  it('界面同源：foeUnitNameOf(卡, tag) 能按 tag 反查回同一舰级名（读档实时推导不迁移）', () => {
    const def = mixedCard(40)
    expect(foeUnitNameOf(def, 'foe-0')).toBe(`${FOE_ELITE_WORD}测试头目舰`)
    expect(foeUnitNameOf(def, 'w0-foe-2')).toBe('测试快艇')
    expect(foeUnitNameOf(def, 'w0-foe-3-e1')).toBe(`${FOE_LIGHT_WORD}测试快艇`)
  })

  it('主系覆写生效：编成条目写 dmgMix 时按覆写建档（能量 → 光束必中）', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-plasma', 'galaxy-hub', { threat: 30 }),
      ships: [{ ship: SKIFF, dmgMix: { plasma: 8, kinetic: 2 } }],
    }
    const w = createFoeSpecs(def, bal)[0]!.weapons[0]!
    expect(w.kind).toBe('beam')
    expect(w.fixedType).toBe('plasma')
    expect(w.hitRate).toBe(1) // 光束必中
    expect(w.shotsByType).toEqual({ plasma: 8, kinetic: 2 })
  })
})

describe('旧路径不受影响（未写 ships 的卡）', () => {
  it('仍按威胁推导建档，命名仍走"战术 × 血型"舰种名', () => {
    const def = anomaly('ano-t-legacy', 'galaxy-hub', { threat: 20, tactic: 'brawl' })
    const specs = createFoeSpecs({ ...def, defProfile: 'armor', foeHpOverride: 300 }, bal)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.tag).toBe('foe-0')
    expect(specs[0]!.name).toBe('攻坚重甲舰')
    expect(hpOf(specs[0]!)).toBeCloseTo(300, 6)
  })
})
