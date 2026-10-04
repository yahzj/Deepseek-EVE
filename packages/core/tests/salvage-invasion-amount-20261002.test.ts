/**
 * **入侵残骸的出量由池子的量封顶**（**2026-10-02 船长令「甲」**）
 *
 * 船长原话（照抄）：「**我发现入侵残骸哪怕数量很少也能一次性捞出很多。**」⇒ 我给出实测与三档修法后裁「**甲**」
 * ＝ **池子的量真正约束出量**。
 *
 * 改前（旧口径，2026-09-25 定）：每轮入舱 = 单份体积 × `max(0.5, (星系密度 ＋ 入侵残骸)/10)`，
 * 而入侵池每轮只按 **2% 渐近**放干（永不归零）⇒ **富星系（密度 150）＋只有 10 m³ 的入侵池**，
 * 40 轮能吐出 **2951 m³ 入侵残骸（295 倍）** —— 正是"数量很少也能一次捞很多"。
 * 甲的余额封顶与实际扣量保留；2026-10-04 出量改取当地基础吞吐，不受入侵存量影响。
 *
 * 本用例锁三件（全走真入口 `pullOneWreck`）：
 * ① **池子标称量 = 能捞多少的上限**（30 m³ 的池子捞出来的入侵族残骸 ≤ 30 m³，且池子见底）；
 * ② **星系密度不再影响入侵残骸的出量**（同一个池子放在保底线星系与富星系里，捞出来的**一样多**）；
 * ③ 入侵池见底后**回落到本星系卡**（不是"永远捞不完"）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { pullOneWreck } from '../src/salvaging'
import { injectWeekendWreck, weekendWreckDensityOf } from '../src/salvage'
import type { GameState } from '../src/state'

const ctx = buildSimContext('zh')
/** 一个"本来就有可见悬赏"的星系（池底 = 它的原卡）；被占期间池子并入入侵舰队 */
const GID = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
/** H 族（入侵那一族）的残骸物品 = `wreck-h-hi`（组 key `h-hi`） */
const INV_WRECK = 'wreck-h-hi'

function world(density: number, invasionM3: number): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  /**
   * ⚠ 事件必须**以"此刻"为起点**：`pullOneWreck` 内部按墙钟判该星系是否还在占领期
   * （写死 1970 会被判成"早已夺回"⇒ 池子根本不并入入侵卡，第一次写这类用例就踩过）。
   */
  s.weekendEvent = {
    seq: 3,
    startedAtWallMs: Date.now(),
    coreId: 'galaxy-kor',
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.galaxyWrecks = { [GID]: { density, rare: 0 } }
  if (invasionM3 > 0) injectWeekendWreck(s, GID, invasionM3, 'H')
  return s
}

/** 连捞 N 轮，返回"入侵族残骸 m³ / 总 m³ / 见底轮次" */
function salvage(s: GameState, rounds: number): { invasion: number; total: number; driedAt: number | null } {
  let invasion = 0
  let total = 0
  let driedAt: number | null = null
  for (let i = 1; i <= rounds; i++) {
    const poolBefore = weekendWreckDensityOf(s, GID)
    const pick = pullOneWreck(s, ctx, GID, 60_000)
    if (!pick) break
    total += pick.volumeM3
    if (pick.itemId === INV_WRECK) invasion += pick.volumeM3
    if (poolBefore > 0 && weekendWreckDensityOf(s, GID) <= 0 && driedAt === null) driedAt = i
  }
  return { invasion, total, driedAt }
}

describe('入侵残骸出量 · 甲：池子的量封顶（船长 2026-10-02 令）', () => {
  it('① 30 m³ 的池子 ⇒ 捞出来的入侵族残骸 ≤ 30 m³，且池子见底', () => {
    const s = world(150, 30)
    const r = salvage(s, 40)
    expect(r.invasion, `捞出的入侵族残骸 ${r.invasion.toFixed(1)} m³ 不该超过池子标称 30 m³`).toBeLessThanOrEqual(30.001)
    expect(r.invasion, '也不该明显少于 30（池子里的都该能捞出来）').toBeGreaterThan(28)
    expect(weekendWreckDensityOf(s, GID), '池子见底').toBe(0)
    expect(r.driedAt, '见底发生在少数几轮内（不是几十轮）').not.toBeNull()
    expect(r.driedAt!).toBeLessThanOrEqual(6)
    console.log(`  [读数] 池 30 m³ ⇒ 捞出 ${r.invasion.toFixed(1)} m³ 入侵族残骸（第 ${r.driedAt} 轮见底）`)
  })

  it('② 星系密度不再影响入侵残骸出量：保底线星系与富星系，同一个池子捞出一样多', () => {
    const lean = salvage(world(10, 30), 40)
    const rich = salvage(world(150, 30), 40)
    expect(lean.invasion, `保底线星系捞出 ${lean.invasion.toFixed(1)} m³`).toBeCloseTo(rich.invasion, 6)
    expect(lean.invasion).toBeLessThanOrEqual(30.001)
    /** 对照：星系自己的残骸出量**照旧**吃密度（富星系每轮出得多）—— 甲只改了入侵那一池的口径 */
    expect(rich.total, '富星系总出量明显更大（星系卡那条口径未动）').toBeGreaterThan(lean.total * 2)
    console.log(
      `  [读数] 同一个 30 m³ 池：密度 10 捞 ${lean.invasion.toFixed(1)} m³ · 密度 150 捞 ${rich.invasion.toFixed(1)} m³（一致）` +
        `；总出量 ${lean.total.toFixed(1)} vs ${rich.total.toFixed(1)} m³（星系卡照旧吃密度）`,
    )
  })

  it('③ 池子很小（10 m³）⇒ 就只能捞这么多；见底后回落到本星系卡', () => {
    const s = world(150, 10)
    const r = salvage(s, 40)
    expect(r.invasion, '10 m³ 的池子最多捞 10 m³').toBeLessThanOrEqual(10.001)
    expect(r.invasion).toBeGreaterThan(9)
    expect(r.total, '见底后回落到本星系卡（不是捞不完）').toBeGreaterThan(r.invasion)
    console.log(`  [读数] 池 10 m³ ⇒ 捞出 ${r.invasion.toFixed(1)} m³ 入侵族残骸，其余 ${(r.total - r.invasion).toFixed(1)} m³ 是本星系卡`)
  })
})
