/**
 * B1 低安遭遇/伏击（船长 2026-09-04 定稿 v2）：**占用随机事件时机**（事件线到点判定）、
 * 到达低安 5 分钟缓冲、承担者优先停留船、在线邀约超时自动文字结算、文字三档（结构 clamp 5% 不弃船）、
 * 应战走真实战斗、首次低安提示。
 * 2026-09-11 追加：受损档改「按敌人火力 + 装甲先吃」、结构 <50% 撤退（见文件末 describe）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import type { AnomalyDef } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { fightEncounter, fleeEncounter, rollLowSecAmbush } from '../src/encounters'
import { hullLayerCaps } from '../src/shipyard'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, belt, galaxy, anomaly, ship, moduleDef } from './helpers'
import { wreckDensityOf } from '../src/salvage'
import { addModule, fitModule } from '../src/equipment'

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

/** 把采矿状态机直接拨到"在带采掘"（绕过行程，专注遭遇逻辑） */
function forceAtBelt(state: GameState): void {
  state.mining.phase = 'mining'
  state.mining.originGalaxy = null
  state.awayGalaxy = null
}

describe('B1 低安遭遇（事件线融合 + 5 分钟缓冲）', () => {
  it('高安（母港矿带）开采：无在场记录、反复判定也绝不遇袭', () => {
    const { state, ctx } = lowWorld()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    forceAtBelt(state)
    advanceGame(state, 60_000, ctx) // 建立在场记录（母港高安不记）
    expect(Object.keys(state.lowSecPresence).length).toBe(0)
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false)
    expect(state.encounter.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('低安遭遇'))).toBe(false)
    expect(state.lowSecNotified).toBe(false)
  })

  it('到达缓冲：进低安不足 5 分钟判定必不中；过缓冲后命中 → 邀约 60s 未响应 → 自动文字结算（耐久永不为 0）', () => {
    const { state, ctx } = lowWorld()
    expect(startMining(state, 'belt-f', ctx).ok).toBe(true)
    forceAtBelt(state)
    advanceGame(state, 1000, ctx) // 记录在场起始
    expect(state.lowSecNotified).toBe(true) // 首次涉足低安提示（缓冲期内也提示）
    for (let i = 0; i < 80; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false) // 缓冲期必不中
    expect(state.encounter.active).toBe(false)
    advanceGame(state, ctx.balance.encounter.entryBufferMs, ctx) // 跨过 5 分钟缓冲
    let hit = false
    for (let i = 0; i < 200 && !hit; i += 1) hit = rollLowSecAmbush(state, ctx)
    expect(hit).toBe(true)
    const enc = state.encounter
    expect(enc.active).toBe(true)
    expect(enc.galaxyId).toBe('galaxy-far')
    expect(enc.shipId).toBe(state.shipId) // 主控采矿承担
    // 未响应：推进超过邀约窗 → 自动结算
    advanceGame(state, ctx.balance.encounter.inviteWaitMs + 1000, ctx)
    expect(state.encounter.active).toBe(false)
    const logText = state.logs
      .filter((l) => l.text.includes('遭遇'))
      .map((l) => l.text)
      .join('|')
    expect(logText).toContain('低安遭遇')
    expect(state.fleet[state.shipId]!.durability).toBeGreaterThan(0) // clamp：永不弃船
  })

  it('占用随机事件时机：事件到点（已过缓冲）必遇袭，本次时机不再出随机事件', () => {
    const bal = makeTestCtx().balance
    const ctx = makeTestCtx({
      galaxies: [{ ...galaxy('galaxy-far', '远方'), security: -0.8 }],
      belts: [belt('belt-a', 'ore-a', '带belt-a'), belt('belt-f', 'ore-a', '低安带', { galaxyId: 'galaxy-far' })],
      balance: {
        ...bal,
        events: { ...bal.events, enabled: true, minGapMs: 600_000, maxGapMs: 600_000 },
        encounter: { ...bal.encounter, ambushChanceAtZero: 1, ambushChancePerSec: 0 },
      },
    })
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    state.exploredGalaxies.push('galaxy-far')
    expect(startMining(state, 'belt-f', ctx).ok).toBe(true)
    forceAtBelt(state)
    const starsBefore = state.logs.filter((l) => l.text.startsWith('✦')).length
    advanceGame(state, 1000, ctx) // 先建立在场记录（自 gameMs≈0 起算缓冲）
    // 越过首个事件到点（600s，且已过 300s 缓冲）→ 遇袭占用本次时机
    advanceGame(state, 620_000, ctx)
    expect(state.encounter.active).toBe(true)
    const starsAfter = state.logs.filter((l) => l.text.startsWith('✦')).length
    expect(starsAfter).toBe(starsBefore) // 本段随机事件未触发（时机被遭遇占用）
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
        anomalyId: null, // 旧档遗留形态（无伏击敌群 id → 就近兜底）
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
    state.awayGalaxy = 'galaxy-far' // 主控驻留低安（掩护巡逻；2026-09-06 胜利不再停留）
    // 注入一艘副船同星系采矿（sandcat 名下直接登记，专注遭遇归属判定）
    state.aiAssignments['sandcat'] = {
      coreType: 'basic',
      startedAtGameMs: state.gameMs,
      task: { kind: 'mining', beltId: 'belt-f', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    advanceGame(state, 1000, ctx) // 记录在场（副船在带 + 主控停留同星系）
    advanceGame(state, ctx.balance.encounter.entryBufferMs, ctx) // 过缓冲
    let hit = false
    for (let i = 0; i < 200 && !hit; i += 1) hit = rollLowSecAmbush(state, ctx)
    expect(hit).toBe(true)
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
      threat: 6, // 旧档遗留形态（无伏击敌群 id）：应战兜底走档位模板
      anomalyId: null,
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

  it('调试快进冻结：进行中的遭遇战不随快进时间跳变而瞬结', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: 'galaxy-far',
      name: '伏击劫掠队',
      threat: 6, // 旧档遗留形态（无伏击敌群 id）：应战兜底走档位模板（若被瞬结会立刻打完，此处应保持进行中）
      anomalyId: null,
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
    expect(fightEncounter(state, ctx).ok).toBe(true)
    expect(state.encounter.battle).not.toBeNull()
    const lastTick = state.encounter.battle!.lastTickGameMs
    // 冻结快进：大步推进，战斗不应被时间跳变瞬结（仍进行中、战斗未结束）
    advanceGame(state, 5 * 60_000, ctx, { freezeBattle: true })
    expect(state.encounter.active).toBe(true)
    expect(state.encounter.battle!.ended).toBeFalsy()
    // 战斗时钟已同步到当前（不欠快进时间，避免恢复后一瞬追赶打完）
    expect(state.encounter.battle!.lastTickGameMs).toBe(state.gameMs)
    void lastTick
    // 解除冻结后正常打完
    advanceGame(state, 5 * 60_000, ctx)
    expect(state.encounter.active).toBe(false)
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
      anomalyId: null,
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
      anomalyId: null,
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

  it('伏击敌群 = 当地星系可见悬赏敌群（2026-09-09 船长定）：无悬赏星系不伏击；命中后 threat/名字/anomalyId 即该悬赏卡', () => {
    const ghost = { sec: -0.9, base: { ...makeTestCtx().balance.encounter, ambushChanceAtZero: 1, ambushChancePerSec: 0 } }
    const world = (visible: boolean) => {
      const ctx = makeTestCtx({
        quietEvents: true,
        galaxies: [{ ...galaxy('galaxy-ghost', '鬼域'), security: ghost.sec }],
        edges: [{ from: 'galaxy-hub', to: 'galaxy-ghost', travelMinutes: 2 }],
        belts: [belt('belt-a', 'ore-a', '带belt-a'), belt('belt-g', 'ore-a', '低安带', { galaxyId: 'galaxy-ghost' })],
        anomalies: [
          ...encTiers().map((a) => ({ ...a, galaxyId: 'galaxy-ghost' })), // 旧隐藏模板占位（不算敌群）
          ...(visible ? [anomaly('ano-ghost', 'galaxy-ghost', { threat: 55, reward: 88_000, tactic: 'brawl' })] : []),
        ],
        balance: { ...makeTestCtx().balance, encounter: ghost.base },
      })
      const state = createInitialState({ nowWallMs: 0, seed: 3 })
      state.exploredGalaxies.push('galaxy-ghost')
      state.mining.active = true
      state.mining.beltId = 'belt-g'
      state.mining.phase = 'mining'
      state.lowSecPresence['galaxy-ghost'] = -600_000 // 早已过入场缓冲
      return { state, ctx }
    }
    // 无可见悬赏：必不伏击（遇袭率已拉到 100%）
    const none = world(false)
    for (let i = 0; i < 20; i += 1) expect(rollLowSecAmbush(none.state, none.ctx)).toBe(false)
    expect(none.state.encounter.active).toBe(false)
    // 放入一张可见悬赏 → 立即伏击且敌群 = 该卡（威胁/名字/anomalyId 原样）
    const withFoe = world(true)
    let hit = false
    for (let i = 0; i < 20 && !hit; i += 1) hit = rollLowSecAmbush(withFoe.state, withFoe.ctx)
    expect(hit).toBe(true)
    const enc = withFoe.state.encounter
    expect(enc.anomalyId).toBe('ano-ghost')
    expect(enc.threat).toBe(55)
    expect(enc.name).toBe('目标ano-ghost')
  })

  it('击退缴获 = 伏击敌群赏金 ×50% 且胜利留残骸（2026-09-09 船长定，只给 ISK 不计首胜）', () => {
    const { state, ctx } = lowWorld()
    // 敌群 ano-a（赏金 5,000 → 击退缴 2,500；威胁 8 → 每胜注入残骸密度 8×0.4=3.2）
    const d0 = wreckDensityOf(state, 'galaxy-far', ctx)
    const wallet0 = state.wallet.isk
    state.fleet[state.shipId]!.cargo['ore-a'] = 100 // 被抢只动货不碰钱包（防现金扰动）
    let guard = 0
    while (guard++ < 80) {
      state.encounter = {
        active: true,
        shipId: state.shipId,
        galaxyId: 'galaxy-far',
        name: '目标ano-a',
        threat: 8,
        anomalyId: 'ano-a',
        origin: '测试',
        invitedAtGameMs: state.gameMs,
        deadlineGameMs: state.gameMs - 1,
        battle: null,
      }
      advanceGame(state, 1000, ctx) // 已超时 → 立即文字结算
      expect(state.encounter.active).toBe(false)
      if (state.logs.some((l) => l.text.includes('成功击退来敌'))) break
    }
    const wins = (state.wallet.isk - wallet0) / 2500
    expect(Number.isInteger(wins) && wins >= 1).toBe(true) // 每次击退恰为 5,000×50%
    expect(state.logs.filter((l) => l.text.includes('缴获 2,500 ISK')).length).toBe(wins)
    const d1 = wreckDensityOf(state, 'galaxy-far', ctx)
    expect(d1).toBeGreaterThan(d0 + 3.2 * wins - 2) // 每胜注入威胁×0.4（闲置漂移误差 <2）
  })
})

describe('B1 暴露面收敛（2026-09-06 船长：移动状态不暴露——只留停留与就地作业）', () => {
  /** 预置"在场已久"记录（起始为负 → 早已过入场缓冲，gameMs 不必推进）：直接测暴露判定 */
  const seedPresenceOld = (state: GameState): void => {
    state.lowSecPresence['galaxy-far'] = -600_000
  }

  it('采矿返航段（moving）不暴露；采掘相位（就地作业）照常暴露', () => {
    const { state, ctx } = lowWorld()
    state.mining.active = true
    state.mining.beltId = 'belt-f'
    state.mining.phase = 'returning' // 满仓返航 = 移动
    seedPresenceOld(state)
    for (let i = 0; i < 120; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false)
    expect(state.encounter.active).toBe(false)
    // 对照：转回采掘相位 → 暴露命中
    state.mining.phase = 'mining'
    let hit = false
    for (let i = 0; i < 300 && !hit; i += 1) hit = rollLowSecAmbush(state, ctx)
    expect(hit).toBe(true)
    expect(state.encounter.shipId).toBe(state.shipId)
  })

  it('远征（交火 / 失利返航 / 胜利自动返航）一律不暴露', () => {
    const { state, ctx } = lowWorld()
    seedPresenceOld(state)
    const exp = state.expedition
    exp.active = true
    exp.anomalyId = 'enc-pirate-1'
    // 交火中
    exp.phase = 'battle'
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false)
    // 失利返航
    exp.phase = 'back'
    exp.returnReason = 'defeat'
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false)
    // 胜利自动返航（不可召回的那一腿）
    exp.returnReason = 'victory'
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(state, ctx)).toBe(false)
    expect(state.encounter.active).toBe(false)
  })

  it('打捞返航段 / 扫描自动返航段不暴露；打捞与扫描"作业中"相位照常暴露', () => {
    // 打捞：返航段不暴露
    const w1 = lowWorld()
    w1.state.salvaging.active = true
    w1.state.salvaging.galaxyId = 'galaxy-far'
    w1.state.salvaging.phase = 'returning'
    seedPresenceOld(w1.state)
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(w1.state, w1.ctx)).toBe(false)
    // 打捞作业相位 → 暴露命中
    w1.state.salvaging.phase = 'salvaging'
    let hit1 = false
    for (let i = 0; i < 300 && !hit1; i += 1) hit1 = rollLowSecAmbush(w1.state, w1.ctx)
    expect(hit1).toBe(true)
    // 扫描：自动返航段不暴露（扫描窗口段本就有 t25 覆盖）
    const w2 = lowWorld()
    w2.state.scanning.active = true
    w2.state.scanning.galaxyId = 'galaxy-far'
    w2.state.scanning.returning = true
    for (let i = 0; i < 60; i += 1) expect(rollLowSecAmbush(w2.state, w2.ctx)).toBe(false)
    expect(w2.state.encounter.active).toBe(false)
  })
})

/**
 * 2026-09-11 船长定（玩家反馈"副船在低安遇袭耐久大幅下降后不会自动维修"）：
 * ① 受损档伤害改**按敌人火力**（敌群火力 × `hitFirepowerSec`），施加时**先扣装甲、吸完再进结构**
 *   （旧实现直接扣结构、装甲不动，与日志"被咬下一块装甲"不符）；
 * ② 结构低于 50% → **撤退**：主控停手返港、副船中止任务召回回港待命；**不自动维修**（回港等玩家决定）；
 * ③ 低安遭遇的「应战」也挂同一条 50% 自动脱离保险。
 */
describe('B1 遇袭受损与撤退（船长 2026-09-11 定）', () => {
  /** 注入一次遭遇（旧档遗留形态：无伏击敌群 id，威胁即注入值） */
  function inject(state: GameState, threat: number, shipId = state.shipId): void {
    state.encounter = {
      active: true,
      shipId,
      galaxyId: 'galaxy-far',
      name: '伏击劫掠队',
      threat,
      anomalyId: null,
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
  }

  /** 在低安矿带就地采掘（暴露成立；且"返航"有出发点） */
  function miningInField(state: GameState, ctx: SimContext): void {
    expect(startMining(state, 'belt-f', ctx).ok).toBe(true)
    state.mining.phase = 'mining'
    state.mining.originGalaxy = null
    state.awayGalaxy = 'galaxy-far'
  }

  it('受损档：一口伤害 = 敌群火力 × 0.3 秒，先扣装甲、吸完再进结构（结构不破 5% 底线）', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    const caps = hullLayerCaps(state, ctx, state.shipId)!
    const { foeDpsPerThreat } = ctx.balance.battle
    const { hitFirepowerSec } = ctx.balance.encounter
    let hits = 0
    for (const threat of [6, 22, 60]) {
      const hitHp = threat * foeDpsPerThreat * hitFirepowerSec
      for (let i = 0; i < 80 && hits < 15; i += 1) {
        const ship = state.fleet[state.shipId]!
        const armorBefore = ship.armorPct ?? 1
        const hullBefore = ship.durability
        inject(state, threat)
        const from = state.logs.length
        fleeEncounter(state, ctx)
        if (!state.logs.slice(from).some((l) => l.text.includes('被咬下一块装甲'))) continue
        hits += 1
        const armorHpBefore = armorBefore * caps.capA
        const eat = Math.min(armorHpBefore, hitHp)
        const rest = Math.max(0, hitHp - eat)
        const expArmor = Math.round(((armorHpBefore - eat) / caps.capA) * 1000) / 1000
        const expHull = Math.round((Math.max(caps.capH * 0.05, hullBefore * caps.capH - rest) / caps.capH) * 1000) / 1000
        expect(ship.armorPct ?? 1).toBeCloseTo(expArmor, 3)
        expect(ship.durability).toBeCloseTo(expHull, 3)
        // 装甲没被打穿 → 结构分文不动（这就是"先扣装甲"的判据；旧口径是直接扣结构）
        if (armorHpBefore > hitHp) expect(ship.durability).toBe(hullBefore)
        expect(ship.durability).toBeGreaterThanOrEqual(0.05)
      }
    }
    expect(hits).toBeGreaterThan(0)
  })

  it('副船遇袭后结构低于 50%：中止 AI 任务召回回港待命（不自动修、不花钱）', () => {
    const { state, ctx } = lowWorld()
    // 副船 = 鲣鱼（驾驶船是沙猫 = state.shipId，两条路径分开判）
    const droneId = 'sh-falconet'
    state.aiAssignments[droneId] = {
      coreType: 'basic',
      startedAtGameMs: state.gameMs,
      task: { kind: 'mining', beltId: 'belt-f', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    const drone = state.fleet[droneId]!
    drone.durability = 0.45
    const walletBefore = state.wallet.isk
    inject(state, 22, droneId)
    fleeEncounter(state, ctx)
    expect(state.aiAssignments[droneId]).toBeUndefined() // 任务已中止（召回回港）
    expect(drone.durability).toBeLessThanOrEqual(0.45) // 只掉不涨：没有自动维修
    expect(state.wallet.isk).toBe(walletBefore) // 也不自动花钱修
    expect(state.logs.some((l) => l.text.includes('已中止任务召回回港待命'))).toBe(true)
  })

  it('主控低安作业遇袭后结构低于 50%：停手并即时返港（不自动修）', () => {
    const { state, ctx } = lowWorld()
    miningInField(state, ctx)
    state.fleet[state.shipId]!.durability = 0.45
    const walletBefore = state.wallet.isk
    inject(state, 22)
    fleeEncounter(state, ctx)
    expect(state.mining.active).toBe(false) // 停手
    expect(state.awayGalaxy).toBeNull() // 回港（就近已建成站/母港）
    expect(state.wallet.isk).toBe(walletBefore)
    expect(state.logs.some((l) => l.text.includes('已自动停手返港'))).toBe(true)
  })

  it('结构未低于 50%：不撤退（低安作业照做）', () => {
    const { state, ctx } = lowWorld()
    miningInField(state, ctx)
    state.fleet[state.shipId]!.durability = 0.9
    inject(state, 6) // 一口至多 1.44 HP（沙猫 36 结构 ≈ 4%），远不到撤退线
    fleeEncounter(state, ctx)
    expect(state.mining.active).toBe(true)
    expect(state.awayGalaxy).toBe('galaxy-far')
  })

  it('应战：遭遇战挂 50% 自动脱离保险（结构过半即轻损脱离，无缴获、不扣维修费）', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    state.fleet[state.shipId]!.durability = 0.4 // 开战即已低于撤退线（相对满值结构）
    inject(state, 22)
    expect(fightEncounter(state, ctx).ok).toBe(true)
    expect(state.encounter.battle!.hullEscapeFrac).toBe(ctx.balance.encounter.retreatHullFrac)
    const walletBefore = state.wallet.isk
    advanceGame(state, 5 * 60_000, ctx)
    expect(state.encounter.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('结构损失过半，及时退出交火'))).toBe(true)
    expect(state.wallet.isk).toBe(walletBefore) // 轻损脱离：不给缴获、也不扣维修费
    expect(state.awayGalaxy).toBeNull() // 随后走撤退判定 → 停手返港
  })

  it('应战：遭遇战战后总结带修理组件消耗（2026-09-11 船长：装置不单独显示日志）', () => {
    const ctx = makeTestCtx({
      quietEvents: true,
      // 同名覆盖默认沙猫：血厚，保证 5 秒内打不完（至少一跳修复脉冲落地）
      ships: [ship('sandcat', { shieldHp: 3_000, armorHp: 5_000, hullHp: 5_000 })],
      modules: [moduleDef('mod-hullrep-t', 'support', 0, { rack: 'mid', cpuUse: 1, repairArmorHp: 5, repairHullHp: 5, repairKit: 'repairkit-civ' })],
      items: [{ id: 'repairkit-civ', name: '民用修理组件', kind: 'kit', unitM3: 1, baseSellPriceIsk: 3_000, description: '测试民用修理组件' }],
      galaxies: [{ ...galaxy('galaxy-far', '远方'), security: -0.8 }],
      belts: [belt('belt-a', 'ore-a', '带belt-a'), belt('belt-f', 'ore-a', '低安带', { galaxyId: 'galaxy-far' })],
      anomalies: encTiers(),
    })
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.exploredGalaxies.push('galaxy-far')
    miningInField(state, ctx)
    addModule(state, 'mod-hullrep-t', 1)
    expect(fitModule(state, 'mod-hullrep-t', ctx).ok).toBe(true)
    state.warehouse.items['repairkit-civ'] = 200 // 预载（货舱优先、仓库兜底）
    inject(state, 22)
    expect(fightEncounter(state, ctx).ok).toBe(true)
    // 制造缺口（盾打空、甲受损、结构仍在 50% 以上：避开自动脱离保险，先让修复脉冲跑起来）
    state.encounter.battle!.units['player']!.hp = { s: 0, a: 3_000, h: 4_500 }
    advanceGame(state, 5 * 60_000, ctx)
    expect(state.encounter.active).toBe(false)
    const encLogs = state.logs
      .filter((l) => l.text.includes('遭遇战'))
      .map((l) => l.text)
      .join('|')
    expect(encLogs).toMatch(/船体维修装置消耗 民用修理组件 ×\d+/)
    // 战斗中不再单独写维修装置日志（消耗数只进战后总结）
    expect(state.logs.some((l) => l.text.includes('耗尽') && l.text.includes('维修装置'))).toBe(false)
  })

  it('存档往返：撤退保险字段随档保留（战中重载不再凭空失效）', () => {
    const { state, ctx } = lowWorld()
    state.awayGalaxy = 'galaxy-far'
    inject(state, 22)
    expect(fightEncounter(state, ctx).ok).toBe(true)
    state.encounter.battle!.autoEscaped = true
    state.encounter.battle!.escapeReason = 'hull'
    const loaded = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state
    expect(loaded.encounter.battle?.hullEscapeFrac).toBe(0.5)
    expect(loaded.encounter.battle?.autoEscaped).toBe(true)
    expect(loaded.encounter.battle?.escapeReason).toBe('hull')
  })
})
