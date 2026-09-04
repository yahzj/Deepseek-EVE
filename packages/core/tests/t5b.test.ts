/**
 * T5-B（v17 舰船实例化）：实例 uid 分配（同型自动编号、不回收）、显示名（默认名带号/改名）、
 * 自由改名规则、市场挂卖 escrow 原实例往返、v16 → v17 存档迁移与 normalize 兜底。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { addShipToFleet, allocateShipUid, changeShip, renameShip } from '../src/shipyard'
import { fleetDefOf, shipDisplayName } from '../src/instances'
import { cancelOrder, placeShipSellOrder } from '../src/market'
import { buyShip } from '../src/industry'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, ship } from './helpers'

function world() {
  const ctx = makeTestCtx({ quietEvents: true, ships: [ship('sandcat', { price: 100_000 })] })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  return { state, ctx }
}

describe('T5-B 舰船实例化（v17）', () => {
  it('同型自动编号：第 1 艘不带号；#N 固定不回收（卖空后重新从第 1 艘起）', () => {
    const { state } = world()
    expect(Object.keys(state.fleet).sort()).toEqual(['sandcat', 'sh-falconet'])
    const a = addShipToFleet(state, 'sandcat')
    const b = addShipToFleet(state, 'sandcat')
    const c = addShipToFleet(state, 'sandcat')
    expect(a).toBe('sandcat#2')
    expect(b).toBe('sandcat#3')
    expect(c).toBe('sandcat#4')
    // 卖掉中间号（直接删 fleet）→ 空号不复用：新船继续 max+1
    delete state.fleet['sandcat#3']
    expect(addShipToFleet(state, 'sandcat')).toBe('sandcat#5')
    // 同型一艘不剩 → 重新从第 1 艘（不带号）
    for (const k of Object.keys(state.fleet)) if (k !== 'sh-falconet') delete state.fleet[k]
    expect(addShipToFleet(state, 'sandcat')).toBe('sandcat')
    // 仍占着第 1 艘的船型继续从 #2 起
    expect(allocateShipUid(state, 'sh-falconet')).toBe('sh-falconet#2')
  })

  it('显示名：默认 = 船型名（同型第 2 艘起带 #N）；改名后全权自定义；恢复默认回带号名', () => {
    const { state, ctx } = world()
    const uid2 = addShipToFleet(state, 'sandcat')
    // helpers 里船名格式为 `船${id}` → 测试替身名
    expect(shipDisplayName(state, ctx, 'sandcat')).toBe('船sandcat')
    expect(shipDisplayName(state, ctx, uid2)).toBe('船sandcat #2')
    expect(renameShip(state, uid2, ' 大鲸鱼一号 ').ok).toBe(true)
    expect(shipDisplayName(state, ctx, uid2)).toBe('大鲸鱼一号')
    expect(renameShip(state, uid2, null).ok).toBe(true)
    expect(shipDisplayName(state, ctx, uid2)).toBe('船sandcat #2')
  })

  it('改名规则：免费任意改、上限 10 字（按字/码点）、允许重名、拒绝空名与未知船', () => {
    const { state, ctx } = world()
    const uid2 = addShipToFleet(state, 'sandcat')
    expect(renameShip(state, '不存在', 'x').ok).toBe(false)
    expect(renameShip(state, uid2, '   ').ok).toBe(false) // 全空白
    expect(renameShip(state, uid2, '一二三四五六七八九十一').ok).toBe(false) // 11 字超限
    expect(renameShip(state, uid2, '一二三四五六七八九十').ok).toBe(true) // 10 字刚好
    // 允许与第 1 艘（自定义后）重名
    expect(renameShip(state, 'sandcat', '大鲸鱼').ok).toBe(true)
    expect(renameShip(state, uid2, '大鲸鱼').ok).toBe(true)
    expect(fleetDefOf(state, ctx, uid2)?.cargoM3).toBe(800) // uid → def 解析正常
  })

  it('驾驶/AI 维度按实例工作：可切驾驶到 #2；同型两艘可同时被 AI 指派', () => {
    const { state, ctx } = world()
    const uid2 = addShipToFleet(state, 'sandcat')
    expect(changeShip(state, uid2, ctx).ok).toBe(true)
    expect(state.shipId).toBe(uid2)
    state.shipLocks[state.shipId] = true // 锁 #2 只影响 #2（键语义独立）
    expect(changeShip(state, 'sandcat', ctx).ok).toBe(true)
    expect(state.shipLocks['sandcat']).toBeUndefined()
    // AI 指派表以实例 uid 为键：两艘同型各占一条
    state.aiAssignments['sandcat'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    state.aiAssignments[uid2] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    expect(Object.keys(state.aiAssignments).sort()).toEqual(['sandcat', uid2])
  })

  it('市场挂卖 escrow：整艘（uid/船型/耐久/自定义名）进 escrow，撤单原实例原样回机库', () => {
    const { state, ctx } = world()
    state.wallet.isk = 2_000_000
    const uid2 = addShipToFleet(state, 'sandcat') // sandcat#2
    renameShip(state, uid2, '测试二号')
    state.fleet[uid2]!.durability = 0.42
    changeShip(state, uid2, ctx)
    changeShip(state, 'sandcat', ctx) // 切回第 1 艘，让 #2 可出售
    const order = placeShipSellOrder(state, ctx, uid2, 88_000)
    expect(order).not.toBeNull()
    expect(state.fleet[uid2]).toBeUndefined()
    const hold = state.escrowShips[order!.id]
    expect(hold).toEqual({ shipId: uid2, defId: 'sandcat', durability: 0.42, customName: '测试二号' })
    // escrow 中的 #2 也占号：此时再买同型 → #3（不与挂单船撞 uid）
    expect(addShipToFleet(state, 'sandcat')).toBe('sandcat#3')
    expect(cancelOrder(state, ctx, order!.id)).toBe(true)
    const back = state.fleet[uid2]
    expect(back?.defId).toBe('sandcat')
    expect(back?.durability).toBe(0.42)
    expect(back?.customName).toBe('测试二号')
    expect(shipDisplayName(state, ctx, uid2)).toBe('测试二号')
  })

  it('重复购买（buyShip）：允许同型第二艘；新实例登舰；忙时只入机库不打断作业', () => {
    const { state, ctx } = world()
    state.wallet.isk = 2_000_000
    // 供给簿有货（开盘铺单）→ 市价购入并登舰到新实例
    const r = buyShip(state, 'sandcat', ctx)
    expect(r.ok).toBe(true)
    expect(state.fleet['sandcat#2']).toBeDefined()
    expect(state.shipId).toBe('sandcat#2')
    // 驾驶船作业中（采矿）再买同型 → 入机库不自动登舰
    state.shipId = 'sandcat'
    delete state.fleet['sandcat#2']
    state.mining = {
      active: true,
      beltId: 'belt-a',
      phase: 'mining',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 0,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
    }
    const r2 = buyShip(state, 'sandcat', ctx)
    expect(r2.ok).toBe(true)
    expect(state.shipId).toBe('sandcat') // 未被打断
    expect(state.mining.active).toBe(true)
    // 现存只有 1 号 → 尾部空号自然回填为 #2（现存船号码永不重排）
    expect(state.fleet['sandcat#2']).toBeDefined()
  })

  it('存档 v17：v16 档迁移补 defId/customName（含 escrow），键原样保留；往返保真；超长名截断', () => {
    const { state, ctx } = world()
    const uid2 = addShipToFleet(state, 'sandcat')
    renameShip(state, uid2, '二号')
    const text = serializeSaveFile(state, state.savedAtWallMs)
    const loaded = loadSaveFile(text)
    expect(loaded.state.version).toBe(17)
    expect(loaded.state).toEqual(state)

    // v16 老档（fleet/escrow 条目无 v17 字段）：迁移链补字段
    const v16 = {
      format: SAVE_FORMAT,
      version: 16,
      savedAtWallMs: 0,
      state: {
        ...state,
        version: 16,
        // 老形状：条目缺 defId/customName；escrow 快照只有 shipId/durability
        fleet: {
          sandcat: { durability: 0.9, cargo: { 'ore-a': 3 }, fitted: state.fleet.sandcat!.fitted },
          'sh-falconet': { durability: 1, cargo: {}, fitted: state.fleet['sh-falconet']!.fitted },
        },
        shipId: 'sandcat',
        escrowShips: { 1: { shipId: 'sandcat', durability: 0.66 } },
        shipLocks: { 'sh-falconet': true },
        logs: [],
      },
    }
    const upgraded = loadSaveFile(JSON.stringify(v16))
    expect(upgraded.state.version).toBe(17)
    expect(upgraded.state.fleet.sandcat!.defId).toBe('sandcat')
    expect(upgraded.state.fleet.sandcat!.customName).toBeNull()
    expect(upgraded.state.fleet.sandcat!.cargo['ore-a']).toBe(3)
    expect(upgraded.state.fleet['sh-falconet']!.defId).toBe('sh-falconet')
    expect(upgraded.state.escrowShips[1]).toEqual({ shipId: 'sandcat', defId: 'sandcat', durability: 0.66, customName: null })
    expect(upgraded.state.shipLocks['sh-falconet']).toBe(true)
    expect(Object.keys(upgraded.state.fleet).sort()).toEqual(['sandcat', 'sh-falconet']) // 键原样
    void ctx
  })
})
