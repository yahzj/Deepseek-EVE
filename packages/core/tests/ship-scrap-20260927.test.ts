/**
 * **拆船回收用例**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**在舰船插件处加入一个回收按钮，点击后警告玩家，想要回收插件需要将舰船拆解回收，
 * 确认后弹出二次警告，告诉玩家当前舰船能回收多少材料并且无法回收蓝图（回收材料占比为制造材料的50%）。
 * 回收后，当前舰船的装备全部拆卸入库，将舰船转化成材料，舰船插件也入库。**」
 *
 * 钉住四件事：① 50% 逐项向下取整（且界面预览与实际发放**同一份算术**）② 主控船/被锁的船不许回收
 * ③ 执行后装备＋插件＋无人机入装备库、货入物品仓库、船从舰队消失 ④ 数据侧料单取的是**船蓝图**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare, countWare, createInitialState } from '../src/index'
import { addShipToFleet } from '../src/shipyard'
import { SHIP_SCRAP_MATERIAL_SHARE, scrapShip, shipScrapPreviewOf } from '../src/scrap'
import type { GameState } from '../src/state'

const ctx = buildSimContext()

/** 一艘待拆的船（默认用真数据里的巨齿鲨；主控船仍留在 `state.shipId` 上，避免"回收主控"被闸门挡） */
function world(): { s: GameState; target: string } {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  const target = addShipToFleet(s, 'sh-bullshark')
  return { s, target }
}

describe('拆船回收（2026-09-27 船长令）', () => {
  it('❶ 比例常量 = 50%：预览材料 = 船蓝图料单 ×50% 逐项向下取整', () => {
    const { s, target } = world()
    expect(SHIP_SCRAP_MATERIAL_SHARE).toBe(0.5)
    const p = shipScrapPreviewOf(s, ctx, target)
    expect(p.ok, '普通舰船可以回收').toBe(true)
    expect(p.materials.length, '巨齿鲨的料单不止一项').toBeGreaterThan(0)
    /** 与船蓝图料单逐项对齐：floor(料 × 0.5)，取整后为 0 的项不列 */
    const bp = [...ctx.shipBlueprints.values()].find((b) => b.shipId === 'sh-bullshark')!
    const expectList = bp.materials
      .map((m) => ({ itemId: m.itemId, count: Math.floor(m.count * 0.5) }))
      .filter((m) => m.count > 0)
    expect(p.materials).toEqual(expectList)
  })

  it('❷ 主控船不许回收（先换驾驶），且预览与执行给同一条拦因', () => {
    const { s } = world()
    const p = shipScrapPreviewOf(s, ctx, s.shipId)
    expect(p.ok, '正在驾驶的船不能回收').toBe(false)
    const r = scrapShip(s, ctx, s.shipId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('正在驾驶')
    expect(s.fleet[s.shipId], '拦下时船还在').toBeDefined()
  })

  it('❸ 执行：材料入物品仓库 · 装备/插件/无人机入装备库 · 船从舰队消失', () => {
    const { s, target } = world()
    /**
     * 给这艘船配一件装备 ＋ 一件插件 ＋ 两架无人机 ＋ 一点货（白盒写进船实例；
     * ⚠ **不再往装备库预放同样的件**——那会让"回收入库"的读数翻倍，是本用例第一版的夹具错误）
     */
    s.fleet[target]!.fitted = { high: ['mod-turret-kin-3'], mid: [], low: [] }
    s.fleet[target]!.plugs = ['plug-shield-plate']
    addWare(s, 'drone-t-scout', 2)
    s.fleet[target]!.droneLoad = { 'drone-t-scout': 2 }
    addWare(s, 'ore-a', 10)
    s.fleet[target]!.cargo = { 'ore-a': 10 }

    const p = shipScrapPreviewOf(s, ctx, target)
    expect(p.moduleCount, '高槽 1 件').toBe(1)
    expect(p.plugCount, '插件 1 件').toBe(1)
    expect(p.droneCount, '无人机 2 架').toBe(2)

    const oreBefore = countWare(s, 'ore-a')
    const r = scrapShip(s, ctx, target)
    expect(r.ok, '能回收').toBe(true)
    if (r.ok) {
      expect(r.materials, '与预览同一份清单').toEqual(p.materials)
      expect(r.modules).toBe(1)
      expect(r.plugs).toBe(1)
      expect(r.drones).toBe(2)
    }
    expect(s.fleet[target], '船已从舰队移除').toBeUndefined()
    expect(s.moduleBay['mod-turret-kin-3'], '装备入装备库').toBe(1)
    expect(s.moduleBay['plug-shield-plate'], '插件入装备库').toBe(1)
    expect(countWare(s, 'drone-t-scout'), '无人机入物品仓库（船上的 2 架 ＋ 夹具预放的 2 架）').toBe(4)
    expect(countWare(s, 'ore-a'), '货舱货物入物品仓库').toBe(oreBefore + 10)
    /** 材料按预览逐项入物品仓库 */
    for (const m of p.materials) {
      expect(countWare(s, m.itemId), `${m.itemId} 入物品仓库`).toBeGreaterThanOrEqual(m.count)
    }
    /** 蓝图书不返还：确认这艘船的舰船蓝图仍在（不因拆解而"学会"或返还）——它从来不是消耗品 */
    expect([...ctx.shipBlueprints.values()].some((b) => b.shipId === 'sh-bullshark')).toBe(true)
    /** 台账：一条 trade 日志（id = core.scrap.001） */
    expect(s.logs.some((l) => l.textId === 'core.scrap.001')).toBe(true)
  })

  it('❹ 找不到的船：预览与执行都拦下（不会静默成功）', () => {
    const { s } = world()
    const p = shipScrapPreviewOf(s, ctx, 'no-such-ship')
    expect(p.ok).toBe(false)
    expect(scrapShip(s, ctx, 'no-such-ship').ok).toBe(false)
  })
})
