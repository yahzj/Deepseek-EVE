import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet, restoreShipFromWreck } from '../src/fleetBook'
import { cleanShipDamage, rollShipDamage, shipDamageEffects } from '../src/shipDamage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter, wormholeLayerRewardMul } from '../src/wormhole'
import { wormholeEnsureSalvagePiles, wormholeEnsureVeinPiles, wormholeCellCardIdOf } from '../src/wormholeSalvage'
import { gridCellAt } from '../src/wormholeGrid'
import { isRareWreck, wreckItemIdOfCard } from '../src/salvage'
import { FOE_MOUNTS, FOE_MOUNT_IDS } from '../src/foeMounts'
import { foeCapacitorMultiplierOf } from '../src/gravekeeperCombat'
import { noteShipWreck } from '../src/shipWrecks'

const ctx = buildSimContext()
function resource(seed: number, depth: number, place: 'vein' | 'graveyard' | 'ruins', experimental = false) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, 'sh-thresher')
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], seed).ok).toBe(true)
  const run = state.wormhole.run!
  run.depth = depth
  if (experimental) run.expeditionRules = 2
  const cell = gridCellAt(run.grid!, run.grid!.pos)!
  cell.place = place
  cell.piles = []
  delete cell.resourcePilesGenerated
  const generate = () => place === 'vein' ? wormholeEnsureVeinPiles(state, cell) : wormholeEnsureSalvagePiles(state, cell)
  generate()
  return { state, cell, generate }
}

describe('信号空间深层堆数与每堆收益', () => {
  it.each([1, 5, 9])('第%s层矿脉和墓场普通堆各多depth-1，单堆按1.08增长', depth => {
    for (let seed = 1; seed <= 30; seed++) {
      const vein = resource(seed, depth, 'vein')
      expect(vein.cell.piles!.length).toBeGreaterThanOrEqual(depth)
      expect(vein.cell.piles!.length).toBeLessThanOrEqual(depth + 2)
      const grave = resource(seed, depth, 'graveyard')
      const commonId = wreckItemIdOfCard(wormholeCellCardIdOf(grave.state.wormhole.run!, grave.cell))!
      const common = grave.cell.piles!.filter(p => p.itemId === commonId)
      expect(common.length).toBeGreaterThanOrEqual(depth + 2)
      expect(common.length).toBeLessThanOrEqual(depth + 9)
      for (const p of common) {
        expect(p.units).toBeGreaterThanOrEqual(Math.ceil(200 * 1.08 ** (depth - 1) * .8))
        expect(p.units).toBeLessThanOrEqual(Math.ceil(200 * 1.08 ** (depth - 1) * 1.2))
      }
    }
    expect(wormholeLayerRewardMul(depth)).toBeCloseTo(1.08 ** (depth - 1), 12)
    expect(wormholeLayerRewardMul(depth, 2)).toBeCloseTo(1 + .08 * (depth - 1), 12)
  })
  it('墓场稀有判定不随新增普通堆扩增，实验规则及遗迹堆数不变', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const grave = resource(seed, 9, 'graveyard')
      const experimental = resource(seed, 9, 'graveyard', true)
      const rares = (w: typeof grave) => w.cell.piles!.filter(p => isRareWreck(p.itemId))
      expect(rares(grave)).toEqual(rares(experimental))
      expect(grave.cell.piles!.length - experimental.cell.piles!.length).toBe(8)
      const ruins = resource(seed, 9, 'ruins')
      expect(ruins.cell.piles!.length).toBeGreaterThanOrEqual(2)
      expect(ruins.cell.piles!.length).toBeLessThanOrEqual(3)
      expect(resource(seed, 9, 'vein', true).cell.piles!.length).toBeLessThanOrEqual(3)
    }
  })
  it('已生成的堆不被新曲线覆盖，取空后重进与存档往返均不补满', () => {
    const w = resource(7, 5, 'vein')
    const before = structuredClone(w.cell.piles)
    w.generate()
    expect(w.cell.piles).toEqual(before)
    w.cell.piles = []
    w.generate()
    expect(w.cell.piles).toEqual([])
    const loaded = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const cell = gridCellAt(loaded.wormhole.run!.grid!, loaded.wormhole.run!.grid!.pos)!
    wormholeEnsureVeinPiles(loaded, cell)
    expect(cell.piles ?? []).toEqual([])
  })
})

describe('重复战损与旗舰增幅', () => {
  it('同种战损每件乘0.95，超3件及100件无玩法截断，未知类型仍过滤', () => {
    const raw = ['shield', 'shield', 'ghost', 'armor', ...Array(100).fill('range')]
    const clean = cleanShipDamage(raw)!
    expect(clean).toHaveLength(103)
    expect(shipDamageEffects(clean).shield).toBeCloseTo(.95 ** 2, 12)
    expect(shipDamageEffects(clean).range).toBeCloseTo(.95 ** 100, 12)
    expect(shipDamageEffects(clean).cargo).toBe(1)
    expect(raw).toHaveLength(104)
  })
  it('已有六种战损后仍有50%概率新增，候选包含已有类型且不修改输入', () => {
    const previous = ['shield', 'armor', 'hull', 'speed', 'cargo', 'range'] as const
    let added = 0
    for (let seed = 1; seed <= 1000; seed++) {
      const state = createInitialState({ nowWallMs: 0, seed })
      const result = rollShipDamage(state, previous)
      expect(result.slice(0, 6)).toEqual(previous)
      if (result.length === 7) { added++; expect(previous).toContain(result[6]) }
    }
    expect(added).toBeGreaterThan(450)
    expect(added).toBeLessThan(550)
    expect(previous).toHaveLength(6)
  })
  it('重复战损在舰船、残骸、回收快照和读档中不去重、不截断', () => {
    const state = createInitialState({ nowWallMs: 0 })
    const damage = ['range', 'range', 'armor', 'shield', 'range'] as const
    const uid = restoreShipFromWreck(state, { defId: 'sh-thresher', recoveryRules: 2, damagePlugs: [...damage] })
    noteShipWreck(state, { galaxyId: 'galaxy-hub', shipId: 'wreck-test', shipName: 'test', defId: 'sh-thresher', damagePlugs: damage })
    state.wreckLog = [{ seq: 1, shipId: 'log-test', defId: 'sh-thresher', shipName: 'test', cause: 'expedition-lost', galaxyId: 'galaxy-hub', atGameMs: 0,
      recovered: true, damagePlugs: [...damage] }]
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.fleet[uid]!.damagePlugs).toEqual(damage)
    expect(Object.values(loaded.shipWrecks!)[0]!.damagePlugs).toEqual(damage)
    expect(loaded.wreckLog![0]!.damagePlugs).toEqual(damage)
  })
  it('旗舰蓄能每层乘1.25，装填和分武器账本不变', () => {
    const device = FOE_MOUNTS[FOE_MOUNT_IDS.dShieldCapacitor].shieldCapacitor!
    expect(device.damageMul).toBe(1.25)
    const b = { foeShieldCapacitorActive: { boss: true as const }, foeShieldCapacitorAttacks: { 'boss#0': 8 } }
    const foe = { tag: 'boss', foeShieldCapacitor: device }
    expect(foeCapacitorMultiplierOf(b, foe, 0, 'damageMul')).toBeCloseTo(1.25 ** 8, 10)
    expect(foeCapacitorMultiplierOf(b, foe, 0, 'reloadMul')).toBeCloseTo(1.1 ** 8, 10)
    expect(foeCapacitorMultiplierOf(b, foe, 'pd', 'damageMul')).toBe(1)
  })
})
