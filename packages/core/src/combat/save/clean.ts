import type { BattleState } from '../../state'
import { asRaw, cleanLedgerMap, cleanCountMap, cleanCountMapBy, cleanPosNum, cleanAmmoIdMap } from '../../persistence/raw'
import type { RawState } from '../../save'
import { cleanFx, cleanDronePools, cleanDroneLaunchBy, cleanFoeDronePools, cleanMyFleet, cleanBattleWormhole } from './units'
import { cleanRepair, cleanShieldCharge, cleanFoeRepairLedger, cleanShieldField } from './repair'
import { cleanBattleRangeSnapshot } from '../../battleRangeMemory'
import { BATTLE_PERSIST_KEYS } from './fields'
import { cleanPirateCard } from '../../encounters/save'

export function cleanBattle(raw: unknown): BattleState | null {
  const b = asRaw(raw)
  const numf = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const numi = (v: unknown, fallback: number): number => Math.max(0, Math.floor(numf(v, fallback)))
  const distance = numf(b.distanceM, NaN)
  if (!Number.isFinite(distance) || distance <= 0) return null
  const unitsRaw = b.units
  const units: Record<string, BattleState['units'][string]> = {}
  if (unitsRaw !== null && typeof unitsRaw === 'object') {
    for (const [tag, uRaw] of Object.entries(unitsRaw as RawState)) {
      if (!tag) continue
      const u = asRaw(uRaw)
      const side = u.side === 'me' || u.side === 'foe' ? u.side : null
      if (!side) continue
      const hpRaw = asRaw(u.hp)
      const weaponsRaw = u.weapons
      const weapons: number[] = []
      if (Array.isArray(weaponsRaw)) {
        for (const cd of weaponsRaw) {
          if (typeof cd === 'number' && Number.isFinite(cd)) weapons.push(Math.max(0, cd))
        }
      }
      if (weapons.length === 0) weapons.push(0)
      const hpMaxRaw = asRaw(u.hpMax)
      const hpMaxOk =
        hpMaxRaw !== null &&
        typeof hpMaxRaw === 'object' &&
        typeof (hpMaxRaw as RawState).s === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).s) &&
        typeof (hpMaxRaw as RawState).a === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).a) &&
        typeof (hpMaxRaw as RawState).h === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).h)
      units[tag] = {
        tag,
        side,
        name: typeof u.name === 'string' && u.name.length > 0 ? u.name : tag,
        hp: {
          s: Math.max(0, numf(hpRaw.s, 0)),
          a: Math.max(0, numf(hpRaw.a, 0)),
          h: Math.max(0, numf(hpRaw.h, 0)),
          ...(typeof asRaw(hpRaw.coating).armor === 'number' && typeof asRaw(hpRaw.coating).maxArmor === 'number'
            ? { coating: { armor: Math.min(numf(hpRaw.a, 0), Math.max(0, numf(asRaw(hpRaw.coating).armor, 0))),
                maxArmor: Math.max(0, numf(asRaw(hpRaw.coating).maxArmor, 0)) } } : {}),
        },
        ...(hpMaxOk
          ? {
              hpMax: {
                s: Math.max(0, (hpMaxRaw as RawState).s as number),
                a: Math.max(0, (hpMaxRaw as RawState).a as number),
                h: Math.max(0, (hpMaxRaw as RawState).h as number),
              },
            }
          : {}),
        weapons,
        ...(typeof u.enteredAtMs === 'number' && Number.isFinite(u.enteredAtMs)
          ? { enteredAtMs: numf(u.enteredAtMs, 0) }
          : {}),
        ...(typeof u.stealthUntilMs === 'number' && Number.isFinite(u.stealthUntilMs)
          ? { stealthUntilMs: numf(u.stealthUntilMs, 0) }
          : {}),
        ...(typeof u.foeShipId === 'string' && u.foeShipId.length > 0 ? { foeShipId: u.foeShipId } : {}),
        ...(typeof u.downAtMs === 'number' && Number.isFinite(u.downAtMs) ? { downAtMs: numf(u.downAtMs, 0) } : {}),
      }
    }
  }
  if (Object.keys(units).length === 0) return null
  const ammoRaw = asRaw(b.ammo)
  const statsRaw = asRaw(b.stats)
  const endedRaw = b.ended
  const fx = cleanFx(b.fx, numf)
  const foeOverrideRaw = asRaw(b.foeOverride)
  const foeOverride = ((): BattleState['foeOverride'] => {
    if (foeOverrideRaw === null || typeof foeOverrideRaw !== 'object') return undefined
    const out: NonNullable<BattleState['foeOverride']> = {}
    const generatedCard = cleanPirateCard(foeOverrideRaw.generatedCard)
    if (generatedCard) out.generatedCard = generatedCard
    if (foeOverrideRaw.patrolFormation === true) out.patrolFormation = true
    const t = foeOverrideRaw.threat
    if (typeof t === 'number' && Number.isFinite(t)) out.threat = Math.max(1, Math.round(t))
    const s = foeOverrideRaw.strengthMul
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) out.strengthMul = s
    if (foeOverrideRaw.keepCardWaves === true) out.keepCardWaves = true
    const bh = foeOverrideRaw.bossHp
    if (typeof bh === 'number' && Number.isFinite(bh) && bh > 0) out.bossHp = bh
    const bhm = foeOverrideRaw.bossHpMax
    if (typeof bhm === 'number' && Number.isFinite(bhm) && bhm > 0) out.bossHpMax = Math.round(bhm)
    const layerOf = (raw: unknown): { s: number; a: number; h: number } | undefined => {
      const o = asRaw(raw)
      if (o === null || typeof o !== 'object') return undefined
      const ok = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
      const s = ok(o.s)
      const a = ok(o.a)
      const h = ok(o.h)
      return s !== undefined && a !== undefined && h !== undefined ? { s, a, h } : undefined
    }
    const bhl = layerOf(foeOverrideRaw.bossHpLayers)
    if (bhl !== undefined) out.bossHpLayers = bhl
    const bml = layerOf(foeOverrideRaw.bossMaxLayers)
    if (bml !== undefined) out.bossMaxLayers = bml
    const bsid = foeOverrideRaw.bossShipId
    if (typeof bsid === 'string' && bsid.length > 0) out.bossShipId = bsid
    const w = foeOverrideRaw.waves
    if (Array.isArray(w)) {
      const waves: Array<{ units: number; hpShare: number }> = []
      for (const x of w) {
        const r = asRaw(x)
        if (r === null || typeof r !== 'object') continue
        waves.push({ units: Math.max(1, Math.floor(numf(r.units, 1))), hpShare: Math.max(0, numf(r.hpShare, 1)) })
      }
      if (waves.length > 0) out.waves = waves
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const repair = cleanRepair(b.repair)
  const shieldCharge = cleanShieldCharge(b.shieldCharge)
  const repairBy = cleanLedgerMap(b.repairBy, cleanRepair)
  const repairDroneBy = cleanLedgerMap(b.repairDroneBy, raw => {
    const row = asRaw(raw)
    const pulses = cleanPosNum(row.pulses), kitsUsed = cleanPosNum(row.kitsUsed)
    if (pulses === undefined || kitsUsed === undefined || !Number.isSafeInteger(pulses) || !Number.isSafeInteger(kitsUsed)) return undefined
    const kitsUsedByType = cleanCountMap(row.kitsUsedByType) ?? {}
    if (Object.values(kitsUsedByType).reduce((sum, n) => sum + n, 0) !== kitsUsed) return undefined
    return { pulses, kitsUsed, kitsUsedByType }
  })
  const foeRepair = cleanFoeRepairLedger(b.foeRepair)
  const shieldChargeBy = cleanLedgerMap(b.shieldChargeBy, cleanShieldCharge)
  const foeRepairPulses = cleanLedgerMap(b.foeRepairPulses, cleanFoeRepairLedger)
  const foeReviveAtMs =
    typeof b.foeReviveAtMs === 'number' && Number.isFinite(b.foeReviveAtMs) && b.foeReviveAtMs > 0
      ? b.foeReviveAtMs
      : undefined
  const foeReviveCount =
    typeof b.foeReviveCount === 'number' && Number.isFinite(b.foeReviveCount) && b.foeReviveCount > 0
      ? Math.floor(b.foeReviveCount)
      : undefined
  const shieldFieldBy = cleanLedgerMap(b.shieldFieldBy, cleanShieldField)
  const dronePools = cleanDronePools(b.dronePools)
  const droneLaunchBy = cleanDroneLaunchBy(b.droneLaunchBy)
  const foeDronePools = cleanFoeDronePools(b.foeDronePools)
  const droneLost = cleanCountMap(b.droneLost)
  const droneLoadAtStart = cleanCountMap(b.droneLoadAtStart)
  const droneLostBy = cleanCountMapBy(b.droneLostBy)
  const droneLoadAtStartBy = cleanCountMapBy(b.droneLoadAtStartBy, true)
  const droneRevive = cleanLedgerMap(b.droneRevive, (raw) => {
    const r = asRaw(raw)
    const shipId = typeof r.shipId === 'string' && r.shipId.length > 0 ? r.shipId : undefined
    if (shipId === undefined) return undefined
    const c = Array.isArray(r.c)
      ? r.c.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
      : []
    if (c.length === 0) return undefined
    const q = Array.isArray(r.q) ? r.q.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const tRaw = Array.isArray(r.t) ? r.t : []
    const t: Array<number | undefined> = c.map((_, i) => {
      const x = tRaw[i]
      return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined
    })
    const v = cleanCountMap(r.v) ?? {}
    return { q, t, c, v, shipId, ...(r.printing === true ? { printing: true } : {}) }
  })
  const droneReviveStock = cleanCountMap(b.droneReviveStock)
  const alienCorrosion = typeof b.alienCorrosion === 'number' && Number.isFinite(b.alienCorrosion) && b.alienCorrosion > 0 ? b.alienCorrosion : undefined
  const acidBursts = cleanLedgerMap(b.acidBursts, raw => {
    const r = asRaw(raw)
    if ((r.cause !== 'attack' && r.cause !== 'killed') || typeof r.atMs !== 'number' || !Number.isFinite(r.atMs) || r.atMs < 0) return undefined
    return { cause: r.cause as 'attack' | 'killed', atMs: r.atMs, resolved: r.resolved !== false }
  })
  const foeHatcheries = cleanLedgerMap(b.foeHatcheries, raw => {
    const r = asRaw(raw)
    if ((r.left !== 'unlimited' && (typeof r.left !== 'number' || !Number.isInteger(r.left) || r.left < 0)) || typeof r.revived !== 'number' || !Number.isInteger(r.revived) || r.revived < 0) return undefined
    const queue: NonNullable<BattleState['foeHatcheries']>[string]['queue'] = []
    for (const raw of Array.isArray(r.queue) ? r.queue : []) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) { if (!queue.includes(raw)) queue.push(raw); continue }
      const slot = asRaw(raw)
      if (typeof slot.tag !== 'string' || slot.tag.length === 0 || typeof slot.index !== 'number' || !Number.isInteger(slot.index) || slot.index < 0) continue
      if (!queue.some(i => typeof i !== 'number' && i.tag === slot.tag && i.index === slot.index)) queue.push({ tag: slot.tag, index: slot.index })
    }
    return { left: r.left, revived: r.revived, queue, ...(typeof r.nextAtMs === 'number' && Number.isFinite(r.nextAtMs) && r.nextAtMs >= 0 ? { nextAtMs: r.nextAtMs } : {}) }
  })
  const foeAbilityClocks = cleanLedgerMap(b.foeAbilityClocks, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeSummonAtMs = cleanLedgerMap(b.foeSummonAtMs, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const foeDroneRangeBuff = cleanPosNum(b.foeDroneRangeBuff)
  const foeGunRangeBuff = cleanPosNum(b.foeGunRangeBuff)
  const myWebs = cleanLedgerMap(b.myWebs, (raw) => {
    const r = asRaw(raw)
    const cd = r.cooldownUntilMs
    if (typeof cd !== 'number' || !Number.isFinite(cd) || cd < 0) return undefined
    const tt = typeof r.targetTag === 'string' && r.targetTag.length > 0 ? r.targetTag : undefined
    return { ...(tt !== undefined ? { targetTag: tt } : {}), cooldownUntilMs: cd }
  })
  const foeWebDebuffs = cleanLedgerMap(b.foeWebDebuffs, (raw) => {
    const r = asRaw(raw)
    const byTag = r.byTag
    if (typeof byTag !== 'string' || byTag.length === 0) return undefined
    return {
      byTag,
      slowMul: typeof r.slowMul === 'number' && Number.isFinite(r.slowMul) && r.slowMul > 0 && r.slowMul <= 1 ? r.slowMul : 0.5,
      noThruster: true as const,
      noEvasion: true as const,
      atMs: Math.max(0, numf(r.atMs, 0)),
    }
  })
  const dc = ((): BattleState['dc'] => {
    const raw = asRaw(b.dc)
    if (raw === null || typeof raw !== 'object') return undefined
    const out: NonNullable<BattleState['dc']> = {}
    for (const [tag, v] of Object.entries(raw)) {
      if (tag.length === 0) continue
      const o = asRaw(v)
      if (o === null || typeof o !== 'object') continue
      const entry: { lockUntilMs?: number; used?: boolean } = {}
      const lk = cleanPosNum(o.lockUntilMs)
      if (lk !== undefined && lk > 0) entry.lockUntilMs = Math.round(lk)
      if (o.used === true) entry.used = true
      if (entry.lockUntilMs !== undefined || entry.used === true) out[tag] = entry
    }
    return Object.keys(out).length > 0 ? out : undefined
  })()
  const dcKitsUsed = cleanPosNum(b.dcKitsUsed)
  const foeRebirths = cleanLedgerMap(b.foeRebirths, (raw) => {
    const r = asRaw(raw)
    const keys = ['lockUntilMs', 'startedAtMs', 'repairUntilMs', 'lastRepairAtMs', 'armorHealed', 'hullHealed'] as const
    if (keys.some(key => cleanPosNum(r[key]) === undefined)) return undefined
    return Object.fromEntries(keys.map(key => [key, r[key]])) as NonNullable<BattleState['foeRebirths']>[string]
  })
  const bossDownAtMs = cleanPosNum(b.bossDownAtMs)
  const cleaned: Partial<Record<keyof BattleState, unknown>> = {
    ...(b.rangeEwVersion === 1 ? { rangeEwVersion: 1 } : {}),
    ...(b.enemyFormationVersion === 1 ? { enemyFormationVersion: 1 } : {}),
    ...(() => {
      const now = Math.max(0, numf(b.lastTickGameMs, 0))
      const foeAcidLayers = cleanLedgerMap(b.foeAcidLayers, (raw) => {
        if (!Array.isArray(raw)) return undefined
        const layers = raw.flatMap(value => {
          const layer = asRaw(value)
          return typeof layer.cutPct === 'number' && Number.isFinite(layer.cutPct) && layer.cutPct > 0 && layer.cutPct <= 1 &&
            typeof layer.untilMs === 'number' && Number.isFinite(layer.untilMs) && layer.untilMs > now
            ? [{ cutPct: layer.cutPct, untilMs: layer.untilMs }] : []
        })
        return layers.length ? layers : undefined
      })
      return foeAcidLayers === undefined ? {} : { foeAcidLayers }
    })(),
    startedAtGameMs: Math.max(0, Math.floor(numf(b.startedAtGameMs, 0))),
    ...(foeOverride !== undefined ? { foeOverride } : {}),
    lastTickGameMs: Math.max(0, Math.floor(numf(b.lastTickGameMs, 0))),
    distanceM: Math.max(0, distance),
    myDesireM: Math.max(0, numf(b.myDesireM, distance)),
    ...(cleanBattleRangeSnapshot(b.rangeMemory) ? { rangeMemory: cleanBattleRangeSnapshot(b.rangeMemory) } : {}),
    units,
    ammo: {
      kin: numi(ammoRaw.kin, 0),
      exp: numi(ammoRaw.exp, 0),
      pla: numi(ammoRaw.pla, 0),
    },
    ...(() => {
      const raw = asRaw(b.ammoLoaded)
      const ok =
        typeof raw.kin === 'number' &&
        Number.isFinite(raw.kin) &&
        typeof raw.exp === 'number' &&
        Number.isFinite(raw.exp) &&
        typeof raw.pla === 'number' &&
        Number.isFinite(raw.pla)
      return ok
        ? { ammoLoaded: { kin: Math.max(0, Math.floor(raw.kin as number)), exp: Math.max(0, Math.floor(raw.exp as number)), pla: Math.max(0, Math.floor(raw.pla as number)) } }
        : {}
    })(),
    stats: {
      meShots: numi(statsRaw.meShots, 0),
      meHits: numi(statsRaw.meHits, 0),
      meDmg: Math.max(0, numf(statsRaw.meDmg, 0)),
      foeShots: numi(statsRaw.foeShots, 0),
      foeHits: numi(statsRaw.foeHits, 0),
    },
    fx,
    fxSeq: fx.length > 0 ? fx[fx.length - 1]!.seq + 1 : 0,
    ended: endedRaw === 'me' || endedRaw === 'foe' ? endedRaw : null,
    ...(typeof b.hullEscapeFrac === 'number' && Number.isFinite(b.hullEscapeFrac)
      ? { hullEscapeFrac: b.hullEscapeFrac }
      : {}),
    ...(b.autoEscaped === true ? { autoEscaped: true } : {}),
    ...(b.escapeReason === 'hull' || b.escapeReason === 'timeout' || b.escapeReason === 'cannot-engage'
      ? { escapeReason: b.escapeReason }
      : {}),
    ...(dc !== undefined ? { dc } : {}),
    ...(dcKitsUsed !== undefined && dcKitsUsed > 0 ? { dcKitsUsed: Math.floor(dcKitsUsed) } : {}),
    waveIdx:
      typeof b.waveIdx === 'number' && Number.isFinite(b.waveIdx) && b.waveIdx > 0
        ? Math.floor(b.waveIdx)
        : undefined,
    waveClearAt:
      typeof b.waveClearAt === 'number' && Number.isFinite(b.waveClearAt) && b.waveClearAt > 0
        ? b.waveClearAt
        : undefined,
    foeWaveStartMs:
      typeof b.foeWaveStartMs === 'number' && Number.isFinite(b.foeWaveStartMs) && b.foeWaveStartMs > 0
        ? b.foeWaveStartMs
        : undefined,
    ammoIds: cleanAmmoIdMap(b.ammoIds),
    ammoCreditByWeapon: (() => {
      const out: Record<string, number> = {}
      for (const [key, value] of Object.entries(asRaw(b.ammoCreditByWeapon))) {
        const match = /^([A-Za-z][\w-]*)#(\d+):(kinetic|explosive|plasma)$/.exec(key)
        if (!match || !units[match[1]!] || units[match[1]!]!.side !== 'me' || Number(match[2]) >= units[match[1]!]!.weapons.length) continue
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) out[key] = value
      }
      return Object.keys(out).length ? out : undefined
    })(),
    expeditionAmmo: b.expeditionAmmo === undefined ? undefined : (() => {
      const r = asRaw(b.expeditionAmmo)
      const idsByTag: NonNullable<BattleState['expeditionAmmo']>['idsByTag'] = {}
      for (const [tag, ids] of Object.entries(asRaw(r.idsByTag))) idsByTag[tag] = cleanAmmoIdMap(ids) ?? {}
      return {
        stock: cleanCountMap(r.stock) ?? {}, loaded: cleanCountMap(r.loaded) ?? {}, idsByTag,
        ...(r.revivesSettled === true ? { revivesSettled: true } : {}),
      }
    })(),
    myFleet: cleanMyFleet(b.myFleet),
    wormhole: cleanBattleWormhole(b.wormhole),
    ...(repair !== undefined ? { repair } : {}),
  ...(shieldCharge !== undefined ? { shieldCharge } : {}),
    ...(repairBy !== undefined ? { repairBy } : {}),
    ...(repairDroneBy !== undefined ? { repairDroneBy } : {}),
    ...(shieldChargeBy !== undefined ? { shieldChargeBy } : {}),
    ...(shieldFieldBy !== undefined ? { shieldFieldBy } : {}),
    ...(foeRepair !== undefined ? { foeRepair } : {}),
    ...(foeRepairPulses !== undefined ? { foeRepairPulses } : {}),
    ...(foeReviveAtMs !== undefined ? { foeReviveAtMs } : {}),
    ...(foeReviveCount !== undefined ? { foeReviveCount } : {}),
    ...(myWebs !== undefined ? { myWebs } : {}),
    ...(foeWebDebuffs !== undefined ? { foeWebDebuffs } : {}),
    ...(dronePools !== undefined ? { dronePools } : {}),
    ...(droneLaunchBy !== undefined ? { droneLaunchBy } : {}),
    ...(foeDronePools !== undefined ? { foeDronePools } : {}),
    ...(droneLost !== undefined ? { droneLost } : {}),
    ...(droneLoadAtStart !== undefined ? { droneLoadAtStart } : {}),
    ...(typeof b.droneCommandVolumeM3 === 'number' && Number.isFinite(b.droneCommandVolumeM3) && b.droneCommandVolumeM3 >= 0
      ? { droneCommandVolumeM3: b.droneCommandVolumeM3 } : {}),
    ...(droneLostBy !== undefined ? { droneLostBy } : {}),
    ...(droneLoadAtStartBy !== undefined ? { droneLoadAtStartBy } : {}),
    ...(droneRevive !== undefined ? { droneRevive } : {}),
    ...(droneReviveStock !== undefined ? { droneReviveStock } : {}),
    ...(alienCorrosion !== undefined ? { alienCorrosion } : {}),
    ...(acidBursts !== undefined ? { acidBursts } : {}),
    ...(foeAbilityClocks !== undefined ? { foeAbilityClocks } : {}),
    ...(foeSummonAtMs !== undefined ? { foeSummonAtMs } : {}),
    ...(foeHatcheries !== undefined ? { foeHatcheries } : {}),
    ...(foeDroneRangeBuff !== undefined ? { foeDroneRangeBuff } : {}),
    ...(foeGunRangeBuff !== undefined ? { foeGunRangeBuff } : {}),
    ...(foeRebirths !== undefined ? { foeRebirths } : {}),
    ...(() => {
      const meRebirths = cleanLedgerMap(b.meRebirths, raw => {
        const r = asRaw(raw)
        const keys = ['repairUntilMs', 'lastRepairAtMs', 'armorHealed', 'hullHealed'] as const
        if (keys.some(key => cleanPosNum(r[key]) === undefined)) return undefined
        return Object.fromEntries(keys.map(key => [key, r[key]])) as NonNullable<BattleState['meRebirths']>[string]
      })
      const meCrisisActive = cleanLedgerMap(b.meCrisisActive, value => value === true ? true as const : undefined)
      const meRailStacks = cleanLedgerMap(b.meRailStacks, value => typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.min(5, Math.floor(value)) : undefined)
      return { ...(meRebirths ? { meRebirths } : {}), ...(meCrisisActive ? { meCrisisActive } : {}), ...(meRailStacks ? { meRailStacks } : {}) }
    })(),
    ...(bossDownAtMs !== undefined ? { bossDownAtMs: Math.round(bossDownAtMs) } : {}),
  }
  const out: Partial<BattleState> = {}
  for (const key of BATTLE_PERSIST_KEYS) {
    const v = cleaned[key]
    if (v !== undefined) (out as Record<string, unknown>)[key as string] = v
  }
  return out as BattleState
}
