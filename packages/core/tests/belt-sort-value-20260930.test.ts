/**
 * **矿带排序口径重定：每小时产出 × 当前行情价**（**2026-09-30 船长令**）。
 *
 * 船长原话（照抄）：「**矿带开采的排序，原矿价值最高的排序已经落后。**」
 *
 * 本用例钉四件事：
 * ① **逐项每小时产出**（`beltYieldRows`）与 `getMiningParams` 同源、复合带按权重分摊且各行相加 = 总产出；
 * ② **产值**（`beltValuePerHour`）= `Σ(逐项每小时产出 × priceOf)`，取整；
 * ③ **无行情退回基准价**（`priceOf` 返回 `null` 的项用 `baseSellPriceIsk`），无采矿参数 ⇒ `null`；
 * ④ **船长报障的那个症状本身**：旧口径（基准价）下「极光云场」排在「蓝霜冰环」前面，
 *    换行情价口径后**顺序反过来**（读数取自测试档 `test-save-faction-20260926-121938.json`：
 *    极光云 基准 144 / 行情 258，蓝霜冰 基准 32 / 行情 168）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { beltValuePerHour, beltYieldRows, getMiningParams } from '../src/mining'
import type { BeltDef } from '../src/types'
import type { GameState } from '../src/state'

const ctx = buildSimContext()

/** 一艘沙猫、无技能、无矿枪的干净档（与 `ore-volume-mining.test.ts` 同款） */
function bareState(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(s, 'sandcat')
  s.shipId = uid
  return s
}

const beltOf = (id: string): BeltDef => ctx.belts.get(id)!
/** 基准价口径的产值（旧排序口径，只在本用例里当对照用） */
function baseValueOf(s: GameState, belt: BeltDef): number {
  const rows = beltYieldRows(s, ctx, belt)!
  return Math.round(
    rows.reduce((sum, r) => sum + r.perHour * (ctx.items.get(r.itemId)?.baseSellPriceIsk ?? 0), 0),
  )
}

describe('矿带每小时产出与行情产值（2026-09-30 船长令：原矿价值最高的排序已经落后）', () => {
  it('① 单产物带：一行 = 每小时总产出，与 getMiningParams 同源', () => {
    const s = bareState()
    const belt = beltOf('belt-ice-frost')
    const mp = getMiningParams(s, ctx, { beltId: belt.id })!
    const rows = beltYieldRows(s, ctx, belt)!
    expect(rows).toHaveLength(1)
    expect(rows[0].itemId).toBe(belt.oreId)
    expect(rows[0].perHour).toBeCloseTo((mp.unitsPerCycle * 3_600_000) / mp.cycleMs, 6)
  })

  it('② 复合带：按权重分摊，各行相加 = 每小时总产出', () => {
    const s = bareState()
    const belt = beltOf('belt-kernite')
    const outs = belt.outputs!
    expect(outs.length).toBeGreaterThan(1) // 三产物新手混合带
    const mp = getMiningParams(s, ctx, { beltId: belt.id })!
    const total = (mp.unitsPerCycle * 3_600_000) / mp.cycleMs
    const rows = beltYieldRows(s, ctx, belt)!
    expect(rows.map((r) => r.itemId)).toEqual(outs.map((o) => o.itemId))
    expect(rows.reduce((sum, r) => sum + r.perHour, 0)).toBeCloseTo(total, 6)
    const wsum = outs.reduce((sum, o) => sum + o.weight, 0)
    for (const o of outs) {
      const row = rows.find((r) => r.itemId === o.itemId)!
      expect(row.perHour, `${o.itemId} 的分摊`).toBeCloseTo((total * o.weight) / wsum, 6)
    }
  })

  it('③ 产值 = Σ(每小时产出 × 传入价) 取整；无采矿参数（无驾驶船）⇒ null', () => {
    const s = bareState()
    const belt = beltOf('belt-kernite')
    const rows = beltYieldRows(s, ctx, belt)!
    // 传入价故意用非基准价，确认产值确实走 priceOf 而不是基准价
    const priceOf = (id: string): number => (id === rows[0].itemId ? 1_000 : 7)
    const want = Math.round(rows.reduce((sum, r) => sum + r.perHour * priceOf(r.itemId), 0))
    expect(beltValuePerHour(s, ctx, belt, priceOf)).toBe(want)
    expect(want).not.toBe(baseValueOf(s, belt))

    const empty = createInitialState({ nowWallMs: 0, seed: 1 })
    empty.shipId = 'no-such-ship' // 驾驶船不在舰队里 ⇒ 无采矿参数
    expect(beltYieldRows(empty, ctx, belt)).toBeNull()
    expect(beltValuePerHour(empty, ctx, belt, priceOf)).toBeNull()
  })

  it('④ 无行情（priceOf = null）的项退回基准价，不因缺行情沉底', () => {
    const s = bareState()
    const belt = beltOf('belt-kernite')
    // 全部取不到行情 ⇒ 产值与基准价口径逐值相同
    expect(beltValuePerHour(s, ctx, belt, () => null)).toBe(baseValueOf(s, belt))
    // 只有第一项有行情 ⇒ 只那一项换价
    const rows = beltYieldRows(s, ctx, belt)!
    const first = rows[0]
    const want = Math.round(
      first.perHour * 999 +
        rows
          .slice(1)
          .reduce((sum, r) => sum + r.perHour * (ctx.items.get(r.itemId)?.baseSellPriceIsk ?? 0), 0),
    )
    expect(beltValuePerHour(s, ctx, belt, (id) => (id === first.itemId ? 999 : null))).toBe(want)
  })

  it('⑤ 船长报障的症状锁：基准价口径下极光云场在前，行情价口径下蓝霜冰环在前', () => {
    /**
     * 用陆龟级（每循环 24 m³）：气矿 `unitM3 = 8` ⇒ 3 单位/循环，冰矿 `unitM3 = 2` ⇒ 12 单位/循环
     * （恰好 4×，不带 T1 沙猫那种 floor 取整带来的偏差；读数与测试档里 977/h : 3,910/h 同比例）。
     */
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    s.shipId = addShipToFleet(s, 'sh-tortoise')
    const aurora = beltOf('belt-gas-aurora') // 极光云：基准 144（最高档）、行情 258
    const frost = beltOf('belt-ice-frost') // 蓝霜冰：基准 32、行情 168（×5.25）
    // 旧口径（基准价）：极光云场更值钱 —— 这正是"排序落后"时的第 1 名
    expect(baseValueOf(s, aurora)).toBeGreaterThan(baseValueOf(s, frost))
    // 新口径（行情价）：顺序反过来（蓝霜冰产量高 4 倍，行情价又翻到基准价的 5 倍多）
    const live = { 'gas-aurora': 258, 'ice-frost': 168 } as Record<string, number>
    const priceOf = (id: string): number | null => live[id] ?? null
    expect(beltValuePerHour(s, ctx, frost, priceOf)!).toBeGreaterThan(beltValuePerHour(s, ctx, aurora, priceOf)!)
  })
})
