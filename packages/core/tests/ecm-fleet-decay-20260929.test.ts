/**
 * **全队型效果的"同舰递减乘法 ＋ 舰间乘法 ＋ 整队封顶"口径**（**2026-09-29 船长裁定「丙」**）
 *
 * 船长原话（照抄）：
 * 1. 「**墨潮电子舱玩家似乎将效果叠的很高，让所有敌人只剩下3000射程**」
 * 2. 「**这类全队型的效果，能否做全队多装递减，并且效果也是乘法**」
 * 3. 「**墨潮电子舱就照全队递减的乘法**」
 * 4. （我把"能叠多少"的三案读数摆出：甲整队单池 84%→36.7%、乙同舰＋舰间乘法 83.8%、
 *    丙 乙＋整队封顶 60%）「**丙**」
 *
 * 现行口径（单点 = `equipment.weightedGap` ＋ `WEIGHTED_GAP_FLEET_CAP`，调用点 = `combat.meFoeRangeDebuffOf`）：
 * ① **每艘船一个池**：该舰船体自带那份与**该舰每件**电子舱拉平，按强到弱套 EVE 曲线（100% / 87% / 57%…）
 *    后**乘法合成**；② **舰与舰之间也乘法**；③ **整队总上限 60%**。
 *
 * ⚠ **作废的两条旧口径**：2026-09-26 的「同舰加和、上限 90%」（4 舰各 6 件 = 99.99% ⇒ 敌人被压到地板）；
 * 同日先落的「整队拉平成一个池」（渐近只有 36.7%，每舰多装到第 4 件起几乎白装）。
 *
 * 本文件钉住：单舰件数曲线 · **舰间乘法**（多带舰有感）· **整队封顶 60%**（永不见底）·
 * 地板两道闸仍生效 · 与前两条旧口径的读数差 · 以及"什么都没有 ⇒ 0"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { WEIGHTED_GAP_FLEET_CAP } from '../src/equipment'
import { FOE_RANGE_DEBUFF_FLOOR_M, foeGunMaxRangeOf, meFoeRangeDebuffOf } from '../src/combat'
import type { GameState } from '../src/state'
import type { BattleState } from '../src/state'

const ctx = buildSimContext()
const ECM = 'mod-lair-ecm-h' // 墨潮电子舱（foeRangeDebuffPct 0.15 · 高槽 · CPU 150）
const EW = 'sh-wh-a-frigate' // 掠袭电子舰（船体自带 0.15）

/** 造编队：`carriers` 给几艘带件船（每艘装的件数 = `perShip`），`ew` 再补几艘电子舰 */
function fleet(carriers: number, perShip: number, ew = 0): { state: GameState; ids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.wallet.isk = 1_000_000_000
  const ids: string[] = []
  for (let i = 0; i < carriers; i++) {
    const uid = addShipToFleet(state, 'whale-king')
    state.fleet[uid]!.fitted = { high: Array.from({ length: perShip }, () => ECM), mid: [], low: [] }
    ids.push(uid)
  }
  for (let i = 0; i < ew; i++) ids.push(addShipToFleet(state, EW))
  if (ids.length === 0) ids.push(addShipToFleet(state, 'sh-whiteshark'))
  state.shipId = ids[0]!
  return { state, ids }
}

const shell = (r: number): BattleState => ({ meFoeRangeDebuff: r }) as unknown as BattleState

describe('全队递减乘法 · 墨潮电子舱（2026-09-29 船长裁定「丙」）', () => {
  it('**单舰件数曲线**：1 件 15.0% · 2 件 26.08% · 3 件 32.41% · 4 件 35.28%（同舰递减乘法）', () => {
    const want = [0.15, 0.260813, 0.324078, 0.352766]
    for (let n = 1; n <= want.length; n++) {
      const { state, ids } = fleet(1, n)
      expect(meFoeRangeDebuffOf(state, ctx, ids), `单舰 ${n} 件`).toBeCloseTo(want[n - 1]!, 5)
    }
  })

  it('**舰间乘法**：4 舰各 1 件 = 47.8%（多带舰有感，未触封顶）', () => {
    const { state, ids } = fleet(4, 1)
    expect(meFoeRangeDebuffOf(state, ctx, ids)).toBeCloseTo(1 - Math.pow(0.85, 4), 5) // 0.47799
  })

  it('**整队封顶 60%**：3 舰各 3 件（原始 69.1%）与 4 舰各 3 件（原始 79.1%）都封到 60%', () => {
    expect(WEIGHTED_GAP_FLEET_CAP).toBe(0.6)
    for (const [ships, per] of [
      [3, 3],
      [4, 3],
      [4, 6],
    ] as const) {
      const { state, ids } = fleet(ships, per)
      expect(meFoeRangeDebuffOf(state, ctx, ids), `${ships} 舰 × ${per} 件`).toBeCloseTo(0.6, 6)
    }
    // 未触顶的对照：2 舰各 3 件 = 54.31%（低于封顶 ⇒ 逐字生效）
    const under = fleet(2, 3)
    expect(meFoeRangeDebuffOf(under.state, ctx, under.ids)).toBeCloseTo(0.54313, 4)
  })

  it('**12,000 m 的敌人最多被压到 4,800 m**（封顶 60% ⇒ 永不见底；旧口径同配置是 3,000）', () => {
    const heavy = fleet(4, 6)
    const r = meFoeRangeDebuffOf(heavy.state, ctx, heavy.ids)
    const b = shell(r)
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 12_000 })).toBe(4_800)
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 12_000 })).toBeGreaterThan(FOE_RANGE_DEBUFF_FLOOR_M)
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 8_000 })).toBe(3_200)
  })

  it('**地板两道闸仍生效**：基础 < 3,000 m 完全不削；削后下限 3,000 m', () => {
    const { state, ids } = fleet(4, 6)
    const b = shell(meFoeRangeDebuffOf(state, ctx, ids))
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 2_500 })).toBe(2_500)
    expect(foeGunMaxRangeOf(b, {}, { maxRangeM: 3_500 })).toBe(FOE_RANGE_DEBUFF_FLOOR_M)
  })

  it('**同舰不同来源合成一个池 · 不同船之间才乘法**：一件电子舱 ＋ 一艘电子舰 = 27.75%', () => {
    const one = fleet(1, 1, 1)
    // 两艘船各一份 15% ⇒ 舰间乘法 1 − 0.85² = 27.75%（若两份在**同一条船**上，则是 26.08%）
    expect(meFoeRangeDebuffOf(one.state, ctx, one.ids)).toBeCloseTo(0.2775, 5)
    const bothOnOne = fleet(1, 2)
    expect(meFoeRangeDebuffOf(bothOnOne.state, ctx, bothOnOne.ids), '同舰两件 = 递减后的 26.08%').toBeCloseTo(0.260813, 5)
    // 只留电子舰那一份 = 15%
    const [, ew] = one.ids as [string, string]
    expect(meFoeRangeDebuffOf(one.state, ctx, [ew])).toBeCloseTo(0.15, 10)
  })

  it('什么都没有 ⇒ 0（零变化守卫）', () => {
    const { state, ids } = fleet(0, 0)
    expect(meFoeRangeDebuffOf(state, ctx, ids)).toBe(0)
  })
})
