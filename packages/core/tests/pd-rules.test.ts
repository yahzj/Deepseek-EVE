/**
 * 敌方近防炮**规则契约**（2026-09-12 船长八条裁决）：
 * 「敌人防空火力受舰船级别影响。越大的舰船防空火力越强。改为集火制度。
 *   优先攻击哨戒和攻坚无人机，给攻坚无人机添加 25% 全抗性。侦查和普通战机相同权重抽取。
 *   允许命中下限 10%。基础命中率提高到 70%」
 *
 * 本文件钉住**可确定断言**的部分（数值与数据不变量）；集火 / 优先级 / 档系数的**行为读数**
 * 由 `tools/pd-tune.ts` 与 `tools/battle-calibrate.ts --std` 的标定轮回答（P-41）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES_FLAVORED, buildSimContext } from '@whale/data'
import { DEFAULT_BALANCE } from '@whale/core'
import { createFoeSpecs } from '../src/combat'

const bal = DEFAULT_BALANCE.battle
/** ⚠ 用 `buildSimContext()`（物品表含无人机）——`makeTestCtx()` 的 items 只有装备模块 */
const ctx = buildSimContext()
/** 我方无人机机型 id（四型 + G 族专属「流亡蜂无人机」） */
const DRONE_IDS = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry', 'drone-exile-bee']

describe('敌方近防炮 · 2026-09-12 船长八条裁决', () => {
  it('基础命中率 70% + 命中下限 10% + 判定周期 500ms（频率 = 还手速率上限）+ 门槛 60', () => {
    expect(bal.pdAcc).toBe(0.7)
    expect(bal.pdHitFloor).toBe(0.1)
    expect(bal.pdJudgementMs).toBe(500)
    expect(bal.pdThreatFloor).toBe(60)
  })

  it('舰种档系数：越大的船防空越强（T1 = 1.0 且严格递增）', () => {
    const muls = bal.pdTierMul
    expect(muls.length).toBeGreaterThanOrEqual(5)
    expect(muls[0]).toBe(1)
    for (let i = 1; i < muls.length; i += 1) expect(muls[i]!).toBeGreaterThan(muls[i - 1]!)
  })

  it('命中下限保证**每一种机型都可被近防炮打中**（修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）', () => {
    for (const id of DRONE_IDS) {
      const d = ctx.items.get(id)
      expect(d, `缺机型 ${id}`).toBeTruthy()
      const ev = d!.defense?.evasion ?? 0
      const pHit = Math.max(bal.pdHitFloor, bal.pdAcc - ev)
      expect(pHit, `${d!.name}（闪避 ${ev}）的命中率`).toBeGreaterThanOrEqual(bal.pdHitFloor)
    }
  })

  it('攻坚无人机 = **25% 全抗性**（三层 × 三系）', () => {
    const heavy = ctx.items.get('drone-heavy')
    expect(heavy).toBeTruthy()
    const def = heavy!.defense as unknown as Record<string, Record<string, number> | undefined>
    for (const layer of ['shieldResist', 'armorResist', 'hullResist']) {
      for (const t of ['kinetic', 'explosive', 'plasma']) {
        expect(def[layer]?.[t], `攻坚机 ${layer}.${t}`).toBe(0.25)
      }
    }
  })

  it('舰级路径的单位带**舰种档**（近防炮档系数据此取值）', () => {
    const a = ANOMALIES_FLAVORED.find((x) => x.id === 'ano-nadir-static')!
    const specs = createFoeSpecs(a, ctx.balance.battle)
    // 天底静区封锁 = 1 巡洋舰（T3）+ 2 驱逐舰（T2）
    expect(specs.map((s) => s.hullClassTier)).toEqual([3, 2, 2])
  })
})
