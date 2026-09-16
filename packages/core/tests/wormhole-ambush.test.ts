/**
 * **洞内「踩中埋伏」**（船长 2026-09-16）：
 * 「**移动途中被敌方拦截或者进入未扫描地点踩到怪了，都要弹窗提示，玩家确认后进入战斗。**」
 * ＋当轮澄清「**触发形式应该是踩中雷后，调用事件提醒，之后触发战斗，并不是在战斗前提示**」
 * ＋四答：确认前**只能选「开战」** · 路径拦截那条**不改** · **已知**敌格**不弹**直接开打 · 提醒**只写来由与坐标**。
 *
 * 落法（与「遗迹惊扰守备」同一套机制，不新造）：到达未扫描的敌格 ⇒ `arrived.ambush` ＋
 * `run.pendingNodeBattle` ⇒ 界面发事件提醒、玩家点「开战」才进战斗；标记没清之前别的层内动作被拦。
 *
 * 本文件钉住七条：
 * ① 踩中埋伏（界面 `deferAmbush`）⇒ 移动照常结算、**先不开打**、标记挂上；
 * ② 点「开战」⇒ 真开打且标记清掉；
 * ③ 标记没清 ⇒ 层内动作全被拦（**撤离除外**——逃生门与遗迹那条同口径）；
 * ④ **已知**敌格 ⇒ 照旧到达即开打（明知故往，不弹）；
 * ⑤ **路径拦截** ⇒ 照旧直接开打（拦路格未扫描也不暂停 —— 玩家在移动前已确认过）；
 * ⑥ 不传 `deferAmbush`（工具 / 老调用方）⇒ **原行为**（到达即开打）；
 * ⑦ 老档没有该字段 ⇒ 不拦（零迁移）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import {
  wormholeEnter,
  wormholeExtract,
  wormholeGridActivate,
  wormholeGridScan,
  wormholeGridTravel,
} from '../src/wormhole'
import { hexDistance, hexKey, hexLine } from '../src/wormholeGrid'
import type { HexCell, WormholeGridState, WormholePlace } from '../src/wormholeGrid'
import { wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'

const ctx = buildSimContext()

/** 起一趟真虫洞（层 1 · 给定 seed） */
function run(seed = 20260916) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ship = addShipToFleet(state, 'sh-thresher')
  expect(wormholeEnter(state, ctx, [ship], seed, { depth: 1 }).ok).toBe(true)
  const r = state.wormhole.run!
  const g = r.grid!
  return { state, run: r, grid: g }
}

function placeAt(g: WormholeGridState, cell: HexCell, place: WormholePlace): void {
  const c = g.cells.find((x) => x.key === hexKey(cell.q, cell.r))
  if (!c) throw new Error(`测试前置失败：盘里没有格 ${hexKey(cell.q, cell.r)}`)
  c.place = place
  c.piles = []
}

/** 把连线的中间格清成空地（并揭开）：保证"拦不拦"只由本用例摆的那一格决定 */
function cleanLine(g: WormholeGridState, a: HexCell, b: HexCell, reveal = true): void {
  const line = hexLine(a, b)
  for (let i = 1; i < line.length - 1; i++) {
    const k = hexKey(line[i]!.q, line[i]!.r)
    placeAt(g, line[i]!, 'empty')
    g.activated = g.activated.filter((x) => x !== k)
    if (reveal && !g.scanned.includes(k)) g.scanned.push(k)
  }
}

/** 取一个"未扫描的远端目标格"并把它摆成敌人（顺带清空连线） */
function prepareAmbush(g: WormholeGridState, minDist = 3) {
  const here = { q: g.pos.q, r: g.pos.r }
  const target = g.cells.find(
    (c) => hexDistance(here, { q: c.q, r: c.r }) >= minDist && !g.scanned.includes(c.key),
  )
  if (!target) throw new Error('测试前置失败：盘里找不到未扫描的远端格')
  cleanLine(g, here, { q: target.q, r: target.r }, false)
  placeAt(g, target, 'ship')
  g.scanned = g.scanned.filter((k) => k !== target.key)
  g.visited = g.visited.filter((k) => k !== target.key)
  return target
}

describe('虫洞 · 踩中埋伏（进未扫描地点踩到敌人）', () => {
  it('① 界面口径（`deferAmbush`）⇒ 移动照常结算、**先不开打**、挂上待确认标记', () => {
    const { state, run: r, grid } = run()
    const target = prepareAmbush(grid)
    const turns = r.turnsLeft
    const from = state.logs.length
    const res = wormholeTravelTo(
      state,
      ctx,
      { q: target.q, r: target.r },
      { confirmUnknown: true, deferAmbush: true },
    )
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.ambush).toBe(true)
    expect(res.pendingBattle).toBe('node')
    // 移动已结算：位置落到那一格、回合 −1（与"到达即开打"同一口径，只是不立刻进战斗）
    expect(grid.pos).toEqual({ q: target.q, r: target.r })
    expect(r.turnsLeft).toBe(turns - 1)
    expect(grid.activated.includes(target.key)).toBe(true)
    // **没开打**
    expect(r.battle, '踩中埋伏应先提醒、不直接开战').toBeFalsy()
    expect(r.pendingNodeBattle).toBe(true)
    // 事件提醒：日志里写明来由与坐标
    const lines = state.logs.slice(from).map((l) => l.text)
    const note = lines.find((t) => t.includes('踩中埋伏'))
    expect(note, `日志里应有"踩中埋伏"那条：${lines.join(' | ')}`).toBeTruthy()
    expect(note!).toContain(`${target.q},${target.r}`)
  })

  it('② 点「开战」⇒ 真开打，标记随之清掉（`wormholeStartBattle` 传 node）', () => {
    const { state, run: r, grid } = run()
    const target = prepareAmbush(grid)
    wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true, deferAmbush: true })
    expect(r.pendingNodeBattle).toBe(true)
    const b = wormholeStartBattle(state, ctx, 'node')
    expect(b.ok, b.error ?? '').toBe(true)
    expect(r.battle, '确认后应真的开打').toBeTruthy()
    expect(r.pendingNodeBattle, '开战成功即清标记').toBe(false)
  })

  it('③ 标记没清 ⇒ 层内动作全被拦；**撤离照走**（逃生门与遗迹那条同口径）', () => {
    const { state, run: r, grid } = run()
    const target = prepareAmbush(grid)
    wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true, deferAmbush: true })
    for (const [label, res] of [
      ['扫描', wormholeGridScan(state)],
      ['激活', wormholeGridActivate(state)],
      ['前往别的格', wormholeGridTravel(state, { q: grid.pos.q, r: grid.pos.r }, { confirmUnknown: true })],
    ] as const) {
      expect(res.ok, `${label} 应被拦`).toBe(false)
      expect(res.error ?? '', `${label} 的拦下理由应点明先开战`).toContain('开战')
    }
    // **撤离不受影响**（与 pendingRuinsBattle 同口径：只拦层内动作，不堵逃生门）
    const ex = wormholeExtract(r)
    expect(ex.ok, ex.error ?? '').toBe(true)
    expect(r.phase).toBe('extracting')
  })

  it('④ **已知**的敌格 ⇒ 照旧到达即开打（明知故往，不弹提醒）', () => {
    const { state, run: r, grid } = run()
    const here = { q: grid.pos.q, r: grid.pos.r }
    const target = grid.cells.find((c) => hexDistance(here, { q: c.q, r: c.r }) >= 2)!
    cleanLine(grid, here, { q: target.q, r: target.r })
    placeAt(grid, target, 'ship')
    if (!grid.scanned.includes(target.key)) grid.scanned.push(target.key)
    const res = wormholeTravelTo(
      state,
      ctx,
      { q: target.q, r: target.r },
      { confirmUnknown: true, deferAmbush: true },
    )
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.ambush).toBeUndefined()
    expect(res.pendingBattle).toBeUndefined()
    expect(r.battle, '已知敌格应直接开打').toBeTruthy()
    expect(r.pendingNodeBattle ?? false).toBe(false)
  })

  it('⑤ **路径拦截**照旧直接开打：拦路格"出发前未知"也不进埋伏流程（船长 Q3 = 甲）', () => {
    const { state, run: r, grid } = run()
    const here = { q: grid.pos.q, r: grid.pos.r }
    const target = grid.cells.find((c) => hexDistance(here, { q: c.q, r: c.r }) >= 3)!
    cleanLine(grid, here, { q: target.q, r: target.r }, false)
    placeAt(grid, target, 'empty')
    if (!grid.scanned.includes(target.key)) grid.scanned.push(target.key)
    const mid = hexLine(here, { q: target.q, r: target.r })[1]!
    placeAt(grid, mid, 'ship')
    // 拦路格**未扫描**（"看不见的敌人挡路"）
    grid.scanned = grid.scanned.filter((k) => k !== hexKey(mid.q, mid.r))
    grid.visited = grid.visited.filter((k) => k !== hexKey(mid.q, mid.r))
    const res = wormholeTravelTo(
      state,
      ctx,
      { q: target.q, r: target.r },
      { confirmIntercept: true, deferAmbush: true },
    )
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.intercepted).toBeTruthy()
    expect(res.ambush).toBeUndefined()
    expect(res.pendingBattle).toBeUndefined()
    expect(r.battle, '拦截应直接开打').toBeTruthy()
  })

  it('⑥ 不传 `deferAmbush`（工具 / 老调用方）⇒ **原行为**：到达即开打、不挂标记', () => {
    const { state, run: r, grid } = run()
    const target = prepareAmbush(grid)
    const res = wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true })
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.ambush).toBe(true) // 事实仍然是"踩中埋伏"
    expect(res.pendingBattle).toBeUndefined() // 但没人要求延后 ⇒ 直接开打
    expect(r.battle).toBeTruthy()
    expect(r.pendingNodeBattle ?? false).toBe(false)
  })

  it('⑦ 老档没有 `pendingNodeBattle` 字段 ⇒ 不拦任何动作（零迁移）', () => {
    const { state, run: r } = run()
    expect('pendingNodeBattle' in r).toBe(false)
    const sc = wormholeGridScan(state)
    expect(sc.ok || sc.error !== undefined).toBe(true)
    expect(sc.error ?? '').not.toContain('开战')
  })
})
