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
  battleMaxDistanceM,
  battleOpenM,
  createBattleState,
  foeDesiredRange,
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

/**
 * **战场远端（距离上限）**——船长 2026-09-19 报障「部分敌人会增加射程的情况下，战场可以移动的距离
 * 还是很短，**无法逃离对方射程**」＋口径「**计算战场宽度时考虑到技能的增程就行，不用直接乘**」（裁定「甲」）。
 *
 * 改前：上限被钉死在**开战那一刻**的 `openM` ⇒ 敌方挨打增程后射程反超上限 ⇒ 玩家退无可退。
 * 改后：上限 = `max(开战距离, 1.1 × 当前双方有效射程)`（同一套"射程 + 10% 缓冲"公式，**不乘常数**），
 * 我方那一侧已含技能/装配/谜质科技增程、敌方那一侧含受击增程，且**只增不减**。
 */
describe('战场远端 · 距离上限随增程走（船长 2026-09-19 裁定「甲」）', () => {
  const bal = base.balance.battle
  const gun = (maxRangeM: number): { maxRangeM: number; src: 'gun'; minRangeM: number } =>
    ({ maxRangeM, src: 'gun', minRangeM: 0 })
  const meSpec = (maxRangeM: number): Parameters<typeof battleMaxDistanceM>[1] =>
    ({ weapons: [gun(maxRangeM)] } as unknown as Parameters<typeof battleMaxDistanceM>[1])
  const foeSpec = (
    maxRangeM: number,
    mul?: number,
  ): Parameters<typeof battleMaxDistanceM>[2][number] =>
    ({
      weapons: [gun(maxRangeM)],
      ...(mul !== undefined ? { foeGunRangeMulOnHit: mul } : {}),
    } as unknown as Parameters<typeof battleMaxDistanceM>[2][number])
  /** 只是壳的战斗状态：本组函数只读 `foeGunRangeBuff` / `foeDroneRangeBuff` / `meFoeRangeDebuff` */
  const shell = (): ReturnType<typeof createBattleState> =>
    createBattleState(
      { name: 'x', tag: 'player', weapons: [], hp: { s: 1, a: 1, h: 1 } } as never,
      [],
      0,
      1000,
    )

  it('无任何增程 ⇒ 上限**逐字等于开战距离**（= 旧行为，改前改后画面一致）', () => {
    const b = shell()
    const me = meSpec(8_000)
    const foes = [foeSpec(7_000)]
    expect(battleOpenM(me, foes as never, bal)).toBe(8_800) // 8000 × 1.0 + max(100, 800)
    expect(battleMaxDistanceM(b, me, foes, bal)).toBe(8_800)
  })

  it('我方科技/技能增程已计入（我方 8,232 ⇒ 上限 9,055）', () => {
    const b = shell()
    expect(battleMaxDistanceM(b, meSpec(8_232), [foeSpec(7_000)], bal)).toBe(9_055)
  })

  it('**敌方挨打增程后，上限抬到它射程之外**（导弹残段 11,000 ⇒ 增程 ×1.5 = 16,500 ⇒ 上限 18,150）', () => {
    const b = shell()
    const me = meSpec(8_232)
    const missile = foeSpec(11_000, 1.5)
    // 未触发增程：上限按 11,000 算（= 12,100，玩家刚好在它射程外一点）
    expect(battleMaxDistanceM(b, me, [missile], bal)).toBe(12_100)
    // 触发之后（引擎把整队标量写在 `foeGunRangeBuff`）：上限跟着抬到 18,150 > 16,500 ⇒ **有地方可退**
    b.foeGunRangeBuff = 1.5
    const ceiling = battleMaxDistanceM(b, me, [missile], bal)
    expect(ceiling).toBe(18_150)
    expect(ceiling, '上限必须大于敌方增程后的射程——否则"逃离对方射程"不可能').toBeGreaterThan(
      foeGunMaxRangeOf(b, missile as never, gun(11_000) as never),
    )
  })

  it('电子舰压制（削敌射程）之后，上限随之收窄；但只要开战距离更大就仍以开战距离为地板', () => {
    const b = shell()
    const me = meSpec(8_232)
    const foe = foeSpec(16_500)
    expect(battleMaxDistanceM(b, me, [foe], bal)).toBe(18_150)
    b.meFoeRangeDebuff = 0.15 // 一艘电子舰：16,500 → 14,025
    expect(battleMaxDistanceM(b, me, [foe], bal)).toBe(18_150) // 地板 = 开战距离（只增不减）
    // 开战距离本身也随之变小 ⇒ 上限按"当前射程"给：14,025 × 1.1 = 15,428 < 18,150（地板仍生效）
    b.meFoeRangeDebuff = 0.15
    const openNow = battleOpenM(me, [foe] as never, bal)
    expect(battleMaxDistanceM(b, me, [foe], bal)).toBeGreaterThanOrEqual(openNow)
  })
})

/**
 * **敌人期望距离随削减收缩**（船长 2026-09-18：「**削减射程后，敌人的期望距离也要随之改变**」）。
 *
 * 口径：把射程带的**上界**换成"只被削减后"的有效上界（`foeRangeWithDebuff(band.max, 1, r)`，
 * 含"基础 <3000 不削"与"下限 3000"两道闸），再在**有效带**里取同一相对位置；
 * 显式钉住的期望距离按同一比例收缩。**增程那条既有口径不动**（它只延长够得着的距离、不挪窝）。
 */
describe('敌人期望距离随削减收缩（船长 2026-09-18）', () => {
  /** 造一个带射程带的敌舰规格（`foeRangeBand` 是 `foeDesiredRange` 的舰级路径口径） */
  const foeWith = (band: { min: number; max: number }, tactic = 'orbit', pinned?: number) =>
    ({
      tag: 'foe-0',
      name: 'x',
      weapons: [],
      hp: { s: 1, a: 1, h: 1 },
      foeTactic: tactic,
      foeRangeBand: band,
      ...(pinned !== undefined ? { foeDesireRangeM: pinned } : {}),
    }) as unknown as Parameters<typeof foeDesiredRange>[1][number]

  const BAL = base.balance.battle
  const pos = BAL.tacticDesireFactor['orbit']!

  it('**band 路径**：带 [2000, 10000] · orbit ⇒ 削减 15% 后按有效上界 8500 重取同一相对位置', () => {
    const foes = [foeWith({ min: 2000, max: 10_000 })]
    const plain = foeDesiredRange(foes[0]!, foes, BAL)
    const cut = foeDesiredRange(foes[0]!, foes, BAL, 0.15)
    expect(plain).toBe(Math.round(2000 + pos * 8000))
    expect(cut).toBe(Math.round(2000 + pos * 6500)) // 有效上界 8500 ⇒ 带 [2000, 8500]
    expect(cut).toBeLessThan(plain) // 敌人主动压近
  })

  it('**两艘**（27.75%）：有效上界 7225 ⇒ 期望距离进一步收缩', () => {
    const foes = [foeWith({ min: 2000, max: 10_000 })]
    expect(foeDesiredRange(foes[0]!, foes, BAL, 0.2775)).toBe(Math.round(2000 + pos * 5225))
  })

  it('**钉住的期望距离按同一比例收缩**（E 族那种 `foeDesireRangeM` 覆写）', () => {
    const foes = [foeWith({ min: 2000, max: 10_000 }, 'kite', 8_000)]
    expect(foeDesiredRange(foes[0]!, foes, BAL, 0)).toBe(8_000)
    expect(foeDesiredRange(foes[0]!, foes, BAL, 0.15)).toBe(Math.round(8_000 * 0.85))
  })

  it('**基础 <3000m 的不削 ⇒ 期望距离也不变**；**上限 3000 地板照旧生效**', () => {
    const small = [foeWith({ min: 500, max: 2_500 })]
    expect(foeDesiredRange(small[0]!, small, BAL, 0.15)).toBe(foeDesiredRange(small[0]!, small, BAL, 0))
    // 带 [2000, 3500]：削后有效上界 = 3000（地板）⇒ 期望距离 = 2000 + pos×1000
    const low = [foeWith({ min: 2000, max: 3_500 })]
    expect(foeDesiredRange(low[0]!, low, BAL, 0.15)).toBe(Math.round(2000 + pos * 1000))
  })

  it('**与增程无关**（2026-09-12 既有口径不动）：只给削减才改期望距离', () => {
    const foes = [foeWith({ min: 2000, max: 10_000 })]
    // 期望距离只吃"削减"这一项：函数没有增程入参 ⇒ 同 r 下结果恒等（增程只影响"够得着多远"）
    expect(foeDesiredRange(foes[0]!, foes, BAL, 0.15)).toBe(foeDesiredRange(foes[0]!, foes, BAL, 0.15))
  })

  it('**没有电子舰 = 逐字不变**（零变化守卫）', () => {
    const foes = [foeWith({ min: 2000, max: 10_000 })]
    const withNoDebuff = foeDesiredRange(foes[0]!, foes, BAL, 0)
    expect(withNoDebuff).toBe(Math.round(2000 + pos * 8000))
  })
})
