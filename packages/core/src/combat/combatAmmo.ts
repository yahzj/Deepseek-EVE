import { ceilFinalQuantity } from '../quantity'
import type { BattleState, GameState } from '../state'
import type { BattleBalance, DamageType, SimContext } from '../types'
import type { UnitSpec, WeaponSpec } from './model'
import { AMMO_IDS } from './player/factors'
import { addWare, cargoOfShip, removeCargoOfShip, removeWare } from '../inventory'
import { restoreWormholeSupply, wormholeSupplyForBattle } from '../wormholeSupplies'
import { observeOfflineBattle } from '../offlineCombatStats'



function weaponAmmoPerVolley(w: Pick<WeaponSpec, 'count' | 'ammoPerShot'>): number {
  const per = w.ammoPerShot ?? 1
  return Math.max(1, Math.floor(w.count ?? 1)) * (Number.isFinite(per) && per > 0 ? per : 1)
}

export function weaponNominalAmmoForMs(w: WeaponSpec, durationMs: number): number {
  if ((w.kind !== 'gun' && w.kind !== 'beam') || !(durationMs > 0) || !Number.isFinite(durationMs)) return 0
  const volley = weaponAmmoPerVolley(w)
  const shots = Math.max(1, Math.floor(w.burst?.shots ?? 1))
  let elapsed = 0
  let fired = 0
  let reload = Math.max(50, w.reloadMs)
  while (elapsed < durationMs) {
    fired += 1
    if (fired % shots !== 0) elapsed += Math.max(50, w.burst?.gapMs ?? reload)
    else {
      if (w.overlayDrive) reload = Math.max(w.overlayDrive.floorMs, reload - w.overlayDrive.stepMs)
      elapsed += Math.max(50, reload)
    }
  }
  return Math.ceil(fired * volley)
}

export function ammoLoadTotals(
  me: UnitSpec,
  bal: BattleBalance,
  state: import('../state').GameState,
): Partial<Record<DamageType, number>> {
  const condLv = Math.min(5, state.skills.trained['ammunition-condensing'] ?? 0)
  const condFactor = 1 + 0.08 * condLv
  const out: Partial<Record<DamageType, number>> = {}
  const addFor = (t: DamageType, reloadMs: number, volley: number): void => {
    const volleys = Math.max(1, Math.ceil(((bal.ammoTimeCapMs * condFactor) / Math.max(100, reloadMs)) * bal.ammoMargin))
    out[t] = (out[t] ?? 0) + Math.ceil(volleys * volley)
  }
  for (const w of me.weapons) {
    if (w.kind === 'gun') {
      const t = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
      if (t) addFor(t, w.reloadMs, weaponAmmoPerVolley(w))
    } else if (w.kind === 'beam') {
      addFor('plasma', w.reloadMs, weaponAmmoPerVolley(w))
    }
  }
  return out
}

export function loadAmmo(state: GameState, ctx: SimContext, type: DamageType, total: number): { kin: number; exp: number; pla: number } {
  const out = { kin: 0, exp: 0, pla: 0 }
  const key = ammoKeyOf(type)
  out[key] = loadAmmoOf(state, ctx, AMMO_IDS[type], total)
  return out
}

function ammoStockForShip(state: GameState, shipId: string): Readonly<Record<string, number>> {
  return state.resupplyFromWarehouse !== false ? state.warehouse.items : cargoOfShip(state, shipId)
}

function loadAmmoOf(state: GameState, ctx: SimContext, id: string, total: number, shipId = state.shipId): number {
  void ctx
  if (total <= 0) return 0
  const got = Math.min(Math.floor(ammoStockForShip(state, shipId)[id] ?? 0), Math.floor(total))
  if (got <= 0) return 0
  if (state.resupplyFromWarehouse !== false) return removeWare(state, id, got) ? got : 0
  return removeCargoOfShip(state, shipId, id, got)
}

export function ammoTierFallbackLog(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  useId: string,
  loaded: number,
): string {
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantName = prefId ? (ctx.items.get(prefId)?.name ?? type) : '基础弹'
  const useName = ctx.items.get(useId)?.name ?? type
  return `⚙ ${wantName}可用量不足，本场改用${useName}（预载 ${loaded} 发）。`
}

export function resolveAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  want: number,
  stock?: Readonly<Record<string, number>>,
): { id: string; can: number; expected: string; fellBack: boolean } {
  const need = Math.max(0, Math.floor(want))
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantId = prefId && ctx.items.has(prefId) ? prefId : null
  const baseId = AMMO_IDS[type]
  const available = stock ?? ammoStockForShip(state, shipId)
  const canLoadOf = (id: string): number =>
    Math.min(Math.floor(available[id] ?? 0), need)
  const family = [...new Set([baseId, ...[...ctx.items.keys()].filter((id) => id.startsWith(`ammo-${type}-`))])].sort()
  const ranked = family
    .map((id) => ({ id, can: canLoadOf(id) }))
    .sort(
      (a, b) =>
        b.can - a.can ||
        (a.id === wantId ? -1 : b.id === wantId ? 1 : 0) ||
        (a.id === baseId ? -1 : b.id === baseId ? 1 : 0) ||
        a.id.localeCompare(b.id),
    )
  const pick = ranked[0]
  const expected = wantId ?? baseId
  const id = pick && pick.can > 0 ? pick.id : expected
  return { id, can: pick?.can ?? 0, expected, fellBack: pick !== undefined && pick.can > 0 && id !== expected }
}

export function loadAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  total: number,
): { loaded: number; id: string; fellBack: boolean } {
  const r = resolveAmmoTier(state, ctx, shipId, type, total)
  const loaded = r.can > 0 ? loadAmmoOf(state, ctx, r.id, Math.max(0, Math.floor(total)), shipId) : 0
  return { loaded, id: r.id, fellBack: r.fellBack }
}

export function refundAmmo(
  state: GameState,
  ammo: { kin: number; exp: number; pla: number },
  ids?: Partial<Record<DamageType, string>> | null,
): void {
  const map: Array<[DamageType, number]> = [
    ['kinetic', ammo.kin],
    ['explosive', ammo.exp],
    ['plasma', ammo.pla],
  ]
  for (const [t, n] of map) {
    if (n > 0) addWare(state, ids?.[t] ?? AMMO_IDS[t], Math.floor(n))
  }
}

export function refundBattleAmmo(state: GameState, battle: BattleState, recoveryPct = 0): number {
  observeOfflineBattle(state, battle)
  const rate = Math.max(0, Math.min(1, recoveryPct))
  const ledger = battle.expeditionAmmo
  if (ledger) {
    let recovered = 0
    for (const [id, loaded] of Object.entries(ledger.loaded)) {
      const left = ledger.stock[id] ?? 0
      const back = ceilFinalQuantity(Math.max(0, loaded - left) * rate)
      if (left + back > 0) addWare(state, id, left + back)
      recovered += back
    }
    ledger.stock = {}
    ledger.loaded = {}
    return recovered
  }
  refundAmmo(state, battle.ammo, battle.ammoIds)
  const back = { kin: 0, exp: 0, pla: 0 }
  for (const key of ['kin', 'exp', 'pla'] as const) back[key] = ceilFinalQuantity(Math.max(0, (battle.ammoLoaded?.[key] ?? battle.ammo[key]) - battle.ammo[key]) * rate)
  refundAmmo(state, back, battle.ammoIds)
  return back.kin + back.exp + back.pla
}

export function nextAmmoType(ammo: { kin: number; exp: number; pla: number }): DamageType | null {
  let best: DamageType | null = null
  let bestN = 0
  const order: Array<DamageType> = ['kinetic', 'explosive', 'plasma']
  for (const t of order) {
    const n = ammo[ammoKeyOf(t)]
    if (n > bestN) {
      bestN = n
      best = t
    }
  }
  return best
}

export type AmmoKey = 'kin' | 'exp' | 'pla'
export function ammoKeyOf(t: DamageType): AmmoKey {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

export function battleAmmoIdsFor(battle: BattleState, tag: string): Partial<Record<DamageType, string>> | undefined {
  return battle.expeditionAmmo ? battle.expeditionAmmo.idsByTag[tag] ?? {} : battle.ammoIds
}

export function battleAmmoAvailable(battle: BattleState, tag: string, type: DamageType): number {
  if (!battle.expeditionAmmo) return battle.ammo[ammoKeyOf(type)]
  const id = battle.expeditionAmmo.idsByTag[tag]?.[type]
  return id ? battle.expeditionAmmo.stock[id] ?? 0 : 0
}

export function wormholeAmmoIdsForSpec(
  state: GameState, ctx: SimContext, shipId: string, spec: UnitSpec, stock: Readonly<Record<string, number>>,
): Partial<Record<DamageType, string>> {
  const ids: Partial<Record<DamageType, string>> = {}
  for (const [typeRaw, n] of Object.entries(ammoLoadTotals(spec, ctx.balance.battle, state))) {
    const type = typeRaw as DamageType
    ids[type] = resolveAmmoTier(state, ctx, shipId, type, n ?? 0, stock).id
  }
  return ids
}

export function consumeBattleAmmo(battle: BattleState, tag: string, type: DamageType, count: number): boolean {
  if (!Number.isSafeInteger(count) || count <= 0) return false
  if (battleAmmoAvailable(battle, tag, type) < count) return false
  if (battle.expeditionAmmo) {
    const id = battle.expeditionAmmo.idsByTag[tag]![type]!
    battle.expeditionAmmo.stock[id] = (battle.expeditionAmmo.stock[id] ?? 0) - count
  }
  battle.ammo[ammoKeyOf(type)] -= count
  return true
}

function weaponAmmoCredit(battle: BattleState, key: string): number {
  const value = battle.ammoCreditByWeapon?.[key] ?? 0
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0
}

export function battleWeaponAmmoCost(battle: BattleState, tag: string, wi: number, type: DamageType, w: WeaponSpec): number {
  const demand = weaponAmmoPerVolley(w)
  const credit = Number.isInteger(demand) ? 0 : weaponAmmoCredit(battle, `${tag}#${wi}:${type}`)
  return Math.ceil(Math.max(0, demand - credit))
}

export function consumeBattleWeaponAmmo(battle: BattleState, tag: string, wi: number, type: DamageType, w: WeaponSpec): boolean {
  const cost = battleWeaponAmmoCost(battle, tag, wi, type, w)
  if (cost > 0 && !consumeBattleAmmo(battle, tag, type, cost)) return false
  const demand = weaponAmmoPerVolley(w)
  if (!Number.isInteger(demand)) {
    const key = `${tag}#${wi}:${type}`
    const remaining = weaponAmmoCredit(battle, key) + cost - demand
    if (remaining > 1e-9) {
      const credits = battle.ammoCreditByWeapon ??= {}
      credits[key] = remaining
    } else if (battle.ammoCreditByWeapon) {
      delete battle.ammoCreditByWeapon[key]
      if (!Object.keys(battle.ammoCreditByWeapon).length) delete battle.ammoCreditByWeapon
    }
  }
  return true
}

export function loadWormholeBattleAmmo(state: GameState, ctx: SimContext, battle: BattleState, specs: ReadonlyMap<string, UnitSpec>): boolean {
  const ledger = wormholeSupplyForBattle(state, battle)
  if (!ledger) return false
  const wanted: Record<string, number> = {}
  const idsByTag: NonNullable<BattleState['expeditionAmmo']>['idsByTag'] = {}
  for (const entry of battle.myFleet ?? []) {
    const spec = specs.get(entry.shipId)!
    const ids = wormholeAmmoIdsForSpec(state, ctx, entry.shipId, spec, ledger.items)
    for (const [typeRaw, n] of Object.entries(ammoLoadTotals(spec, ctx.balance.battle, state))) {
      const type = typeRaw as DamageType
      const id = ids[type]!
      wanted[id] = (wanted[id] ?? 0) + (n ?? 0)
    }
    idsByTag[entry.tag] = ids
  }
  const stock: Record<string, number> = {}
  for (const [id, n] of Object.entries(wanted)) {
    const take = Math.min(ledger.items[id] ?? 0, n)
    if (take <= 0) continue
    stock[id] = take
    const left = (ledger.items[id] ?? 0) - take
    if (left > 0) ledger.items[id] = left
    else delete ledger.items[id]
  }
  battle.expeditionAmmo = { stock, loaded: { ...stock }, idsByTag }
  battle.ammo = { kin: 0, exp: 0, pla: 0 }
  for (const [id, n] of Object.entries(stock)) {
    const type = (['kinetic', 'explosive', 'plasma'] as const).find((t) => id.startsWith(`ammo-${t}-`))
    if (type) battle.ammo[ammoKeyOf(type)] += n
  }
  return true
}

export function settleWormholeBattleAmmo(state: GameState, battle: BattleState, recoveryPct: number): void {
  const ledger = wormholeSupplyForBattle(state, battle)
  const ammo = battle.expeditionAmmo
  if (!ledger || !ammo) return
  for (const [id, loaded] of Object.entries(ammo.loaded)) {
    const left = ammo.stock[id] ?? 0
    const back = ceilFinalQuantity(Math.max(0, loaded - left) * Math.max(0, Math.min(1, recoveryPct)))
    const consumed = (ledger.consumed[id] ?? 0) + Math.max(0, loaded - left)
    if (consumed > 0) ledger.consumed[id] = consumed
    if (left > 0) ledger.items[id] = (ledger.items[id] ?? 0) + left
    restoreWormholeSupply(ledger, id, back)
  }
  ammo.stock = {}
  ammo.loaded = {}
}
