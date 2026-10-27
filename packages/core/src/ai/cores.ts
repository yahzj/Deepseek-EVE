/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext, AiCoreType } from '../types'
import { AI_CORE_ORDER, countAiCore, spendAiCore, gainAiCore, aiCoreName } from '../aiCores'
import { matterTechSum } from '../matterTech'
import type { CoreBlockReason, CommandResult } from '../engine'
import { shipInReturn } from '../mining'

/** 效率（速度系数：1 = 玩家手操速度；只影响速度不影响奖励）。
 *  卷B3⑩（2026-09-08 船长定）：「AI 核心调度学」在核心档位之上每级 +2 个百分点累加
 *  （如基础核心 40% → 满级 50%；伽马 60% / 贝塔 70% / 阿尔法 85%，封顶 100%），
 *  覆盖全部核心驱动作业（副船任务与站内炉/线共源）；返航腿不 ÷eff（卷B2⑥ 口径）故天然不受影响。 */
export function aiEfficiency(state: GameState, ctx: SimContext, type: AiCoreType): number {
  const base = ctx.balance.aiCore.efficiency[type] ?? 1
  const dLv = Math.min(5, state.skills.trained[ctx.balance.aiCore.dispatchSkillId] ?? 0)
  return Math.min(1, base + ctx.balance.aiCore.dispatchPerLevel * dLv)
}

/**
 * **当前持有 ≥1 枚的核心档位**，按 `AI_CORE_ORDER` 序（basic → gamma → beta → alpha）——
 * 界面"可用核心下拉"的**单一来源**（**2026-10-02 代码审查**：渲染层原先把这行 filter 抄了 8 处、
 * 顺序字面量另抄了 3 份 ⇒ 收成单点；顺序一旦两处漂移，"默认选最高级"（`bestAiCoreOf`）就会和下拉对不上）。
 */
export function usableAiCoresOf(state: GameState): AiCoreType[] {
  return AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
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

/**
 * **副船统合整备学**（2026-09-27 船长令 · R4/R5 上位技能批）：副船采矿循环乘数，每级 −1%
 * （父技能「副船整备学」每级 −3% ⇒ 上位取三分之一）。任务读数口与推进口**共用本函数**。
 */
export function aiServicingUpgradeMult(state: GameState): number {
  return 1 - 0.01 * Math.min(5, state.skills.trained['ai-servicing-integration'] ?? 0)
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

/** AI副船每任务占一枚；信号空间自动队不占名额，实验/未知规则自动队保留每趟一枚。
 * 直接读state，不反向import自动探索模块，以免形成运行期环。 */
export function aiCoreShipUsed(state: GameState): number {
  // 信号空间已改为科技解锁；只保留实验及未知规则任务的原AI占用。
  const autoRuns = (state.wormholeAuto ?? []).filter(run => run.expeditionRules !== undefined).length
  return Object.keys(state.aiAssignments).length + autoRuns
}

/** 站内工业 AI 工位占用数（AI 精炼/回收炉 + AI 制造线 + AI 实验室线；
 * 旧作业豁免的制造线 worker=undefined 未占核心 → 不计入）。2026-09-09 玩家反馈修复口径：
 * 站内工业占用先抵「工业自动化」扩容工位，只有超出扩容的部分才挤占共用名额（见 aiCoreCapBlock）
 *
 * ⚠ **2026-10-01 补实验室线**（船长令「**实验室和工业的其他页面没有本质区别，所以 AI 和活动栏图标
 * 都使用一样的机制**」）：AI 实验室线同样 `occupyAiCore` 占了核心，原先这张手抄表只扫
 * `refineRuns` / `manufacturingRuns` ⇒ ① 活动栏「副AI活动」徽标少算 ② `startLabRun` 调的
 * `aiCoreCapBlock(…, 'industry')` **守不住上限**（可以超出上限起线）。 */
export function aiCoreIndustryUsed(state: GameState): number {
  let used = 0
  for (const r of state.refineRuns) {
    if (r.worker !== 'pilot') used += 1
  }
  for (const m of state.manufacturingRuns) {
    if (m.worker !== undefined && m.worker !== 'pilot') used += 1
  }
  for (const l of state.labRuns ?? []) {
    if (l.active && l.worker !== 'pilot') used += 1
  }
  return used
}

/** 总启用数（AI 副船任务 + 站内 AI 精炼炉/回收炉/制造线/实验室线） */
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
 * scope = 'industry'：站内精炼炉/回收炉/制造线/实验室线，上限 = 共用上限 + 工业专用扩容（industryAiBonus）。
 * 船长 2026-09-08 定：存量超限（读档/技能变化）不中断运行，但同样计入各池占用——
 * 想再启用新的必须先把占用降到上限以内。 */
export function aiCoreCapBlock(state: GameState, ctx: SimContext, scope: 'ship' | 'industry' = 'ship'): CoreBlockReason | null {
  const cap = aiCoreCap(state, ctx)
  const bonus = industryAiBonus(state, ctx)
  const eff = cap + bonus
  if (eff <= 0 || (scope === 'ship' && cap <= 0)) {
    return {
      error:
        'AI 核心上限为 0：训练提升 AI 核心上限的技能（如「AI 核心操作学」）后才能启用 AI 核心（AI 副船任务与站内精炼炉/回收炉/制造线/实验室共用上限）。',
      errorId: 'core.ai.041',
    }
  }
  const shipUsed = aiCoreShipUsed(state)
  const indUsed = aiCoreIndustryUsed(state)
  if (scope === 'ship') {
    // 副船名额 = 共用上限 − 副船占用 −（工业占用超出工业扩容的部分）
    const indOnShared = Math.max(0, indUsed - bonus)
    const used = shipUsed + indOnShared
    if (used >= cap) {
      if (indOnShared > 0) {
        return {
          error: `AI 核心启用已满（${used}/${cap}：副船 ${shipUsed} 枚 + 站内工业超出「工业自动化」扩容 ${indOnShared} 枚）：先停用部分站内工业 AI 或 AI 副船任务再启用新的。`,
          errorId: 'core.ai.042',
          errorParams: { p1: used, p2: cap, p3: shipUsed, p4: indOnShared },
        }
      }
      return {
        error: `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线）再启用新的。`,
        errorId: 'core.ai.043',
        errorParams: { p1: used, p2: cap },
      }
    }
    return null
  }
  // scope = 'industry'：站内炉/线/实验室上限 = 共用 + 扩容，全量占用计入
  const used = shipUsed + indUsed
  if (used >= eff) {
    if (bonus > 0) {
      return {
        error: `AI 核心启用已满（${used}/${eff}：共用上限 ${cap} + 工业扩容 ${bonus}）：先停用其它 AI 核心（AI 副船任务或站内炉/线/实验室），或训练「工业自动化」再扩工业工位。`,
        errorId: 'core.ai.044',
        errorParams: { p1: used, p2: eff, p3: cap, p4: bonus },
      }
    }
    return {
      error: `AI 核心启用已满（${used}/${cap}）：先停用其它 AI 核心（AI 副船任务或站内精炼炉/回收炉/制造线/实验室）再启用新的。`,
      errorId: 'core.ai.045',
      errorParams: { p1: used, p2: cap },
    }
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
      id !== state.shipId && !inHole.includes(id) && !(id in state.aiAssignments) && !shipInReturn(state, id)
      && !(state.planetary?.deliveries ?? []).some(d => d.shipUid === id),
  )
}

/** 共同校验：船、名额、核心、空闲 */
export function checkAssignable(state: GameState, shipId: string, coreType: AiCoreType, ctx: SimContext): CommandResult {
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return { ok: false, error: '星球物资运输中', errorId: 'core.busy.031' }
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
  if (capBlock) return { ok: false, error: capBlock.error, errorId: capBlock.errorId, errorParams: capBlock.errorParams }
  if (countAiCore(state, coreType) <= 0) {
    return {
      ok: false,
      error: `${aiCoreName(coreType)} 库存不足（效率 ${Math.round(aiEfficiency(state, ctx, coreType) * 100)}%）。`,
      errorId: 'core.ai.046',
      errorParams: { p1: aiCoreName(coreType), p2: Math.round(aiEfficiency(state, ctx, coreType) * 100) },
    }
  }
  if (state.mining.active || state.expedition.active) {
    // 主控作业不影响 AI 副船；无冲突，不拦截
  }
  return { ok: true }
}
