/**
 * **虫洞 · 层内产出与打捞（F3b · 2026-09-13 船长裁定）**。
 *
 * 锁住六组口径（船长原话见设计稿 §11.5）：
 * ① **打捞器门槛**：编队没有打捞器 ⇒ 打捞被拒、**不扣回合、不生成堆**；
 * ② **回收速率**：一次动作（1 回合）回收 = **打捞器台数** 的堆 ⇒ 总回合 = **⌈堆数 ÷ 台数⌉**；
 * ③ **优先稀有**：先拿稀有残骸，回合不够时留下的是普通残骸；
 * ④ **墓场**：普通残骸 3~10 堆 + **每 3 堆普通判一次稀有**（35%）⇒ 稀有 ≤ ⌊普通 ÷ 3⌋；
 * ⑤ **遗迹**：稀有残骸 2~3 堆（**不吃**墓场那条新规则）+ 打捞结束 70% 触发收尾战（层威胁 ×1.3）；
 * ⑥ **舰船信号战果**：打赢固定给残骸 2 堆 + 稀有残骸 1 堆；**矿脉**：虚空母矿 1~3 堆、手拾每堆 1 回合。
 *
 * ⚠ 施工期铁律：虫洞对玩家不可见（入口走调试开关、数据走 `unreleased` 闸门）；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeTakePile } from '../src/wormhole'
import type { WormholeGridCell } from '../src/wormholeGrid'
import { gridCellAt, wormholeStream } from '../src/wormholeGrid'
import { wormholeActivateAt, wormholeTravelTo } from '../src/wormholeBattle'
import {
  WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_GRAVEYARD_COMMONS_MIN,
  WORMHOLE_RARE_JUDGE_PER_COMMONS,
  WORMHOLE_RELIC_CHANCE_CAP,
  WORMHOLE_RUINS_RARES_MAX,
  WORMHOLE_RUINS_RARES_MIN,
  wormholeCellCardIdOf,
  wormholeEnsureSalvagePiles,
  wormholeFamilyPoolGaps,
  wormholeFamilyPoolOf,
  wormholeRelicChanceOf,
  wormholeRollRelic,
  wormholeSalvageAt,
  wormholeSalvagersOf,
} from '../src/wormholeSalvage'
import { rareWreckItemIdOf, wreckItemIdOf } from '../src/salvage'

const ctx = buildSimContext()
/** 巡洋舰（T3，可装打捞器）；`mod-salvager-1` 是打捞器 MK1 */
const T3 = 'sh-thresher'
const RIG = 'mod-salvager-1'

/** 起一趟：`rigs` = 每艘船装几台打捞器（0 = 不带打捞器） */
function enterRun(rigs = 1, seed = 4242): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const a = addShipToFleet(state, T3)
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a], seed).ok).toBe(true)
  if (rigs > 0) {
    // 直接改装配表（打捞器走 low 槽；本文件只验机制，不验装配合法性）
    state.fleet[a]!.fitted = { ...(state.fleet[a]!.fitted ?? {}), low: Array.from({ length: rigs }, () => RIG) }
  }
  return state
}

/** 把玩家挪到**指定地点的格**上（省掉扫描/走路的铺垫） */
function standOn(state: GameState, place: WormholeGridCell['place']): WormholeGridCell {
  const run = state.wormhole.run!
  const grid = run.grid!
  const cell = gridCellAt(grid, grid.pos)!
  cell.place = place
  cell.piles = []
  grid.activated = grid.activated.filter((k) => k !== cell.key)
  return cell
}

describe('虫洞 · 打捞（F3b · 船长口径）', () => {
  it('**打捞器门槛**：编队没有打捞器 ⇒ 拒绝、不扣回合、不生成堆', () => {
    const state = enterRun(0)
    const run = state.wormhole.run!
    expect(wormholeSalvagersOf(state, ctx)).toBe(0)
    const cell = standOn(state, 'graveyard')
    const turnsBefore = run.turnsLeft
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('打捞器')
    expect(run.turnsLeft).toBe(turnsBefore) // 被拒不扣回合
    expect(cell.piles ?? []).toHaveLength(0) // 也没铺堆
  })

  it('**墓场**：普通残骸 3~10 堆、稀有 ≤ ⌊普通 ÷ 3⌋（多趟抽样：上限真的在卡）、堆按"稀有在前"排', () => {
    let sawRare = 0
    let capBinding = 0
    for (let seed = 1; seed <= 60; seed++) {
      const state = enterRun(1, seed)
      const cell = standOn(state, 'graveyard')
      wormholeEnsureSalvagePiles(state, cell)
      const piles = cell.piles!
      const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell)
      const commonId = wreckItemIdOf(cardId)
      const rareId = rareWreckItemIdOf(cardId)
      const commons = piles.filter((p) => p.itemId === commonId).length
      const rares = piles.filter((p) => p.itemId === rareId).length
      const rolls = Math.floor(commons / WORMHOLE_RARE_JUDGE_PER_COMMONS)
      expect(commons, `seed ${seed}`).toBeGreaterThanOrEqual(WORMHOLE_GRAVEYARD_COMMONS_MIN)
      expect(commons, `seed ${seed}`).toBeLessThanOrEqual(WORMHOLE_GRAVEYARD_COMMONS_MAX)
      // **上限真的挂在普通堆数上**（不是"看着像"）：稀有数不可能超过 ⌊普通 ÷ 3⌋
      expect(rares, `seed ${seed}：普通 ${commons} 堆却出了 ${rares} 堆稀有`).toBeLessThanOrEqual(rolls)
      if (rares > 0) {
        sawRare += 1
        // 稀有在最前面（回收从头取 ⇒ "优先打捞稀有残骸"）
        const firstCommon = piles.findIndex((p) => p.itemId === commonId)
        const lastRare = piles.map((p) => p.itemId).lastIndexOf(rareId)
        expect(lastRare).toBeLessThan(firstCommon)
      }
      if (rares === rolls && rolls > 0) capBinding += 1
    }
    expect(sawRare, '60 趟里一次稀有都没出（35% 概率不该如此）').toBeGreaterThan(0)
    expect(capBinding, '60 趟里没有一趟把上限用满 ⇒ 这条上限没被真正验证').toBeGreaterThan(0)
    // **堆数真的在 3~10 上散开**（不是恒取下限）：2026-09-13 踩过的坑——随机流没打散时，
    // 小种子下 LCG 的"第一次输出"恒偏小 ⇒ 堆数永远是最小值 3。这条专门守它。
    const seenCounts = new Set<number>()
    for (let seed = 1; seed <= 60; seed++) {
      const s2 = enterRun(1, seed)
      const c2 = standOn(s2, 'graveyard')
      wormholeEnsureSalvagePiles(s2, c2)
      const card = wormholeCellCardIdOf(s2.wormhole.run!, c2)
      seenCounts.add((c2.piles ?? []).filter((p) => p.itemId === wreckItemIdOf(card)).length)
    }
    expect(seenCounts.size, `60 趟里只见过这些普通堆数：${[...seenCounts].sort((a, b) => a - b).join('/')}`)
      .toBeGreaterThanOrEqual(6)
    // 普通残骸的堆量随层收益系数（基准 200 m³ × 系数 × 0.8~1.2）
    const probe = enterRun(1)
    const probeCell = standOn(probe, 'graveyard')
    wormholeEnsureSalvagePiles(probe, probeCell)
    const sample = probeCell.piles!.find((p) => p.itemId === wreckItemIdOf(wormholeCellCardIdOf(probe.wormhole.run!, probeCell)))!
    expect(sample.units).toBeGreaterThan(100)
    expect(sample.units).toBeLessThan(1000)
  })

  it('**回收速率 = ⌈堆数 ÷ 台数⌉**：4 台打捞器捞 10 堆只用 3 回合（每次动作 1 回合）', () => {
    const state = enterRun(4)
    const run = state.wormhole.run!
    expect(wormholeSalvagersOf(state, ctx)).toBe(4)
    const cell = standOn(state, 'graveyard')
    // 造满 10 堆（普通 10 ⇒ 3 次稀有判断，稀有忽略）
    wormholeEnsureSalvagePiles(state, cell)
    const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell)
    cell.piles = Array.from({ length: 10 }, () => ({ itemId: wreckItemIdOf(cardId), units: 100 }))
    const turnsBefore = run.turnsLeft
    let actions = 0
    while ((cell.piles ?? []).length > 0) {
      const r = wormholeSalvageAt(state, ctx)
      expect(r.ok).toBe(true)
      actions++
      expect(actions).toBeLessThanOrEqual(3)
    }
    expect(actions).toBe(3) // ⌈10 ÷ 4⌉
    expect(run.turnsLeft).toBe(turnsBefore - 3)
    expect(run.bag.length).toBeGreaterThan(0) // 东西进了背包
  })

  it('**遗迹**：稀有残骸 2~3 堆（**不吃**"每 3 堆普通"那条规则）', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = enterRun(1, seed)
      const cell = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell)
      const piles = cell.piles!
      const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell)
      expect(piles.every((p) => p.itemId === rareWreckItemIdOf(cardId))).toBe(true)
      expect(piles.length).toBeGreaterThanOrEqual(WORMHOLE_RUINS_RARES_MIN)
      expect(piles.length).toBeLessThanOrEqual(WORMHOLE_RUINS_RARES_MAX)
    }
  })

  it('**背包放不下**：当场停下、剩下的留在格上（**不静默丢**）、本回合照扣', () => {
    const state = enterRun(2)
    const run = state.wormhole.run!
    const cell = standOn(state, 'graveyard')
    const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell)
    // 塞满背包（每格 500 m³）
    run.bag = [{ itemId: wreckItemIdOf(cardId), units: 100_000 }]
    cell.piles = Array.from({ length: 6 }, () => ({ itemId: wreckItemIdOf(cardId), units: 500 }))
    const turnsBefore = run.turnsLeft
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok).toBe(true)
    expect(r.finished).toBe(false)
    expect(r.left).toBe(6) // 一堆都没进（同一物品并格 ⇒ 直接溢出）
    expect(cell.piles).toHaveLength(6)
    expect(run.turnsLeft).toBe(turnsBefore - 1)
    expect(state.logs.some((l) => l.text.includes('背包放不下'))).toBe(true)
  })

  it('**激活入口走打捞入口**：`wormholeActivateAt` 对墓场格执行打捞（不是"激活一下就没收")', () => {
    const state = enterRun(1)
    const run = state.wormhole.run!
    const cell = standOn(state, 'graveyard')
    const r = wormholeActivateAt(state, ctx)
    expect(r.ok).toBe(true)
    expect(r.spent).toBe(1)
    expect((r.taken ?? 0)).toBeGreaterThan(0) // 一次动作至少回收 1 堆
    expect((cell.piles ?? []).length).toBeGreaterThan(0) // 8~10 堆一次捞不完
    expect(run.bag.length).toBeGreaterThan(0)
  })

  it('**矿脉**：激活即铺 1~3 堆虚空母矿；手拾每堆 1 回合（网格层）', () => {
    const state = enterRun(1)
    const run = state.wormhole.run!
    const cell = standOn(state, 'vein')
    const r = wormholeActivateAt(state, ctx)
    expect(r.ok).toBe(true)
    const piles = cell.piles ?? []
    expect(piles.length).toBeGreaterThanOrEqual(1)
    expect(piles.length).toBeLessThanOrEqual(3)
    expect(piles.every((p) => p.itemId === 'ore-voidmother')).toBe(true)
    const turnsBefore = run.turnsLeft
    // ⚠ 先取快照：`cell.piles` 是**活引用**（拾取会 splice），直接读 `.length` 会在循环里越读越短
    const count = (cell.piles ?? []).length
    for (let i = 0; i < count; i++) {
      const picked = wormholeTakePile(state, ctx, 0)
      expect(picked.ok, `第 ${i + 1} 堆拾取失败：${picked.error ?? ''}`).toBe(true)
    }
    expect((cell.piles ?? []).length).toBe(0)
    expect(run.turnsLeft).toBe(turnsBefore - count) // 手拾每堆 1 回合
    expect(run.bag.some((s) => s.itemId === 'ore-voidmother')).toBe(true)
  })
})

describe('虫洞 · 确定性随机流（2026-09-13 修掉的分布坑）', () => {
  it('`wormholeStream` 的第一输出在整个 [0,1) 上均匀（**不能直接用 LCG 的第一次输出**）', () => {
    const firsts = Array.from({ length: 200 }, (_, i) => wormholeStream(1 + i)())
    expect(Math.min(...firsts)).toBeLessThan(0.1)
    expect(Math.max(...firsts)).toBeGreaterThan(0.9)
    // 小种子下若没打散，全部会挤在 0.2 以下（旧口径的实测现象）
    const low = firsts.filter((v) => v < 0.2).length
    expect(low, `200 个种子里有 ${low} 个第一次输出 < 0.2（均匀应约 20%）`).toBeLessThan(80)
    // 同种子可复现
    expect(wormholeStream(4242)()).toBe(wormholeStream(4242)())
  })
})

describe('虫洞 · 按族掉落池（F3b · 船长「按种族库走」）', () => {
  it('五族池齐（装备 / 装备图纸 / 舰船图纸各非空）——缺一族就报出哪族', () => {
    expect(wormholeFamilyPoolGaps(ctx)).toEqual([])
    for (const f of ['A', 'C', 'D', 'E', 'G']) {
      const pool = wormholeFamilyPoolOf(ctx, f)
      expect(pool.modules.length, `${f} 族专属装备`).toBeGreaterThan(0)
      expect(pool.moduleBlueprints.length, `${f} 族专属装备图纸`).toBeGreaterThan(0)
      expect(pool.shipBlueprints.length, `${f} 族专属舰船图纸`).toBeGreaterThan(0)
      // 池里的东西必须都是"未上线"的（施工期对玩家不可见）
      for (const id of [...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints]) {
        const un =
          ctx.modules.get(id)?.unreleased ?? ctx.blueprints.get(id)?.unreleased ?? ctx.shipBlueprints.get(id)?.unreleased
        expect(un, `${id} 没标 unreleased`).toBe(true)
      }
    }
  })

  it('池是按族分的：A 族的件不会出现在 C 族池里', () => {
    const a = wormholeFamilyPoolOf(ctx, 'A')
    const c = wormholeFamilyPoolOf(ctx, 'C')
    for (const id of a.modules) expect(c.modules.includes(id)).toBe(false)
    for (const id of a.shipBlueprints) expect(c.shipBlueprints.includes(id)).toBe(false)
  })
})

describe('虫洞 · 遗迹收尾战与专属掉落（概率口径的边界）', () => {
  it('收尾战概率 70%：多趟样本里"打"与"不打"都出现过（不是恒定触发/恒定不触发）', () => {
    let battles = 0
    let quiet = 0
    for (let seed = 1; seed <= 24 && (battles === 0 || quiet === 0); seed++) {
      const state = enterRun(4, seed)
      const cell = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell)
      // 把遗迹捞空（台数 4 ⇒ 一批就够 2~3 堆）
      const r = wormholeSalvageAt(state, ctx)
      expect(r.ok).toBe(true)
      expect(r.finished).toBe(true)
      if (r.effect?.kind === 'ruinsBattle') battles += 1
      else quiet += 1
    }
    expect(battles, '24 个种子里一次收尾战都没触发').toBeGreaterThan(0)
    expect(quiet, '24 个种子里次次都触发（概率没生效）').toBeGreaterThan(0)
  })

  it('专属掉落：**层 1 恒不出、层 2 起有几率**（船长 2026-09-13），抽中的东西一定落在本族池里', () => {
    let got: string | undefined
    for (let seed = 1; seed <= 40; seed++) {
      const state = enterRun(4, seed)
      const run = state.wormhole.run!
      // 层 1：恒不出专属
      const cell = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell)
      const r1 = wormholeSalvageAt(state, ctx)
      expect(r1.relics ?? []).toEqual([])
      expect((run.relics ?? []).length).toBe(0)
      // 推到第 2 层再试（直接改层号：只验门槛与池归属，不验走盘）
      run.depth = 2
      const cell2 = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell2)
      const r2 = wormholeSalvageAt(state, ctx)
      if ((r2.relics ?? []).length > 0) {
        got = r2.relics![0]
        const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell2)
        const family = ctx.anomalies.get(cardId)?.foeFamily ?? 'A'
        const pool = wormholeFamilyPoolOf(ctx, String(family))
        expect([...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints]).toContain(got)
        break
      }
    }
    expect(got, '40 个种子里一次专属都没掉（层 2 = 12% 概率不该如此）').toBeTruthy()
  })

  it('**专属概率随层上升**（层 2 < 层 4 < 层 7；层 1 = 0）——实测命中率单调上升', () => {
    // 概率表本身（解析口径）
    expect(wormholeRelicChanceOf(1)).toBe(0)
    expect(wormholeRelicChanceOf(2)).toBeCloseTo(0.12, 6)
    expect(wormholeRelicChanceOf(4)).toBeCloseTo(0.2028, 3)
    expect(wormholeRelicChanceOf(7)).toBeGreaterThan(wormholeRelicChanceOf(4))
    expect(wormholeRelicChanceOf(20)).toBe(WORMHOLE_RELIC_CHANCE_CAP) // 封顶 50%
    // 实测口径：同一种子集在不同层的命中率（各 160 趟）
    const hitRate = (depth: number): number => {
      let hits = 0
      const n = 160
      for (let seed = 1; seed <= n; seed++) {
        const state = enterRun(4, seed)
        const run = state.wormhole.run!
        run.depth = depth
        const cell = standOn(state, 'ruins')
        run.relics = []
        if (wormholeRollRelic(state, ctx, cell).length > 0) hits += 1
      }
      return hits / n
    }
    const r2 = hitRate(2)
    const r4 = hitRate(4)
    const r7 = hitRate(7)
    expect(r2, `层 2 命中率 ${r2}（期望 ≈12%）`).toBeGreaterThan(0.04)
    expect(r4, `层 4 命中率 ${r4}（期望 ≈20%）`).toBeGreaterThan(r2)
    expect(r7, `层 7 命中率 ${r7}（期望 ≈45%）`).toBeGreaterThan(r4)
  })
})

describe('虫洞 · 舰船信号战果（船长：打赢固定给残骸 + 稀有残骸）', () => {
  it('走到舰船信号格即开打（到达即开打）', () => {
    const state = enterRun(1)
    const run = state.wormhole.run!
    const grid = run.grid!
    const here = gridCellAt(grid, grid.pos)!
    // 找一个邻格改成舰船信号并走过去
    const target = grid.cells.find((c) => c.key !== `${grid.pos.q},${grid.pos.r}`)!
    target.place = 'ship'
    grid.scanned.push(target.key)
    const r = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(r.ok).toBe(true)
    expect(r.autoBattle).toBe(true)
    expect(run.battle).not.toBeNull()
  })
})
