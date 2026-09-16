/**
 * **洞内「路径拦截」**（船长 2026-09-16 新增；六问六答 ＋ §5.2 甲案见工作文档
 * `docs/design/wormhole-path-intercept-20260916.md`）。
 *
 * 本文件钉住四组契约：
 * ① **六边形连线**（`hexLine`）：含两端 · 长度 = 距离 + 1 · 相邻步长 1 · **双向同集**（互为倒序）；
 * ② **拦截判定**（`wormholePathInterceptAt`）：只认"没清掉的舰船信号格" · **未扫描也拦** ·
 *    **最近的一处** · 起点/终点不参与 · 出口格（层末守卫）不拦；
 * ③ **移动被截断**（`wormholeGridTravel`）：未确认 ⇒ `path-blocked` **且不扣回合**；确认后 ⇒
 *    位置落在**拦截点**（不是目标格）、回合照扣 1、回报 `intercepted{target, known}`、到达即开打；
 * ④ **就地开战与回滚**（`wormholeTravelTo`）：拦截格上开的是那一格的仗；**开战失败整趟回滚**。
 *
 * ⚠ **用例纪律**：真盘的舰船信号格是随机撒的 ⇒ **每条用例先把选定的连线清成空地**
 * （`cleanLine`），再摆自己要测的那一处敌人。否则"线上本来就有敌人"会让断言指向别的格
 * （本文件首版就这么误报过三条）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeGridTravel } from '../src/wormhole'
import { hexDistance, hexDiskAround, hexKey, hexLine, wormholePathInterceptAt } from '../src/wormholeGrid'
import type { HexCell, WormholeGridState, WormholePlace } from '../src/wormholeGrid'
import { wormholeTravelTo } from '../src/wormholeBattle'

const ctx = buildSimContext()

/** 起一趟真虫洞（层 1 · 给定 seed），返回状态、run 与网格 */
function run(seed = 20260916) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ship = addShipToFleet(state, 'sh-thresher')
  expect(wormholeEnter(state, ctx, [ship], seed, { depth: 1 }).ok).toBe(true)
  const r = state.wormhole.run!
  const g = r.grid!
  return { state, run: r, grid: g }
}

/** 把某格改成指定地点（测试用：直接写真相） */
function placeAt(g: WormholeGridState, cell: HexCell, place: WormholePlace): void {
  const c = g.cells.find((x) => x.key === hexKey(cell.q, cell.r))
  if (!c) throw new Error(`测试前置失败：盘里没有格 ${hexKey(cell.q, cell.r)}`)
  c.place = place
  c.piles = []
}

/** 把 `a → b` 连线上的**中间格**一律清成空地（并摘掉它们的"已激活"）⇒ "线上只有我摆的那一处敌人" */
function cleanLine(g: WormholeGridState, a: HexCell, b: HexCell): void {
  const line = hexLine(a, b)
  for (let i = 1; i < line.length - 1; i++) {
    const k = hexKey(line[i]!.q, line[i]!.r)
    placeAt(g, line[i]!, 'empty')
    g.activated = g.activated.filter((x) => x !== k)
  }
}

/** 盘内找一格满足条件（找不到即测试前置失败） */
function find(g: WormholeGridState, pred: (c: WormholeGridState['cells'][number]) => boolean) {
  const c = g.cells.find(pred)
  if (!c) throw new Error('测试前置失败：盘内找不到满足条件的格')
  return c
}

/** 取一条"当前格 → 某远端格"的连线（顺带把线上清空），返回目标与线上各格 */
function pickLine(g: WormholeGridState, minDist: number) {
  const here = { q: g.pos.q, r: g.pos.r }
  const target = find(g, (c) => hexDistance(here, { q: c.q, r: c.r }) >= minDist)
  cleanLine(g, here, { q: target.q, r: target.r })
  const line = hexLine(here, { q: target.q, r: target.r })
  return { here, target, line }
}

describe('虫洞路径拦截 · 六边形连线（hexLine）', () => {
  it('含两端、长度 = 距离 + 1、相邻两格步长恒为 1（盘内逐对穷举）', () => {
    const cells = hexDiskAround({ q: 0, r: 0 }, 3)
    for (const a of cells) {
      for (const b of cells) {
        const line = hexLine(a, b)
        expect(line[0]).toEqual(a)
        expect(line[line.length - 1]).toEqual(b)
        expect(line.length).toBe(hexDistance(a, b) + 1)
        for (let i = 1; i < line.length; i++) {
          expect(hexDistance(line[i - 1]!, line[i]!), `(${a.q},${a.r})→(${b.q},${b.r}) 第 ${i} 步`).toBe(1)
        }
      }
    }
  })

  it('**双向同集**：`hexLine(a,b)` 与 `hexLine(b,a)` 互为倒序（谁拦谁不随调用方向漂）', () => {
    const cells = hexDiskAround({ q: 0, r: 0 }, 3)
    for (const a of cells) {
      for (const b of cells) {
        expect(hexLine(a, b)).toEqual([...hexLine(b, a)].reverse())
      }
    }
  })

  it('同格 ⇒ 单元素；同输入恒同输出（不消耗 rng）', () => {
    expect(hexLine({ q: 2, r: -1 }, { q: 2, r: -1 })).toEqual([{ q: 2, r: -1 }])
    expect(hexLine({ q: -2, r: 1 }, { q: 3, r: -1 })).toEqual(hexLine({ q: -2, r: 1 }, { q: 3, r: -1 }))
  })
})

describe('虫洞路径拦截 · 判定（wormholePathInterceptAt）', () => {
  it('只认**没清掉的舰船信号格**：墓场/遗迹/矿脉/谜质/信标/空地一律不拦', () => {
    const { grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    for (const place of ['graveyard', 'ruins', 'vein', 'matter', 'beacon', 'empty'] as WormholePlace[]) {
      placeAt(grid, mid, place)
      expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r }), `${place} 不该拦路`).toBeUndefined()
    }
    placeAt(grid, mid, 'ship')
    expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r })?.key).toBe(hexKey(mid.q, mid.r))
  })

  it('**未扫描的舰船信号格照样拦**（船长裁定 1 = 乙）', () => {
    const { grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.scanned = grid.scanned.filter((k) => k !== hexKey(mid.q, mid.r))
    grid.visited = grid.visited.filter((k) => k !== hexKey(mid.q, mid.r))
    const hit = wormholePathInterceptAt(grid, { q: target.q, r: target.r })
    expect(hit?.key).toBe(hexKey(mid.q, mid.r))
    // 拦之前它确实"未知"（界面据甲案决定要不要指名）
    expect(grid.scanned.includes(hit!.key) || grid.visited.includes(hit!.key)).toBe(false)
  })

  it('**只拦最近的一处**：线上两个敌格 ⇒ 返回离起点近的那个（裁定 5）', () => {
    const { grid } = run()
    const { target, line } = pickLine(grid, 4)
    placeAt(grid, line[1]!, 'ship')
    placeAt(grid, line[3]!, 'ship')
    expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r })?.key).toBe(
      hexKey(line[1]!.q, line[1]!.r),
    )
  })

  it('**已清掉的格不拦**（打赢一次就通了）；起点与终点都不参与判定', () => {
    const { grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.activated.push(hexKey(mid.q, mid.r))
    expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r })).toBeUndefined()
    // 终点自己是敌格 ⇒ 不算"拦截"（那条走既有的"到达即开打"）：中间的敌人照旧拦
    grid.activated = grid.activated.filter((k) => k !== hexKey(mid.q, mid.r))
    placeAt(grid, target, 'ship')
    grid.activated = grid.activated.filter((k) => k !== target.key)
    expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r })?.key).toBe(hexKey(mid.q, mid.r))
  })

  it('**出口格（层末守卫）不参与拦截**：穿过它不算被拦（裁定 1 = 乙只覆盖舰船信号格）', () => {
    const { grid } = run()
    const here = { q: grid.pos.q, r: grid.pos.r }
    const exit = { q: grid.exit.q, r: grid.exit.r }
    if (hexDistance(here, exit) < 2) return // 起点紧贴出口 ⇒ 本 seed 下没有中间格可测
    cleanLine(grid, here, exit)
    expect(wormholePathInterceptAt(grid, exit)).toBeUndefined()
  })
})

describe('虫洞路径拦截 · 移动被截断（wormholeGridTravel）', () => {
  it('**未确认 ⇒ 拒且不扣回合**（`path-blocked`，位置/回合一字不动）', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    placeAt(grid, line[1]!, 'ship')
    grid.scanned.push(target.key)
    const before = { turns: r.turnsLeft, q: grid.pos.q, r: grid.pos.r }
    const res = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('path-blocked')
    expect(r.turnsLeft).toBe(before.turns)
    expect(grid.pos).toEqual({ q: before.q, r: before.r })
  })

  it('两道闸各自独立：目标未扫描先报 `unknown-target`，补上确认后才谈拦截', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    placeAt(grid, line[1]!, 'ship')
    // 目标格未扫描
    grid.scanned = grid.scanned.filter((k) => k !== target.key)
    grid.visited = grid.visited.filter((k) => k !== target.key)
    const turns = r.turnsLeft
    const res = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(res.code).toBe('unknown-target')
    expect(r.turnsLeft).toBe(turns)
    const res2 = wormholeGridTravel(state, { q: target.q, r: target.r }, { confirmUnknown: true })
    expect(res2.code).toBe('path-blocked')
    expect(r.turnsLeft).toBe(turns)
  })

  it('三道闸的顺序：**未知地点 → 回合不足 → 拦截确认**（0 回合时不该先弹走不成的确认框）', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    placeAt(grid, line[1]!, 'ship')
    grid.scanned.push(target.key)
    r.turnsLeft = 0
    const res = wormholeGridTravel(state, { q: target.q, r: target.r }, { confirmIntercept: true })
    expect(res.ok).toBe(false)
    expect(res.mustExtract).toBe(true)
    expect(res.code).toBeUndefined()
  })

  it('**确认后 ⇒ 截断在拦截点**：位置落到那一格、回合照扣 1、回报 intercepted 且到达即开打', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.scanned.push(target.key, hexKey(mid.q, mid.r))
    const turns = r.turnsLeft
    const res = wormholeGridTravel(state, { q: target.q, r: target.r }, { confirmIntercept: true })
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.spent).toBe(1)
    expect(r.turnsLeft).toBe(turns - 1)
    expect(grid.pos).toEqual({ q: mid.q, r: mid.r }) // **没到达目标格**
    expect(res.arrived?.key).toBe(hexKey(mid.q, mid.r))
    expect(res.arrived?.intercepted).toEqual({ target: target.key, known: true })
    expect(res.arrived?.autoBattle).toBe(true)
    expect(grid.activated.includes(hexKey(mid.q, mid.r))).toBe(true) // 该格当场算"打完"
  })

  it('`known` 如实反映**拦之前**那一格是否已知（甲案：未知不指名）；到达后它变已知', () => {
    const { state, grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.scanned.push(target.key)
    grid.scanned = grid.scanned.filter((k) => k !== hexKey(mid.q, mid.r))
    grid.visited = grid.visited.filter((k) => k !== hexKey(mid.q, mid.r))
    const res = wormholeGridTravel(state, { q: target.q, r: target.r }, { confirmIntercept: true })
    expect(res.arrived?.intercepted).toEqual({ target: target.key, known: false })
    // 到达 ⇒ 真相揭开（这一格进 scanned/visited，且当场算"打完"）；此后再穿越它不再被拦
    expect(grid.scanned.includes(hexKey(mid.q, mid.r))).toBe(true)
    expect(wormholePathInterceptAt(grid, { q: target.q, r: target.r })).toBeUndefined()
  })

  it('路径干净 ⇒ 直达目标格、无 intercepted（原口径零变化）', () => {
    const { state, run: r, grid } = run()
    const { target } = pickLine(grid, 2)
    grid.scanned.push(target.key)
    const turns = r.turnsLeft
    const res = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(res.ok).toBe(true)
    expect(grid.pos).toEqual({ q: target.q, r: target.r })
    expect(r.turnsLeft).toBe(turns - 1)
    expect(res.arrived?.intercepted).toBeUndefined()
  })
})

describe('虫洞路径拦截 · 就地开战与回滚（wormholeTravelTo）', () => {
  it('被拦 ⇒ 在**拦截点那一格**开战（不是目标格），并透传 intercepted', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.scanned.push(target.key, hexKey(mid.q, mid.r))
    const res = wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmIntercept: true })
    expect(res.ok, res.error ?? '').toBe(true)
    expect(res.autoBattle).toBe(true)
    expect(res.intercepted).toEqual({ target: target.key, known: true })
    expect(grid.pos).toEqual({ q: mid.q, r: mid.r })
    expect(r.battle, '拦截后应就地开战').toBeTruthy()
  })

  it('**开战失败 ⇒ 整趟移动回滚**（回合 / 位置 / 已到达 / 已扫描 / 已激活 一律还原）', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    const mid = line[1]!
    placeAt(grid, mid, 'ship')
    grid.scanned.push(target.key, hexKey(mid.q, mid.r))
    const snap = {
      turns: r.turnsLeft,
      pos: { ...grid.pos },
      visited: [...grid.visited],
      scanned: [...grid.scanned],
      activated: [...grid.activated],
    }
    // 编队空 ⇒ `startFleetBattleFor` 开不出战斗 ⇒ 触发回滚（这正是"半截状态"那条护栏）
    const fleet = [...r.fleet]
    r.fleet = []
    const res = wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmIntercept: true })
    r.fleet = fleet
    expect(res.ok).toBe(false)
    expect(res.error ?? '').toContain('无法开战')
    expect(r.turnsLeft).toBe(snap.turns)
    expect(grid.pos).toEqual(snap.pos)
    expect(grid.visited).toEqual(snap.visited)
    expect(grid.scanned).toEqual(snap.scanned)
    expect(grid.activated).toEqual(snap.activated)
    expect(r.battle).toBeFalsy()
  })

  it('未确认时 `wormholeTravelTo` 原样透出 `path-blocked`（与界面确认链同一把尺）', () => {
    const { state, run: r, grid } = run()
    const { target, line } = pickLine(grid, 3)
    placeAt(grid, line[1]!, 'ship')
    grid.scanned.push(target.key)
    const turns = r.turnsLeft
    const res = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('path-blocked')
    expect(r.turnsLeft).toBe(turns)
    expect(r.battle).toBeFalsy()
  })
})
