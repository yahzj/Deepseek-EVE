/**
 * **抗性可为负数（易伤）**（2026-09-27 船长令：「**抗性打算允许负数**」· 三号）
 *
 * 起因：**掠袭折射涂层**（`mod-wh-a-coat`）的负面是「全抗性 −15」，而旧实现在三处把抗性夹在 `[0, 0.9]`
 * （`mergeResist` / `applyAdds` / 全抗性削减那段）＋ `applyDamage` 也夹 `0~0.9` ⇒
 * **在没有基础抗性的层上，这条负面完全不生效**（说明写着"代价是全抗性 −15"，实际代价为 0）。
 *
 * 新口径（`combat.ts` 的 `RESIST_FLOOR = −0.9`）：
 *   · 上限仍是 **0.9**（90% 顶格不变）；
 *   · 下限放到 **−0.9** ⇒ 负抗性 = **该层受额外伤害**（`(1 − 抗)` 最多 1.9）；
 *   · `evasion` 那一族 `clamp(0, 0.9, …)` **不在本规则内**（与抗性无关，故意没动）。
 *
 * ⚠ 判据用**「装涂层 vs 不装」的差值**，不写死绝对值——驾驶船本身可能带基础抗性
 * （实测：护盾动能抗 0.1 ⇒ 装涂层后 −0.05），写死会让用例随船表变动而假红。
 */
import { describe, expect, it } from 'vitest'
import { applyDamage, createPlayerSpec } from '../src/combat'
import { createInitialState } from '../src/state'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext('zh')
const LAYERS = ['shield', 'armor', 'hull'] as const
const TYPES = ['kinetic', 'explosive', 'plasma'] as const

const specOf = (withCoat: boolean) => {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ship = state.fleet[state.shipId]!
  if (withCoat) {
    ship.fitted.low = ['mod-wh-a-coat', ...ship.fitted.low.slice(1)]
    state.moduleBay['mod-wh-a-coat'] = 1
  }
  return createPlayerSpec(state, ctx, state.shipId)!
}

describe('抗性可为负数（掠袭折射涂层的「全抗性 −15」现在真的扣）', () => {
  it('**三层三系一律被扣 0.15**（旧实现里其中一些格被 `Math.max(0, …)` 吃掉）', () => {
    const withCoat = specOf(true)
    const base = specOf(false)
    for (const layer of LAYERS) {
      for (const t of TYPES) {
        const b = base.resists[layer]?.[t] ?? 0
        expect((withCoat.resists[layer]?.[t] ?? 0) - b, `${layer}.${t}`).toBeCloseTo(-0.15, 5)
      }
    }
  })

  it('**扣到负数就是负数**（本档实测：无基础抗性的八格为 −0.15，护盾动能格被削成 −0.05）', () => {
    const spec = specOf(true)
    const negatives = LAYERS.flatMap((l) => TYPES.map((t) => spec.resists[l]?.[t] ?? 0)).filter((v) => v < 0)
    expect(negatives.length).toBeGreaterThan(0)
    expect(spec.resists.armor?.kinetic ?? 0).toBeCloseTo(-0.15, 5)
    expect(spec.resists.hull?.plasma ?? 0).toBeCloseTo(-0.15, 5)
  })

  it('**负抗性 = 受额外伤害**（同一发打在装甲层：−15% 就是 ×1.15）', () => {
    const hp = { s: 0, a: 100_000, h: 100_000 }
    const neg = applyDamage(hp, { shield: {}, armor: { kinetic: -0.15 }, hull: {} } as never, 1_000, 'kinetic')
    const zero = applyDamage(hp, { shield: {}, armor: {}, hull: {} } as never, 1_000, 'kinetic')
    expect(neg.dealt).toBeGreaterThan(zero.dealt)
    expect(neg.dealt / zero.dealt).toBeCloseTo(1.15, 2)
  })

  it('**上限仍是 0.9**（90% 顶格没变：0.99 与 0.90 抗性吃到一样的伤害）', () => {
    const hp = { s: 10_000, a: 1, h: 1 }
    const capped = applyDamage(hp, { shield: { kinetic: 0.9 }, armor: {}, hull: {} } as never, 1_000, 'kinetic')
    const over = applyDamage(hp, { shield: { kinetic: 0.99 }, armor: {}, hull: {} } as never, 1_000, 'kinetic')
    expect(over.dealt).toBe(capped.dealt)
  })
})
