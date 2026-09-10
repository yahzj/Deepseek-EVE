/**
 * 赏金任务 · 敌人窝点（2026-09-10 船长定）：
 * - 任务中心「赏金任务」= 临时战斗任务，与时效任务共用 20 分钟整点板；每轮 2 张，过期作废、无惩罚；
 * - 目标不是普通悬赏照搬，而是按该星系主题悬赏**派生**的窝点：威胁 ×档位系数、加僚机与波次
 *   （波次威胁大头后置）、三档称呼按敌族定制（外围/核心/深层，均为"地点"语义）；
 * - 档位上限由**协会声望**决定（0~5 一档 / 6~10 二档 / 11+ 三档）；
 * - 打赢：窝点奖金（档位放大）+ 赏金任务酬金入账 + 该星系稀有残骸 ×档位件数（打捞必得）
 *   → 回站精炼炉「残骸回收」当**高级箱**开（常规保底 + 必定额外掉落，含该敌群专属装备）；
 * - 打输/撤退：任务不下板（可再来），不投放稀有残骸，窝点档位随本场作废。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import {
  BOUNTY_TASKS_PER_ROUND,
  DEFAULT_BALANCE,
  DSI_FACTION_ID,
  FOE_LAIR_TIERS,
  LAIR_RARE_WRECK_GAIN,
  LAIR_TASK_REWARD_MUL,
  LAIR_THREAT_MUL,
  RARE_BOX_MINERAL_UNITS,
  RARE_WRECK_VOLUME_M3,
  advanceGame,
  createInitialState,
  injectRareWreck,
  isLairCandidate,
  lairAnomalyOf,
  lairBaseRewardIsk,
  lairNameOf,
  lairTaskRewardIsk,
  lairTierForStanding,
  loadSaveFile,
  markExplored,
  pullOneWreck,
  rareWreckCountOf,
  rareWreckItemIdOf,
  recycleProfileOf,
  rollRareBoxExtra,
  serializeSaveFile,
  settleBountyTaskVictory,
  sideTaskBoard,
  startExpedition,
} from '../src/index'
import { resolveBattleOutcome } from '../src/expedition'
import { anomaly, galaxy, makeTestCtx } from './helpers'

const PERIOD = DEFAULT_BALANCE.market.orderLifeMs.common
/** 越过首个 20 分钟整点后多推进 1 秒（与 sideTasks.test 同口径） */
const FIRST_OPEN_MS = PERIOD + 1_000

const LAIR_A = anomaly('ano-lair-a', 'galaxy-hub', {
  threat: 4,
  reward: 20_000,
  lairCore: '测试海盗',
  foeFamily: 'A',
  recycleLoot: { modules: ['mod-a'] },
  lairGear: ['mod-a'],
})
const LAIR_B = anomaly('ano-lair-b', 'galaxy-far', {
  threat: 30,
  req: 4,
  reward: 60_000,
  lairCore: '拾荒团',
  foeFamily: 'B',
  recycleLoot: { modules: ['mod-b'] },
})
/** 无敌族登记、也无卡级专属池的窝点卡（专属池为空 → 主题追加件兜底） */
const LAIR_NF = anomaly('ano-lair-nf', 'galaxy-nf', {
  threat: 6,
  reward: 8_000,
  lairCore: '无名团伙',
  recycleLoot: { modules: ['mod-a'] },
})

function makeWorld(seed = 31): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ctx = makeTestCtx({
    quietEvents: true,
    galaxies: [galaxy('galaxy-nf', '无名星系')],
    anomalies: [LAIR_A, LAIR_B, LAIR_NF],
  })
  return { state, ctx }
}

/** 推进到首个整点：刷出当轮板（含赏金任务） */
function openBoard(state: GameState, ctx: SimContext): void {
  advanceGame(state, FIRST_OPEN_MS, ctx)
}

describe('赏金任务 · 窝点派生（档位 / 名称 / 卡面口径）', () => {
  it('档位由声望决定：0~5 一档外围、6~10 二档核心、11+ 三档深层', () => {
    expect(lairTierForStanding(0)).toBe(1)
    expect(lairTierForStanding(5)).toBe(1)
    expect(lairTierForStanding(6)).toBe(2)
    expect(lairTierForStanding(10)).toBe(2)
    expect(lairTierForStanding(11)).toBe(3)
    expect(lairTierForStanding(99)).toBe(3)
  })

  it('派生卡：威胁 ×档位系数、加僚机、二三档套波次（威胁大头后置）、其余字段继承主题悬赏', () => {
    const base = anomaly('ano-x', 'galaxy-hub', { threat: 10, reward: 1_000, escorts: 1, lairCore: '测试海盗', foeFamily: 'A' })
    const t1 = lairAnomalyOf(base, 1)
    expect(t1.threat).toBe(Math.round(10 * LAIR_THREAT_MUL[1]))
    expect(t1.escorts).toBe(1) // 一档不加僚机
    expect(t1.waves).toBeUndefined() // 一档沿用主题悬赏原波次
    const t2 = lairAnomalyOf(base, 2)
    expect(t2.escorts).toBe(2) // +1（上限 2）
    expect(t2.waves?.map((w) => w.hpShare)).toEqual([0.35, 0.65]) // 首波试探、末波硬骨头
    const t3 = lairAnomalyOf(base, 3)
    expect(t3.threat).toBe(Math.round(10 * LAIR_THREAT_MUL[3]))
    expect(t3.escorts).toBe(2)
    expect(t3.waves?.map((w) => w.hpShare)).toEqual([0.2, 0.3, 0.5])
    // 继承：战术性格/战利品/声望门槛等原样（窝点与该星系特色敌人同源）
    expect(t3.loot).toEqual(base.loot)
    expect(t3.rewardIsk).toBe(base.rewardIsk)
    expect(t3.id).toBe(base.id)
  })

  it('三档称呼按敌族定制且都是"地点"语义：核心词 + 档位词', () => {
    expect(lairNameOf(LAIR_A, 1)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[0]}`)
    expect(lairNameOf(LAIR_A, 2)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[1]}`)
    expect(lairNameOf(LAIR_A, 3)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[2]}`)
    expect(lairNameOf(LAIR_B, 3)).toBe(`拾荒团·${FOE_LAIR_TIERS.B[2]}`)
  })

  it('奖金与酬金口径：窝点基础奖金 = 主题奖金 ×档位系数；酬金 = 基础奖金 ×档位比例（跟强度走）', () => {
    const t = 2
    expect(lairBaseRewardIsk(LAIR_A, t)).toBe(Math.round(20_000 * LAIR_THREAT_MUL[t]))
    expect(lairTaskRewardIsk(LAIR_A, t)).toBe(Math.round(lairBaseRewardIsk(LAIR_A, t) * LAIR_TASK_REWARD_MUL[t]))
    // 高强度（三档）酬金 > 低强度（一档）——酬金跟强度递增
    expect(lairTaskRewardIsk(LAIR_A, 3)).toBeGreaterThan(lairTaskRewardIsk(LAIR_A, 1))
  })

  it('可作窝点的判定：有核心词、非隐藏、奖金 > 0（教学卡/无核心词卡不入池）', () => {
    expect(isLairCandidate(LAIR_A)).toBe(true)
    expect(isLairCandidate(anomaly('ano-plain', 'galaxy-hub'))).toBe(false)
    expect(isLairCandidate(anomaly('ano-zero', 'galaxy-hub', { reward: 0, lairCore: '空' }))).toBe(false)
  })
})

describe('赏金任务 · 20 分钟整点板刷出', () => {
  it('刷出：每轮 2 张（候选不足按实际数）；同轮不重复星系；档位与酬金在刷出时锁定', () => {
    const { state, ctx } = makeWorld()
    markExplored(state, 'galaxy-far') // 两个候选星系都探索过
    state.standings[DSI_FACTION_ID] = 4 // 达到 ano-lair-b 的声望门槛（仍是 0~5 的一档）
    openBoard(state, ctx)
    const board = state.sideTasks
    expect(board.bounty).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    const galaxies = board.bounty.map((t) => t.galaxyId)
    expect(new Set(galaxies).size).toBe(galaxies.length) // 同轮不重复星系
    const cards = new Map([LAIR_A, LAIR_B].map((c) => [c.id, c]))
    for (const t of board.bounty) {
      expect(t.kind).toBe('bounty')
      expect(t.lairTier).toBe(1) // 声望 0 → 一档
      const card = cards.get(t.anomalyId!)!
      expect(t.galaxyId).toBe(card.galaxyId)
      expect(t.lairName).toBe(lairNameOf(card, 1))
      expect(t.rewardIsk).toBe(lairTaskRewardIsk(card, 1))
      expect(t.need).toBe(0)
      expect(t.goodKey).toBe('')
    }
  })

  it('声望 6 → 二档（更高威胁、更高酬金）；未探索星系不入池；无核心词卡永不出现在赏金任务', () => {
    const { state, ctx } = makeWorld()
    state.standings[DSI_FACTION_ID] = 6
    // far 未探索：只应刷出 hub 的窝点（1 张）
    openBoard(state, ctx)
    expect(state.sideTasks.bounty).toHaveLength(1)
    const only = state.sideTasks.bounty[0]!
    expect(only.anomalyId).toBe('ano-lair-a')
    expect(only.lairTier).toBe(2)
    expect(only.rewardIsk).toBe(lairTaskRewardIsk(LAIR_A, 2))
    expect(only.rewardIsk).toBeGreaterThan(lairTaskRewardIsk(LAIR_A, 1))
    // 默认测试卡 ano-a 无核心词 → 绝不入赏金列表
    expect(state.sideTasks.bounty.some((t) => t.anomalyId === 'ano-a')).toBe(false)
  })

  it('每轮整板替换：跨过下一个整点 → 赏金任务换新（id 递增、旧任务作废，无惩罚）', () => {
    const { state, ctx } = makeWorld()
    markExplored(state, 'galaxy-far')
    state.standings[DSI_FACTION_ID] = 4
    openBoard(state, ctx)
    const first = state.sideTasks.bounty.map((t) => t.id)
    expect(first.length).toBeGreaterThan(0)
    advanceGame(state, PERIOD, ctx)
    const second = state.sideTasks.bounty
    expect(second).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    expect(second.every((t) => t.id > Math.max(...first))).toBe(true)
    // 面板视图同步暴露赏金列表与剩余时间
    const view = sideTaskBoard(state, ctx)
    expect(view.bounty).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    expect(view.remainingMs).toBeGreaterThan(0)
  })
})

describe('赏金任务 · 出击校验（目的 = 窝点，难度不超声望上限）', () => {
  it('带档位出击：非窝点目标拒绝；档位超过声望上限拒绝', () => {
    const { state, ctx } = makeWorld()
    const plain = startExpedition(state, 'ano-a', ctx, { lairTier: 1 })
    expect(plain.ok).toBe(false)
    expect(plain.error).toContain('窝点')
    const tooHigh = startExpedition(state, 'ano-lair-a', ctx, { lairTier: 3 }) // 声望 0 → 上限一档
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.error).toContain('声望')
    const ok = startExpedition(state, 'ano-lair-a', ctx, { lairTier: 1 })
    expect(ok.ok).toBe(true)
    expect(state.expedition.lairTier).toBe(1)
    // 远征视图按窝点口径展示（名称/威胁 = 强化后）
    expect(state.expedition.battle).not.toBeNull()
  })
})

describe('赏金任务 · 胜利结算（酬金 + 稀有残骸）', () => {
  /** 造一个"板上已有该窝点赏金任务 + 舰队已抵达"的局面 */
  function aboardLair(seed = 5): { state: GameState; ctx: SimContext; taskId: number; rewardIsk: number } {
    const { state, ctx } = makeWorld(seed)
    openBoard(state, ctx)
    const task = state.sideTasks.bounty.find((t) => t.anomalyId === 'ano-lair-a')!
    const r = startExpedition(state, 'ano-lair-a', ctx, { lairTier: task.lairTier })
    expect(r.ok).toBe(true)
    return { state, ctx, taskId: task.id, rewardIsk: task.rewardIsk }
  }

  it('打赢窝点：酬金入账 + 该条下板 + 稀有残骸 ×档位件数落在该星系 + 日志引导', () => {
    const { state, ctx, rewardIsk } = aboardLair()
    const iskBefore = state.wallet.isk
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    // 酬金（另有本场窝点奖金，故只断言"至少"）
    expect(state.wallet.isk).toBeGreaterThanOrEqual(iskBefore + rewardIsk)
    // 下板
    expect(state.sideTasks.bounty.some((t) => t.anomalyId === 'ano-lair-a')).toBe(false)
    // 稀有残骸：按敌群记账、数量 = 档位件数
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(LAIR_RARE_WRECK_GAIN[1])
    expect(state.galaxyWrecks['galaxy-hub']!.rareBy).toEqual({ 'ano-lair-a': LAIR_RARE_WRECK_GAIN[1] })
    // 日志：战报用窝点名 + 赏金任务完成引导
    const texts = state.logs.map((l) => l.text).join('\n')
    expect(texts).toContain(lairNameOf(LAIR_A, 1))
    expect(texts).toContain('赏金任务完成')
    expect(texts).toContain('高级箱')
    // 档位随本场作废（避免重复清剿无限复打窝点）
    expect(state.expedition.lairTier).toBeUndefined()
  })

  it('打输窝点：不结算酬金、不投放稀有残骸、任务仍在板上（可再来）', () => {
    const { state, ctx } = aboardLair(9)
    state.expedition.battle!.ended = 'foe'
    resolveBattleOutcome(state, ctx)
    expect(state.sideTasks.bounty.some((t) => t.anomalyId === 'ano-lair-a')).toBe(true)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(0)
    expect(state.galaxyWrecks['galaxy-hub']?.rareBy ?? {}).toEqual({})
    expect(state.expedition.lairTier).toBeUndefined()
  })

  it('任务已过期（不在板上）时照打照掉：稀有残骸一样投放，只是没有酬金', () => {
    const { state, ctx } = makeWorld(13)
    const r = startExpedition(state, 'ano-lair-a', ctx, { lairTier: 1 })
    expect(r.ok).toBe(true)
    expect(state.sideTasks.bounty).toHaveLength(0)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(LAIR_RARE_WRECK_GAIN[1])
  })

  it('普通悬赏（不带档位）胜利：不投放稀有残骸', () => {
    const { state, ctx } = makeWorld(17)
    const r = startExpedition(state, 'ano-a', ctx)
    expect(r.ok).toBe(true)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(0)
  })

  it('结算幂等：同一张任务重复结算只入账一次酬金', () => {
    const { state, ctx, rewardIsk } = aboardLair(21)
    injectRareWreck(state, 'galaxy-hub', 'ano-lair-a', 0) // 建档不改数
    const task = state.sideTasks.bounty.find((t) => t.anomalyId === 'ano-lair-a')!
    const before = state.wallet.isk
    settleBountyTaskVictory(state, ctx, 'ano-lair-a', 1)
    expect(state.wallet.isk).toBe(before + rewardIsk)
    settleBountyTaskVictory(state, ctx, 'ano-lair-a', 1)
    expect(state.wallet.isk).toBe(before + rewardIsk)
    expect(task.id).toBeGreaterThan(0)
  })
})

describe('稀有残骸 · 打捞必得 + 高级箱额外掉落', () => {
  it('打捞一轮必捞一件稀有残骸（体积 30 m³、按敌群归族），捞完为止再回常规池', () => {
    const { state, ctx } = makeWorld(3)
    injectRareWreck(state, 'galaxy-hub', 'ano-lair-a', 2)
    const first = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(first.itemId).toBe(rareWreckItemIdOf('ano-lair-a'))
    expect(first.volumeM3).toBe(RARE_WRECK_VOLUME_M3)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(1)
    const second = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(second.itemId).toBe(rareWreckItemIdOf('ano-lair-a'))
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(0)
    const third = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(third.itemId.startsWith('wreck-rare-')).toBe(false) // 存量清空 → 常规残骸
  })

  it('高级箱画像：稀有残骸标记 rare（保底照常），并有该敌群专属装备池', () => {
    const { ctx } = makeWorld()
    const normal = recycleProfileOf(ctx, 'wreck-ano-lair-a')!
    expect(normal.rare).toBeUndefined()
    const rare = recycleProfileOf(ctx, rareWreckItemIdOf('ano-lair-a'))!
    expect(rare.rare).toBe(true)
    expect(rare.lairGear).toEqual(['mod-a'])
    expect(rare.anomalyId).toBe('ano-lair-a')
  })

  it('额外掉落必定有货：含矿物一批（数量按档位）且至少一件装备（专属或主题件）', () => {
    const { state, ctx } = makeWorld(23)
    const profile = recycleProfileOf(ctx, rareWreckItemIdOf('ano-lair-a'))!
    const extra = rollRareBoxExtra(state, ctx, profile)!
    expect(extra.minerals).toHaveLength(1)
    expect(extra.minerals[0]!.units).toBe(RARE_BOX_MINERAL_UNITS[profile.tier])
    expect(extra.modules.length).toBeGreaterThanOrEqual(1)
    expect(extra.note.length).toBeGreaterThan(0)
  })

  it('专属装备池按敌族取（卡级覆盖优先）；无登记敌族时退回主题追加件（额外掉落不会空手）', () => {
    const { state, ctx } = makeWorld(29)
    // 卡级池覆盖：LAIR_A 显式写了自己的一件
    expect(recycleProfileOf(ctx, rareWreckItemIdOf('ano-lair-a'))!.lairGear).toEqual(['mod-a'])
    // 族级池兜底：LAIR_B 未写卡级池，按 B 族取「拾荒者拆解臂」
    expect(recycleProfileOf(ctx, rareWreckItemIdOf('ano-lair-b'))!.lairGear).toEqual(['mod-lair-salvager-b'])
    // 既无卡级池也无敌族 → 无专属池，额外掉落退回主题追加件
    const nf = recycleProfileOf(ctx, rareWreckItemIdOf('ano-lair-nf'))!
    expect(nf.lairGear).toBeUndefined()
    for (let i = 0; i < 5; i += 1) {
      expect(rollRareBoxExtra(state, ctx, nf)!.modules).toEqual(['mod-a'])
    }
  })
})

describe('赏金任务 · 存档往返与老档兼容', () => {
  it('bounty 板与稀有残骸记账（rare/rareBy）落档保真', () => {
    const { state, ctx } = makeWorld(41)
    markExplored(state, 'galaxy-far')
    openBoard(state, ctx)
    injectRareWreck(state, 'galaxy-hub', 'ano-lair-a', 2)
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.sideTasks.bounty).toEqual(state.sideTasks.bounty)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rare).toBe(2)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rareBy).toEqual({ 'ano-lair-a': 2 })
  })

  it('老档（无 bounty / 无 rareBy 字段）读入：补空板、残骸记录不含归族表，其余无损', () => {
    const { state, ctx } = makeWorld(43)
    state.galaxyWrecks['galaxy-hub'] = { density: 12 } as never
    const raw = state as unknown as Record<string, unknown>
    delete (raw.sideTasks as Record<string, unknown>).bounty
    const loaded = loadSaveFile(serializeSaveFile(raw as unknown as GameState, 0))
    expect(loaded.state.sideTasks.bounty).toEqual([])
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.density).toBe(12)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rareBy).toBeUndefined()
    expect(Object.keys(loaded.state.galaxyWrecks)).toEqual(['galaxy-hub'])
    expect(ctx.anomalies.get('ano-lair-a')).toBeTruthy()
  })
})
