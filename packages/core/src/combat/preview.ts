import type { GameState } from '../state'
import type { UnitSpec } from './model'
import type { BattleBalance, SimContext, AnomalyDef, DamageType } from '../types'
import { desiredRangeFor, foeDesiredRange, battleOpenM } from './foes/tactics'
import { createFoeSpecs } from './foes/catalog'
import { clamp, SHIP_HP_UPLIFT_MUL, playerWeaponInRange, hitChance, playerBlindDamageMul, typeLayerMult } from './combatMath'
import { createPlayerSpec } from './player/create'
import { foeHpOfThreat } from './foePower'
import { battleCardRangeOf } from './battleRangeMemory'
import { meFoeRangeDebuffOf } from './foeRange'
import { beamPowerFactor } from './beam'
import { foeDamageComposition } from '../wormholeFoes'
import { ceilFinalQuantity } from '../quantity'
import { shieldChargeStreamsOf } from './combatRepair'
import { spreadWinChance } from './combatReport'
import { passiveShieldBreakSeconds, passiveArmorBreakSeconds } from './passiveRecovery'

export function desirePrefOf(state: GameState, galaxyId: string | null | undefined): number | null {
  if (!galaxyId) return null
  const v = state.expedition.desirePrefByGalaxy?.[galaxyId]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

export function setDesirePrefOf(state: GameState, galaxyId: string, desireM: number): number {
  const v = Math.max(1, Math.round(desireM))
  state.expedition.desirePrefByGalaxy = { ...(state.expedition.desirePrefByGalaxy ?? {}), [galaxyId]: v }
  return v
}

export function steadyDistance(
  me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  midPos: number,
  foeRangeDebuffR = 0,
): number {
  const dMe = desiredRangeFor(me, 'mid', bal, midPos)
  const dFoe = foeDesiredRange(me, foes, bal, foeRangeDebuffR)
  const open = battleOpenM(me, foes, bal)
  return clamp(bal.minDistanceM, open, (dMe + dFoe) / 2)
}

export function steadyPreview(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): {
  me: UnitSpec
  meHpTotal: number
  foeHpTotal: number
  meDps: number
  foeDps: number
  ttrMe: number
  ttrFoe: number
} | null {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const peakUnits = waves ? Math.max(...waves.map((w) => w.units)) : 1
  const foes = peakUnits > 1 ? createFoeSpecs(anomaly, bal, { units: peakUnits }) : createFoeSpecs(anomaly, bal)

  const shipSlots = anomaly.ships ?? []
  const shipWaveBuilds =
    shipSlots.length > 0
      ? ((): Array<{ specs: UnitSpec[]; hp: number; dps: number }> => {
          const idxs = new Set<number>()
          for (const s of shipSlots) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
          if (idxs.size === 0) idxs.add(0)
          return [...idxs].map((i) => {
            const specs = createFoeSpecs(anomaly, bal, { tagPrefix: i === 0 ? '' : `w${i}-` })
            let hp = 0
            let dps = 0
            for (const f of specs) {
              hp += f.hp.s + f.hp.a + f.hp.h
              for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
            }
            return { specs, hp, dps }
          })
        })()
      : null
  const curveHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * SHIP_HP_UPLIFT_MUL
  const foeHpTotal = shipWaveBuilds ? shipWaveBuilds.reduce((n, b) => n + b.hp, 0) || curveHp : curveHp
  const firepowerFoes = shipWaveBuilds
    ? shipWaveBuilds.reduce((best, b) => (b.dps > best.dps ? b : best), shipWaveBuilds[0]!).specs
    : foes
  const steadyPref = battleCardRangeOf(state, anomaly.id)?.desireM ?? null
  const steady =
    steadyPref !== null
      ? clamp(bal.minDistanceM, battleOpenM(me, foes, bal), steadyPref)
      : steadyDistance(me, foes, bal, bal.desireBandMid, meFoeRangeDebuffOf(state, ctx, [shipId]))

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h

  let meDps = 0
  for (const w of me.weapons) {
    if (w.disabled || !playerWeaponInRange(steady, w)) continue
    let shot = 0
    let ammoType: DamageType | null = null
    let hit = 0
    let power = 1
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
      hit = hitChance(w, me, foes[0]!, steady, bal)
    } else if (w.kind === 'beam') {
      ammoType = w.fixedType ?? 'plasma'
      shot = w.shotDmg ?? 0
      hit = 1
      power = beamPowerFactor(steady, w)
    } else {
      shot = w.shotDmg ?? 0
      hit = hitChance(w, me, foes[0]!, steady, bal)
    }
    if (hit <= 0) continue
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    const allFoesMul = w.allFoes === true ? Math.max(1, foes.length) : 1
    power *= playerBlindDamageMul(steady, w)
    meDps += (shot * power * mult * hit * allFoesMul * 1000) / w.reloadMs
    const secPctEst = w.secondaryDamagePct ?? 0
    if (secPctEst > 0) {
      const secMul = effectiveDmgMultAgainst(foes, w.secondaryDamageType ?? 'kinetic')
      meDps += (shot * power * secMul * hit * allFoesMul * secPctEst * 1000) / w.reloadMs
    }
  }
  const foeComp = foeDamageComposition(anomaly)
  const foeCompWeighted = (type: DamageType): number =>
    foeComp.length <= 1
      ? avgLayerMult(meHpTotal, me, type)
      : foeComp.reduce((s, c) => s + c.share * avgLayerMult(meHpTotal, me, c.type), 0)
  let foeDpsPeak = 0
  for (const f of firepowerFoes) {
    const w = f.weapons[0]!
    const isBeam = w.kind === 'beam'
    const hit = isBeam ? 1 : hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const power = isBeam ? (steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(steady, w)) : steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : 1
    const shot = Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * power))
    const mult = foeCompWeighted(w.fixedType ?? 'kinetic')
    const shotsPerCycle = Math.max(1, Math.floor(w.burst?.shots ?? 1))
    foeDpsPeak += (shot * shotsPerCycle * mult * hit * 1000) / w.reloadMs
  }
  const foeUnitN = Math.max(1, firepowerFoes.length)
  const foeDps = foeDpsPeak * ((foeUnitN + 1) / (2 * foeUnitN))

  const foeDpsNet = foeDps * foeMul
  const regenMul = (1 + (me.shieldPassiveBonusPct ?? 0)) * (1 + Math.max(0, me.repairOutputBonusPct ?? 0))
  const s0 = Math.max(0, me.hp.s)
  const chargePerSec =
    shieldChargeStreamsOf(state, ctx, shipId).reduce((n, s) => n + (s.pct * s0) / Math.max(1, s.ms) / 1000, 0)
  const tBreak = passiveShieldBreakSeconds(s0, s0, foeDpsNet, bal.shieldRegenPerSec, regenMul)
  const after = Math.max(0, foeDpsNet - (s0 > 0 && bal.shieldRegenPerSec > 0 ? chargePerSec : 0))
  const ttrMe = tBreak + passiveArmorBreakSeconds(me.hp.a, me.hp.a, after, me.armorRegenPerSec) + (after > 0 ? me.hp.h / after : Infinity)
  const damagePerSec = meDps * meMul
  const recoveryFoes = shipWaveBuilds ? shipWaveBuilds.flatMap(build => build.specs) : foes
  const regenDelay = damagePerSec > 0 ? recoveryFoes.reduce((sum, foe) => {
    const cap = foe.shieldRegenCap ?? foe.hp.s
    const seconds = passiveShieldBreakSeconds(foe.hp.s, foe.shieldRegenMax ?? cap, damagePerSec,
      foe.hp.a > 0 || foe.hp.h > 0 ? bal.shieldRegenPerSec : 0, 1, cap)
    return sum + seconds - foe.hp.s / damagePerSec
  }, 0) : 0
  const ttrFoe = damagePerSec > 0 ? foeHpTotal / damagePerSec + regenDelay : Infinity
  return { me, meHpTotal, foeHpTotal, meDps, foeDps, ttrMe, ttrFoe }
}

export function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const sp = steadyPreview(state, ctx, anomaly, shipId, meMul, foeMul)
  if (!sp) return 0
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) return 0.5
  if (!Number.isFinite(sp.ttrMe)) return 1
  if (!Number.isFinite(sp.ttrFoe)) return 0
  return clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
}

export function bountyDamageForecast(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): { armorLoss: number; hullLoss: number; rawWin: number } {
  const sp = steadyPreview(state, ctx, anomaly, shipId, 1, 1)
  if (!sp) return { armorLoss: 0, hullLoss: 0, rawWin: 0 }
  let rawWin: number
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) rawWin = 0.5
  else if (!Number.isFinite(sp.ttrMe)) rawWin = 1
  else if (!Number.isFinite(sp.ttrFoe)) rawWin = 0
  else rawWin = clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
  const duration = Math.min(sp.ttrMe, sp.ttrFoe)
  const stealthSec = Math.max(0, (sp.me.stealthMs ?? 0) / 1000)
  const foeFireSec = Math.max(0, duration - stealthSec)
  const dmg = Number.isFinite(duration) ? sp.foeDps * foeFireSec : 0
  const afterShield = Math.max(0, dmg - sp.me.hp.s)
  if ((sp.me.armorRegenPerSec ?? 0) > 0) {
    const regenMul = (1 + (sp.me.shieldPassiveBonusPct ?? 0)) * (1 + Math.max(0, sp.me.repairOutputBonusPct ?? 0))
    const shieldSeconds = passiveShieldBreakSeconds(sp.me.hp.s, sp.me.hp.s, sp.foeDps, ctx.balance.battle.shieldRegenPerSec, regenMul)
    const armorSeconds = Math.max(0, foeFireSec - shieldSeconds)
    const netArmorDps = Math.max(0, sp.foeDps - sp.me.hp.a * sp.me.armorRegenPerSec!)
    const armorDamage = Number.isFinite(duration) ? armorSeconds * netArmorDps : 0
    const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, armorDamage / sp.me.hp.a) : armorDamage > 0 ? 1 : 0
    const armorBreak = passiveArmorBreakSeconds(sp.me.hp.a, sp.me.hp.a, sp.foeDps, sp.me.armorRegenPerSec)
    const hullDamage = Number.isFinite(duration) ? Math.max(0, armorSeconds - armorBreak) * sp.foeDps : 0
    const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, hullDamage / sp.me.hp.h) : hullDamage > 0 ? 1 : 0
    return { armorLoss, hullLoss, rawWin }
  }
  const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, afterShield / sp.me.hp.a) : afterShield > 0 ? 1 : 0
  const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, Math.max(0, afterShield - sp.me.hp.a) / sp.me.hp.h) : afterShield > sp.me.hp.a ? 1 : 0
  return { armorLoss, hullLoss, rawWin }
}

export function bountyWinPercentGuarded(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): number {
  const f = bountyDamageForecast(state, ctx, anomaly, shipId)
  if (f.rawWin <= 0) return 0
  const shown = spreadWinChance(f.rawWin, ctx.balance.battle.winSpread)
  const bal = ctx.balance.battle
  const penalty = f.armorLoss * bal.winPenaltyArmorPerFull + f.hullLoss * bal.winPenaltyHullPerFull
  return Math.max(0.02, Math.min(1, shown - penalty))
}

export function battleWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string = state.shipId): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return spreadWinChance(raw, ctx.balance.battle.winSpread)
}

export function aiFavorAdv(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return clamp(-1, 1, (raw - 0.5) * 2)
}

export function aiWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const k = ctx.balance.battle.aiFavorStrength
  const adv = aiFavorAdv(state, ctx, anomaly, shipId)
  const favored = winPreviewRaw(state, ctx, anomaly, shipId, 1 + k * adv, 1 - k * adv)
  return spreadWinChance(favored, ctx.balance.battle.winSpread)
}

export function effectiveDmgMultAgainst(foes: UnitSpec[], type: DamageType): number {
  let total = 0
  let acc = 0
  for (const f of foes) {
    const s = f.hp.s + f.hp.a + f.hp.h
    total += s
    acc += f.hp.s * typeLayerMult(type, 'shield') + f.hp.a * typeLayerMult(type, 'armor') + f.hp.h * typeLayerMult(type, 'hull')
  }
  return total > 0 ? acc / total : 1
}

export function avgLayerMult(meHpTotal: number, me: UnitSpec, type: DamageType): number {
  if (meHpTotal <= 0) return 1
  const s = (me.hp.s / meHpTotal) * typeLayerMult(type, 'shield') * (1 - (me.resists.shield?.[type] ?? 0))
  const a = (me.hp.a / meHpTotal) * typeLayerMult(type, 'armor') * (1 - (me.resists.armor?.[type] ?? 0))
  const h = (me.hp.h / meHpTotal) * typeLayerMult(type, 'hull') * (1 - (me.resists.hull?.[type] ?? 0))
  return s + a + h
}
