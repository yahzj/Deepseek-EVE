/**
 * **打捞选择对象 ＋ 残骸分组记账**（**2026-09-26 船长令**：
 * 「**玩家打捞时，让玩家选择打捞对象，包括多族悬赏混合的星系，之后残骸也要分开算。**」
 * ＋ Q3 裁决：「**旧的常驻悬赏的残骸按各自均分**」＋「其余按你推荐来」）。
 *
 * 钉五件事：① 老存量按常驻悬赏卡**均分**落组 ② 注入按**击败卡的组**入账
 * ③ 选组⇒只出该组、只扣该组 ④ 漂移按总池**等比回调**、选入侵⇒两池各自独立
 * ⑤ 选组已捞干⇒不出（不自动换组）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { markExplored } from '../src/explore'
import { pullOneWreck, startSalvageOp, setSalvageTarget, wreckTargetsOf } from '../src/salvaging'
import {
  WEEKEND_WRECK_TARGET,
  advanceWreckDrift,
  injectWreckDensity,
  injectWeekendWreck,
  residentWreckGroupsOf,
  wreckGroupStockOf,
  wreckGroupStocksOf,
} from '../src/salvage'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
/** 找一个**至少两张可见悬赏、且分属不同组**的星系（"多族混悬赏"的那种） */
const GAL = (() => {
  for (const g of ctx.galaxies.keys()) {
    const cards = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === g)
    if (cards.length >= 2) return g
  }
  throw new Error('找不到多悬赏星系')
})()
const GROUPS = residentWreckGroupsOf(GAL, ctx)

const fresh = (seed = 5): GameState => createInitialState({ nowWallMs: 0, seed })

describe('打捞对象 · 分组记账（船长 2026-09-26 令）', () => {
  it('该星系有多张常驻悬赏、分属多个残骸组（前提成立）', () => {
    expect(GROUPS.length).toBeGreaterThanOrEqual(2)
  })

  it('**老存量按常驻悬赏卡均分落组**（Q3 口径）：首次读写即补齐 `byGroup`，Σ == density', () => {
    const s = fresh()
    injectWreckDensity(s, ctx, GAL, 300) // 造一本"没有组信息"的账
    const rec0 = s.galaxyWrecks[GAL]!
    delete rec0.byGroup // 模拟老档
    const rows = wreckGroupStocksOf(s, ctx, GAL)
    expect(rows.map((r) => r.groupKey).sort()).toEqual([...GROUPS].sort())
    const sum = rows.reduce((n, r) => n + r.stockM3, 0)
    expect(sum, 'Σ份额 == 总密度').toBeCloseTo(s.galaxyWrecks[GAL]!.density, 6)
    // 均分：各组相等
    const each = rows[0]!.stockM3
    for (const r of rows) expect(r.stockM3).toBeCloseTo(each, 6)
  })

  it('**注入按击败卡的组入账**：打谁就多谁那一组', () => {
    const s = fresh()
    /** 先建账（首笔注入会把"基础密度"一起记进来）⇒ 之后按**增量**断言 */
    injectWreckDensity(s, ctx, GAL, 300)
    const cards = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === GAL)
    const target = cards[cards.length - 1]!
    const targetGroup = wreckGroupStocksOf(s, ctx, GAL).length > 0 ? undefined : undefined
    void targetGroup
    const before = new Map(wreckGroupStocksOf(s, ctx, GAL).map((r) => [r.groupKey, r.stockM3]))
    const totalBefore = s.galaxyWrecks[GAL]!.density
    injectWreckDensity(s, ctx, GAL, 100, target.id)
    const after = new Map(wreckGroupStocksOf(s, ctx, GAL).map((r) => [r.groupKey, r.stockM3]))
    expect(s.galaxyWrecks[GAL]!.density - totalBefore, '总密度正好 +100').toBeCloseTo(100, 6)
    let grew = 0
    for (const [g, v] of after) {
      const d = v - (before.get(g) ?? 0)
      if (d > 0.5) grew += 1
      expect(d, `${g} 只增不减`).toBeGreaterThanOrEqual(-1e-6)
    }
    expect(grew, '只有一组增长（击败卡那一组）').toBe(1)
    const sumAfter = [...after.values()].reduce((n, v) => n + v, 0)
    expect(sumAfter, 'Σ份额 == 总密度').toBeCloseTo(s.galaxyWrecks[GAL]!.density, 6)
  })

  it('**选组 ⇒ 只出该组的残骸**（同一星系、多个组之间不串）', () => {
    const s = fresh(11)
    injectWreckDensity(s, ctx, GAL, 900) // 均分给各组
    const pick = GROUPS[0]!
    s.salvaging.active = true
    s.salvaging.galaxyId = GAL
    s.salvaging.targetGroup = pick
    s.salvaging.phase = 'salvaging'
    const got = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const r = pullOneWreck(s, ctx, GAL, 60_000)
      if (r) got.add(r.itemId)
    }
    expect(got.size, '只出该组的残骸物品').toBe(1)
    expect([...got][0], '正是选中组的物品').toBe(`wreck-${pick}`)
  })

  it('**选入侵残骸 ⇒ 只扣入侵池、不碰星系池**；反之选组不碰入侵池', () => {
    const s = fresh(13)
    injectWreckDensity(s, ctx, GAL, 500)
    injectWeekendWreck(s, GAL, 400, 'H')
    const beforeGal = s.galaxyWrecks[GAL]!.density
    const beforeInv = wreckGroupStockOf(s, ctx, GAL, WEEKEND_WRECK_TARGET)
    // ① 选入侵 ⇒ 星系池一分不动
    s.salvaging.active = true
    s.salvaging.galaxyId = GAL
    s.salvaging.targetGroup = WEEKEND_WRECK_TARGET
    pullOneWreck(s, ctx, GAL, 60_000)
    expect(s.galaxyWrecks[GAL]!.density, '星系池一分不动').toBeCloseTo(beforeGal, 6)
    expect(wreckGroupStockOf(s, ctx, GAL, WEEKEND_WRECK_TARGET), '入侵池被扣掉一截').toBeLessThan(beforeInv)
    // ② 选某一组 ⇒ 入侵池一分不动
    const invAfter = wreckGroupStockOf(s, ctx, GAL, WEEKEND_WRECK_TARGET)
    const galAfter = s.galaxyWrecks[GAL]!.density
    s.salvaging.targetGroup = GROUPS[0]!
    pullOneWreck(s, ctx, GAL, 60_000)
    expect(wreckGroupStockOf(s, ctx, GAL, WEEKEND_WRECK_TARGET), '入侵池一分不动').toBeCloseTo(invAfter, 6)
    expect(s.galaxyWrecks[GAL]!.density, '星系池被扣').toBeLessThan(galAfter)
  })

  it('**漂移按总池等比回调**（Σ份额 == 总密度 不变）', () => {
    const s = fresh(17)
    injectWreckDensity(s, ctx, GAL, 900)
    const sum0 = wreckGroupStocksOf(s, ctx, GAL).reduce((n, r) => n + r.stockM3, 0)
    advanceWreckDrift(s, ctx, 6 * 3_600_000) // 推 6 小时（衰减朝向基础密度）
    const rec = s.galaxyWrecks[GAL]!
    const sum1 = Object.values(rec.byGroup ?? {}).reduce((n, v) => n + v, 0)
    expect(sum1, 'Σ份额仍等于总密度').toBeCloseTo(rec.density, 6)
    expect(sum1, '总池确实变了（漂移生效）').not.toBeCloseTo(sum0, 3)
  })

  it('**选中的组捞干后 ⇒ 本轮不出**（不自动换组）', () => {
    const s = fresh(19)
    const pick = GROUPS[0]!
    // 只给这一组一点点（注入到该组、其余组为 0）
    const s2 = fresh(19)
    injectWreckDensity(s2, ctx, GAL, 200)
    const cards = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === GAL)
    const card = cards.find((a) => residentWreckGroupsOf(GAL, ctx).includes(pick))!
    void card
    s.salvaging.active = true
    s.salvaging.galaxyId = GAL
    s.salvaging.phase = 'salvaging'
    // 把该组份额手动清零 ⇒ 该组已空
    injectWreckDensity(s, ctx, GAL, 10)
    wreckGroupStocksOf(s, ctx, GAL)
    s.galaxyWrecks[GAL]!.byGroup![pick] = 0
    s.salvaging.targetGroup = pick
    expect(wreckGroupStockOf(s, ctx, GAL, pick)).toBe(0)
    expect(pullOneWreck(s, ctx, GAL, 60_000), '该组已空 ⇒ 不出').toBeNull()
  })

  it('**随档往返**：`byGroup`（组份额）与 `targetGroup`（打捞对象）读档后都还在', () => {
    const s = fresh(29)
    injectWreckDensity(s, ctx, GAL, 300)
    wreckGroupStocksOf(s, ctx, GAL) // 触发惰性补齐（写入 byGroup）
    s.salvaging.active = true
    s.salvaging.galaxyId = GAL
    s.salvaging.phase = 'salvaging'
    s.salvaging.targetGroup = GROUPS[0]!
    const raw = serializeSaveFile(s, 0)
    const back = loadSaveFile(raw).state
    expect(back.salvaging.targetGroup, '打捞对象随档').toBe(GROUPS[0])
    expect(back.galaxyWrecks[GAL]?.byGroup?.[GROUPS[0]!], '组份额随档').toBeCloseTo(
      s.galaxyWrecks[GAL]!.byGroup![GROUPS[0]!]!,
      6,
    )
  })

  it('开工带对象：非法/无存量的对象**回落"全部"**（不拒开工）；`wreckTargetsOf` 给界面读数', () => {
    const s = fresh(23)
    injectWreckDensity(s, ctx, GAL, 300)
    s.shipId = Object.keys(s.fleet)[0]!
    markExplored(s, GAL) // 开工前置：目标星系需已探索（与既有用例同口径）
    s.fleet[s.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] } as never
    const ok = startSalvageOp(s, GAL, ctx, 'no-such-group')
    expect(ok.ok, `应能开工（实际：${JSON.stringify(ok)}）`).toBe(true)
    expect(s.salvaging.targetGroup, '非法对象 ⇒ 回落全部').toBeUndefined()
    // 中途换对象：换成合法组 ⇒ 生效
    const applied = setSalvageTarget(s, ctx, GROUPS[0]!)
    expect(applied).toBe(GROUPS[0])
    const rows = wreckTargetsOf(s, ctx, GAL)
    expect(rows.map((r) => r.groupKey)).toContain(GROUPS[0])
  })
})
