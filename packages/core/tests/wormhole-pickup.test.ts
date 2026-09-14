/**
 * **虫洞 · 入洞 / 拾取 / 背包（E 批 · 2026-09-13；F5 收口 2026-09-13）**。
 *
 * 锁住四组口径：
 * ① **入洞**：编队校验复用 B 批 `wormholeAdmission`（旗舰被拒 / 超重被拒 / 空编队被拒），
 *    成功则写进存档的 `wormhole.run`，**已在洞里不许再进**；
 * ② **拾取的存废**（船长 2026-09-13 裁定 A）：**网格层没有"逐堆拾取"** —— 残骸走「打捞」、母矿走「采集」，
 *    装备门槛（打捞器 / 采集器）与回合口径（⌈堆数 ÷ 台数⌉）只有一份实现，不给第二条能绕开判据的路；
 *    逐堆拾取**只服务老档线性层**（`run.pendingNode.piles`：那代存档的回合已算进节点 `cost`）；
 * ③ **背包容量**：装舱判据与打捞同源（合并 → 对齐货仓格 → 放不下**整条回滚**，不静默丢弃）；
 * ④ **随档**：`piles` 与背包一起过存档往返（捡走的堆不会复活）。
 *
 * ✅ 2026-09-14 船长解除不可见（入口常驻、数据全部上线、公开就叫「虫洞」）；
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
  WORMHOLE_TEMP_CELLS,
  wormholeBagSlots,
  wormholeBagSlotsOfFleet,
  wormholeBagUsage,
  wormholeDebugReset,
  wormholeEnter,
  wormholeFleetCargoM3,
  wormholeLayerRewardMul,
  wormholeMakeNode,
  wormholeNodePiles,
} from '../src/wormhole'
import { wormholeHoldSyncCargo, wormholeHoldUsage, wormholeTakePileAt, wormholeTempDiscardPiece, wormholeTempUsage } from '../src/wormholeSalvage'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/**
 * **把这一层退回老档线性口径**：抹掉网格、给一个带堆的 `pendingNode`
 * （与 `wormhole-run.test.ts` 里"老档线性节点仍能走完"同款造法）。
 * F5 起"逐堆拾取"只在这条兼容路径上存在，故拾取/容量用例都跑在这里。
 */
function enterLegacy(state: GameState, seed: number, piles: { itemId: string; units: number }[]): void {
  const run = state.wormhole.run!
  run.grid = undefined
  run.pendingNode = { ...wormholeMakeNode(seed, 1, 0), piles: piles.map((p) => ({ ...p })) }
}

/** 老档节点上还剩几堆 */
function nodePiles(state: GameState): { itemId: string; units: number }[] {
  return state.wormhole.run!.pendingNode?.piles ?? []
}

/** 当前格上的堆（网格层用例用；读不到 ⇒ 空数组） */
function cellPiles(state: GameState): { itemId: string; units: number }[] {
  const g = state.wormhole.run!.grid!
  return g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)?.piles ?? []
}

/** **在当前格上挂若干堆**（网格层用例：验"网格层不许逐堆拾取"） */
function putPiles(state: GameState, piles: { itemId: string; units: number }[]): void {
  const g = state.wormhole.run!.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.piles = piles.map((p) => ({ ...p }))
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
    // 合法：2×T3（7,000 质量 ⇒ 回合 60×(1−0.4375×0.53) = 46）
    const r = wormholeEnter(state, ctx, [a, b], 20260913)
    expect(r.ok).toBe(true)
    expect(state.wormhole.run).not.toBeNull()
    expect(state.wormhole.run!.fleet).toEqual([a, b])
    expect(state.wormhole.run!.totalMass).toBe(7_000)
    expect(state.wormhole.run!.turnsTotal).toBe(46)
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

describe('虫洞 · 拾取堆（E 批；F5 收口：网格层退场、只留老档线性层）', () => {
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

  it('**网格层没有逐堆拾取**（船长 F5 裁定 A）：格上有堆也拒绝、不扣回合、堆不动', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 7)
    const run = state.wormhole.run!
    putPiles(state, wormholeNodePiles(7, 1, 1, 3))
    const turnsBefore = run.turnsLeft
    const r = wormholeTakePileAt(state, ctx, 0)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('打捞')
    expect(r.error ?? '').toContain('采集')
    expect(run.turnsLeft).toBe(turnsBefore) // 被拒 ⇒ 不扣回合
    expect(cellPiles(state).length).toBe(3) // 堆留在格上
    expect(run.bag).toEqual([])
  })

  it('**老档线性层**：逐堆拾取照旧可用，捡一堆少一堆，捡空后没有可捡的', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 7)
    const run = state.wormhole.run!
    // 堆的生成器照旧用 `wormholeNodePiles`（原矿堆；F3b 由矿脉采集调用它，残骸堆另有生成器）
    const piles = wormholeNodePiles(7, 1, 1, 3)
    expect(piles.length).toBe(3)
    enterLegacy(state, 7, piles)
    const first = piles[0]!
    const r1 = wormholeTakePileAt(state, ctx, 0)
    expect(r1.ok).toBe(true)
    expect(r1.taken!.itemId).toBe(WORMHOLE_ORE_ITEM_ID)
    expect(nodePiles(state).length).toBe(2)
    expect(run.bag).toEqual([{ itemId: first.itemId, units: first.units }])
    expect(run.turnsLeft).toBe(run.turnsTotal) // 老档：回合已算进节点 cost ⇒ 拾取不再扣
    // 捡空
    while (nodePiles(state).length > 0) {
      expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true)
    }
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(false)
    expect(wormholeTakePileAt(state, ctx, 0).error).toContain('没有可拾取')
  })

  it('装舱判据与打捞同源：同物品并格；**两板都放不下才整条回滚**（不静默丢弃）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3) // 货仓 2,600 m³ ⇒ 5 格
    wormholeEnter(state, ctx, [a], 9)
    const run = state.wormhole.run!
    const cap = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
    expect(cap).toBe(5)
    /**
     * ⚠ **2026-09-14 新口径**：收货阶梯是「货仓 → 临时空间（4×8 = 32 格）→ 才失败」，
     * 所以"整条回滚"要**两块板都放不下**才成立。这里先造"货仓刚好装满 5 格"再看：
     * 多并 1 单位 ⇒ 6 件 ⇒ 货仓没位、**临时空间有位** ⇒ 这一件落进临时空间（成功，不是拒收）。
     */
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: cap * 500 }]
    enterLegacy(state, 9, [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 1 }])
    const spilled = wormholeTakePileAt(state, ctx, 0)
    expect(spilled.ok, spilled.error ?? '').toBe(true)
    expect(wormholeTempUsage(state, ctx).cells).toBe(1) // 多出来的一件进了临时空间
    expect(nodePiles(state).length).toBe(0)
    // 把两块板都填满 ⇒ 再拾取会被**动作闸**拦下（船长 2026-09-14：「临时空间内有物品就不允许进行
    // 其他操作，和之前的超载类似」）——此时连"整条回滚"都轮不到：门都进不去
    run.bag = [
      { itemId: WORMHOLE_ORE_ITEM_ID, units: cap * 500 },
      { itemId: 'ore-veldspar', units: WORMHOLE_TEMP_CELLS * 500 },
    ]
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    expect(wormholeTempUsage(state, ctx).cells).toBe(WORMHOLE_TEMP_CELLS)
    const bagBefore = JSON.stringify(run.bag)
    enterLegacy(state, 9, [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 1 }])
    const bad = wormholeTakePileAt(state, ctx, 0)
    expect(bad.ok).toBe(false)
    expect(bad.error ?? '').toContain('临时空间')
    expect(nodePiles(state).length).toBe(1) // 堆还在：没被吞掉
    expect(JSON.stringify(run.bag)).toBe(bagBefore) // 货也没被改动
    // 清空临时空间（丢一件散货）+ 货仓腾 1 格 ⇒ 同一堆就能拿
    // 清空临时空间（背包改成"只剩 4 格母矿"）+ 货仓腾 1 格 ⇒ 同一堆就能拿
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: (cap - 1) * 500 }]
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeTempUsage(state, ctx).cells).toBe(0) // 临时空间已空 ⇒ 闸放行
    const ok = wormholeTakePileAt(state, ctx, 0)
    expect(ok.ok, ok.error ?? '').toBe(true)
    expect(ok.used).toBe(cap)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0) // 5 件全在货仓里
    expect(wormholeTempUsage(state, ctx).cells).toBe(0)
  })

  it('不在洞里 / 老档节点上没有堆 ⇒ 拾取被拒', () => {
    const state = fresh()
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(false)
    expect(wormholeTakePileAt(state, ctx, 0).error).toContain('不在虫洞内')
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 11)
    // 网格层：先被"逐堆拾取已退场"拦下（与"有没有堆"无关）
    expect(cellPiles(state).length).toBe(0)
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(false)
    // 老档节点：没有堆 ⇒ 报"没有可拾取的东西"
    enterLegacy(state, 11, [])
    const r = wormholeTakePileAt(state, ctx, 0)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有可拾取')
  })
})

describe('虫洞 · E 批随档', () => {
  it('待拾取的堆与背包一起过存档往返（捡走的不会复活）', () => {
    const state = fresh()
    const a = addShipToFleet(state, T3)
    wormholeEnter(state, ctx, [a], 13)
    enterLegacy(state, 13, wormholeNodePiles(13, 1, 1, 2))
    const taken = wormholeTakePileAt(state, ctx, 0).taken!
    const left = nodePiles(state).length
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.bag).toEqual([{ itemId: taken.itemId, units: taken.units }])
    expect(back.pendingNode!.piles!.length).toBe(left)
    expect(back.pendingNode!.piles!.length).toBe(1)
    expect(back.grid).toBeUndefined() // 老档：没有网格这件事本身也要过档
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
