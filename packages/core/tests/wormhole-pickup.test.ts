/**
 * **虫洞 · 入洞 / 拾取 / 背包（E 批 · 2026-09-13）**。
 *
 * 锁住四组口径：
 * ① **入洞**：编队校验复用 B 批 `wormholeAdmission`（旗舰被拒 / 超重被拒 / 空编队被拒），
 *    成功则写进存档的 `wormhole.run`，**已在洞里不许再进**；
 * ② **拾取堆**：堆挂在**所在的格**上（确定性生成；虚空母矿为原矿堆，残骸堆由 F3b 打捞生成），捡一堆就少一堆；
 * ③ **背包容量**：超格**拒绝入包**（不静默丢弃）——同物品**并格**、每格 500 m³ 上限；
 * ④ **随档**：`piles` 与背包一起过存档往返（捡走的堆不会复活）。
 *
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），拍板权在船长；
 * 本文件不产生任何玩家可见文案。拾取堆的**数量绝对值待 F 批收益校准**（本文件只锁机制与方向）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_ORE_ITEM_ID,
  WORMHOLE_PILE_UNITS_BASE,
  wormholeBagSlots,
  wormholeBagSlotsOfFleet,
  wormholeBagUsage,
  wormholeDebugReset,
  wormholeEnter,
  wormholeFleetCargoM3,
  wormholeLayerRewardMul,
  wormholeNodePiles,
  wormholeTakePile,
} from '../src/wormhole'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/**
 * **在当前格上挂若干堆**（F3a-2 起：堆的宿主是**玩家所在的格**，不再是线性节点）。
 * F3b 起由"打捞/挖掘"往格上生成；本文件只验拾取与容量机制，故直接铺。
 */
function putPiles(state: GameState, piles: { itemId: string; units: number }[]): void {
  const g = state.wormhole.run!.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.piles = piles.map((p) => ({ ...p }))
}

/** 当前格上的堆（读不到 ⇒ 空数组） */
function cellPiles(state: GameState): { itemId: string; units: number }[] {
  const g = state.wormhole.run!.grid!
  return g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)?.piles ?? []
}

describe('虫洞 · 入洞（E 批）', () => {
  it('合法编队 ⇒ 写进存档的 run；旗舰 / 超重 / 空编队一律被拒且不写档', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    const b = addShipToFleet(state, T3)
    expect(state.wormhole.run).toBeNull()
    // 空编队
    expect(wormholeEnter(state, ctx, [], 1).ok).toBe(false)
    expect(state.wormhole.run).toBeNull()
    // 旗舰（T5）压塌入口
    const flag = addShipToFleet(state, 'sh-colossal')
    expect(wormholeEnter(state, ctx, [flag], 1).ok).toBe(false)
    expect(state.wormhole.run).toBeNull()
    // 合法：2×T3（7,000 质量 ⇒ 回合 55×(1−0.4375×0.53) = 42）
    const r = wormholeEnter(state, ctx, [a, b], 20260913)
    expect(r.ok).toBe(true)
    expect(state.wormhole.run).not.toBeNull()
    expect(state.wormhole.run!.fleet).toEqual([a, b])
    expect(state.wormhole.run!.totalMass).toBe(7_000)
    expect(state.wormhole.run!.turnsTotal).toBe(42)
    // 已在洞里：不许再进（先撤离/结算）
    expect(wormholeEnter(state, ctx, [a], 1).ok).toBe(false)
  })

  it('背包格现算：编队合计货仓 ÷ 500，且与「货仓页同源」的容量口径一致', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    const cargo = wormholeFleetCargoM3(state, ctx, [a])
    expect(cargo).toBeGreaterThan(0)
    expect(wormholeBagSlotsOfFleet(state, ctx, [a])).toBe(wormholeBagSlots(cargo))
    // 两艘 ⇒ 货仓与格数都翻倍（同型船，容量同源）
    const b = addShipToFleet(state, T3)
    expect(wormholeFleetCargoM3(state, ctx, [a, b])).toBeCloseTo(cargo * 2, 5)
    expect(wormholeBagSlotsOfFleet(state, ctx, [a, b])).toBe(wormholeBagSlots(cargo * 2))
  })
})

describe('虫洞 · 拾取堆（E 批）', () => {
  it('原矿堆是确定性的、只出虚空母矿、数量随层收益系数上升', () => {
    const p1 = wormholeNodePiles(777, 1, 1, 2)
    const p2 = wormholeNodePiles(777, 1, 1, 2)
    expect(p2).toEqual(p1) // 同种子同位置 ⇒ 逐字一致
    expect(p1.length).toBe(2)
    for (const pile of p1) {
      expect(pile.itemId).toBe(WORMHOLE_ORE_ITEM_ID) // 原矿堆只出虚空母矿（残骸堆另走打捞，见设计稿 §11.5）
      expect(pile.units).toBeGreaterThan(0)
    }
    // 数量随层收益系数抬升（同种子下把层换成更深的一层 ⇒ 期望量级变大）
    const shallow = wormholeNodePiles(31, 1, 1, 1)[0]!.units
    const deep = wormholeNodePiles(31, 6, 1, 1)[0]!.units
    expect(wormholeLayerRewardMul(6)).toBeGreaterThan(wormholeLayerRewardMul(1))
    expect(deep).toBeGreaterThan(shallow)
    // 基准量级（⚠ 绝对值待 F 批校准，这里只锁"非零且同量级"）
    expect(shallow).toBeGreaterThan(Math.floor(WORMHOLE_PILE_UNITS_BASE * 0.5))
  })

  it('格上的堆：捡一堆少一堆，捡空后没有可捡的', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 7)
    const run = state.wormhole.run!
    // 堆的生成器照旧用 `wormholeNodePiles`（原矿堆；F3b 由矿脉挖掘调用它，残骸堆另有生成器）
    const piles = wormholeNodePiles(7, 1, 1, 3)
    expect(piles.length).toBe(3)
    putPiles(state, piles)
    const first = piles[0]!
    const r1 = wormholeTakePile(state, ctx, 0)
    expect(r1.ok).toBe(true)
    expect(r1.taken!.itemId).toBe(WORMHOLE_ORE_ITEM_ID)
    expect(cellPiles(state).length).toBe(2)
    expect(run.bag).toEqual([{ itemId: first.itemId, units: first.units }])
    // 捡空
    while (cellPiles(state).length > 0) {
      expect(wormholeTakePile(state, ctx, 0).ok).toBe(true)
    }
    expect(wormholeTakePile(state, ctx, 0).ok).toBe(false)
    expect(wormholeTakePile(state, ctx, 0).error).toContain('没有可拾取')
  })

  it('同物品并格；**超格拒绝入包**（不静默丢弃）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3) // 货仓 2,600 m³ ⇒ 5 格
    wormholeEnter(state, ctx, [a], 9)
    const run = state.wormhole.run!
    const cap = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
    expect(cap).toBe(5)
    // 造一个刚好装满的背包（每格 500 单位）
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: cap * 500 }]
    putPiles(state, [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 1 }])
    const bad = wormholeTakePile(state, ctx, 0)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('放不下')
    expect(cellPiles(state).length).toBe(1) // 堆还在：没被吞掉
    // 空出一格 ⇒ 同一堆就能拿
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: (cap - 1) * 500 }]
    const ok = wormholeTakePile(state, ctx, 0)
    expect(ok.ok).toBe(true)
    expect(ok.used).toBe(cap)
    expect(wormholeBagUsage(ctx, run.bag, cap).overflow).toBe(false)
  })

  it('不在洞里 / 当前格没有堆 ⇒ 拾取被拒', () => {
    const state = fresh()
    expect(wormholeTakePile(state, ctx, 0).ok).toBe(false)
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 11)
    expect(cellPiles(state).length).toBe(0) // 入口格上本来就没有堆
    expect(wormholeTakePile(state, ctx, 0).ok).toBe(false)
  })
})

describe('虫洞 · E 批随档', () => {
  it('待拾取的堆（挂在格上）与背包一起过存档往返（捡走的不会复活）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 13)
    const run = state.wormhole.run!
    putPiles(state, wormholeNodePiles(13, 1, 1, 2))
    const taken = wormholeTakePile(state, ctx, 0).taken!
    const left = cellPiles(state).length
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.bag).toEqual([{ itemId: taken.itemId, units: taken.units }])
    const backCell = back.grid!.cells.find((c) => c.key === `${back.grid!.pos.q},${back.grid!.pos.r}`)!
    expect(backCell.piles!.length).toBe(left)
    expect(backCell.piles!.length).toBe(1)
    expect(run.bag[0]!.units).toBe(taken.units)
  })

  it('调试放弃：清空 run（正式结算路径在 F 批）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 17)
    expect(state.wormhole.run).not.toBeNull()
    wormholeDebugReset(state)
    expect(state.wormhole.run).toBeNull()
  })
})
