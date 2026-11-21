import type { FoeShipSlot, FoeShipDef, BattleBalance, AnomalyDef, DamageType, FoeReinforceTrigger } from '../../types'
import { ceilFinalQuantity } from '../../quantity'
import { clamp, type Hp3 } from '../combatMath'
import type { FoeSpecOpts } from './catalog'
import type { UnitSpec, WeaponSpec } from '../model'
import { shipWaveIndexOf, enumerateShipUnits, foeUnitNameOf } from '../foeCard'
import { foeMultiShipCompMul, foeJudgedThreatOf, foeFamilyHpMulOf, foeShipHpMulOf } from '../foePower'
import { resolveFoeMounts } from '../foeMounts'
import { pickTopType, splitShotByComposition, compositionOfMix, WORMHOLE_THREAT_BASE } from '../../wormholeFoes'

export function droneFireSplitOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
): Array<{ gun: number; drones: number[] } | null> {
  const out: Array<{ gun: number; drones: number[] } | null> = units.map(() => null)
  const groups = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = groups.get(slot)
    if (list) list.push(i)
    else groups.set(slot, [i])
  }
  for (const [slot, idxs] of groups) {
    const share = slot.droneFireShare ?? slot.ship.droneFireShare
    if (share === undefined) continue
    const droneSlots = slot.ship.drones ?? []
    const perUnitDrones = droneSlots.reduce((n, ds) => n + Math.max(0, Math.round(ds.count)), 0)
    if (perUnitDrones === 0) continue
    const unitCount = idxs.length
    const nDrones = unitCount * perUnitDrones
    const mul = slot.dmgMul ?? 1
    const gunOld = Math.max(1, ceilFinalQuantity(slot.ship.shotDmg * mul * comp))
    const droneOld = droneSlots.flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () =>
        Math.max(1, ceilFinalQuantity(ds.drone.dmg * mul)),
      ),
    )
    const droneOldSum = droneOld.reduce((a, b) => a + b, 0)
    const T =
      slot.firepowerAnchor !== undefined && slot.firepowerAnchor > 0
        ? Math.max(nDrones + unitCount, Math.round(slot.firepowerAnchor))
        : unitCount * (gunOld + droneOldSum)
    const D = Math.max(nDrones, Math.min(Math.round(T * clamp(0, 1, share)), Math.max(nDrones, T - unitCount)))
    const G = T - D
    const dBase = Math.floor(D / nDrones)
    let dRem = D - dBase * nDrones
    const gBase = Math.floor(G / unitCount)
    let gRem = G - gBase * unitCount
    for (const i of idxs) {
      const drones: number[] = []
      for (let k = 0; k < perUnitDrones; k++) {
        drones.push(dBase + (dRem > 0 ? 1 : 0))
        if (dRem > 0) dRem -= 1
      }
      out[i] = { gun: gBase + (gRem > 0 ? 1 : 0), drones }
      if (gRem > 0) gRem -= 1
    }
  }
  return out
}

export function foeHullDpsOf(ship: FoeShipDef, dmgMul: number, comp: number): number {
  const per = Math.max(1, ceilFinalQuantity(ship.shotDmg * dmgMul * comp))
  return (per * 1000) / Math.max(1, ship.reloadMs)
}

export function foeDpsCapScaleOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
  bal: BattleBalance,
  splitIdx: ReadonlyArray<{ gun: number; drones: number[] } | null>,
): Map<FoeShipSlot, number> {
  const out = new Map<FoeShipSlot, number>()
  const cap = bal.foeDpsCap
  const discount = bal.foeDpsOverCapDiscount ?? 0
  if (cap === undefined || !(cap > 0) || !(discount > 0)) return out
  const seen = new Set<FoeShipSlot>()
  const bySlot = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = bySlot.get(slot)
    if (list) list.push(i)
    else bySlot.set(slot, [i])
  }
  let total = 0
  for (const [slot, idxs] of bySlot) {
    if (idxs.some((i) => splitIdx[i] !== null)) continue
    seen.add(slot)
    total += idxs.length * foeHullDpsOf(slot.ship, slot.dmgMul ?? 1, comp)
  }
  if (total <= cap) return out
  const target = cap + (total - cap) * (1 - Math.min(1, discount))
  const scale = target / total
  for (const slot of seen) out.set(slot, scale)
  return out
}

export function createFoeSpecsFromShips(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts): UnitSpec[] {
  const prefix = opts.tagPrefix ?? ''
  const waveIdx = shipWaveIndexOf(prefix)
  const comp = foeMultiShipCompMul(anomaly)
  const units = enumerateShipUnits(anomaly, waveIdx)
  const threatNow = foeJudgedThreatOf(anomaly)
  const fireSplit = droneFireSplitOf(units, comp)
  const dpsCapScale = foeDpsCapScaleOf(units, comp, bal, fireSplit)
  return units.map((u, ui) => {
    const sp = fireSplit[ui]
    const ship = u.slot.ship
    const mount = resolveFoeMounts(u.slot.mounts ?? ship.mounts)
    const mix = u.slot.dmgMix ?? ship.dmgMix
    const type = pickTopType(mix)
    const totalHp = ship.hp * (u.slot.hpMul ?? 1)
    const split = u.slot.split ?? ship.split
    const hpMul = opts.beforeHpUplift ? foeFamilyHpMulOf(ship.family) : foeShipHpMulOf(ship.family)
    const hpValue = opts.beforeHpUplift ? (value: number) => value : ceilFinalQuantity
    const hp: Hp3 = u.slot.hpOverride ? { ...u.slot.hpOverride } : {
      s: hpValue(totalHp * split.s * hpMul),
      a: hpValue(totalHp * split.a * hpMul * (mount.foeMausoleumArmor?.hpMul ?? 1)),
      h: hpValue(totalHp * split.h * hpMul * (mount.foeMausoleumArmor?.hpMul ?? 1)),
    }
    const rawShotDmg = sp
      ? sp.gun
      : Math.max(1, ceilFinalQuantity(ship.shotDmg * (u.slot.dmgMul ?? 1) * comp * (dpsCapScale.get(u.slot) ?? 1)))
    const shotDmg = ship.acidBurst ? 0 : mount.broodControl ? Math.max(1, ceilFinalQuantity(rawShotDmg * mount.broodControl.gunDmgMul)) : rawShotDmg
    const shotSplit = splitShotByComposition(shotDmg, compositionOfMix(mix))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    const rangeMul = u.slot.rangeMul ?? 1
    const rangeMax = Math.max(2, u.slot.rangeMaxM ?? Math.round(ship.rangeMaxM * rangeMul))
    const rangeMin = Math.max(1, Math.min(rangeMax - 1, u.slot.rangeMinM ?? Math.round(ship.rangeMinM * rangeMul)))
    const tactic = u.slot.tactic ?? ship.tactic
    const energyForm = (u.slot.energyForm ?? ship.energyForm) === 'spit' ? ('spit' as const) : ('beam' as const)
    const isBeam = type === 'plasma' && energyForm === 'beam'
    const reinforceAt =
      bal.foeReinforceEnabled === true
        ? normReinforceTrigger(u.slot.enterAt)
        : null
    const name = foeUnitNameOf(anomaly, u.tag);
    let dIdx = 0
    const droneWeapons: WeaponSpec[] = (ship.drones ?? []).flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () => ({
        label: `${ds.drone.name} ×1`,
        kind: 'fixed' as const,
        src: 'drone' as const,
        artId: ds.drone.id,
        fixedType: ds.drone.damageType,
        shotDmg: Math.max(1, ceilFinalQuantity((sp ? sp.drones[dIdx++]! : Math.max(1, ceilFinalQuantity(ds.drone.dmg * (u.slot.dmgMul ?? 1)))) * (mount.broodControl?.droneDmgMul ?? 1))),
        ...(mount.broodControl ? { foeDroneRangeBonusPct: mount.broodControl.droneRangeBonusPct } : {}),
        maxRangeM: Math.max(2, ds.drone.maxRangeM),
        minRangeM: 1,
        hitRate: ds.drone.hitRate,
        falloff: ds.drone.falloff,
        reloadMs: ds.drone.reloadMs,
      })),
    )
    const reserve = ship.droneReserve
    const reserveModel = (ship.drones ?? [])[0]?.drone
    if (reserve && reserveModel && reserve.count > 0) {
      for (let k = 0; k < Math.round(reserve.count); k++) {
        droneWeapons.push({
          label: `${reserveModel.name} ×1`,
          kind: 'fixed' as const,
          src: 'drone' as const,
          artId: reserveModel.id,
          reserve: true,
          fixedType: reserveModel.damageType,
          shotDmg: sp ? sp.drones[sp.drones.length - 1]! : Math.max(1, ceilFinalQuantity(reserveModel.dmg * (u.slot.dmgMul ?? 1))),
          maxRangeM: Math.max(2, reserveModel.maxRangeM),
          minRangeM: 1,
          hitRate: reserveModel.hitRate,
          falloff: reserveModel.falloff,
          reloadMs: reserveModel.reloadMs,
        })
      }
    }
    return {
      tag: u.tag,
      ...(ship.acidBurst ? { acidBurst: { ...ship.acidBurst, ...(ship.acidBurst.damage !== undefined ? { damage: ceilFinalQuantity(ship.acidBurst.damage * (u.slot.dmgMul ?? 1) * comp) } : {}), ...(mount.acidShieldDamageMul !== undefined ? { shieldDamageMul: mount.acidShieldDamageMul } : {}) } } : {}),
      ...(mount.hatchery ? { foeHatchery: { ...mount.hatchery } } : {}),
      ...(mount.fleetSpeedRamp ? { foeFleetSpeedRamp: { ...mount.fleetSpeedRamp } } : {}),
      name,
      side: 'foe' as const,
      hp,
      ...(u.slot.shieldRegenMax !== undefined ? { shieldRegenMax: u.slot.shieldRegenMax, shieldRegenCap: u.slot.shieldRegenCap } : {}),
      resists: {
        ...(ship.shieldResist || u.slot.shieldResist ? { shield: { ...(ship.shieldResist ?? {}), ...(u.slot.shieldResist ?? {}) } } : {}),
        ...(ship.armorResist || mount.foeMausoleumArmor ? { armor: { ...(ship.armorResist ?? {}), ...(mount.foeMausoleumArmor ? { kinetic: mount.foeMausoleumArmor.resistPct, explosive: mount.foeMausoleumArmor.resistPct, plasma: mount.foeMausoleumArmor.resistPct } : {}) } } : {}),
        ...(ship.hullResist || mount.foeMausoleumArmor ? { hull: { ...(ship.hullResist ?? {}), ...(mount.foeMausoleumArmor ? { kinetic: mount.foeMausoleumArmor.resistPct, explosive: mount.foeMausoleumArmor.resistPct, plasma: mount.foeMausoleumArmor.resistPct } : {}) } } : {}),
      },
      evasion: Math.min(
        0.9,
        (ship.evasion ?? 0.12) + (mount.foeEvasionBonusAdd ?? 0),
      ),
      ...(mount.foeEvasionBonusAdd !== undefined ? { foeEvasionBonusAdd: mount.foeEvasionBonusAdd } : {}),
      ...((mount.foeRangeDebuffPct ?? ship.foeRangeDebuffPct) !== undefined
        ? { foeRangeDebuffPct: mount.foeRangeDebuffPct ?? ship.foeRangeDebuffPct }
        : {}),
      rangeEwStrength: mount.rangeEwStrength ?? 0,
      rangeEwBonus: ship.rangeEwBonus ?? 0,
      rangeEwEquipmentBonusPct: ship.rangeEwEquipmentBonusPct ?? 0,
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      speedMps: Math.round(bal.hullClassBaseSpeedMps[ship.hullClassTier] * ship.speedRatio * (u.slot.speedMul ?? 1)),
      agility: 0.3,
      ...(mount.foeCanCharge === true ||
      ship.foeCanCharge === true ||
      (bal.foeChargeEnabled === true &&
        anomaly.threat >= bal.foeChargeThreatFloor &&
        tactic === 'brawl')
        ? { foeCanCharge: true }
        : {}),
      ...(() => {
        const mul = mount.foeChargeMul ?? ship.foeChargeMul
        return mul !== undefined ? { foeChargeMul: mul } : {}
      })(),
      ...(mount.foeChargeCooldownMs !== undefined ? { foeChargeCooldownMs: mount.foeChargeCooldownMs } : {}),
      ...(mount.foeChargeWebImmune === true ? { foeChargeWebImmune: true } : {}),
      ...(mount.names.length > 0 ? { foeMountNames: mount.names } : {}),
      ...(mount.namePairs.length > 0 ? { foeMountNamePairs: mount.namePairs } : {}),
      ...(mount.foeBlink !== undefined ? { foeBlink: mount.foeBlink } : {}),
      ...(mount.foeOverlayDrive !== undefined ? { foeOverlayDrive: mount.foeOverlayDrive } : {}),
      ...(mount.foeFlashOverload !== undefined ? { foeFlashOverload: mount.foeFlashOverload } : {}),
      ...(mount.foeStandbyShield !== undefined ? { foeStandbyShield: mount.foeStandbyShield } : {}),
      ...(mount.foeFocusArray !== undefined ? { foeFocusArray: mount.foeFocusArray } : {}),
      ...(mount.foeRebirthProtocol !== undefined ? { foeRebirthProtocol: mount.foeRebirthProtocol } : {}),
      ...(mount.foeMausoleumArmor !== undefined ? { foeMausoleumArmor: mount.foeMausoleumArmor } : {}),
      ...(mount.foeCoatingArmor !== undefined ? { foeCoatingArmor: mount.foeCoatingArmor } : {}),
      ...(mount.foeShieldCapacitor !== undefined ? { foeShieldCapacitor: mount.foeShieldCapacitor } : {}),
      ...(reinforceAt ? { foeReinforceAt: reinforceAt } : {}),
      ...(u.slot.enterBranch !== undefined ? { foeReinforceBranch: u.slot.enterBranch } : {}),
      ...(bal.foeReinforceEnabled === true && mount.foeSupportCall !== undefined
        ? { foeSupportCall: mount.foeSupportCall }
        : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          kind: isBeam ? ('beam' as const) : ('fixed' as const),
          fixedType: type,
          shotDmg,
          ...(ship.gunCount !== undefined ? { gunCount: ship.gunCount } : {}),
          ...(multiShots ? { shotsByType: multiShots } : {}),
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          blindDmgMul: ship.blindDmgMul ?? 0.3,
          hitRate: isBeam ? 1 : (u.slot.hitRate ?? ship.hitRate),
          falloff: u.slot.falloff ?? ship.falloff,
          reloadMs: ship.reloadMs,
          ...(ship.burst !== undefined ? { burst: ship.burst } : {}),
        },
        ...droneWeapons,
      ],
      ...(droneWeapons.length > 0 ? { foeDrones: ship.drones } : {}),
      ...(ship.droneLaunch && droneWeapons.length > 0
        ? { foeDroneLaunch: ship.droneLaunch }
        : {}),
      ...(ship.droneReserve && droneWeapons.length > 0
        ? { foeDroneReserve: ship.droneReserve }
        : {}),
      ...(() => {
        const rp = mount.foeRepairPulse
        if (rp === undefined) return {}
        return {
          foeRepairPulse: { ...rp, k: Math.max(1, threatNow / FOE_REPAIR_THREAT_REF) },
        }
      })(),
      ...(mount.foeReviveEscort !== undefined ? { foeReviveEscort: mount.foeReviveEscort } : {}),
      ...(mount.foeSummonEscort !== undefined ? { foeSummonEscort: mount.foeSummonEscort } : {}),
      ...((mount.foeDroneRangeMulOnHit ?? ship.droneRangeMulOnHit) !== undefined && droneWeapons.length > 0
        ? { foeDroneRangeMulOnHit: mount.foeDroneRangeMulOnHit ?? ship.droneRangeMulOnHit }
        : {}),
      ...((mount.foeGunRangeMulOnHit ?? ship.gunRangeMulOnHit) !== undefined
        ? { foeGunRangeMulOnHit: mount.foeGunRangeMulOnHit ?? ship.gunRangeMulOnHit }
        : {}),
      ...(mount.foeGunRangeNoticeId !== undefined ? { foeGunRangeNoticeId: mount.foeGunRangeNoticeId } : {}),
      ...(mount.foeCaptureWeb !== undefined ? { foeCaptureWeb: mount.foeCaptureWeb } : {}),
      hullClassTier: ship.hullClassTier,
      family: ship.family,
      foeShipId: ship.id,
      ...(ship.repairPct !== undefined ? { repairPct: ship.repairPct } : {}),
      foeTactic: tactic,
      foeRangeBand: { min: rangeMin, max: rangeMax },
      ...((u.slot.desireRangeM ?? ship.desireRangeM) !== undefined
        ? { foeDesireRangeM: u.slot.desireRangeM ?? ship.desireRangeM }
        : {}),
    }
  })
}

export function normReinforceTrigger(at?: FoeReinforceTrigger): FoeReinforceTrigger | null {
  if (!at) return null
  const out: FoeReinforceTrigger = {}
  if (typeof at.sec === 'number' && Number.isFinite(at.sec) && at.sec > 0) out.sec = at.sec
  if (typeof at.afterKills === 'number' && Number.isFinite(at.afterKills) && at.afterKills > 0) {
    out.afterKills = Math.floor(at.afterKills)
  }
  if (typeof at.hpBelow === 'number' && at.hpBelow >= 0 && at.hpBelow <= 1) out.hpBelow = at.hpBelow
  return Object.keys(out).length > 0 ? out : null
}

/**
 * **挂载件「船体修理装置」的威胁归一基准**（船长 2026-09-24 追问裁定的原话口径「**k = 该层威胁 ÷ 45**」）
 * ——45 = 第 1 层基准威胁（`wormholeFoes.WORMHOLE_THREAT_BASE`）⇒ **层 1 的 k = 1.00**，
 * 正是船长定这条时说的"归一基准「不改动」"。消费点只有一处：`createFoeSpecsFromShips` 写
 * `UnitSpec.foeRepairPulse.k`（详见 `FoeMountDef.repairPulse`）。
 *
 * ⚠ **这里是字面量、不从 `wormholeFoes` import**（2026-09-24 实测踩到的坑）：`wormholeFoes` 自己
 * `import { foeDamageComposition } from './combat'` ⇒ 两个模块**互相依赖**，而本常量在 `combat` 的
 * **顶层**求值 ⇒ 走 `content:check`（CJS 转译）时命中
 * `ReferenceError: Cannot access 'WORMHOLE_THREAT_BASE' before initialization`。
 * 一致性由下一行的**类型级校验**钉住（两处不等 ⇒ `typecheck` 当场红，不改数值就不会漂）。
 * （2026-10-02 批次 4l 随敌群建档簇迁到本文件；combat 借回 + 再导出）
 */
export const FOE_REPAIR_THREAT_REF = 45

export const _FOE_REPAIR_THREAT_REF_IN_SYNC: 45 extends typeof WORMHOLE_THREAT_BASE
  ? typeof WORMHOLE_THREAT_BASE extends 45
    ? true
    : never
  : never = true
