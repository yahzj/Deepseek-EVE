/**
 * **虫洞「内容原型」（丙）+「敌族锁定」（丁）+ 放弃已发现的虫洞**（船长 2026-09-14 定案）。
 *
 * 船长原话（照抄）：「**可以按照丙（内容原型）＋ 丁（族徽）做，同时玩家要能够放弃已经探索出的虫洞。**」
 * 默认值（船长「按你推荐来」）：原型 5 档 · 权重 40/20/15/15/10 · 名字「均衡深区 / 残骸富集 / 遗迹密集 /
 * 母矿脉 / 交火密集」；五族等概率；原型也影响自动探索的产出分布（**总期望不变**，只在原型间重分配）；
 * 放弃要二次确认、一次一处；老档按种子现算原型与族；进洞前两者都可见。
 *
 * 锁住这些口径：
 * ① 原型确定性 + 分布 ≈ 权重（40/20/15/15/10）；
 * ② 原型只改配比：**权重总和恒 100、信标恒 10**；`ruins` 原型把遗迹占比抬到 50% 且下限 +1；
 * ③ 族：一处一族的确定性 + 五族等概率 + **整趟同族**（所有格同一张卡）+ 与五张洞内卡 1:1；
 * ④ 自动探索的口味：权重表与网格同值、口味倍数按权重归一化（加权均值 ≈ 1 ⇒ 总期望不变）；
 * ⑤ 放弃：腾出库存格、**不影响扫描进度**；自动探索中的那一处拒绝放弃；
 * ⑥ 随档往返：老档缺 原型/族 ⇒ **按种子现算**（与发现时的口径一致）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_ARCHETYPES,
  WORMHOLE_ARCHETYPE_LABELS,
  WORMHOLE_ARCHETYPE_WEIGHTS,
  WORMHOLE_SIGNAL_WEIGHTS,
  wormholeArchetypeOf,
  wormholeMakeGrid,
  wormholeRuinsFloorBonusFor,
  wormholeRuinsFloorFor,
  wormholeRuinsShareFor,
  wormholeSignalWeightsFor,
} from '../src/wormholeGrid'
import {
  WORMHOLE_FAMILY_CARD,
  WORMHOLE_FAMILY_ORDER,
  wormholeCardIdOfFamily,
  wormholeFamilyOfSeed,
} from '../src/wormholeFoes'
import { wormholeCellCardIdOf } from '../src/wormholeSalvage'
import { WORMHOLE_AUTO_ARCHETYPE_WEIGHTS, wormholeAutoArchetypeMul } from '../src/wormholeAuto'
import { wormholeStockDiscard, wormholeStockOf, wormholeStockPush } from '../src/wormholeScan'
import { wormholeAutoStart } from '../src/wormholeAuto'
import { wormholeEnter } from '../src/wormhole'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 4242): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.standings['dsi'] = 35 // 扫描解锁门槛（另见 wormhole-unlock.test.ts）
  return state
}

describe('虫洞 · 内容原型（丙）', () => {
  it('**确定性 + 分布 ≈ 权重**（40/20/15/15/10）', () => {
    expect(WORMHOLE_ARCHETYPES).toHaveLength(5)
    expect(Object.values(WORMHOLE_ARCHETYPE_WEIGHTS).reduce((s, v) => s + v, 0)).toBe(100)
    for (const a of WORMHOLE_ARCHETYPES) {
      expect(WORMHOLE_ARCHETYPE_LABELS[a], `原型 ${a} 缺中文名`).toBeTruthy()
      expect(wormholeArchetypeOf(12345), '同种子必得同原型').toBe(wormholeArchetypeOf(12345))
    }
    // 2000 个种子：各档占比落在权重 ±5pp 内（含 40% 那档）
    const N = 2000
    const hit: Record<string, number> = {}
    for (let s = 1; s <= N; s++) {
      const a = wormholeArchetypeOf(s * 7919 + 13)
      hit[a] = (hit[a] ?? 0) + 1
    }
    for (const a of WORMHOLE_ARCHETYPES) {
      const share = ((hit[a] ?? 0) / N) * 100
      expect(Math.abs(share - WORMHOLE_ARCHETYPE_WEIGHTS[a]), `${a} 占比 ${share.toFixed(1)}%`).toBeLessThan(5)
    }
  })

  it('**只改配比**：权重总和恒 100、信标恒 10；各原型的口味方向正确', () => {
    const base = WORMHOLE_SIGNAL_WEIGHTS
    for (const a of WORMHOLE_ARCHETYPES) {
      const w = wormholeSignalWeightsFor(a)
      const total = w.ship + w.wreck + w.resource + w.radar + w.beacon
      expect(total, `${a} 权重总和`).toBeCloseTo(100, 6)
      expect(w.beacon, `${a} 信标权重不得改`).toBe(base.beacon)
    }
    expect(wormholeSignalWeightsFor('wreck').wreck).toBeGreaterThan(base.wreck)
    expect(wormholeSignalWeightsFor('vein').resource).toBeGreaterThan(base.resource)
    expect(wormholeSignalWeightsFor('combat').ship).toBeGreaterThan(base.ship)
    // 均衡档 = 原表
    expect(wormholeSignalWeightsFor('balanced')).toEqual(base)
  })

  it('**遗迹密集**：占比 30% → 50%、每层下限 +1；实测盘面遗迹确实更多', () => {
    expect(wormholeRuinsShareFor('ruins')).toBe(0.5)
    expect(wormholeRuinsShareFor('balanced')).toBe(0.3)
    expect(wormholeRuinsFloorBonusFor('ruins')).toBe(1)
    expect(wormholeRuinsFloorBonusFor('wreck')).toBe(0)
    // 统计：ruins 原型的盘面遗迹数 > balanced 原型（各 120 个种子）
    const count = (a: 'ruins' | 'balanced'): number => {
      let n = 0
      let seeds = 0
      for (let s = 1; seeds < 120 && s < 5000; s++) {
        const seed = s * 104729 + 7
        if (wormholeArchetypeOf(seed) !== a) continue
        seeds += 1
        const grid = wormholeMakeGrid(seed, 3, 0)
        n += grid.cells.filter((c) => c.place === 'ruins').length
      }
      return n
    }
    const ruinsAvg = count('ruins')
    const balAvg = count('balanced')
    expect(ruinsAvg, `ruins 原型遗迹总数 ${ruinsAvg} vs 均衡 ${balAvg}`).toBeGreaterThan(balAvg)
    // 下限也真的抬了：ruins 原型每盘遗迹数 ≥ 层基准 + 1
    for (let s = 1; s < 400; s++) {
      const seed = s * 7919 + 3
      if (wormholeArchetypeOf(seed) !== 'ruins') continue
      const grid = wormholeMakeGrid(seed, 3, 0)
      const ruins = grid.cells.filter((c) => c.place === 'ruins').length
      expect(ruins, `seed ${seed} 的遗迹数`).toBeGreaterThanOrEqual(wormholeRuinsFloorFor(3) + 1)
    }
  })
})

describe('虫洞 · 敌族锁定（丁）', () => {
  it('**一处一族**：确定性 + 五族等概率 + 与五张洞内卡 1:1', () => {
    expect(WORMHOLE_FAMILY_ORDER).toHaveLength(5)
    for (const f of WORMHOLE_FAMILY_ORDER) {
      expect(WORMHOLE_FAMILY_CARD[f], `族 ${f} 缺洞内卡`).toBeTruthy()
    }
    // 卡的族字段必须与表一致（反查数据）
    for (const f of WORMHOLE_FAMILY_ORDER) {
      const card = ctx.anomalies.get(WORMHOLE_FAMILY_CARD[f])
      expect(card?.foeFamily, `${WORMHOLE_FAMILY_CARD[f]} 的 foeFamily`).toBe(f)
    }
    // 2000 种子：五族各 ≈20%
    const N = 2000
    const hit: Record<string, number> = {}
    for (let s = 1; s <= N; s++) {
      const f = wormholeFamilyOfSeed(s * 2654435761 + 5)
      hit[f] = (hit[f] ?? 0) + 1
    }
    for (const f of WORMHOLE_FAMILY_ORDER) {
      const share = ((hit[f] ?? 0) / N) * 100
      expect(Math.abs(share - 20), `族 ${f} 占比 ${share.toFixed(1)}%`).toBeLessThan(5)
    }
  })

  it('**整趟同族**：进洞后每一格的敌卡都是该族那一张（不再逐格轮换）', () => {
    const state = fresh()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(addShipToFleet(state, T3))
    const seed = 987654321
    const enter = wormholeEnter(state, ctx, ids, seed)
    expect(enter.ok).toBe(true)
    const run = state.wormhole.run!
    const family = wormholeFamilyOfSeed(seed)
    expect(run.family).toBe(family)
    const card = WORMHOLE_FAMILY_CARD[family]
    const seen = new Set<string>()
    for (const cell of run.grid!.cells) {
      if (cell.place === 'empty') continue
      seen.add(wormholeCellCardIdOf(run, cell))
    }
    expect([...seen]).toEqual([card])
  })

  it('**老档/调试入口**：不带 family 进洞 ⇒ 按种子现算（与库存列表显示同源）', () => {
    const state = fresh()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(addShipToFleet(state, T3))
    const seed = 24680
    expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.family).toBe(wormholeFamilyOfSeed(seed))
    expect(run.archetype).toBe(wormholeArchetypeOf(seed))
    expect(wormholeCardIdOfFamily(run.family, run.seed)).toBe(WORMHOLE_FAMILY_CARD[wormholeFamilyOfSeed(seed)])
  })
})

describe('虫洞 · 自动探索的口味（丙 影响产出）', () => {
  it('**权重表与网格同值**，且口味倍数按权重归一化（加权均值 ≈ 1 ⇒ 总期望不变）', () => {
    for (const a of WORMHOLE_ARCHETYPES) {
      expect(WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[a], `原型 ${a} 的权重两处应同值`).toBe(WORMHOLE_ARCHETYPE_WEIGHTS[a])
    }
    const totalP = WORMHOLE_ARCHETYPES.reduce((s, a) => s + WORMHOLE_ARCHETYPE_WEIGHTS[a], 0)
    const mean = { commons: 0, rares: 0, ore: 0, box: 0 }
    for (const a of WORMHOLE_ARCHETYPES) {
      const p = WORMHOLE_ARCHETYPE_WEIGHTS[a] / totalP
      const m = wormholeAutoArchetypeMul(a)
      mean.commons += p * m.commons
      mean.rares += p * m.rares
      mean.ore += p * m.ore
      mean.box += p * m.box
    }
    expect(mean.commons).toBeCloseTo(1, 6)
    expect(mean.rares).toBeCloseTo(1, 6)
    expect(mean.ore).toBeCloseTo(1, 6)
    expect(mean.box).toBeCloseTo(1, 6)
    // 口味方向：遗迹原型更出稀有残骸/货柜；母矿脉原型更出母矿
    expect(wormholeAutoArchetypeMul('ruins').rares).toBeGreaterThan(1)
    expect(wormholeAutoArchetypeMul('ruins').box).toBeGreaterThan(1)
    expect(wormholeAutoArchetypeMul('vein').ore).toBeGreaterThan(1)
    expect(wormholeAutoArchetypeMul('vein').rares).toBeLessThan(1)
  })
})

describe('虫洞 · 放弃已发现的虫洞', () => {
  it('**腾出库存格、不影响扫描进度**；自动探索中的那一处拒绝放弃', () => {
    const state = fresh()
    const a = wormholeStockPush(state, ctx)!
    const b = wormholeStockPush(state, ctx)!
    state.wormholeScan = { active: true, progressMs: 123_456 }
    expect(wormholeStockOf(state)).toHaveLength(2)
    // 放弃一处：库存 -1、进度一字不动
    expect(wormholeStockDiscard(state, a.id).ok).toBe(true)
    expect(wormholeStockOf(state).map((x) => x.id)).toEqual([b.id])
    expect(state.wormholeScan.progressMs).toBe(123_456)
    // 再放弃一次同一处：拒绝（已经不在了）
    expect(wormholeStockDiscard(state, a.id).ok).toBe(false)
    // 自动探索中的那一处不能放弃
    for (let i = 0; i < 4; i++) addShipToFleet(state, T3)
    state.skills.trained['ai-expert'] = 4 // AI 核心共用上限（自动探索每条参与舰占 1 枚）
    const c = wormholeStockPush(state, ctx)!
    const ships = Object.keys(state.fleet).filter((id) => id !== state.shipId).slice(0, 2)
    expect(wormholeAutoStart(state, ctx, c.id, ships).ok).toBe(true)
    /**
     * 开始自动探索 ⇒ **那一处开局即被消耗**（库存里已经没有它）⇒ 正常路径下根本无从放弃；
     * 下面手工把同一 id 塞回库存，专测那道**防御性守卫**（坏档 / 陈旧界面）。
     */
    expect(wormholeStockOf(state).find((x) => x.id === c.id)).toBeUndefined()
    state.wormholeStock = [...wormholeStockOf(state), { ...c }]
    const denied = wormholeStockDiscard(state, c.id)
    expect(denied.ok).toBe(false)
    expect(denied.error ?? '').toContain('自动探索')
  })

  it('**随档往返**：老档缺 原型/族 ⇒ 按种子现算（与发现时同口径）；坏值同样退回现算', () => {
    const state = fresh()
    const item = wormholeStockPush(state, ctx)!
    expect(item.archetype).toBe(wormholeArchetypeOf(item.seed))
    expect(item.family).toBe(wormholeFamilyOfSeed(item.seed))
    // 手工造一份"老档"：把两个字段抹掉 + 塞一条坏值
    const raw = JSON.parse(serializeSaveFile(state, 1)) as {
      state: { wormholeStock: Array<Record<string, unknown>> }
    }
    delete raw.state.wormholeStock[0]!.archetype
    delete raw.state.wormholeStock[0]!.family
    raw.state.wormholeStock.push({ id: 'wh-old', seed: 777, depth: 2, foundAtGameMs: 0, archetype: 'nope', family: 'Z' })
    const back = loadSaveFile(JSON.stringify(raw)).state
    const rows = wormholeStockOf(back)
    expect(rows[0]!.archetype).toBe(wormholeArchetypeOf(rows[0]!.seed))
    expect(rows[0]!.family).toBe(wormholeFamilyOfSeed(rows[0]!.seed))
    expect(rows[1]!.archetype).toBe(wormholeArchetypeOf(777))
    expect(rows[1]!.family).toBe(wormholeFamilyOfSeed(777))
  })
})
