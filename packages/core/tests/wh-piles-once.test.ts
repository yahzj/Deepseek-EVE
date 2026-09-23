/**
 * **虫洞 · 层内产出「只铺一次」**（**2026-09-23 玩家报障修复**）。
 *
 * 船长的报障原话（转述玩家）：「**虫洞内资源格重复进入会刷新资源。**」
 *
 * 病根（两条闸门都中招）：`wormholeEnsureVeinPiles` / `wormholeEnsureSalvagePiles` 的"只铺一次"
 * 判据曾经只是 `(cell.piles ?? []).length > 0`，而
 * ① **采空后 `piles` 是空数组**（`wormholeCollectOreAt` / `wormholeSalvageAt` 都原地 `shift()`）
 *    ⇒ 光"走出这一格再回来"就会重铺；
 * ② **读档清洗**（`save.ts:2792`）把空数组整条丢掉（写档侧照写 `piles: []`，两侧不对称）
 *    ⇒ 读档后连"这格铺过"的痕迹都没有，重进必重铺。
 * ⇒ 等于无限刷矿/刷残骸。
 *
 * 现行判据 = **该格已在 `grid.activated` 里就不铺**：两条收尾都在"采空那一刻"把格键写进
 * `activated`（`wormholeSalvage.ts` 的 `finished` 分支）且**随档** ⇒ 老档同样被堵住；
 * 而"激活"那条路对 vein/graveyard/ruins **本就拒绝**（`wormholeGridActivate`）
 * ⇒ 不存在"没铺过却已在 activated 里"的格。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeGridCell } from '../src/wormholeGrid'
import { gridCellAt } from '../src/wormholeGrid'
import {
  wormholeCollectOreAt,
  wormholeEnsureArrivalPiles,
  wormholeEnsureSalvagePiles,
  wormholeEnsureVeinPiles,
  wormholeSalvageAt,
} from '../src/wormholeSalvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
/** 巡洋舰（T3）；打捞器 / 采集器都走 high 槽（与 `wormhole-salvage.test.ts` 同款造法） */
const T3 = 'sh-thresher'
const RIG = 'mod-salvager-1'
const MINER = 'mod-miner-1'

/** 起一趟：`rigs` / `miners` = **每艘船**装几台；`ships` = 编队艘数（决定货仓格数） */
function enterRun(rigs: number, seed: number, miners = 0, ships = 1): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < Math.max(1, ships); i++) ids.push(addShipToFleet(state, T3))
  state.shipId = ids[0]!
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  for (const uid of ids) {
    const fitted = { ...(state.fleet[uid]!.fitted ?? {}) }
    const high: string[] = []
    for (let i = 0; i < rigs; i++) high.push(RIG)
    for (let i = 0; i < miners; i++) high.push(MINER)
    if (high.length > 0) fitted.high = high
    state.fleet[uid]!.fitted = fitted
  }
  return state
}

/** 把玩家挪到**指定地点**的格上（省掉扫描/走路的铺垫；清掉该格的堆与 activated，好让闸门放行） */
function standOn(state: GameState, place: WormholeGridCell['place']): WormholeGridCell {
  const grid = state.wormhole.run!.grid!
  const cell = gridCellAt(grid, grid.pos)!
  cell.place = place
  cell.piles = []
  grid.activated = grid.activated.filter((k) => k !== cell.key)
  return cell
}

/** 从存档文本里取该格的原始行（用来钉"空数组真的被清洗掉了"这个根因） */
function cellRowInSave(state: GameState, key: string): { piles?: unknown } {
  const file = JSON.parse(serializeSaveFile(state, 1)) as {
    state: { wormhole: { run: { grid: { cells: { key: string; piles?: unknown }[] } } } }
  }
  return file.state.wormhole.run.grid.cells.find((c) => c.key === key)!
}

describe('虫洞 · 层内产出「只铺一次」（2026-09-23 玩家报障：资源格重复进入会刷新资源）', () => {
  it('矿脉：采空后重进不再重铺，读档后同样不铺（旧写法里空数组被清洗丢掉 ⇒ 会复活）', () => {
    const state = enterRun(0, 9, 2) // 2 台采集器
    const run = state.wormhole.run!
    const cell = standOn(state, 'vein')
    wormholeEnsureVeinPiles(state, cell)
    const total = (cell.piles ?? []).length
    expect(total).toBeGreaterThanOrEqual(1)
    expect(total).toBeLessThanOrEqual(3)
    // 采空（一台一堆起 ⇒ 两趟内必空，留三次余量给"效率额外堆"）
    for (let guard = 0; guard <= 4 && (cell.piles ?? []).length > 0; guard++) {
      const r = wormholeCollectOreAt(state, ctx)
      expect(r.ok, r.error ?? '').toBe(true)
    }
    expect((cell.piles ?? []).length).toBe(0)
    expect(run.grid!.activated, '采空那一刻入册 activated').toContain(cell.key)
    // ① 原地"再到达一次"（重进同一格走的就是这条）：不该重铺
    wormholeEnsureArrivalPiles(state, ctx)
    expect((cell.piles ?? []).length, '采空后重进不该再铺').toBe(0)
    // ② 存档两侧的真实口径：**写档照写空数组、读档把该字段整条丢掉**（不对称 ⇒ 旧闸门读档后必失效）
    expect(cellRowInSave(state, cell.key).piles, '写档侧：空数组原样写着').toEqual([])
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const backCell = back.wormhole.run!.grid!.cells.find((c) => c.key === cell.key)!
    expect(backCell.piles, '读档侧：空数组被清洗掉（`save.ts:2792`）').toBeUndefined()
    wormholeEnsureVeinPiles(back, backCell)
    wormholeEnsureArrivalPiles(back, ctx)
    expect((backCell.piles ?? []).length, '读档后重进也不该再铺').toBe(0)
  })

  it('墓场：捞空后重进不再重铺（遗迹共用同一个 ensure，见 `wormholeEnsureSalvagePiles`）', () => {
    const state = enterRun(2, 21, 0, 2) // 每艘 2 台打捞器 / 2 艘（货仓 10 格，够装下墓场那 3~10 堆）
    const cell = standOn(state, 'graveyard')
    wormholeEnsureSalvagePiles(state, cell)
    expect((cell.piles ?? []).length).toBeGreaterThanOrEqual(3)
    for (let guard = 0; guard <= 8 && (cell.piles ?? []).length > 0; guard++) {
      const r = wormholeSalvageAt(state, ctx)
      if (!r.ok) break // 货仓满等拒收：本用例只验"铺一次"，取到多少算多少
    }
    if ((cell.piles ?? []).length > 0) return // 没捞空 ⇒ 本用例不适用（另有堆量用例锁 3~10 堆）
    expect(state.wormhole.run!.grid!.activated).toContain(cell.key)
    wormholeEnsureSalvagePiles(state, cell)
    wormholeEnsureArrivalPiles(state, ctx)
    expect((cell.piles ?? []).length, '捞空后重进不该再铺').toBe(0)
    // 读档往返后同样不铺
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const backCell = back.wormhole.run!.grid!.cells.find((c) => c.key === cell.key)!
    wormholeEnsureSalvagePiles(back, backCell)
    expect((backCell.piles ?? []).length).toBe(0)
  })

  it('只取走一部分：不补满、数量只减不增（老闸门那条仍然生效）', () => {
    const state = enterRun(0, 33, 1)
    const cell = standOn(state, 'vein')
    wormholeEnsureVeinPiles(state, cell)
    const total = (cell.piles ?? []).length
    expect(total).toBeGreaterThanOrEqual(1)
    if (total === 1) return // 只有一堆 ⇒ 没有"取一部分"这一档
    const first = wormholeCollectOreAt(state, ctx)
    expect(first.ok).toBe(true)
    const left = (cell.piles ?? []).length
    expect(left).toBeLessThan(total)
    expect(left).toBeGreaterThan(0)
    // 再"到达"两次：剩下的堆原样，不补、不重排
    wormholeEnsureVeinPiles(state, cell)
    wormholeEnsureArrivalPiles(state, ctx)
    expect((cell.piles ?? []).length).toBe(left)
  })
})
