/**
 * **洞内稀有残骸「高级箱」回落池的权重用例**（**2026-09-24 船长令**：
 * 「（我看歪了）不能纯给 MK3，**洞内残骸如果未命中，则从 MK2 和 MK3 里抽。MK3 的权重降低为 0.25**」
 * ＋同日确认「**MK2 的权重按 1**」）。
 *
 * 钉三件事：
 * ① **按组权重抽**：MK2 组 w=1 / MK3 组 w=0.25 ⇒ 出 MK3 的实际概率 ≈ **20%**（这里用 2000 次固定种子
 *    抽样，宽容区间 15%~25% —— 区间只是防抖动，权重本身是精确的 0.25/1.25）；
 * ② 组内仍然是**均匀**抽（同一组两件时两件都出得来）；
 * ③ 组为空/未传 ⇒ 退回旧的**扁平回落池**口径（不改变别的调用点）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { rollRareBoxExtra } from '../src/salvage'
import type { RecycleProfile } from '../src/salvage'
import { makeTestCtx } from './helpers'

/**
 * 手工画像（不走 `recycleProfileOf`：本用例只关心**回落池**这一支）：
 * `lairGear` 缺省 ⇒ ①族专属那支不会命中（否则会以 5~10% 的概率插进来干扰计数）；
 * `theme` 空 ⇒ ②必然落到"带权重回落池"上。
 */
function fixture(seed: number) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ctx = makeTestCtx({ quietEvents: true })
  const profile = { tier: 'common', region: 'out', theme: { mk2: [], modules: [] }, mineralPool: [] } as unknown as RecycleProfile
  return { state, ctx, profile }
}

const MK2 = 'mod-w-test-2'
const MK3 = 'mod-w-test-3'

describe('高级箱回落池：MK2 权重 1 / MK3 权重 0.25（船长 2026-09-24 令）', () => {
  it('① MK3 的实际占比 ≈ 20%（2000 次抽样）', () => {
    const { state, ctx, profile } = fixture(11)
    const groups = [
      { ids: [MK2], weight: 1 },
      { ids: [MK3], weight: 0.25 },
    ]
    let mk3 = 0
    const N = 2000
    for (let i = 0; i < N; i += 1) {
      const extra = rollRareBoxExtra(state, ctx, profile, [], groups)
      const got = extra?.modules[0]
      expect(got === MK2 || got === MK3).toBe(true) // 每次必出一件（②保底）
      if (got === MK3) mk3 += 1
    }
    const share = mk3 / N
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.25)
  })

  it('② 组内均匀：同一组两件都能被抽到', () => {
    const { state, ctx, profile } = fixture(12)
    const groups = [{ ids: ['mod-w-a-2', 'mod-w-b-2'], weight: 1 }]
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const got = rollRareBoxExtra(state, ctx, profile, [], groups)?.modules[0]
      if (got) seen.add(got)
    }
    expect([...seen].sort()).toEqual(['mod-w-a-2', 'mod-w-b-2'])
  })

  it('③ 组为空 ⇒ 退回扁平回落池（旧口径不变）', () => {
    const { state, ctx, profile } = fixture(13)
    const flat = rollRareBoxExtra(state, ctx, profile, [MK3], [])?.modules[0]
    expect(flat).toBe(MK3)
  })
})
