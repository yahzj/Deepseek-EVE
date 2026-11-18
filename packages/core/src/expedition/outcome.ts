import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import { lairAnomalyOf, factionAnomalyOf, lairBaseRewardIsk, factionBaseRewardIsk, LAIR_RARE_WRECK_GAIN, factionRareDropChanceOf, FACTION_RARE_DROP_PITY_ROLLS, FACTION_RARE_DROP_COUNT } from '../lairs'
import { weekendBattleInvolvedOf } from '../weekendBattle'
import { ceilFinalQuantity } from '../quantity'
import { rewardMulOf } from '../tuning'
import { settleDroneLosses, refundBattleAmmo, refundRepairKitsAll, persistFleetHullDamage, repairUsageText, dcUsageText, captureBattleReport, sunkShipIdsOfBattle } from '../combat'
import { droneBattleOutcome, stopAutoLoopReason, autoLoopInvasionGalaxy, stopAutoLoopInvasion } from './loopState'
import { formatDurationMs } from '../time'
import { nextRandom, pickOne } from '../rng'
import { addItem } from '../inventory'
import { bumpFirst } from '../firstTasks'
import { weekendWreckInjectionOf, bountyWreckInjection, wreckInjectThreatOf, bountyEnemyCount, injectWeekendWreck, asFoeFamily, injectWreckDensity, weekendWreckDensityOf, wreckDensityOf, injectRareWreck } from '../salvage'
import { weekendWreckPenaltyFracOf } from '../weekendEvent'
import { noteStandingEarned, DSI_FACTION_ID } from '../standing'
import { bountyTaskStandingGain } from './bountyBoard'
import { settleBountyTaskVictory } from '../sideTasks'
import { setBountyCooldown } from './cooldown'
import { returnBackMs, LOCAL_RETURN_MS } from './travel'
import { RETURN_LEG_MUL } from '../balance'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from '../jumpFuel'
import { abandonChance } from './tactics'
import { loseShip } from '../shipyard'
import { shipDisplayName } from '../instances'
import { settleCommandFleet, loseCommandSunkShips, prepareCommandPilotAfterLoss } from '../combat/command/settlement'
import { combatRosterOf } from '../combat/command/roster'
import { finishDestroyedSortie } from '../combat/command/return'

export function lootFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  return 1 + 0.12 * lv
}

export function bountyRewardFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['bounty-hunting'] ?? 0)
  return 1 + 0.08 * lv
}

export function resolveBattleOutcome(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  const battle = exp.battle
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  if (!battle || !anomaly) {
    delete exp.sortie
    exp.active = false
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined
    return
  }
  const won = battle.ended === 'me'
  const galaxy = ctx.galaxies.get(exp.foeGalaxyId ?? anomaly.galaxyId)
  const lairTier = exp.lairTier
  const factionActive = exp.factionActive === true
  const entryCard = battle.rangeEwVersion === 1 ? anomaly : anomaly.rangeEwLegacyCard ?? anomaly
  const sourceCard = battle.enemyFormationVersion === 1 ? entryCard : entryCard.foeFormation?.baseline ?? entryCard
  const card0 = lairTier ? lairAnomalyOf(sourceCard, lairTier, ctx.balance.battle, battle.enemyFormationVersion ?? 0, ctx.foeShips) : sourceCard
  const battleCard = factionActive ? factionAnomalyOf(card0) : card0
  const displayName = battleCard.name
  const weekendInvolved = weekendBattleInvolvedOf(state, ctx, anomaly.id, state.wallMs ?? Date.now())
  const isInvasion = weekendInvolved !== undefined
  const baseRewardIskRaw = isInvasion
    ? 0
    : lairTier
      ? lairBaseRewardIsk(anomaly, lairTier)
      : factionActive
        ? factionBaseRewardIsk(anomaly)
        :
          (exp.rewardIskOverride ?? anomaly.rewardIsk)
  const baseRewardIsk = Math.max(0, ceilFinalQuantity(baseRewardIskRaw * rewardMulOf(state)))
  const multi = (battle.myFleet?.length ?? 0) > 1
  const droneLostText = multi ? settleCommandFleet(state, ctx, battle) : settleDroneLosses(state, ctx, state.shipId, battle)
  const {
    before: droneBefore,
    after: droneAfter,
    attrition: droneAttritionRaw,
  } = droneBattleOutcome(state, battle)
  const droneAttrition = droneAttritionRaw && state.autoLoopAnomalyId === exp.anomalyId
  if (droneAttrition) {
    const droneNow = combatRosterOf(state).reduce((sum, id) => sum + Object.values(state.fleet[id]?.droneLoad ?? {}).reduce((s, n) => s + n, 0), 0)
    stopAutoLoopReason(
      state,
      droneNow >= droneBefore
        ? `机群战损过半（${droneBefore} → ${droneAfter} 架）——机群已自动补充到 ${droneNow} 架，确认配装后可重新开启重复清剿。`
        : `机群战损过半（${droneBefore} → ${droneAfter} 架）——货仓与物品仓库存货不足以补满（现 ${droneNow} 架），补充无人机后可重新开启重复清剿。`,
      droneAfter,
    )
  }
  refundBattleAmmo(state, battle)
  refundRepairKitsAll(state, battle)
  if (!multi) persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    if (multi) prepareCommandPilotAfterLoss(state, ctx, sunkShipIdsOfBattle(battle, state.shipId), battle)
    const recNow = ((): number => {
      const u = battle.units['player']
      if (!u) return 0
      const cur = Math.max(0, u.hp.a) + Math.max(0, u.hp.h)
      const fullRef = u.hpMax ?? u.hp
      const full = Math.max(1, fullRef.a + fullRef.h)
      return Math.round(Math.min(1, Math.max(0, cur / full)) * 10_000) / 10_000
    })()
    const recPrev = state.winRecord?.[anomaly.id]
    if (battle.myDesireM > 0 && recNow > (recPrev?.remainPct ?? -1)) {
      state.winRecord = { ...(state.winRecord ?? {}), [anomaly.id]: { desireM: battle.myDesireM, remainPct: recNow } }
    }
    const jitter = ctx.balance.rewardJitter
    const roll = 1 - jitter + 2 * jitter * nextRandom(state.rng)
    let reward = Math.max(0, ceilFinalQuantity(baseRewardIsk * roll * bountyRewardFactor(state)))
    if (nextRandom(state.rng) < 0.15) {
      const texts = [
        { text: '舰队返航时打捞到一枚漂流信标，协会收购了上面的航路情报', id: 'core.expedition.048' },
        { text: '编队顺手清理了一块导航浮标，空间站维修部发来感谢金', id: 'core.expedition.049' },
        { text: '舰载传感器捕获一段加密信号，协会情报处兑换了报酬', id: 'core.expedition.050' },
      ] as const
      const picked = pickOne(state.rng, texts)!
      const text = picked.text
      const bonus = ceilFinalQuantity(reward * 0.1)
      reward += bonus
      addLog(state, 'trade', `◆ ${text}（+${bonus.toLocaleString('zh-CN')} 信用点）`, 'core.expedition.047', {
        p1: text,
        p1Id: picked.id,
        p2: bonus.toLocaleString('zh-CN'),
      })
    }
    const lootText: string[] = []
    const lootMul = lootFactor(state)
    for (const row of anomaly.loot) {
      const units = Math.max(1, ceilFinalQuantity(row.units * lootMul))
      addItem(state, row.itemId, units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${units}`)
    }
    state.wallet.isk += reward
    bumpFirst(state, 'bountyWins')
    const wreckGalaxyId = weekendInvolved?.galaxyId ?? anomaly.galaxyId
    const wreckInjected = isInvasion
      ?
        weekendWreckInjectionOf(
          battleCard,
          state.weekendEvent !== undefined
            ? weekendWreckPenaltyFracOf(state, state.weekendEvent, wreckGalaxyId, state.wallMs ?? Date.now())
            : 1,
        )
      : bountyWreckInjection(wreckInjectThreatOf(battleCard), bountyEnemyCount(battleCard))
    if (isInvasion) {
      injectWeekendWreck(
        state,
        wreckGalaxyId,
        wreckInjected,
        asFoeFamily(battleCard.foeFamily) ?? asFoeFamily(state.weekendEvent?.family),
      )
    }
    else injectWreckDensity(state, ctx, wreckGalaxyId, wreckInjected, battleCard.id)
    const wreckNow = isInvasion
      ? weekendWreckDensityOf(state, wreckGalaxyId)
      : wreckDensityOf(state, wreckGalaxyId, ctx)
    const firstBlood = !state.completedBounties.includes(anomaly.id)
    if (firstBlood) {
      noteStandingEarned(state, DSI_FACTION_ID, anomaly.standingGain)
      state.completedBounties.push(anomaly.id)
    }
    const stats = `交火 ${durTxt}（开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}，我方护盾余 ${Math.round(battle.units['player']?.hp.s ?? 0)}/甲 ${Math.round(battle.units['player']?.hp.a ?? 0)}/结构 ${Math.round(battle.units['player']?.hp.h ?? 0)}）`
    const lootPart = lootText.length > 0 ? `，缴获 ${lootText.join('、')}` : ''
    const dailyStanding = lairTier && state.sideTasks.bounty.some(t => t.anomalyId === anomaly.id && (t.lairTier ?? 1) === lairTier)
      ? bountyTaskStandingGain(lairTier) : 0
    const standPart = firstBlood || dailyStanding > 0
      ? `协会声望 +${(firstBlood ? anomaly.standingGain : 0) + dailyStanding}` : '该悬赏已首胜过：本次无额外声望'
    const dronePart = droneLostText ? `，机群战损 ${droneLostText}` : ''
    const repairPart = (() => {
      const t = repairUsageText(battle, ctx)
      return t.length > 0 ? `，船体维修装置${t}` : ''
    })()
    const dcPart = (() => {
      const t = dcUsageText(battle, ctx)
      return t.length > 0 ? `，${t}` : ''
    })()
    const winText = isInvasion
      ? `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！击退入侵舰队。${stats}${lootPart}${dronePart}${repairPart}${dcPart}，` +
        `本场无赏金：进度收入与夺回奖励在活动结束时统一发放。` +
        `入侵残骸沉积 ${wreckNow.toFixed(1)}（本场 +${wreckInjected.toFixed(1)}）`
      : `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：大捷！${stats}，奖金 ${reward.toLocaleString('zh-CN')} 信用点${lootPart}${dronePart}${repairPart}${dcPart}，${standPart}` +
        `。战场残骸密度 ${wreckNow.toFixed(1)}（本场 +${(battleCard.threat * 0.4).toFixed(1)}）`
    addLog(state, 'combat', winText)
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: winText })
    if (multi) loseCommandSunkShips(state, ctx, battle, exp.foeGalaxyId ?? anomaly.galaxyId)
    if (lairTier) {
      injectRareWreck(state, anomaly.galaxyId, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier])
      settleBountyTaskVictory(state, ctx, anomaly.id, LAIR_RARE_WRECK_GAIN[lairTier], lairTier)
    }
    if (factionActive) {
      const streak = Math.max(0, Math.floor(state.rareWreckDryStreak ?? 0)) + 1
      const hit = nextRandom(state.rng) < factionRareDropChanceOf(state)
      const pity = streak >= FACTION_RARE_DROP_PITY_ROLLS
      if (hit || pity) {
        injectRareWreck(state, anomaly.galaxyId, anomaly.id, FACTION_RARE_DROP_COUNT)
        const pityTail = pity && !hit ? `（连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出，本次保底）` : ''
        addLog(
          state,
          'trade',
          `✦ 敌对派系活跃战果：${displayName} 的残骸里翻出稀有残骸 ×${FACTION_RARE_DROP_COUNT}` +
            `${pity && !hit ? `（连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出，本次保底）` : ''}` +
            `——可前往「${galaxy?.name ?? ''}」打捞（回站用回收炉解体可得额外战利品）。`,
          'core.expedition.051',
          {
            p1: displayName,
            p2: FACTION_RARE_DROP_COUNT,
            p3: pityTail,
            ...(pityTail !== '' ? { p3Id: 'core.expedition.052', p3p1: FACTION_RARE_DROP_PITY_ROLLS } : {}),
            p4: galaxy?.name ?? '',
          },
        )
      } else {
        state.rareWreckDryStreak = streak
      }
    }
    setBountyCooldown(state, ctx, anomaly.id)
    if (multi && finishDestroyedSortie(state, battle)) return
    exp.battle = null
    exp.lairTier = undefined
    exp.factionActive = undefined
    exp.eventId = null
    exp.eventFired = false
    const targetGalaxy = exp.foeGalaxyId ?? anomaly.galaxyId
    const ret = returnBackMs(state, ctx, targetGalaxy)
    const rawBackMs = ret.ms > 0 ? ret.ms : exp.outMs * RETURN_LEG_MUL
    exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackMs)
    const backMs = jumpFuelLegMsOf(rawBackMs, exp.fuelMul)
    const baseName =
      ret.base === HOME_GALAXY_ID
        ? '母港'
        : ctx.galaxies.get(ret.base)?.name ?? ret.base
    exp.phase = 'back'
    exp.returnReason = 'victory'
    const endAt = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
    exp.returnAtGameMs = endAt
    exp.finishAtGameMs = endAt + backMs
    if ((ret.base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) && backMs !== LOCAL_RETURN_MS) {
      addLog(state, 'fleet', '舰队开始返航（去程时间并入返航）。', 'core.expedition.027')
    } else if (ret.base === targetGalaxy || targetGalaxy === HOME_GALAXY_ID) {
      addLog(
        state,
        'combat',
        '战果已入账：舰队返港中（本地悬赏返航段约 2 分钟，胜利返航不可召回）。',
        'core.expedition.026',
      )
    } else {
      addLog(
        state,
        'combat',
        `战果已入账：舰队自动返航「${baseName}」（去程并入返航 · 约 ${Math.max(1, Math.round(backMs / 60_000))} 分钟，胜利返航不可召回）——到站自动卸货入仓库，可维修或让重复清剿自动续打。`,
        'core.expedition.053',
        { p1: baseName, p2: Math.max(1, Math.round(backMs / 60_000)) },
      )
    }
    return
  } else {
    if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
      stopAutoLoopReason(state, '本次出击失利，舰队自动返航（可修整后再开）。')
    }
    if (autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined) {
      stopAutoLoopInvasion(state, '本次出击失利，舰队自动返航。', 'core.invasionLoop.004')
    }
    const bal = ctx.balance.combat
    const leaderAlive = !multi || (battle.units.player?.hp.h ?? 0) > 0
    const loss = leaderAlive ? bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng) : 0
    const fleetShip = state.fleet[state.shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 1
    let abandoned = false
    if (leaderAlive && durabilityAfter <= 0) {
      abandoned = true
    } else if (leaderAlive && nextRandom(state.rng) < abandonChance(state, battleCard.threat, ctx)) {
      abandoned = true
    }
    if (abandoned) {
      const abandonedId = state.shipId
      const abandonRepair = repairUsageText(battle, ctx)
      const abandonDc = dcUsageText(battle, ctx)
      const abandonText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：遭重创（交火 ${durTxt}${abandonRepair.length > 0 ? `，船体维修装置${abandonRepair}` : ''}${abandonDc.length > 0 ? `，${abandonDc}` : ''}）……`
      addLog(state, 'combat', abandonText)
      captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: abandonText,
        ...(multi ? { shipsLost: [...battle.myFleet!.filter(row => {
          const hp = battle.units[row.tag]?.hp
          return row.shipId === abandonedId || hp !== undefined && hp.s + hp.a + hp.h <= 0
        }).map(row => battle.units[row.tag]!.name)] } : {}),
      })
      if (multi) loseCommandSunkShips(state, ctx, battle, exp.foeGalaxyId ?? anomaly.galaxyId)
      if (multi) prepareCommandPilotAfterLoss(state, ctx, [abandonedId], battle)
      loseShip(
        state,
        abandonedId,
        ctx,
        `远征失利（${galaxy?.name ?? ''}·${displayName}）后遭追击`,
        exp.foeGalaxyId ?? anomaly.galaxyId,
        { cause: 'expedition-lost' },
      )
      if (multi && finishDestroyedSortie(state, battle)) return
      exp.active = multi
      if (!multi) delete exp.sortie
      exp.battle = null
      if (!multi) exp.anomalyId = null
      exp.lairTier = undefined
      exp.factionActive = undefined
      if (multi) {
        exp.phase = 'back'
        exp.returnReason = 'defeat'
        exp.finishAtGameMs = state.gameMs + returnBackMs(state, ctx, exp.foeGalaxyId ?? anomaly.galaxyId).ms
      }
      return
    }
    if (fleetShip && loss > 0) {
      fleetShip.durability = Math.max(0, Math.round((fleetShip.durability - loss) * 1000) / 1000)
    }
    const repair = Math.min(state.wallet.isk, ceilFinalQuantity(baseRewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const shipName = shipDisplayName(state, ctx, state.shipId)
    const dronePartLose = droneLostText ? ` 机群战损 ${droneLostText}（永久损失）。` : ''
    const loseRepair = repairUsageText(battle, ctx)
    const loseDc = dcUsageText(battle, ctx)
    const loseText = `⚔ 战报（${galaxy?.name ?? ''}·${displayName}）：失利（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）……${shipName} 耐久 -${Math.round(loss * 100)}%，维修花去 ${repair.toLocaleString('zh-CN')} 信用点。${loseRepair.length > 0 ? `船体维修装置${loseRepair}。` : ''}${loseDc.length > 0 ? `${loseDc}。` : ''}${dronePartLose}练练炮术学，记得给船做保养。`
    addLog(state, 'combat', loseText)
    captureBattleReport(state, battle, { source: 'expedition', outcome: 'lose', summary: loseText })
    if (multi) loseCommandSunkShips(state, ctx, battle, exp.foeGalaxyId ?? anomaly.galaxyId)
    if (multi && finishDestroyedSortie(state, battle)) return
  }
  exp.battle = null
  exp.lairTier = undefined
  exp.factionActive = undefined
  exp.phase = 'back'
  exp.returnReason = 'defeat'
  const endAtD = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtD
  const retD = returnBackMs(state, ctx, exp.foeGalaxyId ?? anomaly.galaxyId)
  const rawBackD = retD.ms > 0 ? retD.ms : exp.outMs * RETURN_LEG_MUL
  exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackD)
  exp.finishAtGameMs = endAtD + jumpFuelLegMsOf(rawBackD, exp.fuelMul)
  addLog(state, 'fleet', '舰队开始返航（去程时间并入返航）。', 'core.expedition.027')
}
