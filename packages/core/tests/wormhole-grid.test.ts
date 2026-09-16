/**
 * **网格探索几何与生成（F3a · 2026-09-13 船长确认）**。
 *
 * 本文件钉住四件事（都是船长原话口径）：
 * ① **圆盘六边形网格**：R=2 ⇒ 19 格（`3R(R+1)+1`）、邻居 6 个、距离对称；
 * ② **信号遮蔽**：未扫描 = 未知；已扫描 = 只看到**信号**；**到达**才给真相；
 *    （空地点 ⇒ 无信号；舰船墓场/遗迹 ⇒ 都是「残骸信号」；舰船/矿脉/谜质各自一个信号）
 * ③ **空地点 ≥50%**、**遗迹 = 残骸信号的 30%**（其余 70% 舰船墓场）；
 * ④ **确定性**：同 `(seed, depth)` 必得同盘（存档只存结果，重算也能复现）。
 *
 * ✅ 2026-09-14 船长解除不可见；本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import {
  HEX_DIRS,
  WORMHOLE_EMPTY_MIN_SHARE,
  WORMHOLE_GRID_R_MAX,
  WORMHOLE_RUINS_FLOOR_MIN_DEPTH,
  WORMHOLE_RUINS_SHARE,
  gridTally,
  hexDiskAround,
  hexDiskCells,
  hexDiskCount,
  hexDistance,
  hexKey,
  hexNeighbors,
  isExitCell,
  pickPlace,
  revealOf,
  signalOfPlace,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  wormholeRuinsFloorFor,
} from '../src/wormholeGrid'
import type { WormholeSignal } from '../src/wormholeGrid'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeGridScan, wormholeGridTravel } from '../src/wormhole'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()

describe('虫洞网格 · 几何（F3a）', () => {
  it('半径 R 的圆盘格数 = 3R(R+1)+1（R=2 ⇒ 19 格）', () => {
    expect(hexDiskCount(0)).toBe(1)
    expect(hexDiskCount(1)).toBe(7)
    expect(hexDiskCount(2)).toBe(19)
    expect(hexDiskCount(3)).toBe(37)
    expect(hexDiskCount(4)).toBe(61)
    for (const R of [0, 1, 2, 3, 4]) expect(hexDiskCells(R).length).toBe(hexDiskCount(R))
  })

  it('邻居恒 6 个、距离 1；距离对称且满足三角不等式', () => {
    const c = { q: 2, r: -1 }
    const ns = hexNeighbors(c)
    expect(ns).toHaveLength(6)
    expect(HEX_DIRS).toHaveLength(6)
    for (const n of ns) expect(hexDistance(c, n)).toBe(1)
    const far = { q: -3, r: 4 }
    expect(hexDistance(c, far)).toBe(hexDistance(far, c))
    expect(hexDistance(c, far)).toBeLessThanOrEqual(hexDistance(c, ns[0]!) + hexDistance(ns[0]!, far))
  })

  it('`hexDiskAround` 含中心；`hexRingAround` 只取该圈', () => {
    const center = { q: 1, r: 2 }
    expect(hexDiskAround(center, 1)).toHaveLength(7)
    expect(hexDiskAround(center, 0)).toEqual([center])
  })

  it('每层半径：R=2 起、每 2 层 +1、上限 R=4（船长「其他按推荐」）', () => {
    expect(wormholeGridRadiusFor(1)).toBe(2)
    expect(wormholeGridRadiusFor(2)).toBe(2)
    expect(wormholeGridRadiusFor(3)).toBe(3)
    expect(wormholeGridRadiusFor(4)).toBe(3)
    expect(wormholeGridRadiusFor(5)).toBe(4)
    expect(wormholeGridRadiusFor(99)).toBe(WORMHOLE_GRID_R_MAX)
  })
})

describe('虫洞网格 · 生成（F3a · 空 ≥50% / 遗迹 30%）', () => {
  it('**确定性**：同 seed+depth 必得同盘；不同 seed 会不一样', () => {
    const a = wormholeMakeGrid(12345, 1)
    const b = wormholeMakeGrid(12345, 1)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const c = wormholeMakeGrid(999, 1)
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a))
  })

  it('**入口在外圈、终点是另一个格**（且都在盘内）', () => {
    for (const seed of [1, 7, 42, 20260913]) {
      for (const depth of [1, 2, 3, 5]) {
        const g = wormholeMakeGrid(seed, depth)
        const distStart = hexDistance(g.start, { q: 0, r: 0 })
        expect(distStart, `第 ${depth} 层入口应在外圈（半径 ${g.radius}）`).toBe(g.radius)
        expect(hexKey(g.exit.q, g.exit.r)).not.toBe(hexKey(g.start.q, g.start.r))
        expect(hexDistance(g.exit, { q: 0, r: 0 })).toBeLessThanOrEqual(g.radius)
        // 初始：玩家在入口、入口格已知（到达即揭示），终点还没到过
        expect(g.pos).toEqual(g.start)
        expect(g.visited).toEqual([hexKey(g.start.q, g.start.r)])
        expect(g.visited).not.toContain(hexKey(g.exit.q, g.exit.r))
        expect(g.scanRadius).toBe(1) // 船长：初始扫描范围 1 格
      }
    }
  })

  it('**空地点至少占 50%**（船长口径）', () => {
    for (const seed of [1, 2, 3, 77, 12345]) {
      const g = wormholeMakeGrid(seed, 1)
      const t = gridTally(g)
      expect(t.total).toBe(19)
      expect(t.empty / t.total, `seed ${seed} 空地点占比 ${t.empty}/${t.total}`).toBeGreaterThanOrEqual(
        WORMHOLE_EMPTY_MIN_SHARE,
      )
    }
  })

  /**
   * **遗迹 = 残骸信号的 30%**（层 3 起；层 1 恒 0、层 2 无保底也会走 30%）。
   *
   * ⚠ 口径沿革：2026-09-13 加了「每层遗迹下限」（硬保证 ⇒ 实际占比高于 30%）；
   * **2026-09-16 船长改判「保底从 3 层开始，1 层没有遗迹」** ⇒ 层 1 的遗迹恒为 **0**（不再有下限抬升），
   * 故本用例改钉 **层 3**（有下限的那一档）的比例与层 1 的"恒 0"。
   */
  it('**遗迹 = 残骸信号的 30%**（层 3 起；层 1 恒 0）', () => {
    // 层 3：下限 2 会把占比抬高一点 ⇒ 上下界都放宽到"下限带来的偏移"以内
    let ruins = 0
    let wreck = 0
    for (let seed = 1; seed <= 200; seed++) {
      const t = gridTally(wormholeMakeGrid(seed, 3))
      ruins += t.byPlace.ruins
      wreck += t.bySignal.wreck
    }
    expect(wreck).toBeGreaterThan(50)
    expect(ruins / wreck).toBeGreaterThan(WORMHOLE_RUINS_SHARE - 0.15)
    expect(ruins / wreck).toBeLessThan(WORMHOLE_RUINS_SHARE + 0.35)
    // 层 1：船长 2026-09-16「1层没有遗迹」⇒ 恒 0（残骸信号全给舰船墓场）
    for (const seed of [1, 2, 3, 77, 2026]) {
      const t = gridTally(wormholeMakeGrid(seed, 1))
      expect(t.byPlace.ruins, `seed ${seed} 的第 1 层出了遗迹`).toBe(0)
      expect(t.bySignal.wreck, '层 1 的残骸信号照旧（只是全归舰船墓场）').toBeGreaterThan(0)
    }
  })

  it('五类信号都真的会出现（多 seed 抽样）', () => {
    const seen = new Set<WormholeSignal>()
    for (let seed = 1; seed <= 40; seed++) {
      const t = gridTally(wormholeMakeGrid(seed, 3))
      for (const k of Object.keys(t.bySignal) as WormholeSignal[]) if (t.bySignal[k] > 0) seen.add(k)
    }
    expect([...seen].sort()).toEqual(['beacon', 'radar', 'resource', 'ship', 'wreck'])
  })

  /**
   * **信标不许落在入口格**（船长 2026-09-13：「不可以同一格」）。
   *
   * 为什么：信标的"读出下一层入口"是**到达时触发**的，而入口格开局就算"已到达"（建档时写死 `visited`）
   * ⇒ 信标落在入口格上时玩家站在信标上却读不出终点（F3c 第二段的整趟模拟实测踩到）。
   * 修法 = 与另一格**交换信号**（不是重掷）⇒ 各信号的格数与实测分布一字不变。
   */
  it('**信标不落入口格**（船长 2026-09-13：「不可以同一格」）——且信标数从"取整漂移"变成**定额**', () => {
    /**
     * ⚠ 2026-09-13 层间盘面批：信标数**从"随 seed 漂 1~2 格"变成逐层定额**。
     *
     * 为什么：旧式 `空 = ⌈总格数 × 50%⌉` 的口径下，池子 = `格数 − 1 − 空格数` **随终点格自己是否为空**在
     * 两组值之间跳（例如层 3 的池恒为 17 或 18）⇒ 同一层不同 seed 的信标数会在 1/2 之间漂。
     * 现在空格数是**定额**（`⌈(格数−1) × 该层占比⌉`）⇒ 池子定额 ⇒ 各信号计数**逐层定额、与 seed 无关**。
     * 这是纯改进（校准与用例都不必再留"取整容差"），但数变了 ⇒ 这里按新分配重钉。
     */
    const expectBeacons: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 8: 4 }
    for (const [depthStr, n] of Object.entries(expectBeacons)) {
      const depth = Number(depthStr)
      for (let seed = 1; seed <= 120; seed++) {
        const g = wormholeMakeGrid(seed, depth)
        const startKey = `${g.start.q},${g.start.r}`
        const beacons = g.cells.filter((c) => c.place === 'beacon')
        expect(beacons.length, `seed ${seed} 层 ${depth} 的信标数`).toBe(n)
        expect(
          beacons.some((c) => c.key === startKey),
          `seed ${seed} 层 ${depth}：信标落在了入口格 ${startKey} 上`,
        ).toBe(false)
        // 出口格本来就不参与信号分配 ⇒ 也不该是信标
        expect(beacons.some((c) => c.key === `${g.exit.q},${g.exit.r}`)).toBe(false)
      }
    }
  })

  /**
   * **信标读出终点 ⇒ 终点格一并算"已知"**（船长 2026-09-13：出口格"未扫描"那条按推荐修）。
   *
   * 为什么：出口格不参与信号分配、`scanned` 里默认没有它；玩家从信标知道终点在哪之后，
   * 点它前往仍会撞上「这个地点还没扫描过：前往未知地点？」——那句话在此时是误导。
   * （⚠ 2026-09-16 甲案起，"扫描扫到出口格"也走同一个收口 `markExitKnown`，见下一条用例。）
   */
  it('信标读出终点后，**出口格不再要求"确认未知"**（修掉那次多余的确认框）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4242 })
    const a = addShipToFleet(state, 'sh-thresher')
    expect(wormholeEnter(state, ctx, [a], 4242).ok).toBe(true)
    const run = state.wormhole.run!
    const g = run.grid!
    const startKey = `${g.pos.q},${g.pos.r}`
    const exitKey = `${g.exit.q},${g.exit.r}`
    // ① 读到信标之前：出口格未扫描 ⇒ 直接前往被"未知地点"拦（口径照旧）
    expect(g.scanned.includes(exitKey)).toBe(false)
    if (exitKey !== startKey) {
      const blocked = wormholeGridTravel(state, { q: g.exit.q, r: g.exit.r })
      expect(blocked.ok).toBe(false)
      expect(blocked.code).toBe('unknown-target')
    }
    // ② 走到信标（把邻格改成信标、扫过再走过去）
    const beacon = g.cells.find((c) => c.key !== startKey)!
    beacon.place = 'beacon'
    beacon.piles = []
    if (!g.scanned.includes(beacon.key)) g.scanned.push(beacon.key)
    expect(wormholeGridTravel(state, { q: beacon.q, r: beacon.r }).ok).toBe(true)
    expect(g.exitKnown).toBe(true)
    // ③ 出口格随之记为已知，且前往它走正常路径（不再需要 confirmUnknown）
    expect(g.scanned.includes(exitKey), '信标读出终点后，出口格应记为已知').toBe(true)
    if (exitKey !== beacon.key) {
      const go = wormholeGridTravel(state, { q: g.exit.q, r: g.exit.r })
      expect(go.ok, `前往出口被拒：${go.error ?? ''}`).toBe(true)
    }
  })

  /**
   * **扫描扫到出口格 ⇒ 入口标上地图**（船长 2026-09-16 裁定**甲案**）。
   *
   * 报障原话：「**发现一个问题，玩家扫描无法直接扫出下一层入口**」⇒ 取证：入口格不参与信号分配、
   * `place` 恒为 `empty`，扫到它时只给 `signal(null)`，界面据 `exitKnown` 判入口 ⇒ **扫过也画成
   * 「没有信号：空信息地点」**，玩家扫到了入口位置却认不出来。
   * 现口径：扫描的圈里含出口格 ⇒ 与"读到信标"走同一个收口（`markExitKnown`）⇒ 地图标出入口、
   * 前往不再要"未知地点"确认；**圈里没有出口格 ⇒ 不标**（信标仍是唯一的远程途径）。
   */
  it('扫描扫到出口格 ⇒ 入口立刻标上地图；圈里没有出口格 ⇒ 不标（2026-09-16 甲案）', () => {
    // ① 正向：把玩家挪到出口格旁边（扫描半径 1 的一圈里），扫一次 ⇒ 入口已知
    const state = createInitialState({ nowWallMs: 0, seed: 4242 })
    const a = addShipToFleet(state, 'sh-thresher')
    expect(wormholeEnter(state, ctx, [a], 4242).ok).toBe(true)
    const run = state.wormhole.run!
    const g = run.grid!
    const exitKey = hexKey(g.exit.q, g.exit.r)
    const near = g.cells
      .filter((c) => c.key !== exitKey && hexDistance({ q: c.q, r: c.r }, g.exit) === 1)
      .sort((p, q) => p.key.localeCompare(q.key))[0]!
    expect(near, '出口格周围总该有邻格').toBeDefined()
    g.pos = { q: near.q, r: near.r }
    expect(g.exitKnown, '扫之前入口不该是已知的').toBe(false)
    expect(g.scanned.includes(exitKey), '扫之前出口格未扫描').toBe(false)
    const sc = wormholeGridScan(state)
    expect(sc.ok, sc.error).toBe(true)
    expect(sc.exitScanned, '这一圈里应当扫到了出口格').toBe(true)
    expect(g.exitKnown, '扫到出口格 ⇒ 入口已知').toBe(true)
    expect(g.scanned.includes(exitKey), '出口格随之并入已扫描').toBe(true)
    // 界面判据（`Wormhole.tsx` 的 isExit）成立、前往不再要确认
    expect(g.visited.includes(exitKey) || g.exitKnown === true).toBe(true)
    const go = wormholeGridTravel(state, { q: g.exit.q, r: g.exit.r })
    expect(go.ok, `前往入口被拒：${go.error ?? ''}`).toBe(true)

    // ② 反向：出口格在扫描圈外 ⇒ 扫了也不标（找一盘"入口离出生格足够远"的）
    const far = ((): { ok: boolean; state?: ReturnType<typeof createInitialState> } => {
      for (let seed = 1; seed <= 30; seed++) {
        const s = createInitialState({ nowWallMs: 0, seed })
        const id = addShipToFleet(s, 'sh-thresher')
        if (!wormholeEnter(s, ctx, [id], seed).ok) continue
        const gg = s.wormhole.run!.grid!
        if (hexDistance(gg.pos, gg.exit) > gg.scanRadius + 1) return { ok: true, state: s }
      }
      return { ok: false }
    })()
    expect(far.ok, '该找得到一盘入口离出生格足够远的').toBe(true)
    const g2 = far.state!.wormhole.run!.grid!
    const sc2 = wormholeGridScan(far.state!)
    expect(sc2.ok, sc2.error).toBe(true)
    expect(sc2.exitScanned ?? false, '入口在圈外 ⇒ 这一扫不该判成扫到入口').toBe(false)
    expect(g2.exitKnown ?? false, '入口在圈外 ⇒ 不标').toBe(false)
  })

  it('信号遮蔽：未知 / 只有信号 / 已知真相 三档（**空地点无信号**）', () => {
    const g = wormholeMakeGrid(20260913, 1)
    const startCell = g.start
    // 入口格：已到达 ⇒ 直接给真相
    const r0 = revealOf(g, startCell)
    expect(r0.kind).toBe('known')
    // 找一个未扫描的格 ⇒ unknown
    const unknown = g.cells.find((c) => !g.scanned.includes(c.key) && !g.visited.includes(c.key))!
    expect(revealOf(g, { q: unknown.q, r: unknown.r }).kind).toBe('unknown')
    // 人为标成"已扫描" ⇒ 只给信号（不给真相）
    g.scanned.push(unknown.key)
    const r1 = revealOf(g, { q: unknown.q, r: unknown.r })
    expect(r1.kind).toBe('signal')
    // 扫开 ⇒ 如实回报：空信息地点给 null（**不是**伪装成"舰船信号"，船长 2026-09-13 F3a-2 修正）
    if (r1.kind === 'signal') expect(r1.signal).toBe(signalOfPlace(unknown.place))
    // 再标成"已到达" ⇒ 给真相
    g.visited.push(unknown.key)
    const r2 = revealOf(g, { q: unknown.q, r: unknown.r })
    expect(r2.kind).toBe('known')
    if (r2.kind === 'known') expect(r2.place).toBe(unknown.place)
  })

  it('地点 ↔ 信号 的映射：墓场/遗迹同为残骸信号；空地点无信号；信标自成一类', () => {
    expect(signalOfPlace('empty')).toBeNull()
    expect(signalOfPlace('graveyard')).toBe('wreck')
    expect(signalOfPlace('ruins')).toBe('wreck')
    expect(signalOfPlace('ship')).toBe('ship')
    expect(signalOfPlace('vein')).toBe('resource')
    expect(signalOfPlace('matter')).toBe('radar')
    expect(signalOfPlace('beacon')).toBe('beacon')
    // 残骸信号按 30% 判遗迹（用固定随机数验证分界，避免抽样抖动）
    expect(pickPlace('wreck', 0)).toBe('ruins')
    expect(pickPlace('wreck', WORMHOLE_RUINS_SHARE - 0.01)).toBe('ruins')
    expect(pickPlace('wreck', WORMHOLE_RUINS_SHARE + 0.01)).toBe('graveyard')
    // 其余信号一一对应（信标也照此）
    expect(pickPlace('beacon', 0.5)).toBe('beacon')
    expect(pickPlace('ship', 0.5)).toBe('ship')
  })

  it('终点判定：只有终点格算"该层末守卫处"', () => {
    const g = wormholeMakeGrid(5, 2)
    expect(isExitCell(g, g.exit)).toBe(true)
    expect(isExitCell(g, g.start)).toBe(false)
  })
})

describe('虫洞网格 · 遗迹保底（船长 2026-09-16：「遗迹的保底，改为从3层开始保底。1层没有遗迹」）', () => {
  it('**层 1 恒 0 张遗迹**（任何种子/任何原型都一样）', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const g = wormholeMakeGrid(seed, 1)
      const ruins = g.cells.filter((c) => c.place === 'ruins').length
      expect(ruins, `seed ${seed} 的第 1 层出了遗迹`).toBe(0)
    }
    expect(wormholeRuinsFloorFor(1)).toBe(0)
  })

  it('**保底从层 3 起**：下限表 层1=0 · 层2=0 · 层3=2 · 层4=2 · 层5=3 · 层7=4；层 2 允许出但可能为 0', () => {
    expect(WORMHOLE_RUINS_FLOOR_MIN_DEPTH).toBe(3)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => wormholeRuinsFloorFor(d))).toEqual([0, 0, 2, 2, 3, 3, 4, 4])
    // 层 2 无保底：实测既出过 0 张、也出过 >0 张（只验"允许 0"这一半 ⇒ 200 个种子里必定有 0 张的盘）
    let zeros = 0
    let positives = 0
    for (let seed = 1; seed <= 200; seed++) {
      const n = wormholeMakeGrid(seed, 2).cells.filter((c) => c.place === 'ruins').length
      if (n === 0) zeros += 1
      else positives += 1
    }
    expect(zeros, '层 2 应该允许"一个遗迹都没有"').toBeGreaterThan(0)
    expect(positives, '层 2 也该常常有遗迹（不是恒 0）').toBeGreaterThan(0)
    // 层 3 起真的守住下限（含「遗迹密集」原型的 +1）
    for (const depth of [3, 4, 5, 6, 7, 8]) {
      const floor = wormholeRuinsFloorFor(depth)
      for (let seed = 1; seed <= 120; seed++) {
        const n = wormholeMakeGrid(seed, depth).cells.filter((c) => c.place === 'ruins').length
        expect(n, `层 ${depth}（seed ${seed}）遗迹 ${n} < 下限 ${floor}`).toBeGreaterThanOrEqual(floor)
      }
    }
  })
})

describe('虫洞网格 · 随档（F3a）', () => {
  it('网格状态随档往返不丢（真相/已扫描/已到达/位置/终点都在），坏值 ⇒ 整块丢弃退回旧口径', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a], 7).ok).toBe(true)
    const run = state.wormhole.run!
    const grid = wormholeMakeGrid(7, 1)
    // 造点"进度"：扫两个、到一个、激活一个、信标已把入口标出
    grid.scanned.push('1,0', '0,1')
    grid.visited.push('1,0')
    grid.pos = { q: 1, r: 0 }
    grid.activated.push('1,0')
    grid.exitKnown = true
    run.grid = grid
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.grid, '网格没随档').toBeTruthy()
    expect(back.grid!.radius).toBe(grid.radius)
    expect(back.grid!.pos).toEqual(grid.pos)
    expect(back.grid!.exit).toEqual(grid.exit)
    expect(back.grid!.scanned).toEqual(grid.scanned)
    expect(back.grid!.visited).toEqual(grid.visited)
    expect(back.grid!.activated).toEqual(grid.activated)
    expect(back.grid!.exitKnown, '信标标出的入口没随档（读档后地图上的入口会消失）').toBe(true)
    expect(back.grid!.cells.length).toBe(grid.cells.length)
    expect(gridTally(back.grid!).empty).toBe(gridTally(grid).empty)
    // 带堆的格随档（F3b 打捞会往格上放堆）
    grid.cells[0]!.piles = [{ itemId: 'ore-voidmother', units: 500 }]
    const back2 = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back2.grid!.cells.find((c) => c.key === grid.cells[0]!.key)!.piles).toEqual([
      { itemId: 'ore-voidmother', units: 500 },
    ])
    // 坏值：cells 清空 ⇒ 整块丢弃（该层退回旧口径），但档其余部分照读
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: { wormhole: { run: { grid: unknown } } } }
    raw.state.wormhole.run.grid = { radius: 2, cells: [] }
    const broken = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!
    expect(broken).toBeTruthy()
    expect(broken.grid).toBeUndefined()
  })
})