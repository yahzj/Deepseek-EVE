/**
 * AI 核心系统（v8）：AI 核心 = 玩家的分身。
 *
 * 规则（中文说明，设计文档已确认）：
 * - 同时启用的 AI 核心总数上限 = AI 核心上限技能贡献之和（现唯一 = 「AI 核心操作学」，
 *   LvN = N 枚：AI 副船任务与站内 AI 设施共用——2026-09-08 船长定，副船不再单独计名额）；
 *   注：站内精炼炉/回收炉/制造线另有**工业专用工位**扩容（「工业自动化基础」+1/级、「工业自动化」+2/级），
 *   不占本上限、但每个工位仍要一枚实体核心——见 balance.aiCore.industrySkillSlots；
 * - 核心四档效率：基础 40% / 伽马 50% / 贝塔 60% / 阿尔法 75%；
 *   效率只拉长所驱动作业的时长（÷效率），不影响任何奖励（全额）；
 * - 基础核心空间站直购；伽马/贝塔/阿尔法由远征胜利按威胁概率掉落；
 * - 采矿任务：无风险，满舱自动返航→卸货入物品仓库→再出航（无限循环，直到取消）；
 * - 打捞任务：同采矿自动循环（2026-09-09 船长定，玩家反馈"AI 打捞只一趟"）——出航→打捞→
 *   满舱自动返港卸货→同星系再出航，直到取消；低安打捞按既有规则暴露/善后；
 * - 远征任务：只接预估胜率 ≥80% 的悬赏、且船耐久 ≥50%；胜利奖励/战利品/声望全额；
 *   失利扣耐久并按弃船骰判定（规则与主控一致）；耐久 ≤30% 自动维修（钱包付费）；
 * - 核心是空间站资产：任务结束/取消/弃船中断时自动归还核心库。
 */
import { addLog } from './state'
import type { AiAssignment, GameState } from './state'
import type { AiCoreType, SimContext } from './types'
import type { CommandResult } from './engine'
import { nextRandom } from './rng'
import { addWare, cargoUnitM3, freeCargoM3Of } from './inventory'
import { pullOneWreck, salvagerCyclesOf } from './salvaging'
import { isMineableItem } from './labels'
import { getMiningParams, oneLegMs, oneOutboundLegMs, richVeinP, rollBeltOutput, shipInReturn } from './mining'
import { bumpFirst, peakFirst } from './firstTasks'
import { matterTechSum } from './matterTech'
import { bountyRewardFactor, DSI_FACTION_ID, HOME_GALAXY_ID, calcPower, lootFactor, shortestTravelMinutes, standingOf } from './expedition'
import { bountyEnemyCount, bountyWreckInjection, injectWreckDensity, wreckDensityOf } from './salvage'
import { travelLegMs } from './travel'
import { scaledReturnMs } from './trips'
import { actionBlockReason, markExplored } from './explore'
import { nearestStationGalaxyId } from './location'
import {
  advanceBattleFor,
  aiFavorAdv,
  aiWinPreview,
  refundAmmo,
  refundRepairKitsAll,
  repairUsageText,
  settleDroneLosses,
  startBattleFor,
  // 战报改造（2026-09-14 船长定）：结构化战报的唯一构造点
  captureBattleReport,
} from './combat'
import { durabilityOf, loseShip, repairShip } from './shipyard'
import { fleetDefOf, shipDisplayName } from './instances'
import { buyAtMarket, levelOf, marketGoodOf, marketQuote, placeBuyOrder } from './market'
import { addAiIncome, addAiMiningTrip, addAiSalvageDone, type SettleStats } from './settleStats'

/** 核心类型展示顺序 */
export const AI_CORE_ORDER: readonly AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 核心中文名 */
export function aiCoreName(type: AiCoreType): string {
  return type === 'basic' ? '基础 AI 核心' : type === 'gamma' ? '伽马 AI 核心' : type === 'beta' ? '贝塔 AI 核心' : '阿尔法 AI 核心'
}

/** 效率（速度系数：1 = 玩家手操速度；只影响速度不影响奖励）。
 *  卷B3⑩（2026-09-08 船长定）：「AI 核心调度学」在核心档位之上每级 +2 个百分点累加
 *  （如基础核心 40% → 满级 50%；伽马 60% / 贝塔 70% / 阿尔法 85%，封顶 100%），
 *  覆盖全部核心驱动作业（副船任务与站内炉/线共源）；返航腿不 ÷eff（卷B2⑥ 口径）故天然不受影响。 */
export function aiEfficiency(state: GameState, ctx: SimContext, type: AiCoreType): number {
  const base = ctx.balance.aiCore.efficiency[type] ?? 1
  const dLv = Math.min(5, state.skills.trained[ctx.balance.aiCore.dispatchSkillId] ?? 0)
  return Math.min(1, base + ctx.balance.aiCore.dispatchPerLevel * dLv)
}

/** 核心库数量 */
export function countAiCore(state: GameState, type: AiCoreType): number {
  return state.aiCores[type] ?? 0
}

/**
 * **当前拥有的最高级 AI 核心**（**2026-09-23 船长令**：「**使用AI核心时，默认选择当前拥有的最高级核心**」）。
 *
 * 口径 = `AI_CORE_ORDER`（`basic → gamma → beta → alpha`，越靠后越高级）里**最靠后且数量 > 0** 的那一档；
 * 一个都没有 ⇒ `null`（调用方回落 `'basic'`，与改前逐字一致）。
 *
 * 为什么放在 core：星图 / 舰船页 / 远征 / 工业**四处**选择入口的默认值必须是同一把尺
 * （各写各的很容易一处漏改 ⇒ 玩家看到的默认核心各处不同）。
 */
export function bestAiCoreOf(state: GameState): AiCoreType | null {
  for (let i = AI_CORE_ORDER.length - 1; i >= 0; i -= 1) {
    const t = AI_CORE_ORDER[i]!
    if (countAiCore(state, t) > 0) return t
  }
  return null
}

/** 入库 */
export function gainAiCore(state: GameState, type: AiCoreType, count = 1): void {
  state.aiCores[type] = (state.aiCores[type] ?? 0) + count
  /**
   * **里程碑「AI 核心」的计数点**（成就系统第二批 · 船长 2026-09-20）。
   *
   * 记的是**库存里拥有过的类数**（本函数是全仓唯一的入库点 ⇒ 天然覆盖所有获得途径：
   * 遗迹核心、虫洞战果、掉落…），并按**峰值**记（`peakFirst`）——
   * 这样"曾集齐四类、后来花掉一枚"**不会把纪录改小**（记录的是"见过/拿过"，不是"此刻持有"）。
   */
  let kinds = 0
  for (const t of AI_CORE_ORDER) if ((state.aiCores[t] ?? 0) > 0) kinds += 1
  peakFirst(state, 'aiCoreKinds', kinds)
}

/** 出库 */
function spendAiCore(state: GameState, type: AiCoreType): boolean {
  const current = state.aiCores[type] ?? 0
  if (current <= 0) return false
  state.aiCores[type] = current - 1
  return true
}

/** 批量出库 N 枚（市场挂卖/出售锁定用；库存不足整批不动并返回 false） */
export function spendAiCores(state: GameState, type: AiCoreType, count: number): boolean {
  const current = state.aiCores[type] ?? 0
  if (count <= 0 || current < count) return false
  state.aiCores[type] = current - count
  return true
}

/** 占用一枚核心（出库；精炼炉 AI 自动化等"站内设施驱动"场景——不占副船名额） */
export function occupyAiCore(state: GameState, type: AiCoreType): boolean {
  return spendAiCore(state, type)
}

/** 归还一枚核心（入库；任务结束/取消/设施停用时调用） */
export function releaseAiCore(state: GameState, type: AiCoreType): void {
  gainAiCore(state, type)
}

/** 同时启用 AI 核心的总数上限 = 各「AI 核心上限」技能贡献之和
 * （现唯一 = AI 核心操作学等级（原"人工智能专家"，2026-09-08 更名降 rank2）；后续上限技能在此叠加——船长 2026-09-08 定：
 * AI 副船任务与站内 AI 设施共用同一上限，不再按用途分池；站内产业另有工业专用扩容见 industryAiBonus） */
export function aiCoreCap(state: GameState, ctx: SimContext): number {
  let cap = 0
  cap += state.skills.trained[ctx.balance.aiCore.skillId] ?? 0
  return cap
}

/** AI 副船任务占用的启用数（占「共用上限」名额）。
 * 2026-09-14 起**并入"自动探索"的参与舰**（船长：每条参与舰各占 1 枚 AI 核心，与副船任务同一本账）——
 * 这里直接读 `state.wormholeAuto`，不反向 import 自动探索模块（避免模块环）。 */
export function aiCoreShipUsed(state: GameState): number {
  const auto = (state.wormholeAuto ?? []).reduce((n, r) => n + (r.shipIds?.length ?? 0), 0)
  return Object.keys(state.aiAssignments).length + auto
}

/** 站内工业 AI 工位占用数（AI 精炼/回收炉 + AI 制造线；
 * 旧作业豁免的制造线 worker=undefined 未占核心 → 不计入）。2026-09-09 玩家反馈修复口径：
 * 站内工业占用先抵「工业自动化」扩容工位，只有超出扩容的部分才挤占共用名额（见 aiCoreCapBlock） */
export function aiCoreIndustryUsed(state: GameState): number {
  let used = 0
  for (const r of state.refineRuns) {
    if (r.worker !== 'pilot') used += 1
  }
  for (const m of state.manufacturingRuns) {
    if (m.worker !== undefined && m.worker !== 'pilot') used += 1
  }
  return used
}

/** 总启用数（AI 副船任务 + 站内 AI 精炼炉/回收炉/制造线） */
export function aiCoreUsed(state: GameState): number {
  return aiCoreShipUsed(state) + aiCoreIndustryUsed(state)
}

/** 工业专用 AI 工位扩容（2026-09-08 船长定；2026-09-11 改为**按技能记系数**）：
 * `balance.aiCore.industrySkillSlots` 表内技能「每级 +对应枚数」（工业自动化基础 +1/级、工业自动化 +2/级…）
 * ——只对站内精炼炉/回收炉/制造线生效，不增加 AI 副船任务上限；
 * 新增"工业 AI 专用扩容技能"只需往该表追加一行。
 *
 * ⚠ **2026-09-20 船长**：「**谜质研究的洞外工业，添加T4科技，增加工业AI上限，每级+1，最高5级**」
 * ⇒ 另加一支**谜质科技**来源：节点 `mt-industry-ai`「工业多核调度」（T4 · 5 级 · `effect: 'industryAiSlots'`），
 * 与技能那两支**相加**（效果关键字由 `core/matterTech.matterTechSum` 按 `per × 等级` 汇总——
 * 此处必须出现 `'industryAiSlots'` 字面量，内容体检的「谜质科技契约」靠它判"登记了没接线"）。
 * 满配：共用 5（AI 核心操作学 5 级 ×1）+ 技能 15（工业自动化基础 5×1 ＋ 工业自动化 5×2）+ 科技 5 = **25 个站内工位**
 * （技能等级上限 = `MAX_SKILL_LEVEL` = 5，与 `rank` 无关；两支技能满级合计 +15，见内容体检「AI 扩容技能契约」的读数行）。 */
export function industryAiBonus(state: GameState, ctx: SimContext): number {
  const table = ctx.balance?.aiCore?.industrySkillSlots
  let bonus = matterTechSum(state, ctx, 'industryAiSlots')
  if (!table) return bonus
  for (const [id, perLevel] of Object.entries(table)) {
    bonus += (state.skills.trained[id] ?? 0) * (perLevel ?? 0)
  }
  return bonus
}

/** AI 核心启用守卫（任何启用点共用）：null = 可启用；否则返回拒绝文案（上限未解锁 / 已满）。
 * scope = 'ship'：AI 副船任务，只受共用上限约束——站内工业占用先抵工业扩容（industryAiBonus），
 *   仅超出扩容的部分计入共用名额（2026-09-09 玩家反馈修复：工业核心全开不得挤占副船名额）；
 * scope = 'industry'：站内精炼炉/回收炉/制造线，上限 = 共用上限 + 工业专用扩容（industryAiBonus）。
 * 船长 2026-09-08 定：存量超限（读档/技能变化）不中断运行，但同样计入各池占用——
 * 想再启用新的必须先把占用降到上限以内。 */
export function aiCoreCapBlock(state: GameState, ctx: SimContext, scope: 'ship' | 'industry' = 'ship'): string | null {
  const cap = aiCoreCap(state, ctx)
  const bonus = industryAiBonus(state, ctx)
  const eff = cap + bonus
  if (eff <= 0 || (scope === 'ship' && cap <= 0)) {
    return 'AI 核心上限为 0：训练提升 AI 核心上限的技能（如「AI 核心操作学」）后才能启用 AI 核心（AI 副船任务与站内精炼炉/回收炉/制造线共用上限）。'
  }
  const shipUsed = aiCoreShipUsed(state)
  const indUsed = aiCoreIndustryUsed(state)
  if (scope === 'ship') {
    // 副船名额 = 共用上限 − 副船占用 −（工业占用超出工业扩容的部分）
    const indOnShared = Math.max(0, indUsed - bonus)
    const used = shipUsed + indOnShared
    if (used >= cap) {
      if (indOnShared > 0) {
        return `AI 核心启用已满（${used}/${cap}：副船 ${shipUsed} 枚 + 站内工业超出「工业自动化」扩容 ${indOnShared} 枚）：先停用部分站内工业 AI 或 AI 副船任务再启用新的。`
      }
      return `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线）再启用新的。`
    }
    return null
  }
  // scope = 'industry'：站内炉/线上限 = 共用 + 扩容，全量占用计入
  const used = shipUsed + indUsed
  if (used >= eff) {
    if (bonus > 0) {
      return `AI 核心启用已满（${used}/${eff}：共用上限 ${cap} + 工业扩容 ${bonus}）：先停用其它 AI 核心（AI 副船任务或站内炉/线），或训练「工业自动化」再扩工业工位。`
    }
    return `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线）再启用新的。`
  }
  return null
}

/** 可指派的空闲船（舰队里非主控、无任务、不在换船善后返航中的船）
 *  ⚠ **进了虫洞的船不算空闲**（船长 2026-09-13：「已经进洞的船将被锁定」）——它们锁在洞里，
 *  不能被派去采矿/打捞/掩护巡逻（否则同一艘船会被两处同时占用）。判据与 `shipBusyLabel` 同源。 */
export function idleAiShipIds(state: GameState): string[] {
  const inHole = state.wormhole.run?.fleet ?? []
  return Object.keys(state.fleet).filter(
    (id) =>
      id !== state.shipId && !inHole.includes(id) && !(id in state.aiAssignments) && !shipInReturn(state, id),
  )
}

/** 玩家指令：购买基础 AI 核心（V9：市场供应簿按市价买入；无现货自动挂收购单） */
export function buyBasicAiCore(state: GameState, ctx: SimContext): CommandResult {
  const good = marketGoodOf(ctx, 'aicore', 'basic')
  if (!good) return { ok: false, error: '基础 AI 核心暂未在市场流通。', errorId: 'core.ai.001' }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell ?? Math.round(levelOf(state, ctx, good.key) * 1.06)
  if (state.wallet.isk < ask) {
    return { ok: false, error: `信用点不足：基础 AI 核心约 ${ask.toLocaleString('zh-CN')} 信用点（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。` }
  }
  if (quote.sell !== undefined) {
    const res = buyAtMarket(state, ctx, good.key, 1)
    if (res.bought > 0) {
      addLog(
        state,
        'trade',
        `已购入 基础 AI 核心（市场价 ${res.total.toLocaleString('zh-CN')} 信用点）。AI 核心 = 你的分身，可指派给闲置舰船。`,
        'core.ai.009',
        { p1: res.total.toLocaleString('zh-CN') },
      )
      return { ok: true }
    }
  }
  // 供应簿瞬时吃穿：挂收购单（到货自动入核心库）
  const order = placeBuyOrder(state, ctx, good.key, ask, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包余额不足或订单无法成立）。', errorId: 'core.ai.002' }
  addLog(
    state,
    'trade',
    `基础 AI 核心供应簿暂时被买空——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} 信用点，到货自动入核心库（可随时撤销）。`,
    'core.ai.010',
    { p1: order.price.toLocaleString('zh-CN') },
  )
  return { ok: true }
}

/* ───────── 任务指派 ───────── */

/** 共同校验：船、名额、核心、空闲 */
function checkAssignable(state: GameState, shipId: string, coreType: AiCoreType, ctx: SimContext): CommandResult {
  if (shipId === state.shipId) return { ok: false, error: '主控船由你亲自驾驶，不能指派 AI。', errorId: 'core.ai.003' }
  if (!state.fleet[shipId]) return { ok: false, error: '舰队里没有这艘船。', errorId: 'core.ai.004' }
  if (shipId in state.aiAssignments) return { ok: false, error: '这艘船已有 AI 任务。', errorId: 'core.ai.005' }
  // 2026-09-14：自动探索中的船也不能再接 AI 副船任务（参与舰任务期间锁定）
  if ((state.wormholeAuto ?? []).some((r) => r.shipIds.includes(shipId))) {
    return {
      ok: false,
      error: '这艘船正在自动探索中（已锁定）：等它返航，或先在「扫描虫洞」页召回那一趟。',
      errorId: 'core.ai.006',
    }
  }
  const capBlock = aiCoreCapBlock(state, ctx)
  if (capBlock) return { ok: false, error: capBlock }
  if (countAiCore(state, coreType) <= 0) {
    return { ok: false, error: `${aiCoreName(coreType)} 库存不足（效率 ${Math.round(aiEfficiency(state, ctx, coreType) * 100)}%）。` }
  }
  if (state.mining.active || state.expedition.active) {
    // 主控作业不影响 AI 副船；无冲突，不拦截
  }
  return { ok: true }
}

/** 玩家指令：指派 AI 采矿任务（自动循环，产出卸入物品仓库） */
export function assignAiMining(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  beltId: string,
  ctx: SimContext,
): CommandResult {
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const belt = ctx.belts.get(beltId)
  if (!belt) return { ok: false, error: `未知采集点：${beltId}。` }
  const ore = ctx.items.get(belt.oreId)
  if (!isMineableItem(ore)) return { ok: false, error: `采集点「${belt.name}」没有对应的可采集资源数据。` }
  const needStanding = belt.standingReq ?? 0
  if (needStanding > 0) {
    const have = standingOf(state, DSI_FACTION_ID)
    if (have < needStanding) {
      return { ok: false, error: `采集点「${belt.name}」需要「深空工业协会」声望 ${needStanding}（当前 ${have}）。` }
    }
  }
  // V13 探索封锁：所在星系未点亮 → 拒绝派发（母港与已点亮星系不受限）
  const block = actionBlockReason(state, belt.galaxyId)
  if (block) return { ok: false, error: block }
  if (!getMiningParams(state, ctx, { shipId, beltId })) {
    return { ok: false, error: '舰队里找不到该舰船，无法执行采矿任务。', errorId: 'core.state.006' }
  }

  spendAiCore(state, coreType)
  bumpFirst(state, 'aiAssigns') // 第一次任务/链：指派次数
  state.aiAssignments[shipId] = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: { kind: 'mining', beltId, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, rvLeft: 0 },
  }
  const shipName = shipDisplayName(state, ctx, shipId)
  const eff = aiEfficiency(state, ctx, coreType)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 开始自动采集 ${belt.name}（${aiCoreName(coreType)}，效率 ${Math.round(eff * 100)}%，满舱自动回港卸货）。`,
    'core.ai.011',
    { p1: shipName, p2: belt.name, p3: aiCoreName(coreType), p4: Math.round(eff * 100) },
  )
  return { ok: true }
}

/**
 * 玩家指令：指派 AI 远征任务（原语义：只接预估胜率 ≥80% 且耐久 ≥50% 的目标；奖励全额）。
 * ⚠️ 软下线（2026-09-05 船长定，不移除）：悬赏收益实测单线 10~150M/h（顶配连刷），
 * AI 多线无人值守 = 印钞放大器 → 本入口一律拒绝，AI 只保留采矿/打捞/掩护巡逻；
 * 如需恢复：删掉本前置返回即可（后续门槛/冷却代码原样保留）。
 */
export function assignAiExpedition(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  anomalyId: string,
  ctx: SimContext,
): CommandResult {
  // AI 远征软下线开关（2026-09-05 船长定，不移除）：true=一律拒绝；改 false 即恢复
  const aiExpeditionOffline: boolean = true
  if (aiExpeditionOffline) {
    return {
      ok: false,
      error:
        '自动远征暂停受理：悬赏请主控亲自出击——AI 采矿/打捞/掩护巡逻不受影响。',
    }
  }
  // ↓↓↓ 软下线前的完整指派逻辑（门槛/冷却/行程，保留待恢复）↓↓↓
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。` }
  // 手动首胜解锁：AI 只代劳玩家亲手清剿过的悬赏（completedBounties = 主控首胜记录）
  if (!state.completedBounties.includes(anomalyId)) {
    return { ok: false, error: `AI 暂不能接单：「${anomaly.name}」需要你先亲手完成一次（首胜后解锁自动远征）。` }
  }
  // AI 门槛 = "最终成功率"口径（favor 修正 + logit 扩散，与 AI 指挥中心展示/结算 favor 同源）：
  // 已过门槛的目标在 favor 下接近必胜（简单局必成，杜绝"必胜还翻车"）
  const chance = aiWinPreview(state, ctx, anomaly, shipId)
  if (chance < 0.8) {
    return { ok: false, error: `AI 只接高胜率任务：该目标最终成功率 ${Math.round(chance * 100)}%（需 ≥80%）。` }
  }
  if (durabilityOf(state, shipId) < 0.5) {
    return { ok: false, error: '该船耐久低于 50%，先维修再出任务。', errorId: 'core.ai.007' }
  }
  // V13 探索封锁：目标星系未点亮 → 拒绝派发
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, error: block }
  const power = calcPower(state, ctx, shipId)
  const eff = aiEfficiency(state, ctx, coreType)
  // 两阶段：去程（finishAt = 到达时刻），交火由战斗引擎实时推进（同样按效率拉长）
  const outMinutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.state.007' }
  // V12.1：单程按副船自身跃迁/航行技能换算（出发锁定），再按 AI 效率拉长
  const rawOutMs = travelLegMs(state, ctx, outMinutes, shipId)
  const outMs = Math.max(1, Math.round(rawOutMs / eff))

  spendAiCore(state, coreType)
  const assignment: AiAssignment = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: {
      kind: 'expedition',
      anomalyId,
      finishAtGameMs: state.gameMs + outMs,
      outMs,
      power,
      phase: 'out',
      battle: null,
    },
  }
  bumpFirst(state, 'aiAssigns') // 第一次任务/链：指派次数
  state.aiAssignments[shipId] = assignment
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 出发远征 ${anomaly.name}（${aiCoreName(coreType)} 效率 ${Math.round(eff * 100)}%，胜率 ${Math.round(chance * 100)}%）。`,
    'core.ai.012',
    {
      p1: shipName,
      p2: anomaly.name,
      p3: aiCoreName(coreType),
      p4: Math.round(eff * 100),
      p5: Math.round(chance * 100),
    },
  )
  return { ok: true }
}

/** 玩家指令：指派 AI 打捞任务（自动循环，2026-09-09 船长定：与 AI 采矿同构——出航 → 打捞 →
 * 满仓自动返港卸货 → 同星系自动再出航，**直到取消**才任务结束、核心归还）。
 * 要求：副船高槽装有打捞器；目标星系已探索且有敌群型号池；效率只拉长行程/周期，不减产。 */
export function assignAiSalvage(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  galaxyId: string,
  ctx: SimContext,
): CommandResult {
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。` }
  if (!state.exploredGalaxies.includes(galaxyId)) {
    return { ok: false, error: `「${galaxy.name}」尚未探明——先对其执行扫描探索。` }
  }
  const block = actionBlockReason(state, galaxyId)
  if (block) return { ok: false, error: block }
  if (salvagerCyclesOf(state, ctx, shipId).length === 0) {
    return {
      ok: false,
      error: '该副船没有打捞器：先到「装配」页给它装一台（MK1/2/3）再派打捞任务。',
      errorId: 'core.ai.008',
    }
  }
  let hasPool = false
  for (const a of ctx.anomalies.values()) {
    if (a.hidden) continue // B1 遭遇模板不入打捞池（与主控抽池同口径，2026-09-09）
    if (a.galaxyId === galaxyId) {
      hasPool = true
      break
    }
  }
  if (!hasPool) {
    return { ok: false, error: `「${galaxy.name}」没有可打捞的敌群残骸（该星系无悬赏目标）。` }
  }
  const eff = aiEfficiency(state, ctx, coreType)
  spendAiCore(state, coreType)
  bumpFirst(state, 'aiAssigns') // 第一次任务/链：指派次数
  state.aiAssignments[shipId] = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: {
      kind: 'salvage',
      galaxyId,
      phase: 'outbound',
      phaseAccMs: 0,
      cycleAccMs: 0,
      deviceAccMs: {},
      tripM3: 0,
    },
  }
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 出发打捞：${galaxy.name}（${aiCoreName(coreType)} 效率 ${Math.round(eff * 100)}%；自动循环：满仓返港卸货后自动再出航，取消任务才结束）。`,
    'core.ai.013',
    { p1: shipName, p2: galaxy.name, p3: aiCoreName(coreType), p4: Math.round(eff * 100) },
  )
  return { ok: true }
}

/** 玩家指令：指派 AI 副船前往指定星系掩护巡逻（占名额，可取消召回；低安星系进入遭遇暴露） */
export function assignAiStandby(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  galaxyId: string,
  ctx: SimContext,
): CommandResult {
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。` }
  if (!state.exploredGalaxies.includes(galaxyId)) {
    return { ok: false, error: `「${galaxy.name}」尚未探明——先对其执行扫描探索。` }
  }
  const eff = aiEfficiency(state, ctx, coreType)
  const outMinutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.state.007' }
  // 单程按副船自身跃迁/技能换算（出发锁定），再按 AI 效率拉长（与远征任务同口径）
  const rawOutMs = travelLegMs(state, ctx, outMinutes, shipId)
  const outMs = Math.max(1, Math.round(rawOutMs / eff))
  spendAiCore(state, coreType)
  const assignment: AiAssignment = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: {
      kind: 'standby',
      galaxyId,
      finishAtGameMs: state.gameMs + outMs,
      outMs,
      phase: 'out',
    },
  }
  bumpFirst(state, 'aiAssigns') // 第一次任务/链：指派次数
  state.aiAssignments[shipId] = assignment
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 出发前往「${galaxy.name}」掩护巡逻（${aiCoreName(coreType)} 效率 ${Math.round(eff * 100)}%）——到达后留守该星系，可随时取消召回。`,
    'core.ai.014',
    { p1: shipName, p2: galaxy.name, p3: aiCoreName(coreType), p4: Math.round(eff * 100) },
  )
  return { ok: true }
}

/** 玩家指令：取消 AI 任务（核心归还）；掩护巡逻/远征/采矿通用 */
export function cancelAiTask(state: GameState, shipId: string, ctx: SimContext): boolean {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return false
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(state, 'info', `[AI] 已召回 ${shipName}（${aiCoreName(assignment.coreType)} 归还核心库）。`, 'core.ai.015', {
    p1: shipName,
    p2: aiCoreName(assignment.coreType),
  })
  return true
}

/* ───────── 引擎推进 ───────── */

/** AI 任务进度视图（2026-09-08 船长：AI 展示与主控同款——阶段 + 进度 + 剩余；顶部活动栏维持小图标）。
 * 与 advanceAiMining/Salvage/Standby 同一套公式（同源不漂移）。percent=null 表示无进度概念（驻留等）。 */
export interface AiTaskView {
  kind: 'mining' | 'salvage' | 'standby' | string
  phase: string
  /** 阶段文案（与主控行同款：返航卸货/出航/采掘中/打捞中/前往 X 掩护巡逻/驻留中…） */
  label: string
  percent: number | null
  remainingMs: number | null
}

/** 单个 AI 任务的进度视图（主控同款口径；无任务/未知 kind 返回 null） */
export function aiTaskView(state: GameState, ctx: SimContext, shipId: string): AiTaskView | null {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return null
  const task = assignment.task
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const accMs = (): number => (task as { phaseAccMs?: number }).phaseAccMs ?? 0
  // 腿长口径（卷B2⑥ 与主控一致）：出航腿按效率拉长；返航腿只按货仓占比缩放、不 ÷效率
  const leg = (base: number, effScaled: boolean): { real: number; remain: number; percent: number } => {
    const real = Math.max(1, Math.round(effScaled ? base / eff : base))
    const remain = Math.max(0, real - accMs())
    return { real, remain, percent: Math.min(100, Math.max(0, Math.round((accMs() / real) * 100))) }
  }
  if (task.kind === 'mining') {
    const beltDef = ctx.belts.get(task.beltId)
    const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
    if (task.phase === 'returning' || task.phase === 'outbound') {
      const base =
        task.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, task.beltId, shipId, stGal)
          : scaledReturnMs(oneLegMs(state, ctx, task.beltId, shipId, stGal), state, ctx, shipId)
      const v = leg(base, task.phase === 'outbound')
      return { kind: 'mining', phase: task.phase, label: task.phase === 'returning' ? '返航卸货中' : '出航中', percent: v.percent, remainingMs: v.remain }
    }
    const params = getMiningParams(state, ctx, { shipId, beltId: task.beltId })
    if (!params) return { kind: 'mining', phase: task.phase, label: '采掘中', percent: null, remainingMs: null }
    const servLv = Math.min(5, state.skills.trained['ai-servicing'] ?? 0)
    const cycleReal = Math.max(1, Math.ceil((params.cycleMs * (1 - 0.03 * servLv)) / eff))
    const acc = task.cycleAccMs ?? 0
    return {
      kind: 'mining',
      phase: task.phase,
      label: '采掘中',
      percent: Math.min(100, Math.max(0, Math.round((acc / cycleReal) * 100))),
      remainingMs: Math.max(0, cycleReal - acc),
    }
  }
  if (task.kind === 'salvage') {
    const legBase = (): number => {
      if (state.debugQuick) return 1000
      const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, task.galaxyId)
      return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, Number.isFinite(mins) ? mins : 0, shipId))
    }
    if (task.phase === 'outbound' || task.phase === 'returning') {
      const base = task.phase === 'outbound' ? Math.round(legBase() / 2) : scaledReturnMs(legBase(), state, ctx, shipId)
      const v = leg(base, task.phase === 'outbound')
      return { kind: 'salvage', phase: task.phase, label: task.phase === 'returning' ? '返航卸货' : '出航', percent: v.percent, remainingMs: v.remain }
    }
    const reals = salvagerCyclesOf(state, ctx, shipId).map((c) => Math.max(1, Math.ceil(c / eff)))
    const stepMs = reals.length > 0 ? Math.min(...reals) : 1
    const acc = task.cycleAccMs ?? 0
    return {
      kind: 'salvage',
      phase: task.phase,
      label: '打捞中',
      percent: Math.min(100, Math.max(0, Math.round((acc / stepMs) * 100))),
      remainingMs: Math.max(0, stepMs - acc),
    }
  }
  if (task.kind === 'standby') {
    if (task.phase === 'out') {
      const remain = Math.max(0, task.finishAtGameMs - state.gameMs)
      const outMs = Math.max(1, task.outMs)
      return { kind: 'standby', phase: task.phase, label: '前往掩护巡逻中', percent: Math.min(100, Math.max(0, Math.round(((outMs - remain) / outMs) * 100))), remainingMs: remain }
    }
    return { kind: 'standby', phase: task.phase, label: '驻留中', percent: null, remainingMs: null }
  }
  return null
}

/** 引擎内部：推进所有 AI 副船任务（stats = 离线结算统计器，可选；见 settleStats.ts） */
export function advanceAi(state: GameState, deltaMs: number, ctx: SimContext, stats?: SettleStats): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.aiAssignments)) {
    const assignment = state.aiAssignments[shipId]
    if (!assignment) continue
    // 船没了（弃船等）→ 清理任务并归还核心
    if (!state.fleet[shipId]) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI] ${shipId} 已不在舰队中，任务中断（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.016', {
        p1: shipId,
        p2: aiCoreName(assignment.coreType),
      })
      continue
    }
    // 2026-09-09（修复自愈）：作业船已被切换为驾驶船（换船入口漏召回的历史坏态/竞态残留）——
    // AI 面板只列副船、该任务不可见也无法取消，核心会被永久占用（玩家反馈"伽玛核心不见了"）。
    // 引擎每拍检测并召回：任务终止、核心归还核心库（与"船没了/矿带缺失"同级清理）。
    if (shipId === state.shipId) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(
        state,
        'warn',
        `[AI] ${shipDisplayName(state, ctx, shipId)} 已是驾驶船——原 AI 任务自动召回（${aiCoreName(assignment.coreType)} 已归还核心库）。`,
        'core.ai.017',
        { p1: shipDisplayName(state, ctx, shipId), p2: aiCoreName(assignment.coreType) },
      )
      continue
    }
    if (assignment.task.kind === 'mining') {
      advanceAiMining(state, shipId, assignment, deltaMs, ctx, stats)
    } else if (assignment.task.kind === 'salvage') {
      advanceAiSalvage(state, shipId, assignment, deltaMs, ctx, stats)
    } else if (assignment.task.kind === 'expedition') {
      advanceAiExpedition(state, shipId, assignment, ctx)
    } else {
      advanceAiStandby(state, shipId, assignment, ctx)
    }
  }
}

/** AI 掩护巡逻任务推进：去程计时到点 → 驻留（stand；驻留期间无事可做，占名额守在该星系） */
function advanceAiStandby(state: GameState, shipId: string, assignment: AiAssignment, ctx: SimContext): void {
  const task = assignment.task as AiStandbyTaskState
  if (task.phase !== 'out') return // 驻留中：等待取消/后续指令
  if (state.gameMs < task.finishAtGameMs) return
  task.phase = 'stand'
  const galaxy = ctx.galaxies.get(task.galaxyId)
  markExplored(state, task.galaxyId) // 副船实际抵达 → 点亮（同 AI 采矿到达语义）
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(
    state,
    'info',
    `[AI·${shipName}] 已抵达「${galaxy?.name ?? task.galaxyId}」掩护巡逻——取消任务可召回；低安星系留意巡逻与伏击。`,
    'core.ai.018',
    { p1: shipName, p2: galaxy?.name ?? task.galaxyId },
  )
}

/** AI 采矿任务推进（真实毫秒口径；循环/周转周期按效率拉长） */
function advanceAiMining(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  deltaMs: number,
  ctx: SimContext,
  stats?: SettleStats,
): void {
  const task = assignment.task as AiMiningTaskState
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const realCycleDiv = eff // 玩家周期 cycleMs ÷ eff = 副船真实周期
  const shipName = shipDisplayName(state, ctx, shipId)

  let remaining = deltaMs
  while (remaining > 0) {
    // 返航 / 出航（T4：腿分方向——出航空船腿减半（跃迁×2），返航满载用正常腿；
    // 效率只拉长出航腿与循环周期，返航腿与主控一致不再 ÷eff（卷B2⑥））
    if (task.phase === 'returning' || task.phase === 'outbound') {
      // T9：AI 采矿往返以"离矿带最近空间站"为基准（未建副站时 = 母港）
      const beltDef = ctx.belts.get(task.beltId)
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      // 返航腿与主控同口径（2026-09-08 卷B2⑥ 船长定稿）：满仓基准时长先按货仓占比缩放，不再 ÷核心效率
      const legBase =
        task.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, task.beltId, shipId, stGal)
          : scaledReturnMs(oneLegMs(state, ctx, task.beltId, shipId, stGal), state, ctx, shipId)
      const legMsReal = task.phase === 'outbound' ? Math.max(1, Math.round(legBase / eff)) : Math.max(1, Math.round(legBase))
      const need = legMsReal - task.phaseAccMs
      if (remaining < need) {
        task.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      task.phaseAccMs = 0
      if (task.phase === 'returning') {
        // 到港：把船上货仓全部卸入物品仓库（2026-09-08：离线结算按趟统计 + 卸货按站内收价估收入）
        const cargo = state.fleet[shipId]?.cargo
        let moved = 0
        let gain = 0
        if (cargo) {
          for (const [itemId, units] of Object.entries(cargo)) {
            if (units > 0) {
              state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + units
              moved += units
              gain += units * (ctx.items.get(itemId)?.baseSellPriceIsk ?? 0)
            }
          }
          for (const itemId of Object.keys(cargo)) delete cargo[itemId]
        }
        const belt = ctx.belts.get(task.beltId)
        const oreName = belt ? ctx.items.get(belt.oreId)?.name ?? '' : ''
        addLog(
          state,
          'trade',
          `[AI·${shipName}] 自动返港：把 ${moved.toLocaleString('zh-CN')} 单位${oreName}卸入物品仓库（本趟采得 ${task.tripUnits} 单位）。`,
          'core.ai.019',
          { p1: shipName, p2: moved.toLocaleString('zh-CN'), p3: oreName, p4: task.tripUnits },
        )
        if (stats) {
          addAiMiningTrip(stats, assignment.coreType)
          if (gain > 0) addAiIncome(stats, assignment.coreType, gain)
        }
        task.phase = 'outbound'
        task.tripUnits = 0
      } else {
        // 到达矿带：恢复采掘（V13：AI 船实际抵达 → 点亮该星系）
        const belt = ctx.belts.get(task.beltId)
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        task.phase = 'mining'
        task.cycleAccMs = 0
      }
      continue
    }

    // 采掘：逐循环结算（周期 = 玩家 cycleMs ÷ eff；副船整备学再 −3%/级）
    const params = getMiningParams(state, ctx, { shipId, beltId: task.beltId })
    if (!params) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI·${shipName}] 矿带已不存在，任务终止（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.020', {
        p1: shipName,
        p2: aiCoreName(assignment.coreType),
      })
      return
    }
    const servLv = Math.min(5, state.skills.trained['ai-servicing'] ?? 0)
    const servFactor = 1 - 0.03 * servLv
    const cycleReal = Math.max(1, Math.ceil((params.cycleMs * servFactor) / realCycleDiv))
    if (task.cycleAccMs < cycleReal) {
      const need = cycleReal - task.cycleAccMs
      const take = Math.min(remaining, need)
      task.cycleAccMs += take
      remaining -= take
      if (task.cycleAccMs < cycleReal) break
    }
    task.cycleAccMs = 0

    // V16 复合带：本循环先掷产物（决定单位体积与入舱品种；与主控同一随机源）
    const beltDef = ctx.belts.get(task.beltId)
    const oreNow = rollBeltOutput(state, ctx, beltDef)

    // 满舱检查（货仓放不下整个循环 → 自动返航）：剩余空间走 inventory.freeCargoM3Of 单点
    // （2026-09-12 P0：此处原为手写副本 freeCargoFor，漏算货舱类技能 ⇒ AI 船未满即返航）
    const oreM3PerCycle = params.unitsPerCycle * cargoUnitM3(state, oreNow ?? params.ore)
    const freeM3 = freeCargoM3Of(state, ctx, shipId)
    if (oreM3PerCycle > freeM3) {
      task.phase = 'returning'
      task.phaseAccMs = 0
      addLog(
        state,
        'info',
        `[AI·${shipName}] 货仓装不下下一循环（余 ${Math.round(freeM3)} m³ ／ 每循环 ${Math.round(oreM3PerCycle)} m³）：自动返航卸货（本趟 ${task.tripUnits} 单位${oreNow?.name ?? params.ore.name}）。`,
        'core.ai.021',
        {
          p1: shipName,
          p2: Math.round(freeM3),
          p3: Math.round(oreM3PerCycle),
          p4: task.tripUnits,
          p5: oreNow?.name ?? params.ore.name,
        },
      )
      continue
    }
    // 富矿脉判定与主控一致（卷B2⑥ 红利窗口：触发当轮 ×3 并开 1 个红利循环；窗口内不掷点不写日志；
    // 判定恒消耗一次随机数保 rng 时序；窗口与矿带绑定，自动循环返航卸货回原带保留）
    let units = params.unitsPerCycle
    const rvLeft = task.rvLeft ?? 0
    if (rvLeft > 0) {
      units *= 3
      task.rvLeft = rvLeft - 1
    } else if (nextRandom(state.rng) < richVeinP(cycleReal, state, ctx)) {
      units *= 3
      task.rvLeft = 1
      addLog(state, 'info', `[AI·${shipName}] 富矿脉！连续 2 个循环产量 ×3。`, 'core.ai.022', { p1: shipName })
    }
    if (!oreNow) {
      // 记录缺失：按主产物入舱兜底（正常情况下 roll 不会返回 null）
      const cargoFallback = state.fleet[shipId]!.cargo
      cargoFallback[params.ore.id] = (cargoFallback[params.ore.id] ?? 0) + units
      task.tripUnits += units
      /**
       * **AI 副船的产量计入终身计数**（船长 2026-09-20：「**成就系统和重要任务的累计，
       * 也计入AI副船的产量**」）。
       *
       * 为什么补在这里：`mineUnits` 原先只在**主控采掘循环**（`mining.ts`）里记，
       * AI 侧只累计了本趟的 `task.tripUnits`（纯日志用）⇒ **同样一单位原矿，玩家亲自采算、
       * 派 AI 采不算**。而精炼/制造/造船/维修那几项**早就含 AI**（`industry.ts` /
       * `manufacturing.ts` / `shipyard.ts` 的结算函数主控与 AI 共用）⇒ 补齐后口径统一。
       *
       * ⚠ 两处入账点（正常 / 兜底）都要记，否则"矿脉记录缺失"那条支路会静默漏账。
       * 计数口径与主控一致 = **入舱的实际单位数**（含富矿脉 ×3 之后的数）。
       */
bumpFirst(state, 'mineUnits', units)
      continue
    }
    const cargo = state.fleet[shipId]!.cargo
    cargo[oreNow.id] = (cargo[oreNow.id] ?? 0) + units
    task.tripUnits += units
    // 同上：AI 副船采掘计入终身计数（与主控同口径）
bumpFirst(state, 'mineUnits', units)
  }
}

type AiMiningTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'mining' }>
type AiSalvageTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'salvage' }>

/** AI 打捞任务推进（自动循环，2026-09-09 船长定：与 AI 采矿同构——出航 → 打捞 → 满仓返航 →
 * 到港卸货 → 同星系自动再出航，直到取消；行程/周期按核心效率拉长，满仓返港后不结束） */
function advanceAiSalvage(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  deltaMs: number,
  ctx: SimContext,
  stats?: SettleStats,
): void {
  const task = assignment.task as AiSalvageTaskState
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  const abort = (why: string): void => {
    delete state.aiAssignments[shipId]
    gainAiCore(state, assignment.coreType)
    addLog(state, 'warn', `[AI·${shipName}] ${why}（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.023', {
      p1: shipName,
      p2: why,
      p3: aiCoreName(assignment.coreType),
    })
  }
  const legBaseOf = (): number => {
    if (state.debugQuick) return 1000
    const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, task.galaxyId)
    const travel = Number.isFinite(mins) ? mins : 0
    return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, travel, shipId))
  }
  let remaining = deltaMs
  let guard = 0
  while (remaining > 0) {
    if (++guard > 100_000) break
    // ── 出航 / 返航（效率只拉长出航腿；返航腿与主控同口径——2026-09-08 卷B2⑥ 船长定稿：
    //    满仓基准先按货仓占比缩放，不再 ÷核心效率） ──
    if (task.phase === 'outbound' || task.phase === 'returning') {
      const legBase =
        task.phase === 'outbound'
          ? Math.round(legBaseOf() / 2)
          : scaledReturnMs(legBaseOf(), state, ctx, shipId)
      const legReal = task.phase === 'outbound' ? Math.max(1, Math.round(legBase / eff)) : Math.max(1, Math.round(legBase))
      const need = legReal - task.phaseAccMs
      if (remaining < need) {
        task.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      task.phaseAccMs = 0
      if (task.phase === 'returning') {
        // 到港：整仓卸入物品仓库 → 自动循环（同星系再出航）；取消任务才归还核心
        const cargo = state.fleet[shipId]?.cargo
        let moved = 0
        if (cargo) {
          for (const [itemId, units] of Object.entries(cargo)) {
            if (units > 0) {
              state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + units
              moved += units
            }
          }
          for (const itemId of Object.keys(cargo)) delete cargo[itemId]
        }
        const galaxyName = ctx.galaxies.get(task.galaxyId)?.name ?? task.galaxyId
        addLog(
          state,
          'trade',
          `[AI·${shipName}] 打捞自动返港：${galaxyName} 残骸已卸入物品仓库（本趟约 ${Math.round(task.tripM3 * 100) / 100} m³ 当量）。自动循环：继续出航打捞（取消任务即归还${aiCoreName(assignment.coreType)}）。`,
          'core.ai.024',
          {
            p1: shipName,
            p2: galaxyName,
            p3: Math.round(task.tripM3 * 100) / 100,
            p4: aiCoreName(assignment.coreType),
          },
        )
        if (stats) addAiSalvageDone(stats, assignment.coreType) // 2026-09-08：离线结算按次统计（残骸卖出/拆解变现不计入粗估）
        task.phase = 'outbound'
        task.phaseAccMs = 0
        task.tripM3 = 0
        task.deviceAccMs = {}
        continue
      }
      // 抵达目标星系
      markExplored(state, task.galaxyId)
      task.phase = 'salvaging'
      task.cycleAccMs = 0
      continue
    }
    // ── 打捞：逐台打捞器按各自真实周期结算（周期 = 基础周期 ÷ 效率） ──
    const rawCycles = salvagerCyclesOf(state, ctx, shipId)
    if (rawCycles.length === 0) {
      abort('打捞器记录缺失，打捞任务终止')
      return
    }
    const reals = rawCycles.map((c) => Math.max(1, Math.ceil(c / eff)))
    const stepMs = Math.min(...reals)
    if (task.cycleAccMs < stepMs) {
      const need = stepMs - task.cycleAccMs
      const take = Math.min(remaining, need)
      task.cycleAccMs += take
      remaining -= take
      if (task.cycleAccMs < stepMs) break
    }
    task.cycleAccMs = 0
    for (const real of reals) {
      const key = String(real)
      task.deviceAccMs[key] = (task.deviceAccMs[key] ?? 0) + stepMs
      while ((task.deviceAccMs[key] ?? 0) >= real) {
        task.deviceAccMs[key] = (task.deviceAccMs[key] ?? 0) - real
        const pulled = pullOneWreck(state, ctx, task.galaxyId, real)
        if (!pulled) {
          abort('该星系敌群记录缺失，打捞任务终止')
          return
        }
        /**
         * **AI 副船的打捞计入终身计数**（船长 2026-09-20：「成就系统和重要任务的累计，
         * 也计入AI副船的产量」）。
         *
         * 与主控**同口径同位置**：主控那侧写在 `pullOneWreck` 成功之后（`salvaging.ts`），
         * 这里也放在"确实捞上来一批"之后 ⇒ **成功才算一次**，下面的"货仓装不下"是
         * 捞上来了但没装下，也照记（与主控的口径一致：捞取动作发生了）。
         */
bumpFirst(state, 'salvageRuns')
        const freeM3 = freeCargoM3Of(state, ctx, shipId)
        if (pulled.volumeM3 > freeM3) {
          task.phase = 'returning'
          task.phaseAccMs = 0
          addLog(
            state,
            'info',
            `[AI·${shipName}] 货仓装不下下一轮打捞（余 ${Math.round(freeM3)} m³ ／ 每轮 ${Math.round(pulled.volumeM3)} m³）：自动返航卸货（本趟约 ${Math.round(task.tripM3 * 100) / 100} m³ 当量）。`,
            'core.ai.025',
            {
              p1: shipName,
              p2: Math.round(freeM3),
              p3: Math.round(pulled.volumeM3),
              p4: Math.round(task.tripM3 * 100) / 100,
            },
          )
          break
        }
        const cargo = state.fleet[shipId]!.cargo
        cargo[pulled.itemId] = (cargo[pulled.itemId] ?? 0) + pulled.volumeM3 // 计数 = 体积（m³）
        task.tripM3 += pulled.volumeM3
      }
      if (task.phase === 'returning') break
    }
  }
}

/**
 * AI 远征推进（V12 两阶段：out → battle；战斗由实时引擎推进，结束即结算归还核心）。
 * ⚠️ 软下线（2026-09-05 船长定，不移除）：本函数不再推进新战斗——
 * 对历史遗留任务做一次安全善后（取消 + 归还核心 + 日志）；下方两阶段逻辑保留待恢复。
 */
export function advanceAiExpedition(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  ctx: SimContext,
): void {
  const shipName = shipDisplayName(state, ctx, shipId)
  if (state.aiAssignments[shipId]?.task?.kind === 'expedition') {
    delete state.aiAssignments[shipId]
    gainAiCore(state, assignment.coreType)
    addLog(
      state,
      'warn',
      `[AI·${shipName}] 自动远征暂停受理：历史远征任务已取消，${aiCoreName(assignment.coreType)} 已归还核心库。`,
      'core.ai.026',
      { p1: shipName, p2: aiCoreName(assignment.coreType) },
    )
    return
  }
  // ↓↓↓ 软下线前的完整推进逻辑（out → battle → 结算，保留待恢复）↓↓↓
  for (let guard = 0; guard < 5; guard++) {
    const current = state.aiAssignments[shipId]
    if (!current) return
    const task = current.task as AiExpeditionTaskState
    if (task.phase === 'out') {
      if (state.gameMs < task.finishAtGameMs) return
      // 到港开战（开战时刻 = 到达时刻，离线大推进同帧打完）。
      // 目标距离（2026-09-11 船长「只有主控吃」）：**AI 副船不吃**玩家按星系设的目标距离，
      // 一律走射程中段（传 null；仅主控远征/遭遇与胜率预估读该星系的设定）
      const battle = startBattleFor(state, ctx, shipId, task.anomalyId, task.finishAtGameMs, null)
      if (!battle) {
        delete state.aiAssignments[shipId]
        gainAiCore(state, current.coreType)
        addLog(state, 'warn', `[AI·${shipName}] 远征目标已不存在，任务取消（${aiCoreName(current.coreType)} 已归还）。`, 'core.ai.027', {
          p1: shipName,
          p2: aiCoreName(current.coreType),
        })
        return
      }
      task.battle = battle
      task.phase = 'battle'
      // V13 探索：AI 船实际到港开战 → 点亮目标星系
      const anomalyDef = ctx.anomalies.get(task.anomalyId)
      if (anomalyDef?.galaxyId) markExplored(state, anomalyDef.galaxyId)
      addLog(state, 'info', `[AI·${shipName}] 抵达目标，进入交火。`, 'core.ai.028', { p1: shipName })
      continue
    }
    if (task.phase === 'battle') {
      if (!task.battle) {
        delete state.aiAssignments[shipId]
        gainAiCore(state, current.coreType)
        addLog(state, 'warn', `[AI·${shipName}] 战斗记录缺失，任务取消（${aiCoreName(current.coreType)} 已归还）。`, 'core.ai.029', {
          p1: shipName,
          p2: aiCoreName(current.coreType),
        })
        return
      }
      const anom = ctx.anomalies.get(task.anomalyId)
      advanceBattleFor(state, ctx, task.battle, shipId, task.anomalyId, anom ? aiFavorAdv(state, ctx, anom, shipId) : null)
      if (task.battle.ended) {
        resolveAiBattleOutcome(state, shipId, current, ctx)
      }
      return
    }
    return
  }
}

/** AI 交火结算：奖励全额 / 失利惩罚（与旧版语义一致，胜负来自实时战斗） */
function resolveAiBattleOutcome(state: GameState, shipId: string, assignment: AiAssignment, ctx: SimContext): void {
  const task = assignment.task as AiExpeditionTaskState
  const battle = task.battle!
  const shipName = shipDisplayName(state, ctx, shipId)
  // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）：AI 副船同样照扣（口径一致）
  settleDroneLosses(state, ctx, shipId, battle)
  // 弹药剩余退回物品仓库（弹药 MK2：按实装弹 id 退回）
  refundAmmo(state, battle.ammo, battle.ammoIds)
  refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
  const anomaly = ctx.anomalies.get(task.anomalyId)
  if (!anomaly) {
    delete state.aiAssignments[shipId]
    gainAiCore(state, assignment.coreType)
    addLog(state, 'warn', `[AI·${shipName}] 远征目标已不存在，任务取消。`, 'core.ai.030', { p1: shipName })
    return
  }
  const galaxy = ctx.galaxies.get(anomaly.galaxyId)
  const won = battle.ended === 'me'
  const durTxt = formatBattleDur(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    // ── 胜利：奖励全额（**无浮动**，与主控同口径：2026-09-10 船长取消奖金浮动），战利品直接入物品仓库 ──
    const jitter = ctx.balance.rewardJitter
    const reward = Math.max(
      0,
      Math.round(anomaly.rewardIsk * (1 - jitter + 2 * jitter * nextRandom(state.rng)) * bountyRewardFactor(state)),
    )
    state.wallet.isk += reward
    // B3 击杀注入（2026-09-10 船长定）：AI 远征胜利与主控同源——威胁 ×0.4 × (1 + 0.2×敌人数)
    injectWreckDensity(state, ctx, anomaly.galaxyId, bountyWreckInjection(anomaly.threat, bountyEnemyCount(anomaly)))
    const wreckNow = wreckDensityOf(state, anomaly.galaxyId, ctx)
    // AI 结算不发放声望、不写入首胜清单：协会声望只属于"亲手完成"（悬赏卡与指派解锁均以主控首胜为准）
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, Math.round(row.units * lootMul))
      addWare(state, row.itemId, units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${units}`)
    }
    const dropText = rollAiCoreDrop(state, anomaly.threat, ctx)
    // 船体维修装置消耗数（2026-09-11 船长：不单独显示日志，只进战报）
    const repairUse = repairUsageText(battle, ctx)
    const aiWinText =
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 大捷（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）！` +
      `${repairUse.length > 0 ? `船体维修装置${repairUse}。` : ''}` +
      `奖金 ${reward.toLocaleString('zh-CN')} 信用点${lootText.length > 0 ? `，战利品 ${lootText.join('、')}` : ''}已入仓库` +
      `${dropText ? `，${dropText}` : ''}。残骸密度 ${wreckNow.toFixed(1)}（本场 +${(anomaly.threat * 0.4).toFixed(1)}）`
    /**
     * **多段文案收口（甲案 · 2026-09-20）**：这条战报由 4 段拼成 ⇒ 用**链式 id** 交给日志：
     * `core.ai.034`（首句）→ `p1Id` 接 `core.ai.035`（修复装置）→ `p2Id` 接 `core.ai.036`（奖金）
     * → `p3Id` 接 `core.ai.037`（战利品）→ `p4Id` 接 `core.ai.038`（彩头）→ `p5Id` 接 `core.ai.039`（残骸密度）。
     * 渲染层 `logText` 会把整条链走完 ⇒ **每一段都按当前语言出**，中文侧逐字不变。
     */
    addLog(state, 'trade', aiWinText, 'core.ai.034', {
      p1: shipName,
      p2: galaxy?.name ?? '',
      p3: anomaly.name,
      p4: durTxt,
      p5: battle.stats.meShots,
      p6: battle.stats.meHits,
      p1Id: 'core.ai.035',
      p1p1: repairUse,
      p2Id: 'core.ai.036',
      p2p1: reward.toLocaleString('zh-CN'),
      p2p2: lootText.length > 0 ? lootText.join('、') : '',
      p2p2Id: 'core.ai.037',
      p3Id: 'core.ai.038',
      p3p1: dropText ?? '',
      p4Id: 'core.ai.039',
      p4p1: wreckNow.toFixed(1),
      p4p2: (anomaly.threat * 0.4).toFixed(1),
    })
    /**
     * **结构化战报**（2026-09-14 船长定：四类战斗统一填写）。
     * ⚠ AI 副船的战斗**不弹战报弹层**（只有主控那场弹）⇒ 这份记录只是"四类同源"的完整性，
     * 不会被读到；`source: 'ai'` 也让将来若要弹它时无需再补口径。**并行不串场**靠起手时刻配对：
     * 若它晚于主控那场写、弹层配对不上 ⇒ 回落兜底句（与既有 `droneLossReport` 同一套保护）。
     */
    captureBattleReport(state, battle, { source: 'ai', outcome: 'win', summary: aiWinText })
  } else {
    // ── 失利：扣耐久 → 弃船骰 → 维修费（公式与主控一致，火力按本船指数） ──
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 0
    if (fleetShip) fleetShip.durability = Math.max(0, durabilityAfter)

    if (!fleetShip || durabilityAfter <= 0 || nextRandom(state.rng) < aiAbandonChance(state, ctx, shipId, anomaly.threat, Math.max(0, durabilityAfter))) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      loseShip(state, shipId, ctx, `[AI·${shipName}] 远征失利（${galaxy?.name ?? ''}·${anomaly.name}）后遭追击`)
      addLog(state, 'warn', `[AI·${shipName}] 舰船损毁，AI 任务结束（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.031', {
        p1: shipName,
        p2: aiCoreName(assignment.coreType),
      })
      return
    }
    const repair = Math.min(state.wallet.isk, Math.floor(anomaly.rewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const dur = Math.round((state.fleet[shipId]?.durability ?? 0) * 100)
    const aiRepairUse = repairUsageText(battle, ctx)
    const aiLoseText =
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 失利（交火 ${durTxt}），维修花去 ${repair.toLocaleString('zh-CN')} 信用点（耐久 ${dur}%）。` +
      `${aiRepairUse.length > 0 ? `船体维修装置${aiRepairUse}。` : ''}`
    addLog(state, 'warn', aiLoseText, 'core.ai.040', {
      p1: shipName,
      p2: galaxy?.name ?? '',
      p3: anomaly.name,
      p4: durTxt,
      p5: repair.toLocaleString('zh-CN'),
      p6: dur,
      p1Id: 'core.ai.035',
      p1p1: aiRepairUse,
    })
    // 战报（2026-09-14）：AI 副船这一支是"打输、船没沉"（沉船那一支上面 return 了）⇒ `lose`
    captureBattleReport(state, battle, { source: 'ai', outcome: 'lose', summary: aiLoseText })
  }
  // 任务结束：核心归还核心库
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  if ((state.fleet[shipId]?.durability ?? 1) <= 0.3 && won === false) {
    const r = repairShip(state, shipId, ctx)
    if (r.ok) {
      addLog(state, 'trade', `[AI·${shipName}] 耐久过低，已自动回港维修至 100%。`, 'core.ai.032', { p1: shipName })
    } else {
      addLog(state, 'warn', `[AI·${shipName}] 耐久过低但维修费不足，请尽快手动维修。`, 'core.ai.033', { p1: shipName })
    }
  }
}

function formatBattleDur(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`
}

/** AI 船弃船率（与主控公式一致；火力按本船火力指数，避免引用主控远征状态） */
function aiAbandonChance(state: GameState, ctx: SimContext, shipId: string, threat: number, durability: number): number {
  const bal = ctx.balance.combat
  const power = calcPower(state, ctx, shipId)
  const base = threat > 0 ? threat / (threat + 2 * power) : 0
  const clamped = Math.min(bal.maxAbandonChance, Math.max(bal.minAbandonChance, base))
  const shipDef = fleetDefOf(state, ctx, shipId)
  const agility = shipDef?.agility ?? 0.4
  const durabilityPenalty = bal.durabilityFactor + (1 - bal.durabilityFactor) * Math.max(0, Math.min(1, durability))
  const agilityEscape = 1 - bal.agilityEscapeFactor * agility
  return clamped * durabilityPenalty * agilityEscape
}

type AiExpeditionTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'expedition' }>
type AiStandbyTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'standby' }>

/** 远征胜利后的 AI 核心掉落（按威胁取最高档，逐条掷骰），返回掉落文本（可为空串） */
function rollAiCoreDrop(state: GameState, threat: number, ctx: SimContext): string {
  const drops = ctx.balance.aiCore.drops
  let matched: (typeof drops)[number] | null = null
  for (const entry of drops) {
    if (threat >= entry.minThreat) matched = entry
  }
  if (!matched) return ''
  const gained: AiCoreType[] = []
  for (const reward of matched.rewards) {
    if (nextRandom(state.rng) < reward.chance) {
      gainAiCore(state, reward.type)
      gained.push(reward.type)
    }
  }
  if (gained.length === 0) return ''
  return `缴获 ${gained.map((t) => `${aiCoreName(t)}×1`).join('、')}`
}
