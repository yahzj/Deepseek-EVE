/**
 * **电子舰特性 · 压制敌舰武器射程**（船长 2026-09-18：「**电子舰新增特性，削减敌人15%的武器射程，
 * 可以乘法叠加，与敌人的射程增加效果做加法处理。（比如10000m射程，我方一艘电子舰，对方拥有射程+50%，
 * 那么对方实际射程为13500.）射程最短只能削弱到3000m（不足3000m的无法被削弱）。**」）
 *
 * 口径（三问三答全取甲）：
 * - **多艘乘法合成**：`r = 1 − Π(1 − vᵢ)`（1 艘 15% · 2 艘 27.75%）；
 * - **与敌方增程做加法**：净倍率 = `增程倍率 − r`；
 * - **地板**：基础射程 < 3000m ⇒ **完全不削**；否则削后**下限 3000m**；**只动最远射程**、近界不动；
 * - **作用面** = 敌方全部武器（舰体武器走 `foeGunMaxRangeOf`、机群走 `foeDroneRangeOf`）。
 *
 * 本文件钉住：数值公式（含船长给的两个例子：13500m 与 2 艘的 12225m）、地板两道闸、
 * 两处单一真相源都被压到、以及"没有电子舰 ⇒ 逐字不变"。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { BattleState } from '../src/state'
import {
  FOE_RANGE_DEBUFF_FLOOR_M,
  createBattleState,
  foeDroneRangeOf,
  foeGunMaxRangeOf,
  foeRangeDebuffOf,
} from '../src/combat'
import { addShipToFleet } from '../src/shipyard'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { buildSimContext } from '@whale/data'

const base: SimContext = buildSimContext()
const EW_A = 'sh-wh-a-frigate' // 掠袭电子舰（电子舰 · foeRangeDebuffPct 0.15）
const EW_D = 'sh-wh-d-frigate' // 哨戒电子舰（同上）
const NON_EW = 'sh-whiteshark' // 对照：大白鲨级炮舰（无该字段）

/** 造一场最小战斗（只要 `BattleState` 承载运行态；敌我单位用真数据舰级） */
function world(ewCount: number): { state: GameState; ctx: SimContext; ids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const ids: string[] = []
  const ewIds = [EW_A, EW_D]
  for (let i = 0; i < ewCount; i++) ids.push(addShipToFleet(state, ewIds[i % ewIds.length]!))
  if (ewCount === 0) ids.push(addShipToFleet(state, NON_EW))
  state.shipId = ids[0]!
  return { state, ctx: base, ids }
}

/** 取一个"只是壳"的战斗状态：射程函数只读 `meFoeRangeDebuff` 与入参 */
function battleWith(state: GameState, ctx: SimContext, ids: readonly string[]): BattleState {
  const me = {
    name: 'x',
    tag: 'player',
    weapons: [],
    hp: { s: 1, a: 1, h: 1 },
  } as unknown as Parameters<typeof createBattleState>[0]
  const b = createBattleState(me, [], 0, 1000)
  // 建档路径会写运行态；这里直接调单点口径 —— 与引擎同源（`applyFoeRangeDebuff` 是私有帮手）
  const r = foeRangeDebuffOf(state, ctx, ids)
  if (r > 0) b.meFoeRangeDebuff = r
  return b
}

const GUN = (maxRangeM: number): { maxRangeM: number } => ({ maxRangeM })
const DRONE = (maxRangeM: number): { maxRangeM: number; minRangeM: number; falloff: number; kind: 'fixed' } =>
  ({ maxRangeM, minRangeM: 200, falloff: 1, kind: 'fixed' })

describe('电子舰 · 压制敌舰武器射程（船长 2026-09-18）', () => {
  it('**数据侧**：只有两艘电子舰带 0.15，其余船一件都不带', () => {
    expect(base.ships.get(EW_A)!.foeRangeDebuffPct).toBe(0.15)
    expect(base.ships.get(EW_D)!.foeRangeDebuffPct).toBe(0.15)
    expect(base.ships.get(NON_EW)!.foeRangeDebuffPct).toBeUndefined()
    const owners = [...base.ships.values()].filter((s) => (s.foeRangeDebuffPct ?? 0) > 0)
    expect(owners.map((s) => s.id).sort()).toEqual([EW_A, EW_D].sort())
  })

  it('**一艘 15%**：炮台 10000 → 8500（无增程）；近界一字不动（只动最远射程）', () => {
    const { state, ctx, ids } = world(1)
    const b = battleWith(state, ctx, ids)
    expect(b.meFoeRangeDebuff).toBeCloseTo(0.15, 10)
    expect(foeGunMaxRangeOf(b, {}, GUN(10_000))).toBe(8_500)
    // 近界不走这条函数（引擎只对 maxRangeM 取有效值）⇒ 用一条"近界 1500"的武器确认函数不碰它
    const w = { minRangeM: 1_500, maxRangeM: 10_000 }
    foeGunMaxRangeOf(b, {}, w)
    expect(w.minRangeM).toBe(1_500)
  })

  it('**与敌方增程做加法**（船长给的例子）：10000 + 敌方 +50% + 我方 1 艘 = **13500**', () => {
    const { state, ctx, ids } = world(1)
    const b = battleWith(state, ctx, ids)
    // `foeGunRangeMulOf` 读 `unit.foeGunRangeMulOnHit` + 战斗态 `foeGunRangeBuff`
    b.foeGunRangeBuff = 1.5
    expect(foeGunMaxRangeOf(b, { foeGunRangeMulOnHit: 1.5 }, GUN(10_000))).toBe(13_500)
    // 做的是加法：1.5 − 0.15 = 1.35（若按乘法会是 1.5 × 0.85 = 1.275 ⇒ 12750）
    expect(foeGunMaxRangeOf(b, { foeGunRangeMulOnHit: 1.5 }, GUN(10_000))).not.toBe(12_750)
  })

  it('**多艘乘法叠加**：2 艘 ⇒ 削减 27.75%；10000 无增程 → 7225，敌 +50% → **12225**', () => {
    const { state, ctx, ids } = world(2)
    const b = battleWith(state, ctx, ids)
    expect(b.meFoeRangeDebuff).toBeCloseTo(0.2775, 10)
    expect(foeGunMaxRangeOf(b, {}, GUN(10_000))).toBe(7_225)
    b.foeGunRangeBuff = 1.5
    expect(foeGunMaxRangeOf(b, { foeGunRangeMulOnHit: 1.5 }, GUN(10_000))).toBe(12_225)
  })

  it('**地板 3000m**：3500 被削到 3000（不更低）；削到底也≥3000', () => {
    const { state, ctx, ids } = world(1)
    const b = battleWith(state, ctx, ids)
    expect(foeGunMaxRangeOf(b, {}, GUN(3_500))).toBe(FOE_RANGE_DEBUFF_FLOOR_M)
    // 极端：削减率很大时也止步 3000
    const heavy = { ...b, meFoeRangeDebuff: 0.9 } as BattleState
    expect(foeGunMaxRangeOf(heavy, {}, GUN(10_000))).toBe(FOE_RANGE_DEBUFF_FLOOR_M)
  })

  it('**不足 3000m 的无法被削弱**：基础 2500 ⇒ 一毫不削（但它自己的增程照吃）', () => {
    const { state, ctx, ids } = world(1)
    const b = battleWith(state, ctx, ids)
    expect(foeGunMaxRangeOf(b, {}, GUN(2_500))).toBe(2_500)
    b.foeGunRangeBuff = 1.5
    expect(foeGunMaxRangeOf(b, { foeGunRangeMulOnHit: 1.5 }, GUN(2_500))).toBe(3_750)
  })

  it('**敌方机群同款**：机群 5000 无增程 → 4250；E 族 ×4 增程 → 5000×(4−0.15)=19250', () => {
    const { state, ctx, ids } = world(1)
    const b = battleWith(state, ctx, ids)
    const w = DRONE(5_000) as never
    expect(foeDroneRangeOf(b, w)).toBe(4_250)
    b.foeDroneRangeBuff = 4
    expect(foeDroneRangeOf(b, w)).toBe(19_250)
    // 不足 3000m 的机型：**不削**——但它自己的增程照吃（此时 buff 仍是 ×4 ⇒ 2600×4 = 10400）
    const small = DRONE(2_600) as never
    expect(foeDroneRangeOf(b, small)).toBe(10_400)
    b.foeDroneRangeBuff = undefined
    expect(foeDroneRangeOf(b, small)).toBe(2_600)
  })

  it('**没有电子舰 = 逐字不变**（零变化守卫）', () => {
    const { state, ctx, ids } = world(0)
    const b = battleWith(state, ctx, ids)
    expect(b.meFoeRangeDebuff).toBeUndefined()
    expect(foeGunMaxRangeOf(b, {}, GUN(10_000))).toBe(10_000)
    b.foeGunRangeBuff = 1.5
    expect(foeGunMaxRangeOf(b, { foeGunRangeMulOnHit: 1.5 }, GUN(10_000))).toBe(15_000)
    b.foeDroneRangeBuff = 4
    expect(foeDroneRangeOf(b, DRONE(5_000) as never)).toBe(20_000)
  })

  it('合成口径单点：`foeRangeDebuffOf` 按编队逐艘累计（1 艘 0.15 · 2 艘 0.2775 · 混编只数带字段的船）', () => {
    const one = world(1)
    expect(foeRangeDebuffOf(one.state, one.ctx, one.ids)).toBeCloseTo(0.15, 10)
    const two = world(2)
    expect(foeRangeDebuffOf(two.state, two.ctx, two.ids)).toBeCloseTo(0.2775, 10)
    // 混编：电子舰 + 普通舰 ⇒ 只数带字段那艘
    const mixedIds = [...two.ids, addShipToFleet(two.state, NON_EW)]
    expect(foeRangeDebuffOf(two.state, two.ctx, mixedIds)).toBeCloseTo(0.2775, 10)
    // 编队里没有电子舰 ⇒ 0（不写运行态）
    const none = world(0)
    expect(foeRangeDebuffOf(none.state, none.ctx, none.ids)).toBe(0)
  })
})
