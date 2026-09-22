/**
 * **产物 → 蓝图反查**（**2026-09-22 船长令**：「**组装机和造船厂需要零件时，提示不是去组装机，而是去市场**」⇒
 * 「**希望提示玩家去组装机生产零件，不要提示去市场**」）。
 *
 * 界面那一支（缺料行提示 + 点击跳转）靠 `blueprintProducingItem` 判定"这东西能不能在这台机器上造出来"；
 * 本文件钉住它的三条口径：**造得出来的查得到** · **矿物这类查不到** · **按 ctx 走缓存**。
 */
import { describe, expect, it } from 'vitest'
import { blueprintProducingItem } from '../src/manufacturing'
import type { BlueprintDef } from '../src/types'
import { makeTestCtx, skill } from './helpers'

/** 两张"产物是物品"的图（零件 / 弹药），一张"产物是装备"的图（`moduleId`，不该进反查表） */
const PART_BP = { id: 'bp-part-x', name: '零件 X 制造', itemId: 'part-x', outputUnits: 10, materials: [], buildSeconds: 8, buildCostIsk: 0 } as unknown as BlueprintDef
const AMMO_BP = { id: 'bp-ammo-x', name: '弹药 X 制造', itemId: 'ammo-x', outputUnits: 100, materials: [], buildSeconds: 8, buildCostIsk: 0 } as unknown as BlueprintDef
const MODULE_BP = { id: 'bp-mod-x', name: '装备 X 制造', moduleId: 'mod-x', materials: [], buildSeconds: 8, buildCostIsk: 0 } as unknown as BlueprintDef

function world() {
  const ctx = makeTestCtx({ skills: [skill('s')], blueprints: [PART_BP, AMMO_BP, MODULE_BP] })
  return { ctx }
}

describe('blueprintProducingItem（产物 → 蓝图反查 · 含缓存）', () => {
  it('"产物是物品"的图查得到（零件 / 弹药都算）', () => {
    const { ctx } = world()
    expect(blueprintProducingItem(ctx, 'part-x')?.id).toBe('bp-part-x')
    expect(blueprintProducingItem(ctx, 'ammo-x')?.id).toBe('bp-ammo-x')
  })

  it('没有产出图的物品（矿物/原材料这类）返回 null ⇒ 界面走原来的"去精炼 / 去市场"两支', () => {
    const { ctx } = world()
    expect(blueprintProducingItem(ctx, 'min-tritanium')).toBeNull()
    expect(blueprintProducingItem(ctx, 'mod-x'), '装备图（moduleId）不进反查表').toBeNull()
  })

  it('按 ctx 缓存：同一目录连查两次拿到同一个对象（工业页上百张卡也能 O(1) 查表）', () => {
    const { ctx } = world()
    expect(blueprintProducingItem(ctx, 'part-x')).toBe(blueprintProducingItem(ctx, 'part-x'))
  })
})
