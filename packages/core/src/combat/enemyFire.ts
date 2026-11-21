import type { GameState } from '../state'
import type { UnitSpec } from './model'
import type { BattleBalance, FoeTargetingMode } from '../types'
import { isFoeEngageable } from './combatDrones'
import { triggerAcidBurst, applyAlienCorrosion, advanceFoeHatcheries } from './alienCombat'
import { pickMyUnitTarget, isAliveAnyOf } from './targeting'
import { hitChance, clamp, applyDamage, isAlive } from './combatMath'
import { nextRandom } from '../rng'
import { applyPlayerUnitDamage, applyFoeShot } from './damage'
import { pushBattleFx, pushBattleNotice } from './combatFx'
import { aloftDroneSet } from './droneWindow'
import { foeCapacitorMultiplierOf, noteFoeCapacitorAttack } from './gravekeeperCombat'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeGunPowerFactorOf } from './foeRange'
import { foeOverlayReloadOf, foeWaveStartMsOf, markMeBlink } from './blink'
import { coronaFocusFalloffOf } from './coronaFocus'
import { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
import { fireFoeCaptureWeb } from './captureWebs'
import { foeRepairDiscountedShot } from './repairFoes'
import { ceilFinalQuantity } from '../quantity'
import { releaseFoeChargeOnHit } from './movement'
import { battleMaxDistanceM } from './foes/tactics'

export function fireEnemyPhase(state: GameState, b: import('../state').BattleState, myUnits: readonly UnitSpec[], foes: UnitSpec[], me: UnitSpec, bal: BattleBalance, dtMs: number, favor: { meMul: number; foeMul: number } | null, foeBlinkHold: boolean, foeTargeting: FoeTargetingMode, foeTargetingChance: number): void {


  for (const f of foes) {
    if (f.acidBurst && isFoeEngageable(b, f.tag)) triggerAcidBurst(b, f, 'attack', b.lastTickGameMs + dtMs)
  }
  for (const f of foes) {
    const event = b.acidBursts?.[f.tag]
    const acid = f.acidBurst
    if (!acid || !event || event.resolved) continue
    event.resolved = true
    const target = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
    let hit = false
    let dealt = 0
    if (target) {
      const rt = b.units[target.tag]!
      const chance = hitChance({ hitRate: acid.hitRate ?? .95, minRangeM: 1, maxRangeM: acid.deathRangeM, falloff: 1 }, f, target, b.distanceM, bal, 1)
      hit = nextRandom(state.rng) < (favor ? clamp(0, .97, chance * favor.foeMul) : chance)
      b.stats.foeShots += 1
      if (hit) {
        b.stats.foeHits += 1
        const apply = (raw: number) => applyDamage(rt.hp, target.resists, raw, 'kinetic', acid.shieldDamageMul)
        dealt = applyPlayerUnitDamage(state, b, target.tag, target, acid.damage ?? 0, 'kinetic', raw => apply(raw).hp)
      }
    }
    pushBattleFx(b, { atMs: event.atMs, side: 'foe', tag: f.tag, ...(target ? { to: target.tag } : {}),
      type: 'kinetic', acidBurst: true, hit, ...(dealt > 0 ? { dmg: dealt } : {}) })
    b.alienCorrosion = (b.alienCorrosion ?? 0) + acid.corrosionPct
    for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion)
  }
  for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion ?? 0)
  advanceFoeHatcheries(b, foes, b.lastTickGameMs + dtMs)
  for (const f of foes) {
    const rt = b.units[f.tag]
    if (!rt || !isAlive(b, f.tag)) continue;
    const pickTarget = (): { spec: UnitSpec; rt: import('../state').BattleState['units'][string] } | null => {
      const spec = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
      if (!spec) return null
      const urt = b.units[spec.tag]
      return urt ? { spec, rt: urt } : null
    }
    const fPools = b.foeDronePools?.[f.tag]
    if (fPools && fPools.length > 0 && isAliveAnyOf(b, myUnits)) {
      for (const p of fPools) {
        if (p.inHangar !== true || p.readyAtMs === undefined) continue
        if (b.lastTickGameMs < p.readyAtMs) continue
        p.inHangar = false
        p.readyAtMs = undefined
        p.alive = true
        p.s = p.maxS ?? p.s
        p.a = p.maxA ?? p.a
        p.h = p.maxH ?? p.h
      }
      const launch = f.foeDroneLaunch
      const reloadBase = f.weapons.find((w) => w.src === 'drone')?.reloadMs ?? 4400
      const aloft = launch
        ? aloftDroneSet(fPools, launch, reloadBase, b)
        : null
      const activeCount = fPools.filter((p) => p.alive && p.inHangar !== true).length
      const kAloft = launch
        ? Math.max(1, Math.min(Math.round(launch.maxAloft), Math.max(1, activeCount)))
        : 0
      const aloftReload = (base: number): number =>
        launch && launch.keepDps === true && kAloft > 0 && activeCount > 0
          ? Math.max(200, Math.round((base * kAloft) / activeCount))
          : base
      let di = 0
      for (let k = 0; k < f.weapons.length; k++) {
        const dw = f.weapons[k]!
        if (dw.src !== 'drone') continue
        const pool = fPools[di]
        const idx = di
        di += 1
        if (!pool || !pool.alive) continue;
        if (pool.inHangar === true) continue;
        if (aloft && !aloft.has(idx)) continue;
        const dcd = rt.weapons[k] ?? 0
        if (dcd > 0) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        if (foeBlinkHold) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        rt.weapons[k] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(aloftReload(dw.reloadMs) * foeCapacitorMultiplierOf(b, f, k, 'reloadMul')))
        if (b.distanceM > foeDroneRangeOf(b, dw, f)) continue
        const dtgt = pickTarget()
        if (!dtgt) break
        b.stats.foeShots += 1;
        b.droneHitAt = { ...(b.droneHitAt ?? {}), me: b.lastTickGameMs }
        const dType = dw.fixedType ?? 'kinetic';
        const droneHit = hitChance(dw, f, dtgt.spec, b.distanceM, bal)
        const droneHitEff = favor
          ? clamp(0, 0.97, droneHit * favor.foeMul)
          : droneHit
        const dHit = nextRandom(state.rng) < droneHitEff
        let dDealt = 0
        if (dHit) {
          b.stats.foeHits += 1
          dDealt = applyPlayerUnitDamage(state, b, dtgt.spec.tag, dtgt.spec,
            (dw.shotDmg ?? 0) * foeCapacitorMultiplierOf(b, f, k, 'damageMul'), dType,
            r => applyFoeShot(dtgt.rt.hp, dtgt.spec.resists, dw, r, dType))
          if (f.foeShieldCapacitor) {
            noteFoeCapacitorAttack(b, f, k)
            rt.weapons[k] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(aloftReload(dw.reloadMs) * foeCapacitorMultiplierOf(b, f, k, 'reloadMul')))
          }
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'foe',
          tag: f.tag,
          to: dtgt.spec.tag,
          type: dType,
          src: 'drone',
          artId: dw.artId,
          hit: dHit,
          ...(dDealt > 0 ? { dmg: dDealt } : {}),
        })
      }
    }
    if (f.acidBurst) continue
    const w = f.weapons[0]!
    const cd = rt.weapons[0] ?? 0
    if (cd > 0) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    if (foeBlinkHold) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    const burst = w.burst
    const burstFired = burst !== undefined ? (b.foeBurstFired?.[f.tag] ?? 0) : 0
    const burstMore = burst !== undefined && burstFired + 1 < Math.max(1, Math.floor(burst.shots))
    rt.weapons[0] = burstMore
      ? Math.max(0, Math.round(burst!.gapMs) - dtMs)
      : foeOverlayReloadOf(f, f.tag, b, Math.min(Number.MAX_SAFE_INTEGER, Math.round(w.reloadMs * foeCapacitorMultiplierOf(b, f, 0, 'reloadMul'))))
    if (burst !== undefined) {
      const reg = b.foeBurstFired ?? (b.foeBurstFired = {})
      if (burstMore) reg[f.tag] = burstFired + 1
      else delete reg[f.tag]
    }
    const wShot =
      f.foeFocusArray !== undefined
        ? {
            ...w,
            falloff: coronaFocusFalloffOf(
              w.falloff,
              f.foeFocusArray.rampMs,
              b.lastTickGameMs - foeWaveStartMsOf(b),
            ),
          }
        : w
    if (b.distanceM > foeGunMaxRangeOf(b, f, w)) continue
    const gunCount = volleyGunCountOf(w)
    const capacitorDamageMul = foeCapacitorMultiplierOf(b, f, 0, 'damageMul')
    let capacitorHit = false
    let volleyTarget: ReturnType<typeof pickTarget> = null
    for (let gun = 0; gun < gunCount; gun++) {
      if (!volleyTarget || !isAlive(b, volleyTarget.spec.tag)) volleyTarget = pickTarget()
      if (!volleyTarget) break
      const gtgt = volleyTarget
      if (f.foeCaptureWeb !== undefined && b.foeWebFired?.[f.tag] !== true) {
        fireFoeCaptureWeb(state, b, f, gtgt.spec)
      }
      b.stats.foeShots += 1
      const fType = w.fixedType ?? 'kinetic'
      if (w.kind === 'beam') {
        const pow = b.distanceM < w.minRangeM ? w.blindDmgMul ?? 0.3 : foeGunPowerFactorOf(b, f, wShot, b.distanceM)
        const dmg = volleyDamageShareOf(foeRepairDiscountedShot(f, Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * pow * capacitorDamageMul))), gunCount, gun)
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
        b.stats.foeHits += 1
        capacitorHit = true
        const beamDealt = applyPlayerUnitDamage(state, b, gtgt.spec.tag, gtgt.spec, dmg, fType,
          r => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType))
        pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: true, ...(beamDealt > 0 ? { dmg: beamDealt } : {}) })
        if (
          markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }      continue
      }
      const blindMul = b.distanceM < w.minRangeM ? (w.blindDmgMul ?? 0.3) : 1
      const shotDmgRaw = blindMul < 1 ? Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * blindMul)) : (w.shotDmg ?? 0)
      const shotDmg = volleyDamageShareOf(foeRepairDiscountedShot(f, ceilFinalQuantity(shotDmgRaw * capacitorDamageMul)), gunCount, gun)
      const foeHit = hitChance(w, f, gtgt.spec, b.distanceM, bal, foeGunPowerFactorOf(b, f, wShot, b.distanceM))
      const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
      const fHit = nextRandom(state.rng) < foeHitEff
      let gunDealt = 0
      if (fHit) {
        b.stats.foeHits += 1
        capacitorHit = true
        gunDealt = applyPlayerUnitDamage(state, b, gtgt.spec.tag, gtgt.spec, shotDmg, fType,
          r => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType))
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
      }
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: fHit, ...(gunDealt > 0 ? { dmg: gunDealt } : {}) })
        if (
          fHit && markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }
    }
    if (capacitorHit && f.foeShieldCapacitor) {
      noteFoeCapacitorAttack(b, f, 0)
      rt.weapons[0] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(w.reloadMs * foeCapacitorMultiplierOf(b, f, 0, 'reloadMul')))
    }
  }
}
