import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare } from '../src/inventory'
import { advanceRefining, startRecycleRun } from '../src/industry'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { WRECK_GROUPS } from '../src/wreckGroups'
import { RECYCLE_BASE_MODULES, RECYCLE_BATCH_M3, recycleProfileOf, rollRecycleLoot, rollIntactHullLoot } from '../src/salvage'

const ctx = buildSimContext()
const factionGear = new Set(Object.values(FOE_LAIR_GEAR).flat())

describe('普通残骸回调，无势力装备且原有通用件保留', () => {
  it('全部普通组的主题池不收势力装备', () => {
    for (const group of WRECK_GROUPS) {
      const profile = recycleProfileOf(ctx, `wreck-${group.key}`)!
      expect(profile.lairGear).toBeUndefined()
      for (const id of [...profile.theme.modules ?? [], ...profile.theme.mk2 ?? []]) expect(factionGear.has(id), group.key).toBe(false)
    }
    expect(FOE_LAIR_GEAR.H).toContain('mod-lair-web-h')
    expect(FOE_LAIR_GEAR.R).toContain('mod-lair-blink-r')
  })

  it.each(['h-hi','r-inv'])('%s 普通回收恢复默认池和通用MK2，不出势力装备', (key) => {
    const state = createInitialState({ nowWallMs: 0, seed: 424242 })
    const profile = recycleProfileOf(ctx, `wreck-${key}`)!
    expect(profile.theme.modules).toEqual(['mod-shield-pla-2'])
    const loot = rollRecycleLoot(state, ctx, profile, 500_000)
    expect(loot.modules.some((id) => RECYCLE_BASE_MODULES.includes(id))).toBe(true)
    expect(loot.modules).toContain('mod-shield-pla-2')
    expect(loot.modules.length, '不再是每单位10%的替换掉落').toBeLessThan(200)
    for (const id of loot.modules) expect(factionGear.has(id)).toBe(false)
  })

  it.each(['ink-main','corona-converge'])('%s 完好舰体也不绕过限制', (card) => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.moduleBay = {}
    for (let i = 0; i < 100; i++) rollIntactHullLoot(state, ctx, card)
    expect(state.moduleBay['mod-shield-pla-2']).toBeGreaterThan(0)
    expect(Object.keys(state.moduleBay).some(id => RECYCLE_BASE_MODULES.includes(id))).toBe(true)
    for (const id of Object.keys(state.moduleBay)) expect(factionGear.has(id)).toBe(false)
  })

  it.each(['wreck-h-hi','wreck-r-inv'])('%s 真实炉结算不出势力装备及核心', (id) => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.moduleBay = {}
    const before = JSON.stringify(state.aiCores)
    addWare(state, id, RECYCLE_BATCH_M3 * 200)
    expect(startRecycleRun(state, id, 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 205 && state.refineRuns.length; i++) {
      state.gameMs += state.refineRuns[0]!.cycleMs
      advanceRefining(state, ctx)
    }
    expect(state.refineRuns).toHaveLength(0)
    expect(JSON.stringify(state.aiCores)).toBe(before)
    for (const mod of Object.keys(state.moduleBay)) expect(factionGear.has(mod)).toBe(false)
  })
})
