import type { GameState } from '../../state'
import type { SimContext, DamageType, DamageResists, ModuleDef } from '../../types'
import type { UnitSpec, WeaponSpec } from '../model'
import { fleetDefOf } from '../../instances'
import { plugEffectsOf } from '../../plugs'
import { moduleAllowedOnShip } from '../../shipFitting'
import { familyModules, allFittedModules, equipmentPenaltiesOf, curveMult, gapCombine, weightedSum, laserFalloffOf, droneBayTotalM3, cpuBudgetOf, fittedCpuUsed } from '../../equipment'
import { MY_WEB_RANGE_M, WEB_BREAK_DIST_M, mergeResist, applyAdds, damageUpgradeMult, ammoIdFor, familyUpgradeMult, hitUpgradeMult, reloadUpgradeMult, droneReloadUpgradeMult, DRONE_SKILL, droneSkillLv } from './factors'
import { shipCategoryKeyOf } from '../../labels'
import { shipDamageEffects, shipDamageHullResistOf } from '../../shipDamage'
import { type Hp3, RESIST_FLOOR } from '../combatMath'
import { ceilFinalQuantity } from '../../quantity'
import { supportEffectPartsOf } from '../../stacking'
import { crisisEffectsOf } from '../gravekeeperGear'
import { droneLaunchGapMsOf } from '../droneLaunch'
import { playerRangeEwOf } from '../rangeEw'
import { quickRepairFactor, repairCapacityMulOf } from '../../repair'
import { shipWeaponRangeBonusesOf } from '../../ships/range'

export function createPlayerSpec(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  ammoIds?: Partial<Record<DamageType, string>> | null,
  refs?: { weaponRanges?: Array<{ baseM: number; bonusMul: number }>; legacyWeaponCount?: number },
): UnitSpec | null {
  const ship = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!ship || !fleet) return null
  const plugDefs = plugEffectsOf(state, ctx, shipId)
  const printing = plugDefs.find(p => p.dronePrinting)?.dronePrinting
  const bal = ctx.balance.battle
  const fitted = ship.civilianFittingOnly === true
    ? Object.fromEntries((['high', 'mid', 'low'] as const).map((rack) => [rack, fleet.fitted[rack].map((id) => {
      const mod = id ? ctx.modules.get(id) : undefined
      return mod && !moduleAllowedOnShip(ship, mod) ? null : id
    })])) as typeof fleet.fitted
    : fleet.fitted

  const shieldDefs = familyModules(state, ctx, shipId, 'shield')
  const armorDefs = familyModules(state, ctx, shipId, 'armor')
  const propDefs = familyModules(state, ctx, shipId, 'propulsion')
  const targetLockDefs = familyModules(state, ctx, shipId, 'target-lock')
  const turretDefs = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  const supportDefs = allFittedModules(fitted, ctx).filter((d) => d.slot === 'support')
  const droneGear = allFittedModules(fitted, ctx).filter(
    (d) => d.droneBayBonusM3 !== undefined || d.droneDmgBonus !== undefined || d.droneRangeBonusPct !== undefined,
  )
  const stealthMs =
    propDefs.length > 0 && ship.stealthIgnoresPropulsion !== true && !plugDefs.some(p => p.stealthWithPropulsion)
      ? 0
      : allFittedModules(fitted, ctx).reduce((m, d) => Math.max(m, d.stealthMs ?? 0), 0)
  const penalties = equipmentPenaltiesOf(state, ctx, shipId, fitted)
  const webCycleBaseMs = allFittedModules(fitted, ctx).reduce<number>(
    (m, d) => (d.captureWebCycleMs === undefined ? m : m === 0 ? d.captureWebCycleMs : Math.min(m, d.captureWebCycleMs)),
    0,
  )
  const webCycleMs = Math.round(webCycleBaseMs * penalties.reload)
  const webDefs = allFittedModules(fitted, ctx).filter((d) => d.captureWebCycleMs !== undefined)
  const webRangeM = webDefs.reduce((m, d) => Math.max(m, d.captureWebRangeM ?? MY_WEB_RANGE_M), MY_WEB_RANGE_M)
  const webBreakM = webDefs.reduce((m, d) => Math.max(m, d.captureWebBreakM ?? WEB_BREAK_DIST_M), WEB_BREAK_DIST_M)
  const webSlowMul = webDefs.reduce((m, d) => Math.min(m, d.captureWebSlowMul ?? 0.5), 0.5)

  let shieldHpMult = 1
  for (const m of shieldDefs) shieldHpMult += m.shieldHpBonus ?? 0
  let armorHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) armorHpMult += m.armorHpBonus ?? 0
  let hullHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) hullHpMult += m.hullHpBonus ?? 0
  const tierOpsLv = (tier: number, id: string): number => (ship.tier === tier ? Math.min(5, state.skills.trained[id] ?? 0) : 0)
  const frigateOpsLv = tierOpsLv(1, 'frigate-ops')
  const destroyerOpsLv = tierOpsLv(2, 'destroyer-ops')
  const cruiserOpsLv = tierOpsLv(3, 'cruiser-ops')
  const battleshipOpsLv = tierOpsLv(4, 'battleship-ops')
  const shOpLv = Math.min(5, state.skills.trained['shield-operation'] ?? 0)
  const hullLv = Math.min(5, state.skills.trained['hull-upgrades'] ?? 0)
  const armoredOpsLv = shipCategoryKeyOf(ship) === 'armored' ? Math.min(5, state.skills.trained['armored-ops'] ?? 0) : 0
  const hullSkillMult =
    (1 + 0.04 * hullLv) * (1 + 0.04 * armoredOpsLv) * (1 + 0.03 * battleshipOpsLv)
  const management = plugDefs.find(p => p.damageManagement)?.damageManagement
  const damage = shipDamageEffects(fleet.damagePlugs, management)
  const plugHpAdd = {
    s: plugDefs.reduce((n, p) => n + (p.shieldHpAdd ?? 0), 0),
    a: plugDefs.reduce((n, p) => n + (p.armorHpAdd ?? 0), 0),
    h: plugDefs.reduce((n, p) => n + (p.hullHpAdd ?? 0), 0),
  }
  const plugSpeedMps = plugDefs.reduce((n, p) => n + (p.speedAddMps ?? 0) - (p.speedPenaltyMps ?? 0), 0)
  const baseHp = {
    s: (ship.shieldHp ?? 0) + plugHpAdd.s,
    a: (ship.armorHp ?? 0) + plugHpAdd.a,
    h: (ship.hullHp ?? 0) + plugHpAdd.h,
  }
  const hp: Hp3 = {
    s: ceilFinalQuantity(baseHp.s * Math.max(1, shieldHpMult) * (1 + 0.04 * shOpLv) * (1 + 0.03 * battleshipOpsLv) * damage.shield),
    a: ceilFinalQuantity(baseHp.a * Math.max(1, armorHpMult) * hullSkillMult * damage.armor),
    h: ceilFinalQuantity(baseHp.h * Math.max(1, hullHpMult) * hullSkillMult * damage.hull),
  }
  const coatingPct = Math.max(0, ...plugDefs.map(p => p.shieldArmorConversionPct ?? 0))
  let shieldArmorHp = coatingPct > 0 ? ceilFinalQuantity(hp.s * coatingPct) : 0
  if (coatingPct > 0) {
    hp.a += shieldArmorHp
    const retained = Math.max(0, ...plugDefs.map(p => p.shieldCapacityRetainedPct ?? 0))
    hp.s = ceilFinalQuantity(hp.s * Math.min(1, retained))
  }
  const armorCapacityMul = plugDefs.reduce((mul, p) => mul * (1 - (p.armorCapacityPenaltyPct ?? 0)), 1)
  hp.a = ceilFinalQuantity(hp.a * armorCapacityMul)
  shieldArmorHp = ceilFinalQuantity(shieldArmorHp * armorCapacityMul)
  hp.h = ceilFinalQuantity(hp.h * (1 + plugDefs.reduce((bonus, p) => bonus + (p.hullCapacityBonusPct ?? 0), 0)))
  const shieldRes = mergeResist(ship.shieldResist, undefined)
  for (const m of shieldDefs) applyAdds(shieldRes, m.shieldResistAdd)
  const armorRes = mergeResist(ship.armorResist, undefined)
  for (const m of armorDefs) applyAdds(armorRes, m.armorResistAdd)
  const tune = (res: DamageResists, lv: number): void => {
    if (lv <= 0) return
    const f = 1 - 0.02 * lv
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const v = res[t] ?? 0
      res[t] = Math.min(0.9, Math.max(0, 1 - (1 - v) * f))
    }
  }
  tune(shieldRes, Math.min(5, state.skills.trained['shield-tuning'] ?? 0))
  tune(armorRes, Math.min(5, state.skills.trained['armor-tuning'] ?? 0))
  const hullRes = mergeResist(ship.hullResist, undefined)
  for (const m of allFittedModules(fitted, ctx)) if (m.hullResistAdd) applyAdds(hullRes, m.hullResistAdd)
  const tierResistLv = Math.max(cruiserOpsLv, battleshipOpsLv)
  if (tierResistLv > 0) {
    const f = 1 + 0.02 * tierResistLv
    for (const layer of [shieldRes, armorRes, hullRes]) {
      for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
        const v = layer[t]
        if (v !== undefined) layer[t] = Math.min(0.9, Math.max(0, v * f))
      }
    }
  }
  const resists = { shield: shieldRes, armor: armorRes, hull: hullRes }
  const dcDevice = allFittedModules(fitted, ctx).find((m) => m.hullSaveKit !== undefined)
  const dcKit = dcDevice?.hullSaveKit

  const dmgBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  const hitEqs: number[] = []
  const evadeGaps: number[] = []
  for (const m of supportDefs) {
    if (m.hitBonusPct !== undefined) hitEqs.push(m.hitBonusPct)
  }
  for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
    dmgBonus[type] = supportEffectPartsOf(supportDefs, `damage:${type}`).reduce((sum, part) => sum + part.value * part.weight, 0)
  }
  let rofCut = supportEffectPartsOf(supportDefs, 'reload').reduce((sum, part) => sum + part.value * part.weight, 0)
  for (const mod of supportDefs) if (mod.speedBonusPct !== undefined) rofCut += mod.reloadCutPct ?? 0
  for (const m of allFittedModules(fitted, ctx)) if (m.evasionGapPct !== undefined) evadeGaps.push(m.evasionGapPct)
  const hitEq = curveMult(hitEqs)
  const evLv = Math.min(5, state.skills.trained[bal.evasionSkillId] ?? 0)
  if (evLv > 0) evadeGaps.push(bal.evasionPerLevel * evLv)
  const evasion = gapCombine(evadeGaps, Math.min(0.9, (ship.evasion ?? 0.12) + 0.02 * frigateOpsLv))
  const reloadDiv = 1 + Math.min(0.9, rofCut)
  const allDefs = allFittedModules(fitted, ctx)
  const crisisOverload = crisisEffectsOf(allDefs)
  let plugDmg = 0
  let plugHitMul = 1
  let plugRangeBonus = 0
  let plugTargetWeight = 1
  for (const p of plugDefs) {
    plugDmg += p.damageBonusPct ?? 0
    if (p.hitBonusPct !== undefined) plugHitMul *= 1 + p.hitBonusPct
    if (p.targetWeightMul !== undefined) plugTargetWeight *= p.targetWeightMul
    plugRangeBonus += p.plugRangeBonusPct ?? 0
  }
  const resistPen = penalties.resist
  const rangeBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
    rangeBonus[type] = supportEffectPartsOf(allDefs, `range:${type}`).reduce((sum, part) => sum + part.value * part.weight, 0)
    for (const m of allDefs) if (m.slot !== 'support') rangeBonus[type] += m.rangeTypeBonusPct?.[type] ?? 0
  }
  for (const [rt, v] of Object.entries(shipWeaponRangeBonusesOf(ship))) rangeBonus[rt as DamageType] += v ?? 0
  const rangeBase = (base: number): number => Math.max(500, Math.round(base * Math.max(.1, penalties.range)))
  const plugRangeBonusTotal = plugRangeBonus
  if (plugRangeBonusTotal > 0) {
    rangeBonus.kinetic += plugRangeBonusTotal
    rangeBonus.explosive += plugRangeBonusTotal
    rangeBonus.plasma += plugRangeBonusTotal
  }
  const rangeOf = (base: number, type: DamageType): number =>
    Math.max(500, Math.round(rangeBase(base) * (1 + rangeBonus[type])))
  const dmgFlat = allDefs.reduce((s, m) => s + (m.damageBonusPct ?? 0), 0) + plugDmg
  if (resistPen > 0) {
    for (const layer of ['shield', 'armor', 'hull'] as const) {
      for (const rt of ['kinetic', 'explosive', 'plasma'] as const) {
        resists[layer][rt] = Math.max(RESIST_FLOOR, (resists[layer][rt] ?? 0) - resistPen)
      }
    }
  }
  const damageHullResist = shipDamageHullResistOf(fleet.damagePlugs, management)
  if (damageHullResist > 0) {
    for (const type of ['kinetic', 'plasma'] as const) hullRes[type] = Math.min(0.9, (hullRes[type] ?? 0) + damageHullResist)
  }

  const speedBonusModules = allFittedModules(fitted, ctx)
    .filter((m) => (m.speedBonusPct ?? 0) > 0)
    .map(({ slot, speedBonusPct, speedRamp }) => ({ slot, speedBonusPct, speedRamp }))
  const thrusterBoost = weightedSum(speedBonusModules.filter(mod => mod.slot === 'propulsion').map(mod => mod.speedBonusPct ?? 0))
  const propCycle = propDefs
    .map((p) => ({
      boostMs: p.thrusterBoostMs ?? bal.thrusterBoostMs,
      cooldownMs: p.thrusterCooldownMs ?? bal.thrusterCooldownMs,
    }))
    .sort((a, b) => a.boostMs - b.boostMs || a.cooldownMs - b.cooldownMs)[0]
  const cycleOverridden =
    propCycle !== undefined &&
    (propCycle.boostMs !== bal.thrusterBoostMs || propCycle.cooldownMs !== bal.thrusterCooldownMs)
  const lockEq = curveMult(targetLockDefs.map((m) => m.lockDmgBonus ?? 0))

  const weapons: WeaponSpec[] = []
  const gunneryLv = state.skills.trained[ctx.balance.combat.gunnerySkillId] ?? 0
  const dmgUpgradeMult = damageUpgradeMult(state)
  const arOpsLv = shipCategoryKeyOf(ship) === 'armed' ? Math.min(5, state.skills.trained['armed-ops'] ?? 0) : 0
  const dmgScale =
    (1 + bal.gunneryDmgPerLevel * gunneryLv) *
    (1 + (ship.powerBonus ?? 0)) *
    (1 + 0.03 * arOpsLv) *
    (1 + 0.05 * destroyerOpsLv) *
    (1 + 0.03 * cruiserOpsLv) *
    dmgUpgradeMult

  if (!fitted.high.some(id => id && ctx.modules.has(id))) {
    refs?.weaponRanges?.push({ baseM: 2500, bonusMul: 1 })
    weapons.push({
      label: '基础舰炮',
      kind: 'fixed',
      src: 'base',
      fixedType: 'kinetic',
      shotDmg: ceilFinalQuantity(8 * dmgScale),
      maxRangeM: 2500,
      minRangeM: 0,
      hitRate: 0.5,
      falloff: 0.3,
      reloadMs: Math.round(3500 * penalties.reload),
    })
  }
  const gunGroups = new Map<string, ModuleDef[]>()
  for (const t of turretDefs) {
    if (t.maxRangeM === undefined || t.reloadMs === undefined) continue
    const g = gunGroups.get(t.id)
    if (g) g.push(t)
    else gunGroups.set(t.id, [t])
  }
  for (const group of gunGroups.values()) {
    const turret = group[0]!
    if (turret.maxRangeM === undefined || turret.reloadMs === undefined) continue
    const count = group.length
    const type = turret.damageType ?? 'kinetic'
    const mult = (turret.dmgMult ?? 1) * (turret.shots ?? 1)
    const ammoDef = ctx.items.get(ammoIdFor(state, ctx, shipId, type, ammoIds))
    const famKey = turret.slot === 'missile' || turret.slot === 'laser' || turret.slot === 'turret' ? turret.slot : null
    const famLv =
      famKey !== null ? Math.min(5, state.skills.trained[ctx.balance.battle.familySkillIds[famKey]] ?? 0) : 0
    let famMult = famLv > 0 ? 1 + ctx.balance.battle.familySkillPerLevel * famLv : 1
    if (turret.slot === 'laser') {
      const engLv = Math.min(5, state.skills.trained['energy-management'] ?? 0)
      if (engLv > 0) famMult *= 1 + 0.03 * engLv
    }
    famMult *= familyUpgradeMult(state, famKey)
    const shipFam = ship.weaponFamilyBonus?.[type] ?? 0
    const perShot = ceilFinalQuantity(
      (ammoDef?.dmg ?? 0) * mult * dmgScale * famMult * (1 + dmgBonus[type]) * (1 + shipFam) * (1 + dmgFlat),
    )
    const fireLv = Math.min(5, state.skills.trained['fire-control'] ?? 0)
    let fireMult = fireLv > 0 ? 1 + 0.03 * fireLv : 1
    fireMult *= hitUpgradeMult(state)
    const targetMult = 1 + bal.hitPerLevel * Math.min(5, state.skills.trained[bal.hitSkillId] ?? 0)
    const reload = Math.max(
      100,
      Math.round(
        (turret.reloadMs / reloadDiv) *
          (1 - 0.04 * Math.min(5, state.skills.trained['reload-drills'] ?? 0)) *
          reloadUpgradeMult(state) *
          penalties.reload,
      ),
    )
    if (turret.slot === 'laser') {
      refs?.weaponRanges?.push({ baseM: rangeBase(turret.maxRangeM), bonusMul: 1 + rangeBonus['plasma'] })
      weapons.push({
        label: count > 1 ? `${turret.name}×${count}` : turret.name,
        moduleId: turret.id,
        kind: 'beam',
        src: 'laser',
        fixedType: 'plasma',
        count,
        shotDmg: perShot * count,
        maxRangeM: rangeOf(turret.maxRangeM, 'plasma'),
        minRangeM: turret.minRangeM ?? 0,
        hitRate: 1,
        falloff: laserFalloffOf(turret.falloff ?? 0.3, allFittedModules(fitted, ctx)),
        reloadMs: reload,
        ...(turret.acidOnHit ? { acidOnHit: turret.acidOnHit } : {}),
        ...(turret.overlayDrive !== undefined ? { overlayDrive: {
          stepMs: turret.overlayDrive.stepMs * penalties.reload,
          floorMs: Math.round(turret.overlayDrive.floorMs * penalties.reload),
        } } : {}),
        ...(turret.burst !== undefined ? { burst: turret.burst } : {}),
        ...(turret.antiDrone !== undefined
          ? { canHitDrones: true, antiDroneMul: turret.antiDrone }
          : {}),
      })
      continue
    }
    const shotsByType: Partial<Record<DamageType, number>> = {}
    shotsByType[type] = perShot * count
    refs?.weaponRanges?.push({ baseM: rangeBase(turret.maxRangeM), bonusMul: 1 + rangeBonus[type] })
    weapons.push({
      label: count > 1 ? `${turret.name}×${count}` : turret.name,
      moduleId: turret.id,
      kind: 'gun',
      ...(turret.railCharge ? { railCharge: turret.railCharge } : {}),
      src: turret.slot === 'missile' ? 'missile' : 'turret',
      shotsByType,
      count,
      ...(turret.acidOnHit ? { acidOnHit: turret.acidOnHit, blindDmgMul: turret.blindDmgMul } : {}),
      eqHitMul: (hitEq * plugHitMul) > 1 ? hitEq * plugHitMul : undefined,
      maxRangeM: rangeOf(turret.maxRangeM, type),
      minRangeM: turret.minRangeM ?? 0,
      hitRate: (turret.hitRate ?? 0.5) * fireMult * targetMult,
      ...(turret.secondaryDamagePct !== undefined && turret.secondaryDamagePct > 0
        ? {
            secondaryDamagePct: turret.secondaryDamagePct,
            secondaryDamageType: turret.secondaryDamageType ?? 'kinetic',
          }
        : {}),
      ...(turret.ammoPerShot !== undefined && turret.ammoPerShot > 0 ? { ammoPerShot: turret.ammoPerShot } : {}),
      ...(turret.hitsAllFoes === true ? { allFoes: true } : {}),
      falloff: turret.falloff ?? 0.3,
      reloadMs: reload,
      ...(turret.antiDrone !== undefined
        ? { canHitDrones: true, antiDroneMul: turret.antiDrone }
        : {}),
    })
  }

  const bayLimit = droneBayTotalM3(ship, fitted, ctx, fleet.plugs)
  let droneDmgBonus = 0
  const droneRangePcts: number[] = []
  for (const g of droneGear) {
    droneDmgBonus += g.droneDmgBonus ?? 0
    if ((g.droneRangeBonusPct ?? 0) > 0) droneRangePcts.push(g.droneRangeBonusPct!)
  }
  const droneRangeMult = 1 + weightedSum(droneRangePcts) + Math.max(0, plugRangeBonus)
  const droneDamageMult =
    (1 + droneDmgBonus) *
    (1 + (ship.droneDmgBonus ?? 0)) *
    (1 + DRONE_SKILL.warfarePerLevel * droneSkillLv(state, 'drone-warfare')) *
    (1 + DRONE_SKILL.strikePerLevel * droneSkillLv(state, 'drone-strike'))

  let bayUsed = 0
  let cpuLeft = cpuBudgetOf(state, ctx, shipId) - fittedCpuUsed(fitted, ctx, ship)
  const droneLoad = ship.civilianFittingOnly === true ? {} : fleet.droneLoad ?? {}
  const droneReloadOf = (def: { reloadMs?: number }): number =>
    Math.round(
      (def.reloadMs ?? 4400) *
        (1 - 0.04 * Math.min(5, state.skills.trained['drone-servicing'] ?? 0)) *
        droneReloadUpgradeMult(state) *
        penalties.reload,
    )
  if (bayLimit > 0 && cpuLeft > 0) {
    for (const [droneId, want] of Object.entries(droneLoad)) {
      if (!want || want <= 0) continue
      const def = ctx.items.get(droneId)
      if (!def || def.kind !== 'drone') continue
      const perCpu = def.cpuUse ?? 0
      const perM3 = def.unitM3 ?? 0
      if (perCpu <= 0 || perM3 <= 0) continue
      const byCpu = Math.floor(cpuLeft / perCpu)
      const byBay = Math.floor((bayLimit - bayUsed) / perM3)
      const n = Math.max(0, Math.min(want, byCpu, byBay))
      if (n <= 0) continue
      bayUsed += perM3 * n
      cpuLeft -= perCpu * n
      if (def.repairDrone === true) {
        const skill = quickRepairFactor(state, ctx)
        const output = skill * (1 + Math.max(0, ship.repairOutputBonusPct ?? 0))
        for (let i = 0; i < n; i++) {
          refs?.weaponRanges?.push({ baseM: 0, bonusMul: 1 })
          weapons.push({ label: def.name, kind: 'fixed', src: 'drone', artId: droneId,
            repairDrone: { armor: (def.repairArmorHp ?? 0) * output, hull: (def.repairHullHp ?? 0) * output, kitId: def.repairKit ?? 'repairkit-mil' },
            shotDmg: 0, maxRangeM: 0, minRangeM: 0, hitRate: 0, falloff: 1,
            reloadMs: Math.max(1, Math.round((def.repairIntervalMs ?? 10000) * penalties.reload)) })
        }
        continue
      }
      const shot = ceilFinalQuantity((def.dmg ?? 0) * 2 * droneDamageMult)
      for (let i = 0; i < n; i++) {
        refs?.weaponRanges?.push({ baseM: def.maxRangeM ?? 2600, bonusMul: droneRangeMult })
        weapons.push({
          label: def.name,
          kind: 'fixed',
          src: 'drone',
          artId: droneId,
          fixedType: def.damageType ?? 'kinetic',
          shotDmg: printing ? ceilFinalQuantity(shot * printing.damageMul) : shot,
          maxRangeM: Math.round((def.maxRangeM ?? 2600) * droneRangeMult),
          minRangeM: 200,
          hitRate: def.hitRate ?? 0.6,
          falloff: def.falloff ?? 0.35,
          reloadMs: droneReloadOf(def),
        })
      }
    }
  }

  const charged = plugDefs.find(p => p.chargedWeapons)?.chargedWeapons
  if (charged) {
    for (const weapon of weapons) {
      if (weapon.src !== 'laser' && !((weapon.src === 'turret' || weapon.src === 'missile') && weapon.shotsByType?.kinetic !== undefined)) continue
      weapon.reloadMs = Math.max(1, Math.round(weapon.reloadMs * charged.reloadMul))
      if (weapon.shotDmg !== undefined) weapon.shotDmg = ceilFinalQuantity(weapon.shotDmg * charged.damageMul)
      if (weapon.shotsByType) for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
        const shot = weapon.shotsByType[type]
        if (shot !== undefined) weapon.shotsByType[type] = ceilFinalQuantity(shot * charged.damageMul)
      }
      weapon.falloff = 1 - (1 - weapon.falloff) * (1 - charged.falloffReductionPct)
      if (weapon.overlayDrive) weapon.overlayDrive = {
        stepMs: weapon.overlayDrive.stepMs * charged.reloadMul,
        floorMs: Math.round(weapon.overlayDrive.floorMs * charged.reloadMul),
      }
      if (weapon.burst) weapon.burst = { ...weapon.burst, gapMs: Math.round(weapon.burst.gapMs * charged.reloadMul) }
    }
  }
  if (damage.range !== 1) {
    for (const weapon of weapons) weapon.maxRangeM = Math.round(weapon.maxRangeM * damage.range)
    for (const range of refs?.weaponRanges ?? []) range.baseM *= damage.range
  }
  if (!weapons.some(w => w.src === 'base') && refs?.legacyWeaponCount === weapons.length + 1) {
    weapons.unshift({ label: '', src: 'base', kind: 'fixed', disabled: true,
      shotDmg: 0, minRangeM: 0, maxRangeM: 0, hitRate: 0, falloff: 1, reloadMs: 1 })
    refs.weaponRanges?.unshift({ baseM: 0, bonusMul: 1 })
  }
  return {
    tag: 'player',
    rangeEwStrength: playerRangeEwOf(state, ctx, [shipId])[0]?.total ?? 0,
    name: ship.name,
    side: 'me',
    shipTier: ship.tier,
    shipRole: ship.role,
    ...(plugTargetWeight !== 1 ? { targetWeightMul: plugTargetWeight } : {}),
    ...(ship.repairOutputBonusPct !== undefined ? { repairOutputBonusPct: ship.repairOutputBonusPct } : {}),
    ...(ship.interceptorImmuneToWeb === true ? { interceptorImmuneToWeb: true } : {}),
    shipId,
    ...(dcKit !== undefined ? { hullSaveKit: dcKit } : {}),
    ...(dcDevice?.rebirthRepair ? { rebirthRepair: dcDevice.rebirthRepair } : {}),
    ...(crisisOverload ? { crisisOverload } : {}),
    hp,
    repairCapacityMul: repairCapacityMulOf(hp, ship),
    ...(plugDefs.some(p => (p.armorRegenPerSec ?? 0) > 0)
      ? { armorRegenPerSec: plugDefs.reduce((rate, p) => rate + (p.armorRegenPerSec ?? 0), 0) } : {}),
    ...(coatingPct > 0 ? { shieldArmorHp } : {}),
    ...(plugDefs.some(p => (p.shieldPassiveBonusPct ?? 0) > 0)
      ? { shieldPassiveBonusPct: plugDefs.reduce((n, p) => n + (p.shieldPassiveBonusPct ?? 0), 0) } : {}),
    ...(printing ? { droneHpMul: printing.hpMul } : {}),
    resists,
    droneDamageBonusPct: droneDamageMult - 1,
    ...(plugDefs.some(p => p.droneCommand) ? { droneCommand: plugDefs.find(p => p.droneCommand)!.droneCommand } : {}),
    droneHullBonusPct: allDefs.reduce((s, m) => s + (m.droneHullHpBonusPct ?? 0), 0),
    droneShieldBonusPct: allDefs.reduce((s, m) => s + (m.droneShieldHpBonusPct ?? 0), 0),
    ...(allDefs.some((m) => (m.droneHitGapPct ?? 0) > 0)
      ? { droneHitGapPct: allDefs.reduce((s, m) => s + (m.droneHitGapPct ?? 0), 0) }
      : {}),
    evasion,
    hitBonus: (ship.hitBonus ?? 0) + 0.02 * destroyerOpsLv,
    hitMul: penalties.hit,
    signatureM: ship.signatureM ?? 80,
    scanResMm: ship.scanResMm ?? 500,
    speedMps:
      ((ship.maxSpeedMps ?? 200) + plugSpeedMps) *
      (1 + bal.speedPerLevel * Math.min(5, state.skills.trained[bal.speedSkillId] ?? 0)) *
      Math.max(0.1, penalties.speed) * damage.speed,
    ...(thrusterBoost > 0 ? { thrusterBoost } : {}),
    ...(speedBonusModules.some(mod => mod.slot !== 'propulsion' || mod.speedRamp) ? { speedBonusModules } : {}),
    ...(cycleOverridden ? { thrusterBoostMs: propCycle!.boostMs, thrusterCooldownMs: propCycle!.cooldownMs } : {}),
    ...(() => {
      const blinks = allFittedModules(fitted, ctx).filter((m) => m.blink !== undefined)
      if (blinks.length === 0) return {}
      const pick = [...blinks].sort(
        (a, b) => b.blink!.distanceM - a.blink!.distanceM || a.blink!.cooldownMs - b.blink!.cooldownMs,
      )[0]!
      return { meBlink: { ...pick.blink! } }
    })(),
    agility: ship.agility,
    weapons,
    droneLaunchGapMs: Math.max(10, Math.round(droneLaunchGapMsOf(allFittedModules(fitted, ctx), ship.droneLaunchCutPct) * (printing?.launchMul ?? 1))),
    droneReviveGapMs: droneLaunchGapMsOf(allFittedModules(fitted, ctx), 0, true),
    ...(lockEq > 1 ? { lockedDmgBonus: lockEq - 1, lockOwnDmgBonus: lockEq - 1,
      lockTargetChance: Math.max(...targetLockDefs.map(m => m.lockTargetChance ?? 1)),
      lockOwnTargetChance: Math.max(...targetLockDefs.map(m => m.lockTargetChance ?? 1)),
    } : {}),
    ...(stealthMs > 0 ? { stealthMs } : {}),
    ...(webCycleMs > 0
      ? { myCaptureWeb: { cycleMs: webCycleMs, rangeM: webRangeM, breakM: webBreakM, slowMul: webSlowMul } }
      : {}),
    foeTactic: null,
  }
}
