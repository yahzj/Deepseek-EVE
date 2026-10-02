/**
 * **洞内「禁止打捞普通残骸」**（**2026-10-02 船长令**）。
 *
 * 船长原话（照抄）：「**只做甲，坐在货仓背包处。**」＋ 文案三条「**禁止打捞普通残骸**」
 * 「**当前禁止打捞普通残骸**」「**本次打捞跳过 N 堆普通残骸**」。
 *
 * 口径（开关 = `WormholeState.noCommonWreckSalvage`，随档；缺省关 ⇒ 老档零迁移）：
 * - 打开 ⇒ 一次打捞**只收稀有残骸**，普通残骸**留在原地**（不删、不入货仓、不占格）；动作仍扣 1 回合；
 * - 本格**只剩普通残骸** ⇒ **拒绝动作且不扣回合**（`core.wormholeSalvage.044`）；
 * - 关着 ⇒ **逐字老行为**（既有用例是回归锁，本文件再补一组对照）；
 * - 开关**随档往返**（写档/读档后仍在；关掉 = 字段不落档）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { noCommonWreckSalvageOn, setNoCommonWreckSalvage, wormholeEnter } from '../src/wormhole'
import type { WormholeGridCell } from '../src/wormholeGrid'
import { gridCellAt } from '../src/wormholeGrid'
import { wormholeEnsureSalvagePiles, wormholeSalvageAt } from '../src/wormholeSalvage'
import { isRareWreck } from '../src/salvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
/** 巡洋舰（T3）；打捞器走高槽（与 `wh-piles-once.test.ts` / `wormhole-salvage.test.ts` 同款造法） */
const T3 = 'sh-thresher'
const RIG = 'mod-salvager-1'

/** 起一趟：`rigs` = **每艘船**装几台打捞器 */
function enterRun(rigs: number, seed: number, ships = 1): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < Math.max(1, ships); i++) ids.push(addShipToFleet(state, T3))
  state.shipId = ids[0]!
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  for (const uid of ids) {
    const fitted = { ...(state.fleet[uid]!.fitted ?? {}) }
    fitted.high = Array.from({ length: rigs }, () => RIG)
    state.fleet[uid]!.fitted = fitted
  }
  return state
}

/** 把玩家挪到**指定地点**的格上（清掉该格的堆与 activated，好让闸门放行） */
function standOn(state: GameState, place: WormholeGridCell['place']): WormholeGridCell {
  const grid = state.wormhole.run!.grid!
  const cell = gridCellAt(grid, grid.pos)!
  cell.place = place
  cell.piles = []
  grid.activated = grid.activated.filter((k) => k !== cell.key)
  return cell
}

/** 铺一格"**既有稀有又有普通**"的墓场（铺法确定 ⇒ 逐 seed 试到满足为止） */
function worldWithBoth(): { state: GameState; cell: WormholeGridCell } {
  for (let seed = 1; seed < 80; seed++) {
    const state = enterRun(1, seed)
    const cell = standOn(state, 'graveyard')
    wormholeEnsureSalvagePiles(state, cell)
    const piles = cell.piles ?? []
    if (piles.some((p) => isRareWreck(p.itemId)) && piles.some((p) => !isRareWreck(p.itemId))) {
      return { state, cell }
    }
  }
  throw new Error('80 个 seed 里没找到"稀有＋普通"的墓场铺法')
}

/** ⚠ 只用于**刚铺好**的墓场（那时只有普通/稀有残骸两种堆；货柜是打捞过程中才散落的） */
const commonCount = (cell: WormholeGridCell): number => (cell.piles ?? []).filter((p) => !isRareWreck(p.itemId)).length
const rareCount = (cell: WormholeGridCell): number => (cell.piles ?? []).filter((p) => isRareWreck(p.itemId)).length

describe('洞内「禁止打捞普通残骸」（开关在货仓页）', () => {
  it('打开后打捞只收稀有残骸、普通残骸留在原地，并写「跳过 N 堆」日志', () => {
    const { state, cell } = worldWithBoth()
    expect(setNoCommonWreckSalvage(state, true).ok).toBe(true)
    expect(noCommonWreckSalvageOn(state)).toBe(true)
    const commonBefore = commonCount(cell)
    const rareBefore = rareCount(cell)
    const turnsBefore = state.wormhole.run!.turnsLeft
    console.log(`  [读数] 本格铺法：稀有 ${rareBefore} 堆 · 普通 ${commonBefore} 堆`)
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok, r.error ?? '').toBe(true)
    expect((r.taken ?? []).length, '这一动作确实收到了东西').toBeGreaterThan(0)
    expect(
      (r.taken ?? []).every((p) => isRareWreck(p.itemId)),
      '只收稀有残骸',
    ).toBe(true)
    expect(rareCount(cell), '稀有被拿走').toBeLessThan(rareBefore)
    expect(commonCount(cell), '普通残骸留在原地').toBe(commonBefore)
    expect(state.wormhole.run!.turnsLeft, '动作照旧扣 1 回合').toBe(turnsBefore - 1)
    const log = state.logs.filter((l) => l.textId === 'core.wormholeSalvage.045').at(-1)
    expect(log, '应写「本次打捞跳过 N 堆普通残骸」').toBeDefined()
    expect(log!.textParams?.p1, 'N = 本格此刻还剩多少堆普通残骸').toBe(commonBefore)
  })

  it('本格只剩普通残骸 ⇒ 拒绝动作且**不扣回合**（`core.wormholeSalvage.044`）', () => {
    const { state, cell } = worldWithBoth()
    expect(setNoCommonWreckSalvage(state, true).ok).toBe(true)
    cell.piles = (cell.piles ?? []).filter((p) => !isRareWreck(p.itemId)) // 造"只剩普通"
    const commonBefore = commonCount(cell)
    const turnsBefore = state.wormhole.run!.turnsLeft
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.wormholeSalvage.044')
    expect(state.wormhole.run!.turnsLeft, '被拒的动作不该扣回合（打捞器没开工）').toBe(turnsBefore)
    expect(commonCount(cell), '普通残骸一动不动').toBe(commonBefore)
  })

  it('关着时逐字老行为：稀有拿完就接着拿普通残骸', () => {
    const { state, cell } = worldWithBoth()
    expect(noCommonWreckSalvageOn(state), '缺省 = 关').toBe(false)
    const commonBefore = commonCount(cell)
    let guard = 0
    while (commonCount(cell) === commonBefore && guard++ < 8 && (cell.piles ?? []).length > 0) {
      const r = wormholeSalvageAt(state, ctx)
      if (!r.ok) break
    }
    expect(commonCount(cell), '关着时普通残骸会被照常收走').toBeLessThan(commonBefore)
  })

  it('开关随档往返：写档读档后仍为开；关掉后字段不落档（老档缺字段 = 关）', () => {
    const { state } = worldWithBoth()
    expect(setNoCommonWreckSalvage(state, true).ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(noCommonWreckSalvageOn(back), '存活过写档/读档').toBe(true)
    expect(setNoCommonWreckSalvage(back, false).ok).toBe(true)
    expect(noCommonWreckSalvageOn(back)).toBe(false)
    const back2 = loadSaveFile(serializeSaveFile(back, 1)).state
    expect(noCommonWreckSalvageOn(back2), '关 = 字段不落档 ⇒ 读回来仍是关').toBe(false)
  })
})
