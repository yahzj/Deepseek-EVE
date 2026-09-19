/**
 * v23 序章·苏醒（2026-09-05 船长拍板）：prologue 新档默认（零资金/鲣鱼带伤/无预置炮台弹药）
 * 与 v22→v23 迁移（补 onboarding/importantTasks）回归测试。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, DEFAULT_START_ISK, serializeSaveFile, loadSaveFile } from '../src/index'
import type { GameState } from '../src/state'
import { CURRENT_STATE_VERSION } from '../src/state'

describe('v23 序章·苏醒', () => {
  it('prologue 新档：零资金、鲣鱼默认驾驶且带 80% 损伤、沙猫在库、无预置炮台弹药、onboarding step 0', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
    expect(s.version).toBe(CURRENT_STATE_VERSION)
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

  it('经典开局（默认）：历史行为不变（10k 资金/沙猫/预置炮台与弹药），序章按「已完成」计', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.wallet.isk).toBe(DEFAULT_START_ISK)
    expect(s.shipId).toBe('sandcat')
    expect(s.moduleBay['mod-turret-kin-1']).toBe(1)
    expect(s.warehouse.items['ammo-kinetic-l']).toBe(60)
    // 2026-09-17 教程重做：经典开局/老档不再有「教程未开始」这一态 ⇒ 一律 99（见 OnboardingState）
    expect(s.onboarding.step).toBe(99)
  })

})
