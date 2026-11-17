import type { GameState } from '../state'
import type { SimContext, AnomalyDef, DamageType } from '../types'
import { resolvedBattleAnomaly, battleAnomalyOf } from './cards'
import { createPlayerSpec } from './player/create'
import { AMMO_IDS } from './player/factors'
import { createFoeSpecs, activeFoeSpecsOf } from './foes/catalog'
import { mainWeaponOf, battleOpenM, battleMaxDistanceM, foeDesiredRange } from './foes/tactics'
import { foesWithSupport } from './foes/reinforcements'
import type { WeaponSrc } from './model'
import { type BattleWeaponCycleView, battleWeaponCyclesOf } from './battleWeaponView'
import { type BattleDeviceCycleView, battleDeviceCyclesOf } from './battleDeviceView'
import { rangeEwBattleView, type RangeEwView } from './rangeEwPreview'
import { battleAmmoIdsFor, battleAmmoAvailable, battleWeaponAmmoCost, ammoKeyOf } from './combatAmmo'
import { syncCoronaFleetFocus } from './coronaFocus'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeRangeEwSpecsOf } from './foeRange'
import { playerGravekeeperSpecOf } from './gravekeeperGear'
import { buildMyUnitSpecs } from './fleetSpecs'
import { uidDefId } from '../labels'
import { shipDisplayName } from '../instances'
import { isAlive } from './combatMath'
import { thrusterPhase, unitThrusterCycle, unitSpeedMulOf } from './movement'
import { dronePoolOwner } from './combatDrones'
import { gravekeeperStatusesOf } from './gravekeeperCombat'
import { syncRangeEw, rangeEwBattleSummaryOf } from './rangeEw'

export function battleZonesFor(state: GameState, ctx: SimContext): {
  openM: number
  me: { minM: number; maxM: number; name: string }
  foe: { minM: number; maxM: number }
} | null {
  const battle = state.expedition.battle
  const anomaly = battle ? resolvedBattleAnomaly(ctx, battle, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
    : battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const main = mainWeaponOf(me) ?? me.weapons[0]!
  let foeMin = 0
  let foeMax = 0
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
    }
  }
  return {
    openM: battleOpenM(me, foes, bal),
    me: { minM: main?.minRangeM ?? 0, maxM: main?.maxRangeM ?? 0, name: main?.label ?? '' },
    foe: { minM: foeMin, maxM: foeMax },
  }
}

export function battleArcsFor(
  state: GameState,
  ctx: SimContext,
  override?: {
    battle: import('../state').BattleState
    anomaly: AnomalyDef
    leaderShipId: string
  } | null,
): {
  nearM: number
  openM: number
  maxM: number
  desireMaxM: number
  foeDesireM: number
  ammo: { kin: number; exp: number; pla: number }
  ammoNames?: Partial<Record<'kin' | 'exp' | 'pla', string>>
  me: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    reloadMs: number
    src?: WeaponSrc
    artId?: string
    count?: number
    isMain?: boolean
  }>
  meReload: number[]
  weapons: BattleWeaponCycleView[]
  rangeEw?: NonNullable<ReturnType<typeof rangeEwBattleSummaryOf>>
  rangeEwDetails?: () => RangeEwView | undefined
  devices: BattleDeviceCycleView[]
  myUnits: Array<{
    tag: string
    shipId: string
    defId: string
    name: string
    className: string
    leader: boolean
    drones: Array<{ artId: string; count: number; deployed?: number }>
    hp: { s: number; a: number; h: number }
    hpMax: { s: number; a: number; h: number }
    alive: boolean
    boosting: boolean
    ammoIds?: Partial<Record<DamageType, string>>
  }>
  foe: { minM: number; maxM: number; type: DamageType }
  foeBands: Array<{ minM: number; maxM: number; type: DamageType; count: number; names: string[]; mounts?: string[] }>
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
  droneLost?: Record<string, number>
  thrusterBoost: number
  thrusterCycle: { boostMs: number; cooldownMs: number }
  foeCanCharge: boolean;
  foeChargingTags: string[]
  meSpeedMps?: number
  foeSpeedMps?: number
  foeMounts?: string[]
  gravekeeperStatuses?: import('./gravekeeperCombat').GravekeeperStatus[]
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  webLinks?: Array<{ from: string; to: string; fromName: string; toName: string; slowPct: number }>
  foeDrones?: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    rangeBuff: boolean
    hangar?: number
  }>
} | null {
  const battle = override?.battle ?? state.expedition.battle
  const anomaly = override?.anomaly ?? (battle && resolvedBattleAnomaly(ctx, battle, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive))
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const leaderShipId = override?.leaderShipId ?? state.shipId
  const leaderTag = battle.myFleet?.find((e) => e.shipId === leaderShipId)?.tag ?? 'player'
  const foes = foesWithSupport(battle, activeFoeSpecsOf(anomaly, bal, battle.waveIdx))
  if (battle.rangeEwVersion === 1) syncRangeEw(state, ctx, battle, foes, leaderShipId)
  syncCoronaFleetFocus(battle, foes)
  const mySpecs = new Map(buildMyUnitSpecs(state, ctx, battle, leaderShipId, anomaly.id, foes)
    .map(spec => [spec.tag, playerGravekeeperSpecOf(battle, spec, true)]))
  const me = mySpecs.get(leaderTag)
  if (!me) return null
  const meRt = battle.units['player']?.weapons ?? []
  const meArcs: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    reloadMs: number
    src?: WeaponSrc
    artId?: string
    count?: number
    isMain?: boolean
  }> = []
  const meReload: number[] = []
  const droneAt = new Map<string, number>()
  const droneN: number[] = []
  const mainW = mainWeaponOf(me)
  me.weapons.forEach((w, i) => {
    if (w.disabled || w.repairDrone) return
    if (w.src === 'drone' && battle.dronePools?.[i]?.alive === false) return
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (w.kind === 'beam') type = battleAmmoAvailable(battle, leaderTag, 'plasma') >= battleWeaponAmmoCost(battle, leaderTag, i, 'plasma', w) ? 'plasma' : null
    else {
      const own = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? w.fixedType ?? null
      const need = own !== null ? battleWeaponAmmoCost(battle, leaderTag, i, own, w) : 1
      type = own !== null && battleAmmoAvailable(battle, leaderTag, own) >= need ? own : null
    }
    const rem = Math.max(0, Math.floor(meRt[i] ?? 0))
    if (w.src === 'drone') {
      const key = w.artId ?? 'drone'
      const at = droneAt.get(key)
      if (at !== undefined) {
        droneN[at] = (droneN[at] ?? 1) + 1
        meReload[at] = Math.min(meReload[at] ?? rem, rem)
        if (w === mainW) meArcs[at]!.isMain = true
        return
      }
      droneAt.set(key, meArcs.length)
      droneN.push(1)
      meArcs.push({
        label: w.label,
        kind: w.kind,
        type,
        minM: w.minRangeM,
        maxM: w.maxRangeM,
        reloadMs: w.reloadMs,
        src: w.src,
        artId: w.artId,
        count: 1,
        ...(w === mainW ? { isMain: true } : {}),
      })
      meReload.push(rem)
      return
    }
    meArcs.push({
      label: w.label,
      kind: w.kind,
      type,
      minM: w.minRangeM,
      maxM: w.maxRangeM,
      reloadMs: w.reloadMs,
      src: w.src,
      count: 1,
      ...(w === mainW ? { isMain: true } : {}),
    })
    meReload.push(rem)
  })
  meArcs.forEach((a) => {
    const n = droneN[droneAt.get(a.artId ?? '') ?? -1]
    if (a.src === 'drone' && n !== undefined) {
      a.count = n
      if (n > 1) a.label = `${a.label}×${n}`
    }
  })
  let foeMin = Number.POSITIVE_INFINITY
  let foeMax = 0
  let foeType: DamageType = 'kinetic'
  const foeBandMap = new Map<string, { minM: number; maxM: number; type: DamageType; units: number; names: Set<string>; mounts: Set<string> }>()
  for (const f of foes) {
    const seenBandOfUnit = new Set<string>()
    for (const w of f.weapons) {
      const wMin = w.minRangeM
      const wMax =
        w.src === 'drone'
          ? foeDroneRangeOf(battle, w, f)
          : foeGunMaxRangeOf(battle, f, w)
      foeMin = Math.min(foeMin, wMin)
      foeMax = Math.max(foeMax, wMax)
      const type = w.fixedType ?? 'kinetic'
      foeType = type
      const key = `${wMin}|${wMax}|${type}`
      let band = foeBandMap.get(key)
      if (!band) {
        band = { minM: wMin, maxM: wMax, type, units: 0, names: new Set<string>(), mounts: new Set<string>() }
        foeBandMap.set(key, band)
      }
      band.names.add(f.name)
      for (const m of f.foeMountNames ?? []) band.mounts.add(m)
      if (!seenBandOfUnit.has(key)) {
        seenBandOfUnit.add(key)
        band.units += 1
      }
    }
  }
  if (!Number.isFinite(foeMin)) foeMin = 0
  const foeBands = [...foeBandMap.values()]
    .map((b) => ({
      minM: b.minM,
      maxM: b.maxM,
      type: b.type,
      count: b.units,
      names: [...b.names],
      ...(b.mounts.size > 0 ? { mounts: [...b.mounts] } : {}),
    }))
    .sort((a, b) => b.maxM - a.maxM || a.minM - b.minM)
  const openM = battleOpenM(me, battle.rangeEwVersion === 1 ? foeRangeEwSpecsOf(battle, foes) : foes, bal)
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  const bossShipId = battle.foeOverride?.bossShipId
  const bossHpMax = battle.foeOverride?.bossHpMax
  const bossMaxLayers = battle.foeOverride?.bossMaxLayers
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    const max = u.hpMax ?? { s: Math.max(0.001, u.hp.s), a: Math.max(0.001, u.hp.a), h: Math.max(0.001, u.hp.h) }
    const isBoss = bossShipId !== undefined && u.foeShipId === bossShipId
    const layered =
      isBoss &&
      bossMaxLayers !== undefined &&
      Number.isFinite(bossMaxLayers.s) &&
      Number.isFinite(bossMaxLayers.a) &&
      Number.isFinite(bossMaxLayers.h) &&
      bossMaxLayers.s + bossMaxLayers.a + bossMaxLayers.h > 0
        ? { s: Math.max(0, bossMaxLayers.s), a: Math.max(0, bossMaxLayers.a), h: Math.max(0, bossMaxLayers.h) }
        : null
    const sum = max.s + max.a + max.h
    const scale =
      layered === null &&
      isBoss &&
      bossHpMax !== undefined &&
      Number.isFinite(bossHpMax) &&
      bossHpMax > 0 &&
      sum > 0 &&
      bossHpMax > sum
        ? bossHpMax / sum
        : 1
    foeMaxHp[tag] =
      layered !== null
        ? layered
        : scale === 1
          ? max
          : { s: max.s * scale, a: max.a * scale, h: max.h * scale }
  }
  const ammoNames: Partial<Record<'kin' | 'exp' | 'pla', string>> = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const id = battleAmmoIdsFor(battle, leaderTag)?.[t]
    if (!id) continue
    const def = ctx.items.get(id)
    if (def?.name && id !== AMMO_IDS[t]) ammoNames[ammoKeyOf(t)] = def.name
  }
  const foeDroneWings: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    rangeBuff: boolean
  }> = []
  for (const f of foesWithSupport(battle, foes)) {
    const pools = battle.foeDronePools?.[f.tag]
    if (!pools || pools.length === 0) continue
    const active = pools.filter((p) => p.inHangar !== true)
    const hangarN = pools.length - active.length
    const byArt = new Map<string, { count: number; alive: number }>()
    for (const p of active) {
      const id = p.artId ?? 'drone'
      const cur = byArt.get(id) ?? { count: 0, alive: 0 }
      cur.count += 1
      if (p.alive) cur.alive += 1
      byArt.set(id, cur)
    }
    for (const [artId, v] of byArt)
      foeDroneWings.push({
        tag: f.tag,
        artId,
        count: v.count,
        alive: v.alive,
        rangeBuff: (battle.foeDroneRangeBuff ?? 1) > 1,
        ...(hangarN > 0 ? { hangar: hangarN } : {}),
      })
  }
  const myUnits = (battle.myFleet && battle.myFleet.length > 0
    ? battle.myFleet
    : [{ tag: 'player', shipId: leaderShipId }]
  ).map((e) => {
    const u = battle.units[e.tag]
    const def = ctx.ships.get(uidDefId(e.shipId))
    const spec = mySpecs.get(e.tag)
    return {
      tag: e.tag,
      shipId: e.shipId,
      defId: uidDefId(e.shipId),
      name: shipDisplayName(state, ctx, e.shipId),
      className: def?.name ?? e.shipId,
      leader: e.tag === 'player',
      hp: u ? { ...u.hp } : { s: 0, a: 0, h: 0 },
      hpMax: u?.hpMax ?? { s: 0, a: 0, h: 0 },
      alive: !!u && u.hp.s + u.hp.a + u.hp.h > 0,
      boosting: battle.ended === null && isAlive(battle, e.tag) && !!spec && (spec.thrusterBoost ?? 0) > 0 && thrusterPhase(battle, bal, unitThrusterCycle(spec, bal)).boosting,
      ...(battle.expeditionAmmo ? { ammoIds: battleAmmoIdsFor(battle, e.tag) } : {}),
      drones: (() => {
        const byArt = new Map<string, { count: number; deployed: number }>()
        for (const [k, p] of Object.entries(battle.dronePools ?? {})) {
          if (!p.alive || !p.artId) continue
          if (dronePoolOwner(k) !== e.tag) continue
          const row = byArt.get(p.artId) ?? { count: 0, deployed: 0 }
          row.count++
          if (p.launched !== false) row.deployed++
          byArt.set(p.artId, row)
        }
        return [...byArt].map(([artId, counts]) => ({ artId, ...counts }))
      })(),
    }
  })
  const cycleUnits = myUnits.flatMap(unit => {
    const spec = mySpecs.get(unit.tag)
    return spec ? [{ spec, shipId: unit.shipId, name: unit.name }] : []
  })
  return {
    nearM: bal.minDistanceM,
    openM,
    maxM: battleMaxDistanceM(battle, me, foes, bal, [...mySpecs.values()]),
    desireMaxM: battleMaxDistanceM(battle, me, foes, bal, [...mySpecs.values()]) * (battle.wormhole?.desireRangeMul ?? 1),
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal, battle.meFoeRangeDebuff ?? 0, battle)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    ...(Object.keys(ammoNames).length > 0 ? { ammoNames } : {}),
    me: meArcs,
    meReload,
    weapons: battleWeaponCyclesOf(battle, cycleUnits, ctx),
    rangeEw: rangeEwBattleSummaryOf(battle),
    rangeEwDetails: battle.rangeEwVersion === 1 ? () => rangeEwBattleView(state, ctx, battle, anomaly, leaderShipId) : undefined,
    devices: battleDeviceCyclesOf(state, ctx, battle, cycleUnits,
      spec => thrusterPhase(battle, bal, unitThrusterCycle(spec, bal))),
    myUnits,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    foeBands,
    gravekeeperStatuses: gravekeeperStatusesOf(battle, foes),
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
    ...(battle.droneLost && Object.keys(battle.droneLost).length > 0 ? { droneLost: battle.droneLost } : {}),
    thrusterBoost: me.thrusterBoost ?? 0,
    thrusterCycle: unitThrusterCycle(me, bal),
    ...(battle.meSpeedMps !== undefined ? { meSpeedMps: battle.meSpeedMps } : {}),
    ...(battle.foeSpeedMps !== undefined ? { foeSpeedMps: battle.foeSpeedMps } : {}),
    foeCanCharge: foes.some((f) => f.foeCanCharge === true),
    foeChargingTags: battle.ended === null
      ? foesWithSupport(battle, foes).filter(f => isAlive(battle, f.tag) && unitSpeedMulOf(f, battle, bal, 'foe') > 1).map(f => f.tag)
      : [],
    ...(() => {
      const links = [
        ...Object.entries(battle.meWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
        ...Object.entries(battle.foeWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
      ].filter(link => isAlive(battle, link.from) && isAlive(battle, link.to)).map(link => ({ ...link,
        fromName: battle.units[link.from]?.name ?? link.from, toName: battle.units[link.to]?.name ?? link.to }))
      return links.length > 0 ? { webLinks: links } : {}
    })(),
    ...(() => {
      const pairs = new Map<string, readonly [string, string]>()
      for (const f of foes) {
        const names = f.foeMountNames ?? []
        const ps = f.foeMountNamePairs ?? []
        for (let i = 0; i < names.length; i++) {
          const n = names[i]!
          if (!pairs.has(n)) pairs.set(n, ps[i] ?? [n, n])
        }
      }
      return pairs.size > 0 ? { foeMounts: [...pairs.keys()], foeMountNamePairs: [...pairs.values()] } : {}
    })(),
    ...(foeDroneWings.length > 0 ? { foeDrones: foeDroneWings } : {}),
  }
}
