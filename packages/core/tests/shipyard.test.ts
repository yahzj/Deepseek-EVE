/**
 * 舰队（v7 船坞）单元测试：拥有/入坞、切换驾驶、耐久与维修、弃船保底。
 * （弃船由远征战斗触发部分已由 expedition.test 覆盖；本文件聚焦船坞 API。）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { addShipToFleet, changeShip, loseShip, ownsShip, repairCostIsk, repairShip, durabilityOf } from '../src/shipyard'
import { startExpedition } from '../src/expedition'
import { startMining } from '../src/mining'
import { makeTestCtx, ship } from './helpers'

describe('舰队', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx()
  })

  it('新档：默认矿船 + 测试用武装艇；v17 入坞 = 每次新增独立实例（同型自动 #N）', () => {
    expect(Object.keys(state.fleet).sort()).toEqual(['sandcat', 'sh-falconet'])
    expect(ownsShip(state, 'sandcat')).toBe(true)
    expect(ownsShip(state, 'sh-falconet')).toBe(true)
    expect(ownsShip(state, 'sandcat2')).toBe(false)
    const uidA = addShipToFleet(state, 'sandcat2')
    expect(uidA).toBe('sandcat2') // 同型无船 → 第 1 艘不带号
    const uidB = addShipToFleet(state, 'sandcat2')
    expect(uidB).toBe('sandcat2#2') // 同型第 2 艘自动编号
    const uidC = addShipToFleet(state, 'sandcat2')
    expect(uidC).toBe('sandcat2#3')
    expect(Object.keys(state.fleet)).toHaveLength(5)
    expect(state.fleet[uidB]!.defId).toBe('sandcat2')
  })

  it('切换驾驶：未知/未拥有/已在驾驶 拒绝；远征中禁止；采矿中直接成功（旧船自动返航善后）', () => {
    expect(changeShip(state, '不存在', ctx).ok).toBe(false)
    expect(changeShip(state, 'sandcat', ctx).ok).toBe(false) // 已在驾驶
    expect(changeShip(state, 'sandcat2', ctx).ok).toBe(false) // 未拥有
    addShipToFleet(state, 'sandcat2')
    expect(changeShip(state, 'sandcat2', ctx).ok).toBe(true)
    expect(state.shipId).toBe('sandcat2')
    // 采矿中：切换成功，旧船进入自动返航善后账本
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
    expect(changeShip(state, 'sandcat', ctx).ok).toBe(true)
    expect(state.shipId).toBe('sandcat')
    expect(state.mining.active).toBe(false)
    expect(state.shipReturns['sandcat2']).toBeDefined()
  })

  it('维修费 = 缺失耐久 × 货舱 m³ × 单价；钱不够拒绝；维修回满', () => {
    state.fleet[state.shipId]!.durability = 0.7
    const cost = repairCostIsk(state, 'sandcat', ctx)
    expect(cost).toBeGreaterThan(0)
    state.wallet.isk = Math.max(0, cost - 1)
    expect(repairShip(state, 'sandcat', ctx).ok).toBe(false)
    state.wallet.isk = cost
    expect(repairShip(state, 'sandcat', ctx).ok).toBe(true)
    expect(durabilityOf(state, 'sandcat')).toBe(1)
  })

  it('弃船：货仓与装备随船丢失；自动切到其它船；一艘不剩时补发沙猫', () => {
    const ctxS = makeTestCtx({ ships: [ship('sandcat2')] })
    addShipToFleet(state, 'sandcat2')
    state.fleet['sandcat']!.cargo['ore-a'] = 50
    state.fleet['sandcat']!.fitted.high[1] = 'mod-a'
    state.moduleBay['mod-a'] = 1
    loseShip(state, 'sandcat', ctxS, '测试弃船')
    expect(ownsShip(state, 'sandcat')).toBe(false)
    expect(state.shipId).not.toBe('sandcat') // 自动切到其它船
    // 剩余船都不带原船的货仓/装备（V18：三类位数组全空）
    for (const fs of Object.values(state.fleet)) {
      expect(Object.keys(fs.cargo)).toHaveLength(0)
      const allBays = [...fs.fitted.high, ...fs.fitted.mid, ...fs.fitted.low]
      expect(allBays.every((v) => v === null)).toBe(true)
    }
    // 全损：逐艘弃船直到一艘不剩 → 补发沙猫
    let guard = 0
    while (Object.keys(state.fleet).length > 0 && guard < 10) {
      const victim = Object.keys(state.fleet)[0]!
      loseShip(state, victim, ctxS, '测试弃船2')
      guard += 1
    }
    expect(Object.keys(state.fleet)).toEqual(['sandcat'])
    expect(state.shipId).toBe('sandcat')
    expect(state.logs.some((l) => l.text.includes('补助'))).toBe(true)
  })

  it('航行期间弃船由远征结算兜底：战斗失利弃船后档仍可推进（smoke）', () => {
    const brutalCtx = makeTestCtx({
      anomalies: [{ id: 'ano-x', name: '绝境', galaxyId: 'galaxy-hub', threat: 9999, standingReq: 0, standingGain: 1, rewardIsk: 1_000, loot: [], combatSeconds: 60, description: '绝境目标' }],
    })
    startExpedition(state, 'ano-x', brutalCtx)
    advanceGame(state, 60_000, brutalCtx)
    expect(state.logs.length).toBeGreaterThan(0)
    expect(state.shipId.length).toBeGreaterThan(0) // 档始终合法
  })

  describe('2026-09-09 驾驶船可用性（船长定：弃船补驾驶绝不接管 AI 执勤船；无空闲 → 保底沙猫）', () => {
    /** AI 掩护巡逻驻留指派（仅作"占用"标记，推进时驻留态无副作用） */
    function busyFalconet() {
      state.aiAssignments['sh-falconet'] = {
        coreType: 'basic',
        startedAtGameMs: 0,
        task: { kind: 'standby', galaxyId: 'galaxy-far', finishAtGameMs: 0, outMs: 1, phase: 'stand' },
      }
    }

    it('弃船补驾驶只选空闲船：AI 执勤中的船不被接管，任务原样保留', () => {
      addShipToFleet(state, 'sandcat2')
      busyFalconet()
      loseShip(state, 'sandcat', ctx, '测试弃船')
      expect(state.shipId).toBe('sandcat2') // 优先空闲船（不取舰队首艘 = AI 船）
      expect(state.aiAssignments['sh-falconet']).toBeDefined()
      expect(ownsShip(state, 'sh-falconet')).toBe(true)
    })

    it('弃船时余船全被 AI 占用 → 补发保底沙猫，不抢 AI 船', () => {
      busyFalconet()
      loseShip(state, 'sandcat', ctx, '测试弃船')
      expect(state.shipId).toBe('sandcat') // 原船已弃，新补一艘同型保底
      expect(Object.keys(state.fleet).sort()).toEqual(['sandcat', 'sh-falconet'])
      expect(state.aiAssignments['sh-falconet']).toBeDefined()
      expect(state.logs.some((l) => l.text.includes('补助'))).toBe(true)
    })

    it('驾驶船被 AI 占用时出港被拒（采矿）；引擎推进一次即自愈改派空闲船', () => {
      addShipToFleet(state, 'sandcat2')
      // 构造坏态（旧 bug 产物：弃船误把 AI 执勤船设为驾驶船）
      state.shipId = 'sh-falconet'
      busyFalconet()
      const r = startMining(state, 'belt-a', ctx)
      expect(r.ok).toBe(false)
      expect(r.error ?? '').toContain('AI 执勤')
      advanceGame(state, 1_000, ctx)
      expect(state.shipId).toBe('sandcat') // 自愈改派空闲船（舰队序第一艘空闲 = 沙猫，绝不留在 AI 船）
      expect(state.aiAssignments[state.shipId]).toBeUndefined()
      expect(state.aiAssignments['sh-falconet']).toBeDefined() // AI 任务不受影响
    })

    it('旧档坏态自愈：驾驶船键缺失 → 引擎推进自动改派（档始终有船可开）', () => {
      state.shipId = '已损毁的船'
      advanceGame(state, 1_000, ctx)
      expect(state.fleet[state.shipId]).toBeDefined()
      expect(Object.keys(state.fleet)).toContain(state.shipId)
    })
  })
})
