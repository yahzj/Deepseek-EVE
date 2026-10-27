/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog, type AiAssignment } from '../state'
import type { AiCoreType, SimContext } from '../types'
import type { CommandResult } from '../engine'
import { checkAssignable, aiEfficiency } from './cores'
import { isMineableItem } from '../labels'
import { standingOf, DSI_FACTION_ID, calcPower, shortestTravelMinutes, HOME_GALAXY_ID } from '../expedition'
import { actionBlockReason } from '../explore'
import { getMiningParams } from '../mining'
import { spendAiCore, aiCoreName } from '../aiCores'
import { bumpFirst } from '../firstTasks'
import { shipDisplayName } from '../instances'
import { aiWinPreview } from '../combat'
import { durabilityOf } from '../shipyard'
import { travelLegMs } from '../travel'
import { salvagerCyclesOf } from '../salvaging'

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
  if (!belt) return { ok: false, error: `未知采集点：${beltId}。`, errorId: 'core.ai.047', errorParams: { p1: beltId } }
  const ore = ctx.items.get(belt.oreId)
  if (!isMineableItem(ore))
      return {
        ok: false,
        error: `采集点「${belt.name}」没有对应的可采集资源数据。`,
        errorId: 'core.ai.048',
        errorParams: { p1: belt.name },
      }
  const needStanding = belt.standingReq ?? 0
  if (needStanding > 0) {
    const have = standingOf(state, DSI_FACTION_ID)
    if (have < needStanding) {
      return {
        ok: false,
        error: `采集点「${belt.name}」需要「深空工业协会」声望 ${needStanding}（累计 ${have}）。`,
        errorId: 'core.ai.049',
        errorParams: { p1: belt.name, p2: needStanding, p3: have },
      }
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
    'fleet',
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
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。`, errorId: 'core.ai.050', errorParams: { p1: anomalyId } }
  // 手动首胜解锁：AI 只代劳玩家亲手清剿过的悬赏（completedBounties = 主控首胜记录）
  if (!state.completedBounties.includes(anomalyId)) {
    return {
        ok: false,
        error: `AI 暂不能接单：「${anomaly.name}」需要你先亲手完成一次（首胜后解锁自动远征）。`,
        errorId: 'core.ai.051',
        errorParams: { p1: anomaly.name },
      }
  }
  // AI 门槛 = "最终成功率"口径（favor 修正 + logit 扩散，与 AI 指挥中心展示/结算 favor 同源）：
  // 已过门槛的目标在 favor 下接近必胜（简单局必成，杜绝"必胜还翻车"）
  const chance = aiWinPreview(state, ctx, anomaly, shipId)
  if (chance < 0.8) {
    return {
        ok: false,
        error: `AI 只接高胜率任务：该目标最终成功率 ${Math.round(chance * 100)}%（需 ≥80%）。`,
        errorId: 'core.ai.052',
        errorParams: { p1: Math.round(chance * 100) },
      }
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
    'fleet',
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
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.ai.053', errorParams: { p1: galaxyId } }
  if (!state.exploredGalaxies.includes(galaxyId)) {
    return {
        ok: false,
        error: `「${galaxy.name}」尚未探明——先对其执行扫描探索。`,
        errorId: 'core.ai.054',
        errorParams: { p1: galaxy.name },
      }
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
    return {
        ok: false,
        error: `「${galaxy.name}」没有可打捞的敌群残骸（该星系无悬赏目标）。`,
        errorId: 'core.ai.055',
        errorParams: { p1: galaxy.name },
      }
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
    'fleet',
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
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.ai.053', errorParams: { p1: galaxyId } }
  if (!state.exploredGalaxies.includes(galaxyId)) {
    return {
        ok: false,
        error: `「${galaxy.name}」尚未探明——先对其执行扫描探索。`,
        errorId: 'core.ai.054',
        errorParams: { p1: galaxy.name },
      }
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
    'fleet',
    `[AI] ${shipName} 出发前往「${galaxy.name}」掩护巡逻（${aiCoreName(coreType)} 效率 ${Math.round(eff * 100)}%）——到达后留守该星系，可随时取消召回。`,
    'core.ai.014',
    { p1: shipName, p2: galaxy.name, p3: aiCoreName(coreType), p4: Math.round(eff * 100) },
  )
  return { ok: true }
}
