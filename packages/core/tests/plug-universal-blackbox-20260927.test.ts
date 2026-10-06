/**
 * **通用黑匣 ＋ 材料等价组用例**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**在章鱼人声望商店加入购买通用黑匣的卡片，玩家可以用30声望换一个通用黑匣。
 * （现有的舰船插件蓝图都只要使用任意类型黑匣就可以制作）**」＋「**按500万算价格，只收不卖**」。
 *
 * 钉住四件事：① 兑换扣 30 可支配声望 ⇒ 入物品仓库；不足则一点不动 ② 等价组映射与**组序 = 优先扣除序**
 * ③ 缺料判据按**组内合计** ④ 开工真扣料时**先扣通用黑匣**、退料退**实际扣的那一种**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare, countWare, createInitialState } from '../src/index'
import { cancelManufacturing, materialDisplayIdOf, materialGroupIdsOf, missingMaterials, startManufacturing } from '../src/manufacturing'
import { UNIVERSAL_BLACKBOX_COST, UNIVERSAL_BLACKBOX_ITEM_ID, exchangeUniversalBlackBox } from '../src/plugs'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
/** 真数据里的插件图纸（料单里那一项写的是 `blackbox-h`） */
const BP = 'bp-plug-shield-plate'

function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  s.debugQuick = true
  s.learnedRecipes.push(BP)
  return s
}

describe('通用黑匣（2026-09-27 船长令）', () => {
  it('① 兑换：扣 30 可支配声望 ⇒ 入物品仓库；不足则一枚都不给（可重复换）', () => {
    const s = world()
    expect(UNIVERSAL_BLACKBOX_COST, '价 = 30 点').toBe(30)
    s.standings['dsi'] = UNIVERSAL_BLACKBOX_COST
    const r = exchangeUniversalBlackBox(s)
    expect(r.ok, '够 30 点 ⇒ 换得到').toBe(true)
    expect(s.standings['dsi'], '真扣可支配那本').toBe(0)
    expect(countWare(s, UNIVERSAL_BLACKBOX_ITEM_ID), '入物品仓库').toBe(1)

    const poor = exchangeUniversalBlackBox(s)
    expect(poor.ok, '0 点 ⇒ 拒绝').toBe(false)
    expect(countWare(s, UNIVERSAL_BLACKBOX_ITEM_ID), '拒绝时不动仓库').toBe(1)

    s.standings['dsi'] = UNIVERSAL_BLACKBOX_COST * 2
    expect(exchangeUniversalBlackBox(s).ok, '可无限次兑换').toBe(true)
    expect(countWare(s, UNIVERSAL_BLACKBOX_ITEM_ID), '第二次也进仓库').toBe(2)
    expect(s.standings['dsi']).toBe(UNIVERSAL_BLACKBOX_COST)
  })

  it('② 等价组：旗舰黑匣与通用黑匣互为替代，**组序 = 优先扣除序（先通用）**；组外物品只返回自己', () => {
    // 2026-10-02 每族一件黑匣批（船长令「甲」）：R 族匣 `blackbox-r` 并入同一组（三件互为替代），
    // 组序仍是"通用最先"⇒ 优先扣除序与报名字口径（下面②之补）一个字没变
    const boxGroup = [UNIVERSAL_BLACKBOX_ITEM_ID, 'blackbox-h', 'blackbox-r', 'blackbox-c']
    expect(materialGroupIdsOf('blackbox-h')).toEqual(boxGroup)
    expect(materialGroupIdsOf('blackbox-r'), '光环匣在同一组里').toEqual(boxGroup)
    expect(materialGroupIdsOf(UNIVERSAL_BLACKBOX_ITEM_ID)).toEqual(boxGroup)
    expect(materialGroupIdsOf('min-voidcrystal'), '非组内 ⇒ 一对一').toEqual(['min-voidcrystal'])
  })

  it('③ 缺料判据按组内合计：手上只有通用黑匣也能开工（配方仍具名旗舰黑匣，数据一个字没改）', () => {
    const s = world()
    const bp = ctx.blueprints.get(BP)!
    expect(bp.materials.some((m) => m.itemId === 'blackbox-h'), '配方照旧写旗舰黑匣').toBe(true)
    const spec = { materials: bp.materials, buildSeconds: bp.buildSeconds, buildCostIsk: bp.buildCostIsk }
    /** 除黑匣外都给足，黑匣那一项只给**通用**黑匣 */
    for (const m of bp.materials) {
      if (m.itemId === 'blackbox-h') continue
      addWare(s, m.itemId, m.count * 2)
    }
    expect(missingMaterials(s, ctx, spec).length, '什么都不给 ⇒ 缺一堆').toBeGreaterThan(0)
    /**
     * **报名字走"优先那一种"**（**2026-09-29 船长报障**：「组装机中，舰船插件材料消耗列表中还是显示了
     * 墨潮黑匣（应该显示通用黑匣）」）：一件黑匣都没有时，缺口提示该说**通用黑匣**（组内第一种 =
     * 优先扣除序的第一种 = "该去弄的那一种"），而不是配方数据里写的 `blackbox-h`。
     */
    expect(
      missingMaterials(s, ctx, spec).some((t) => t.startsWith('通用黑匣')),
      '缺口提示报通用黑匣',
    ).toBe(true)
    addWare(s, UNIVERSAL_BLACKBOX_ITEM_ID, 1)
    expect(missingMaterials(s, ctx, spec), '通用黑匣顶上 ⇒ 不缺料').toEqual([])
  })

  it('②之补 报名字规则：有哪种报哪种，都没有报组内第一种（界面材料行与缺口提示同一把尺）', () => {
    const s = world()
    expect(materialDisplayIdOf(s, 'blackbox-h'), '都没有 ⇒ 组内第一种（通用黑匣）').toBe(UNIVERSAL_BLACKBOX_ITEM_ID)
    addWare(s, 'blackbox-h', 2)
    expect(materialDisplayIdOf(s, 'blackbox-h'), '只有旗舰 ⇒ 报旗舰').toBe('blackbox-h')
    addWare(s, UNIVERSAL_BLACKBOX_ITEM_ID, 1)
    expect(materialDisplayIdOf(s, 'blackbox-h'), '两种都有 ⇒ 仍报通用（优先扣除序）').toBe(UNIVERSAL_BLACKBOX_ITEM_ID)
    expect(materialDisplayIdOf(s, 'min-voidcrystal'), '组外 ⇒ 只返回自己').toBe('min-voidcrystal')
  })

  it('②之补二 光环匣（`blackbox-r`）同样顶料、同样按"有哪种报哪种"报名字（2026-10-02 船长令「甲」）', () => {
    const s = world()
    addWare(s, 'blackbox-r', 1)
    expect(materialDisplayIdOf(s, 'blackbox-h'), '手上只有光环匣 ⇒ 报光环匣（不是配方里写的墨潮匣）').toBe('blackbox-r')
  })

  it('④ 开工真扣料：两种黑匣都有时**先扣通用黑匣**；取消退料退**实际扣的那一种**', () => {
    const s = world()
    const bp = ctx.blueprints.get(BP)!
    for (const m of bp.materials) addWare(s, m.itemId, m.count * 2)
    addWare(s, UNIVERSAL_BLACKBOX_ITEM_ID, 1)
    const oldBox = countWare(s, 'blackbox-h')
    const start = startManufacturing(s, BP, 'pilot', ctx)
    expect(start.ok, `开工成功（错误：${start.ok ? '' : start.error}）`).toBe(true)
    expect(countWare(s, UNIVERSAL_BLACKBOX_ITEM_ID), '先扣通用黑匣').toBe(0)
    expect(countWare(s, 'blackbox-h'), '旗舰黑匣原封不动').toBe(oldBox)
    const run = s.manufacturingRuns[s.manufacturingRuns.length - 1]!
    expect(run.spentMaterials?.some((x) => x.itemId === UNIVERSAL_BLACKBOX_ITEM_ID), '账本记的是实际扣的那种').toBe(true)
    /** 取消 ⇒ 退料：通用黑匣原样退回，不会退成旗舰黑匣 */
    expect(cancelManufacturing(s, ctx, run.id).ok, '取消成功').toBe(true)
    expect(countWare(s, UNIVERSAL_BLACKBOX_ITEM_ID), '退料退实际那种（通用）').toBe(1)
    expect(countWare(s, 'blackbox-h'), '旗舰黑匣始终没被动过').toBe(oldBox)
  })
})
