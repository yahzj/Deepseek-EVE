/**
 * **舰船插件两条缺陷**（**2026-09-27 船长报障**）。
 *
 * 船长原话（照抄）：「玩家如果有插件的船在虫洞内丢失了要怎么回收插件？有部分船插会在装备栏显示」
 *
 * 两条裁决（同日）：
 * ① **洞内沉船 ⇒ 当场折成黑匣入库**（与 `plugs` 那条「玩家回收按插件数量直接回收成黑匣」同一口径：
 *    1 件插件 = 1 个黑匣、**无条件、不掷骰**；不造残骸、不加打捞点）；
 * ② **读档把误装在高/中/低槽里的插件搬回插件槽**（有空位就装上，**没空位退回装备库**，不销毁资产）。
 *
 * 病根（缺陷二）：13 件插件在数据里为过体检契约**声明了 `rack: 'low'`**，而 `rackOf()` 优先返回
 * `def.rack` ⇒ 插件被判成低槽 ⇒ 装配页低槽候选把它列出来、点下去真写进 `fitted.low`
 * （插件因此变成可卸下，破了「不可拆卸、不可替换」）。
 *
 * 本文件钉四件事：① 沉船折黑匣；② 装配入口拒收插件；③ 读档归正（含槽满退回）；
 * ④ 接线护栏（源码级）：虫洞那两处 `loseShip` **之前**都调了折黑匣。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare, countWare } from '../src/inventory'
import { fitModule, repairDeprecatedModules, swapModuleAt } from '../src/equipment'
import { installPlug, plugSlotsOf, plugsToBlackBoxesOf } from '../src/plugs'
import { PLUG_BLACKBOX_ITEM_ID } from '../src/blackbox'
import { salvagePlugsOnSink } from '../src/wormholeBattle'

const ctx = buildSimContext()
/** 有插件槽的船（`ShipDef.plugSlots` 由船型档给） */
const SHIP = 'sh-thresher'
/** 一件真插件（`slot: 'plug'`；数据里为过体检契约声明了 `rack: 'low'` —— 正是本缺陷的病根） */
const PLUG = 'plug-cpu-core'

function fresh(seed = 7): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

describe('舰船插件两条缺陷（2026-09-27 船长报障）', () => {
  it('① 洞内沉船 ⇒ 插件当场折成黑匣入库（1 件 = 1 个，无条件）', () => {
    const state = fresh()
    const uid = addShipToFleet(state, SHIP)
    state.fleet[uid]!.plugs = [PLUG, PLUG, PLUG]
    const before = countWare(state, PLUG_BLACKBOX_ITEM_ID)

    salvagePlugsOnSink(state, ctx, uid)
    expect(countWare(state, PLUG_BLACKBOX_ITEM_ID) - before, '3 件插件 ⇒ 3 个黑匣').toBe(3)
    expect(plugsToBlackBoxesOf([PLUG, PLUG, PLUG]), '与现成回收口径同一个单点').toBe(3)
    /** ⚠ **只发黑匣、不动舰队条目**：删条目归 `loseShip`（helper 的调用方），顺序在那里保证 */
    expect(state.fleet[uid], 'helper 自己不删船（`loseShip` 的事）').toBeDefined()
    // 没插件的船 ⇒ 一个黑匣都不发（零行为变化）
    const bare = addShipToFleet(state, SHIP)
    salvagePlugsOnSink(state, ctx, bare)
    expect(countWare(state, PLUG_BLACKBOX_ITEM_ID) - before, '无插件 ⇒ 不发').toBe(3)
  })

  it('② 装配入口**拒收插件**：高/中/低三槽都装不进，走 `installPlug` 才行', () => {
    const state = fresh()
    const uid = addShipToFleet(state, SHIP)
    state.shipId = uid
    addWare(state, PLUG, 1)
    state.moduleBay[PLUG] = 1

    // `swapModuleAt`（装配页候选卡的落点）：三槽逐一试 ⇒ 全被拒
    for (const rack of ['high', 'mid', 'low'] as const) {
      const r = swapModuleAt(state, PLUG, ctx, { rack, index: 0, shipId: uid })
      expect(r.ok, `${rack} 槽应当拒收插件`).toBe(false)
      expect(r.errorId, `${rack} 槽的拒绝原因 id`).toBe('core.equipment.030')
    }
    // `fitModule`（另一条装配入口）：不给 rack 时以前会按 `rackOf` 落进低槽 ⇒ 现在也拒
    const f = fitModule(state, PLUG, ctx, { shipId: uid })
    expect(f.ok, 'fitModule 同样拒收').toBe(false)
    expect(f.errorId).toBe('core.equipment.030')
    // 槽位一点没被写脏（⚠ 槽位数组会留 `null` 占位 ⇒ 只看"有没有真件"）
    expect((state.fleet[uid]!.fitted?.low ?? []).filter(Boolean), '低槽没有被塞进插件').toEqual([])
    // 正路仍通：`installPlug` 装得进
    expect(installPlug(state, ctx, PLUG, uid).ok, '插件槽那条路照常').toBe(true)
    expect(state.fleet[uid]!.plugs, '进的是插件那本账').toEqual([PLUG])
  })

  it('③ 读档归正：低槽里的插件 ⇒ 搬回插件槽；槽满/没插件槽 ⇒ 退回装备库', () => {
    // 甲：有空位 ⇒ 搬进插件槽
    const a = fresh(11)
    const ua = addShipToFleet(a, SHIP)
    a.fleet[ua]!.fitted = { high: [], mid: [], low: [PLUG] }
    repairDeprecatedModules(a, ctx)
    expect((a.fleet[ua]!.fitted?.low ?? []).filter(Boolean), '低槽已清空').toEqual([])
    expect(a.fleet[ua]!.plugs, '搬进了插件槽').toEqual([PLUG])
    expect(a.logs.some((l) => l.text.includes('舰船插件归正')), '写了归正日志').toBe(true)

    // 乙：插件槽已满 ⇒ 退回装备库（不销毁资产）
    const b = fresh(12)
    const ub = addShipToFleet(b, SHIP)
    const cap = Math.max(1, plugSlotsOf(b, ctx, ub))
    b.fleet[ub]!.plugs = Array.from({ length: cap }, () => PLUG)
    b.fleet[ub]!.fitted = { high: [], mid: [], low: [PLUG] }
    const bayBefore = b.moduleBay[PLUG] ?? 0
    repairDeprecatedModules(b, ctx)
    expect((b.fleet[ub]!.fitted?.low ?? []).filter(Boolean), '低槽同样清空').toEqual([])
    expect(b.fleet[ub]!.plugs?.length, '插件槽没被撑破').toBe(cap)
    expect(b.moduleBay[PLUG] ?? 0, '多出来的那件退回装备库').toBe(bayBefore + 1)
  })

  it('④ 接线护栏：虫洞那两处 `loseShip` **之前**都调了折黑匣', () => {
    // ⚠ vitest 的工作目录通常是包目录（`packages/core`）⇒ 两种根都试一下
    const rootA = join(process.cwd(), 'src/wormholeBattle.ts')
    const rootB = join(process.cwd(), 'packages/core/src/wormholeBattle.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : rootB, 'utf8')
    /** 两处调用点：被击沉 / 失联 */
    expect(src.includes('salvagePlugsOnSink(state, ctx, uid)'), '应当调用折黑匣单点').toBe(true)
    /** ⚠ 顺序：折黑匣必须**排在 `loseShip` 之前**（`loseShip` 会删掉 fleet 条目） */
    const sinks = [...src.matchAll(/salvagePlugsOnSink\(state, ctx, uid\)\s*\n\s*loseShip\(/g)]
    expect(sinks.length, '两处沉船点都必须是「先折黑匣、再 loseShip」').toBe(2)
    // 反向：不许出现"先 loseShip 再折"（那样插件已经抓不到了）
    expect(/loseShip\([^)]*\)\s*\n\s*salvagePlugsOnSink\(/.test(src), '不该有顺序反了的地方').toBe(false)
  })
})
