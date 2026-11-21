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
  const block = actionBlockReason(state, belt.galaxyId)
  if (block) return { ok: false, error: block }
  if (!getMiningParams(state, ctx, { shipId, beltId })) {
    return { ok: false, error: '舰队里找不到该舰船，无法执行采矿任务。', errorId: 'core.state.006' }
  }

  spendAiCore(state, coreType)
  bumpFirst(state, 'aiAssigns')
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

export function assignAiExpedition(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  anomalyId: string,
  ctx: SimContext,
): CommandResult {
  const aiExpeditionOffline: boolean = true
  if (aiExpeditionOffline) {
    return {
      ok: false,
      error:
        '自动远征暂停受理：悬赏请主控亲自出击——AI 采矿/打捞/掩护巡逻不受影响。',
    }
  }
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。`, errorId: 'core.ai.050', errorParams: { p1: anomalyId } }
  if (!state.completedBounties.includes(anomalyId)) {
    return {
        ok: false,
        error: `AI 暂不能接单：「${anomaly.name}」需要你先亲手完成一次（首胜后解锁自动远征）。`,
        errorId: 'core.ai.051',
        errorParams: { p1: anomaly.name },
      }
  }
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
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, error: block }
  const power = calcPower(state, ctx, shipId)
  const eff = aiEfficiency(state, ctx, coreType)
  const outMinutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.state.007' }
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
  bumpFirst(state, 'aiAssigns')
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
    if (a.hidden) continue
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
  bumpFirst(state, 'aiAssigns')
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
  bumpFirst(state, 'aiAssigns')
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
