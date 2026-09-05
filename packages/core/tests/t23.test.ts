/**
 * v23 序章·苏醒（2026-09-05 船长拍板）：prologue 新档默认（零资金/隼枭带伤/无预置炮台弹药）
 * 与 v22→v23 迁移（补 onboarding/importantTasks）回归测试。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, DEFAULT_START_ISK, serializeSaveFile, loadSaveFile } from '../src/index'
import type { GameState } from '../src/state'

describe('v23 序章·苏醒', () => {
  it('prologue 新档：零资金、隼枭默认驾驶且带 80% 损伤、沙猫在库、无预置炮台弹药、onboarding step 0', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    expect(s.version).toBe(24)
    expect(s.wallet.isk).toBe(0)
    expect(s.shipId).toBe('sh-falconet')
    expect(s.fleet['sh-falconet']!.durability).toBe(0.8)
    expect(s.fleet['sh-falconet']!.armorPct).toBe(0.8)
    expect(s.fleet['sandcat']!.durability).toBe(1)
    expect(Object.keys(s.moduleBay).length).toBe(0)
    expect(Object.keys(s.warehouse.items).length).toBe(0)
    expect(s.onboarding.step).toBe(0)
    expect(Object.keys(s.importantTasks).length).toBe(0)
  })

  it('经典开局（默认）：历史行为不变（10k 资金/沙猫/预置炮台与弹药），onboarding -1', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.wallet.isk).toBe(DEFAULT_START_ISK)
    expect(s.shipId).toBe('sandcat')
    expect(s.moduleBay['mod-turret-kin-1']).toBe(1)
    expect(s.warehouse.items['ammo-kinetic-l']).toBe(60)
    expect(s.onboarding.step).toBe(-1)
  })

  it('v23 旧档读入（v23→v24 迁移）：补 onboarding=-1、importantTasks={} 与 sideTasks 空板，其余无损', () => {
    const v23 = createInitialState({ nowWallMs: 0, seed: 2 }) as unknown as Record<string, unknown>
    delete v23.onboarding
    delete v23.importantTasks
    delete v23.sideTasks
    v23.version = 23
    const loaded = loadSaveFile(serializeSaveFile(v23 as unknown as GameState, 0))
    expect(loaded.state.version).toBe(24)
    expect(loaded.state.onboarding.step).toBe(-1)
    expect(Object.keys(loaded.state.importantTasks)).toEqual([])
    expect(loaded.state.sideTasks).toEqual({ seq: 1, window: 0, resource: [], courier: [] })
    expect(loaded.state.wallet.isk).toBe(DEFAULT_START_ISK)
  })
})
