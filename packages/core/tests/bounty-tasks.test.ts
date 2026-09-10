/**
 * 赏金任务 · 敌人窝点（2026-09-10 船长定，当日多轮修订后的最终口径）：
 * - 任务中心「赏金任务」= 临时战斗任务，**独立日板**：24 小时一轮、每天本地 0 点整板替换；
 *   资源/快递仍是 20 分钟板，两者互不影响；
 * - **抽地点**：按安全等级分区抽，**高安不派发**、排除高安后按候选数比例分 → 中安 2 席 + 低安 3 席
 *   （共 5 个地点/天）；各区独立抽、抽不满就少发（不跨区补位）；同一天不重复星系；
 * - **发档位**：三档（外围/核心/深层）**随机发放**，但**保证每天每个档位至least一张**——
 *   5 席 = 三档各 1 + 余下 2 席随机；恰好 3 席 = 三档各 1；2 席 = 两个不同档位；1 席 = 随机一档；
 * - **B 族（武装拾荒者）取消**：不入窝点候选、不出赏金任务、不出稀有残骸与专属装备（词表留档）；
 * - 声望门槛（`AnomalyDef.standingReq`）= **接取条件**（不够也照刷，出发时拒）；
 *   旧规则「窝点档位上限由声望决定」已退役（档位改由日板发放）；
 * - 目标 = 按该星系主题悬赏**派生**的窝点：威胁 ×档位系数（1.3/1.6/2.0）、加僚机与波次
 *   （波次威胁大头后置）、三档称呼按敌族定制（外围/核心/深层，均为"地点"语义）；
 * - **赏金倍率 2/4/8**：窝点奖金 = 主题悬赏奖金 ×2/×4/×8，威胁不受影响；
 * - 打赢：窝点奖金 + 赏金任务酬金入账 + 该星系稀有残骸 ×档位件数（打捞必得）
 *   → 回站精炼炉「残骸回收」当**高级箱**开（常规保底 + 必定额外掉落，含该敌群专属装备）；
 * - 打输/撤退：任务不下板（可再来），不投放稀有残骸，窝点档位随本场作废。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import {
  BOUNTY_BOARD_PERIOD_MS,
  BOUNTY_TASKS_PER_ROUND,
  BOUNTY_ZONE_PLAN,
  DEFAULT_BALANCE,
  DSI_FACTION_ID,
  FOE_LAIR_TIERS,
  LAIR_RARE_WRECK_GAIN,
  LAIR_REWARD_MUL,
  LAIR_TASK_REWARD_MUL,
  LAIR_THREAT_MUL,
  RARE_BOX_MINERAL_UNITS,
  RARE_WRECK_VOLUME_M3,
  advanceGame,
  bountyDamageForecast,
  bountyDayStartWallMs,
  bountyWinPercentGuarded,
  createInitialState,
  hasLairCore,
  injectRareWreck,
  isLairCandidate,
  lairAnomalyOf,
  lairBaseRewardIsk,
  lairGearOf,
  lairNameOf,
  lairTaskRewardIsk,
  loadSaveFile,
  markExplored,
  pullOneWreck,
  rareWreckCountOf,
  rareWreckItemIdOf,
  recycleProfileOf,
  rollRareBoxExtra,
  securityZoneOf,
  serializeSaveFile,
  settleBountyTaskVictory,
  sideTaskBoard,
  startExpedition,
} from '../src/index'
import { resolveBattleOutcome } from '../src/expedition'
import { anomaly, galaxy, makeTestCtx } from './helpers'

/** 20 分钟板周期（资源/快递仍在用） */
const PERIOD = DEFAULT_BALANCE.market.orderLifeMs.common
/**
 * 赏金日板的基准墙钟 = 某个"**本地正午**"：先取任意时刻的本地日界再 +12h。
 * 这样任何时区下它都落在该自然日的中段——"当天稍晚（+6h）不换板 / 次日（+24h）换板"两断言都不受时区影响
 * （直接写 UTC 正午在 UTC+8 等时区会变成当地 20:00，+6h 就跨日了）。
 */
const T0 = bountyDayStartWallMs(Date.UTC(2026, 8, 10, 12, 0, 0)) + 12 * 3_600_000

/* ── 测试世界：三类安全等级的星系各备足候选，另备高安/B 族/无敌族卡做反例 ── */
const GALAXIES = [
  galaxy('galaxy-hub', '母港', { security: 0.1 }), // 中安（默认已探索）
  galaxy('galaxy-mid2', '中安二号', { security: 0.2 }),
  galaxy('galaxy-mid3', '中安三号', { security: 0.3 }),
  galaxy('galaxy-far', '远方', { security: -0.5 }), // 低安
  galaxy('galaxy-low2', '低安二号', { security: -0.9 }),
  galaxy('galaxy-low3', '低安三号', { security: -0.7 }),
  galaxy('galaxy-low4', '低安四号', { security: -0.1 }),
  galaxy('galaxy-high', '高安一号', { security: 0.6 }),
  galaxy('galaxy-bn', '拾荒带', { security: 0.1 }), // B 族卡所在（中安）
  galaxy('galaxy-nf', '无名星系', { security: 0 }),
]

/** 中安 · 海盗（带卡级专属池覆盖） */
const LAIR_HUB = anomaly('ano-lair-hub', 'galaxy-hub', {
  threat: 4,
  reward: 20_000,
  lairCore: '测试海盗',
  foeFamily: 'A',
  recycleLoot: { modules: ['mod-a'] },
  lairGear: ['mod-a'],
})
/** 中安 · 异形 */
const LAIR_MID2 = anomaly('ano-lair-mid2', 'galaxy-mid2', {
  threat: 10,
  reward: 30_000,
  lairCore: '测试虫群',
  foeFamily: 'C',
})
/** 中安 · 守墓 */
const LAIR_MID3 = anomaly('ano-lair-mid3', 'galaxy-mid3', {
  threat: 12,
  reward: 40_000,
  lairCore: '测试守墓者',
  foeFamily: 'D',
})
/** 低安 · 烬火（族级专属池 = 流亡蜂群巢；用于族池兜底断言） */
const LAIR_LOW1 = anomaly('ano-lair-low1', 'galaxy-far', {
  threat: 30,
  reward: 60_000,
  lairCore: '测试流亡者',
  foeFamily: 'G',
  recycleLoot: { modules: ['mod-b'] },
})
/** 低安 · 泰坦（带声望门槛 4：用于"接取门槛"断言） */
const LAIR_LOW2 = anomaly('ano-lair-low2', 'galaxy-low2', {
  threat: 20,
  req: 4,
  reward: 50_000,
  lairCore: '测试巨构',
  foeFamily: 'E',
})
const LAIR_LOW3 = anomaly('ano-lair-low3', 'galaxy-low3', {
  threat: 22,
  reward: 55_000,
  lairCore: '测试畸变群',
  foeFamily: 'C',
})
const LAIR_LOW4 = anomaly('ano-lair-low4', 'galaxy-low4', {
  threat: 24,
  reward: 58_000,
  lairCore: '测试虚海守望者',
  foeFamily: 'D',
})
/** 高安卡：**永不出现在日板** */
const LAIR_HIGH = anomaly('ano-lair-high', 'galaxy-high', {
  threat: 16,
  reward: 25_000,
  lairCore: '高安海盗',
  foeFamily: 'A',
})
/** B 族卡（武装拾荒者）：已取消 —— 不入候选、不出任务、无专属装备 */
const LAIR_B = anomaly('ano-lair-b', 'galaxy-bn', {
  threat: 30,
  req: 0,
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

const ALL_LAIR_CARDS = [LAIR_HUB, LAIR_MID2, LAIR_MID3, LAIR_LOW1, LAIR_LOW2, LAIR_LOW3, LAIR_LOW4, LAIR_HIGH, LAIR_B, LAIR_NF]

function makeWorld(seed = 31): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed })
  // 航路：母港 ↔ 各测试星系（galaxy-far 已有默认航线，跳过以免重复）
  const edges = GALAXIES.filter((g) => g.id !== 'galaxy-hub' && g.id !== 'galaxy-far').map((g) => ({
    from: 'galaxy-hub',
    to: g.id,
    travelMinutes: 2,
  }))
  const ctx = makeTestCtx({ quietEvents: true, galaxies: GALAXIES, edges, anomalies: ALL_LAIR_CARDS })
  return { state, ctx }
}

/** 探索全部测试星系（日板抽地点的前提） */
function exploreAll(state: GameState): void {
  for (const g of GALAXIES) markExplored(state, g.id)
}

/**
 * 开赏金日板：推进一小片游戏时间 + 传入"某日正午"的墙钟 → 日界刷新触发（每天本地 0 点换板）。
 * `wallMs` 显式传入即可模拟"跨到下一天"（默认 T0 = 2026-09-10 正午 UTC）。
 */
function openBountyBoard(state: GameState, ctx: SimContext, wallMs: number = T0): void {
  advanceGame(state, 1_000, ctx, { nowWallMs: wallMs })
}

describe('赏金任务 · 窝点派生（档位 / 名称 / 卡面口径）', () => {
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
    expect(lairNameOf(LAIR_HUB, 1)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[0]}`)
    expect(lairNameOf(LAIR_HUB, 2)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[1]}`)
    expect(lairNameOf(LAIR_HUB, 3)).toBe(`测试海盗·${FOE_LAIR_TIERS.A[2]}`)
    expect(lairNameOf(LAIR_LOW1, 3)).toBe(`测试流亡者·${FOE_LAIR_TIERS.G[2]}`)
  })

  it('赏金倍率 2/4/8：窝点奖金 = 主题奖金 ×2/×4/×8（威胁不受影响）；酬金 = 奖金 ×0.5/0.75/1.0', () => {
    expect(LAIR_REWARD_MUL).toEqual({ 1: 2, 2: 4, 3: 8 })
    for (const t of [1, 2, 3] as const) {
      // 奖金：×赏金倍率
      expect(lairBaseRewardIsk(LAIR_HUB, t)).toBe(20_000 * LAIR_REWARD_MUL[t])
      // 威胁：仍走原档位系数（与倍率解耦）
      expect(lairAnomalyOf(LAIR_HUB, t).threat).toBe(Math.round(LAIR_HUB.threat * LAIR_THREAT_MUL[t]))
      // 酬金：窝点奖金 ×档位比例（跟强度递增）
      expect(lairTaskRewardIsk(LAIR_HUB, t)).toBe(Math.round(lairBaseRewardIsk(LAIR_HUB, t) * LAIR_TASK_REWARD_MUL[t]))
    }
    expect(LAIR_REWARD_MUL[1]).toBeGreaterThan(1) // 一档也明确高于常驻悬赏原值
    expect(lairBaseRewardIsk(LAIR_HUB, 3)).toBe(lairBaseRewardIsk(LAIR_HUB, 1) * 4)
    expect(lairTaskRewardIsk(LAIR_HUB, 3)).toBeGreaterThan(lairTaskRewardIsk(LAIR_HUB, 1))
  })

  it('可作窝点的判定：有核心词、非隐藏、奖金 > 0、**非 B 族**；hasLairCore 只判"有无核心词"', () => {
    expect(isLairCandidate(LAIR_HUB)).toBe(true)
    expect(isLairCandidate(anomaly('ano-plain', 'galaxy-hub'))).toBe(false) // 无核心词
    expect(isLairCandidate(anomaly('ano-zero', 'galaxy-hub', { reward: 0, lairCore: '空' }))).toBe(false) // 奖金 0
    expect(isLairCandidate(anomaly('ano-hidden', 'galaxy-hub', { lairCore: '藏', hidden: true }))).toBe(false) // 隐藏
    // B 族取消（2026-09-10 船长定）：不入窝点候选，但其核心词仍在（旧档稀有残骸靠它识别）
    expect(isLairCandidate(LAIR_B)).toBe(false)
    expect(hasLairCore(LAIR_B)).toBe(true)
    expect(lairGearOf(LAIR_B)).toEqual([]) // B 族专属装备一并撤下
  })
  it('胜率预估按**强化后的窝点卡**算（2026-09-10：赏金卡也要胜率）：档位越高损耗越高、胜率不升', () => {
    const { state, ctx } = makeWorld(5)
    const fcBase = bountyDamageForecast(state, ctx, LAIR_HUB)
    const fc1 = bountyDamageForecast(state, ctx, lairAnomalyOf(LAIR_HUB, 1))
    const fc3 = bountyDamageForecast(state, ctx, lairAnomalyOf(LAIR_HUB, 3))
    // 窝点比主题悬赏更硬 → 预计承伤不降；三档 ≥ 一档 ≥ 原卡；解析胜率（未钳制）反向单调
    expect(fc1.armorLoss + fc1.hullLoss).toBeGreaterThanOrEqual(fcBase.armorLoss + fcBase.hullLoss)
    expect(fc3.armorLoss + fc3.hullLoss).toBeGreaterThanOrEqual(fc1.armorLoss + fc1.hullLoss)
    expect(fcBase.rawWin).toBeGreaterThanOrEqual(fc1.rawWin)
    expect(fc1.rawWin).toBeGreaterThanOrEqual(fc3.rawWin)
    // 展示口径同源：档位越高，预估胜率不升（强化卡走的是同一套推演）
    const w1 = bountyWinPercentGuarded(state, ctx, lairAnomalyOf(LAIR_HUB, 1), state.shipId)
    const w3 = bountyWinPercentGuarded(state, ctx, lairAnomalyOf(LAIR_HUB, 3), state.shipId)
    expect(w3).toBeLessThanOrEqual(w1)
    expect(w1).toBeLessThanOrEqual(bountyWinPercentGuarded(state, ctx, LAIR_HUB, state.shipId))
  })
})

describe('赏金任务 · 日板抽地点与发档位（船长口径）', () => {
  it('席位表：高安不派发 → 中安 2 席 + 低安 3 席 = 5 个地点/天', () => {
    expect(BOUNTY_ZONE_PLAN.map((p) => [p.zone, p.count])).toEqual([
      ['中安', 2],
      ['低安', 3],
    ])
    expect(BOUNTY_TASKS_PER_ROUND).toBe(5)
  })

  it('全图已探索：5 张 = 中安 2 + 低安 3；档位随机但**三档各至少一张**；高安与 B 族绝不出现', () => {
    const { state, ctx } = makeWorld()
    exploreAll(state)
    openBountyBoard(state, ctx)
    const board = state.sideTasks.bounty
    expect(board).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    // 地点来源：中安 2 + 低安 3，且不重复星系
    const zones = board.map((t) => securityZoneOf(ctx, t.galaxyId!))
    expect(zones.filter((z) => z === '中安')).toHaveLength(2)
    expect(zones.filter((z) => z === '低安')).toHaveLength(3)
    expect(zones).not.toContain('高安')
    expect(new Set(board.map((t) => t.galaxyId)).size).toBe(board.length)
    // 高安卡与 B 族卡永不入板
    expect(board.some((t) => t.anomalyId === LAIR_HIGH.id)).toBe(false)
    expect(board.some((t) => t.anomalyId === LAIR_B.id)).toBe(false)
    expect(board.some((t) => t.galaxyId === 'galaxy-high' || t.galaxyId === 'galaxy-bn')).toBe(false)
    // 档位：三档各至少一张（5 席 = 3 保底 + 2 随机）
    const tiers = board.map((t) => t.lairTier!).sort()
    expect(tiers).toContain(1)
    expect(tiers).toContain(2)
    expect(tiers).toContain(3)
    expect(tiers).toHaveLength(5)
    // 卡面口径：显示名/酬金随所发档位锁定
    for (const t of board) {
      const card = ctx.anomalies.get(t.anomalyId!)!
      expect(t.lairName).toBe(lairNameOf(card, t.lairTier!))
      expect(t.rewardIsk).toBe(lairTaskRewardIsk(card, t.lairTier!))
      expect(t.kind).toBe('bounty')
      expect(t.need).toBe(0)
      expect(t.goodKey).toBe('')
    }
  })

  it('恰好 3 个地点 → 外围/核心/深层各一张（船长点名的例子）', () => {
    const { state, ctx } = makeWorld()
    // 中安只剩 up to 1（hub）、低安 up to 2（far、low2）→ 共 3 席
    markExplored(state, 'galaxy-hub')
    markExplored(state, 'galaxy-far')
    markExplored(state, 'galaxy-low2')
    openBountyBoard(state, ctx)
    const board = state.sideTasks.bounty
    expect(board).toHaveLength(3)
    expect(board.map((t) => t.lairTier!).sort()).toEqual([1, 2, 3])
    expect(board.map((t) => securityZoneOf(ctx, t.galaxyId!)).sort()).toEqual(['中安', '低安', '低安'])
  })

  it('2 个地点 → 两个不同档位；1 个地点 → 随机一档（抽不满就少发，不跨区补位）', () => {
    const two = makeWorld(5)
    markExplored(two.state, 'galaxy-hub') // 中安 1
    markExplored(two.state, 'galaxy-far') // 低安 1
    openBountyBoard(two.state, two.ctx)
    const twoBoard = two.state.sideTasks.bounty
    expect(twoBoard).toHaveLength(2)
    expect(new Set(twoBoard.map((t) => t.lairTier)).size).toBe(2)

    const one = makeWorld(7)
    markExplored(one.state, 'galaxy-hub') // 只有中安 1 个候选
    openBountyBoard(one.state, one.ctx)
    const oneBoard = one.state.sideTasks.bounty
    expect(oneBoard).toHaveLength(1)
    expect([1, 2, 3]).toContain(oneBoard[0]!.lairTier)
    expect(oneBoard[0]!.galaxyId).toBe('galaxy-hub')
  })

  it('未探索星系的候选不入池；无核心词卡永不入板；同 seed 双跑完全一致（确定性）', () => {
    const a = makeWorld(11)
    const b = makeWorld(11)
    for (const w of [a, b]) {
      markExplored(w.state, 'galaxy-hub')
      markExplored(w.state, 'galaxy-far')
      markExplored(w.state, 'galaxy-low2')
      markExplored(w.state, 'galaxy-low3')
    }
    openBountyBoard(a.state, a.ctx)
    openBountyBoard(b.state, b.ctx)
    expect(a.state.sideTasks.bounty).toEqual(b.state.sideTasks.bounty)
    expect(a.state.rng).toEqual(b.state.rng)
    // 未探索的中安三号/低安四号不在候选中：本局 4 席只能来自 1 中安 + 3 低安里的已探索者
    const galaxies = a.state.sideTasks.bounty.map((t) => t.galaxyId)
    expect(galaxies).not.toContain('galaxy-mid2')
    expect(galaxies).not.toContain('galaxy-low4')
    expect(a.state.sideTasks.bounty.some((t) => t.anomalyId === 'ano-a')).toBe(false) // 无核心词卡
  })

  it('整板替换 = 每天本地 0 点：跨到次日换新，当日不换；离线跨夜只补末界；无墙钟不开板', () => {
    const { state, ctx } = makeWorld()
    exploreAll(state)
    openBountyBoard(state, ctx, T0)
    const first = state.sideTasks.bounty.map((t) => t.id)
    expect(first).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    expect(state.sideTasks.bountyWindow).toBe(bountyDayStartWallMs(T0))
    // 同一天内推进 20 分钟板周期 + 稍晚时刻 → 赏金板不动（两套板彼此独立）
    advanceGame(state, PERIOD, ctx, { nowWallMs: T0 + PERIOD })
    advanceGame(state, PERIOD, ctx, { nowWallMs: T0 + 6 * 3_600_000 })
    expect(state.sideTasks.bounty.map((t) => t.id)).toEqual(first)
    // 跨到次日 → 整板换新
    openBountyBoard(state, ctx, T0 + BOUNTY_BOARD_PERIOD_MS)
    const second = state.sideTasks.bounty
    expect(second).toHaveLength(BOUNTY_TASKS_PER_ROUND)
    expect(second.every((t) => t.id > Math.max(...first))).toBe(true)
    // 离线跨多日：只补最后一道界（幂等）
    openBountyBoard(state, ctx, T0 + 3 * BOUNTY_BOARD_PERIOD_MS)
    const third = state.sideTasks.bounty.map((t) => t.id)
    expect(third.every((id) => id > Math.max(...second.map((t) => t.id)))).toBe(true)
    openBountyBoard(state, ctx, T0 + 3 * BOUNTY_BOARD_PERIOD_MS + 3_600_000)
    expect(state.sideTasks.bounty.map((t) => t.id)).toEqual(third)
    // 视图：日板倒计时 ≤ 24 小时
    const view = sideTaskBoard(state, ctx, T0 + 3 * BOUNTY_BOARD_PERIOD_MS + 3_600_000)
    expect(view.bountyOpened).toBe(true)
    expect(view.bountyRemainingMs).toBeGreaterThan(0)
    expect(view.bountyRemainingMs).toBeLessThanOrEqual(BOUNTY_BOARD_PERIOD_MS)

    // 无有效墙钟（旧档首帧）：不开板
    const fresh = makeWorld(13)
    exploreAll(fresh.state)
    advanceGame(fresh.state, 1_000, fresh.ctx)
    expect(fresh.state.sideTasks.bountyWindow).toBe(0)
    expect(fresh.state.sideTasks.bounty).toHaveLength(0)
    openBountyBoard(fresh.state, fresh.ctx, T0)
    expect(fresh.state.sideTasks.bounty).toHaveLength(BOUNTY_TASKS_PER_ROUND)
  })
})

describe('赏金任务 · 出击校验（目的 = 窝点；档位不再受声望封顶）', () => {
  it('非窝点目标带档位出击 → 拒；B 族卡带档位出击 → 拒（已取消）', () => {
    const { state, ctx } = makeWorld()
    const plain = startExpedition(state, 'ano-a', ctx, { lairTier: 1 })
    expect(plain.ok).toBe(false)
    expect(plain.error).toContain('窝点')
    markExplored(state, 'galaxy-bn')
    const bFam = startExpedition(state, LAIR_B.id, ctx, { lairTier: 1 })
    expect(bFam.ok).toBe(false)
    expect(bFam.error).toContain('窝点')
  })

  it('旧规则已退役：声望 0 也能接深层窝点（档位由日板发放，接取门槛只看卡面声望要求）', () => {
    const { state, ctx } = makeWorld()
    markExplored(state, 'galaxy-far')
    expect(state.standings[DSI_FACTION_ID] ?? 0).toBe(0)
    const deep = startExpedition(state, LAIR_LOW1.id, ctx, { lairTier: 3 })
    expect(deep.ok, deep.error ?? '').toBe(true)
    expect(state.expedition.lairTier).toBe(3)
    expect(state.expedition.battle).not.toBeNull()
  })

  it('接取门槛 = 卡面声望要求：不足拒接（任务仍在板上），达标后即可接', () => {
    const { state, ctx } = makeWorld()
    markExplored(state, 'galaxy-low2')
    const denied = startExpedition(state, LAIR_LOW2.id, ctx, { lairTier: 2 })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('声望 4')
    expect(state.expedition.active).toBe(false)
    state.standings[DSI_FACTION_ID] = 4
    const ok = startExpedition(state, LAIR_LOW2.id, ctx, { lairTier: 2 })
    expect(ok.ok, ok.error ?? '').toBe(true)
    expect(state.expedition.lairTier).toBe(2)
  })
})

describe('赏金任务 · 胜利结算（酬金 + 稀有残骸）', () => {
  /** 板上唯一那张 = 母港（中安 · 海盗）窝点；按它被发的档位出征并结算 */
  function aboardLair(seed = 5): { state: GameState; ctx: SimContext; tier: 1 | 2 | 3; rewardIsk: number } {
    const { state, ctx } = makeWorld(seed)
    openBountyBoard(state, ctx)
    const task = state.sideTasks.bounty.find((t) => t.anomalyId === LAIR_HUB.id)!
    const tier = task.lairTier as 1 | 2 | 3
    const r = startExpedition(state, LAIR_HUB.id, ctx, { lairTier: tier })
    expect(r.ok, r.error ?? '').toBe(true)
    return { state, ctx, tier, rewardIsk: task.rewardIsk }
  }

  it('打赢窝点：酬金入账 + 该条下板 + 稀有残骸 ×档位件数落在该星系 + 日志引导', () => {
    const { state, ctx, tier, rewardIsk } = aboardLair()
    const iskBefore = state.wallet.isk
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(state.wallet.isk).toBeGreaterThanOrEqual(iskBefore + rewardIsk)
    expect(state.sideTasks.bounty.some((t) => t.anomalyId === LAIR_HUB.id)).toBe(false)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(LAIR_RARE_WRECK_GAIN[tier])
    expect(state.galaxyWrecks['galaxy-hub']!.rareBy).toEqual({ [LAIR_HUB.id]: LAIR_RARE_WRECK_GAIN[tier] })
    const texts = state.logs.map((l) => l.text).join('\n')
    expect(texts).toContain(lairNameOf(LAIR_HUB, tier))
    expect(texts).toContain('赏金任务完成')
    expect(texts).toContain('高级箱')
    expect(state.expedition.lairTier).toBeUndefined()
  })

  it('打输窝点：不结算酬金、不投放稀有残骸、任务仍在板上（可再来）', () => {
    const { state, ctx } = aboardLair(9)
    state.expedition.battle!.ended = 'foe'
    resolveBattleOutcome(state, ctx)
    expect(state.sideTasks.bounty.some((t) => t.anomalyId === LAIR_HUB.id)).toBe(true)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(0)
    expect(state.galaxyWrecks['galaxy-hub']?.rareBy ?? {}).toEqual({})
    expect(state.expedition.lairTier).toBeUndefined()
  })

  it('任务已过期（不在板上）时照打照掉：稀有残骸一样投放，只是没有酬金', () => {
    const { state, ctx } = makeWorld(13)
    const r = startExpedition(state, LAIR_HUB.id, ctx, { lairTier: 1 })
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
    const before = state.wallet.isk
    settleBountyTaskVictory(state, ctx, LAIR_HUB.id, 1)
    expect(state.wallet.isk).toBe(before + rewardIsk)
    settleBountyTaskVictory(state, ctx, LAIR_HUB.id, 1)
    expect(state.wallet.isk).toBe(before + rewardIsk)
  })
})

describe('稀有残骸 · 打捞必得 + 高级箱额外掉落', () => {
  it('打捞一轮必捞一件稀有残骸（体积 30 m³、按敌群归族），捞完为止再回常规池', () => {
    const { state, ctx } = makeWorld(3)
    injectRareWreck(state, 'galaxy-hub', LAIR_HUB.id, 2)
    const first = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(first.itemId).toBe(rareWreckItemIdOf(LAIR_HUB.id))
    expect(first.volumeM3).toBe(RARE_WRECK_VOLUME_M3)
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(1)
    const second = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(second.itemId).toBe(rareWreckItemIdOf(LAIR_HUB.id))
    expect(rareWreckCountOf(state, 'galaxy-hub')).toBe(0)
    const third = pullOneWreck(state, ctx, 'galaxy-hub', 60_000)!
    expect(third.itemId.startsWith('wreck-rare-')).toBe(false)
  })

  it('高级箱画像：稀有残骸标记 rare（保底照常），并带专属装备池', () => {
    const { ctx } = makeWorld()
    expect(recycleProfileOf(ctx, 'wreck-ano-lair-hub')!.rare).toBeUndefined()
    const rare = recycleProfileOf(ctx, rareWreckItemIdOf(LAIR_HUB.id))!
    expect(rare.rare).toBe(true)
    expect(rare.lairGear).toEqual(['mod-a']) // 卡级池覆盖
    expect(rare.anomalyId).toBe(LAIR_HUB.id)
  })

  it('额外掉落必定有货：含矿物一批（数量按档位）且至少一件装备（专属或主题件）', () => {
    const { state, ctx } = makeWorld(23)
    const profile = recycleProfileOf(ctx, rareWreckItemIdOf(LAIR_HUB.id))!
    const extra = rollRareBoxExtra(state, ctx, profile)!
    expect(extra.minerals).toHaveLength(1)
    expect(extra.minerals[0]!.units).toBe(RARE_BOX_MINERAL_UNITS[profile.tier])
    expect(extra.modules.length).toBeGreaterThanOrEqual(1)
    expect(extra.note.length).toBeGreaterThan(0)
  })

  it('族级池兜底（G 族 → 流亡蜂群巢）；B 族已撤池；无族无卡级池 → 主题追加件', () => {
    const { state, ctx } = makeWorld(29)
    expect(recycleProfileOf(ctx, rareWreckItemIdOf(LAIR_LOW1.id))!.lairGear).toEqual(['mod-lair-drone-rack-g'])
    expect(lairGearOf(LAIR_B)).toEqual([])
    expect(recycleProfileOf(ctx, rareWreckItemIdOf(LAIR_B.id))!.lairGear).toBeUndefined()
    const nf = recycleProfileOf(ctx, rareWreckItemIdOf(LAIR_NF.id))!
    expect(nf.lairGear).toBeUndefined()
    for (let i = 0; i < 5; i += 1) {
      expect(rollRareBoxExtra(state, ctx, nf)!.modules).toEqual(['mod-a'])
    }
  })
})

describe('赏金任务 · 存档往返与老档兼容', () => {
  it('bounty 板（含逐条档位）与稀有残骸记账落档保真', () => {
    const { state, ctx } = makeWorld(41)
    exploreAll(state)
    openBountyBoard(state, ctx, T0)
    injectRareWreck(state, 'galaxy-hub', LAIR_HUB.id, 2)
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.sideTasks.bounty).toEqual(state.sideTasks.bounty)
    expect(loaded.state.sideTasks.bounty.every((t) => t.lairTier !== undefined)).toBe(true)
    expect(loaded.state.sideTasks.bountyWindow).toBe(bountyDayStartWallMs(T0))
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rare).toBe(2)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rareBy).toEqual({ [LAIR_HUB.id]: 2 })
  })

  it('老档（无 bounty / 无 bountyWindow / 无 rareBy 字段）读入：补空板与日界 0，其余无损', () => {
    const { state, ctx } = makeWorld(43)
    state.galaxyWrecks['galaxy-hub'] = { density: 12 } as never
    const raw = state as unknown as Record<string, unknown>
    delete (raw.sideTasks as Record<string, unknown>).bounty
    delete (raw.sideTasks as Record<string, unknown>).bountyWindow
    const loaded = loadSaveFile(serializeSaveFile(raw as unknown as GameState, 0))
    expect(loaded.state.sideTasks.bounty).toEqual([])
    expect(loaded.state.sideTasks.bountyWindow).toBe(0)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.density).toBe(12)
    expect(loaded.state.galaxyWrecks['galaxy-hub']!.rareBy).toBeUndefined()
    expect(ctx.anomalies.get(LAIR_HUB.id)).toBeTruthy()
  })
})
