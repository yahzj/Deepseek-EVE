import type { BattleState, BattleFx } from '../../state'
import { asRaw, cleanPosNum } from '../../persistence/raw'
import type { RawState } from '../../save'

export function cleanMyFleet(raw: unknown): BattleState['myFleet'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: NonNullable<BattleState['myFleet']> = []
  for (const item of raw) {
    const e = asRaw(item)
    const tag = typeof e.tag === 'string' && e.tag.length > 0 ? e.tag : null
    const shipId = typeof e.shipId === 'string' && e.shipId.length > 0 ? e.shipId : null
    if (!tag || !shipId || seen.has(tag)) continue
    seen.add(tag)
    out.push({ tag, shipId })
  }
  return out.length > 0 ? out : undefined
}

export function cleanBattleWormhole(raw: unknown): BattleState['wormhole'] | undefined {
  const w = asRaw(raw)
  const cardId = typeof w.cardId === 'string' && w.cardId.length > 0 ? w.cardId : null
  const kind =
    w.kind === 'node' || w.kind === 'boss' || w.kind === 'extract' || w.kind === 'ruins' || w.kind === 'spawn' ? w.kind : null
  const depth = cleanPosNum(w.depth)
  const waves = cleanPosNum(w.waves)
  if (!cardId || !kind || depth === undefined || waves === undefined) return undefined
  return {
    cardId,
    kind,
    depth: Math.max(1, Math.floor(depth)),
    waves: Math.max(1, Math.floor(waves)),
    ...(typeof w.expeditionRules === 'number' && Number.isSafeInteger(w.expeditionRules) ? { expeditionRules: w.expeditionRules } : {}),
    ...(w.expeditionRole === 'ordinary' || w.expeditionRole === 'elite' || w.expeditionRole === 'guard' || w.expeditionRole === 'patrol' || w.expeditionRole === 'event' ? { expeditionRole: w.expeditionRole } : {}),
    ...(w.guardSupportDisabled === true ? { guardSupportDisabled: true } : {}),
    ...(w.desireRangeMul === 0.8 ? { desireRangeMul: 0.8 } : {}),
    ...(typeof w.threatMul === 'number' && w.threatMul > 0 && Number.isFinite(w.threatMul) ? { threatMul: w.threatMul } : {}),
    ...(typeof w.foeHitDown === 'number' && w.foeHitDown > 0 && Number.isFinite(w.foeHitDown) ? { foeHitDown: w.foeHitDown } : {}),
    ...(typeof w.blindReduce === 'number' && w.blindReduce > 0 && Number.isFinite(w.blindReduce) ? { blindReduce: w.blindReduce } : {}),
    ...(w.foeMainType === 'kinetic' || w.foeMainType === 'explosive' || w.foeMainType === 'plasma' ? { foeMainType: w.foeMainType } : {}),
    ...(w.volleyOverflow === true ? { volleyOverflow: true } : {}),
  }
}

export function cleanDronePoolEntry(raw: unknown): NonNullable<BattleState['dronePools']>[number] | undefined {
  const e = asRaw(raw)
  const s = cleanPosNum(e.s)
  const a = cleanPosNum(e.a)
  const h = cleanPosNum(e.h)
  if (s === undefined || a === undefined || h === undefined) return undefined
  const artId = typeof e.artId === 'string' && e.artId.length > 0 ? e.artId : undefined
  const owner = typeof e.owner === 'string' && e.owner.length > 0 ? e.owner : undefined
  const readyAtMs = cleanPosNum(e.readyAtMs)
  const maxS = cleanPosNum(e.maxS)
  const maxA = cleanPosNum(e.maxA)
  const maxH = cleanPosNum(e.maxH)
  return {
    s,
    a,
    h,
    alive: e.alive === true,
    ...(typeof e.launched === 'boolean' ? { launched: e.launched } : {}),
    ...(e.launchRequeued === true ? { launchRequeued: true as const } : {}),
    ...(artId !== undefined ? { artId } : {}),
    ...(owner !== undefined ? { owner } : {}),
    evasion: cleanPosNum(e.evasion) ?? 0,
    ...(e.resists !== null && typeof e.resists === 'object'
      ? { resists: e.resists as NonNullable<BattleState['dronePools']>[number]['resists'] }
      : {}),
    ...(e.inHangar === true ? { inHangar: true } : {}),
    ...(readyAtMs !== undefined ? { readyAtMs } : {}),
    ...(maxS !== undefined ? { maxS } : {}),
    ...(maxA !== undefined ? { maxA } : {}),
    ...(maxH !== undefined ? { maxH } : {}),
  }
}

export function cleanDroneLaunchBy(raw: unknown): BattleState['droneLaunchBy'] {
  const out: NonNullable<BattleState['droneLaunchBy']> = {}
  for (const [tag, value] of Object.entries(asRaw(raw))) {
    if (!/^[A-Za-z][\w-]*$/.test(tag)) continue
    const row = asRaw(value)
    const nextAtMs = cleanPosNum(row.nextAtMs), gapMs = cleanPosNum(row.gapMs)
    if (!Array.isArray(row.q) || nextAtMs === undefined || gapMs === undefined) continue
    const reviveGapMs = cleanPosNum(row.reviveGapMs)
    out[tag] = { q: [...new Set(row.q.filter((k): k is string => typeof k === 'string' && k.startsWith(`${tag}:`) && /^\d+$/.test(k.slice(tag.length + 1))))], nextAtMs, gapMs: Math.max(10, gapMs),
      ...(reviveGapMs !== undefined ? { reviveGapMs: Math.max(10, reviveGapMs) } : {}) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function cleanDronePools(raw: unknown): BattleState['dronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['dronePools']> | undefined
  for (const [k, v] of Object.entries(r)) {
    const entry = cleanDronePoolEntry(v)
    if (!entry) continue
    let key: string
    if (/^\d+$/.test(k)) key = `${entry.owner && entry.owner !== 'player' ? entry.owner : 'player'}:${k}`
    else if (/^[A-Za-z][\w-]*:\d+$/.test(k)) key = k
    else continue
    const sep = key.indexOf(':')
    const wi = Number.parseInt(key.slice(sep + 1), 10)
    if (!Number.isFinite(wi) || wi < 0) continue
    if (!out) out = {}
    out[key] = { ...entry, owner: key.slice(0, sep) }
  }
  return out
}

export function cleanFoeDronePools(raw: unknown): BattleState['foeDronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['foeDronePools']> | undefined
  for (const [tag, arrRaw] of Object.entries(r)) {
    if (!tag || !Array.isArray(arrRaw)) continue
    const arr: NonNullable<BattleState['foeDronePools']>[string] = []
    for (const one of arrRaw) {
      const entry = cleanDronePoolEntry(one)
      if (entry) arr.push(entry)
    }
    if (arr.length === 0) continue
    if (!out) out = {}
    out[tag] = arr
  }
  return out
}

export function cleanFx(raw: unknown, numf: (v: unknown, fallback: number) => number): BattleFx[] {
  const out: BattleFx[] = []
  if (!Array.isArray(raw)) return out
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue
    const ev = e as RawState
    const side = ev.side === 'me' || ev.side === 'foe' ? ev.side : null
    const type =
      ev.type === 'kinetic' || ev.type === 'explosive' || ev.type === 'plasma' ? ev.type : null
    if (!side || !type) continue
    out.push({
      seq: out.length,
      atMs: Math.max(0, Math.floor(numf(ev.atMs, 0))),
      side,
      tag: typeof ev.tag === 'string' && ev.tag.length > 0 ? ev.tag : side === 'me' ? 'player' : 'foe-0',
      type,
      hit: ev.hit === true,
      ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}),
      ...(ev.src === 'turret' || ev.src === 'missile' || ev.src === 'laser' || ev.src === 'drone' || ev.src === 'base' ? { src: ev.src } : {}),
      ...(typeof ev.artId === 'string' && ev.artId.length > 0 ? { artId: ev.artId } : {}),
      ...(ev.web === true ? { web: true as const } : {}),
      ...(ev.repair && typeof ev.repair === 'object' && side === 'me' && ev.src === 'drone'
        && Number.isSafeInteger((ev.repair as RawState).droneIndex) && Number((ev.repair as RawState).droneIndex) >= 0
        && Number.isFinite((ev.repair as RawState).armor) && Number((ev.repair as RawState).armor) >= 0
        && Number.isFinite((ev.repair as RawState).hull) && Number((ev.repair as RawState).hull) >= 0
        ? { repair: { armor: Number((ev.repair as RawState).armor), hull: Number((ev.repair as RawState).hull), droneIndex: Number((ev.repair as RawState).droneIndex) } } : {}),
      ...(ev.blink === true ? { blink: true as const } : {}),
      ...(ev.droneDown === true ? { droneDown: true } : {}),
      ...(ev.pd === true ? { pd: true } : {}),
      ...(typeof ev.speedX === 'number' && Number.isFinite(ev.speedX) && ev.speedX > 0 ? { speedX: ev.speedX } : {}),
      ...(ev.acidBurst === true && side === 'foe' && type === 'kinetic'
        ? { acidBurst: true as const, ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}) }
        : {}),
      ...(typeof ev.dmg === 'number' && Number.isFinite(ev.dmg) && ev.dmg > 0
        ? { dmg: Math.floor(ev.dmg) }
        : {}),
    })
  }
  if (out.length > 512) out.splice(0, out.length - 512)
  return out
}
