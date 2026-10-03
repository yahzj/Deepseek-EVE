/**
 * **入侵残骸的出量口径**（**2026-10-02 船长令「甲」** ＋ **2026-10-03 船长令三条**）
 *
 * ① **2026-10-02「甲」**（船长原话照抄）：「**我发现入侵残骸哪怕数量很少也能一次性捞出很多。**」
 *    ⇒ 裁「甲」＝ **系数只看本轮在出的那一池**（不再被星系密度顶起来）＋ **出量按池子余额封顶**。
 *    为什么必须改（旧口径实测）：富星系（密度 150）＋只有 10 m³ 的入侵池，40 轮能吐出 **2951 m³**
 *    （295 倍）—— 那正是"数量很少也能一次捞很多"。
 * ② 🔴 **2026-10-03 船长令三条**（原话照抄）：「**给所有打捞设定一个基础值，然后恢复渐近缓释**」＋
 *    「**所有的基础值上调到25立方米**」＋「**余额封顶也保留**」＋追补「**入侵池低于25立方时直接捞光剩余的**」
 *    ⇒ 池子的**扣减曲线改回渐近**（每轮放干"超出基础值部分"的 2%，与星系池同一常量与收口）、
 *    **出量仍按余额封顶**、**池量 ≤ 基础值（25 m³）时一轮把剩余全部捞光**。
 *
 * 本用例锁四件（全走真入口 `pullOneWreck`）：
 * ① **出量按余额封顶**（每一轮入舱的入侵族残骸 ≤ 该轮开始时的池量）；
 * ② **渐近缓释**（池子不再"几轮见底"：每轮只降 2%×超出量）；
 * ③ **池量 ≤ 基础值 ⇒ 一轮捞光剩余**（捞完即回落到本星系卡）；
 * ④ **星系密度不再影响入侵残骸出量**（同一个池子放在保底线星系与富星系里，捞出来的**一样多**）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { pullOneWreck } from '../src/salvaging'
import { WRECK_FLOOR, injectWeekendWreck, weekendWreckDensityOf } from '../src/salvage'
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

/** 连捞 N 轮，返回"入侵族残骸 m³ / 总 m³ / 见底轮次 / 封顶违规次数 / 逐轮池量" */
function salvage(
  s: GameState,
  rounds: number,
): { invasion: number; total: number; driedAt: number | null; capViolations: number; poolTrace: number[] } {
  let invasion = 0
  let total = 0
  let driedAt: number | null = null
  let capViolations = 0
  const poolTrace: number[] = []
  for (let i = 1; i <= rounds; i++) {
    const poolBefore = weekendWreckDensityOf(s, GID)
    const pick = pullOneWreck(s, ctx, GID, 60_000)
    if (!pick) break
    total += pick.volumeM3
    if (pick.itemId === INV_WRECK) invasion += pick.volumeM3
    /** 封顶契约：从入侵池出的那一轮，入舱量不得超过该轮开始时的池量 */
    if (pick.itemId === INV_WRECK && pick.volumeM3 > poolBefore + 1e-6) capViolations += 1
    if (poolBefore > 0 && weekendWreckDensityOf(s, GID) <= 0 && driedAt === null) driedAt = i
    poolTrace.push(weekendWreckDensityOf(s, GID))
  }
  return { invasion, total, driedAt, capViolations, poolTrace }
}

describe('入侵残骸出量 · 渐近缓释 ＋ 余额封顶（船长 2026-10-03 令；替代 2026-10-02「甲」的扣减口径）', () => {
  it('① 出量按余额封顶：每一轮入舱量 ≤ 该轮池量（池 30 m³ ⇒ 单轮最多 30）', () => {
    const s = world(150, 30)
    const r = salvage(s, 40)
    expect(r.capViolations, '一轮都没超出过池子余额').toBe(0)
    expect(r.poolTrace[0], '第 1 轮后池子只按渐近降一点（(30−25)×2% = 0.1）').toBeCloseTo(29.9, 6)
    console.log(`  [读数] 池 30 m³ ⇒ 40 轮里封顶违规 ${r.capViolations} 次；池量轨迹 ${r.poolTrace.slice(0, 4).map((v) => v.toFixed(2)).join(' → ')} …（渐近缓释）`)
  })

  it('② 渐近缓释：池子不再"几轮见底"（40 轮后仍高于基础值；降到基础值以下才一轮捞光）', () => {
    const s = world(150, 30)
    const r = salvage(s, 40)
    expect(weekendWreckDensityOf(s, GID), '40 轮后仍在基础值之上').toBeGreaterThan(WRECK_FLOOR)
    expect(r.driedAt, '40 轮内不该见底（改前"甲"是几轮见底）').toBeNull()
    /** 继续捞到池子触及基础值 ⇒ 一轮捞光（船长令「低于25立方时直接捞光剩余的」） */
    const more = salvage(s, 400)
    expect(more.driedAt, '最终会捞光（清底那条生效）').not.toBeNull()
    expect(weekendWreckDensityOf(s, GID), '捞光即归零').toBe(0)
    console.log(`  [读数] 池 30 m³：40 轮后剩 ${r.poolTrace.at(-1)!.toFixed(2)} m³（未干）· 继续捞到第 ${(more.driedAt ?? 0) + 40} 轮捞光`)
  })

  it('③ 池量 ≤ 基础值（25 m³）⇒ 一轮把剩余全部捞光，之后回落到本星系卡', () => {
    const s = world(150, 10)
    const r = salvage(s, 40)
    expect(r.driedAt, '低于基础值 ⇒ 一轮捞光').toBe(1)
    expect(r.invasion, '10 m³ 的池子：一次全给（约 10）').toBeCloseTo(10, 1)
    expect(r.total, '之后回落到本星系卡（不是捞不完）').toBeGreaterThan(r.invasion)
    console.log(`  [读数] 池 10 m³（≤ 基础值 25）⇒ 第 ${r.driedAt} 轮一次捞光 ${r.invasion.toFixed(1)} m³；其余 ${(r.total - r.invasion).toFixed(1)} m³ 是本星系卡`)
  })

  it('④ 星系密度不再影响入侵残骸出量：保底线星系与富星系，同一个池子捞出一样多', () => {
    const lean = salvage(world(10, 30), 40)
    const rich = salvage(world(150, 30), 40)
    expect(lean.invasion, `保底线星系捞出 ${lean.invasion.toFixed(1)} m³`).toBeCloseTo(rich.invasion, 6)
    expect(lean.driedAt, '两边都不该在 40 轮内见底').toBeNull()
    expect(rich.driedAt).toBeNull()
    /**
     * 对照：星系自己的残骸出量**照旧**吃密度（富星系每轮出得多）—— 两次令都只动入侵那一池的口径。
     * ⚠ 对照必须**把入侵池拿掉**再比（有入侵池时前 40 轮全被"入侵优先"占着，两边当然一样多）。
     */
    const leanGal = salvage(world(10, 0), 20)
    const richGal = salvage(world(150, 0), 20)
    expect(richGal.total, '富星系的总出量明显更大（星系卡那条口径未动）').toBeGreaterThan(leanGal.total * 2)
    console.log(
      `  [读数] 同一个 30 m³ 池：密度 10 捞 ${lean.invasion.toFixed(1)} m³ · 密度 150 捞 ${rich.invasion.toFixed(1)} m³（一致）` +
        `；**无入侵池时**同样 20 轮：密度 10 出 ${leanGal.total.toFixed(1)} m³ vs 密度 150 出 ${richGal.total.toFixed(1)} m³（星系卡照旧吃密度）`,
    )
  })
})
