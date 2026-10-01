/**
 * **组装机 · 循环续做的扣料与退料账**（**2026-10-01 收口** · 船长「玩家又反应了一些早就修好的BUG」后普查发现）。
 *
 * 病根：`advanceManufacturing` 的"续做下一件"分支原先自己写了一句
 * `removeWare(state, need.itemId, matNeedCount(…))` ——
 * ① **不走等价组**（`materialGroupIdsOf`）② **不记 `spentMaterials` 退料账** ③ **忽略返回值**。
 * 后果（实测）：玩家手上只有**通用黑匣**、而配方写的是**墨潮黑匣**时，**循环续做的那几件不扣料 = 白造**；
 * 且"料种/数量恒定"的普通情形下两处记账偏差互相抵消 ⇒ 一直没被发现。
 *
 * 修法 = **把"扣一件的料"收成一处**（`spendMaterialsFor`），开工与续做共用同一把尺：
 * 等价组按组序取够 · 逐笔记**实际扣的那种** · 凑不齐就整体回滚并停线；
 * 并把退料账的语义钉成"**只记在跑那一件已扣的料**"（交付即结清）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startManufacturing, setManufacturingLoop, cancelManufacturing, manufacturingRunViews } from '../src/manufacturing'
import { countModule } from '../src/equipment'
import { countWare } from '../src/inventory'
import { makeTestCtx, blueprint, skipFirstSkillReward, moduleDef } from './helpers'

/** 配方要**墨潮黑匣 ×1**（组序里排在「通用黑匣」之后 ⇒ 只有通用黑匣时走组内替补） */
function world(): { state: GameState; ctx: ReturnType<typeof makeTestCtx> } {
  const ctx = makeTestCtx({
    modules: [moduleDef('mod-a', 'turret', 0)],
    blueprints: [blueprint('bp-bb', 'mod-a', [{ itemId: 'blackbox-h', count: 1 }], { buildSeconds: 60 })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  skipFirstSkillReward(state)
  state.blueprintStock['bp-bb'] = 1
  state.learnedRecipes.push('bp-bb')
  return { state, ctx }
}

describe('组装机 · 循环续做的扣料（2026-10-01 收口）', () => {
  it('**等价组**：只有「通用黑匣」时，续做的每一件都要照扣（改前是白造）', () => {
    const { state, ctx } = world()
    state.warehouse.items['blackbox-universal'] = 5
    expect(startManufacturing(state, 'bp-bb', 'pilot', ctx).ok).toBe(true)
    expect(countWare(state, 'blackbox-universal'), '开工扣第 1 件').toBe(4)
    expect(setManufacturingLoop(state, 'bp-bb', true, null).ok).toBe(true)

    advanceGame(state, 60_000, ctx) // 第 1 件完成 → 续做第 2 件（此刻必须扣）
    expect(countWare(state, 'blackbox-universal'), '续做第 2 件').toBe(3)
    expect(countModule(state, 'mod-a')).toBe(1)

    advanceGame(state, 60_000, ctx) // 第 2 件完成 → 续做第 3 件
    expect(countWare(state, 'blackbox-universal'), '续做第 3 件').toBe(2)
    expect(countModule(state, 'mod-a')).toBe(2)
    expect(countWare(state, 'blackbox-h'), '墨潮黑匣一枚都不该被扣（玩家没有）').toBe(0)
  })

  it('**退料账 = 在跑那一件**：取消时退的正好是当前那件已扣的料（不多退也不少退）', () => {
    const { state, ctx } = world()
    state.warehouse.items['blackbox-universal'] = 5
    expect(startManufacturing(state, 'bp-bb', 'pilot', ctx).ok).toBe(true)
    expect(setManufacturingLoop(state, 'bp-bb', true, null).ok).toBe(true)
    advanceGame(state, 60_000, ctx) // 第 1 件交付（账结清）＋续做第 2 件（重新记账）
    expect(countWare(state, 'blackbox-universal')).toBe(3)
    expect(state.manufacturingRuns[0]!.spentMaterials, '账里应当是"在跑那件"的 1 枚')
      .toEqual([{ itemId: 'blackbox-universal', count: 1 }])
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(countWare(state, 'blackbox-universal'), '退回在跑那件').toBe(4)
    expect(countModule(state, 'mod-a'), '已交付的那件不退').toBe(1)
  })

  it('**料尽自停**：仓库只剩 1 枚 ⇒ 第 1 件照做，续做时缺料 ⇒ 自停并写停因（不白造）', () => {
    const { state, ctx } = world()
    state.warehouse.items['blackbox-universal'] = 1
    expect(startManufacturing(state, 'bp-bb', 'pilot', ctx).ok).toBe(true)
    expect(setManufacturingLoop(state, 'bp-bb', true, null).ok).toBe(true)
    advanceGame(state, 120_000, ctx) // 第 1 件完成；第 2 件扣不动
    expect(countModule(state, 'mod-a'), '只做出 1 件').toBe(1)
    expect(countWare(state, 'blackbox-universal')).toBe(0)
    expect(manufacturingRunViews(state, ctx), '线已结束').toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('循环制造停止') && l.text.includes('材料不足'))).toBe(true)
  })
})
