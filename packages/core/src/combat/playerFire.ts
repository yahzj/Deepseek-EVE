import type { GameState } from '../state'
import type { UnitSpec, BattleSimulationOptions } from './model'
import type { BattleBalance, DamageType } from '../types'
import { isAlive, playerWeaponInRange, playerBlindDamageMul, droneHitChance, hitChance, clamp, applyDamage } from './combatMath'
import { dronePoolKey, pickFoeDroneTarget, isFoeEngageable } from './combatDrones'
import { isMyUnitStealthed, firstAliveFoe, lockAwareFoe } from './targeting'
import { applyFleetLockAura } from './lockAura'
import { releaseDroneLaunch } from './droneLaunch'
import { consumeBattleWeaponAmmo } from './combatAmmo'
import { noteRailAttack } from './gravekeeperGear'
import { meBurstReloadOf, markFoeBlink, settleFoeBlinkExtras } from './blink'
import { ceilFinalQuantity } from '../quantity'
import { beamPowerVsTargetOf } from './beam'
import { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
import { pushBattleNotice, pushBattleFx } from './combatFx'
import { nextRandom } from '../rng'
import { applyFoeUnitDamage, carryVolleyOverflow } from './damage'
import { addFoeAcidLayer } from './alienEquipment'
import { markFoeDroneRangeBuff, announceFoeGunRangeBuff } from './foeRange'
import { battleMaxDistanceM } from './foes/tactics'
import { pulseRepairDroneFor } from './combatRepair'

export function firePlayerPhase(state: GameState, b: import('../state').BattleState, myUnits: readonly UnitSpec[], foes: UnitSpec[], me: UnitSpec, bal: BattleBalance, dtMs: number, favor: { meMul: number; foeMul: number } | null, blinkHold: { me: boolean; foe: boolean }, meAtkOf: (u: UnitSpec) => UnitSpec, awaitingWaveArrival: boolean, simulation?: BattleSimulationOptions): void {
for (const unit of myUnits) {
    applyFleetLockAura(myUnits as UnitSpec[], b)
    const meRt = b.units[unit.tag]
    if (!meRt || !isAlive(b, unit.tag)) continue
    const meAtk = meAtkOf(unit)
    for (let wi = 0; wi < unit.weapons.length; wi++) {
      const w = unit.weapons[wi]!
      if (w.disabled) continue
      if (w.src === 'drone') {
        const poolEntry = b.dronePools?.[dronePoolKey(unit.tag, wi)]
        if (!poolEntry || poolEntry.alive === false) continue
      }
      if (awaitingWaveArrival) continue
      if (w.repairDrone) {
        const cd = meRt.weapons[wi] ?? 0
        if (cd > 0) { meRt.weapons[wi] = Math.max(0, cd - dtMs); continue }
        if (!releaseDroneLaunch(b, unit, wi)) continue
        pulseRepairDroneFor(state, b, myUnits, unit, w.repairDrone, { artId: w.artId, index: wi })
        meRt.weapons[wi] = w.reloadMs
        continue
      }
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      if (blinkHold.me) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      if (w.src === 'base' && isMyUnitStealthed(b, unit.tag)) continue
      let droneHit = w.canHitDrones
        ? pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag)
        : null
      if (!droneHit && !playerWeaponInRange(b.distanceM, w)) continue;
      if (w.src === 'drone' && (!foes.some(f => isFoeEngageable(b, f.tag)) || !releaseDroneLaunch(b, unit, wi))) continue
      let foeTarget = droneHit
        ? null
        : lockAwareFoe(state, b, foes, unit)
      if (!foeTarget && !droneHit) continue
      let type: DamageType
      let dmg: number
      let autoHit = false
      if (w.kind === 'gun') {
        const pick = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
        if (!pick || !consumeBattleWeaponAmmo(b, unit.tag, wi, pick, w)) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        meRt.weapons[wi] = noteRailAttack(b, unit, wi, meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs))
      } else if (w.kind === 'beam') {
        if (!consumeBattleWeaponAmmo(b, unit.tag, wi, 'plasma', w)) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = 'plasma'
        dmg = Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null)))
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
        autoHit = true
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
      }
      if (droneHit && (w.antiDroneMul ?? 1) !== 1)
        dmg = ceilFinalQuantity(dmg * (w.antiDroneMul ?? 1))
      const gunCount = volleyGunCountOf(w)
      const volleyDmg = dmg
      const rawBeam = w.kind === 'beam' ? w.shotDmg ?? 0 : dmg
      for (let gun = 0; gun < gunCount; gun++) {
        if (gun > 0 && droneHit && !droneHit.pool.alive) {
          droneHit = pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag, true)
          if (!droneHit) {
            if (!playerWeaponInRange(b.distanceM, w)) break
            foeTarget = lockAwareFoe(state, b, foes, unit)
            if (!foeTarget) break
          }
        }
        if (gun > 0 && !droneHit && ((unit.lockTargetChance ?? 0) > 0 || !isAlive(b, foeTarget!.tag))) {
          foeTarget = lockAwareFoe(state, b, foes, unit)
          if (!foeTarget) break
        }
        const targetVolleyDmg = w.kind === 'beam'
          ? ceilFinalQuantity(Math.max(1, ceilFinalQuantity(rawBeam * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null))) * (droneHit ? w.antiDroneMul ?? 1 : 1))
          : droneHit ? volleyDmg : (w.kind === 'gun' ? w.shotsByType?.[type] ?? 0 : w.shotDmg ?? 0)
        dmg = volleyDamageShareOf(targetVolleyDmg, gunCount, gun)
        const blindMul = playerBlindDamageMul(b.distanceM, w, droneHit !== null)
        dmg = ceilFinalQuantity(dmg * blindMul)
        b.stats.meShots += 1;
        if (meRt.stealthUntilMs !== undefined) {
          meRt.stealthUntilMs = undefined
          pushBattleNotice(b, '隐秘行动结束：本舰开火现形')
        }
        if (w.src === 'drone')
          b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: b.lastTickGameMs };
        const meHit = autoHit
          ? 1
          : droneHit
            ? droneHitChance(w, meAtk, droneHit.pool.evasion, bal)
            : hitChance(w, meAtk, foeTarget!, b.distanceM, bal)
        const meHitEff = autoHit
          ? 1
          : favor
            ? clamp(0, 1, meHit * favor.meMul)
            : meHit
        const hit = autoHit || (dmg > 0 && nextRandom(state.rng) < meHitEff)
        let selfDealt = 0
        if (hit) {
          b.stats.meHits += 1
          if (droneHit) {
            const pool = droneHit.pool
            const r = applyDamage(
              { s: pool.s, a: pool.a, h: pool.h },
              pool.resists ?? {},
              dmg,
              type,
            )
            pool.s = r.hp.s
            pool.a = r.hp.a
            pool.h = r.hp.h
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            if (pool.s + pool.a + pool.h <= 0) {
              pool.alive = false
              const droneFoeTag = droneHit.foeTag
              const reserveOf = foes.find((x) => x.tag === droneFoeTag)?.foeDroneReserve
              const hangar = b.foeDronePools?.[droneHit.foeTag] ?? []
              if (
                reserveOf &&
                reserveOf.count > 0 &&
                !hangar.some((p) => p.inHangar === true && p.readyAtMs !== undefined)
              ) {
                const next = hangar.find(
                  (p) => p.inHangar === true && p.readyAtMs === undefined,
                )
                if (next) next.readyAtMs = b.lastTickGameMs + reserveOf.respawnMs
              }
              pushBattleFx(b, {
                atMs: b.lastTickGameMs + dtMs,
                side: 'foe',
                tag: droneHit.foeTag,
                to: 'player',
                type,
                src: 'drone',
                artId: pool.artId,
                hit: true,
                droneDown: true,
              })
            }
          } else {
            const rt = b.units[foeTarget!.tag]!;
            const hpBefore = { ...rt.hp }
            const volleyLocked = unit.lockedDmgBonus && foeTarget!.tag === firstAliveFoe(foes, b)?.tag
              ? ceilFinalQuantity(targetVolleyDmg * (1 + unit.lockedDmgBonus)) : targetVolleyDmg
            const dmgLocked = ceilFinalQuantity(volleyDamageShareOf(volleyLocked, gunCount, gun) * blindMul)
            const secPct = w.secondaryDamagePct ?? 0
            const secondary = secPct > 0 ? {
              type: w.secondaryDamageType ?? 'kinetic',
              dmg: ceilFinalQuantity(volleyDamageShareOf(Math.max(1, ceilFinalQuantity(volleyLocked * secPct)), gunCount, gun) * blindMul),
            } : undefined
            const r = applyFoeUnitDamage(b, foeTarget!, dmgLocked, type, b.lastTickGameMs + dtMs, secondary)
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            if (w.acidOnHit) addFoeAcidLayer(b, foeTarget!.tag, w.acidOnHit, b.lastTickGameMs)
            const mainAfter = b.wormhole?.volleyOverflow === true
              ? applyDamage(hpBefore, r.resistsUsed ?? {}, dmgLocked, type).hp : undefined
            if (mainAfter && mainAfter.s + mainAfter.a + mainAfter.h <= 0 && rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
              const carry = carryVolleyOverflow(b, foes, foeTarget!.tag, type, dmgLocked, hpBefore, 3, r.resistsUsed)
              if (carry.hits > 0) {
                pushBattleNotice(b, `齐射协调：溢火结转 ${Math.round(carry.total)} 点伤害到下一艘敌舰`)
              }
            }
            if (markFoeDroneRangeBuff(foeTarget!, b)) {
              pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
            }
            announceFoeGunRangeBuff(foeTarget!, b)
            if (
              markFoeBlink(
                foeTarget!,
                foeTarget!.tag,
                b,
                bal,
                battleMaxDistanceM(b, me, foes, bal, myUnits),
                b.meFoeRangeDebuff ?? 0,
              )
            ) {
              pushBattleFx(b, {
                atMs: b.lastTickGameMs,
                side: 'foe',
                tag: foeTarget!.tag,
                type: 'kinetic',
                hit: true,
                blink: true,
              })
              settleFoeBlinkExtras(foeTarget!, foeTarget!.tag, b, foeTarget!.weapons[0]?.reloadMs)
            }
          }
        }
        if (w.allFoes === true && !droneHit) {
          for (const other of foes) {
            if (other.tag === foeTarget!.tag) continue
            const ort = b.units[other.tag]
            if (!ort || !isAlive(b, other.tag)) continue
            const oHitChance = autoHit ? 1 : hitChance(w, meAtk, other, b.distanceM, bal)
            const oHit = autoHit || (dmg > 0 && nextRandom(state.rng) < oHitChance)
            let oDealt = 0
            if (oHit) {
              b.stats.meHits += 1
              const secPctAll = w.secondaryDamagePct ?? 0
              const secondaryAll = secPctAll > 0 ? {
                type: w.secondaryDamageType ?? 'kinetic',
                dmg: ceilFinalQuantity(volleyDamageShareOf(Math.max(1, ceilFinalQuantity(targetVolleyDmg * secPctAll)), gunCount, gun) * blindMul),
              } : undefined
              const rAll = applyFoeUnitDamage(b, other, dmg, type, b.lastTickGameMs + dtMs, secondaryAll)
              b.stats.meDmg += rAll.dealt
              oDealt = rAll.dealt
              if (markFoeDroneRangeBuff(other, b)) {
                pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
              }
              announceFoeGunRangeBuff(other, b)
              if (
                markFoeBlink(other, other.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits), b.meFoeRangeDebuff ?? 0)
              ) {
                settleFoeBlinkExtras(other, other.tag, b, other.weapons[0]?.reloadMs)
              }
            }
            pushBattleFx(b, {
              atMs: b.lastTickGameMs + dtMs,
              side: 'me',
              tag: unit.tag,
              to: other.tag,
              type,
              src: w.src,
              artId: w.artId,
              hit: oHit,
              ...(oDealt > 0 ? { dmg: oDealt } : {}),
            })
          }
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: unit.tag,
          to: droneHit ? droneHit.foeTag : foeTarget!.tag,
          type,
          src: w.src,
          artId: w.artId,
          hit,
          ...(selfDealt > 0 ? { dmg: selfDealt } : {}),
          ...(droneHit ? { pd: true } : {}),
        })
        simulation?.onShot?.({ index: wi, weapon: w, hit, damage: selfDealt })
      }
    }
  }
}
