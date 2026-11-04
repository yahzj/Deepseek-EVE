/** 战斗域职责拆分，保持原计算与顺序。 */
import type { BattleState, BattleFx } from '../../state'
import { asRaw, cleanPosNum } from '../../persistence/raw'
import type { RawState } from '../../save'

/**
 * 我方编队（虫洞 D 批）：`Array<{ tag, shipId }>`——坏项丢弃、同 tag 去重、空表 = undefined
 * （= 不写字段 = 单船路径，旧档零迁移）。首条恒为主控（`tag = 'player'`），但**不强制**：
 * 引擎按 tag 认单位，写死了反而会在数据坏掉时整场弃置（宁可少带一艘僚舰也别丢掉整场战斗）。
 */
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

/**
 * **虫洞战斗标记**（F 批）：`{ cardId, depth, kind, waves }` —— 坏值一律丢弃
 * （丢了只会退回"原卡强度"，不会崩；`kind` 白名单外 / `cardId` 空 ⇒ 丢弃）。
 */
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

/** 单架机群生存池条目（三层血齐备才收；机型/闪避/抗性/备用机字段按形状带过） */
export function cleanDronePoolEntry(raw: unknown): NonNullable<BattleState['dronePools']>[number] | undefined {
  const e = asRaw(raw)
  const s = cleanPosNum(e.s)
  const a = cleanPosNum(e.a)
  const h = cleanPosNum(e.h)
  if (s === undefined || a === undefined || h === undefined) return undefined
  const artId = typeof e.artId === 'string' && e.artId.length > 0 ? e.artId : undefined
  /** 所属舰 tag（2026-09-14「逐舰机群」）：老档没有 ⇒ 由 `cleanDronePools` 按键回填 */
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
    // 抗性表按形状带过（本工程自己的数据；形状坏了就丢弃 ⇒ 退化为"无抗性"，不会崩）
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

/** 我方机群生存池（键 = **`舰tag:武器下标`**；2026-09-14「逐舰机群」起逐舰。
 *  ⚠ **老档的键是纯数字**（下标，只有主控）⇒ 归一成 `player:<下标>`（零迁移、语义不变）；
 *  键形不认识的一律丢弃（脏档不能让它崩）。`owner` 一律以**键**为准回填。 */
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

/** 敌机机群生存池（键 = 敌单位 tag；值为"与该单位 drone 条目同序"的逐架池） */
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

/** 清洗战斗可视化事件环（白名单字段；坏事件丢弃，缺失给空）。seq 按环内顺序重排（旧档无 seq 也能续播） */
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
      seq: out.length, // 按清洗后顺序重排（保序：环内 atMs 递增）
      atMs: Math.max(0, Math.floor(numf(ev.atMs, 0))),
      side,
      tag: typeof ev.tag === 'string' && ev.tag.length > 0 ? ev.tag : side === 'me' ? 'player' : 'foe-0',
      type,
      hit: ev.hit === true,
      ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}),
      ...(ev.src === 'turret' || ev.src === 'missile' || ev.src === 'laser' || ev.src === 'drone' || ev.src === 'base' ? { src: ev.src } : {}),
      ...(typeof ev.artId === 'string' && ev.artId.length > 0 ? { artId: ev.artId } : {}),
      ...(ev.web === true ? { web: true as const } : {}),
      ...(ev.blink === true ? { blink: true as const } : {}),
      ...(ev.droneDown === true ? { droneDown: true } : {}),
      ...(ev.pd === true ? { pd: true } : {}),
      ...(typeof ev.speedX === 'number' && Number.isFinite(ev.speedX) && ev.speedX > 0 ? { speedX: ev.speedX } : {}),
      ...(ev.acidBurst === true && side === 'foe' && type === 'kinetic'
        ? { acidBurst: true as const, ...(typeof ev.to === 'string' && ev.to.length > 0 ? { to: ev.to } : {}) }
        : {}),
      // 本发实收伤害（2026-09-24 船长令：飘字读数）——坏值/缺省一律不写（UI 只飘 MISS）
      ...(typeof ev.dmg === 'number' && Number.isFinite(ev.dmg) && ev.dmg > 0
        ? { dmg: Math.floor(ev.dmg) }
        : {}),
    })
  }
  // 与逐炮演出缓存的硬上限一致，同拍多炮不在读档时再次裁成48条。
  if (out.length > 512) out.splice(0, out.length - 512)
  return out
}
