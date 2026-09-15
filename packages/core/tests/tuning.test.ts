/**
 * **限时倍率表**（2026-09-15 船长：「允许我快速设置在指定的现实日期之前，给特定数值调整一个倍率」）。
 *
 * 本文件有两类用例：
 * ① **表本身**：区间边界 / 相乘 / 非法日期 / 未设 `state.wallMs` ⇒ 恒 1×（工具与用例免疫）；
 * ② **八个开关逐个"乘在正确的地方"**：每个开关一段，都走"临时往表里塞一条规则 → 读引擎读数 → 还原"。
 *
 * ⚠ 表是**模块常量**（正式数据），用例用 `withRules` 临时 push/pop —— 收尾一定还原（finally）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { TUNING_RULES, activeTunings, localDayStartMs, ruleActiveAt, tuningMul, tuningMulAt } from '../src/tuning'
import type { TunableKey, TuningRule } from '../src/tuning'
import { getMiningParams } from '../src/mining'
import { wormholeScanWindowMs } from '../src/wormholeScan'
import { wreckDensityOf } from '../src/salvage'
import { enqueueSkill, advanceGame } from '../src/engine'
import { sideTaskBoard } from '../src/sideTasks'
import { skillLevelTimeMs, trainingTimeFactor } from '../src/training'
import { wormholeEnter } from '../src/wormhole'
import { wormholeEnsureArrivalPiles } from '../src/wormholeSalvage'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
/** 一个"永远生效"的截止日（用例里统一用它，免得依赖当天日期） */
const FOREVER = '2099-12-31'
/** 2026-09-20 当地 12:00 的墙钟（正文用的"现在"） */
const NOW = new Date(2026, 8, 20, 12, 0, 0, 0).getTime()

function withRules<T>(rules: TuningRule[], fn: () => T): T {
  const arr = TUNING_RULES as TuningRule[]
  const n = arr.length
  arr.push(...rules)
  try {
    return fn()
  } finally {
    arr.length = n
  }
}

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

describe('虫洞 · 限时倍率表（表本身）', () => {
  it('① 未设 `state.wallMs` ⇒ 恒 1×（工具与用例不会被日历污染）', () => {
    const s = fresh()
    expect(s.wallMs).toBeUndefined()
    withRules([{ key: 'wreckDensity', mul: 2, until: FOREVER }], () => {
      expect(tuningMul(s, 'wreckDensity')).toBe(1) // ⚠ 关键：没有墙钟就不生效
      expect(tuningMulAt('wreckDensity', NOW)).toBe(2) // 显式给墙钟才生效
    })
  })

  it('② 区间边界：起始当天 00:00 起生效 · 截止当天整天有效 · 次日 00:00 失效', () => {
    const rule: TuningRule = { key: 'miningYield', mul: 2, from: '2026-09-20', until: '2026-09-22' }
    const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
    expect(ruleActiveAt(rule, at(2026, 9, 19, 23, 59))).toBe(false) // 起始前一天
    expect(ruleActiveAt(rule, at(2026, 9, 20, 0, 0))).toBe(true) // 起始当天 00:00
    expect(ruleActiveAt(rule, at(2026, 9, 22, 23, 59))).toBe(true) // 截止当天最后一分钟
    expect(ruleActiveAt(rule, at(2026, 9, 23, 0, 0))).toBe(false) // 次日 00:00 失效
  })

  it('③ 省掉起始日 ⇒ 立即生效；多条同目标 ⇒ 相乘', () => {
    withRules(
      [
        { key: 'miningYield', mul: 2, until: FOREVER, note: 'A' },
        { key: 'miningYield', mul: 3, until: FOREVER, note: 'B' },
      ],
      () => {
        expect(tuningMulAt('miningYield', NOW)).toBe(6)
        expect(activeTunings(NOW).map((t) => `${t.name}×${t.mul}`)).toHaveLength(2)
      },
    )
  })

  it('④ 非法输入一律"不生效"：坏日期 / 坏倍率 / 未给墙钟', () => {
    expect(localDayStartMs('2026-02-31')).toBeNull() // Date 会顺延 ⇒ 反查拦下
    expect(localDayStartMs('2026-9-1')).toBeNull()
    const bad: TuningRule[] = [
      { key: 'miningYield', mul: 2, until: '2026-02-31' },
      { key: 'miningYield', mul: 0, until: FOREVER },
      { key: 'miningYield', mul: -1, until: FOREVER },
      { key: 'miningYield', mul: 2, from: '2026-09-25', until: '2026-09-20' },
    ]
    withRules(bad, () => {
      expect(tuningMulAt('miningYield', NOW)).toBe(1)
      expect(tuningMulAt('miningYield', null)).toBe(1)
      expect(activeTunings(NOW)).toHaveLength(0)
    })
  })

  it('⑤ `activeTunings` 给出名称 / 倍率 / 截止时刻（界面读数用）', () => {
    withRules([{ key: 'rewardIsk', mul: 2, until: '2026-09-21', note: '周末活动' }], () => {
      const list = activeTunings(NOW)
      expect(list).toHaveLength(1)
      expect(list[0]!.name).toContain('奖励')
      expect(list[0]!.mul).toBe(2)
      // 截止时刻 = 截止日次日 00:00
      expect(list[0]!.untilMs).toBe(new Date(2026, 8, 22, 0, 0, 0, 0).getTime())
      expect(activeTunings(new Date(2026, 8, 22, 0, 0, 0, 0).getTime())).toHaveLength(0)
    })
  })
})

describe('虫洞 · 限时倍率表（八个开关逐个接线）', () => {
  /** 造一趟洞内探索（2×T3），并把当前格改成指定地点 */
  function enterRunWith(place: 'graveyard' | 'ruins'): GameState {
    const s = fresh()
    const a = addShipToFleet(s, T3)
    const b = addShipToFleet(s, T3)
    s.shipId = a
    expect(wormholeEnter(s, ctx, [a, b], 9).ok).toBe(true)
    const g = s.wormhole.run!.grid!
    const cell = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}`)!
    g.pos = { q: cell.q, r: cell.r }
    cell.place = place
    cell.piles = []
    return s
  }

  const on = (key: TunableKey, mul: number): TuningRule => ({ key, mul, until: FOREVER })

  it('① wreckDensity：残骸密度读取值 ×2（不改已存密度）', () => {
    const s = fresh()
    const g = 'galaxy-hub'
    const base = wreckDensityOf(s, g, ctx)
    const stored = { ...(s.galaxyWrecks[g] ?? { density: 0, rare: 0 }) }
    s.wallMs = NOW
    withRules([on('wreckDensity', 2)], () => {
      expect(wreckDensityOf(s, g, ctx)).toBeCloseTo(base * 2, 6)
      expect(s.galaxyWrecks[g] ?? { density: 0, rare: 0 }).toEqual(stored) // 存量一字不动
    })
  })

  it('② rareWreckRate：判定概率拉满 ⇒ 墓场每 3 堆普通必出一件稀有', () => {
    const s = enterRunWith('graveyard')
    const cell = s.wormhole.run!.grid!.cells.find((c) => c.q === s.wormhole.run!.grid!.pos.q)!
    s.wallMs = NOW
    wormholeEnsureArrivalPiles(s, ctx)
    const commons = (cell.piles ?? []).filter((p) => !p.itemId.startsWith('wreck-rare-')).length
    const raresOff = (cell.piles ?? []).filter((p) => p.itemId.startsWith('wreck-rare-')).length
    const rolls = Math.floor(commons / 3)
    expect(raresOff).toBeLessThanOrEqual(rolls) // 默认是概率 ⇒ 不会超过判定次数
    cell.piles = []
    withRules([on('rareWreckRate', 1e9)], () => {
      wormholeEnsureArrivalPiles(s, ctx)
      const raresOn = (cell.piles ?? []).filter((p) => p.itemId.startsWith('wreck-rare-')).length
      expect(raresOn, '概率拉满后每一掷都该命中').toBe(rolls)
    })
  })

  it('③ rareWreckVolume：遗迹每件单位数 ×2（一件顶两件）', () => {
    const s = enterRunWith('ruins')
    const cell = s.wormhole.run!.grid!.cells.find((c) => c.q === s.wormhole.run!.grid!.pos.q)!
    s.wallMs = NOW
    wormholeEnsureArrivalPiles(s, ctx)
    const off = (cell.piles ?? []).filter((p) => p.itemId.startsWith('wreck-rare-'))[0]?.units ?? 0
    expect(off).toBeGreaterThan(0)
    cell.piles = []
    withRules([on('rareWreckVolume', 2)], () => {
      wormholeEnsureArrivalPiles(s, ctx)
      const onU = (cell.piles ?? []).filter((p) => p.itemId.startsWith('wreck-rare-'))[0]?.units ?? 0
      expect(onU).toBe(off * 2)
    })
  })

  it('④ wormholeScanMs：扫描窗口 ×0.5（快一倍）', () => {
    const s = fresh()
    const base = wormholeScanWindowMs(s)
    s.wallMs = NOW
    withRules([on('wormholeScanMs', 0.5)], () => {
      expect(wormholeScanWindowMs(s)).toBe(Math.max(1000, Math.round(base * 0.5)))
    })
  })

  it('⑤⑥ miningCycleMs / miningYield：循环时长 ×0.5、每循环产出 ×2', () => {
    const s = fresh()
    s.mining.active = true
    s.mining.beltId = ctx.belts.keys().next().value as string
    const base = getMiningParams(s, ctx)!
    expect(base.unitsPerCycle).toBeGreaterThan(0)
    s.wallMs = NOW
    withRules([on('miningCycleMs', 0.5), on('miningYield', 2)], () => {
      const tuned = getMiningParams(s, ctx)!
      expect(tuned.cycleMs).toBe(Math.max(1, Math.round(base.cycleMs * 0.5)))
      expect(tuned.unitsPerCycle).toBe(base.unitsPerCycle * 2)
    })
  })

  it('⑦ rewardIsk：任务板奖励 ×2（窝点 / 派系两条生成口径）', () => {
    /** 开板要"有已探明星系"＋墙钟落在窗口内（照 `bounty-tasks.test.ts`） */
    const openBoard = (): GameState => {
      const s = fresh(31)
      s.exploredGalaxies = [...ctx.galaxies.keys()]
      advanceGame(s, 1_000, ctx, { nowWallMs: NOW }) // 开板（顺带把 wallMs 写进 state）
      return s
    }
    // 对照组：抹掉墙钟 ⇒ 倍率恒 1×（**生成发生在开板那一刻**，故对照组也要在同一条件生成）
    const off = openBoard()
    off.wallMs = undefined
    const offBoard = sideTaskBoard(off, ctx, NOW)
    const offRewards = [...offBoard.bounty.map((t) => t.rewardIsk), ...(offBoard.faction ? [offBoard.faction.rewardIsk] : [])]
    expect(offRewards.length).toBeGreaterThan(0)
    // 实验组：**表里带规则**时开板（生成吃到倍率）
    const onRewards = withRules([on('rewardIsk', 2)], () => {
      const s = openBoard()
      const b = sideTaskBoard(s, ctx, NOW)
      return [...b.bounty.map((t) => t.rewardIsk), ...(b.faction ? [b.faction.rewardIsk] : [])]
    })
    expect(onRewards.length).toBe(offRewards.length)
    onRewards.forEach((v, i) => {
      // 生成口径是 /100*100 ⇒ 允许 ±100 的取整余量
      expect(Math.abs(v - offRewards[i]! * 2)).toBeLessThanOrEqual(100)
    })
  })

  it('⑧ skillTrainMs：技能训练时长 ×0.5（技能没有经验点，是按时长训练的）', () => {
    const build = (): GameState => {
      const s = fresh(7)
      addShipToFleet(s, T3)
      return s
    }
    const off = build()
    const def = ctx.skills.get('gunnery')!
    /** 一级所需时长（引擎同式：`skillLevelTimeMs × trainingTimeFactor`） */
    const needMs = Math.max(1, Math.round(skillLevelTimeMs(def, 1) * trainingTimeFactor(off)))
    expect(enqueueSkill(off, 'gunnery', 1, ctx.skills).ok).toBe(true)
    const tuned = build()
    tuned.wallMs = NOW
    // 入队与推进都在"规则生效期间"做（规则是用例临时 push 的）
    withRules([on('skillTrainMs', 0.5)], () => {
      expect(enqueueSkill(tuned, 'gunnery', 1, ctx.skills).ok).toBe(true)
      advanceGame(tuned, needMs - 1, ctx)
    })
    advanceGame(off, needMs - 1, ctx)
    expect(off.skills.trained['gunnery'] ?? 0, '对照组：差 1 毫秒没练完').toBe(0)
    expect(tuned.skills.trained['gunnery'] ?? 0, '倍率 ×0.5 ⇒ 同样的时长已经练完一级').toBe(1)
  })
})
