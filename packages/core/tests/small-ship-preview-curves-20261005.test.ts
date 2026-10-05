import { describe, expect, it } from 'vitest'
import { previewProbability } from '../../../tools/small-ship-curves'

describe('隔离命中候选曲线的边界和单调性', () => {
  it('现行曲线必须走真实引擎，不可在工具复制旧公式', () => {
    expect(() => previewProbability('current',1,0.3,1)).toThrow()
  })
  it.each(['multiply','soft'] as const)('%s全区间有界，命中随瞄准提高、回避提高或距离衰减加深单调变化', (curve) => {
    for (const aim of [0,0.25,0.5,0.85,1,1.25,2,10]) for (const e of [0,0.1,0.3,0.6,0.9]) for (const df of [0,0.3,0.5,1]) {
      const p = previewProbability(curve,aim,e,df)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
      expect(previewProbability(curve,aim+0.1,e,df)).toBeGreaterThanOrEqual(p)
      expect(previewProbability(curve,aim,e+0.05,df)).toBeLessThanOrEqual(p)
      expect(previewProbability(curve,aim,e,Math.max(0,df-0.1))).toBeLessThanOrEqual(p)
    }
  })
  it('乘法回避不让命中余量吞掉回避，软竞争仍保留余量投资但无瞬时必中', () => {
    expect(previewProbability('multiply',1.25,0.316,1)).toBeCloseTo(0.684,8)
    expect(previewProbability('soft',1.25,0.316,1)).toBeCloseTo(0.7472,8)
    expect(previewProbability('multiply',2,0.5,1)).toBe(0.5)
    expect(previewProbability('soft',2,0.5,1)).toBe(0.75)
    expect(previewProbability('soft',10,0.5,1)).toBeLessThan(1)
  })
})
