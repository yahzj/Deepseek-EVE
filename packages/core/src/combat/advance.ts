import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { matterTechBattleSpeedTiers } from '../matterTech'
import type { LairTier } from '../lairs'
import type { BattleSimulationOptions, UnitSpec } from './model'
import { battleClockNowMs, isAlive } from './combatMath'
import { resolvedBattleAnomaly } from './cards'
import { activeFoeSpecsOf, createFoeSpecs } from './foes/catalog'
import { battleOpenM, foeDesiredRange } from './foes/tactics'
import { seedUnit, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { foesWithSupport, resolveReinforcements, resolveFoeRevive, resolveFoeSummon, reinforceTriggered, resolveSupportBranch } from './foes/reinforcements'
import { applyFoeRangeDebuff, foeRangeEwSpecsOf } from './foeRange'
import { buildMyUnitSpecs } from './fleetSpecs'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { syncCoronaFleetFocus } from './coronaFocus'
import { BATTLE_MAX_STEPS, BATTLE_STEP_MS } from './constants'
import { restoreFoeWebSpecs } from './captureWebs'
import { BATTLE_ARRIVAL_STAGGER_MS, WORMHOLE_FOE_VOLLEY_STAGGER_MS } from './combatFx'
import { advanceFoeAbilityClocks } from './alienCombat'
import { resolveDroneRevive } from '../droneRevive'
import { REPAIR_PULSE_MS, repairLedgersOf, pulseRepairsFor, shieldChargeLedgersOf, shieldChargeStreamsOf, pulseShieldChargeFor, shieldFieldStreamsOf, pulseShieldFieldFor } from './combatRepair'
import { stepBattle } from './step'
import { equipmentCycleMsOf } from '../equipment'
import { pulseFoeRepair, pulseFoeMountRepair } from './repairFoes'
import { advanceFoeRebirthRepair } from './gravekeeperCombat'
import { pendingEnemyFormation } from './foes/capacity'
import { syncRangeEw } from './rangeEw'
import { observeOfflineBattle, noteOfflineEncounter } from '../offlineCombatStats'


export function resolveBattleSpeed(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  want: number,
): number {
  if (!battle.wormhole) return 1
  const tiers = matterTechBattleSpeedTiers(state, ctx)
  const pick = Math.floor(want)
  if (!Number.isFinite(pick) || pick <= 1) return 1
  let best = 1
  for (const t of tiers) if (t <= pick && t > best) best = t
  return best
}

export function advanceBattleFor(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  shipId: string,
  anomalyId: string | null,
  favorAdv: number | null = null,
  lairTier?: LairTier,
  factionActive?: boolean,
  opts?: { battleSpeedX?: number; simulation?: BattleSimulationOptions },
): void {
  if (!battle || battle.ended) return
  if (state.encounter.battle === battle) noteOfflineEncounter(state, battle)
  observeOfflineBattle(state, battle)
  const speedX = resolveBattleSpeed(state, ctx, battle, opts?.battleSpeedX ?? 1)
  if (battle.wormhole) battle.speedX = speedX
  const nowMs = (): number => battleClockNowMs(state, battle)
  const rebaseAxis = (): void => {
    observeOfflineBattle(state, battle)
    battle.speedAxis = { anchor: state.gameMs, clock: battle.lastTickGameMs }
  }
  const anomaly = resolvedBattleAnomaly(ctx, battle, anomalyId, lairTier, factionActive)
  if (!anomaly) return
  const bal = ctx.balance.battle
  const foesForDebuff = activeFoeSpecsOf(anomaly, bal, battle.waveIdx).filter(foe => battle.units[foe.tag] !== undefined)
  applyFoeRangeDebuff(state, ctx, battle, battle.myFleet?.map((e) => e.shipId) ?? [shipId])
  if (battle.rangeEwVersion === 1) syncRangeEw(state, ctx, battle, foesWithSupport(battle, activeFoeSpecsOf(anomaly, bal, battle.waveIdx)), shipId)
  let myUnits = buildMyUnitSpecs(state, ctx, battle, shipId, anomalyId, foesForDebuff)
  if (myUnits.length === 0) {
    battle.ended = 'foe'
    return
  }
  let me = myUnits[0]!
  let ewMyCut = battle.rangeEw?.meCut
  const foes = createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const lastIdx = waves ? waves.length - 1 : 0
  const specsOf = (wi: number): UnitSpec[] => activeFoeSpecsOf(anomaly, bal, wi)
  let waveIdx = Math.min(battle.waveIdx ?? 0, lastIdx)
  let curFoes = specsOf(waveIdx)
  const pendingFoes = (): boolean => pendingEnemyFormation(battle, curFoes) || curFoes.some(foe =>
    !battle.units[foe.tag] && foe.foeReinforceAt !== undefined && reinforceTriggered(foe.foeReinforceAt, battle, curFoes)
    && (foe.foeReinforceBranch === undefined || foe.foeReinforceBranch === resolveSupportBranch(battle, curFoes)))
  if (battle.pdCd === undefined && pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(battle.dronePools ?? {}).length > 0) {
    battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  let foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
  let desireCapM = battleOpenM(me, curFoes, bal)
  for (const f of curFoes) {
    if (f.foeReinforceAt) continue
    seedUnit(battle, f, { enterReload: true, arrivedAtMs: nowMs() })
  }
  initFoeDronePools(battle, curFoes)
  initFoeRepairPulses(battle, curFoes.filter(foe => battle.units[foe.tag] !== undefined))
  syncCoronaFleetFocus(battle, foesWithSupport(battle, curFoes))
  let guard = 0
  while (nowMs() > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    restoreFoeWebSpecs(curFoes)
    for (const foe of curFoes) {
      if (foe.foeReinforceAt || battle.units[foe.tag]) continue
      seedUnit(battle, foe, { enterReload: true, arrivedAtMs: battle.lastTickGameMs })
      if (battle.units[foe.tag]) {
        initFoeDronePools(battle, [foe])
        initFoeRepairPulses(battle, [foe])
      }
    }
    if (
      waves &&
      waveIdx < lastIdx &&
      !pendingFoes() &&
      !foesWithSupport(battle, curFoes).some((f) => isAlive(battle, f.tag))
    ) {
      const gapMs = Math.max(0, bal.waveEnterGapMs ?? 0) * speedX
      const pendingGap = battle.waveClearAt !== undefined
      if (gapMs > 0 && battle.waveClearAt === undefined) {
        battle.waveClearAt = battle.lastTickGameMs + gapMs
        const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
        addLog(
          state,
          'warn',
          `⚔ 第 ${waveIdx + 1}/${waves.length} 波已全灭（${waveName ? waveName + '·' : ''}${anomaly.name}），` +
            (bal.waveReopenEnabled === true ? '敌方增援正在从远处入场…' : '敌方增援正在入场…'),
        )
      }
      if (gapMs > 0 && battle.waveClearAt !== undefined && nowMs() < battle.waveClearAt) break
      const waitedGap = pendingGap
      battle.waveClearAt = undefined
      waveIdx += 1
      battle.waveIdx = waveIdx
      battle.foeWaveStartMs = nowMs()
      curFoes = specsOf(waveIdx)
      foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
      desireCapM = battleOpenM(me, curFoes, bal)
      if (waitedGap) {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            arrivedAtMs: nowMs() + i * BATTLE_ARRIVAL_STAGGER_MS * speedX,
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      } else {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      }
      if (battle.pdCd && battle.dronePools) {
        battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
      }
      initFoeDronePools(battle, curFoes);
      initFoeRepairPulses(battle, curFoes);
      const reopenOn = bal.waveReopenEnabled === true
      const reopen = reopenOn ? (bal.waveReopenFrac ?? 0) : 0
      if (reopen > 0 && Number.isFinite(openM)) {
        battle.distanceM = Math.round(openM * reopen + battle.distanceM * (1 - reopen))
      }
      const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
      addLog(
        state,
        'warn',
        `⚔ 第 ${waveIdx + 1}/${waves.length} 波来袭（${waveName ? waveName + '·' : ''}${anomaly.name}）：` +
          (reopenOn ? '敌方增援自远处入场，重新接近中。' : '敌方增援入场。'),
      )
      continue
    }
    resolveReinforcements(state, ctx, battle, anomaly, curFoes, bal, openM)
    const dt = Math.min(BATTLE_STEP_MS, nowMs() - battle.lastTickGameMs)
    advanceFoeAbilityClocks(battle, curFoes, dt)
    resolveFoeRevive(state, battle, curFoes, bal, nowMs())
    resolveFoeSummon(state, battle, curFoes, bal, battle.lastTickGameMs)
    resolveDroneRevive(state, ctx, battle, nowMs())
    const liveFoes = foesWithSupport(battle, curFoes)
    if (battle.rangeEwVersion === 1) {
      syncRangeEw(state, ctx, battle, liveFoes, shipId)
      if (ewMyCut !== battle.rangeEw!.meCut) {
        myUnits = buildMyUnitSpecs(state, ctx, battle, shipId, anomalyId, liveFoes)
        me = myUnits[0]!
        ewMyCut = battle.rangeEw!.meCut
      }
      foeDesire = foeDesiredRange(me, liveFoes, bal, battle.meFoeRangeDebuff ?? 0, battle)
      desireCapM = battleOpenM(me, foeRangeEwSpecsOf(battle, liveFoes), bal)
    }
    if (!battle.foeRepair && liveFoes.some(f => (f.repairPct ?? 0) > 0)) {
      battle.foeRepair = { nextPulseAtMs: battle.lastTickGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    }
    stepBattle(
      state,
      battle,
      myUnits,
      liveFoes,
      foeDesire,
      desireCapM,
      bal,
      dt,
      favor,
      (waves ? waveIdx < lastIdx : false) || pendingFoes(),
      anomaly.foeTargeting ?? 'random',
      anomaly.foeTargetingChance ?? 1,
      opts?.simulation,
    )
    battle.lastTickGameMs += dt
    if (battle.ended === 'me' && pendingFoes()) battle.ended = null
    if (!battle.autoEscaped && battle.hullEscapeFrac !== undefined) {
      const pl = battle.units['player']
      const fleetHullLow = battle.myFleet && battle.myFleet.length > 1 && battle.myFleet.some(entry => {
        const unit = battle.units[entry.tag]
        return unit && unit.hp.h < (unit.hpMax?.h ?? unit.hp.h) * battle.hullEscapeFrac!
      })
      if (fleetHullLow || pl && pl.hp.h < me.hp.h * battle.hullEscapeFrac) {
        battle.autoEscaped = true
        battle.escapeReason = 'hull'
        break
      }
    }
    if (!battle.ended && repairLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of repairLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const interval = equipmentCycleMsOf(state, ctx, owner, REPAIR_PULSE_MS)
        const hasPerUnit = ledger.units.some((u) => u.nextPulseAtMs !== undefined)
        if (!hasPerUnit) {
          const legacyAt = ledger.nextPulseAtMs
          if (legacyAt === undefined || legacyAt > battle.lastTickGameMs) continue
          for (const u of ledger.units) {
            if (u.stopped) continue
            u.nextPulseAtMs = legacyAt
            }
        }
        for (const unit of ledger.units) {
          if (battle.ended) break
          if (unit.stopped) continue
          if (unit.nextPulseAtMs === undefined || unit.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardR = 0
          while (
            !battle.ended &&
            unit.nextPulseAtMs !== undefined &&
            unit.nextPulseAtMs <= battle.lastTickGameMs &&
            guardR < BATTLE_MAX_STEPS
          ) {
            const alive = pulseRepairsFor(state, ctx, battle, spec, ledger, specByTag, unit)
            if (!alive) {
              for (const u2 of ledger.units) u2.nextPulseAtMs = undefined
              break
            }
            if (unit.stopped) {
              unit.nextPulseAtMs = undefined
              if (!ledger.units.some((u) => !u.stopped)) ledger.nextPulseAtMs = undefined
              break
            }
            unit.nextPulseAtMs = (unit.nextPulseAtMs ?? battle.lastTickGameMs) + interval
            guardR++
          }
        }
      }
    }
    if (!battle.ended && battle.foeRepair) {
      let guardF = 0
      while (
        !battle.ended &&
        battle.foeRepair.nextPulseAtMs !== undefined &&
        battle.foeRepair.nextPulseAtMs <= battle.lastTickGameMs &&
        guardF < BATTLE_MAX_STEPS
      ) {
        pulseFoeRepair(battle, liveFoes, battle.foeRepair)
        battle.foeRepair.nextPulseAtMs += REPAIR_PULSE_MS
        guardF++
      }
    }
    if (!battle.ended && battle.foeRepairPulses) {
      for (const f of liveFoes) {
        if (battle.ended) break
        if (f.foeRepairPulse === undefined) continue
        const ledger = battle.foeRepairPulses[f.tag]
        if (!ledger) continue
        let guardM = 0
        while (
          !battle.ended &&
          ledger.nextPulseAtMs !== undefined &&
          ledger.nextPulseAtMs <= battle.lastTickGameMs &&
          guardM < BATTLE_MAX_STEPS
        ) {
          pulseFoeMountRepair(battle, f, ledger)
          ledger.nextPulseAtMs += Math.max(1, Math.round(f.foeRepairPulse.everyMs))
          guardM++
        }
      }
    }
    if (!battle.ended && battle.foeRebirths) {
      for (const f of liveFoes) {
        if (battle.ended || f.foeRebirthProtocol === undefined) continue
        const record = battle.foeRebirths[f.tag]
        if (!record || record.startedAtMs === undefined) continue
        advanceFoeRebirthRepair(battle, f, battle.lastTickGameMs)
      }
    }
    if (!battle.ended && shieldChargeLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of shieldChargeLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldChargeStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          const current = currentStreams.find(s => s.modelId === stream.modelId)
          stream.pct = current?.pct ?? (stream.modelId === '' && currentStreams.length > 0
            ? currentStreams.reduce((sum, s) => sum + s.pct, 0) : stream.pct)
          stream.ms = current?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardS = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardS < BATTLE_MAX_STEPS
          ) {
            pulseShieldChargeFor(battle, spec, ledger, stream)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardS++
          }
        }
      }
    }
    if (!battle.ended && Object.keys(battle.shieldFieldBy ?? {}).length > 0) {
      const specByTagF = new Map(myUnits.map((u) => [u.tag, u]))
      for (const [tag, ledger] of Object.entries(battle.shieldFieldBy!)) {
        if (battle.ended) break
        if (!specByTagF.get(tag) || !isAlive(battle, tag)) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldFieldStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          const current = currentStreams.find(s => s.modelId === stream.modelId)
          stream.pct = current?.pct ?? (stream.modelId === '' && currentStreams.length > 0
            ? currentStreams.reduce((sum, s) => sum + s.pct, 0) : stream.pct)
          stream.ms = current?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardF = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardF < BATTLE_MAX_STEPS
          ) {
            pulseShieldFieldFor(battle, myUnits, stream, specByTagF.get(tag)!)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardF++
          }
        }
      }
    }
  }
  if (battle.rangeEwVersion === 1) syncRangeEw(state, ctx, battle, foesWithSupport(battle, curFoes), shipId)
  rebaseAxis()
}
