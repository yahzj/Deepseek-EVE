/** 功能域职责拆分，保持原计算与顺序。 */
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

/** AI 交火结算：奖励全额 / 失利惩罚（与旧版语义一致，胜负来自实时战斗） */
export function resolveAiBattleOutcome(state: GameState, shipId: string, assignment: AiAssignment, ctx: SimContext): void {
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
      ceilFinalQuantity(anomaly.rewardIsk * (1 - jitter + 2 * jitter * nextRandom(state.rng)) * bountyRewardFactor(state)),
    )
    state.wallet.isk += reward
    // B3 击杀注入（2026-09-10 船长定）：AI 远征胜利与主控同源——体量（`wreckThreat` ?? 威胁）
    //   ×0.4 × (1 + 0.2×敌人数)；2026-09-25「冻结残骸经济」后与 `threat` 解耦
    injectWreckDensity(state, ctx, anomaly.galaxyId, bountyWreckInjection(wreckInjectThreatOf(anomaly), bountyEnemyCount(anomaly)))
    const wreckNow = wreckDensityOf(state, anomaly.galaxyId, ctx)
    // AI 结算不发放声望、不写入首胜清单：协会声望只属于"亲手完成"（悬赏卡与指派解锁均以主控首胜为准）
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, ceilFinalQuantity(row.units * lootMul))
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
      /**
       * ⚠ **合并解冲突（2026-09-26，两边各改一行 ⇒ 都保留）**：
       * ① 我方：`loseShip` 末参传 `anomaly.galaxyId`（这艘船的残骸留在哪个星系，船长令）；
       * ② main 侧（一号「事件日志重新分类」）：本条档位由 `warn` 改 `fleet`（舰队类）。
       */
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
    // 战报（2026-09-14）：AI 副船这一支是"打输、船没沉"（沉船那一支上面 return 了）⇒ `lose`
    captureBattleReport(state, battle, { source: 'ai', outcome: 'lose', summary: aiLoseText })
  }
  // 任务结束：核心归还核心库
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

/** AI 船弃船率（与主控公式一致；火力按本船火力指数，避免引用主控远征状态） */
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

/** 远征胜利后的 AI 核心掉落（按威胁取最高档，逐条掷骰），返回掉落文本（可为空串） */
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
