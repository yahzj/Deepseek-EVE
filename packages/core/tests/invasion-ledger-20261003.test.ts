import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { pullOneWreck } from '../src/salvaging'
import { advanceSalvageOp, salvagerCyclesOf, startSalvageOp } from '../src/salvaging'
import { advanceAi, aiEfficiency, assignAiSalvage } from '../src/ai'
import { addShipToFleet } from '../src/fleetBook'
import { cargoCapacityM3Of } from '../src/inventory'
import { advanceWeekendWreckDecay, chargeWeekendWreckByVolume, injectWeekendRareWreck, injectWeekendWreck,
  pullRareWreck, weekendRareWreckCountOf, weekendWreckDensityOf, weekendWreckPoolsOf, WEEKEND_WRECK_DECAY_MS } from '../src/salvage'

const ctx = buildSimContext()
const GID = 'galaxy-redring'
const HOUR = 3_600_000
const fresh = () => createInitialState({ nowWallMs: 0, seed: 17 })

describe('入侵残骸按来源族分账', () => {
  it('同星系 H 600 + R 200，每轮只扣产出族，总量各自守恒', () => {
    const s = fresh()
    injectWeekendWreck(s, GID, 600, 'H')
    injectWeekendWreck(s, GID, 200, 'R')
    const total: Record<string, number> = { H: 0, R: 0 }
    for (let i = 0; i < 100 && weekendWreckDensityOf(s, GID) > 0; i++) {
      const before = Object.fromEntries(weekendWreckPoolsOf(s, GID).map((p) => [p.key, p.density]))
      const pick = pullOneWreck(s, ctx, GID, 0)!
      const family = pick.itemId === 'wreck-h-hi' ? 'H' : 'R'
      expect(['wreck-h-hi', 'wreck-r-inv']).toContain(pick.itemId)
      total[family]! += pick.volumeM3
      const after = Object.fromEntries(weekendWreckPoolsOf(s, GID).map((p) => [p.key, p.density]))
      expect(before[family]! - (after[family] ?? 0)).toBeCloseTo(pick.volumeM3, 6)
      const other = family === 'H' ? 'R' : 'H'
      expect(after[other] ?? 0).toBe(before[other] ?? 0)
    }
    expect(total.H).toBeCloseTo(600, 6)
    expect(total.R).toBeCloseTo(200, 6)
    expect(weekendWreckDensityOf(s, GID)).toBe(0)
  })

  it('新 R 注入不会刷新旧 H 的 48h 时钟；箱子不随普通残骸消失', () => {
    const s = fresh()
    injectWeekendWreck(s, GID, 100, 'H')
    injectWeekendRareWreck(s, GID, 'ink-main', 1, 'H')
    advanceWeekendWreckDecay(s, 24 * HOUR)
    injectWeekendWreck(s, GID, 100, 'R')
    advanceWeekendWreckDecay(s, 24 * HOUR)
    expect(weekendWreckPoolsOf(s, GID)).toEqual([
      { key: 'R', family: 'R', density: 50, rare: 0 },
      { key: 'H', family: 'H', density: 0, rare: 1 },
    ])
    expect(pullRareWreck(s, GID, ctx)).toBe('wreck-rare-h-hi')
    expect(weekendWreckDensityOf(s, GID)).toBe(50)
  })

  it('多族普通与稀有桶经过两次存读往返不丢；稀有轮不扣普通桶', () => {
    let s = fresh()
    injectWeekendWreck(s, GID, 100, 'H')
    injectWeekendWreck(s, GID, 200, 'R')
    injectWeekendRareWreck(s, GID, 'ink-main', 1, 'H')
    injectWeekendRareWreck(s, GID, 'corona-converge', 1, 'R')
    const initial = s.weekendWrecks
    for (let i = 0; i < 2; i++) s = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(s.weekendWrecks).toEqual(initial)
    expect(new Set([pullRareWreck(s, GID, ctx), pullRareWreck(s, GID, ctx)])).toEqual(new Set(['wreck-rare-h-hi', 'wreck-rare-r-inv']))
    expect(weekendWreckDensityOf(s, GID)).toBe(300)
    expect(weekendRareWreckCountOf(s, GID)).toBe(0)
    expect(chargeWeekendWreckByVolume(s, GID, 500, 'R')).toBe(200)
    expect(weekendWreckDensityOf(s, GID)).toBe(100)
  })

  it('旧 R 桶与未知桶按原值迁移，不按当前活动族猜；迁移幂等', () => {
    const s = fresh()
    const raw = JSON.parse(serializeSaveFile(s, 0))
    raw.state.weekendWrecks = {
      [GID]: { density: 240, decayAccMs: 12 * HOUR, family: 'R', rare: 2, rareBy: { 'corona-converge': 2 } },
      unknown: { density: 100, decayAccMs: 0 },
    }
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.weekendWrecks?.[GID]?.byFamily.R).toEqual({ density: 240, decayAccMs: 12 * HOUR, rare: 2, rareBy: { 'corona-converge': 2 } })
    expect(back.weekendWrecks?.unknown?.byFamily['?']).toEqual({ density: 100, decayAccMs: 0 })
    expect(weekendWreckDensityOf(back, GID)).toBe(180)
    expect(weekendRareWreckCountOf(back, GID)).toBe(2)
    expect(loadSaveFile(serializeSaveFile(back, 0)).state.weekendWrecks).toEqual(back.weekendWrecks)
  })

  it('未知来源桶可捞入侵残骸，新族注入不改变其归属', () => {
    const s = fresh()
    injectWeekendWreck(s, GID, 200)
    injectWeekendWreck(s, GID, 1, 'R')
    expect(s.weekendWrecks?.[GID]?.byFamily['?']?.density).toBe(200)
    const pick = pullOneWreck(s, ctx, GID, 0)!
    expect(['wreck-h-hi', 'wreck-r-inv']).toContain(pick.itemId)
    expect(weekendWreckDensityOf(s, GID)).toBeLessThan(201)
  })

  it('极老未知档只记箱子总数，无来源卡也能打捞且只扣一件', () => {
    const s = fresh()
    const raw = JSON.parse(serializeSaveFile(s, 0))
    raw.state.weekendWrecks = { [GID]: { density: 0, decayAccMs: 0, rare: 2 } }
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(weekendRareWreckCountOf(back, GID)).toBe(2)
    const first = pullRareWreck(back, GID, ctx)!
    expect(ctx.items.has(first)).toBe(true)
    expect(weekendRareWreckCountOf(back, GID)).toBe(1)
    expect(pullRareWreck(back, GID, ctx)).toBe(first)
    expect(back.weekendWrecks?.[GID]).toBeUndefined()
  })

  it('旧单桶的混族箱子按来源卡迁回各自族，普通量保留原标签', () => {
    const s = fresh()
    const raw = JSON.parse(serializeSaveFile(s, 0))
    raw.state.weekendWrecks = { [GID]: { density: 800, decayAccMs: 0, family: 'R',
      rare: 2, rareBy: { 'ink-main': 1, 'corona-converge': 1 } } }
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(weekendWreckPoolsOf(back, GID)).toEqual([
      { key: 'R', family: 'R', density: 800, rare: 1 },
      { key: 'H', family: 'H', density: 0, rare: 1 },
    ])
    expect(weekendRareWreckCountOf(back, GID)).toBe(2)
    expect(loadSaveFile(serializeSaveFile(back, 0)).state.weekendWrecks).toEqual(back.weekendWrecks)
  })

  it('非法族与非有限数的脏桶被丢弃；合法桶独立保留', () => {
    const s = fresh()
    const raw = JSON.parse(serializeSaveFile(s, 0))
    raw.state.weekendWrecks = { [GID]: { byFamily: {
      R: { density: 5, decayAccMs: 0 }, Z: { density: 8, decayAccMs: 0 }, H: { density: 8, decayAccMs: -1 },
    } } }
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(Object.keys(back.weekendWrecks![GID]!.byFamily)).toEqual(['R'])
    advanceWeekendWreckDecay(back, WEEKEND_WRECK_DECAY_MS)
    expect(back.weekendWrecks?.[GID]).toBeUndefined()
  })

  it('货仓装不下的普通/稀有批次保留在原桶；整数尾轮也不超载', () => {
    const s = fresh()
    injectWeekendWreck(s, GID, 100, 'R')
    const before = structuredClone(s.weekendWrecks)
    const ordinary = pullOneWreck(s, ctx, GID, 0, 0)!
    expect(ordinary.volumeM3).toBeGreaterThan(0)
    expect(s.weekendWrecks).toEqual(before)
    const partial = pullOneWreck(s, ctx, GID, 0, 5)!
    expect(partial.volumeM3).toBe(5)
    expect(weekendWreckDensityOf(s, GID)).toBe(95)
    injectWeekendRareWreck(s, GID, 'corona-converge', 1, 'R')
    const rareBefore = structuredClone(s.weekendWrecks)
    expect(pullOneWreck(s, ctx, GID, 0, 29)?.itemId).toBe('wreck-rare-r-inv')
    expect(s.weekendWrecks).toEqual(rareBefore)
    expect(pullOneWreck(s, ctx, GID, 0, 30)?.volumeM3).toBe(30)
    expect(weekendRareWreckCountOf(s, GID)).toBe(0)
    const tail = fresh()
    injectWeekendWreck(tail, GID, 0.6, 'R')
    pullOneWreck(tail, ctx, GID, 0, 0.8)
    expect(weekendWreckDensityOf(tail, GID)).toBe(0.6)
  })

  it.each(['pilot', 'ai'] as const)('%s 满舱自动返航，不丢入侵残骸与箱子', (owner) => {
    const s = fresh()
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    s.skills.trained['ai-expert'] = 1
    s.standingsEarned = { dsi: 100 }
    const sid = owner === 'pilot' ? s.shipId : addShipToFleet(s, 'sh-thresher')
    const salvager = [...ctx.modules.values()].find((m) => m.slot === 'salvager')!.id
    s.fleet[sid]!.fitted = { high: [salvager], mid: [], low: [] }
    if (owner === 'pilot') expect(startSalvageOp(s, GID, ctx).ok).toBe(true)
    else {
      s.aiCores.basic = 1
      expect(assignAiSalvage(s, sid, 'basic', GID, ctx).ok).toBe(true)
      const task = s.aiAssignments[sid]!.task
      if (task.kind !== 'salvage') throw new Error('夹具不是打捞任务')
      task.phase = 'salvaging'
    }
    s.fleet[sid]!.cargo['wreck-r-inv'] = Math.ceil(cargoCapacityM3Of(s, ctx, sid))
    injectWeekendWreck(s, GID, 100, 'R')
    injectWeekendRareWreck(s, GID, 'corona-converge', 1, 'R')
    const before = structuredClone(s.weekendWrecks)
    const cycle = salvagerCyclesOf(s, ctx, sid)[0]!
    if (owner === 'pilot') {
      advanceSalvageOp(s, cycle, ctx)
      expect(s.salvaging.phase).toBe('returning')
    } else {
      advanceAi(s, Math.ceil(cycle / aiEfficiency(s, ctx, 'basic')), ctx)
      expect(s.aiAssignments[sid]!.task.phase).toBe('returning')
    }
    expect(s.weekendWrecks).toEqual(before)
  })
})
