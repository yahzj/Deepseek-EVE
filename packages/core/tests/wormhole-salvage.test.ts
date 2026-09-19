/**
 * **虫洞 · 层内产出与打捞（F3b · 2026-09-13 船长裁定）**。
 *
 * 锁住六组口径（船长原话见设计稿 §11.5）：
 * ① **打捞器门槛**：编队没有打捞器 ⇒ 打捞被拒、**不扣回合、不生成堆**；
 * ② **回收速率**：一次动作（1 回合）回收 = **打捞器台数** 的堆 ⇒ 总回合 = **⌈堆数 ÷ 台数⌉**；
 * ③ **优先稀有**：先拿稀有残骸，回合不够时留下的是普通残骸；
 * ④ **墓场**：普通残骸 3~10 堆 + **每 3 堆普通判一次稀有**（35%）⇒ 稀有 ≤ ⌊普通 ÷ 3⌋；
 * ⑤ **遗迹**：稀有残骸 2~3 堆（**不吃**墓场那条新规则）+ **首次打捞**时结算三个掷点：
 *    遗迹安全货柜 70%（层 2 起）· AI 核心 10% · 惊扰守卫当场开战（2026-09-16 船长
 *    「**时间点改为遗迹第一次打捞**」——改前是"打捞完"那一拍，见本文件「遗迹掉落时机」describe）；
 * ⑥ **舰船信号战果**：打赢固定给残骸 2 堆 + 稀有残骸 1 堆；**矿脉**：虚空母矿 1~3 堆、手拾每堆 1 回合。
 *
 * ✅ 2026-09-14 船长解除不可见（入口常驻、数据全部上线、公开就叫「虫洞」）；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { WORMHOLE_ORE_ITEM_ID as COMMON_ORE_FOR_TEST, WORMHOLE_TEMP_CELLS, WORMHOLE_TEMP_COLS, wormholeEnter, wormholeGridScan } from '../src/wormhole'
import type { WormholeGridCell } from '../src/wormholeGrid'
import { gridCellAt, wormholeStream } from '../src/wormholeGrid'
import { wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import {
  WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_GRAVEYARD_COMMONS_MIN,
  WORMHOLE_RARE_JUDGE_PER_COMMONS,
  WORMHOLE_RELIC_BOX_CHANCE,
  WORMHOLE_RUINS_RARES_MAX,
  WORMHOLE_RUINS_RARES_MIN,
  WORMHOLE_RARE_CHEST_NOMINAL_ISK,
  WORMHOLE_SALVAGE_BOX_CHANCE,
  WORMHOLE_SALVAGE_BOX_MAX,
  WORMHOLE_BP_BOX_IDS,
  wormholeRollSalvageBox,
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
  wormholeRelicBoxPoolOf,
  wormholeRelicChanceOf,
  wormholeRollRelicBox,
  wormholeSalvageAt,
  wormholeSalvagersOf,
  wormholeHoldSyncCargo,
  wormholeHoldUsage,
  wormholeHoldDiscard,
  wormholeHoldStow,
  wormholeTempUsage,
  wormholeTempPending,
  wormholeActionBlockReason,
  wormholeTempBoard,
  wormholeHoldCapacityOf,
  wormholeTempStowPiece,
  wormholeTempDiscardPiece,
  wormholeTempStowAll,
  wormholeTempDiscardAll,
  wormholeNormalizeLegacyTemp,
} from '../src/wormholeSalvage'
import { holdAdd, holdTransferTo, makeHoldState } from '../src/wormholeHold'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { RARE_BOX_DRONE_UNITS, rareWreckItemIdOfCard, wreckItemIdOfCard } from '../src/salvage'
import { countWare } from '../src/inventory'
import { rackOf } from '../src/labels'

const ctx = buildSimContext()
/** 2026-09-19 残骸合并：卡 id → 该卡所属组的残骸物品 id（例：`wh-pirate-scout` → `wreck-a-wh`） */
const commonWreckOf = (cardId: string): string => wreckItemIdOfCard(cardId)!
const rareWreckOf = (cardId: string): string => rareWreckItemIdOfCard(cardId)!
/** 形状件样本（2026-09-15：安全货柜 4 格 → **6 格（3×2）**，本文件的「形状件」口径改用同批新增的
 *  **军用备货柜**（正好 2×2 = 4 格）；安全货柜的新规格见 wormhole-hold 的形状表用例） */
const BOX_FOR_TEST = 'box-military'
/** 巡洋舰（T3，可装打捞器）；`mod-salvager-1` 是打捞器 MK1 */
const T3 = 'sh-thresher'
const RIG = 'mod-salvager-1'
/** 采集器 MK1（`slot: 'miner'` · 走 high 槽）——虚空母矿要求编队带它（船长 F5） */
const MINER = 'mod-miner-1'

/**
 * 起一趟：`rigs` = **每艘船**装几台打捞器（0 = 不带打捞器）；`miners` = 每艘装几台采集器（0 = 不带）；
 * `ships` = 编队艘数（货仓格数 = ⌊艘数 × 2600 ÷ 500⌋ ⇒ 1 艘 5 格、2 艘 10 格 —— 2×2 货柜要 10 格才有落点）。
 */
function enterRun(rigs = 1, seed = 4242, miners = 0, ships = 1): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < Math.max(1, ships); i++) ids.push(addShipToFleet(state, T3))
  const a = ids[0]!
  state.shipId = a
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  for (const uid of ids) {
    const fitted = { ...(state.fleet[uid]!.fitted ?? {}) }
    // 直接改装配表（打捞器与采集器**都走 high 槽** —— 2026-09-14 船长「改回高槽」后作业装备归高槽）
    if (rigs > 0) fitted.high = Array.from({ length: rigs }, () => RIG)
    if (miners > 0) fitted.high = [...(fitted.high ?? []), ...Array.from({ length: miners }, () => MINER)]
    state.fleet[uid]!.fitted = fitted
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
      const commonId = commonWreckOf(cardId)
      const rareId = rareWreckOf(cardId)
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
      seenCounts.add((c2.piles ?? []).filter((p) => p.itemId === commonWreckOf(card)).length)
    }
    expect(seenCounts.size, `60 趟里只见过这些普通堆数：${[...seenCounts].sort((a, b) => a - b).join('/')}`)
      .toBeGreaterThanOrEqual(6)
    // 普通残骸的堆量随层收益系数（基准 200 m³ × 系数 × 0.8~1.2）
    const probe = enterRun(1)
    const probeCell = standOn(probe, 'graveyard')
    wormholeEnsureSalvagePiles(probe, probeCell)
    const sample = probeCell.piles!.find((p) => p.itemId === commonWreckOf(wormholeCellCardIdOf(probe.wormhole.run!, probeCell)))!
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
    cell.piles = Array.from({ length: 10 }, () => ({ itemId: commonWreckOf(cardId), units: 100 }))
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
      expect(piles.every((p) => p.itemId === rareWreckOf(cardId))).toBe(true)
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
    run.bag = [{ itemId: commonWreckOf(cardId), units: 100_000 }]
    cell.piles = Array.from({ length: 6 }, () => ({ itemId: commonWreckOf(cardId), units: 500 }))
    const turnsBefore = run.turnsLeft
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok).toBe(true)
    expect(r.finished).toBe(false)
    expect(r.left).toBe(6) // 一堆都没进（同一物品并格 ⇒ 直接溢出）
    expect(cell.piles).toHaveLength(6)
    expect(run.turnsLeft).toBe(turnsBefore - 1)
    expect(state.logs.some((l) => l.text.includes('货仓放不下'))).toBe(true)
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
    const common = commonWreckOf('wh-pirate-scout')
    expect(wormholeWreckRecycleIskPerM3(ctx, common)).toBeCloseTo(56.8, 1) // common 档：5.8 × 9.8
    expect(wormholeLootValueIsk(ctx, common, 500)).toBeCloseTo(28_420, -2)
    expect(wormholeLootValueIsk(ctx, COMMON_ORE_FOR_TEST, 500)).toBeCloseTo(457_500, -2) // 915 × 500
    // 残骸的**基础价**口径确实接近 0（这就是为什么必须换尺）
    expect(ctx.items.get(common)?.baseSellPriceIsk).toBe(1)
  })

  it('稀有残骸：默认**不含**高级箱名义值（读数用），排序时才计入（丢货用）', () => {
    const rare = rareWreckOf('wh-pirate-scout')
    const plain = wormholeLootValueIsk(ctx, rare, 30)
    const forDrop = wormholeLootValueIsk(ctx, rare, 30, { rareChestNominal: true })
    expect(plain).toBeGreaterThan(0)
    expect(plain).toBeLessThan(5000) // 只有 30 m³ 的拆解保底
    expect(forDrop - plain).toBe(WORMHOLE_RARE_CHEST_NOMINAL_ISK)
    // 丢货档位：普通残骸（0）先丢 → 原矿（1）→ 稀有残骸（2）最后
    expect(wormholeLootTierOf(rare)).toBe(2)
    expect(wormholeLootTierOf(COMMON_ORE_FOR_TEST)).toBe(1)
    expect(wormholeLootTierOf(commonWreckOf('wh-pirate-scout'))).toBe(0)
  })
})
describe('虫洞 · 作业装备的槽位（船长 2026-09-14「改回高槽」）', () => {
  /**
   * 船长裁定：采集器与打捞器归**高槽**（2026-09-13 的「给作业开」低槽口径作废 —— 低槽口径下
   * 作业装备混进低槽组，与装甲/货舱错位，船长实测判定为 BUG）。
   * 这条盯**真数据**：`content:check` 里那条 `m.rack === rackOf(m)` 对显式标了 rack 的件是同义反复，
   * 真正防漂移的是这里 + `content:check` 的「作业装备必须归高槽」契约。
   */
  it('真目录里所有采集器 / 打捞器都归**高槽**，且推导（无显式 rack 时）也是高槽', () => {
    const work = [...ctx.modules.values()].filter((m) => m.slot === 'miner' || m.slot === 'salvager')
    expect(work.length, '作业装备件数').toBeGreaterThan(0)
    for (const m of work) {
      expect(rackOf(m), `${m.id}（${m.slot}）的归槽`).toBe('high')
    }
    // 缺省 rack 的件（测试替身那种只有 slot 的定义）也要推成高槽
    expect(rackOf({ slot: 'miner' })).toBe('high')
    expect(rackOf({ slot: 'salvager' })).toBe('high')
    // 对照：炮台照旧高槽、装甲照旧低槽（这条裁定只把作业装备放回高槽）
    expect(rackOf({ slot: 'turret' })).toBe('high')
    expect(rackOf({ slot: 'armor' })).toBe('low')
  })

  it('**满配可查**：长尾鲨级（高 5 / 中 4 / 低 2）能把 11 个槽插满且不吃超 CPU', () => {
    const ship = ctx.ships.get('sh-thresher')!
    const fit = {
      // 作业装备回高槽 ⇒ 与火力同槽：3×炮台 + 打捞器 MK3 + 采集器 MK3（高槽 5 位占满）
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
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
      // 2026-09-14 虫洞上线（船长「解除不可见」）⇒ 池里的东西**必须都已上线**（当年这里钉的是"必须未上线"）
      for (const id of [...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints]) {
        const un =
          ctx.modules.get(id)?.unreleased ?? ctx.blueprints.get(id)?.unreleased ?? ctx.shipBlueprints.get(id)?.unreleased
        expect(un, `${id} 仍标着 unreleased（虫洞已上线，图鉴/组装机该看得到它）`).toBeUndefined()
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
    // 无人机同样已上线（2026-09-14 解除不可见）
    for (const id of [...c.drones, ...e.drones]) {
      expect(ctx.items.get(id)?.unreleased, `${id} 仍标着 unreleased`).toBeUndefined()
    }
  })

  it('**一次到手几件**：族专属无人机 ×10 架（与窝点同款），其余池内容物 1 件', () => {
    expect(wormholePoolGrantUnitsOf('drone-wh-c-heavy')).toBe(10)
    expect(wormholePoolGrantUnitsOf('drone-wh-e-sentry')).toBe(RARE_BOX_DRONE_UNITS)
    expect(wormholePoolGrantUnitsOf('box-relic-c')).toBe(1)
    expect(wormholePoolGrantUnitsOf('mod-wh-a-coat')).toBe(1)
  })
})

/** 摆一格「只堆着货柜」的遗迹（等价打捞结束后的现场）——顶层版，多个 describe 共用 */
function ruinsWithBoxIn(state: GameState, family = 'A'): WormholeGridCell {
  const run = state.wormhole.run!
  const grid = run.grid!
  const cell = gridCellAt(grid, grid.pos)!
  cell.place = 'ruins'
  // 2026-09-15：安全货柜 4 格 → 6 格（3×2）⇒ 本 helper（临时空间那批用例共用的形状件口径）
  //   改用同批新增的**军用备货柜**（正好 2×2 = 4 格），使「32 格 = 8 件」等容量推算继续成立；
  //   安全货柜的新规格由下面的搬运 describe 与形状表用例覆盖。
  cell.piles = [{ itemId: BOX_FOR_TEST, units: 1 }]
  void family
  grid.activated = grid.activated.filter((k) => k !== cell.key)
  return cell
}
describe('虫洞 · 遗迹安全货柜的搬运（船长 F4：「放不下整件拒收」；2026-09-15 改规格为 3000 m³ = 3×2 = 6 格）', () => {
  /** 摆一格"只堆着货柜"的遗迹（等价打捞结束后的现场） */
  function ruinsWithBox(state: GameState, family = 'A'): WormholeGridCell {
    const run = state.wormhole.run!
    const grid = run.grid!
    const cell = gridCellAt(grid, grid.pos)!
    cell.place = 'ruins'
    cell.piles = [{ itemId: wormholeRelicBoxIdOf(family), units: 1 }]
    grid.activated = grid.activated.filter((k) => k !== cell.key)
    return cell
  }

  it('**打捞器搬不动货柜**：打捞不会把它塞进背包（否则只占 1 格、丢了 2×2 形状）', () => {
    const state = enterRun(1) // 1 台打捞器
    const run = state.wormhole.run!
    const cell = ruinsWithBox(state)
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok).toBe(true)
    expect(r.taken?.length ?? 0).toBe(0) // 一件也没搬走
    expect(run.bag, '货柜不该进散货账本').toEqual([])
    expect((cell.piles ?? []).map((p) => p.itemId)).toEqual([wormholeRelicBoxIdOf('A')]) // 留在原地
    // 日志要点明"要自己拾取"
    expect(state.logs.map((l) => l.text).some((t) => t.includes('自己拾取装舱'))).toBe(true)
  })

  it('**拾取装舱**：占 3×2 = 6 格（2026-09-15 船长「将安全货柜大小增加到6格」）、进的是货仓格（不是散货条）', () => {
    const state = enterRun(1, 4242, 0, 3) // **3 艘 ⇒ 15 格**（2 艘的 10 格 = 8+2，末行只有 2 格 ⇒ 3×2 放不下）
    const run = state.wormhole.run!
    const cell = ruinsWithBox(state)
    const pick = wormholeTakePileAt(state, ctx, 0)
    expect(pick.ok, pick.error ?? '').toBe(true)
    const placed = run.hold!.placements.filter((p) => p.kind === 'box')
    expect(placed.length).toBe(1)
    expect([placed[0]!.w, placed[0]!.h]).toEqual([3, 2]) // 方块（6 格），不是货条
    const usage = wormholeHoldUsage(state, ctx)
    expect(usage.shapeCells).toBe(6) // 6 格（不是 1 格）
    expect(usage.cargoCells).toBe(0)
    expect((cell.piles ?? []).length).toBe(0) // 搬走了
  })

  it('**货仓整件拒收仍在**：`wormholeHoldStow` 腾不出整块 3×2 = 6 格 ⇒ 拒绝（临时空间是外一层的兜底）', () => {
    const state = enterRun(1, 4242, 0, 3) // 3 艘 ⇒ 15 格：装得下**两件** 6 格货柜（12 格），第三件必须拒收
    const run = state.wormhole.run!
    const cell = ruinsWithBox(state, 'A')
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true) // 第一件放得下
    expect(wormholeHoldStow(state, ctx, wormholeRelicBoxIdOf('C')).ok).toBe(true) // 第二件也放得下（12 ≤ 15）
    // **货仓这一层照旧整件拒收**（不塞散货账本、不硬挤缝）：状态不变
    const stow = wormholeHoldStow(state, ctx, wormholeRelicBoxIdOf('C'))
    expect(stow.ok).toBe(false)
    expect(stow.error ?? '').toMatch(/放不下|装不下/)
    expect(run.hold!.placements.filter((p) => p.kind === 'box').length).toBe(2) // 只装上了两件
    expect(run.bag).toEqual([]) // 没被偷偷塞进散货
    // 打捞/拾取走的是**外层阶梯**：这一件改去临时空间，不再是"整件拒收"
    cell.piles = [{ itemId: wormholeRelicBoxIdOf('C'), units: 1 }]
    const pick = wormholeTakePileAt(state, ctx, 0)
    expect(pick.ok, pick.error ?? '').toBe(true)
    expect(wormholeTempUsage(state, ctx).placements.map((p) => p.itemId)).toEqual([wormholeRelicBoxIdOf('C')])
    expect((cell.piles ?? []).length).toBe(0)
  })

  it('**普通堆仍不许逐堆拾取**（船长裁定 A 照旧）：残骸在网格层只能打捞', () => {
    const state = enterRun(1)
    const grid = state.wormhole.run!.grid!
    const cell = gridCellAt(grid, grid.pos)!
    cell.place = 'graveyard'
    cell.piles = [{ itemId: commonWreckOf('wh-pirate-scout'), units: 200 }]
    const pick = wormholeTakePileAt(state, ctx, 0)
    expect(pick.ok).toBe(false)
    expect(pick.error ?? '').toContain('打捞')
    expect((cell.piles ?? []).length).toBe(1)
  })
})

describe('虫洞 · 临时空间（船长 2026-09-13：「大件货先进临时空间，让玩家协调」）', () => {
  it('**收货阶梯**：货仓放得下 ⇒ 进货仓；腾不出 2×2 ⇒ 进临时空间（不留在原地）', () => {
    // ① 2 艘（10 格）⇒ 2×2 放得下 ⇒ 进货仓格
    const a = enterRun(1, 4242, 0, 2)
    const cellA = ruinsWithBoxIn(a)
    expect(wormholeTakePileAt(a, ctx, 0).ok).toBe(true)
    expect(a.wormhole.run!.hold!.placements.filter((p) => p.kind === 'box').length).toBe(1)
    expect(a.wormhole.run!.temp ?? []).toEqual([])
    expect((cellA.piles ?? []).length).toBe(0)
    // ② 先塞一件把 2×2 位置站掉 ⇒ 第二件进临时空间
    const b = enterRun(1, 4242, 0, 2)
    const cellB = ruinsWithBoxIn(b, 'A')
    expect(wormholeTakePileAt(b, ctx, 0).ok).toBe(true)
    cellB.piles = [{ itemId: BOX_FOR_TEST, units: 1 }]
    const second = wormholeTakePileAt(b, ctx, 0)
    expect(second.ok, second.error ?? '').toBe(true) // **不再整件拒收**：改走临时空间
    const tempB = wormholeTempUsage(b, ctx)
    expect(tempB.placements.map((p) => p.itemId)).toEqual([BOX_FOR_TEST])
    expect(tempB.cells).toBe(4) // 货柜在临时空间里同样按 4 格算
    expect(tempB.capacity).toBe(WORMHOLE_TEMP_CELLS) // 4 列 × 8 行 = 32 格（船长 2026-09-14）
    expect((cellB.piles ?? []).length).toBe(0) // 已经接住，不留在原地
    expect(b.logs.map((l) => l.text).some((t) => t.includes('放进临时空间'))).toBe(true)
  })

  it('**临时空间也有上限**（32 格 = 8 件货柜）：装满后连拾取都被拦', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    const cell = ruinsWithBoxIn(state, 'A')
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true) // 第 1 件 → 货仓格（10 格只放得下这一个 2×2）
    /**
     * ⚠ **2026-09-14 起临时空间有东西就封锁其他操作** ⇒ 不能再靠"一件一件拾取"把临时空间灌满
     * （第 2 件落进去之后，第 3 次拾取会被闸拦下）。这里**直接摆满** 8 件货柜来验容量上限。
     */
    const board = wormholeTempBoard(run)
    for (let i = 0; i < 8; i++) {
      const r = holdAdd(board, BOX_FOR_TEST, WORMHOLE_TEMP_CELLS)
      expect(r.ok, `第 ${i + 1} 件应摆得下`).toBe(true)
    }
    expect(wormholeTempUsage(state, ctx).cells).toBe(WORMHOLE_TEMP_CELLS)
    expect(wormholeTempUsage(state, ctx).placements).toHaveLength(8)
    // 第 9 件：收货阶梯第二层没位置 ⇒ 失败（这里是**动作闸**先拦：临时空间非空就不许再装）
    cell.piles = [{ itemId: BOX_FOR_TEST, units: 1 }]
    const last = wormholeTakePileAt(state, ctx, 0)
    expect(last.ok).toBe(false)
    expect(last.error ?? '').toMatch(/临时空间/)
    expect((cell.piles ?? []).length).toBe(1) // 留在原地等腾地方
    expect(holdAdd(board, BOX_FOR_TEST, WORMHOLE_TEMP_CELLS).ok).toBe(false) // 真的满了
  })

  it('**整理**：临时空间里的货柜能放进货仓（腾出位置后），也能直接丢弃', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    const cell = ruinsWithBoxIn(state, 'A')
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true)
    cell.piles = [{ itemId: BOX_FOR_TEST, units: 1 }]
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true) // → 临时空间
    const boxC = BOX_FOR_TEST
    const piece = run.tempGrid!.placements[0]!
    expect(piece.itemId).toBe(boxC)
    // 货仓没位置 ⇒ 放回失败、东西还在临时空间
    const fail = wormholeTempStowPiece(state, ctx, piece.id)
    expect(fail.ok).toBe(false)
    expect(run.tempGrid!.placements.map((p) => p.itemId)).toEqual([boxC])
    // 抛掉货仓里那件（腾出 2×2）⇒ 放回成功
    const boxA = run.hold!.placements.find((p) => p.kind === 'box')!
    expect(wormholeHoldDiscard(state, ctx, boxA.id).ok).toBe(true)
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(true)
    expect(run.tempGrid!.placements).toEqual([])
    expect(run.hold!.placements.filter((p) => p.kind === 'box').map((p) => p.itemId)).toEqual([boxC])
    // 「丢弃」那条路也通（这里临时空间已空 ⇒ 拒绝）
    expect(wormholeTempDiscardPiece(state, ctx, piece.id).ok).toBe(false)
  })

  it('**散货也能寄存在临时空间**：不产生"放不下"、也不算超载（数量账本仍是 bag）', () => {
    const state = enterRun(1, 4242, 0, 2) // 10 格
    const run = state.wormhole.run!
    run.bag = [{ itemId: 'ore-voidmother', units: 10 * 500 }] // 10 格货 ⇒ 正好占满货仓
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    // 把 1 件挪到临时空间 ⇒ 货仓剩 9 格、临时空间 1 格，两边都不算"放不下"、也不超载
    const piece = run.hold!.placements.find((p) => p.kind === 'cargo')!
    const moved = holdTransferTo(run.hold!, (run.tempGrid = makeHoldState(WORMHOLE_TEMP_COLS)), piece.id, WORMHOLE_TEMP_CELLS)
    expect(moved.ok, moved.error ?? '').toBe(true)
    expect(wormholeTempUsage(state, ctx).cells).toBe(1)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    expect(wormholeHoldUsage(state, ctx).overload).toBe(false)
    // 再同步一次（等价于一次拾取）：件不会被重铺回货仓、也不会多出来
    wormholeHoldSyncCargo(state, ctx)
    expect(wormholeTempUsage(state, ctx).cells).toBe(1)
    expect(run.hold!.placements.filter((p) => p.kind === 'cargo')).toHaveLength(9)
    // 丢弃那一件 ⇒ **数量账本同步减 1 格**（否则下次 sync 会把它铺回来）
    const inTemp = run.tempGrid!.placements[0]!
    expect(wormholeTempDiscardPiece(state, ctx, inTemp.id).ok).toBe(true)
    wormholeHoldSyncCargo(state, ctx)
    expect(run.bag[0]!.units).toBe(9 * 500)
    expect(wormholeTempUsage(state, ctx).cells).toBe(0)
    expect(run.hold!.placements.filter((p) => p.kind === 'cargo')).toHaveLength(9)
  })

  it('**临时空间有东西 = 封锁其他操作**（船长 2026-09-14：「和之前的超载类似」）', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    const cell = ruinsWithBoxIn(state, 'A')
    // 现场：货仓一件（占满唯一的 2×2 位）+ 临时空间一件（直接摆 —— 非空之后就不能再靠拾取装货了）
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true)
    expect(holdAdd(wormholeTempBoard(run), BOX_FOR_TEST, WORMHOLE_TEMP_CELLS).ok).toBe(true)
    expect(wormholeTempPending(state, ctx).count).toBe(1)
    // ① 动作闸给出**临时空间**的理由（不是"超载"）
    const reason = wormholeActionBlockReason(state, ctx)
    expect(reason ?? '').toContain('临时空间')
    expect(reason ?? '').not.toContain('超载')
    // ② 扫描 / 前往 / 激活（打捞·开战）/ 拾取 一律被拦
    expect(wormholeGridScan(state).ok).toBe(false)
    expect(wormholeTravelTo(state, ctx, { q: 0, r: 0 }, { confirmUnknown: true }).ok).toBe(false)
    expect(wormholeActivateAt(state, ctx).ok).toBe(false)
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(false)
    // ③ 清空临时空间（丢弃）⇒ 立刻放行
    expect(wormholeTempDiscardAll(state, ctx).moved).toBe(1)
    expect(wormholeActionBlockReason(state, ctx)).toBeNull()
    expect(wormholeGridScan(state).ok).toBe(true)
    expect(cell.place).toBe('ruins')
  })

  it('**离页必须先清空**：pending 读数 + 「全部放回」「全部丢弃」两条出路', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    // 直接摆：货仓一件 + 临时空间两件（非空之后其他操作都被闸拦，故不走拾取）
    run.hold = run.hold ?? makeHoldState()
    expect(holdAdd(run.hold, BOX_FOR_TEST, wormholeHoldCapacityOf(state, ctx)).ok).toBe(true)
    const board = wormholeTempBoard(run)
    expect(holdAdd(board, BOX_FOR_TEST, WORMHOLE_TEMP_CELLS).ok).toBe(true)
    expect(holdAdd(board, BOX_FOR_TEST, WORMHOLE_TEMP_CELLS).ok).toBe(true)
    expect(wormholeTempPending(state, ctx).count).toBe(2)
    // 「全部放回」：先抛掉货仓那件腾出 2×2 ⇒ 只能放回 1 件，剩 1 件卡住（件留在临时空间）
    const boxA = run.hold!.placements.find((p) => p.kind === 'box')!
    expect(wormholeHoldDiscard(state, ctx, boxA.id).ok).toBe(true)
    const stow = wormholeTempStowAll(state, ctx)
    expect(stow.moved).toBe(1)
    expect(stow.stuck).toHaveLength(1)
    expect(wormholeTempPending(state, ctx).count).toBe(1)
    // 「全部丢弃」⇒ 清零
    expect(wormholeTempDiscardAll(state, ctx).moved).toBe(1)
    expect(wormholeTempPending(state, ctx).count).toBe(0)
    expect(run.tempGrid!.placements).toEqual([])
  })

  it('**老档换算**：`run.temp`（列表）→ `run.tempGrid`（32 格格子账本），散货并进 bag', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    run.temp = [
      { itemId: BOX_FOR_TEST, units: 1 },
      { itemId: 'ore-voidmother', units: 1_500 },
    ]
    const r = wormholeNormalizeLegacyTemp(state, ctx)
    expect(r.moved).toBe(2)
    expect(run.temp).toBeUndefined() // 旧字段换算完就清掉（不再写入）
    const u = wormholeTempUsage(state, ctx)
    expect(u.placements.some((p) => p.kind === 'box' && p.itemId === BOX_FOR_TEST)).toBe(true)
    expect(run.bag).toEqual([{ itemId: 'ore-voidmother', units: 1_500 }])
    // 散货并进 bag 后由 sync 铺件：货仓优先（10 格够放 3 件）⇒ 全部落在货仓
    expect(run.hold!.placements.filter((p) => p.kind === 'cargo')).toHaveLength(3)
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    // 幂等：再跑一次不动任何东西
    expect(wormholeNormalizeLegacyTemp(state, ctx).moved).toBe(0)
  })

  it('**临时空间随档往返**（可选字段 `tempGrid`，零迁移）', () => {
    const state = enterRun(1, 4242, 0, 2)
    const run = state.wormhole.run!
    const cell = ruinsWithBoxIn(state, 'A')
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true)
    cell.piles = [{ itemId: BOX_FOR_TEST, units: 1 }]
    expect(wormholeTakePileAt(state, ctx, 0).ok).toBe(true) // → 临时空间
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const backTemp = back.wormhole.run!.tempGrid!
    expect(backTemp.cols).toBe(WORMHOLE_TEMP_COLS)
    expect(backTemp.placements.map((p) => p.itemId)).toEqual([BOX_FOR_TEST])
    // 坏件丢弃、**横向越界丢弃**（4 列板上不能有 8 格宽的件）、剩下的合法件保留
    const dirty = JSON.parse(serializeSaveFile(state, 1)) as Record<string, unknown>
    const wh = (dirty.state as Record<string, unknown>).wormhole as Record<string, unknown>
    const r2 = wh.run as Record<string, unknown>
    const tg = r2.tempGrid as Record<string, unknown>
    tg.placements = [
      { id: 'x0', itemId: '', kind: 'box', x: 0, y: 0, w: 2, h: 2 },
      { id: 'x1', itemId: BOX_FOR_TEST, kind: 'box', x: 2, y: 0, w: 8, h: 1 },
      { id: 'x2', itemId: BOX_FOR_TEST, kind: 'box', x: 0, y: 0, w: 2, h: 2 },
    ]
    const cleaned = loadSaveFile(JSON.stringify(dirty)).state
    expect(cleaned.wormhole.run!.tempGrid!.placements.map((p) => p.id)).toEqual(['x2'])
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

  it('专属掉落：**层 1 恒不出、层 2 起有几率**（船长 2026-09-13），掉出的东西一定落在货柜池里', () => {
    let got: string | undefined
    for (let seed = 1; seed <= 40; seed++) {
      const state = enterRun(4, seed)
      const run = state.wormhole.run!
      const grid = run.grid!
      // 层 1：恒不出专属
      const cell = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell)
      const r1 = wormholeSalvageAt(state, ctx)
      expect(r1.relics ?? []).toEqual([])
      expect((run.relics ?? []).length).toBe(0)
      // 推到第 2 层再试（直接改层号：只验门槛与池归属，不验走盘）
      run.depth = 2
      // ⚠ 2026-09-16 起「遗迹掉落」在**这一格第一次打捞**时就结算（船长「时间点改为遗迹第一次打捞」），
      //   而这里是把同一张盘原地改成层 2 ⇒ 必须**一起清掉首捞账**，否则这一格在层 1 那一步已经结算过、
      //   永远不会再掷（真游戏里换层是**换一张新盘**，新盘本来就没有这个账）。
      grid.ruinsRolled = []
      const cell2 = standOn(state, 'ruins')
      wormholeEnsureSalvagePiles(state, cell2)
      const r2 = wormholeSalvageAt(state, ctx)
      if ((r2.relics ?? []).length > 0) {
        got = r2.relics![0]
        /**
         * **2026-09-15 改判后：掉的是"全货柜池"里的任意一种**（贵重品柜 50% + 其余 9 种各 ≈5.6%），
         * 不再按本格敌卡的族、也不按层档取 ⇒ 这里只钉"一定在池里"。
         */
        expect(wormholeRelicBoxPoolOf(ctx), `${got} 不在遗迹货柜池里`).toContain(got)
        // 且它**真的落到了玩家手里**——收货阶梯（2026-09-13 船长「大件货先进临时空间」）：
        // ① 货仓腾得出该形状 ⇒ 进货仓格；② 腾不出 ⇒ 进临时空间；③ 两边都满才散落在该格
        const inHold = (run.hold?.placements ?? []).some((pp) => pp.kind === 'box' && pp.itemId === got)
        const inTemp = (run.tempGrid?.placements ?? []).some((s) => s.itemId === got)
        const onGround = (cell2.piles ?? []).some((pp) => pp.itemId === got)
        expect(inHold || inTemp || onGround, '货柜既不在货仓/临时空间，也没散落在原地——凭空消失了').toBe(true)
        break
      }
    }
    expect(got, '40 个种子里一次专属都没掉（层 2 = 70% 概率不该如此）').toBeTruthy()
  })

  /* ═══════════ 遗迹掉落时机（2026-09-16 船长：「时间点改为遗迹第一次打捞」）═══════════
   * 三个掷点（遗迹安全货柜 70% · AI 核心 10% · 惊扰守卫）由"**这一格打捞完**那一拍"
   * 提前到"**这一格第一次真正收走至少一堆**的那次打捞"，掷中即发货，每格只结算一次
   * （`grid.ruinsRolled` 记账、随档）。 */
  describe('遗迹掉落时机：第一次打捞即结算（船长 2026-09-16）', () => {
    /** 在 depth=2 找一个「首捞命中货柜」的种子（真掷骰，不用假随机） */
    function seedWithBox(depth = 2): { state: GameState; cell: WormholeGridCell } {
      for (let seed = 1; seed <= 60; seed++) {
        const state = enterRun(1, seed)
        const run = state.wormhole.run!
        run.depth = depth
        const cell = standOn(state, 'ruins')
        wormholeEnsureSalvagePiles(state, cell)
        if (wormholeRollRelicBox(state, ctx, cell) !== undefined) return { state, cell }
      }
      throw new Error('60 个种子里没有首捞命中货柜的样本（70% 概率不该如此）')
    }

    it('**不必清完也能拿到**：首捞（还有堆没捞）即掷、掷中即发货', () => {
      const { state, cell } = seedWithBox()
      const run = state.wormhole.run!
      const grid = run.grid!
      expect((cell.piles ?? []).length).toBeGreaterThanOrEqual(2) // 1 台打捞器 ⇒ 首捞必留堆
      expect(grid.ruinsRolled ?? []).not.toContain(cell.key)
      const r = wormholeSalvageAt(state, ctx)
      expect(r.ok).toBe(true)
      expect(r.finished, '首捞不该把 2~3 堆一次捞完').toBe(false)
      expect((r.relics ?? []).length, '首捞就该出遗迹货柜').toBe(1)
      expect(wormholeRelicBoxPoolOf(ctx)).toContain(r.relics![0]!)
      expect(grid.ruinsRolled, '首捞即记账').toContain(cell.key)
      expect(state.logs.some((l) => l.text.includes('遗迹深处发现'))).toBe(true)
    })

    it('**每格只结算一次**：同格再打捞不再掷（`relics` 空、账不变）', () => {
      const { state, cell } = seedWithBox()
      const run = state.wormhole.run!
      const grid = run.grid!
      wormholeSalvageAt(state, ctx)
      const rolled = [...(grid.ruinsRolled ?? [])]
      const r2 = wormholeSalvageAt(state, ctx)
      expect(r2.relics ?? []).toEqual([])
      expect(grid.ruinsRolled).toEqual(rolled)
      void run
      void cell
    })

    it('**惊扰守卫也提前**（船长同日选「也提前到第一次打捞」）：首捞就可能当场开战', () => {
      let checked = 0
      for (let seed = 1; seed <= 60 && checked < 3; seed++) {
        const state = enterRun(1, seed)
        const run = state.wormhole.run!
        run.depth = 2
        const cell = standOn(state, 'ruins')
        wormholeEnsureSalvagePiles(state, cell)
        const r = wormholeSalvageAt(state, ctx)
        expect(r.finished).toBe(false) // 首捞（1 台 ⇒ 还有堆）
        if (r.effect?.kind === 'ruinsBattle') {
          expect(r.effect.key).toBe(cell.key)
          expect(run.pendingRuinsBattle, '要拦下后续动作').toBe(true)
          expect(state.logs.some((l) => l.text.includes('守备被惊动'))).toBe(true)
          checked += 1
        }
      }
      expect(checked, '60 个种子里一次首捞开战都没有（概率没生效）').toBeGreaterThan(0)
    })

    it('**空动作不算第一次**：货仓一堆都收不走 ⇒ 不结算、不浪费这一格的判定', () => {
      const state = enterRun(1, 7)
      const run = state.wormhole.run!
      run.depth = 2
      const cell = standOn(state, 'ruins')
      const cardId = wormholeCellCardIdOf(run, cell)
      wormholeEnsureSalvagePiles(state, cell)
      // 塞满背包（同一物品并格 ⇒ 直接溢出，一堆都进不去）
      run.bag = [{ itemId: commonWreckOf(cardId), units: 100_000 }]
      const r = wormholeSalvageAt(state, ctx)
      expect(r.ok).toBe(true)
      expect((r.taken ?? []).length, '一堆都没收走').toBe(0)
      expect(r.relics ?? []).toEqual([])
      expect(run.grid!.ruinsRolled ?? [], '一堆都没收走 ⇒ 这一格的判定要留着').not.toContain(cell.key)
    })

    it('**记账随档**：读档后同格不再重复结算（否则"存档→重开"能反复刷）', () => {
      const { state, cell } = seedWithBox()
      wormholeSalvageAt(state, ctx)
      const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
      const lgrid = loaded.wormhole.run!.grid!
      expect(lgrid.ruinsRolled, '首捞账要落盘').toContain(cell.key)
      const r = wormholeSalvageAt(loaded, ctx)
      expect(r.relics ?? [], '读档后再捞不该再出货柜').toEqual([])
    })
  })

  it('**专属概率固定 70%**（层 2 起一律；层 1 恒 0）——实测命中率 ≈70%，且不再随层变化', () => {
    // 概率表本身（解析口径）——2026-09-15 船长：「遗迹出货柜概率提高到70%」（旧的 12%×1.3 封顶 50% 作废）
    expect(wormholeRelicChanceOf(1), '层 1 恒不出（这条未动）').toBe(0)
    expect(wormholeRelicChanceOf(2)).toBe(WORMHOLE_RELIC_BOX_CHANCE)
    expect(wormholeRelicChanceOf(4)).toBe(WORMHOLE_RELIC_BOX_CHANCE)
    expect(wormholeRelicChanceOf(20)).toBe(WORMHOLE_RELIC_BOX_CHANCE)
    expect(WORMHOLE_RELIC_BOX_CHANCE).toBe(0.7)
    // 实测口径：同一种子集在不同层的命中率（各 160 趟）——**各层应基本同值**（不分层）
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
    for (const [d, r] of [
      [2, r2],
      [4, r4],
      [7, r7],
    ] as const) {
      expect(r, `层 ${d} 命中率 ${(r * 100).toFixed(1)}%（期望 ≈70%）`).toBeGreaterThan(0.58)
      expect(r, `层 ${d} 命中率 ${(r * 100).toFixed(1)}%（期望 ≈70%）`).toBeLessThan(0.82)
    }
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

describe('虫洞 · 遗迹收尾战「先提示、确认后再打」（船长 2026-09-13）', () => {
  /**
   * 船长报障：「打捞遗迹触发战斗时，战斗突然发生没有任何提示」⇒ 口径 = 打捞照常结算、
   * **不直接开战**，先在 `run` 上留 `pendingRuinsBattle`；界面弹确认条，玩家点「迎战」才开打；
   * 确认之前**别的动作一律被拦**（不会把这一场跳过，也不会留下半截状态）。
   */
  it('先留标记不开战 → 确认前动作被拦 → 迎战后开战并清标记', () => {
    let state: GameState | null = null
    // 触发是确定性骰（70%），扫几个种子就能拿到一个"确实触发了"的例子
    for (let seed = 1; seed <= 80 && state === null; seed++) {
      const s = enterRun(2, seed, 0, 2)
      const cell = standOn(s, 'ruins')
      const cardId = wormholeCellCardIdOf(s.wormhole.run!, cell)
      cell.piles = [
        { itemId: commonWreckOf(cardId), units: 100 },
        { itemId: commonWreckOf(cardId), units: 100 },
      ]
      const r = wormholeActivateAt(s, ctx, undefined, { deferRuinsBattle: true })
      expect(r.ok, r.error).toBe(true)
      if (r.pendingBattle === 'ruins') state = s
    }
    expect(state, '80 个种子里应有一个触发遗迹收尾战').not.toBeNull()
    const run = state!.wormhole.run!
    // ① 打捞已结算、但**没有偷偷开战**
    expect(run.pendingRuinsBattle).toBe(true)
    expect(run.battle ?? null).toBeNull()
    // ② 确认之前：扫描 / 前往 / 采集一律被拦，且拒因点明"先迎战"
    const scan = wormholeGridScan(state!)
    expect(scan.ok).toBe(false)
    expect(scan.error ?? '').toContain('迎战')
    const here = gridCellAt(run.grid!, run.grid!.pos)!
    const away = run.grid!.cells.find((c) => c.key !== here.key)!
    const move = wormholeTravelTo(state!, ctx, { q: away.q, r: away.r }, { confirmUnknown: true })
    expect(move.ok).toBe(false)
    expect(move.error ?? '').toContain('迎战')
    // ③ 迎战 ⇒ 开战、标记清掉
    const b = wormholeStartBattle(state!, ctx, 'ruins')
    expect(b.ok, b.error).toBe(true)
    expect(run.battle).not.toBeNull()
    expect(run.pendingRuinsBattle).toBe(false)
  })
})

/**
 * **残骸打捞点的货柜掉落**（船长 2026-09-15 定「虫洞战利品与经济扩充」③：
 * 「然后在残骸打捞点，设定有极低概率出各种货柜」＋「残骸打捞是指虫洞内的。不分层随机出。」）。
 *
 * 三条口径：**每堆 0.75%** · **一次打捞最多 1 个** · **四类货柜类等权且不分层**。
 * ⚠ 掷骰键 = (本趟种子, 层, 格坐标 q/r, **收走这一堆之后还剩几堆**) ⇒ 用例可以"**先探后造**"：
 * 只要先算出哪个剩堆数命中，再把该格造成"正好剩这么多堆"的现场，就能确定性地验落点。
 */
describe('虫洞 · 残骸堆里的货柜（船长 2026-09-15 定 ③）', () => {
  /** 残骸格探针（掷骰只认 `place`/`q`/`r`；族取本趟敌卡） */
  const probe = (q: number, r = 0, place: WormholeGridCell['place'] = 'graveyard'): WormholeGridCell =>
    ({ key: `probe-${q}-${r}`, q, r, place, piles: [] }) as WormholeGridCell

  it('**每堆 0.75%**：命中率落在口径带内 · 同一键同结果（可复现、不消费既有掷骰）', () => {
    let hits = 0
    let rolls = 0
    for (let seed = 1; seed <= 40; seed++) {
      const state = enterRun(1, seed)
      for (let q = 0; q < 25; q++) {
        const cell = probe(q)
        for (let left = 0; left < 10; left++) {
          rolls += 1
          const a = wormholeRollSalvageBox(state, ctx, cell, left)
          expect(wormholeRollSalvageBox(state, ctx, cell, left), '同一键必须同结果').toBe(a)
          if (a) hits += 1
        }
      }
    }
    const rate = hits / rolls
    // 1 万个键 ⇒ 期望 ~75 次命中；带宽放到 0.3%~1.6%（约 ±45%）只卡"量级对不对"，不当精度用例
    expect(rolls).toBe(10_000)
    expect(rate, `实测命中率 ${(rate * 100).toFixed(3)}%`).toBeGreaterThan(0.003)
    expect(rate, `实测命中率 ${(rate * 100).toFixed(3)}%`).toBeLessThan(0.016)
    expect(WORMHOLE_SALVAGE_BOX_CHANCE).toBe(0.0075)
  })

  it('**四类等权 · 不分层**：层 1 也能翻出深档图纸柜/贵重品柜/军用备货柜（池外零泄漏）', () => {
    const families = ['a', 'c', 'd', 'e', 'g']
    const allowed = new Set<string>([
      ...families.map((f) => wormholeRelicBoxIdOf(f.toUpperCase())),
      ...WORMHOLE_BP_BOX_IDS,
      'box-valuables',
      'box-military',
    ])
    const seen = new Set<string>()
    const perClass = { relic: 0, bp: 0, valuables: 0, military: 0 }
    for (let seed = 1; seed <= 40; seed++) {
      const state = enterRun(1, seed)
      expect(state.wormhole.run!.depth, '本用例全程在层 1（不分层 = 层 1 也出深档）').toBe(1)
      for (let q = 0; q < 40; q++) {
        for (let left = 0; left < 12; left++) {
          const id = wormholeRollSalvageBox(state, ctx, probe(q), left)
          if (!id) continue
          expect(allowed.has(id), `${id} 不在四类货柜池里`).toBe(true)
          seen.add(id)
          if (id.startsWith('box-relic-')) perClass.relic += 1
          else if (id.startsWith('box-bp-')) perClass.bp += 1
          else if (id === 'box-valuables') perClass.valuables += 1
          else perClass.military += 1
        }
      }
    }
    // 四类都露过面（1.9 万个键 ⇒ 期望 ~144 次命中、每类 ~36 次，缺席概率 ~1e-16）
    for (const [name, n] of Object.entries(perClass)) expect(n, `这一类一次都没出：${name}`).toBeGreaterThan(0)
    // **不分层**：层 1 出过深档图纸柜 / 贵重品柜 / 军用备货柜（这几种在旧口径里只属于深层/遗迹）
    expect(seen.has('box-valuables')).toBe(true)
    expect(seen.has('box-military')).toBe(true)
    expect(seen.has('box-bp-deep')).toBe(true)
    // 类权重在 ±40% 内（类等权 25%；144 次命中的抽样噪声约 ±8%，带宽留足）
    const total = perClass.relic + perClass.bp + perClass.valuables + perClass.military
    for (const [name, n] of Object.entries(perClass)) {
      expect(n / total, `类权重出带：${name}`).toBeGreaterThan(0.15)
      expect(n / total, `类权重出带：${name}`).toBeLessThan(0.35)
    }
  })

  it('**只在残骸地点掷**：遗迹格不掷（遗迹另有专属掉落，不叠加）', () => {
    const state = enterRun(1, 4242)
    for (const place of ['empty', 'ruins', 'ship', 'vein', 'matter', 'beacon'] as const) {
      const cell = probe(0, 0, place)
      for (let left = 0; left < 60; left++) {
        expect(wormholeRollSalvageBox(state, ctx, cell, left), `${place} 不该掷货柜`).toBeUndefined()
      }
    }
  })

  it('**落点走收货阶梯**：命中 ⇒ 结果里报账，货柜进货仓/临时空间/散落在原格（不入仓库）', () => {
    const state = enterRun(1, 4242)
    const run = state.wormhole.run!
    const cell = standOn(state, 'graveyard')
    // 先探：找这条流里第一个命中的"剩堆数"
    let left = -1
    for (let l = 0; l < 2000 && left < 0; l++) if (wormholeRollSalvageBox(state, ctx, cell, l)) left = l
    expect(left, '这条流 2000 个键里该有一次命中').toBeGreaterThanOrEqual(0)
    const boxId = wormholeRollSalvageBox(state, ctx, cell, left)!
    // 后造：把该格造成"收走一堆后正好剩 left 堆"（1 台打捞器 ⇒ 一次只收一堆 ⇒ 掷的就是这个键）
    cell.piles = Array.from({ length: left + 1 }, () => ({ itemId: commonWreckOf(wormholeCellCardIdOf(run, cell)), units: 1 }))
    const before = countWare(state, boxId)
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok, r.error).toBe(true)
    expect(r.boxes, '结果里报出这件货柜').toEqual([boxId])
    expect(countWare(state, boxId), '还没入仓库（撤离成功才入港）').toBe(before)
    const landing = [
      (run.hold?.placements ?? []).some((p) => p.itemId === boxId) ? 'hold' : '',
      (run.tempGrid?.placements ?? []).some((p) => p.itemId === boxId) ? 'temp' : '',
      (cell.piles ?? []).some((p) => p.itemId === boxId) ? 'scattered' : '',
    ].filter(Boolean)
    expect(landing, '货柜按「货仓 → 临时空间 → 散落该格」落地（且只落一处）').toHaveLength(1)
  })

  it('**每次最多 1 个**：一次打捞里连续两堆都命中，也只出一个货柜', () => {
    const state = enterRun(3, 4242) // 3 台打捞器 ⇒ 一次动作收 3 堆
    const run = state.wormhole.run!
    const cell = standOn(state, 'graveyard')
    expect(WORMHOLE_SALVAGE_BOX_MAX).toBe(1)
    /**
     * 找一对**连续命中**的键（同一格、剩堆数 L 与 L-1 都命中；概率 0.75%² ⇒ 要扫几万个键）。
     * 命中键与"这一格的实际坐标"绑定 ⇒ 找到后把当前格改造成那组坐标（`q`/`r` 只被这条掷骰读）。
     */
    let hitQ = -1
    let hitLeft = -1
    for (let q = 0; q < 4000 && hitQ < 0; q++) {
      const cell2 = probe(q)
      let prev = false
      for (let l = 1; l <= 90; l++) {
        const hit = wormholeRollSalvageBox(state, ctx, cell2, l) !== undefined
        if (hit && prev) {
          hitQ = q
          hitLeft = l
          break
        }
        prev = hit
      }
    }
    expect(hitQ, '4 千个坐标 × 90 个剩堆数里该有一对连续命中').toBeGreaterThanOrEqual(0)
    cell.q = hitQ
    cell.r = 0
    // 收走第 1 堆 ⇒ 掷键用 L=hitLeft（命中）；收走第 2 堆 ⇒ 用 L=hitLeft-1（也命中，但被上限截住）
    cell.piles = Array.from({ length: hitLeft + 2 }, () => ({
      itemId: commonWreckOf(wormholeCellCardIdOf(run, cell)),
      units: 1,
    }))
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok, r.error).toBe(true)
    expect(r.taken, '3 台打捞器 ⇒ 这一批收走 3 堆（前两堆的掷键都命中，上限才有得验）').toHaveLength(3)
    expect(r.boxes ?? [], '两堆都命中 ⇒ 仍只出 1 个').toHaveLength(1)
  })
})
