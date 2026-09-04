/**
 * B1 低安遭遇/伏击（船长 2026-09-04 定稿）：高安不掷、低安暴露掷骰、承担者优先停留船、
 * 在线邀约超时自动文字结算、文字三档（耐久 clamp 5% 不弃船）、应战走真实战斗、首次低安提示。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import type { AnomalyDef } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { fightEncounter, fleeEncounter } from '../src/encounters'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, belt, galaxy } from './helpers'

/** 遭遇战模板（与 data 同形，测试 ctx 独立注册） */
function encTiers(): AnomalyDef[] {
  return [
    { id: 'enc-pirate-1', name: '流窜海盗快艇', galaxyId: 'galaxy-far', threat: 10, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 45, tactic: 'orbit', hidden: true, description: '' },
    { id: 'enc-pirate-2', name: '伏击劫掠队', galaxyId: 'galaxy-far', threat: 22, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 45, tactic: 'orbit', escorts: 1, hidden: true, description: '' },
    { id: 'enc-pirate-3', name: '狂徒巡逻编队', galaxyId: 'galaxy-far', threat: 40, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 60, tactic: 'brawl', escorts: 2, hidden: true, description: '' },
  ]
}

/** 低安世界：galaxy-far 安全 −0.8 + 低安矿带 belt-f（挂 far）；事件流关闭 */
function lowWorld() {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    galaxies: [{ ...galaxy('galaxy-far', '远方'), security: -0.8 }],
    belts: [belt('belt-a', 'ore-a', '带belt-a'), belt('belt-f', 'ore-a', '低安带', { galaxyId: 'galaxy-far' })],
    anomalies: encTiers(),
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  state.exploredGalaxies.push('galaxy-far')
  return { state, ctx }
}

/** 推进直到命中一次遭遇（概率约 7.5%/窗口；上限内几乎必中） */
function rollUntilEncounter(state: GameState, ctx: SimContext): void {
  let guard = 0
  while (!state.encounter.active && guard < 80) {
    guard += 1
    advanceGame(state, 4 * ctx.balance.encounter.windowMs, ctx) // 每次调用最多折算 4 窗口
  }
  expect(state.encounter.active).toBe(true)
}

/** 把采矿状态机直接拨到"在带采掘"（绕过行程，专注遭遇逻辑） */
function forceAtBelt(state: GameState): void {
  state.mining.phase = 'mining'
  state.mining.originGalaxy = null
  state.awayGalaxy = null
}

describe('B1 低安遭遇', () => {
  it('高安（母港矿带）长时间开采：一次遭遇都不会有', () => {
    const { state, ctx } = lowWorld()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    forceAtBelt(state)
    for (let i = 0; i < 20; i += 1) advanceGame(state, 4 * ctx.balance.encounter.windowMs, ctx)
    expect(state.encounter.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('低安遭遇'))).toBe(false)
    expect(state.lowSecNotified).toBe(false)
  })

  it('低安矿带在带采掘：按窗口命中遭遇 → 在线邀约 60s 未响应 → 自动文字结算（耐久永不为 0）', () => {
    const { state, ctx } = lowWorld()
    expect(startMining(state, 'belt-f', ctx).ok).toBe(true)
    forceAtBelt(state)
    rollUntilEncounter(state, ctx)
    const enc = state.encounter
    expect(enc.galaxyId).toBe('galaxy-far')
    expect(enc.shipId).toBe(state.shipId) // 主控采矿承担
    expect(enc.deadlineGameMs - enc.invitedAtGameMs).toBe(ctx.balance.encounter.inviteWaitMs)
    expect(state.lowSecNotified).toBe(true) // 首次低安提示
    // 未响应：推进超过邀约窗 → 自动结算，遭遇关闭且留日志
    advanceGame(state, ctx.balance.encounter.inviteWaitMs + 1000, ctx)
    expect(state.encounter.active).toBe(false)
    const logText = state.logs
      .filter((l) => l.text.includes('遭遇'))
      .map((l) => l.text)
      .join('|')
    expect(logText).toContain('低安遭遇')
    expect(state.fleet[state.shipId]!.durability).toBeGreaterThan(0) // clamp：永不弃船
  })

  it('文字三档均不击沉：被抢不超货仓 30%、受损压 5% 底线', () => {
    const { state, ctx } = lowWorld()
    // 直接注入高威胁遭遇：火力比极低 → 三档权重被抢/受损为主
    state.fleet[state.shipId]!.cargo['ore-a'] = 1000
    const walletBefore = state.wallet.isk
    for (let i = 0; i < 30; i += 1) {
      const cargoBefore = state.fleet[state.shipId]!.cargo['ore-a'] ?? 0
      state.encounter = {
        active: true,
        shipId: state.shipId,
        galaxyId: 'galaxy-far',
        name: '伏击劫掠队',
        threat: 999,
        origin: '测试',
        invitedAtGameMs: state.gameMs,
        deadlineGameMs: state.gameMs + 60_000,
        battle: null,
      }
      advanceGame(state, 61_000, ctx) // 超时自动结算
      expect(state.encounter.active).toBe(false)
      expect(state.fleet[state.shipId]!.durability).toBeGreaterThan(0)
      // 单次被抢不超过当前货仓 30%
      expect(state.fleet[state.shipId]!.cargo['ore-a'] ?? 0).toBeGreaterThanOrEqual(Math.floor(cargoBefore * 0.7))
    }
    expect(state.wallet.isk).toBeGreaterThanOrEqual(walletBefore - Math.floor(walletBefore * 0.05))
  })

  it('停留船优先承担：主控停在低安星系 + 副船同星系采矿 → 事件记在主控头上（区域一次）', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far' // 主控胜利后停留低安
    // 注入一艘副船同星系采矿（sandcat 名下直接登记，专注遭遇归属判定）
    state.aiAssignments['sandcat'] = {
      coreType: 'basic',
      startedAtGameMs: state.gameMs,
      task: { kind: 'mining', beltId: 'belt-f', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    rollUntilEncounter(state, ctx)
    expect(state.encounter.shipId).toBe(state.shipId) // 停留的主控承担
  })

  it('应战：进入真实战斗并自动打完结算（胜利缴获或失利受损，遭遇关闭）', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: 'galaxy-far',
      name: '伏击劫掠队',
      threat: 6, // 比沙猫火力低 → 应战胜算高
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
    expect(fightEncounter(state, ctx).ok).toBe(true)
    expect(state.encounter.battle).not.toBeNull()
    const durBefore = state.fleet[state.shipId]!.durability
    // 推进直到打完（战斗随 gameMs 步进，一次大步推进即结算）
    advanceGame(state, 5 * 60_000, ctx)
    expect(state.encounter.active).toBe(false)
    expect(state.fleet[state.shipId]!.durability).toBeGreaterThan(0)
    void durBefore
  })

  it('快速脱离：立即文字结算并关闭遭遇', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: 'galaxy-far',
      name: '巡逻队拦截',
      threat: 30,
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
    expect(fleeEncounter(state, ctx).ok).toBe(true)
    expect(state.encounter.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('快速脱离'))).toBe(true)
  })

  it('存档往返：遭遇字段可序列化；旧档缺字段 → normalize 兜底为未激活', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: 'galaxy-far',
      name: '巡逻队拦截',
      threat: 20,
      origin: '测试',
      invitedAtGameMs: 100,
      deadlineGameMs: 100 + 60_000,
      battle: null,
    }
    state.lowSecNotified = true
    const text = serializeSaveFile(state, state.savedAtWallMs)
    const loaded = loadSaveFile(text).state
    expect(loaded.encounter.active).toBe(true)
    expect(loaded.encounter.galaxyId).toBe('galaxy-far')
    expect(loaded.lowSecNotified).toBe(true)
    // 旧形状（无 encounter 字段）：兜底
    const legacy = loadSaveFile(
      JSON.stringify({ format: SAVE_FORMAT, version: 17, savedAtWallMs: 0, state: { skills: {} } }),
    ).state
    expect(legacy.encounter.active).toBe(false)
    expect(legacy.lowSecNotified).toBe(false)
    void ctx
  })
})
