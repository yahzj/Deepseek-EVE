import { describe, expect, it } from 'vitest'
import { generateStellarSystem } from '../src/stellarGeneration'
import type { PlanetSize, StellarBody } from '../src/index'
import { stellarMapBodyRadii } from '../../../apps/desktop/src/renderer/src/panels/stellarBodySize'

const bodies: StellarBody[] = [
  { planetId: 'small', ordinal: 1, kind: 'rocky', orbit: 120, x: 100, y: 100 },
  { planetId: 'medium', ordinal: 2, kind: 'ocean', orbit: 240, x: 400, y: 100 },
  { planetId: 'large', ordinal: 3, kind: 'ice', orbit: 360, x: 700, y: 100 },
]
const sizes = { small: 4, medium: 5, large: 6 } as const
describe('星图按公开地表总面积缩放', () => {
  it.each([1, 2, 4, 10])('尺寸与可读尺度一起保持面积平方根比例，unit=%s', unit => {
    const radii = stellarMapBodyRadii(bodies, [], unit, sizes)
    expect(radii.small! / radii.medium!).toBeCloseTo(.8)
    expect(radii.large! / radii.medium!).toBeCloseTo(1.2)
    expect((radii.large! / radii.small!) ** 2).toBeCloseTo(36 / 16)
  })
  it('拥挤用相同固态压缩系数，不反转大小、每个本体仍受最近间距限幅', () => {
    const close = bodies.map(body => ({ ...body }))
    close[2]!.x = 410
    const radii = stellarMapBodyRadii(close, [], 4, sizes)
    expect(radii.small!).toBeLessThan(radii.medium!)
    expect(radii.medium!).toBeLessThan(radii.large!)
    expect(radii.small! / radii.medium!).toBeCloseTo(.8)
    expect(radii.large! / radii.medium!).toBeCloseTo(1.2)
    expect(radii.large!).toBeCloseTo(3.8)
    expect(radii.medium!).toBeLessThanOrEqual(3.8)
  })
  it('气态保持类型/局部限幅，不使用其未开放地表网格', () => {
    const gas = bodies.map(body => ({ ...body, kind: 'gas' as const }))
    expect(stellarMapBodyRadii(gas, [], 1, sizes)).toEqual({ small: 22, medium: 22, large: 22 })
    expect(stellarMapBodyRadii(gas, [], 2, sizes)).toEqual({ small: 36, medium: 36, large: 36 })
    gas[1]!.x = 110
    expect(stellarMapBodyRadii(gas, [], 1, sizes)).toEqual({ small: 3.8, medium: 3.8, large: 22 })
  })
  it('空/缺失/非法size以中档兼容，非法可读尺度与重合坐标没有NaN', () => {
    expect(stellarMapBodyRadii([], [], 1)).toEqual({})
    for (const unit of [NaN, Infinity, 0, -1]) expect(stellarMapBodyRadii(bodies, [], unit)).toEqual({ small: 18, medium: 18, large: 18 })
    const invalid = { small: 0, medium: NaN, large: 100 } as unknown as Record<string, PlanetSize>
    expect(stellarMapBodyRadii(bodies, [], 1, invalid)).toEqual({ small: 18, medium: 18, large: 18 })
    const overlap = bodies.map(body => ({ ...body, x: 100, y: 100 }))
    expect(Object.values(stellarMapBodyRadii(overlap, [], 1, sizes)).every(value => value === 0)).toBe(true)
  })
  it('恒星靠近只改变全体压缩，公开尺寸输入/原坐标不修改', () => {
    const before = structuredClone({ bodies, sizes })
    const radii = stellarMapBodyRadii(bodies, [{ x: 701, y: 100 }], 1, sizes)
    expect(radii.large!).toBeCloseTo(.38)
    expect(radii.small! / radii.large!).toBeCloseTo(4 / 6)
    expect({ bodies, sizes }).toEqual(before)
  })
  it('1000个真实星系的固态大小排序守恒，不回写生成或消费探索随机数', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const generated = generateStellarSystem(seed), before = structuredClone(generated)
      const publicSizes = Object.fromEntries(generated.planets.map(planet => [planet.id, planet.size]))
      const radii = stellarMapBodyRadii(generated.system.bodies, generated.system.stars, 3, publicSizes)
      const solid = generated.system.bodies.filter(body => body.kind !== 'gas')
      for (const a of solid) for (const b of solid) expect(radii[a.planetId]! / publicSizes[a.planetId]!).toBeCloseTo(radii[b.planetId]! / publicSizes[b.planetId]!)
      expect(generated).toEqual(before)
    }
  })
})
