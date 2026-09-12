/**
 * 抽取单点（2026-09-12 审计 B2/B3）：`pickOne` / `pickWeighted` 用例。
 *
 * 目标 = **证明它们与仓内原先手写式逐位等价**——不只是"抽出来一样"，还包括**抽了几次随机数**
 * （挂机游戏里 rng 序列一挪位，离线结算结果就全变；`nextRandom` 会把 `count` 记进存档）。
 * 另外钉住边界：空表 / 总权重 ≤ 0 / 负权重夹紧 / `lt` 与 `lte` 两种边界口径。
 */
import { describe, expect, it } from 'vitest'
import { nextRandom, pickOne, pickWeighted } from '../src/rng'
import type { RngState } from '../src/state'

const rngAt = (): RngState => ({ seed: 12345, count: 0 })

/** 改前手写式：`arr[Math.floor(nextRandom(rng) * arr.length)]` */
function refPickOne<T>(rng: RngState, arr: readonly T[]): T | undefined {
  return arr[Math.floor(nextRandom(rng) * arr.length)]
}

/** 改前手写式（扣减 + 严格小于）：`events` / `expedition` / `mining` 三处 */
function refPickLt<T>(rng: RngState, items: readonly T[], w: (t: T) => number): T | undefined {
  const r0 = nextRandom(rng) // ⚠ 先抽：与手写调用点一致
  let total = 0
  for (const it of items) total += Math.max(0, w(it))
  if (items.length === 0 || total <= 0) return undefined
  let roll = r0 * total
  for (const it of items) {
    roll -= Math.max(0, w(it))
    if (roll < 0) return it
  }
  return undefined
}

/** 改前手写式（扣减 + 含等号）：`salvage` 的矿种池与 `salvaging` 的残骸池 */
function refPickLte<T>(rng: RngState, items: readonly T[], w: (t: T) => number): T | undefined {
  const r0 = nextRandom(rng)
  let total = 0
  for (const it of items) total += Math.max(0, w(it))
  if (items.length === 0 || total <= 0) return undefined
  let roll = r0 * total
  for (const it of items) {
    roll -= Math.max(0, w(it))
    if (roll <= 0) return it
  }
  return undefined
}

describe('抽取单点（pickOne / pickWeighted）', () => {
  it('pickOne 与手写式逐位等价：结果一致、**消耗的随机数个数也一致**', () => {
    const arr = ['a', 'b', 'c', 'd', 'e']
    const a = rngAt()
    const b = rngAt()
    for (let i = 0; i < 500; i += 1) expect(pickOne(a, arr)).toBe(refPickOne(b, arr))
    expect(a.count).toBe(b.count)
    expect(a.count).toBe(500) // 每次调用恰抽一次
  })

  it('pickOne：空表 = undefined，但**照样消耗一次**（与手写式一致 ⇒ rng 序列不挪位）', () => {
    const rng = rngAt()
    expect(pickOne(rng, [])).toBeUndefined()
    expect(rng.count).toBe(1)
  })

  it('pickWeighted（默认 lt）与手写扣减式逐位等价（权重 0 的项永不被选中）', () => {
    const items = [0, 1, 2, 3]
    const table = [0, 3, 1, 6] // 第 0 项权重 0
    const w = (i: number): number => table[i]!
    const a = rngAt()
    const b = rngAt()
    let zeroPicked = 0
    for (let i = 0; i < 500; i += 1) {
      const got = pickWeighted(a, items, w)
      if (got === 0) zeroPicked += 1
      expect(got).toBe(refPickLt(b, items, w))
    }
    expect(a.count).toBe(b.count)
    expect(zeroPicked).toBe(0)
  })

  /**
   * ⚠ **如实说明本用例的边界**：`lt` 与 `lte` 只在"抽到的 `r` **精确命中**累计边界"时结果不同，
   * 而 `r = k/2³² × total` 命中边界需要 `k` 取到一个唯一值（概率 ≈ 2⁻³²）⇒ **用例构造不出来**。
   * 故这里保证的是"**可观测范围内**与手写 `roll <= 0` 式逐位一致（含抽数次数）"；
   * `bound` 选项存在的意义是**逐字复刻各处原有算术形式**，不是可观测差异。
   * （负向验证实测：把 `inclusive` 写死 false ⇒ 本用例**不会红**，如实登记。）
   */
  it('pickWeighted（lte）在可观测范围内与手写 `roll <= 0` 式逐位一致', () => {
    const items = ['x', 'y', 'z']
    const table: Record<string, number> = { x: 2, y: 5, z: 1 }
    const w = (s: string): number => table[s]!
    const a = rngAt()
    const b = rngAt()
    for (let i = 0; i < 500; i += 1) {
      expect(pickWeighted(a, items, w, { bound: 'lte' })).toBe(refPickLte(b, items, w))
    }
    expect(a.count).toBe(b.count)
  })

  it('边界：总权重 ≤ 0 / 空表 = undefined，且**都先抽了一次**；负权重按 0 夹紧（永不被选中）', () => {
    const zero = rngAt()
    expect(pickWeighted(zero, [1, 2], () => 0)).toBeUndefined()
    expect(zero.count).toBe(1)
    const empty = rngAt()
    expect(pickWeighted(empty, [], () => 1)).toBeUndefined()
    expect(empty.count).toBe(1)
    const neg = rngAt()
    for (let i = 0; i < 200; i += 1) {
      expect(pickWeighted(neg, ['neg', 'pos'], (s) => (s === 'neg' ? -5 : 1))).toBe('pos')
    }
  })

  it('分布 sanity：等权两项 ≈ 各半；单项必中', () => {
    const rng = rngAt()
    let left = 0
    const n = 2000
    for (let i = 0; i < n; i += 1) if (pickWeighted(rng, ['L', 'R'], () => 1) === 'L') left += 1
    expect(left / n).toBeGreaterThan(0.45)
    expect(left / n).toBeLessThan(0.55)
    expect(pickWeighted(rng, ['only'], () => 7)).toBe('only')
  })
})
