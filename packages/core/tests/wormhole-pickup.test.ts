/**
 * **虫洞 · 入洞 / 拾取 / 背包（E 批 · 2026-09-13）**。
 *
 * 锁住四组口径：
 * ① **入洞**：编队校验复用 B 批 `wormholeAdmission`（旗舰被拒 / 超重被拒 / 空编队被拒），
 *    成功则写进存档的 `wormhole.run`，**已在洞里不许再进**；
 * ② **拾取堆**：拾取点节点自带 `piles`（确定性生成、虫洞内**只出原矿**），捡一堆就少一堆；
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
  wormholeMakeNode,
  wormholeNodePiles,
  wormholeTakePile,
} from '../src/wormhole'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
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
  it('堆是确定性的、只出原矿、数量随层收益系数上升', () => {
    const p1 = wormholeNodePiles(777, 1, 1, 2)
    const p2 = wormholeNodePiles(777, 1, 1, 2)
    expect(p2).toEqual(p1) // 同种子同位置 ⇒ 逐字一致
    expect(p1.length).toBe(2)
    for (const pile of p1) {
      expect(pile.itemId).toBe(WORMHOLE_ORE_ITEM_ID) // 虫洞内只出原矿（Q14）
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

  it('拾取点节点自带 piles；捡一堆少一堆，捡空后没有可捡的', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 7)
    const run = state.wormhole.run!
    // 找一个拾取点节点（每层首节点固定战斗，故从 index 1 起扫）
    let node = wormholeMakeNode(7, 1, 1)
    for (let i = 1; i <= 12 && node.kind !== 'pickup'; i++) node = wormholeMakeNode(7, 1, i)
    expect(node.kind).toBe('pickup')
    expect((node.piles ?? []).length).toBe(node.pickups)
    run.pendingNode = node
    const first = node.piles![0]!
    const r1 = wormholeTakePile(state, ctx, 0)
    expect(r1.ok).toBe(true)
    expect(r1.taken!.itemId).toBe(WORMHOLE_ORE_ITEM_ID)
    expect(run.pendingNode!.piles!.length).toBe(node.pickups - 1)
    expect(run.bag).toEqual([{ itemId: first.itemId, units: first.units }])
    // 捡空
    while ((run.pendingNode!.piles ?? []).length > 0) {
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
    run.pendingNode = {
      kind: 'pickup',
      waves: 0,
      pickups: 1,
      cost: 1,
      piles: [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 1 }],
    }
    const bad = wormholeTakePile(state, ctx, 0)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('放不下')
    expect(run.pendingNode.piles!.length).toBe(1) // 堆还在：没被吞掉
    // 空出一格 ⇒ 同一堆就能拿
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: (cap - 1) * 500 }]
    const ok = wormholeTakePile(state, ctx, 0)
    expect(ok.ok).toBe(true)
    expect(ok.used).toBe(cap)
    expect(wormholeBagUsage(ctx, run.bag, cap).overflow).toBe(false)
  })

  it('不在洞里 / 没有待处理节点 ⇒ 拾取被拒', () => {
    const state = fresh()
    expect(wormholeTakePile(state, ctx, 0).ok).toBe(false)
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 11)
    state.wormhole.run!.pendingNode = null // 层末抉择
    expect(wormholeTakePile(state, ctx, 0).ok).toBe(false)
  })
})

describe('虫洞 · E 批随档', () => {
  it('待拾取的堆与背包一起过存档往返（捡走的不会复活）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 13)
    const run = state.wormhole.run!
    let node = wormholeMakeNode(13, 1, 1)
    for (let i = 1; i <= 12 && node.kind !== 'pickup'; i++) node = wormholeMakeNode(13, 1, i)
    run.pendingNode = node
    const taken = wormholeTakePile(state, ctx, 0).taken!
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.bag).toEqual([{ itemId: taken.itemId, units: taken.units }])
    expect(back.pendingNode!.piles).toEqual(run.pendingNode!.piles)
    expect(back.pendingNode!.piles!.length).toBe(node.pickups - 1)
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
