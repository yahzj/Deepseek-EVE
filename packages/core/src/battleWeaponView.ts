import type { BattleState } from './state'
import type { DamageType, SimContext } from './types'
import type { UnitSpec, WeaponSrc } from './combat'
import { battleAmmoAvailable } from './combatAmmo'
import { dronePoolKey } from './combatDrones'
import { isAlive } from './combatMath'

export interface BattleWeaponCycleView {
  id: string
  ownerTag: string
  shipId: string
  ownerName: string
  label: string
  src?: WeaponSrc
  count: number
  aliveCount?: number
  minM: number
  maxM: number
  cycleMs: number
  remainingMs: number
  percent: number
  state: 'ready' | 'reload' | 'no-ammo' | 'lost' | 'down' | 'waiting'
  damageType?: DamageType
}

/** 同舰同型共享冷却的武器合并展示；射程直接读当前规格，不改变攻击节拍。 */
export function battleWeaponCyclesOf(battle: BattleState,
  units: ReadonlyArray<{ spec: UnitSpec; shipId: string; name: string }>, ctx?: SimContext): BattleWeaponCycleView[] {
  const out: BattleWeaponCycleView[] = []
  for (const { spec, shipId, name } of units) {
    const groups = new Map<string, BattleWeaponCycleView>()
    const dronePriority = new Map<string, number>()
    spec.weapons.forEach((weapon, index) => {
      const key = `${spec.tag}#${index}`
      const remainingMs = Math.max(0, battle.units[spec.tag]?.weapons[index] ?? 0)
      const burst = battle.meBurstFired?.[key]
      const cycleMs = burst !== undefined && weapon.burst
        ? Math.max(1, weapon.burst.gapMs) : Math.max(1, battle.meOverlayReload?.[key]?.r ?? weapon.reloadMs)
      const damageType = weapon.fixedType ?? Object.keys(weapon.shotsByType ?? {})[0] as DamageType | undefined
      const drone = weapon.src === 'drone'
      const aliveCount = drone ? (battle.dronePools?.[dronePoolKey(spec.tag, index)]?.alive === true ? 1 : 0) : undefined
      const queued = drone && battle.dronePools?.[dronePoolKey(spec.tag, index)]?.launched === false
      const need = Math.max(1, weapon.count ?? 1) * Math.max(1, weapon.ammoPerShot ?? 1)
      const noAmmo = weapon.kind !== 'fixed' && damageType !== undefined && battleAmmoAvailable(battle, spec.tag, damageType) < need
      const state: BattleWeaponCycleView['state'] = !isAlive(battle, spec.tag) ? 'down'
        : aliveCount === 0 ? 'lost' : noAmmo ? 'no-ammo' : remainingMs > 0 ? 'reload' : queued ? 'waiting' : 'ready'
      const row: BattleWeaponCycleView = { id: key, ownerTag: spec.tag, shipId, ownerName: name,
        label: weapon.moduleId && ctx?.modules.get(weapon.moduleId)?.name || weapon.label.replace(/×\d+$/, ''),
        src: weapon.src, count: drone ? 1 : Math.max(1, Math.floor(weapon.count ?? 1)),
        minM: weapon.minRangeM, maxM: weapon.maxRangeM, cycleMs, remainingMs,
        percent: state === 'ready' ? 100 : state === 'reload' ? Math.max(0, Math.min(100, (1 - remainingMs / cycleMs) * 100)) : 0,
        state, ...(damageType ? { damageType } : {}), ...(drone ? { aliveCount } : {}) }
      if (drone) {
        const model = JSON.stringify(['drone', weapon.artId ?? weapon.label, damageType, row.minM, row.maxM, cycleMs])
        const priority = aliveCount === 0 ? 3 : queued ? 2 : state === 'ready' ? 0 : 1
        const previous = groups.get(model)
        if (previous) {
          previous.count++
          previous.aliveCount = (previous.aliveCount ?? 0) + (aliveCount ?? 0)
          const selected = dronePriority.get(model)!
          if (priority < selected || priority === selected && remainingMs < previous.remainingMs) Object.assign(previous, {
            remainingMs, cycleMs, percent: row.percent, state: row.state })
          dronePriority.set(model, Math.min(selected, priority))
        } else { groups.set(model, row); dronePriority.set(model, priority); out.push(row) }
      } else {
        const model = JSON.stringify([weapon.moduleId ?? row.label, weapon.src, weapon.kind, damageType,
          row.minM, row.maxM, cycleMs, remainingMs, state])
        const previous = groups.get(model)
        if (previous) previous.count += row.count
        else { groups.set(model, row); out.push(row) }
      }
    })
  }
  return out
}
