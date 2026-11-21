import type { BattleState, BattleShieldFieldStream, BattleShieldFieldLedger } from '../../state'
import { asRaw, cleanPosNum, cleanCountMap } from '../../persistence/raw'

export function cleanRepair(raw: unknown): BattleState['repair'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const units: NonNullable<BattleState['repair']>['units'] = []
  if (Array.isArray(r.units)) {
    for (const u of r.units) {
      const it = asRaw(u)
      const moduleId = typeof it.moduleId === 'string' ? it.moduleId : ''
      const kitId = typeof it.kitId === 'string' ? it.kitId : ''
      if (!moduleId || !kitId) continue
      const unitAt = cleanPosNum(it.nextPulseAtMs)
      units.push({
        moduleId,
        kitId,
        ...(it.free === true ? { free: true } : {}),
        armorPerPulse: cleanPosNum(it.armorPerPulse) ?? 0,
        hullPerPulse: cleanPosNum(it.hullPerPulse) ?? 0,
        stopped: it.stopped === true,
        ...(unitAt !== undefined ? { nextPulseAtMs: unitAt } : {}),
      })
    }
  }
  const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
  const kitsUsedByType = cleanCountMap(r.kitsUsedByType)
  return {
    units,
    kits: cleanCountMap(r.kits) ?? {},
    pulses: Math.floor(cleanPosNum(r.pulses) ?? 0),
    kitsUsed: Math.floor(cleanPosNum(r.kitsUsed) ?? 0),
    ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
    ...(kitsUsedByType !== undefined ? { kitsUsedByType } : {}),
  }
}

export function cleanPulseStreams(raw: unknown): BattleShieldFieldStream[] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const out: BattleShieldFieldStream[] = []
  const rawList = Array.isArray(r.streams) ? r.streams : null
  if (rawList) {
    for (const item of rawList) {
      const s = asRaw(item)
      const pct = cleanPosNum(s.pct)
      if (pct === undefined || pct <= 0) continue
      const ms = cleanPosNum(s.ms)
      if (ms === undefined || ms <= 0) continue
      const nextPulseAtMs = cleanPosNum(s.nextPulseAtMs)
      out.push({
        modelId: typeof s.modelId === 'string' ? s.modelId : '',
        pct,
        ms,
        ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
      })
    }
  } else {
    const pct = cleanPosNum(r.pctPerPulse)
    const ms = cleanPosNum(r.msPerPulse)
    if (pct !== undefined && pct > 0 && ms !== undefined && ms > 0) {
      const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
      out.push({ modelId: '', pct, ms, ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}) })
    }
  }
  return out.length > 0 ? out : undefined
}

export const SHIELD_PULSE_MS_FOR_OLD_SAVE = 15_000

export function cleanShieldCharge(raw: unknown): BattleState['shieldCharge'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const src =
    !Array.isArray(r.streams) && cleanPosNum(r.msPerPulse) === undefined && cleanPosNum(r.pctPerPulse) !== undefined
      ? { ...r, msPerPulse: SHIELD_PULSE_MS_FOR_OLD_SAVE }
      : r
  const streams = cleanPulseStreams(src)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

export function cleanShieldField(raw: unknown): BattleShieldFieldLedger | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const streams = cleanPulseStreams(r)
  if (!streams) return undefined
  return { streams, pulses: Math.floor(cleanPosNum(r.pulses) ?? 0) }
}

export function cleanFoeRepairLedger(
  v: unknown,
): NonNullable<import('../../state').BattleState['foeRepair']> | undefined {
  const r = asRaw(v)
  if (Object.keys(r).length === 0) return undefined
  const next = typeof r.nextPulseAtMs === 'number' && Number.isFinite(r.nextPulseAtMs) ? r.nextPulseAtMs : 0
  const pulses = typeof r.pulses === 'number' && Number.isFinite(r.pulses) ? Math.max(0, Math.floor(r.pulses)) : 0
  const healed = typeof r.healed === 'number' && Number.isFinite(r.healed) ? Math.max(0, r.healed) : 0
  const out: NonNullable<import('../../state').BattleState['foeRepair']> = { pulses, healed }
  if (next > 0) out.nextPulseAtMs = Math.floor(next)
  return out
}
