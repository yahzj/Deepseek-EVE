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
import { WORMHOLE_ORE_ITEM_ID as COMMON_ORE_FOR_TEST, wormholeEnter } from '../src/wormhole'
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
  WORMHOLE_RARE_CHEST_NOMINAL_ISK,
  wormholeCellCardIdOf,
  wormholeLootTierOf,
  wormholeLootValueIsk,
  wormholeWreckRecycleIskPerM3,
  wormholeEnsureSalvagePiles,
  wormholeEnsureVeinPiles,
  wormholeCollectOreAt,
  wormholeMinersOf,
  wormholeTakePileAt,
  wormholeFamilyPoolGaps,
  wormholeFamilyPoolOf,
  wormholePoolGrantUnitsOf,
  wormholeDeliverRelics,
  wormholeRelicBoxIdOf,
  wormholeRelicChanceOf,
  wormholeRollRelicBox,
  wormholeSalvageAt,
  wormholeSalvagersOf,
} from '../src/wormholeSalvage'
import { RARE_BOX_DRONE_UNITS, rareWreckItemIdOf, wreckItemIdOf } from '../src/salvage'
import { countWare } from '../src/inventory'
import { rackOf } from '../src/labels'

const ctx = buildSimContext()
/** 巡洋舰（T3，可装打捞器）；`mod-salvager-1` 是打捞器 MK1 */
const T3 = 'sh-thresher'
const RIG = 'mod-salvager-1'
/** 采集器 MK1（`slot: 'miner'` · 走 high 槽）——虚空母矿要求编队带它（船长 F5） */
const MINER = 'mod-miner-1'

/** 起一趟：`rigs` = 每艘船装几台打捞器（0 = 不带打捞器）；`miners` = 装几台采集器（0 = 不带） */
function enterRun(rigs = 1, seed = 4242, miners = 0): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const a = addShipToFleet(state, T3)
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a], seed).ok).toBe(true)
  const fitted = { ...(state.fleet[a]!.fitted ?? {}) }
  // 直接改装配表（打捞器与采集器**都走 low 槽** —— 2026-09-13 船长「给作业开」后作业装备归低槽；
  if (rigs > 0) fitted.low = Array.from({ length: rigs }, () => RIG)
  if (miners > 0) fitted.low = [...(fitted.low ?? []), ...Array.from({ length: miners }, () => MINER)]
  state.fleet[a]!.fitted = fitted
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

  it('**矿脉（F5）**：走到就铺 1~3 堆虚空母矿；没采集器挖不动；一次回收 = 台数堆（总回合 ⌈堆数 ÷ 台数⌉）', () => {
    // ① 船长 F5：「资源点和墓场遗迹改为不用激活」⇒ 矿脉不能再靠"激活"铺堆
    //    （"激活"这个入口对矿脉转发到采集；没采集器 ⇒ 报的就是采集器门槛，而不是"激活成功"）
    const bare = enterRun(1)
    const bareRun = bare.wormhole.run!
    const bareCell = standOn(bare, 'vein')
    const turnsBefore0 = bareRun.turnsLeft
    const noAct = wormholeActivateAt(bare, ctx)
    expect(noAct.ok).toBe(false)
    expect(noAct.error ?? '').toMatch(/采集器|不用激活/)
    expect(bareRun.turnsLeft).toBe(turnsBefore0)
    expect(bareCell.piles ?? []).toHaveLength(0)
    // ② 船长 F5：「虚空母矿要求玩家携带采集器」⇒ 只有打捞器也不行，且不扣回合、不铺堆
    expect(wormholeMinersOf(bare, ctx)).toBe(0)
    const denied = wormholeCollectOreAt(bare, ctx)
    expect(denied.ok).toBe(false)
    expect(denied.error ?? '').toContain('采集器')
    expect(bareRun.turnsLeft).toBe(turnsBefore0)
    expect(bareCell.piles ?? []).toHaveLength(0)
    // ②b **逐堆"拾取"这条老路在网格层已退场**（船长 2026-09-13 裁定 A）：只留"采集"这一个入口，
    //    否则 0 采集器的编队照样能把母矿一堆堆搬空，"要求携带采集器"就成了空话。
    wormholeEnsureVeinPiles(bare, bareCell)
    expect((bareCell.piles ?? []).length).toBeGreaterThan(0)
    const handPick = wormholeTakePileAt(bare, ctx, 0)
    expect(handPick.ok).toBe(false)
    expect(handPick.error ?? '').toContain('采集')
    expect(bareRun.turnsLeft).toBe(turnsBefore0) // 被拒 ⇒ 不扣回合
    expect((bareCell.piles ?? []).length).toBeGreaterThan(0) // 堆留在原地
    // ③ 带 2 台采集器：一次动作用 1 回合回收 2 堆 ⇒ 总回合 = ⌈堆数 ÷ 台数⌉（船长裁定 A）
    const sawPiles = new Set<number>()
    for (let seed = 1; seed <= 20; seed++) {
      const state = enterRun(1, seed, 2)
      const run = state.wormhole.run!
      expect(wormholeMinersOf(state, ctx)).toBe(2)
      const cell = standOn(state, 'vein')
      wormholeEnsureVeinPiles(state, cell) // 走到该格即铺（`wormholeEnsureArrivalPiles` 的矿脉分支）
      const total = (cell.piles ?? []).length
      sawPiles.add(total)
      expect(total).toBeGreaterThanOrEqual(1)
      expect(total).toBeLessThanOrEqual(3)
      expect((cell.piles ?? []).every((p) => p.itemId === 'ore-voidmother')).toBe(true)
      const turnsBefore = run.turnsLeft
      const batches: number[] = []
      for (let guard = 0; guard <= 3 && (cell.piles ?? []).length > 0; guard++) {
        // ⚠ 先取快照：`cell.piles` 是**活引用**（回收会 shift），别在断言里连读两次
        const before = (cell.piles ?? []).length
        const r = wormholeCollectOreAt(state, ctx)
        expect(r.ok, `采集失败：${r.error ?? ''}`).toBe(true)
        expect(r.spent).toBe(1)
        expect(r.taken!.length).toBe(Math.min(2, before)) // 一台一堆、上限 = 台数
        batches.push(r.taken!.length)
      }
      expect((cell.piles ?? []).length).toBe(0)
      expect(batches.length).toBe(Math.ceil(total / 2)) // 总回合 = ⌈堆数 ÷ 台数⌉
      expect(run.turnsLeft).toBe(turnsBefore - Math.ceil(total / 2))
      const ore = run.bag.filter((s) => s.itemId === 'ore-voidmother')
      expect(ore.length).toBe(1) // 同类只占一格（叠加）
      expect(ore[0]!.units).toBeGreaterThan(0)
    }
    expect(sawPiles.size, `20 趟只见 ${[...sawPiles].join('/')} 堆：堆数该在 1~3 散开`).toBeGreaterThan(1)
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

describe('虫洞 · 收益估值口径（F3c：残骸的真价值在回收炉）', () => {
  it('普通残骸按**拆解**估值（不是基础价 1 ISK/单位）；母矿仍按基础卖价', () => {
    const common = wreckItemIdOf('wh-pirate-scout')
    expect(wormholeWreckRecycleIskPerM3(ctx, common)).toBeCloseTo(56.8, 1) // common 档：5.8 × 9.8
    expect(wormholeLootValueIsk(ctx, common, 500)).toBeCloseTo(28_420, -2)
    expect(wormholeLootValueIsk(ctx, COMMON_ORE_FOR_TEST, 500)).toBeCloseTo(457_500, -2) // 915 × 500
    // 残骸的**基础价**口径确实接近 0（这就是为什么必须换尺）
    expect(ctx.items.get(common)?.baseSellPriceIsk).toBe(1)
  })

  it('稀有残骸：默认**不含**高级箱名义值（读数用），排序时才计入（丢货用）', () => {
    const rare = rareWreckItemIdOf('wh-pirate-scout')
    const plain = wormholeLootValueIsk(ctx, rare, 30)
    const forDrop = wormholeLootValueIsk(ctx, rare, 30, { rareChestNominal: true })
    expect(plain).toBeGreaterThan(0)
    expect(plain).toBeLessThan(5000) // 只有 30 m³ 的拆解保底
    expect(forDrop - plain).toBe(WORMHOLE_RARE_CHEST_NOMINAL_ISK)
    // 丢货档位：普通残骸（0）先丢 → 原矿（1）→ 稀有残骸（2）最后
    expect(wormholeLootTierOf(rare)).toBe(2)
    expect(wormholeLootTierOf(COMMON_ORE_FOR_TEST)).toBe(1)
    expect(wormholeLootTierOf(wreckItemIdOf('wh-pirate-scout'))).toBe(0)
  })
})
describe('虫洞 · 作业装备的槽位（船长 2026-09-13「给作业开」）', () => {
  /**
   * 船长裁定：采集器与打捞器改归**低槽**（不再跟武器抢高槽）⇒ 满配编队能"火力一点不让 + 两件作业装备都带"。
   * 这条盯**真数据**：`content:check` 里那条 `m.rack === rackOf(m)` 对显式标了 rack 的件是同义反复，
   * 真正防漂移的是这里 + `content:check` 的「作业装备必须归低槽」契约。
   */
  it('真目录里所有采集器 / 打捞器都归**低槽**，且推导（无显式 rack 时）也是低槽', () => {
    const work = [...ctx.modules.values()].filter((m) => m.slot === 'miner' || m.slot === 'salvager')
    expect(work.length, '作业装备件数').toBeGreaterThan(0)
    for (const m of work) {
      expect(rackOf(m), `${m.id}（${m.slot}）的归槽`).toBe('low')
    }
    // 缺省 rack 的件（测试替身那种只有 slot 的定义）也要推成低槽
    expect(rackOf({ slot: 'miner' })).toBe('low')
    expect(rackOf({ slot: 'salvager' })).toBe('low')
    // 对照：炮台照旧高槽（这条裁定只管作业装备）
    expect(rackOf({ slot: 'turret' })).toBe('high')
  })

  it('**满配可查**：长尾鲨级（高 5 / 中 4 / 低 2）能把 11 个槽插满且不吃超 CPU', () => {
    const ship = ctx.ships.get('sh-thresher')!
    const fit = {
      high: Array.from({ length: 5 }, () => 'mod-turret-kin-2'),
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: ['mod-salvager-3', 'mod-miner-3'],
    }
    let cpu = 0
    for (const [rack, ids] of Object.entries(fit) as Array<[keyof typeof fit, string[]]>) {
      const cap = ship.slots?.[rack] ?? 0
      expect(ids.length, `${rack} 槽用量`).toBeLessThanOrEqual(cap)
      for (const id of ids) {
        expect(rackOf(ctx.modules.get(id)!), `${id} 归槽`).toBe(rack)
        cpu += ctx.modules.get(id)?.cpuUse ?? 0
      }
    }
    expect(cpu, `满配 CPU ${cpu} / 船体 ${ship.cpu}`).toBeLessThanOrEqual(ship.cpu ?? 0)
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

  /**
   * **族专属无人机是 C/E 两族的"第 6 件替换物"**（2026-09-13 二号接线单 · 专属稿 §6.1）：
   * C 移除「活性甲壳层」、E 移除「巨构稳态器」，由两型专属无人机替换 ⇒ 只有这两族有。
   */
  it('**族专属无人机只归 C/E**（替换物）；不进"五族齐备"判据；一族一件、件数净增为 0', () => {
    expect(ctx.items.has('drone-wh-c-heavy')).toBe(true)
    expect(ctx.items.has('drone-wh-e-sentry')).toBe(true)
    const c = wormholeFamilyPoolOf(ctx, 'C')
    const e = wormholeFamilyPoolOf(ctx, 'E')
    expect(c.drones).toEqual(['drone-wh-c-heavy'])
    expect(e.drones).toEqual(['drone-wh-e-sentry'])
    for (const f of ['A', 'D', 'G']) expect(wormholeFamilyPoolOf(ctx, f).drones, `${f} 族不该有专属无人机`).toEqual([])
    // **五族齐备判据不看无人机**（只有两族有 ⇒ 查它会把 A/D/G 判成空池）
    expect(wormholeFamilyPoolGaps(ctx)).toEqual([])
    // **替换关系**：装备件数 + 无人机件数 = 6（其余三族各 6 件装备）
    for (const f of ['A', 'C', 'D', 'E', 'G']) {
      const p = wormholeFamilyPoolOf(ctx, f)
      expect(p.modules.length + p.drones.length, `${f} 族「装备 + 无人机」件数`).toBe(6)
    }
    // 无人机也是施工期内容（对玩家不可见）
    for (const id of [...c.drones, ...e.drones]) expect(ctx.items.get(id)?.unreleased, `${id} 没标 unreleased`).toBe(true)
  })

  it('**一次到手几件**：族专属无人机 ×10 架（与窝点同款），其余池内容物 1 件', () => {
    expect(wormholePoolGrantUnitsOf('drone-wh-c-heavy')).toBe(10)
    expect(wormholePoolGrantUnitsOf('drone-wh-e-sentry')).toBe(RARE_BOX_DRONE_UNITS)
    expect(wormholePoolGrantUnitsOf('box-relic-c')).toBe(1)
    expect(wormholePoolGrantUnitsOf('mod-wh-a-coat')).toBe(1)
  })
})

describe('虫洞 · 撤离交付（F4 货柜 / 池内容的入库链路）', () => {
  it('**货柜与无人机都进仓库**：模块进装备库、图纸进书架、物品按"一次几件"入仓', () => {
    const state = enterRun(1)
    // ① 物品（F4 的「遗迹安全货柜」是物品，不是模块 ⇒ 早先这条链会把它静默丢掉）
    const boxDelivered = wormholeDeliverRelics(state, ctx, ['box-relic-c'])
    expect(boxDelivered).toEqual(['遗迹安全货柜（异形）×1'])
    expect(countWare(state, 'box-relic-c')).toBe(1)
    // ② 族专属无人机：一次 10 架
    const droneDelivered = wormholeDeliverRelics(state, ctx, ['drone-wh-e-sentry'])
    expect(droneDelivered).toEqual(['构件哨戒无人机×10'])
    expect(countWare(state, 'drone-wh-e-sentry')).toBe(10)
    // ③ 老口径照旧：装备进装备库、一次性图纸进蓝图书架
    const modId = wormholeFamilyPoolOf(ctx, 'A').modules[0]!
    const bpId = wormholeFamilyPoolOf(ctx, 'A').moduleBlueprints[0]!
    wormholeDeliverRelics(state, ctx, [modId, bpId])
    expect(state.blueprintStock[bpId]).toBe(1)
    expect(ctx.modules.has(modId)).toBe(true)
    // ④ 认不出的 id 不炸、也不入账（静默跳过）
    expect(wormholeDeliverRelics(state, ctx, ['没有这个 id'])).toEqual([])
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
        // **F4 起：掉的是一个「安全货柜」，按族命名**（内容物等拆解时才揭）
        const cardId = wormholeCellCardIdOf(state.wormhole.run!, cell2)
        const family = String(ctx.anomalies.get(cardId)?.foeFamily ?? 'A')
        expect(got).toBe(wormholeRelicBoxIdOf(family))
        // 且它**散落在该格**（没直接进背包/relics）
        expect((cell2.piles ?? []).some((pp) => pp.itemId === got)).toBe(true)
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
        if (wormholeRollRelicBox(state, ctx, cell) !== undefined) hits += 1
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
