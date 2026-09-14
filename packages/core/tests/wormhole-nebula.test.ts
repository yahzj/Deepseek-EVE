/**
 * **虫洞 · 星云机制 + 层间盘面分配**（2026-09-13 船长三条裁定 · 二号）。
 *
 * 船长原话（照抄）：
 * ① 「**让遗迹格数量随层数增加并给每层增加一个遗迹格下限**」＋「**空地块允许随着高层权重降低**」；
 * ② 「**在四层以上及以上，添加星云机制，玩家第一次扫描出一个地点时，有星云的地点，星云会遮挡该地点的
 *    信号。需要玩家再扫描一次才能驱散星云。这个机制在玩家第一次下到四层时提示玩家**」；
 * ③ 「**空地没有星云**」＋「**⑤除了一次性事件，通讯内也发一条相关的讯息给玩家。同一批落下**」。
 *
 * 本文件锁四组：
 * ① **遗迹下限随层**（层 1~2 = 1 · 层 3~4 = 2 · 层 5~6 = 3）且**信标恒 ≥1**；
 * ② **空占比随层下降**（层 1 = 50% → 层 6 起 32%）；
 * ③ **星云只从层 4 起、只长在有信号的地点上**（空地与下一层入口都不长）；
 * ④ **星云的行为闭环**：首扫只读到"星云" → 同圈再扫一次驱散 → 信号可读；**到了照样给真相**；
 *    以及**第一次下到层 4 的一次性提示只给一次**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_EMPTY_SHARE_FLOOR,
  WORMHOLE_NEBULA_MIN_DEPTH,
  WORMHOLE_NEBULA_SHARE,
  WORMHOLE_RUINS_SHARE,
  gridCellAt,
  isNebulaFogged,
  revealOf,
  signalOfPlace,
  wormholeEmptyShareFor,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  wormholeRuinsFloorFor,
} from '../src/wormholeGrid'
import {
  WORMHOLE_SIGNAL_WEIGHTS,
  WORMHOLE_TURN_PER_SCAN,
} from '../src/wormholeGrid'
import { wormholeDescend, wormholeGridScan, wormholeGridTravel, wormholeStartRun } from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'

const ctx = buildSimContext()
const T1 = 'sandcat'
/** 多 seed 统计（盘面是确定性的，但"哪个格是遗迹/星云"仍随 seed 变） */
const SEEDS = Array.from({ length: 120 }, (_, i) => 1000 + i * 37)

function gridOf(depth: number, seed: number, scanBonus = 0) {
  return wormholeMakeGrid(seed, depth, scanBonus)
}

function countPlace(depth: number, seed: number, place: string): number {
  return gridOf(depth, seed).cells.filter((c) => c.place === place).length
}

/** 起一趟并把它挂进 state（层内动作的公共前置，与既有用例同款） */
function enterForActions(shipIds: readonly string[] = [T1, T1, T1, T1], seed = 12345): { state: GameState; run: WormholeRunState } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const run = wormholeStartRun(ctx, shipIds, seed).run!
  run.attending = true
  state.wormhole.run = run
  return { state, run }
}

describe('虫洞 · 层间盘面分配（船长 2026-09-13：遗迹下限 + 空占比随层降）', () => {
  it('**遗迹格下限随层增加**：层 1~2 ≥ 1 · 层 3~4 ≥ 2 · 层 5~6 ≥ 3（每层都验，120 seed）', () => {
    expect(wormholeRuinsFloorFor(1)).toBe(1)
    expect(wormholeRuinsFloorFor(2)).toBe(1)
    expect(wormholeRuinsFloorFor(3)).toBe(2)
    expect(wormholeRuinsFloorFor(4)).toBe(2)
    expect(wormholeRuinsFloorFor(5)).toBe(3)
    expect(wormholeRuinsFloorFor(6)).toBe(3)
    // 逐层逐 seed 硬断言（下限是**保证**，不是期望）
    for (const depth of [1, 2, 3, 4, 5, 6]) {
      const floor = wormholeRuinsFloorFor(depth)
      for (const seed of SEEDS) {
        const n = countPlace(depth, seed, 'ruins')
        expect(n, `层 ${depth} · seed ${seed} 的遗迹格 ${n} < 下限 ${floor}`).toBeGreaterThanOrEqual(floor)
      }
    }
  })

  it('**信标恒 ≥1**：借格子只从"资源/谜质"借，舰船与信标一个不动', () => {
    for (const depth of [1, 2, 3, 4, 5, 6]) {
      for (const seed of SEEDS) {
        const g = gridOf(depth, seed)
        const beacons = g.cells.filter((c) => c.place === 'beacon').length
        expect(beacons, `层 ${depth} · seed ${seed} 没有信标（每层必须有一个指路标记）`).toBeGreaterThanOrEqual(1)
        // 舰船信号也要有（它是"顺手打一场、固定给 1 件稀有残骸"的来源）
        const ships = g.cells.filter((c) => c.place === 'ship').length
        expect(ships).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('**遗迹跟着层数涨**：层 1 的均值 < 层 3 < 层 5（"随层数增加"这条要看得见）', () => {
    const avg = (depth: number): number =>
      SEEDS.reduce((s, seed) => s + countPlace(depth, seed, 'ruins'), 0) / SEEDS.length
    const [d1, d3, d5] = [avg(1), avg(3), avg(5)]
    expect(d1).toBeLessThan(d3)
    expect(d3).toBeLessThan(d5)
    // 改造前的实测期望是 0.54 / 1.48 / 2.61 ⇒ 下限落地后浅层必须明显抬起来
    expect(d1).toBeGreaterThan(0.9)
  })

  it('**空占比随层下降**：层 1 = 50% → 层 6 触底 32%（"占可分配池"，层 1 逐格不变）', () => {
    expect(wormholeEmptyShareFor(1)).toBeCloseTo(0.5, 6)
    expect(wormholeEmptyShareFor(2)).toBeCloseTo(0.46, 6)
    expect(wormholeEmptyShareFor(3)).toBeCloseTo(0.42, 6)
    expect(wormholeEmptyShareFor(4)).toBeCloseTo(0.38, 6)
    expect(wormholeEmptyShareFor(5)).toBeCloseTo(0.34, 6)
    expect(wormholeEmptyShareFor(6)).toBeCloseTo(WORMHOLE_EMPTY_SHARE_FLOOR, 6)
    expect(wormholeEmptyShareFor(9)).toBeCloseTo(WORMHOLE_EMPTY_SHARE_FLOOR, 6)
    /**
     * 实际盘面：空格数 = `⌈池 × 占比⌉`（池 = 总格数 − 1），终点格自己也可能变空
     * ⇒ 允许 +1 的取整/终点余量。
     */
    for (const depth of [1, 2, 3, 4, 5, 7]) {
      const s = wormholeEmptyShareFor(depth)
      for (const seed of SEEDS.slice(0, 30)) {
        const g = gridOf(depth, seed)
        const empties = g.cells.filter((c) => c.place === 'empty').length
        const wanted = Math.ceil((g.cells.length - 1) * s)
        expect(empties, `层 ${depth} · seed ${seed}：空 ${empties}，期望 ${wanted}(+1)`).toBeGreaterThanOrEqual(wanted)
        expect(empties, `层 ${depth} · seed ${seed}：空 ${empties}，期望 ${wanted}(+1)`).toBeLessThanOrEqual(wanted + 1)
      }
    }
    // 层 1 的盘面与改造前一致：19 格、10 空（= ⌈18 × 50%⌉）
    const g1 = gridOf(1, 2026)
    expect(g1.cells.length).toBe(19)
    expect(g1.cells.filter((c) => c.place === 'empty').length).toBe(10)
    // 深层要**明显**比浅层"满"（占格比例下降这条要看得见）
    const emptyRatio = (depth: number): number => {
      const g = gridOf(depth, 2026)
      return g.cells.filter((c) => c.place === 'empty').length / g.cells.length
    }
    expect(emptyRatio(5)).toBeLessThan(emptyRatio(1) - 0.1)
  })

  it('**事件玄学**（event-dividend）把空地点按**相对**削减：每级 −4% / 满级 ×0.8（地板之后乘）', () => {
    // ① 系数 1（缺省）= 一字不变
    for (const depth of [1, 3, 6, 9]) {
      expect(wormholeEmptyShareFor(depth, 1)).toBeCloseTo(wormholeEmptyShareFor(depth), 10)
    }
    /**
     * ② 满级 ×0.8：每一层都恰为 0.8 倍 —— **含已经触到 0.32 地板的深层**。
     * 这正是"先取基础占比（含地板）、再乘系数"的判据：反过来先乘再取地板，深层会被地板吃回去、技能等于没用。
     */
    for (const depth of [1, 2, 5, 6, 9]) {
      expect(wormholeEmptyShareFor(depth, 0.8), `层 ${depth}`).toBeCloseTo(wormholeEmptyShareFor(depth) * 0.8, 10)
    }
    // ③ 线性每级 −4%（rank 5 ⇒ 满级恰 −20%）
    expect(wormholeEmptyShareFor(1, 1 - 0.04 * 5)).toBeCloseTo(0.4, 10)
    expect(wormholeEmptyShareFor(1, 1 - 0.04 * 3)).toBeCloseTo(0.5 * 0.88, 10)
    // ④ 真建盘：0 级与不传参逐格一致；满级空地点总量严格更少（逐 seed 有 ±1 取整余量，故看 40 seed 合计）
    for (const depth of [1, 4, 6]) {
      let base = 0
      let maxed = 0
      for (const seed of SEEDS.slice(0, 40)) {
        const g0 = gridOf(depth, seed)
        expect(wormholeMakeGrid(seed, depth, 0, 1), `层 ${depth} · seed ${seed}：0 级必须一字不变`).toEqual(g0)
        base += g0.cells.filter((c) => c.place === 'empty').length
        maxed += wormholeMakeGrid(seed, depth, 0, 0.8).cells.filter((c) => c.place === 'empty').length
      }
      expect(maxed, `层 ${depth}：40 seed 合计空地点 满级 ${maxed} 应少于 0 级 ${base}`).toBeLessThan(base)
    }
  })

  it('同 `(seed, depth)` 仍是**确定性同一张盘**（含星云落在哪几格）', () => {
    for (const depth of [1, 4, 5]) {
      expect(gridOf(depth, 777)).toEqual(gridOf(depth, 777))
    }
  })

  it('**层 1~3 绝不出星云**（船长「四层以上及以上」）', () => {
    for (const depth of [1, 2, 3]) {
      for (const seed of SEEDS) {
        const n = gridOf(depth, seed).cells.filter((c) => c.nebula === true).length
        expect(n, `层 ${depth} · seed ${seed} 不该有星云`).toBe(0)
      }
    }
    expect(WORMHOLE_NEBULA_MIN_DEPTH).toBe(4)
  })

  it('**层 4 起有星云，且只长在"有信号的地点"上**（船长补正：「空地没有星云」）', () => {
    for (const depth of [4, 5, 6, 8]) {
      let seen = 0
      for (const seed of SEEDS) {
        const g = gridOf(depth, seed)
        const nebs = g.cells.filter((c) => c.nebula === true)
        seen += nebs.length
        for (const c of nebs) {
          // 空地不长星云（否则玩家白花一回合才发现"这儿本来就什么都没有"）
          expect(c.place, `层 ${depth} · seed ${seed}：空地点上长了星云`).not.toBe('empty')
          // 下一层入口不长星云（它是导航标记）
          expect(c.key).not.toBe(`${g.exit.q},${g.exit.r}`)
        }
        // 配额与"可长星云的格数"同源：⌈有信号格数（不含入口）× 15%⌉，且最多占一半
        const cands = g.cells.filter((c) => c.place !== 'empty' && c.key !== `${g.exit.q},${g.exit.r}`).length
        const quota = Math.min(Math.ceil(cands * WORMHOLE_NEBULA_SHARE), Math.floor(cands * 0.5))
        expect(nebs.length, `层 ${depth} · seed ${seed} 星云数 ≠ 配额`).toBe(quota)
      }
      // 层 4+ 必须真的常见（不能是 0 配额的摆设）
      expect(seen / SEEDS.length, `层 ${depth} 平均星云数太少`).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('虫洞 · 星云遮蔽与驱散（船长 2026-09-13）', () => {
  /**
   * 造一个"玩家站在星云格**旁边**"的现场。
   *
   * ⚠ 为什么不让玩家站在星云格上：`revealOf` 里 **`visited` 优先**（"到达即真相"是既有口径，
   * 船长 2026-09-13「玩家只有到达目标地点后才能知道目标地点的确切信息」）⇒
   * 站在星云格上会直接读到真相，测不出"遮蔽"。所以玩家留在入口格，星云格改成**已扫描、未到达**
   * （正好对应船长那句"第一次扫描出一个地点时…"）。
   */
  function setupNebula(depth = 4, seed = 4242): { state: GameState; run: WormholeRunState; key: string } {
    const { state, run } = enterForActions()
    const g = wormholeMakeGrid(seed, depth, 0)
    run.depth = depth
    run.grid = g
    const neb = g.cells.find((c) => c.nebula === true)!
    expect(neb, '这张盘上没有星云格').toBeTruthy()
    if (!g.scanned.includes(neb.key)) g.scanned.push(neb.key) // = "第一次扫描出了它"
    return { state, run, key: neb.key }
  }

  it('**第一次扫描只读到"星云"**：`revealOf` 给 `nebula`（信号与地点都不给）', () => {
    const { run, key } = setupNebula()
    const g = run.grid!
    const neb = g.cells.find((c) => c.key === key)!
    const r = revealOf(g, { q: neb.q, r: neb.r })
    expect(r.kind).toBe('nebula')
    expect(isNebulaFogged(g, neb)).toBe(true)
  })

  it('**再扫一次就驱散**：同一圈内第二次扫描把星云驱散、信号随即可读（且只花 1 回合）', () => {
    const { state, run, key } = setupNebula()
    const g = run.grid!
    const neb = g.cells.find((c) => c.key === key)!
    const before = run.turnsLeft
    // 现场：星云格落在扫描圈内、且**已经没有新格可揭**
    // （否则这一扫会顺手去揭新格；那也符合口径，只是要再等一扫描才轮到驱散）
    g.pos = { q: neb.q, r: neb.r }
    for (const c of g.cells) if (c.key !== key) g.scanned.push(c.key)
    const r = wormholeGridScan(state)
    expect(r.ok).toBe(true)
    expect(r.dispersed).toContain(key)
    expect(run.turnsLeft).toBe(before - WORMHOLE_TURN_PER_SCAN)
    // 驱散后：信号可读了（玩家此刻站在这格上 ⇒ `visited` 里没有它时仍走"信号"档）
    const rev = revealOf(g, { q: neb.q, r: neb.r })
    expect(rev.kind).toBe('signal')
    if (rev.kind === 'signal') expect(rev.signal).toBe(signalOfPlace(neb.place))
    expect(isNebulaFogged(g, neb)).toBe(false)
  })

  it('**没有星云可驱散、也没有新格可揭** ⇒ 扫描被拒且**不扣回合**（旧口径不破）', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    for (const c of g.cells) {
      g.scanned.push(c.key)
      c.nebula = false // 手动清掉星云（层 1 本就没有）
    }
    const before = run.turnsLeft
    const r = wormholeGridScan(state)
    expect(r.ok).toBe(false)
    expect(run.turnsLeft).toBe(before)
  })

  it('**到达即真相**（既有口径优先）：星云没驱散，走过去照样知道那儿是什么', () => {
    const { state, run, key } = setupNebula()
    void state
    const g = run.grid!
    const neb = g.cells.find((c) => c.key === key)!
    g.visited.push(key)
    const rev = revealOf(g, { q: neb.q, r: neb.r })
    expect(rev.kind).toBe('known')
    if (rev.kind === 'known') expect(rev.place).toBe(neb.place)
  })

  it('**第一次下到层 4 给一次性提示**：状态随档只给一次；层 1~3 不给', () => {
    const { state, run } = enterForActions()
    // 层 1→2→3：都不该触发
    for (const _ of [1, 2]) {
      run.bossCleared = run.depth
      expect(wormholeDescend(state, 42).ok).toBe(true)
      expect(state.nebulaHintNotice ?? null).toBeNull()
    }
    expect(run.depth).toBe(3)
    // 层 3→4：触发
    run.bossCleared = run.depth
    expect(wormholeDescend(state, 42).ok).toBe(true)
    expect(run.depth).toBe(4)
    expect(state.wormhole.nebulaHintShown).toBe(true)
    expect(state.nebulaHintNotice ?? '').toContain('星云')
    // 清掉不落档的一次性事件后：再深入（层 5）**不再给**
    state.nebulaHintNotice = null
    run.bossCleared = run.depth
    expect(wormholeDescend(state, 42).ok).toBe(true)
    expect(run.depth).toBe(5)
    expect(state.nebulaHintNotice ?? null).toBeNull()
    // 新一趟（跨趟）也不再给
    const second = enterForActions()
    second.state.wormhole.nebulaHintShown = true
    second.run.depth = 4
    second.run.bossCleared = 4
    expect(wormholeDescend(second.state, 42).ok).toBe(true)
    expect(second.state.nebulaHintNotice ?? null).toBeNull()
  })

  it('**随档往返不丢**：`dispersed` / 格的 `nebula` / `nebulaHintShown` 都进档、读回来一模一样', () => {
    const { state, run, key } = setupNebula()
    const g = run.grid!
    const nebCell = g.cells.find((c) => c.key === key)!
    g.pos = { q: nebCell.q, r: nebCell.r }
    for (const c of g.cells) if (c.key !== key) g.scanned.push(c.key)
    expect(wormholeGridScan(state).dispersed).toContain(key)
    state.wormhole.nebulaHintShown = true
    const round = loadSaveFile(serializeSaveFile(state))
    const back = round.state.wormhole.run!.grid!
    expect(back.dispersed).toContain(key)
    expect(back.cells.find((c) => c.key === key)?.nebula).toBe(true)
    expect(round.state.wormhole.nebulaHintShown).toBe(true)
    // 驱散状态真的被带回来了（不是靠"读回后当没驱散"混过去）
    const neb = back.cells.find((c) => c.key === key)!
    expect(isNebulaFogged(back, neb)).toBe(false)
  })

  it('老档没有这两个字段照样能读（零迁移）：不写 `nebula` / `dispersed` 也不报错', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    // 模拟"改造前存下来的盘"：整盘清掉星云与驱散记录
    for (const c of g.cells) delete c.nebula
    delete g.dispersed
    delete state.wormhole.nebulaHintShown
    const round = loadSaveFile(serializeSaveFile(state))
    const back = round.state.wormhole.run!.grid!
    expect(back.dispersed ?? []).toEqual([])
    expect(back.cells.every((c) => c.nebula !== true)).toBe(true)
    expect(round.state.wormhole.nebulaHintShown ?? false).toBe(false)
  })

  it('**信号与地点的真相不受星云影响**（星云只是"看不到"，不是"改了内容"）', () => {
    // 同一 seed/层，星云只影响"看到什么"，不影响盘面内容（拿两张盘比 place 分布）
    const a = wormholeMakeGrid(999, 5, 0)
    const b = wormholeMakeGrid(999, 5, 0)
    expect(a.cells.map((c) => c.place)).toEqual(b.cells.map((c) => c.place))
    // 星云格的 place 都是"有信号的"（再核一遍，防止日后有人把星云改到空地上）
    for (const c of a.cells.filter((x) => x.nebula === true)) {
      expect(c.place).not.toBe('empty')
      expect(signalOfPlace(c.place)).not.toBeNull()
    }
    // 顺带核一下权重表没被本批动过（遗迹下限是"借信号"，不是改权重）
    expect(WORMHOLE_SIGNAL_WEIGHTS.wreck).toBe(28)
    expect(WORMHOLE_RUINS_SHARE).toBe(0.3)
    expect(wormholeGridRadiusFor(5)).toBe(4)
  })

  it('星云格**不挡"前往"**：走到未驱散的星云格不需要额外确认（那儿不等于"未知地点"）', () => {
    const { state, run, key } = setupNebula()
    const g = run.grid!
    const neb = g.cells.find((c) => c.key === key)!
    expect(g.pos.q === neb.q && g.pos.r === neb.r, '玩家恰好站在星云格上（这张盘换 seed 再测）').toBe(false)
    // 已扫描（只是信号被蒙住）≠ 未扫描 ⇒ 不该要 `confirmUnknown`
    const res = wormholeGridTravel(state, { q: neb.q, r: neb.r }, {})
    expect(res.ok, res.error ?? '').toBe(true)
    expect(gridCellAt(g, { q: neb.q, r: neb.r })?.key).toBe(key)
  })
})
