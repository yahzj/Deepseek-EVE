/**
 * **窝点派生按档缩放**（2026-09-11 船长裁决④「**按甲处理**」）。
 *
 * 旧路径靠"威胁 → 血/火力曲线"自动随档变强；**舰级路径是绝对值、不会自己涨** ⇒ 派生时
 * 按「**原威胁 → 派生威胁**」的比例**同乘每个条目的 `hpMul` 与 `dmgMul`**（血与火力一起抬），
 * 保住「威胁 = 战力标尺」的语义与"深层比外围硬"的终局挑战。
 *
 * 同时验证**波次口径**：舰级路径的编队由 `slot.wave` 决定（A 族六卡全在 `wave: 0`），
 * 套用旧路径的 `LAIR_WAVES` 波表会让第 2/3 波**刷出 0 个单位**（探针实测）⇒ 舰级路径派生卡**维持单波**，
 * 旧路径卡的波次行为**逐字不变**。
 *
 * 契约守卫在 `content:check`「窝点派生契约」（负向验证：摘掉缩放 ⇒ 36 处错误）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES } from '@whale/data'
import { createFoeSpecs } from '../src/combat'
import { lairAnomalyOf } from '../src/lairs'
import type { AnomalyDef } from '../src/types'
import { makeTestCtx } from './helpers'

const bal = makeTestCtx().balance.battle
const card = (id: string): AnomalyDef => ANOMALIES.find((a) => a.id === id)!
const hpOf = (c: AnomalyDef): number =>
  (c.ships ?? []).reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)), 0)
const powerOf = (c: AnomalyDef): number =>
  (c.ships ?? []).reduce(
    (n, s) => n + s.ship.shotDmg * (s.dmgMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
    0,
  )

describe('窝点派生：舰级路径按「派生威胁 ÷ 原威胁」缩放血量与火力', () => {
  for (const id of ['ano-redring-raiders', 'ano-mirage-hijackers']) {
    it(`${id}：tier1/2/3 的总血与火力代理值严格递增，且 = 主题卡 × 缩放比例`, () => {
      const base = card(id)
      const baseHp = hpOf(base)
      const basePower = powerOf(base)
      let prevHp = baseHp
      let prevPower = basePower
      for (const tier of [1, 2, 3] as const) {
        const lair = lairAnomalyOf(base, tier)
        const scale = lair.threat / base.threat // 「原威胁 → 派生威胁」的比例
        expect(scale).toBeGreaterThan(1)
        // 每个条目的 hpMul / dmgMul 都同乘该比例（不是只改一条、也不是只改血）
        for (let i = 0; i < lair.ships!.length; i++) {
          expect(lair.ships![i]!.hpMul!).toBeCloseTo((base.ships![i]!.hpMul ?? 1) * scale, 9)
          expect(lair.ships![i]!.dmgMul!).toBeCloseTo((base.ships![i]!.dmgMul ?? 1) * scale, 9)
          expect(lair.ships![i]!.ship).toBe(base.ships![i]!.ship) // 舰级引用不动
          expect(lair.ships![i]!.count ?? 1).toBe(base.ships![i]!.count ?? 1) // 编成不动
        }
        expect(hpOf(lair)).toBeCloseTo(baseHp * scale, 6)
        expect(powerOf(lair)).toBeCloseTo(basePower * scale, 6)
        expect(hpOf(lair)).toBeGreaterThan(prevHp)
        expect(powerOf(lair)).toBeGreaterThan(prevPower)
        prevHp = hpOf(lair)
        prevPower = powerOf(lair)
      }
      // 三档依次：1.3× / 1.6× / 2.0× 附近（取整到威胁后的小差）
      expect(lairAnomalyOf(base, 3).threat).toBe(base.threat * 2)
    })
  }

  it('缩放只抬血与火力：编成数、头目血占比 60%、战术、射程覆写、`split` 一律继承', () => {
    const base = card('ano-mirage-hijackers')
    const lair = lairAnomalyOf(base, 3)
    const specs = createFoeSpecs(lair, bal)
    expect(specs).toHaveLength(4) // 头目 ×1 + 杂鱼 ×3
    const hp = specs.map((u) => u.hp.s + u.hp.a + u.hp.h)
    expect(hp[0]! / hp.reduce((a, b) => a + b, 0)).toBeCloseTo(0.6, 6) // 头目 60% 血占比不变
    expect(specs.map((u) => u.foeTactic)).toEqual(['kite', 'kite', 'kite', 'kite']) // 战术继承
    expect(specs[0]!.weapons[0]!.minRangeM).toBe(base.ships![0]!.rangeMinM) // 射程覆写继承
    expect(specs[0]!.weapons[0]!.maxRangeM).toBe(base.ships![0]!.rangeMaxM)
    // 头目血型仍随卡走（护盾 0.5/0.25/0.25 → 缩放不改比例）
    const bossHp = specs[0]!.hp
    expect(bossHp.s / (bossHp.s + bossHp.a + bossHp.h)).toBeCloseTo(0.5, 9)
  })
})

describe('窝点派生：波次口径', () => {
  it('舰级路径派生卡**维持单波**（不套 LAIR_WAVES，否则第 2/3 波刷 0 单位）', () => {
    const base = card('ano-redring-raiders')
    for (const tier of [1, 2, 3] as const) {
      const lair = lairAnomalyOf(base, tier)
      expect(lair.waves).toBeUndefined() // 没有波表 = 单波
      expect(createFoeSpecs(lair, bal)).toHaveLength(4) // 第 0 波 4 个单位
      // 引擎按波次建单位时（tagPrefix 非空）不会凭空造出第 2 波：编成条目都在 wave 0
      expect(createFoeSpecs(lair, bal, { units: 1, hpShare: 0.65, tagPrefix: 'w1-' })).toHaveLength(0)
    }
  })

  it('旧路径派生卡**逐字不变**：tier2 = 双波、tier3 = 三波，僚机加成照旧', () => {
    // ⚠ **2026-09-12 改夹具（P-43 舰级补完）**：全表 27 张敌军卡都已在舰级路径
    //   （G 族三卡迁入 +「废弃 F 族」的四张隐藏遭遇模板迁入 A 族舰级）⇒ **旧威胁推导路径再无真实卡**，
    //   原来的"挑一张旧路径卡"必然取到 undefined。本用例改为**拿真卡复制一份、摘掉 `ships`**
    //   来守那条路径的行为——旧分支在引擎与 `lairAnomalyOf` 里都**保留**（防旧内容表 / 旧导出 /
    //   第三方数据走该路径时行为漂移），不该因为没有真卡就失去守卫。
    const legacy: AnomalyDef = {
      ...card('ano-redring-raiders'),
      id: 'test-legacy-foe',
      name: '测试旧路径敌群',
      ships: undefined,
      waves: undefined,
      escorts: 1,
      lairCore: '测试窝点',
    }
    expect(legacy.ships ?? []).toHaveLength(0) // 确认走的是旧威胁推导路径
    expect(lairAnomalyOf(legacy, 1).waves).toBeUndefined() // tier1 = 沿用主题卡（本卡无波）⇒ 仍单波
    expect(lairAnomalyOf(legacy, 2).waves!.map((w) => w.units)).toEqual([1, 1])
    expect(lairAnomalyOf(legacy, 3).waves!.map((w) => w.units)).toEqual([1, 1, 1])
    // 舰级路径不叠加僚机加成、也不套波表；旧路径照旧叠加（tier3 = +1，上限 2）
    const shipPath = card('ano-mirage-hijackers')
    expect(lairAnomalyOf(shipPath, 3).escorts).toBe(shipPath.escorts ?? 0)
    expect(lairAnomalyOf(shipPath, 3).waves).toBeUndefined()
    expect(lairAnomalyOf(legacy, 3).escorts).toBe(Math.min(2, (legacy.escorts ?? 0) + 1))
  })
})
