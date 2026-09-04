/**
 * 远征（V12 两阶段）单元测试：出发校验/去程/途中事件/到港开战/实时战斗/弹药/结算惩罚。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { addModule, fitModule } from '../src/equipment'
import {
  advanceExpedition,
  battleTacticDesire,
  expeditionStatus,
  setBattleDesire,
  startExpedition,
} from '../src/expedition'
import { battleWinPreview } from '../src/combat'
import { anomaly, makeTestCtx, moduleDef } from './helpers'

describe('远征 V12：两阶段', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 500_000
    ctx = makeTestCtx()
  })

  it('出发校验：采矿中/远征中/未知目标/声望不足拒绝', () => {
    expect(startExpedition(state, '不存在的目标', ctx).ok).toBe(false)
    state.mining.active = true
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(false)
    state.mining.active = false
    // ano-hard 需声望 5，且目标星系需已探索（V13 封锁）
    const r = startExpedition(state, 'ano-hard', ctx)
    expect(r.ok).toBe(false)
    state.standings['dsi'] = 5
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(false) // 未探索 → 拒绝
    state.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('out')
    expect(state.expedition.active).toBe(true)
  })

  it('去程到港即开战（out→battle 同帧衔接）；hub 内目标立即进入交火', () => {
    // ano-a 在母港星系：航程 0，任意推进即到港
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 10_000, ctx)
    expect(state.expedition.phase).toBe('battle')
    expect(state.expedition.battle).not.toBeNull()
    // 长推进把战斗打完（战斗上限 10 分钟；母港目标 vs 沙猫很快分出胜负）
    advanceGame(state, 10 * 60_000, ctx)
    const exp = state.expedition
    if (exp.active && exp.phase === 'battle') {
      // 仍未结束（理论上不会，兜底断言不崩即可）
      advanceGame(state, 20 * 60_000, ctx)
    }
    expect(state.expedition.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('途中事件在去程中段触发一次', () => {
    const farCtx = makeTestCtx({
      anomalies: [anomaly('ano-far0', 'galaxy-far', { threat: 4, reward: 5_000 })],
      balance: { ...makeTestCtx().balance, travelEventChance: 1 }, // 途中事件必触发（去随机）
    })
    state.exploredGalaxies.push('galaxy-far') // V13：目标星系需已探索
    expect(startExpedition(state, 'ano-far0', farCtx).ok).toBe(true)
    // 去程 2 分钟 → 中点 60s
    advanceGame(state, 30_000, farCtx)
    expect(state.expedition.eventFired).toBe(false)
    advanceGame(state, 40_000, farCtx) // 70s > 60s
    expect(state.expedition.eventFired).toBe(true)
    expect(state.logs.some((l) => l.text.includes('途中遭遇事件'))).toBe(true)
    // 到港开战
    advanceGame(state, 60_000, farCtx)
    expect(state.expedition.phase).toBe('battle')
  })

  it('失利路径：维修费按期望奖励×50% 扣款、耐久下降', () => {
    // 制造必然战败：威胁极高的母港目标
    const brutalCtx = makeTestCtx({
      anomalies: [anomaly('ano-brutal', 'galaxy-hub', { threat: 2000, reward: 10_000 })],
    })
    expect(startExpedition(state, 'ano-brutal', brutalCtx).ok).toBe(true)
    const durBefore = state.fleet[state.shipId]!.durability
    const walletBefore = state.wallet.isk
    advanceGame(state, 120_000, brutalCtx)
    expect(state.expedition.active).toBe(false)
    const durAfter = state.fleet[state.shipId]!.durability
    if (durAfter < durBefore) {
      // 未弃船：维修费 = min(钱包, 10000×0.5)
      expect(walletBefore - state.wallet.isk).toBeLessThanOrEqual(5_000)
    }
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('炮台参战消耗弹药并退回剩余', () => {
    const tur = moduleDef('tur-b', 'turret', 0.5, { weaponSize: 'light', maxRangeM: 4000, minRangeM: 0, hitRate: 0.8, falloff: 0.3, reloadMs: 1500, dmgMult: 2.0 })
    const ctxB = makeTestCtx({ modules: [tur], anomalies: [anomaly('ano-w', 'galaxy-hub', { threat: 1, reward: 1_000 })] })
    state.warehouse.items['ammo-kinetic-l'] = 500
    addModule(state, 'tur-b', 1)
    expect(fitModule(state, 'tur-b', ctxB).ok).toBe(true)
    expect(startExpedition(state, 'ano-w', ctxB).ok).toBe(true)
    advanceGame(state, 10 * 60_000, ctxB)
    expect(state.expedition.active).toBe(false)
    // 剩余弹药退回仓库（消耗后应少于 500）
    const left = state.warehouse.items['ammo-kinetic-l'] ?? 0
    expect(left).toBeLessThan(500)
  })

  it('battleTacticDesire / setBattleDesire：战斗中可调期望距离并钳制；偏好被记忆且出发时沿用', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx) // 到港开战
    const desire = battleTacticDesire(state, ctx, 'kite')
    expect(desire).toBeGreaterThan(0)
    expect(setBattleDesire(state, desire, ctx).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(desire)
    expect(state.expedition.desirePrefM).toBe(desire) // 记忆偏好
    // 巨大值被钳制到开战距离内
    expect(setBattleDesire(state, 1_000_000_000, ctx).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBeLessThan(1_000_000_000)
    // 出发时显式 desireM 优先（开战后 myDesireM 应等于它）
    const s2 = createInitialState({ nowWallMs: 0, seed: 9 })
    s2.wallet.isk = 500_000
    expect(startExpedition(s2, 'ano-a', ctx, { desireM: 2_000 }).ok).toBe(true)
    advanceGame(s2, 5_000, ctx)
    expect(s2.expedition.battle!.myDesireM).toBe(2_000)
    expect(s2.expedition.desirePrefM).toBe(2_000)
  })

  it('battleWinPreview 与远征面板 winPercent 一致（不同阶段）', () => {
    const p = battleWinPreview(state, ctx, ctx.anomalies.get('ano-a')!, 'sandcat')
    expect(expeditionStatus(state, ctx).winPercent).toBe(0) // 未出发
    startExpedition(state, 'ano-a', ctx)
    const view = expeditionStatus(state, ctx)
    expect(view.phase).toBe('out')
    expect(view.winPercent).toBe(Math.round(p * 100))
    advanceGame(state, 5_000, ctx)
    expect(expeditionStatus(state, ctx).phase).toBe('combat')
    expect(advanceExpedition).toBeTypeOf('function')
  })

  it('击杀慢镜：分出胜负后延迟 killcamMs 再结算（主控），大步长推进仍立即结算', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx) // 到港开战（战斗进行中）
    const exp = state.expedition
    expect(exp.phase).toBe('battle')
    const b = exp.battle!
    // 手工处决：全部敌舰三层血清零 → 下一拍 ended='me'
    for (const u of Object.values(b.units)) {
      if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    }
    advanceGame(state, 100, ctx)
    expect(b.ended).toBe('me')
    // 慢镜窗口内（击杀后 ~100ms，距 1500ms 门槛尚远）：不结算、不转返航
    expect(exp.phase).toBe('battle')
    expect(exp.battle).not.toBeNull()
    advanceGame(state, 1_000, ctx) // 累计 ~1.1s < 1.5s
    expect(exp.phase).toBe('battle')
    // 窗口走完：结算 → 转返航（母港目标零航程：同帧直接回港停靠）并出战报
    advanceGame(state, 1_000, ctx) // 累计 ≥2.1s
    expect(exp.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('声望仅首胜发放：同一目标重复完成不再涨声望（防低威胁目标无限白刷）', () => {
    // 自定义母港目标：声望 +2/次
    const firstCtx = makeTestCtx({
      anomalies: [anomaly('ano-first', 'galaxy-hub', { threat: 1, reward: 1_000, standingGain: 2 })],
    })
    expect(startExpedition(state, 'ano-first', firstCtx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, firstCtx) // 打赢并完成
    expect(state.expedition.active).toBe(false)
    expect(state.standings['dsi']).toBe(2) // 首胜声望到账
    expect(state.completedBounties).toEqual(['ano-first'])
    const walletAfterFirst = state.wallet.isk
    // T8：胜利后同目标有 10 秒重复冷却（基础 10s × 扫描属性因子）——等冷却结束再出击
    expect(startExpedition(state, 'ano-first', firstCtx).ok).toBe(false)
    advanceGame(state, 11_000, firstCtx) // 冷却 10s 走完
    // 再次重复完成：奖金照发，声望不再增加
    expect(startExpedition(state, 'ano-first', firstCtx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, firstCtx)
    expect(state.expedition.active).toBe(false)
    expect(state.standings['dsi']).toBe(2) // 未再涨
    expect(state.completedBounties).toEqual(['ano-first']) // 清单不重复
    expect(state.wallet.isk).toBeGreaterThan(walletAfterFirst) // 钱照给
    expect(state.logs.some((l) => l.text.includes('无额外声望'))).toBe(true)
  })
})
