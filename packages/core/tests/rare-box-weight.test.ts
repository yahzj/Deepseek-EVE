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
 *
 * ⚠ **2026-09-30 补 ④⑤**：上面三条都只传了"扁平池"或"带权重组"其中一份，从没覆盖 `industry.ts`
 * 真实传的**两份都非空**组合 —— 而修前实现先问扁平池 ⇒ 带权重组永远走不到（船长报障「洞内稀有残骸
 * 回收疑似还是只有 MK3，没有 MK2 池」，引擎 2 万次实测 MK2 = 0）。现在顺序是
 * **卡面 theme → 带权重组 → 扁平兜底池**，④⑤ 把两端都钉住。
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

  /**
   * ④ **真实调用组合**（2026-09-30 修 · 船长报障「洞内稀有残骸回收疑似还是只有 MK3，没有 MK2 池」）。
   *
   * 修前 `industry.ts` 传的是「扁平 MK3 池 ＋ 带权重组」两份都非空，而实现先问扁平池 ⇒ 带权重组
   * 永远走不到、洞内高级箱只出 MK3（引擎 2 万次实测 MK2 = 0）。上面三条用例都只传了其中一份
   * ⇒ 谁都没覆盖这个组合，所以 CI 一直是绿的。本用例钉的就是"两份都在时谁说了算"。
   */
  it('④ 扁平池非空时也必须让位给带权重组（真实调用组合）', () => {
    const { state, ctx, profile } = fixture(14)
    const groups = [
      { ids: [MK2], weight: 1 },
      { ids: [MK3], weight: 0.25 },
    ]
    const FLAT = 'mod-w-flat-3'
    let mk2 = 0
    let mk3 = 0
    let flat = 0
    const N = 2000
    for (let i = 0; i < N; i += 1) {
      const got = rollRareBoxExtra(state, ctx, profile, [FLAT], groups)?.modules[0]
      if (got === MK2) mk2 += 1
      else if (got === MK3) mk3 += 1
      else if (got === FLAT) flat += 1
    }
    expect(flat).toBe(0) // 甲1案扁平池不再抢先
    expect(mk2).toBeGreaterThan(N * 0.7)
    expect(mk3).toBeLessThan(N * 0.3)
  })

  it('⑤ 两份回落池都空 ⇒ 仍退回扁平池（甲1案兜底不变）', () => {
    const { state, ctx, profile } = fixture(15)
    const got = rollRareBoxExtra(state, ctx, profile, [MK3], [{ ids: [], weight: 1 }])?.modules[0]
    expect(got).toBe(MK3)
  })
})
