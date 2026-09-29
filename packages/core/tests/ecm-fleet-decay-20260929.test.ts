/**
 * **全队型效果的"全队多装递减 ＋ 乘法"口径**（**2026-09-29 船长令**）
 *
 * 船长原话（照抄）：
 * 1. 「**墨潮电子舱玩家似乎将效果叠的很高，让所有敌人只剩下3000射程**」
 * 2. （我把读数与甲乙丙三案摆出后）「**这类全队型的效果，能否做全队多装递减，并且效果也是乘法**」
 * 3. 「**墨潮电子舱就照全队递减的乘法**」
 *
 * 现行口径（单点 = `equipment.weightedGap`，调用点 = `combat.meFoeRangeDebuffOf`）：
 * **整队所有来源拉平进一个池**（每艘电子舰船体自带的一份 ＋ 每一件电子舱各一份），
 * 按单件效果从强到弱套 **EVE 曲线权重**（`stackWeight`：100% / 87% / 57% / 28%…），再**乘法合成**
 * `r = 1 − Π(1 − vᵢ·wᵢ)`。
 *
 * ⚠ **作废的旧口径**（2026-09-26 立的 `sum` 档）：**同舰多件先加和、上限 90%** ＋ 跨舰乘法 ——
 * 那条下"4 舰各 3 件 = 90.8%、4 舰各 6 件 = 99.99%"，12,000 m 的敌人被一路压到地板 3,000 m。
 *
 * 本文件钉住：件数曲线与**渐近上限**（≈36.7%，再多件也不涨）· **12,000 m 的敌人不再落到地板** ·
 * 地板两道闸仍生效 · 与电子舰船体那份同池 · 以及"什么都没有 ⇒ 0"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { FOE_RANGE_DEBUFF_FLOOR_M, foeGunMaxRangeOf, meFoeRangeDebuffOf } from '../src/combat'
import type { GameState } from '../src/state'
import type { BattleState } from '../src/state'

const ctx = buildSimContext()
const ECM = 'mod-lair-ecm-h' // 墨潮电子舱（foeRangeDebuffPct 0.15 · 高槽 · CPU 150）
const EW = 'sh-wh-a-frigate' // 掠袭电子舰（船体自带 0.15）

/** 一条装 n 件电子舱的船（`carrierId === null` ⇒ 顺带再加一艘电子舰）；返回编队 id 列表 */
function fleet(withEw: boolean): { state: GameState; ids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.wallet.isk = 1_000_000_000
  // 鲸王级（高槽 3 · CPU 充足）：装得下多件电子舱
  const carrier = addShipToFleet(state, 'whale-king')
  state.moduleBay[ECM] = 8
  const ids: string[] = []
  if (withEw) ids.push(addShipToFleet(state, EW))
  state.shipId = carrier
  return { state, ids: [carrier, ...ids] }
}

/** 往 `uid` 上装 n 件电子舱（**直接写装配位**：本用例只测"衰减池怎么算"，
 *  池子读的就是 `fitted` 这份清单；若走 `fitModule` 会被 CPU/槽位闸门挡在 2 件上，
 *  测不到 3 件以上的曲线——那属于装配校验的活，另有专门用例守） */
function fitEcm(state: GameState, uid: string, n: number): void {
  state.fleet[uid]!.fitted = { high: Array.from({ length: n }, () => ECM), mid: [], low: [] }
}

describe('全队递减乘法 · 墨潮电子舱（2026-09-29 船长令）', () => {
  it('件数曲线：1 件 15.0% · 2 件 26.08% · 3 件 32.41% · 4 件 35.28%', () => {
    const want = [0.15, 0.260813, 0.324078, 0.352766]
    for (let n = 1; n <= want.length; n++) {
      const { state, ids } = fleet(false)
      fitEcm(state, ids[0]!, n)
      expect(meFoeRangeDebuffOf(state, ctx, ids), `${n} 件`).toBeCloseTo(want[n - 1]!, 5)
    }
  })

  it('**渐近上限 ≈ 36.7%**：12 件与 20 件同值（再多件也不涨）——旧口径同配置是 99.99%', () => {
    const { state, ids } = fleet(false)
    fitEcm(state, ids[0]!, 12)
    const r12 = meFoeRangeDebuffOf(state, ctx, ids)
    expect(r12).toBeCloseTo(0.366643, 5)
    const many = fleet(false)
    fitEcm(many.state, many.ids[0]!, 20)
    expect(meFoeRangeDebuffOf(many.state, ctx, many.ids)).toBeCloseTo(r12, 6)
    expect(r12, '旧口径（同舰加和上限 90% × 跨舰乘法）在这里是 99.99%').toBeLessThan(0.4)
  })

  it('**12,000 m 的敌人不再落到 3,000 地板**：4 件 ⇒ 7,767 m · 12 件 ⇒ 7,600 m', () => {
    const four = fleet(false)
    fitEcm(four.state, four.ids[0]!, 4)
    const r4 = meFoeRangeDebuffOf(four.state, ctx, four.ids)
    const b4 = { meFoeRangeDebuff: r4 } as unknown as BattleState
    expect(foeGunMaxRangeOf(b4, {}, { maxRangeM: 12_000 })).toBe(7_767)
    const twelve = fleet(false)
    fitEcm(twelve.state, twelve.ids[0]!, 12)
    const r12 = meFoeRangeDebuffOf(twelve.state, ctx, twelve.ids)
    const b12 = { meFoeRangeDebuff: r12 } as unknown as BattleState
    expect(foeGunMaxRangeOf(b12, {}, { maxRangeM: 12_000 })).toBe(7_600)
    expect(foeGunMaxRangeOf(b12, {}, { maxRangeM: 12_000 })).toBeGreaterThan(FOE_RANGE_DEBUFF_FLOOR_M)
  })

  it('**地板两道闸仍生效**：基础 < 3,000 m 完全不削；削后下限 3,000 m', () => {
    const { state, ids } = fleet(false)
    fitEcm(state, ids[0]!, 12)
    const b = { meFoeRangeDebuff: meFoeRangeDebuffOf(state, ctx, ids) } as unknown as BattleState
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 2_500 })).toBe(2_500)
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 3_500 })).toBe(FOE_RANGE_DEBUFF_FLOOR_M)
  })

  it('**船体那份与装备件同池**：一件电子舱 ＋ 一艘电子舰 = 26.08%（不再按"先同舰加和"算）', () => {
    const { state, ids } = fleet(true)
    const [carrier, ew] = ids as [string, string]
    fitEcm(state, carrier, 1)
    expect(meFoeRangeDebuffOf(state, ctx, ids)).toBeCloseTo(0.260813, 5)
    // 只留电子舰那一份 = 15%
    expect(meFoeRangeDebuffOf(state, ctx, [ew])).toBeCloseTo(0.15, 10)
  })

  it('什么都没有 ⇒ 0（零变化守卫）', () => {
    const { state, ids } = fleet(false)
    expect(meFoeRangeDebuffOf(state, ctx, ids)).toBe(0)
  })
})
