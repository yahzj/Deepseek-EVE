/**
 * **扩槽插件生效**（**2026-09-27 船长令「修」**）。
 *
 * 背景：船长追问「其他插件呢」⇒ 12 件插件逐字段审计 ⇒ 只有「中层舱段插件 `midSlotsAdd: 1`」与
 * 「下层舱段插件 `lowSlotsAdd: 1`」**core 里零消费**（只有 `shipInfo` 的说明文字写着"中槽 +1"）
 * ⇒ 装上跟没装一样，与同日修的 CPU 上限插件同一个病根。
 *
 * 本作槽位数 = `fitted.mid` / `fitted.low` 的**数组长度** ⇒ 修法两半：
 * ① 槽位单点 `plugs.shipSlotsWithPlugsOf`（船型布局 ＋ 插件扩槽）供装配校验与界面共用；
 * ② `installPlug` 成功后**就地补齐**位数组（插件不可拆 ⇒ 只增不减）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  cpuBudgetOf,
  createInitialState,
  fitModule,
  installPlug,
  plugSlotAddsOf,
  shipSlotsWithPlugsOf,
  unfitAt,
} from '../src/index'
import { makeTestCtx, moduleDef, ship } from './helpers'

/**
 * 船：高/中/低 = 1/1/1，**插件槽 2**；两件扩槽插件（中层 +1 中槽 / 下层 +1 低槽）
 * ＋ 各一件中/低槽装备（用来验"多出来的格子真能装"）。
 */
function world(): { state: GameState; ctx: SimContext; uid: string } {
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-bay', { cpu: 200, plugSlots: 2, slots: { high: 1, mid: 1, low: 1 } })],
    modules: [
      moduleDef('plug-mid-bay', 'plug', 0, { cpuUse: 0, midSlotsAdd: 1 }),
      moduleDef('plug-low-bay', 'plug', 0, { cpuUse: 0, lowSlotsAdd: 1 }),
      moduleDef('mid-thing', 'shield', 0, { rack: 'mid', cpuUse: 1 }),
      moduleDef('low-thing', 'armor', 0, { rack: 'low', cpuUse: 1 }),
      moduleDef('low-thing-2', 'armor', 0, { rack: 'low', cpuUse: 1, armorHpBonus: 0.5 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 77 })
  const uid = addShipToFleet(state, 'sh-bay')
  state.shipId = uid
  return { state, ctx, uid }
}

describe('扩槽插件（中层舱段 / 下层舱段 · 2026-09-27 船长令「修」）', () => {
  it('装上「中层舱段插件」⇒ 中槽 1 → 2：位数组就地变长，槽位单点跟着走', () => {
    const { state, ctx, uid } = world()
    expect(state.fleet[uid]!.fitted.mid.length).toBe(1)
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(1)
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(plugSlotAddsOf(state, ctx, uid)).toEqual({ mid: 1, low: 0 })
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 2, low: 1 })
    // 关键：数组真的变长了（装配页按它画格子）
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2)
    expect(state.fleet[uid]!.fitted.mid).toEqual([null, null])
  })

  it('**多出来的格子真能装**：中槽原本 1 格已占满 ⇒ 装扩槽插件后第 2 件放行', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mid-thing')
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    // 1 格已满：再装一件被拒
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(false)
    // 扩槽 ⇒ 第 2 格出现 ⇒ 放行
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    expect(state.fleet[uid]!.fitted.mid.filter((x) => x !== null).length).toBe(2)
  })

  it('两件扩槽插件各管一路，互不串（中槽 +1 / 低槽 +1）', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    addModule(state, 'plug-low-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(installPlug(state, ctx, 'plug-low-bay', uid).ok).toBe(true)
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 2, low: 2 })
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2)
    expect(state.fleet[uid]!.fitted.low.length).toBe(2)
  })

  it('**没有扩槽插件时一切照旧**：槽位与数组长度都还是船型的 1/1/1', () => {
    const { state, ctx, uid } = world()
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: 1, mid: 1, low: 1 })
    expect(plugSlotAddsOf(state, ctx, uid)).toEqual({ mid: 0, low: 0 })
    addModule(state, 'low-thing')
    expect(fitModule(state, 'low-thing', ctx, { shipId: uid }).ok).toBe(true)
    // 低槽 1 格已满 ⇒ 第 2 件被拒（回归护栏：修扩槽不许把原有上限放松）
    addModule(state, 'low-thing-2')
    expect(fitModule(state, 'low-thing-2', ctx, { shipId: uid }).ok).toBe(false)
  })

  it('**老档对齐**：已装插件但数组还是旧长度 ⇒ 下一次装配动作幂等补齐', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    // 模拟老档：把数组硬裁回旧长度（插件仍在 plugs 里）
    state.fleet[uid]!.fitted.mid.length = 1
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(2) // 单点照样算得出 2
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    expect(state.fleet[uid]!.fitted.mid.length).toBe(2) // 装配动作把它补回来了
  })

  it('扩槽插件不占 CPU、也不改 CPU 预算（它是 slot 字段，不是 cpuBonus）', () => {
    const { state, ctx, uid } = world()
    const before = cpuBudgetOf(state, ctx, uid)
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(before)
  })

  it('卸装不受影响：扩槽后第 2 格的件照常卸下，槽位不回缩（插件不可拆）', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'plug-mid-bay')
    expect(installPlug(state, ctx, 'plug-mid-bay', uid).ok).toBe(true)
    addModule(state, 'mid-thing')
    expect(fitModule(state, 'mid-thing', ctx, { shipId: uid }).ok).toBe(true)
    const idx = state.fleet[uid]!.fitted.mid.indexOf('mid-thing')
    expect(unfitAt(state, 'mid', idx, uid, ctx)).toBe(true)
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(2) // 槽位不缩
  })
})
