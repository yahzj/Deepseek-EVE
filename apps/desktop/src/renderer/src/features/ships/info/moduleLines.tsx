import { type ModuleDef, type ModuleSlot, type DamageType, rackOf, beamPowerFactor, MY_WEB_RANGE_M, WEB_BREAK_DIST_M, FOE_RANGE_DEBUFF_FLOOR_M, SHIELD_PULSE_MS, SHIELD_FIELD_COST_PCT, stackingOf, DC_LOCK_MS, droneReviveCycleMsOf, equipmentCycleMsOf } from '@whale/core'
import { type InfoLine, pct, resistAddLine, repairAmountText, repairKitName, fmt, reviveCycleSecs, DMG_LABEL, pctOpt, propTailOf, DmgChip, rangeText, salvageCycleSecs, fittedRepairLine, recoveryPct, fittedDecayLine } from './primitives'
import { tr } from '../../../i18n/locale'
import type { GameEngine } from '../../../game/engine'
import { moduleSubKeyOf, MODULE_SUBS, subText } from '../../../ui/itemSubs'
import { slotText, rackText } from '../../../ui/labelsText'
import { moduleShortEffect } from './moduleEffects'

export function crossFamilyLines(mod: ModuleDef): InfoLine[] {
  const out: InfoLine[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) out.push(row)
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      out.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  }
  if (foreign('shield')) {
    if (mod.shieldHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) out.push(row)
  }
  if (foreign('propulsion')) {
    if ((mod.hitPenalty ?? 0) > 0) {
      out.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }) })
    }
  }
  if (foreign('support') && ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0)) {
    const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
    const isFree = mod.repairFree === true
    out.push({
      k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
      v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
    })
    out.push({
      k: tr("ui.shipInfo.024"),
      v: isFree ? (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
          <span className="app-dim">{tr("ui.shipInfo.026")}</span>
        </>
      ) : (
        <>
          <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
          <span className="app-dim">{tr("ui.shipInfo.027")}</span>
        </>
      ),
    })
  }
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3 ?? 0)} m³` })
  }
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus ?? 0)}` })
  }
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.030"), v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct ?? 0) }) })
  }
  if (foreign('drone-deck') && (mod.droneReviveCycleMs ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.206"), v: tr("ui.shipInfo.207", { p1: reviveCycleSecs(mod) }) })
  }
  if (foreign('drone-shield') && (mod.droneShieldHpBonusPct ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.208"), v: `+${pct(mod.droneShieldHpBonusPct ?? 0)}` })
  }
  if (foreign('support')) {
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      out.push({
        k: tr("ui.shipInfo.031"),
        v: `${Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => `${DMG_LABEL[t as DamageType]} +${pct(v ?? 0)}`)
          .join(' · ')}`,
      })
    }
    if (mod.reloadCutPct !== undefined) out.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    if (mod.hitBonusPct !== undefined) out.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + mod.hitBonusPct).toFixed(2) }) })
    if (mod.evasionGapPct !== undefined) out.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - mod.evasionGapPct).toFixed(2) }) })
  }
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) {
    out.push({ k: tr("ui.shipInfo.035"), v: tr("ui.shipInfo.143", { p1: pct(mod.lockDmgBonus) }) })
  }
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.144"), v: tr("ui.shipInfo.145", { p1: fmt(mod.cpuBonus ?? 0) }) })
  }
  return out
}

export function moduleInfoLines(mod: ModuleDef, engine?: GameEngine, shipId?: string, ordinal = 1): InfoLine[] {
  const subKey = moduleSubKeyOf(mod.slot, mod.id)
  const subOpt = MODULE_SUBS.find((s) => s.key === subKey)
  const typeText = mod.slot === 'support' && subOpt ? subText(subOpt) : slotText(mod.slot)
  const lines: InfoLine[] = [{ k: tr("ui.shipInfo.036"), v: `${typeText}（${rackText(rackOf(mod))}）` }]
  if (mod.slot === 'miner') {
    lines.push({ k: tr("ui.shipInfo.037"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'cargo') {
    lines.push({ k: tr("ui.Handbook.010"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'drone-shield') {
    lines.push({ k: tr('ui.shipInfo.208'), v: `+${pctOpt(mod.droneShieldHpBonusPct)}` })
  } else if (mod.slot === 'shield') {
    if (mod.shieldHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) lines.push(row)
  } else if (mod.slot === 'armor') {
    if (mod.armorHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) lines.push(row)
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      lines.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'propulsion') {
    if (mod.speedBonusPct !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.020"),
        v: (
          <>
            {tr("ui.shipInfo.135", { p1: pct(mod.speedBonusPct) })}
            <span className="app-dim">{propTailOf(mod)}</span>
          </>
        ),
      })
    }
    if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) {
      lines.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - mod.hitPenalty).toFixed(2) }) })
    }
  } else if (mod.slot === 'turret') {
    if (mod.damageType !== undefined) {
      lines.push({
        k: tr("ui.BattleScreen.003"),
        v: (
          <>
            <span className="app-dim">{tr("ui.shipInfo.038")}</span>
            <DmgChip t={mod.damageType} label={tr("ui.FitPage.127", { p1: DMG_LABEL[mod.damageType] })} />
            <span className="app-dim">{tr("ui.shipInfo.039")}</span>
          </>
        ),
      })
    } else if (mod.ammoPerEngagement !== undefined) {
      lines.push({ k: tr("ui.BattleScreen.003"), v: tr("ui.shipInfo.149", { p1: mod.ammoPerEngagement }) })
    }
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    if (mod.antiDrone !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.041"),
        v: (
          <>
            {tr('ui.shipInfo.180')}
            <span className="app-dim">{`　对无人机伤害 ×${mod.antiDrone}`}</span>
          </>
        ),
      })
    }
    if (mod.hitRate !== undefined || mod.falloff !== undefined) {
      const hit = mod.hitRate !== undefined ? tr("ui.shipInfo.150", { p1: pct(mod.hitRate) }) : ''
      const ff = mod.falloff !== undefined ? tr("ui.shipInfo.151", { p1: mod.falloff }) : ''
      lines.push({ k: tr("ui.shipInfo.042"), v: [hit, ff].filter(Boolean).join('　') })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.153", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'missile') {
    lines.push({
      k: tr("ui.shipInfo.045"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.038")}</span>
          <DmgChip t={mod.damageType ?? 'explosive'} label={tr("ui.FitPage.008")} />
          <span className="app-dim">{tr("ui.shipInfo.039")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.046"), v: tr("ui.shipInfo.047") })
    if (mod.hitRate !== undefined) lines.push({ k: tr("ui.shipInfo.048"), v: `${pct(mod.hitRate)}` })
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.154", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'laser') {
    lines.push({
      k: tr("ui.shipInfo.049"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.050")}</span>
          <DmgChip t={mod.damageType ?? 'plasma'} label={tr("ui.FitPage.009")} />
          <span className="app-dim">{tr("ui.shipInfo.051")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.052"), v: tr("ui.shipInfo.053") })
    if (mod.falloff !== undefined) {
      const far = beamPowerFactor(mod.maxRangeM ?? 0, {
        minRangeM: mod.minRangeM ?? 0,
        maxRangeM: mod.maxRangeM ?? 0,
        falloff: mod.falloff,
      })
      lines.push({
        k: tr("ui.shipInfo.054"),
        v: tr("ui.shipInfo.155", { p1: far.toFixed(2) }),
      })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.156", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'drone-rack') {
    if (mod.droneBayBonusM3 !== undefined) {
      lines.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3)} m³` })
    }
  } else if (mod.slot === 'drone-tac') {
    if (mod.droneDmgBonus !== undefined) {
      lines.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus)}` })
    }
    if ((mod.droneHitGapPct ?? 0) > 0) {
      lines.push({ k: tr("ui.shipInfo.211"), v: tr("ui.shipInfo.212", { p1: pct(mod.droneHitGapPct ?? 0) }) })
    }
  } else if (mod.slot === 'drone-relay') {
    if (mod.droneRangeBonusPct !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.030"),
        v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct) }),
      })
    }
  } else if (mod.slot === 'drone-deck') {
    if (mod.droneReviveCycleMs !== undefined) {
      lines.push({ k: tr("ui.shipInfo.206"), v: tr("ui.shipInfo.207", { p1: reviveCycleSecs(mod) }) })
    }
  } else if (mod.slot === 'salvager') {
    if (mod.salvageCycleMs !== undefined) {
      lines.push({ k: tr("ui.shipInfo.055"), v: tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) }) })
    }
  } else if (mod.slot === 'support') {
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      lines.push({
        k: tr("ui.shipInfo.031"),
        v: (
          <>
            {Object.entries(dmg)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([t, v]) => (
                <span key={t} className="app-stack-inline">
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` +${pct(v ?? 0)}`}</span>
                </span>
              ))}
          </>
        ),
      })
    }
    if (mod.reloadCutPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    }
    if (mod.hitBonusPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + (mod.hitBonusPct ?? 0)).toFixed(2) }) })
    }
    if (mod.evasionGapPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - (mod.evasionGapPct ?? 0)).toFixed(2) }) })
    }
    if (mod.blink) {
      lines.push({ k: tr('ui.moduleSpecs.005'), v: tr('ui.moduleSpecs.006', { p1: mod.blink.distanceM, p2: mod.blink.cooldownMs / 1000 }) })
    }
    if (mod.stealthMs !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.056"),
        v: tr("ui.shipInfo.157", { p1: mod.stealthMs / 1000 }),
      })
      lines.push({ k: tr("ui.shipInfo.057"), v: tr("ui.shipInfo.058") })
    }
    if (mod.captureWebCycleMs !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.238"),
        v: (
          <>
            {tr("ui.shipInfo.241", { p1: fmt(mod.captureWebRangeM ?? MY_WEB_RANGE_M) })}
            <span className="app-dim">{tr("ui.shipInfo.244")}</span>
          </>
        ),
      })
      lines.push({
        k: tr("ui.shipInfo.239"),
        v: `${tr("ui.shipInfo.241", { p1: fmt(mod.captureWebBreakM ?? WEB_BREAK_DIST_M) })}`,
      })
      const slowMul = mod.captureWebSlowMul ?? 0.5
      lines.push({
        k: tr("ui.shipInfo.240"),
        v: tr("ui.shipInfo.242", { p1: Math.round((1 - slowMul) * 100), p2: String(slowMul) }),
      })
    }
    if ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0) {
      const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
      const isFree = mod.repairFree === true
      lines.push({
        k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
        v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
      })
      if (isFree) {
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
              <span className="app-dim">{tr("ui.shipInfo.026")}</span>
            </>
          ),
        })
      } else {
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
              <span className="app-dim">{tr("ui.shipInfo.027")}</span>
            </>
          ),
        })
      }
      if (shipId !== undefined && engine !== undefined) {
        const fitted = fittedRepairLine(engine, shipId, mod)
        if (fitted) lines.push(fitted)
      }
    }
  } else if (mod.slot === 'target-lock') {
    lines.push({ k: tr('ui.shipInfo.061'), v: moduleShortEffect(mod) })
  } else if (mod.slot === 'cpu') {
    if (mod.cpuBonus !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.144"),
        v: (
          <>
            {tr("ui.shipInfo.158", { p1: fmt(mod.cpuBonus) })}
            <span className="app-dim">{tr("ui.shipInfo.063")}</span>
          </>
        ),
      })
    }
    lines.push({
      k: tr("ui.shipInfo.064"),
      v: (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.159")}</em>
          <span className="app-dim">{tr("ui.shipInfo.065")}</span>
        </>
      ),
    })
  }
  if ((mod.hullHpBonus ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.066"), v: `+${pct(mod.hullHpBonus ?? 0)}` })
  }
  const hullRow = resistAddLine(tr("ui.FitPage.005"), mod.hullResistAdd)
  if (hullRow) lines.push(hullRow)
  if ((mod.secondaryDamagePct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.068"),
      v: tr("ui.shipInfo.160", { p1: pct(mod.secondaryDamagePct ?? 0), p2: DMG_LABEL[(mod.secondaryDamageType ?? 'kinetic') as DamageType] }),
    })
  }
  if ((mod.ammoPerShot ?? 1) > 1) {
    lines.push({ k: tr("ui.shipInfo.069"), v: tr("ui.shipInfo.161", { p1: mod.ammoPerShot ?? 1 }) })
  }
  if ((mod.rangeCutPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.070"), v: tr("ui.shipInfo.162", { p1: pct(mod.rangeCutPct ?? 0) }) })
  }
  if (mod.rangeTypeBonusPct) {
    for (const [t, v] of Object.entries(mod.rangeTypeBonusPct)) {
      if ((v ?? 0) > 0) lines.push({ k: tr("ui.shipInfo.163", { p1: DMG_LABEL[t as DamageType] }), v: `+${pct(v ?? 0)}` })
    }
  }
  if ((mod.damageBonusPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.071"), v: tr("ui.shipInfo.164", { p1: pct(mod.damageBonusPct ?? 0) }) })
  }
  if ((mod.reloadPenaltyPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.072"), v: tr("ui.shipInfo.165", { p1: pct(mod.reloadPenaltyPct ?? 0) }) })
  }
  if ((mod.allResistPenaltyPct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.073"),
      v: tr("ui.shipInfo.166", { p1: fmt((mod.allResistPenaltyPct ?? 0) * 100) }),
    })
  }
  if ((mod.droneCycleCutPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.074"), v: tr("ui.shipInfo.167", { p1: pct(mod.droneCycleCutPct ?? 0) }) })
  }
  if (mod.droneLaunchCutPct !== undefined) lines.push({ k: tr('ui.launchCalibration.004'), v: tr('ui.launchCalibration.001', { p1: Math.round(mod.droneLaunchCutPct * 100) }) })
  if (mod.laserFalloffBonus !== undefined) lines.push({ k: tr('ui.launchCalibration.005'), v: `+${mod.laserFalloffBonus}` })
  if (mod.acidOnHit) lines.push({ k: tr('ui.alienLoot.001'), v: tr('ui.alienLoot.002', { p1: mod.acidOnHit.cutPct * 100, p2: mod.acidOnHit.durationMs / 1000 }) })
  if (mod.speedRamp) lines.push({ k: tr('ui.alienLoot.003'), v: tr('ui.alienLoot.004', { p1: (mod.speedBonusPct ?? 0) * 100, p2: mod.speedRamp.maxBonusPct * 100, p3: mod.speedRamp.rampMs / 1000 }) })
  if ((mod.speedBonusPct ?? 0) > 0 && mod.slot !== 'propulsion' && !mod.speedRamp) {
    lines.push({ k: tr("ui.shipInfo.075"), v: tr('ui.shipInfo.256', { p1: pct(mod.speedBonusPct ?? 0) }) })
  }
  lines.push(...crossFamilyLines(mod))
  if (mod.rangeEwStrength !== undefined) {
    lines.push({ k: tr('ui.rangeEw.010'), v: `+${mod.rangeEwStrength}` })
  } else if ((mod.foeRangeDebuffPct ?? 0) > 0) {
    lines.push({ k: tr('ui.moduleSpecs.001'), v: tr('ui.shipInfo.185', { p1: pct(mod.foeRangeDebuffPct ?? 0), p2: String(FOE_RANGE_DEBUFF_FLOOR_M) }) })
  }
  if ((mod.shieldPulsePct ?? 0) > 0) {
    lines.push({ k: tr('ui.moduleSpecs.002'), v: tr('ui.shipInfo.103', { p1: SHIELD_PULSE_MS / 1000, p2: recoveryPct(mod.shieldPulsePct ?? 0) }) })
  }
  if ((mod.shieldFieldPct ?? 0) > 0 && (mod.shieldFieldMs ?? 0) > 0) {
    lines.push({ k: tr('ui.moduleSpecs.003'), v: tr('ui.fleetSupport.001', { p1: (mod.shieldFieldMs ?? 0) / 1000, p2: recoveryPct(mod.shieldFieldPct ?? 0), p3: recoveryPct(SHIELD_FIELD_COST_PCT) }) })
  }
  if (mod.overlayDrive) {
    lines.push({ k: tr('ui.moduleSpecs.004'), v: tr('ui.shipInfo.246', { p1: ((mod.reloadMs ?? 0) / 1000).toFixed(1), p2: (mod.overlayDrive.stepMs / 1000).toFixed(1), p3: (mod.overlayDrive.floorMs / 1000).toFixed(1) }) })
  }
  if (mod.rebirthRepair) lines.push({ k: tr('ui.gravekeeperGear.001'), v: tr('ui.gravekeeperGear.002', {
    p1: mod.rebirthRepair.repairMs / 1000, p2: mod.rebirthRepair.armorTotalPct * 100, p3: mod.rebirthRepair.hullTotalPct * 100,
  }) })
  if (mod.crisisOverload) {
    const d = mod.crisisOverload
    lines.push({ k: tr('ui.gravekeeperGear.003'), v: tr('ui.gravekeeperGear.010', { p1: d.rangeBonusPct * 100, p2: d.damageBonusPct * 100, p3: d.speedPenaltyPct * 100 }) })
    lines.push({ k: tr('ui.gravekeeperGear.005'), v: tr('ui.gravekeeperGear.006', { p1: (1 - d.droneInitialCutPct) * 100, p2: (1 - d.droneCycleCutPct) * 100 }) })
  }
  if (mod.railCharge) lines.push({ k: tr('ui.gravekeeperGear.007'), v: tr('ui.gravekeeperGear.008', {
    p1: mod.railCharge.damageStepPct * 100, p2: mod.railCharge.reloadStepPct * 100, p3: mod.railCharge.maxStacks,
  }) })
  if (mod.burst) {
    lines.push({ k: tr('ui.moduleSpecs.007'), v: tr('ui.moduleSpecs.008', { p1: mod.burst.shots, p2: mod.burst.gapMs / 1000 }) })
  }
  if (mod.damageManagement) {
    lines.push({ k: tr('ui.factionPlug.009'), v: tr('ui.factionPlug.010', { p1: pct(mod.damageManagement.penaltyReductionPct) }) })
    lines.push({ k: tr('ui.factionPlug.011'), v: tr('ui.factionPlug.012', { p1: pct(mod.damageManagement.hullResistPerKind), p2: mod.damageManagement.maxKinds }) })
  }
  if (mod.armorCapacityPenaltyPct !== undefined) lines.push({ k: tr('ui.shipInfo.016'), v: `-${pct(mod.armorCapacityPenaltyPct)}` })
  if (mod.armorRegenPerSec !== undefined) lines.push({ k: tr('ui.factionPlug.014'), v: tr('ui.factionPlug.015', { p1: recoveryPct(mod.armorRegenPerSec) }) })
  if (mod.chargedWeapons) {
    lines.push({ k: tr('ui.factionPlug.016'), v: `×${fmt(mod.chargedWeapons.damageMul)}` })
    lines.push({ k: tr('ui.factionPlug.018'), v: `×${fmt(mod.chargedWeapons.reloadMul)}` })
    lines.push({ k: tr('ui.factionPlug.020'), v: tr('ui.factionPlug.021', { p1: pct(mod.chargedWeapons.falloffReductionPct) }) })
  }
  if (mod.droneCommand) {
    lines.push({ k: tr('ui.factionPlug.022'), v: tr('ui.factionPlug.023', { p1: pct(mod.droneCommand.sharePct) }) })
    lines.push({ k: tr('ui.factionPlug.024'), v: tr('ui.factionPlug.025', { p1: pct(mod.droneCommand.targetWeightPerM3) }) })
  }
  if (mod.hullCapacityBonusPct !== undefined) lines.push({ k: tr('ui.shipInfo.066'), v: `+${pct(mod.hullCapacityBonusPct)}` })
  if (mod.recoveryDamageImmune) lines.push({ k: tr('ui.factionPlug.027'), v: tr('ui.factionPlug.028') })
  if (mod.slot === 'plug') lines.push({ k: tr('ui.moduleSpecs.009'), v: moduleShortEffect(mod) })
  const st = stackingOf(mod)
  if (mod.slot === 'target-lock') {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.fleetSupport.005') })
  } else if (mod.rangeEwStrength !== undefined) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.rangeEw.019') })
  } else if (mod.plugNonStacking) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.factionPlug.007') })
  } else if (mod.unique === true) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.252') })
  } else if (mod.slot === 'plug' && ((mod.midSlotsAdd ?? 0) > 0 || (mod.lowSlotsAdd ?? 0) > 0)) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.255') })
  } else if (mod.targetWeightMul !== undefined) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.254') })
  } else if (['turret', 'laser', 'missile', 'drone-deck'].includes(mod.slot)) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.253') })
  } else if (st.group === 'flat') {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.077") })
  } else if (st.group === 'max') {
    lines.push({ k: tr("ui.shipInfo.076"), v: st.kind === 'capture-web' ? tr("ui.shipInfo.243") : st.kind === 'blink' ? tr("ui.shipInfo.251") : tr("ui.shipInfo.078") })
  } else if (st.group === 'fleetDecay') {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr(st.kind === 'drone-launch' ? 'ui.shipInfo.079' : 'ui.shipInfo.201') })
  } else {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.079") })
  }
  if ((mod.droneHullHpBonusPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.210"), v: `+${pct(mod.droneHullHpBonusPct ?? 0)}` })
  }
  if (mod.hullSaveKit !== undefined) {
    lines.push({
      k: tr("ui.shipInfo.203"),
      v: tr("ui.shipInfo.204", { p1: Math.round(DC_LOCK_MS / 1000) }),
    })
  }
  if (mod.cpuUse !== undefined) lines.push({ k: tr("ui.shipInfo.169"), v: fmt(mod.cpuUse) })
  if (shipId !== undefined && engine !== undefined) {
    const dec = fittedDecayLine(engine, shipId, mod, ordinal)
    if (dec) lines.push(dec)
    const baseCycle = mod.shieldFieldMs ?? (mod.shieldPulsePct ? SHIELD_PULSE_MS : undefined) ??
      ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0 ? mod.repairIntervalMs ?? 5000 : undefined) ??
      mod.captureWebCycleMs ?? mod.droneReviveCycleMs
    if (baseCycle !== undefined) lines.push({ k: tr('ui.equipmentPenalty.001'), v: tr('ui.equipmentPenalty.002', {
      p1: (mod.droneReviveCycleMs !== undefined
        ? droneReviveCycleMsOf(engine.state, engine.ctx, shipId, baseCycle)
        : equipmentCycleMsOf(engine.state, engine.ctx, shipId, baseCycle)) / 1000, p2: baseCycle / 1000,
    }) })
  }
  return lines
}
