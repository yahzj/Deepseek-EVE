/**
 * 长途运输报酬「安全档收益率 + 距离指数」（**2026-09-12 船长定**）——真内容口径用例。
 *
 * 船长原话：①「高安路线的收益率是0.5，中安是0.75，低安是1」；
 * ②「我希望总报酬还和距离挂钩，距离越长报酬越高。在此基础上，保持母港 ⇄ 烬火前哨站的收益为 648,000/h，
 *    其他按比例削弱」；③「基于距离有一个指数增幅，让 1+1<2，直接跑完整的一段长途比分开跑要赚」。
 *
 * 本文件用 `buildSimContext()` 的**真星图**守住四件事：
 *   ① 有效距离 = 逐跳「该跳分钟 × 两端较**低**档系数」（母港⇄红环 4.5 / 母港⇄烬火 7.75 / 红环⇄烬火 3.0）；
 *   ② **锚定不漂**：母港 ⇄ 烬火前哨站时薪 = 648,000 ISK/h（皇带鱼 36,000 m³ · 行情均值 ×7.5）；
 *   ③ 其余航线按比例削弱（母港⇄红环 ≈ 409,600/h ≈ −37%）；
 *   ④ **超可加（1+1<2）**：拆成「母港⇄红环 + 红环⇄烬火」两段只值整段的 ≈68%。
 * ⚠ 若日后改星图边权 / 星系安全等级 / 站点位置，本文件会红——那正是它要拦的"锚定漂移"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import type { SimContext } from '../src/types'
import { haulBaseReward, haulEffectiveMinutes, haulSecurityMulOf } from '../src/hauling'
import { securityZoneOf } from '../src/sideTasks'
import { shortestTravelPath, shortestTravelMinutes } from '../src/travel'

const ctx = buildSimContext() as SimContext
const HOME = 'galaxy-hub'
const REDRING = 'galaxy-redring'
const CINDER = 'galaxy-cinder'
/** 皇带鱼级旗舰货舰（本轮读数用船） */
const CAP = 36000
/** 行情倍率均值（5~10 均匀 ⇒ 7.5） */
const MEAN_MUL = 7.5

/** 某段航程的时薪（行情均值口径）：单段均值报酬 ÷ 实际航段时间（标称 ×15 分钟，不计航行技能） */
function hourly(galaxyA: string, galaxyB: string): number {
  const nominal = shortestTravelMinutes(ctx, galaxyA, galaxyB)
  const legHours = (nominal * 15) / 60
  return (haulBaseReward(ctx, CAP, haulEffectiveMinutes(ctx, galaxyA, galaxyB)) * MEAN_MUL) / legHours
}

describe('长途运输 · 安全档收益率 + 距离指数（2026-09-12 船长定）', () => {
  it('档位系数与分区单点一致：高安 0.5 / 中安 0.75 / 低安 1', () => {
    expect(ctx.balance.haul.securityMul).toEqual({ 高安: 0.5, 中安: 0.75, 低安: 1 })
    expect(ctx.balance.haul.distExp).toBe(1.5)
    expect(securityZoneOf(ctx, HOME)).toBe('高安') // 大鲸鱼Ⅳ +1.0
    expect(securityZoneOf(ctx, REDRING)).toBe('中安') // 红环航道 +0.1
    expect(securityZoneOf(ctx, CINDER)).toBe('低安') // 烬火星区 0.0（2026-09-12「0也算低安」）
  })

  it('有效距离 = 逐跳取两端较低档（母港⇄红环 4.5 · 母港⇄烬火 7.75 · 红环⇄烬火 3.0）', () => {
    // 母港→红环：3 分钟（母港·高安 ↔ 柯尔边境·高安）×0.5 + 4 分钟（柯尔边境·高安 ↔ 红环·中安取较低）×0.75 + …
    expect(haulEffectiveMinutes(ctx, HOME, REDRING)).toBeCloseTo(4.5, 6)
    // 母港→烬火 引擎选中的最短路走碎晶带：3×0.5 + 3×0.75 + 4×1.0
    expect(shortestTravelPath(ctx, HOME, CINDER).galaxies).toEqual([HOME, 'galaxy-kor', 'galaxy-shard', CINDER])
    expect(haulEffectiveMinutes(ctx, HOME, CINDER)).toBeCloseTo(7.75, 6)
    // 红环⇄烬火 = 单跳，两端取较低 = 低安 1.0 ⇒ 有效距离 = 标称 3
    expect(haulEffectiveMinutes(ctx, REDRING, CINDER)).toBeCloseTo(3, 6)
    // 高安走廊被折算得更短：母港⇄红环有效距离 4.5 < 标称 7
    expect(haulEffectiveMinutes(ctx, HOME, REDRING)).toBeLessThan(shortestTravelMinutes(ctx, HOME, REDRING))
  })

  it('锚定契约：母港 ⇄ 烬火前哨站时薪 = 648,000 ISK/h（逐字不变）', () => {
    expect(shortestTravelMinutes(ctx, HOME, CINDER)).toBe(10)
    expect(haulEffectiveMinutes(ctx, HOME, CINDER)).toBeCloseTo(ctx.balance.haul.anchorEffectiveMinutes, 6)
    expect(hourly(HOME, CINDER)).toBe(648_000)
  })

  it('其余航线按比例削弱：母港⇄红环 ≈ 409,600/h（−37%）· 红环⇄烬火 ≈ 520,200/h', () => {
    const hubRedring = hourly(HOME, REDRING)
    const redringCinder = hourly(REDRING, CINDER)
    expect(hubRedring).toBeGreaterThan(400_000)
    expect(hubRedring).toBeLessThan(420_000)
    expect(hubRedring / 648_000).toBeCloseTo(0.632, 2) // ≈ −37%
    expect(redringCinder).toBeGreaterThan(510_000)
    expect(redringCinder).toBeLessThan(530_000)
    // 没有任何航线超过锚（船长「其他按比例削弱」）
    expect(hubRedring).toBeLessThan(648_000)
    expect(redringCinder).toBeLessThan(648_000)
  })

  it('超可加（1+1<2）：拆成两段只值整段的 ≈68% —— 直接跑完整一段更赚', () => {
    const p = ctx.balance.haul.distExp
    const whole = Math.pow(haulEffectiveMinutes(ctx, HOME, CINDER), p)
    const split =
      Math.pow(haulEffectiveMinutes(ctx, HOME, REDRING), p) + Math.pow(haulEffectiveMinutes(ctx, REDRING, CINDER), p)
    expect(split / whole).toBeCloseTo(0.68, 2)
    expect(split).toBeLessThan(whole) // 严格小于 = 超可加
    // 对照：线性口径（p=1）时拆开几乎不亏（97%）——那正是船长要改掉的"1+1≈2"
    const linear = haulEffectiveMinutes(ctx, HOME, REDRING) + haulEffectiveMinutes(ctx, REDRING, CINDER)
    expect(linear / haulEffectiveMinutes(ctx, HOME, CINDER)).toBeCloseTo(0.968, 2)
  })
})
