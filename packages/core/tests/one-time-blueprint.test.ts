/**
 * **一次性图纸**（2026-09-12 船长：「能否实现一次性图纸？既玩家无法学会，只能制造一次的图纸」）。
 *
 * 船长逐条裁定（本文件锁住的口径）：
 * - **1甲**：仍是"书"——进蓝图书架，但**不能学习**，只能到组装机造一次；
 * - **2乙**：**已永久学会同名配方时**，这本书**不能当"学习"用、也不用掉**（不消耗）；
 * - **3甲**：书在**开工那一刻**扣掉（与材料同源）；
 *   ⚠ **2026-09-20 船长改判**：「**一次性蓝图的制造取消后返还玩家蓝图**」
 *   ⇒ **取消（未完工）时书与"名额"一起退还**；**完工仍不退**（书已兑现成产物，那才是"只能制造一次"的落点）。
 *   （原口径"取消/失败不退还"作废，见 `manufacturing.ts` 的 `refundOneTimeBook`。）
 * - **4乙**：可卖（本批不额外做限制；能否上市场由是否登记市场卡决定）；
 * - **5**：本批**只做机制**，来源后续裁定；
 * - **6不进**：不得出现在碎片逆向配方表（由 `content:check` 契约拦）；
 * - **成品与普通蓝图完全一样**（同属性、可自用可卖），差别只在"这门配方只能用一次"。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { learnBlueprint } from '../src/market'
import {
  cancelManufacturing,
  canStartBlueprint,
  isSingleUseBlueprint,
  manufacturingRunViews,
  ownsBlueprint,
  recipeCapability,
  startManufacturing,
} from '../src/manufacturing'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { addWare } from '../src/inventory'
import { blueprint, makeTestCtx } from './helpers'

/** bp-one：一次性图纸（造 mod-a，10 单位矿粉甲，600 秒）；bp-a 为普通对照 */
function world(): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const ctx = makeTestCtx({ blueprints: [blueprint('bp-one', 'mod-a', [{ itemId: 'min-a', count: 10 }], { singleUse: true })] })
  addWare(state, 'min-a', 100)
  return { state, ctx }
}

describe('一次性图纸 · 学习与可用性判定', () => {
  let state: GameState
  let ctx: SimContext
  beforeEach(() => {
    const w = world()
    state = w.state
    ctx = w.ctx
  })

  it('① 不能学习：书留在书架、配方不进已学会表', () => {
    state.blueprintStock['bp-one'] = 1
    const r = learnBlueprint(state, ctx, 'bp-one')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('一次性图纸')
    expect(ownsBlueprint(state, 'bp-one')).toBe(false)
    expect(state.blueprintStock['bp-one']).toBe(1) // 没被吃掉
  })

  it('② 可用性判定：有书且名额未用尽 ⇒ 可开工并消耗书；没书且名额用尽 ⇒ exhausted', () => {
    expect(recipeCapability(state, 'bp-one', true)).toEqual({ kind: 'no-book', consumeBook: false })
    state.blueprintStock['bp-one'] = 1
    expect(recipeCapability(state, 'bp-one', true)).toEqual({ kind: 'ok', consumeBook: true })
    // **书在架上就是可用**（名额用完只表示"上一张已吃掉"）⇒ 先把书清掉才看得到 exhausted
    delete state.blueprintStock['bp-one']
    state.spentOneTimeRecipes = ['bp-one']
    expect(recipeCapability(state, 'bp-one', true)).toEqual({ kind: 'exhausted', consumeBook: false })
    // 再获得一张 ⇒ 又回到"可造一次"
    state.blueprintStock['bp-one'] = 1
    expect(recipeCapability(state, 'bp-one', true)).toEqual({ kind: 'ok', consumeBook: true })
    // 普通蓝图恒 ok、且不吃书（零行为变化）
    expect(recipeCapability(state, 'bp-a', false)).toEqual({ kind: 'ok', consumeBook: false })
  })

  it('③ 已永久学会该配方 ⇒ 一次性书不消耗也不用（船长裁定 2乙）', () => {
    state.learnedRecipes.push('bp-one')
    state.blueprintStock['bp-one'] = 2
    expect(recipeCapability(state, 'bp-one', true)).toEqual({ kind: 'learned', consumeBook: false })
    expect(startManufacturing(state, 'bp-one', 'pilot', ctx).ok).toBe(true)
    expect(state.blueprintStock['bp-one']).toBe(2) // 一本都没动
    expect(state.spentOneTimeRecipes ?? []).not.toContain('bp-one')
  })

  it('⑥ 缺书 ⇒ 不能开工；普通蓝图未学会照旧拒绝（旧口径不变）', () => {
    const r = startManufacturing(state, 'bp-one', 'pilot', ctx)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('一次性图纸')
    // 普通蓝图：未学会 ⇒ 旧提示不变
    const r2 = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r2.ok).toBe(false)
    expect(r2.error ?? '').toContain('尚未学会')
  })

  /**
   * ⑨ **`canStartBlueprint` = 组装机卡片的按钮判据**（2026-09-14 船长报障后钉死）：
   * 船长原话：「组装机原先没有图纸时会跳转到市场求购的按钮怎么没了」。
   *
   * 根因：该判据曾写成 `ownsBlueprint || recipeCapability(..., singleUse).kind === 'ok'`，
   * 而 `recipeCapability(..., singleUse=false)` 对**普通图纸恒返回 `ok`**（见 ② 末行断言）——
   * 那是"配方可用"，不是"现在能开工" ⇒ 未学会的普通图纸也判成"能造"，组装机卡片于是永远走
   * 「手动制造 / AI 工位」那一支，**「市场求购蓝图书」按钮整个轮不到**（实测 181 张里 123 张被吃掉）。
   * 本用例把"未学会的普通图纸 ⇒ false"钉住，防止有人再拿 `recipeCapability` 当开工判据。
   */
  it('⑨ 开工判据 `canStartBlueprint`：未学会的普通图纸必须为 false（否则"市场求购"按钮会被挡掉）', () => {
    // 普通图纸：未学会 ⇒ 不能开工（这正是"该去市场买书"的那一档）
    expect(canStartBlueprint(state, ctx, 'bp-a')).toBe(false)
    // 一次性图纸：书架无书 ⇒ 不能开工；有书且名额未用尽 ⇒ 能
    expect(canStartBlueprint(state, ctx, 'bp-one')).toBe(false)
    state.blueprintStock['bp-one'] = 1
    expect(canStartBlueprint(state, ctx, 'bp-one')).toBe(true)
    // 学会普通配方 ⇒ 能开工
    state.learnedRecipes.push('bp-a')
    expect(canStartBlueprint(state, ctx, 'bp-a')).toBe(true)
    // ⚠ **反面对照**（就是当年写错的那条）：`recipeCapability` 对普通图纸恒 `ok` ⇒
    // 直接拿它当开工判据会让上面第一行为 true（即"未学会也能造"）——这正是回归的形状
    expect(recipeCapability(state, 'bp-one', false).kind).toBe('ok')
  })
})

describe('一次性图纸 · 制造（开工扣书、只能造一次、**取消退书**）', () => {
  let state: GameState
  let ctx: SimContext
  beforeEach(() => {
    const w = world()
    state = w.state
    ctx = w.ctx
  })

  it('④ 开工即消耗这本图纸 + 名额记为已用尽；材料照旧扣除', () => {
    state.blueprintStock['bp-one'] = 1
    const r = startManufacturing(state, 'bp-one', 'pilot', ctx)
    expect(r.ok).toBe(true)
    expect(state.blueprintStock['bp-one'] ?? 0).toBe(0) // 书已消耗
    expect(state.spentOneTimeRecipes ?? []).toContain('bp-one')
    expect(state.manufacturingRuns.filter((x) => x.active)).toHaveLength(1)
    expect(state.logs.some((l) => l.text.includes('一次性图纸'))).toBe(true)
  })

  it('⑤ 名额用尽后再开工 ⇒ 拒绝（要再获得一张同名图纸）', () => {
    state.blueprintStock['bp-one'] = 1
    expect(startManufacturing(state, 'bp-one', 'pilot', ctx).ok).toBe(true)
    const again = startManufacturing(state, 'bp-one', 'basic', ctx)
    expect(again.ok).toBe(false)
    expect(again.error ?? '').toContain('名额已用尽')
  })

  /**
   * **船长 2026-09-20：「一次性蓝图的制造取消后返还玩家蓝图」** —— 本条取代原「取消不退」口径。
   * 关键点：退书**必须连名额标记一起恢复**，否则书回来了仍判 `exhausted`（那是"假退"）。
   */
  it('⑦ 取消制造 ⇒ 一次性图纸退回书架，且**名额同时恢复**（可再次开工）', () => {
    state.blueprintStock['bp-one'] = 1
    expect(startManufacturing(state, 'bp-one', 'pilot', ctx).ok).toBe(true)
    expect(state.blueprintStock['bp-one'] ?? 0).toBe(0) // 开工吃掉
    const run = state.manufacturingRuns.find((x) => x.active)!
    expect(cancelManufacturing(state, ctx, run.id).ok).toBe(true)
    expect(state.blueprintStock['bp-one']).toBe(1) // 书回来了
    expect(state.spentOneTimeRecipes ?? []).not.toContain('bp-one') // 名额也恢复了
    expect(state.logs.some((l) => l.text.includes('一次性图纸已退回蓝图书架'))).toBe(true)
    // 名额已恢复 ⇒ 同一张书可以再次开工
    const again = startManufacturing(state, 'bp-one', 'pilot', ctx)
    expect(again.error ?? '').toBe('')
    expect(again.ok).toBe(true)
    expect(state.blueprintStock['bp-one'] ?? 0).toBe(0)
  })

  it('⑦b 取消**只退这一本**：两条同名线（存量 2）各自独立结算', () => {
    state.blueprintStock['bp-one'] = 2
    state.aiCores['basic'] = 2
    state.skills.trained['ai-expert'] = 1 // AI 上限 +1
    expect(startManufacturing(state, 'bp-one', 'pilot', ctx).ok).toBe(true)
    expect(state.blueprintStock['bp-one']).toBe(1)
    expect(startManufacturing(state, 'bp-one', 'basic', ctx).ok).toBe(true)
    expect(state.blueprintStock['bp-one'] ?? 0).toBe(0)
    const runs = state.manufacturingRuns.filter((x) => x.active)
    expect(runs).toHaveLength(2)
    // 取消第一条 ⇒ 只回来一本；第二条仍在跑，总存量应为 1（不是 2）
    expect(cancelManufacturing(state, ctx, runs[0]!.id).ok).toBe(true)
    expect(state.blueprintStock['bp-one']).toBe(1)
    expect(state.manufacturingRuns.filter((x) => x.active)).toHaveLength(1)
  })

  it('⑦c 重复取消同一条线 ⇒ 拒绝（书不会凭空多出来）', () => {
    state.blueprintStock['bp-one'] = 1
    expect(startManufacturing(state, 'bp-one', 'pilot', ctx).ok).toBe(true)
    const run = state.manufacturingRuns.find((x) => x.active)!
    expect(cancelManufacturing(state, ctx, run.id).ok).toBe(true)
    expect(state.blueprintStock['bp-one']).toBe(1)
    const twice = cancelManufacturing(state, ctx, run.id)
    expect(twice.ok).toBe(false)
    expect(state.blueprintStock['bp-one']).toBe(1)
  })

  it('⑧ 普通蓝图的制造行为逐字不变（不吃书、可无限次；取消也不动书架）', () => {
    state.learnedRecipes.push('bp-a')
    // 两条线都用主控亲自？不行（手动位全局限 1 条）⇒ 第二条走 AI 核心；
    // AI 线需核心库存 + 上限技能（与既有制造用例同款前置）
    state.aiCores['basic'] = 2
    state.skills.trained['ai-expert'] = 1 // 「AI 核心操作学」：上限 +1（balance.aiCoreCapSkillId）
    const r1 = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r1.error ?? '').toBe('')
    expect(r1.ok).toBe(true)
    const r2 = startManufacturing(state, 'bp-a', 'basic', ctx)
    expect(r2.error ?? '').toBe('')
    expect(r2.ok).toBe(true) // 同蓝图第二线照旧允许
    expect(isSingleUseBlueprint(ctx, 'bp-a')).toBe(false)
    expect(manufacturingRunViews(state, ctx)).toHaveLength(2)
    // 普通图纸取消：书架与名额表都不该动（零行为变化）
    const stockBefore = JSON.stringify(state.blueprintStock)
    const spentBefore = JSON.stringify(state.spentOneTimeRecipes ?? [])
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(JSON.stringify(state.blueprintStock)).toBe(stockBefore)
    expect(JSON.stringify(state.spentOneTimeRecipes ?? [])).toBe(spentBefore)
  })
})

describe('一次性图纸 · 存档兼容', () => {
  it('老档缺 `spentOneTimeRecipes` ⇒ 读档归一为空表（零迁移）', () => {
    const w = world()
    const raw = JSON.parse(serializeSaveFile(w.state, 0)) as { state: Record<string, unknown> }
    delete raw.state.spentOneTimeRecipes
    const loaded = loadSaveFile(JSON.stringify(raw))
    expect(loaded.state.spentOneTimeRecipes ?? []).toEqual([])
  })

  it('已用尽名单随档往返保留（换档重开也维持"只能造一次"）', () => {
    const w = world()
    w.state.blueprintStock['bp-one'] = 1
    expect(startManufacturing(w.state, 'bp-one', 'pilot', w.ctx).ok).toBe(true)
    expect(w.state.spentOneTimeRecipes).toContain('bp-one')
    // 存 + 读（真实存档通道）
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(loaded.spentOneTimeRecipes).toContain('bp-one')
    // 读档后：书架没书 ⇒ 不能再造（要再获得一张）
    const again = startManufacturing(loaded, 'bp-one', 'pilot', w.ctx)
    expect(again.ok).toBe(false)
    expect(again.error ?? '').toContain('一次性图纸')
  })
})
