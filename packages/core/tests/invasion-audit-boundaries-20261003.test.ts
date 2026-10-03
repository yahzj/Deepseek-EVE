import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addWare } from '../src/inventory'
import { consumableStockOf, INVASION_BEACON_ITEM_ID, useInvasionBeacon } from '../src/consumables'
import { weekendSettleAndGrant } from '../src/weekendBattle'
import { openWeekendMakeupIfDue, WEEKEND_MAKEUP_FIRST_WALL_MS } from '../src/weekendCompensation'
import { injectWeekendRareWreck, injectWeekendWreck } from '../src/salvage'
import { invasionWreckRowsOf, wreckAiHostOf, wreckCardSequenceOf } from '../../../apps/desktop/src/renderer/src/pages/wreckCards'

const ctx = buildSimContext()
const GID = 'galaxy-vault'
const now = new Date(2026, 9, 3, 20).getTime()
function ready() {
  const s = createInitialState({ nowWallMs: now, seed: 11 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  addWare(s, INVASION_BEACON_ITEM_ID, 2)
  return s
}

describe('信号发射器边界与连续换场', () => {
  it.each(['', 'no-such-galaxy'])('非法指定目标 %s 不扣道具、不换事件、不结旧账', (galaxyId) => {
    const s = ready()
    s.weekendEvent = { seq: 1, startedAtWallMs: now, endedAtWallMs: now,
      coreId: GID, peripheryIds: ['galaxy-redring'], family: 'H', contributed: { 'galaxy-redring': 1 } }
    const before = structuredClone(s)
    expect(useInvasionBeacon(s, ctx, { galaxyId }).ok).toBe(false)
    expect(s).toEqual(before)
  })

  it.each([
    ['战斗', (s: GameState) => { s.expedition.battle = {} as never }],
    ['洞内', (s: GameState) => { s.wormhole.run = {} as never }],
    ['返航', (s: GameState) => { s.transit.active = true }],
    ['远征在途', (s: GameState) => { s.expedition.active = true }],
  ] as const)('%s 的不可中断状态拒绝点火且不消耗', (_, lock) => {
    const s = ready()
    lock(s)
    const before = structuredClone(s)
    expect(useInvasionBeacon(s, ctx, { galaxyId: GID }).ok).toBe(false)
    expect(s).toEqual(before)
  })

  it.each(['mining', 'salvaging'] as const)('%s 期间可以后台点火，作业原样继续', (kind) => {
    const s = ready()
    s[kind].active = true
    const job = structuredClone(s[kind])
    expect(useInvasionBeacon(s, ctx, { galaxyId: GID }).ok).toBe(true)
    expect(s[kind]).toEqual(job)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID)).toBe(1)
  })

  it('旧场奖励先结清，再连续点火；既有残骸桶与旧快照不被清掉', () => {
    const s = ready()
    s.weekendEvent = { seq: 1, startedAtWallMs: now - 3_600_000, endedAtWallMs: now,
      coreId: GID, peripheryIds: ['galaxy-redring'], family: 'H', contributed: { 'galaxy-redring': 1 } }
    const control = structuredClone(s)
    weekendSettleAndGrant(control, ctx, now)
    injectWeekendWreck(s, GID, 100, 'H')
    expect(useInvasionBeacon(s, ctx, { galaxyId: GID }).ok).toBe(true)
    expect(s.wallet).toEqual(control.wallet)
    expect(s.standings).toEqual(control.standings)
    expect(s.weekendLastResult).toEqual(control.weekendLastResult)
    expect(s.weekendEvent?.seq).toBe(2)
    expect(s.weekendWrecks?.[GID]?.byFamily.H?.density).toBe(100)
    const after = structuredClone(s)
    expect(useInvasionBeacon(s, ctx, { galaxyId: GID }).ok).toBe(false)
    expect(s).toEqual(after)
  })

  it('补偿补场替换本拍刚结束的旧场前，先发完旧场奖励并留快照', () => {
    const s = ready()
    s.standingsEarned = { dsi: 100 }
    s.weekendCompensation = { track: 'makeup', decidedAtWallMs: now }
    s.weekendEvent = { seq: 1, startedAtWallMs: now, endedAtWallMs: WEEKEND_MAKEUP_FIRST_WALL_MS,
      coreId: GID, peripheryIds: ['galaxy-redring'], family: 'H', contributed: { 'galaxy-redring': 1 } }
    const control = structuredClone(s)
    weekendSettleAndGrant(control, ctx, WEEKEND_MAKEUP_FIRST_WALL_MS)
    expect(openWeekendMakeupIfDue(s, ctx, WEEKEND_MAKEUP_FIRST_WALL_MS)).toBe(true)
    expect(s.weekendEvent?.family).toBe('R')
    expect(s.wallet).toEqual(control.wallet)
    expect(s.weekendLastResult).toEqual(control.weekendLastResult)
  })
})

it('族卡与详情同源：名称各自对应物品，存量降序，稀有空量卡仍在', () => {
  const s = ready()
  injectWeekendWreck(s, GID, 100, 'H')
  injectWeekendWreck(s, GID, 200, 'R')
  injectWeekendRareWreck(s, GID, 'corona-converge', 1, 'R')
  const rows = invasionWreckRowsOf(s, ctx, GID)
  expect(rows.map((r) => r.key)).toEqual(['R', 'H'])
  expect(rows[0]!.name).toBe(ctx.items.get('wreck-r-inv')!.name)
  expect(rows[1]!.name).toBe(ctx.items.get('wreck-h-hi')!.name)
  expect(rows[0]!.rare).toBe(1)
  const sequence = wreckCardSequenceOf({ shipWreckCount: 1, invasionWreckM3: 300 })
  expect(sequence).toEqual(['ship-wrecks', 'invasion', 'all'])
  expect(wreckAiHostOf(sequence)).toBe('ship-wrecks')
})
