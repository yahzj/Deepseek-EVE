import type { GameState } from '../state'
import type { UnitSpec, BattleSimulationOptions } from './model'
import type { BattleBalance, FoeTargetingMode } from '../types'
import { syncPlayerCrisis, advancePlayerRebirth, playerGravekeeperSpecOf } from './gravekeeperGear'
import { syncFoeCapacitors, advanceFoeRebirthRepair } from './gravekeeperCombat'
import { syncCoronaFleetFocus } from './coronaFocus'
import { advanceFoeHatcheries, foeFleetSpeedMulOf } from './alienCombat'
import { expireFoeAcidLayers } from './alienEquipment'
import { BATTLE_VOLLEY_WINDOW_MS } from './constants'
import { snapshotFoeStandby } from './damage'
import { thrusterPhase, unitThrusterCycle, updateFoeCharge, unitSpeedMulOf, combatSpeed, steerStep, effectiveHitMul } from './movement'
import { foeDesiredRange, battleMaxDistanceM } from './foes/tactics'
import { expireFoeWebs, advanceMyCaptureWebs } from './captureWebs'
import { isAlive, clamp, healArmorHp } from './combatMath'
import { settleBlinkQueue, blinkHoldSides } from './blink'
import { FOE_SUPPORT_TAG_RE } from './foeCard'
import { isFoeEngageable, resolvePointDefense } from './combatDrones'
import { firePlayerPhase } from './playerFire'
import { fireEnemyPhase } from './enemyFire'
import { pushBattleNotice } from './combatFx'
import { isAliveAnyOf } from './targeting'
import { passiveShieldRateOf } from './passiveRecovery'
import { applyDroneCommandAura } from './droneCommand'

export function stepBattle(
  state: GameState,
  b: import('../state').BattleState,
  baseMyUnits: readonly UnitSpec[],
  foes: UnitSpec[],
  foeDesire: number,
  openM: number,
  bal: BattleBalance,
  dtMs: number,
  favor: { meMul: number; foeMul: number } | null = null,
  hasMoreWaves = false,
  foeTargeting: FoeTargetingMode = 'random',
  foeTargetingChance = 1,
  simulation?: BattleSimulationOptions,
): void {
  syncPlayerCrisis(b, baseMyUnits)
  for (const spec of baseMyUnits) advancePlayerRebirth(b, spec, b.lastTickGameMs)
  const myUnits = applyDroneCommandAura(baseMyUnits, b).map(spec => playerGravekeeperSpecOf(b, spec))
  if (simulation) {
    b.distanceM = simulation.distanceM
    for (const foe of foes) {
      const rt = b.units[foe.tag]
      if (rt) rt.hp = { s: simulation.layer === 's' ? 1e12 : 0, a: simulation.layer === 'a' ? 1e12 : 0, h: simulation.layer === 'h' ? 1e12 : 0 }
    }
  }
  const dtSec = dtMs / 1000
  syncFoeCapacitors(b, foes)
  for (const foe of foes) if (foe.foeRebirthProtocol) advanceFoeRebirthRepair(b, foe, b.lastTickGameMs)
  syncCoronaFleetFocus(b, foes)
  advanceFoeHatcheries(b, foes, b.lastTickGameMs)
  expireFoeAcidLayers(b)
  const volleyWindow = Math.floor((b.lastTickGameMs - b.startedAtGameMs) / BATTLE_VOLLEY_WINDOW_MS)
  if (b.meVolleyWindow !== volleyWindow) {
    b.meVolleyWindow = volleyWindow
    b.meVolleyDmg = {}
  }
  snapshotFoeStandby(b, foes)
  const me = myUnits[0]!

  const phaseOf = (u: UnitSpec): boolean => thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
  const normalDesire = foes.some(f => f.acidBurst) ? foeDesiredRange(me, foes, bal, b.meFoeRangeDebuff ?? 0, b) : foeDesire
  const foeDesireClamped = Math.min(openM, normalDesire);
  updateFoeCharge(b, foes, bal, b.lastTickGameMs, foeDesireClamped)
  expireFoeWebs(state, b, foes)
  advanceMyCaptureWebs(state, b, myUnits, foes)
  let meV = 0
  let mePanel = 0
  {
    let n = 0
    for (const u of myUnits) {
      if (!isAlive(b, u.tag)) continue
      const mul = unitSpeedMulOf(u, b, bal, 'me')
      meV += combatSpeed(u.speedMps, u.agility, bal) * mul
      mePanel += u.speedMps * mul
      n += 1
    }
    if (n > 0) {
      meV /= n
      mePanel /= n
    }
  }
  let foeV = 0
  let foePanel = 0
  let foeAliveN = 0
  const fleetSpeedMul = foeFleetSpeedMulOf(b, foes)
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue
    const mul = unitSpeedMulOf(f, b, bal, 'foe') * fleetSpeedMul
    foeV += combatSpeed(f.speedMps, f.agility, bal) * mul
    foePanel += f.speedMps * mul
    foeAliveN += 1
  }
  if (foeAliveN > 0) {
    foeV /= foeAliveN
    foePanel /= foeAliveN
  }
  b.meSpeedMps = Math.round(mePanel)
  b.foeSpeedMps = Math.round(foePanel)
  const rate =
    steerStep(b.distanceM, b.myDesireM, meV, dtSec) +
    steerStep(b.distanceM, foeDesireClamped, foeV, dtSec)
  b.distanceM = clamp(bal.minDistanceM, battleMaxDistanceM(b, me, foes, bal, myUnits), b.distanceM + rate)

  settleBlinkQueue(b)
  if (simulation) b.distanceM = simulation.distanceM

  const blinkHold = blinkHoldSides(b)
  const foeBlinkHold = blinkHold.foe
  const meAtkOf = (u: UnitSpec): UnitSpec =>
    phaseOf(u) ? u : { ...u, hitMul: effectiveHitMul(u, false) }
  const awaitingWaveArrival = (b.waveIdx ?? 0) > 0 &&
    foes.some(f => !FOE_SUPPORT_TAG_RE.test(f.tag) && isAlive(b, f.tag) && b.units[f.tag]?.enteredAtMs !== undefined) &&
    !foes.some(f => isFoeEngageable(b, f.tag))
  firePlayerPhase(state, b, myUnits, foes, me, bal, dtMs, favor, blinkHold, meAtkOf, awaitingWaveArrival, simulation)
  fireEnemyPhase(state, b, myUnits, foes, me, bal, dtMs, favor, foeBlinkHold, foeTargeting, foeTargetingChance)


  resolvePointDefense(state, b, foes, bal, dtMs)

  syncPlayerCrisis(b, baseMyUnits)
  for (const spec of baseMyUnits) advancePlayerRebirth(b, spec, b.lastTickGameMs + dtMs)
  if (bal.shieldRegenPerSec > 0) {
    for (const unit of myUnits) {
      const urt = b.units[unit.tag]
      if (!urt || !isAlive(b, unit.tag)) continue
      const sMax = urt.hpMax?.s ?? unit.hp.s
      if (urt.hp.s >= sMax || (urt.hp.a <= 0 && urt.hp.h <= 0)) continue
      const regenMul = (1 + (unit.shieldPassiveBonusPct ?? 0)) * (1 + Math.max(0, unit.repairOutputBonusPct ?? 0))
      const rate = passiveShieldRateOf(urt.hp.s, sMax, bal.shieldRegenPerSec, regenMul)
      const regen = rate * dtSec
      if (regen > 0) urt.hp.s = Math.min(sMax, urt.hp.s + regen)
    }
  }
  for (const unit of foes) {
    const rt = b.units[unit.tag]
    if (!rt || !isAlive(b, unit.tag) || (rt.hp.a <= 0 && rt.hp.h <= 0)) continue
    const boss = unit.foeShipId !== undefined && unit.foeShipId === b.foeOverride?.bossShipId
    const cap = unit.shieldRegenCap ?? (boss ? b.foeOverride?.bossMaxLayers?.s : undefined) ?? rt.hpMax?.s ?? unit.hp.s
    const max = unit.shieldRegenMax ?? cap
    if (rt.hp.s < cap) rt.hp.s = Math.min(cap, rt.hp.s + passiveShieldRateOf(rt.hp.s, max, bal.shieldRegenPerSec, 1, cap) * dtSec)
  }
  for (const unit of myUnits) {
    const rt = b.units[unit.tag]
    const armorRate = unit.armorRegenPerSec ?? 0
    if (!rt || !isAlive(b, unit.tag) || armorRate <= 0) continue
    const max = rt.hpMax?.a ?? unit.hp.a
    healArmorHp(rt.hp, Math.min(Math.max(0, max - rt.hp.a), max * armorRate * dtSec))
  }

  for (const unit of myUnits) {
    const urt = b.units[unit.tag]
    const until = urt?.stealthUntilMs
    if (urt && until !== undefined && b.lastTickGameMs >= until) {
      urt.stealthUntilMs = undefined
      pushBattleNotice(b, '隐秘行动结束：隐身窗口到点，本舰现形')
    }
  }

  if (simulation) for (const foe of foes) {
    const rt = b.units[foe.tag]
    if (rt) rt.hp = { s: simulation.layer === 's' ? 10000 : 0, a: simulation.layer === 'a' ? 10000 : 0, h: simulation.layer === 'h' ? 10000 : 0 }
  }
  expireFoeAcidLayers(b)
  const meAlive = isAliveAnyOf(b, myUnits)
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    expireFoeAcidLayers(b)
    return
  }
  if (!foeAlive) {
    if (!hasMoreWaves) {
      b.ended = 'me'
      expireFoeAcidLayers(b)
    }
    return
  }
  if (
    !b.ended &&
    bal.cannotEngageMs > 0 &&
    b.lastTickGameMs - b.startedAtGameMs >= bal.cannotEngageMs &&
    b.stats.meShots === 0 &&
    b.stats.foeShots > 0
  ) {
    const myTopRangeM = myUnits.reduce(
      (m, u) => u.weapons.reduce((mm, w) => Math.max(mm, w.maxRangeM), m),
      0,
    )
    if (b.distanceM > myTopRangeM) {
      b.ended = 'foe'
      b.autoEscaped = true
      b.escapeReason = 'cannot-engage'
    }
  }
  if (b.lastTickGameMs - b.startedAtGameMs >= bal.maxBattleMs) {
    b.ended = 'foe'
    b.autoEscaped = true
    b.escapeReason = 'timeout'
  }
  if (b.ended) expireFoeAcidLayers(b)
}
