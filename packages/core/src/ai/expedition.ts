import { type GameState, type AiAssignment, addLog } from '../state'
import type { SimContext, AiCoreType } from '../types'
import { shipDisplayName, fleetDefOf } from '../instances'
import { gainAiCore, aiCoreName } from '../aiCores'
import { startBattleFor, advanceBattleFor, aiFavorAdv, settleDroneLosses, refundAmmo, refundRepairKitsAll, repairUsageText, captureBattleReport } from '../combat'
import { markExplored } from '../explore'
import { ceilFinalQuantity } from '../quantity'
import { nextRandom } from '../rng'
import { bountyRewardFactor, lootFactor, calcPower } from '../expedition'
import { injectWreckDensity, bountyWreckInjection, wreckInjectThreatOf, bountyEnemyCount, wreckDensityOf } from '../salvage'
import { addWare } from '../inventory'
import { loseShip, repairShip } from '../shipyard'

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
  for (let guard = 0; guard < 5; guard++) {
    const current = state.aiAssignments[shipId]
    if (!current) return
    const task = current.task as AiExpeditionTaskState
    if (task.phase === 'out') {
      if (state.gameMs < task.finishAtGameMs) return
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
      const anomalyDef = ctx.anomalies.get(task.anomalyId)
      if (anomalyDef?.galaxyId) markExplored(state, anomalyDef.galaxyId)
      addLog(state, 'fleet', `[AI·${shipName}] 抵达目标，进入交火。`, 'core.ai.028', { p1: shipName })
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

export function resolveAiBattleOutcome(state: GameState, shipId: string, assignment: AiAssignment, ctx: SimContext): void {
  const task = assignment.task as AiExpeditionTaskState
  const battle = task.battle!
  const shipName = shipDisplayName(state, ctx, shipId)
  settleDroneLosses(state, ctx, shipId, battle)
  refundAmmo(state, battle.ammo, battle.ammoIds)
  refundRepairKitsAll(state, battle)
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
    const jitter = ctx.balance.rewardJitter
    const reward = Math.max(
      0,
      ceilFinalQuantity(anomaly.rewardIsk * (1 - jitter + 2 * jitter * nextRandom(state.rng)) * bountyRewardFactor(state)),
    )
    state.wallet.isk += reward
    injectWreckDensity(state, ctx, anomaly.galaxyId, bountyWreckInjection(wreckInjectThreatOf(anomaly), bountyEnemyCount(anomaly)))
    const wreckNow = wreckDensityOf(state, anomaly.galaxyId, ctx)
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, ceilFinalQuantity(row.units * lootMul))
      addWare(state, row.itemId, units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${units}`)
    }
    const dropText = rollAiCoreDrop(state, anomaly.threat, ctx)
    const repairUse = repairUsageText(battle, ctx)
    const aiWinText =
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 大捷（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）！` +
      `${repairUse.length > 0 ? `船体维修装置${repairUse}。` : ''}` +
      `奖金 ${reward.toLocaleString('zh-CN')} 信用点${lootText.length > 0 ? `，战利品 ${lootText.join('、')}` : ''}已入仓库` +
      `${dropText ? `，${dropText}` : ''}。残骸密度 ${wreckNow.toFixed(1)}（本场 +${(anomaly.threat * 0.4).toFixed(1)}）`
    addLog(state, 'fleet', aiWinText, 'core.ai.034', {
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
    captureBattleReport(state, battle, { source: 'ai', outcome: 'win', summary: aiWinText })
  } else {
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 0
    if (fleetShip) fleetShip.durability = Math.max(0, durabilityAfter)

    if (!fleetShip || durabilityAfter <= 0 || nextRandom(state.rng) < aiAbandonChance(state, ctx, shipId, anomaly.threat, Math.max(0, durabilityAfter))) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      loseShip(state, shipId, ctx, `[AI·${shipName}] 远征失利（${galaxy?.name ?? ''}·${anomaly.name}）后遭追击`, anomaly.galaxyId, {
        cause: 'ai-lost',
      })
      addLog(state, 'fleet', `[AI·${shipName}] 舰船损毁，AI 任务结束（${aiCoreName(assignment.coreType)} 已归还）。`, 'core.ai.031', {
        p1: shipName,
        p2: aiCoreName(assignment.coreType),
      })
      return
    }
    const repair = Math.min(state.wallet.isk, ceilFinalQuantity(anomaly.rewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const dur = Math.round((state.fleet[shipId]?.durability ?? 0) * 100)
    const aiRepairUse = repairUsageText(battle, ctx)
    const aiLoseText =
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 失利（交火 ${durTxt}），维修花去 ${repair.toLocaleString('zh-CN')} 信用点（耐久 ${dur}%）。` +
      `${aiRepairUse.length > 0 ? `船体维修装置${aiRepairUse}。` : ''}`
    addLog(state, 'fleet', aiLoseText, 'core.ai.040', {
      p1: shipName,
      p2: galaxy?.name ?? '',
      p3: anomaly.name,
      p4: durTxt,
      p5: repair.toLocaleString('zh-CN'),
      p6: dur,
      p1Id: 'core.ai.035',
      p1p1: aiRepairUse,
    })
    captureBattleReport(state, battle, { source: 'ai', outcome: 'lose', summary: aiLoseText })
  }
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  if ((state.fleet[shipId]?.durability ?? 1) <= 0.3 && won === false) {
    const r = repairShip(state, shipId, ctx)
    if (r.ok) {
      addLog(state, 'fleet', `[AI·${shipName}] 耐久过低，已自动回港维修至 100%。`, 'core.ai.032', { p1: shipName })
    } else {
      addLog(state, 'warn', `[AI·${shipName}] 耐久过低但维修费不足，请尽快手动维修。`, 'core.ai.033', { p1: shipName })
    }
  }
}

export function formatBattleDur(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`
}

export function aiAbandonChance(state: GameState, ctx: SimContext, shipId: string, threat: number, durability: number): number {
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

export type AiExpeditionTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'expedition' }>

export function rollAiCoreDrop(state: GameState, threat: number, ctx: SimContext): string {
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
