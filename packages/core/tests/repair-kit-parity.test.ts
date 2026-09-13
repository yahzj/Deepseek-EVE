/**
 * 修理组件「两路径一致」契约（**2026-09-13 船长两条指令**）：
 *   ①「将修理组件的回血效果，同步到和使用船体维修装置时一致」⇒ 组件基数 民用 30→**5**、军用 70→**10**
 *     （对齐民用装置 5 / MK1 10 的每跳值）；
 *   ②「船体维修装置修改为也吃舰体快修学」⇒ 装置每跳 = 装置值 × 舰体快修学。
 *
 * 本文件用**真内容**（`buildSimContext`）守住：数值不漂（5/10）· 装置吃技能 · 直接使用基数同为 5/10。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, MODULES } from '@whale/data'
import type { SimContext } from '../src/types'
import { addShipToFleet, createInitialState } from '@whale/core'
import { addModule, fitModule } from '../src/equipment'
import { hullLayerCaps, useOneRepairKit } from '../src/shipyard'
import { preloadRepairFor, REPAIR_PULSE_MS } from '../src/combat'
import { quickRepairFactor } from '../src/repair'

const ctx = buildSimContext() as SimContext

function world(skillLv: number, moduleId?: string) {
  const state = createInitialState({ nowWallMs: 0, seed: 20260913 })
  const uid = addShipToFleet(state, 'sandcat')
  state.shipId = uid
  state.skills.trained['hull-quick-repair'] = skillLv
  if (moduleId) {
    addModule(state, moduleId, 1)
    expect(fitModule(state, moduleId, ctx).ok).toBe(true)
  }
  state.warehouse.items['repairkit-civ'] = 500
  state.warehouse.items['repairkit-mil'] = 500
  return { state, uid }
}

describe('修理组件回血口径（2026-09-13 船长定）', () => {
  it('数值锚：民用 5 / 军用 10（对齐民用装置 5 / MK1 10 的每跳值）', () => {
    expect(ctx.items.get('repairkit-civ')?.repairRestore).toBe(5)
    expect(ctx.items.get('repairkit-mil')?.repairRestore).toBe(10)
    // 装置侧每跳值不变：民用 5 / MK1 10 / MK2 18
    const per = (id: string): number => MODULES.find((m) => m.id === id)?.repairArmorHp ?? 0
    expect(per('mod-hullrep-civ')).toBe(5)
    expect(per('mod-hullrep-1')).toBe(10)
    expect(per('mod-hullrep-2')).toBe(18)
  })

  it('船体维修装置也吃舰体快修学：每跳 = 装置值 × 系数（0 级 ×1 / 满级 ×1.5）', () => {
    const lv0 = world(0, 'mod-hullrep-civ')
    expect(quickRepairFactor(lv0.state, ctx)).toBe(1)
    const r0 = preloadRepairFor(lv0.state, ctx, lv0.uid, 10 * REPAIR_PULSE_MS)
    expect(r0?.units[0]?.armorPerPulse).toBe(5) // 5 × 1
    expect(r0?.units[0]?.hullPerPulse).toBe(5)

    const lv5 = world(5, 'mod-hullrep-2')
    expect(quickRepairFactor(lv5.state, ctx)).toBe(1.5)
    const r5 = preloadRepairFor(lv5.state, ctx, lv5.uid, 10 * REPAIR_PULSE_MS)
    expect(r5?.units[0]?.armorPerPulse).toBe(27) // 18 × 1.5
    expect(r5?.units[0]?.hullPerPulse).toBe(27)
  })

  it('直接使用同基数、同吃技能：一枚民用件回 round(5 × 层容量增幅 × 系数) 点', () => {
    for (const lv of [0, 5]) {
      const { state, uid } = world(lv)
      const caps = hullLayerCaps(state, ctx, uid)!
      state.fleet[uid]!.cargo['repairkit-civ'] = 5 // 手动使用只认**货舱**（仓库是自动修理的兜底来源）
      state.fleet[uid]!.durability = 0.5
      state.fleet[uid]!.armorPct = 0.5
      expect(useOneRepairKit(state, ctx).ok).toBe(true)
      const clamp = (x: number): number => Math.min(1, x)
      const expectHull =
        Math.round(clamp(0.5 + Math.round(5 * (caps.capH / caps.baseH) * quickRepairFactor(state, ctx)) / caps.capH) * 1000) / 1000
      const expectArmor =
        Math.round(clamp(0.5 + Math.round(5 * (caps.capA / caps.baseA) * quickRepairFactor(state, ctx)) / caps.capA) * 1000) / 1000
      expect(state.fleet[uid]!.durability).toBeCloseTo(expectHull, 3)
      expect(state.fleet[uid]!.armorPct ?? 1).toBeCloseTo(expectArmor, 3)
      // 一次只吃一枚（民用优先），另一档原封不动
      expect(state.warehouse.items['repairkit-mil']).toBe(500)
      expect(state.fleet[uid]!.cargo['repairkit-civ']).toBe(4)
    }
  })
})
