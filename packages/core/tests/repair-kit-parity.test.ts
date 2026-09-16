/**
 * 修理组件「两路径一致」契约（**2026-09-13 船长两条指令**）：
 *   ①「将修理组件的回血效果，同步到和使用船体维修装置时一致」⇒ 组件基数 民用 30→**5**、军用 70→**10**
 *     （对齐民用装置 5 / MK1 10 的每跳值）；
 *   ②「船体维修装置修改为也吃舰体快修学」⇒ 装置每跳 = 装置值 × 舰体快修学。
 *
 * 本文件用**真内容**（`buildSimContext`）守住：数值不漂（5/10）· 装置吃技能 · 直接使用基数同为 5/10。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, MODULES, SKILLS } from '@whale/data'
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
    expect(quickRepairFactor(lv5.state, ctx)).toBe(1.25) // 2026-09-13 削弱：每级 5% ⇒ 满级 ×1.25（原 ×1.5）
    const r5 = preloadRepairFor(lv5.state, ctx, lv5.uid, 10 * REPAIR_PULSE_MS)
    expect(r5?.units[0]?.armorPerPulse).toBe(23) // 18 × 1.25 = 22.5 → round 23
    expect(r5?.units[0]?.hullPerPulse).toBe(23)
  })

  it('维修工程学（rank 3）同效果叠加：两技能各 +5%/级，装置每跳同样计入', () => {
    expect(SKILLS.find((s) => s.id === 'repair-engineering')?.rank).toBe(3) // 2026-09-13 船长：rank 2 → 3
    const { state, uid } = world(5, 'mod-hullrep-2')
    state.skills.trained['repair-engineering'] = 5
    expect(quickRepairFactor(state, ctx)).toBe(1.5) // 1 + 0.05×5（快修学） + 0.05×5（维修工程学）
    const r = preloadRepairFor(state, ctx, uid, 10 * REPAIR_PULSE_MS)
    expect(r?.units[0]?.armorPerPulse).toBe(27) // 18 × 1.5
  })

  /**
   * **2026-09-16 船长「统一吃」**：「维修量（是否吃额外护甲/结构加成）」⇒ 装置每跳与修理组件**同一把尺**：
   * 每跳值再乘**层容量增幅**（满值 ÷ 档案基础值）——含装备件与「船体加固理论」「重装舰操作」。
   */
  it('装置每跳也吃**层容量增幅**（统一吃）：满技能下再乘 装甲/结构容量加成', () => {
    // 船体加固理论满级（甲/结构容量 +20%）⇒ 层容量增幅 ×1.2
    const withHullSkill = world(5, 'mod-hullrep-2')
    withHullSkill.state.skills.trained['repair-engineering'] = 5
    withHullSkill.state.skills.trained['hull-upgrades'] = 5
    const caps = hullLayerCaps(withHullSkill.state, ctx, withHullSkill.uid)!
    expect(caps.capA / caps.baseA).toBeCloseTo(1.2, 6)
    const r = preloadRepairFor(withHullSkill.state, ctx, withHullSkill.uid, 10 * REPAIR_PULSE_MS)
    // 18 × 1.5（技能）× 1.2（层容量增幅）= 32.4 → 32
    expect(r?.units[0]?.armorPerPulse).toBe(32)
    expect(r?.units[0]?.hullPerPulse).toBe(32)

    // 装上装甲增厚板（armorHpBonus）⇒ **只有装甲那一路**再放大（分层生效，与组件同口径）
    const armored = world(5, 'mod-hullrep-2')
    armored.state.skills.trained['hull-upgrades'] = 5
    const plate = MODULES.find((m) => (m.armorHpBonus ?? 0) > 0 && m.slot === 'armor')
    expect(plate, '真数据里应有带 armorHpBonus 的甲件').toBeTruthy()
    addModule(armored.state, plate!.id, 1)
    expect(fitModule(armored.state, plate!.id, ctx).ok).toBe(true)
    const caps2 = hullLayerCaps(armored.state, ctx, armored.uid)!
    const r2 = preloadRepairFor(armored.state, ctx, armored.uid, 10 * REPAIR_PULSE_MS)
    const wantArmor = Math.round(18 * quickRepairFactor(armored.state, ctx) * (caps2.capA / caps2.baseA))
    const wantHull = Math.round(18 * quickRepairFactor(armored.state, ctx) * (caps2.capH / caps2.baseH))
    expect(r2?.units[0]?.armorPerPulse, '装甲那一路按装甲容量增幅').toBe(wantArmor)
    expect(r2?.units[0]?.hullPerPulse, '结构那一路按结构容量增幅').toBe(wantHull)
    expect(caps2.capA / caps2.baseA).toBeGreaterThan(caps2.capH / caps2.baseH) // 甲件只加装甲
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
