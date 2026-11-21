import { type ModuleDef, SHIELD_FIELD_COST_PCT, SHIELD_PULSE_MS, type DamageType, FOE_RANGE_DEBUFF_FLOOR_M, MY_WEB_RANGE_M, stackingOf, type ModuleSlot } from '@whale/core'
import { tr } from '../../../i18n/locale'
import { pctOpt, turretAmmoText, rangeText, recoveryPct, pct, resistGapText, thrusterCycleShort, fmt, salvageCycleSecs, reviveCycleSecs, DMG_LABEL, repairShortText, hullResistShortText } from './primitives'

export function moduleShortEffect(mod: ModuleDef): string {
  let body = ''
  switch (mod.slot) {
    case 'miner':
      body = tr("ui.shipInfo.097", { p1: pctOpt(mod.bonus) })
      break
    case 'cargo':
      body = tr("ui.shipInfo.098", { p1: pctOpt(mod.bonus) })
      break
    case 'turret': {
      body = tr("ui.shipInfo.099", { p1: turretAmmoText(mod), p2: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'missile': {
      body = tr("ui.shipInfo.100", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'laser': {
      body = tr("ui.shipInfo.101", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      if (mod.overlayDrive) {
        const bl = tr("ui.shipInfo.246", {
          p1: ((mod.reloadMs ?? 0) / 1000).toFixed(1),
          p2: (mod.overlayDrive.stepMs / 1000).toFixed(1),
          p3: (mod.overlayDrive.floorMs / 1000).toFixed(1),
        })
        body = body ? `${body} · ${bl}` : bl
      }
      break
    }
    case 'shield-field': {
      const parts: string[] = []
      const ms = mod.shieldFieldMs ?? 0
      if ((mod.shieldFieldPct ?? 0) > 0 && ms > 0) {
        parts.push(tr('ui.fleetSupport.001', { p1: Math.round(ms / 1000), p2: recoveryPct(mod.shieldFieldPct ?? 0), p3: recoveryPct(SHIELD_FIELD_COST_PCT) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'shield': {
      const parts: string[] = []
      if (mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
      const gap = resistGapText(mod.shieldResistAdd)
      if (gap) parts.push(gap)
      if ((mod.shieldPulsePct ?? 0) > 0) {
        parts.push(tr("ui.shipInfo.103", { p1: SHIELD_PULSE_MS / 1000, p2: recoveryPct(mod.shieldPulsePct ?? 0) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'armor': {
      const parts: string[] = []
      if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
      const gap = resistGapText(mod.armorResistAdd)
      if (gap) parts.push(gap)
      if ((mod.hullHpBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.105", { p1: pct(mod.hullHpBonus ?? 0) }))
      if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'propulsion': {
      const parts: string[] = []
      if (mod.speedBonusPct !== undefined)
        parts.push(tr("ui.shipInfo.107", { p1: pct(mod.speedBonusPct), p2: thrusterCycleShort(mod) }))
      if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - mod.hitPenalty).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'drone-rack':
      body = tr("ui.shipInfo.109", { p1: fmt(mod.droneBayBonusM3) })
      break
    case 'salvager':
      body = tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) })
      break
    case 'drone-tac':
      body = tr("ui.shipInfo.111", { p1: pctOpt(mod.droneDmgBonus) })
      break
    case 'drone-relay':
      body = tr("ui.shipInfo.112", { p1: pctOpt(mod.droneRangeBonusPct) })
      break
    case 'drone-launch':
      body = tr('ui.launchCalibration.001', { p1: Math.round((mod.droneLaunchCutPct ?? 0) * 100) })
      break
    case 'drone-deck':
      body = tr("ui.shipInfo.205", { p1: reviveCycleSecs(mod) })
      break
    case 'drone-shield':
      body = tr("ui.shipInfo.209", { p1: pctOpt(mod.droneShieldHpBonusPct) })
      break
    case 'support': {
      const dmg = mod.damageTypeBonusPct
      if (mod.blink) {
        body = tr('ui.shipInfo.247', {
          p1: (mod.blink.distanceM / 1000).toFixed(mod.blink.distanceM % 1000 === 0 ? 0 : 1),
          p2: Math.round(mod.blink.cooldownMs / 1000),
        })
      } else if (mod.rebirthRepair) {
        const d = mod.rebirthRepair
        body = tr('ui.gravekeeperGear.002', { p1: d.repairMs / 1000, p2: d.armorTotalPct * 100, p3: d.hullTotalPct * 100 })
      } else if (mod.crisisOverload) {
        const d = mod.crisisOverload
        body = tr('ui.gravekeeperGear.010', { p1: d.rangeBonusPct * 100, p2: d.damageBonusPct * 100, p3: d.speedPenaltyPct * 100 })
      } else if (mod.laserFalloffBonus !== undefined) {
        body = tr('ui.launchCalibration.002', { p1: mod.laserFalloffBonus })
      } else if (dmg && Object.keys(dmg).length > 0) {
        body = Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => tr("ui.shipInfo.113", { p1: DMG_LABEL[t as DamageType], p2: pct(v ?? 0) }))
          .join(' + ')
      } else if (mod.reloadCutPct !== undefined) {
        body = tr("ui.shipInfo.114", { p1: pct(mod.reloadCutPct) })
      } else if (mod.hitBonusPct !== undefined) {
        body = tr("ui.shipInfo.115", { p1: pct(mod.hitBonusPct) })
      } else if (mod.evasionGapPct !== undefined) {
        body = tr("ui.shipInfo.116", { p1: pct(mod.evasionGapPct) })
      } else if (mod.warpSpeedBonusPct !== undefined) {
        body = tr("ui.shipInfo.117", { p1: pct(mod.warpSpeedBonusPct) })
      } else if (mod.stealthMs !== undefined) {
        body = tr("ui.shipInfo.118", { p1: mod.stealthMs / 1000 })
      } else if (mod.rangeEwStrength !== undefined) {
        body = `${tr('ui.rangeEw.010')} +${mod.rangeEwStrength}`
      } else if (mod.foeRangeDebuffPct !== undefined) {
        body = tr("ui.shipInfo.185", { p1: pct(mod.foeRangeDebuffPct), p2: String(FOE_RANGE_DEBUFF_FLOOR_M) })
      } else if (mod.captureWebCycleMs !== undefined) {
        body = tr("ui.shipInfo.186", {
          p1: Math.round(mod.captureWebCycleMs / 1000),
          p2: String(mod.captureWebRangeM ?? MY_WEB_RANGE_M),
        })
      }
      break
    }
    case 'target-lock':
      body = tr('ui.fleetSupport.004', { p1: pct(mod.lockTargetChance ?? 1), p2: pctOpt(mod.lockDmgBonus) })
      break
    case 'cpu':
      body = tr("ui.shipInfo.120", { p1: fmt(mod.cpuBonus) })
      break
    case 'plug': {
      const bits: string[] = []
      if (mod.stealthWithPropulsion) bits.push(tr('ui.factionPlug.001'))
      if (mod.shieldArmorConversionPct !== undefined) bits.push(tr('ui.factionPlug.008', { p1: pct(mod.shieldArmorConversionPct), p2: pct(mod.shieldCapacityRetainedPct ?? 0) }))
      if (mod.shieldPassiveBonusPct !== undefined) bits.push(tr('ui.factionPlug.003', { p1: pct(mod.shieldPassiveBonusPct) }))
      if (mod.cargoCapacityBonusPct !== undefined) bits.push(tr('ui.factionPlug.004', { p1: pct(mod.cargoCapacityBonusPct) }))
      if (mod.cpuPenalty !== undefined) bits.push(tr('ui.factionPlug.005', { p1: fmt(mod.cpuPenalty) }))
      if (mod.dronePrinting) bits.push(tr('ui.factionPlug.006', {
        hp: pct(1 - mod.dronePrinting.hpMul), damage: pct(1 - mod.dronePrinting.damageMul),
        launch: pct(1 - mod.dronePrinting.launchMul), deck: pct(1 - mod.dronePrinting.deckCycleMul),
      }))
      if (mod.damageManagement) {
        bits.push(tr('ui.factionPlug.010', { p1: pct(mod.damageManagement.penaltyReductionPct) }))
        bits.push(tr('ui.factionPlug.012', { p1: pct(mod.damageManagement.hullResistPerKind), p2: mod.damageManagement.maxKinds }))
      }
      if (mod.armorCapacityPenaltyPct !== undefined) bits.push(tr('ui.factionPlug.013', { p1: pct(mod.armorCapacityPenaltyPct) }))
      if (mod.armorRegenPerSec !== undefined) bits.push(tr('ui.factionPlug.015', { p1: recoveryPct(mod.armorRegenPerSec) }))
      if (mod.chargedWeapons) {
        bits.push(tr('ui.factionPlug.017', { p1: fmt(mod.chargedWeapons.damageMul) }))
        bits.push(tr('ui.factionPlug.019', { p1: fmt(mod.chargedWeapons.reloadMul) }))
        bits.push(tr('ui.factionPlug.021', { p1: pct(mod.chargedWeapons.falloffReductionPct) }))
      }
      if (mod.droneCommand) {
        bits.push(tr('ui.factionPlug.023', { p1: pct(mod.droneCommand.sharePct) }))
        bits.push(tr('ui.factionPlug.025', { p1: pct(mod.droneCommand.targetWeightPerM3) }))
      }
      if (mod.hullCapacityBonusPct !== undefined) bits.push(tr('ui.factionPlug.026', { p1: pct(mod.hullCapacityBonusPct) }))
      if (mod.recoveryDamageImmune) bits.push(tr('ui.factionPlug.028'))
      if (mod.shieldHpAdd !== undefined) bits.push(tr('ui.shipInfo.187', { p1: fmt(mod.shieldHpAdd) }))
      if (mod.armorHpAdd !== undefined) bits.push(tr('ui.shipInfo.188', { p1: fmt(mod.armorHpAdd) }))
      if (mod.hullHpAdd !== undefined) bits.push(tr('ui.shipInfo.189', { p1: fmt(mod.hullHpAdd) }))
      if (mod.midSlotsAdd !== undefined) bits.push(tr('ui.shipInfo.190', { p1: fmt(mod.midSlotsAdd) }))
      if (mod.lowSlotsAdd !== undefined) bits.push(tr('ui.shipInfo.191', { p1: fmt(mod.lowSlotsAdd) }))
      if (mod.cpuBonus !== undefined) bits.push(tr('ui.shipInfo.192', { p1: fmt(mod.cpuBonus) }))
      if (mod.damageBonusPct !== undefined) bits.push(tr('ui.shipInfo.193', { p1: pct(mod.damageBonusPct) }))
      if (mod.hitBonusPct !== undefined) bits.push(tr('ui.shipInfo.194', { p1: pct(mod.hitBonusPct) }))
      if (mod.speedAddMps !== undefined) bits.push(tr('ui.shipInfo.195', { p1: fmt(mod.speedAddMps) }))
      if (mod.speedPenaltyMps !== undefined) bits.push(tr('ui.shipInfo.196', { p1: fmt(mod.speedPenaltyMps) }))
      if (mod.rangeCutPct !== undefined && mod.rangeCutPct < 0) bits.push(tr('ui.shipInfo.197', { p1: pct(-mod.rangeCutPct) }))
      if ((mod.plugRangeBonusPct ?? 0) > 0) bits.push(tr('ui.shipInfo.197', { p1: pct(mod.plugRangeBonusPct ?? 0) }))
      if (mod.targetWeightMul !== undefined) {
        bits.push(mod.targetWeightMul > 1 ? tr('ui.shipInfo.198') : tr('ui.shipInfo.199'))
      }
      body = `${bits.join(' · ')}${bits.length > 0 ? ' · ' : ''}${tr('ui.shipInfo.200')}`
      break
    }
  }
  const extras = [repairShortText(mod), hullResistShortText(mod), crossFamilyShort(mod)].filter(Boolean).join(' · ')
  if (extras) body = body ? `${body} · ${extras}` : extras
  const stShort = stackingOf(mod).group
  return body + (mod.plugNonStacking ? ` · ${tr('ui.factionPlug.007')}` : mod.unique === true || stShort === 'flat' || stShort === 'max' ? '' : tr('ui.shipInfo.179'))
}

export function crossFamilyShort(mod: ModuleDef): string {
  const parts: string[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
    if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
  }
  if (foreign('shield') && mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
  if (foreign('propulsion')) {
    if (mod.speedRamp)
      parts.push(tr('ui.alienLoot.004', { p1: (mod.speedBonusPct ?? 0) * 100, p2: mod.speedRamp.maxBonusPct * 100, p3: mod.speedRamp.rampMs / 1000 }))
    else if (mod.speedBonusPct !== undefined)
      parts.push(tr('ui.shipInfo.256', { p1: pct(mod.speedBonusPct) }))
    if ((mod.hitPenalty ?? 0) > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }))
  }
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) parts.push(tr("ui.shipInfo.146", { p1: fmt(mod.droneBayBonusM3 ?? 0) }))
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.111", { p1: pct(mod.droneDmgBonus ?? 0) }))
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.112", { p1: pct(mod.droneRangeBonusPct ?? 0) }))
  if (foreign('drone-shield') && (mod.droneShieldHpBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.209", { p1: pct(mod.droneShieldHpBonusPct ?? 0) }))
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) parts.push(tr("ui.shipInfo.147", { p1: pct(mod.lockDmgBonus) }))
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.148", { p1: fmt(mod.cpuBonus ?? 0) }))
  if ((mod.droneHullHpBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.202", { p1: pct(mod.droneHullHpBonusPct ?? 0) }))
  if ((mod.droneHitGapPct ?? 0) > 0) parts.push(`${tr("ui.shipInfo.211")} ${tr("ui.shipInfo.212", { p1: pct(mod.droneHitGapPct ?? 0) })}`)
  return parts.join(' · ')
}
