import type { UnitSpec } from './combat'
import type { BattleState } from './state'
import type { FoeMountDef, FoeShipDef } from './types'
import { isAlive, RESIST_FLOOR, battleShowWindowMs } from './combatMath'
import { BATTLE_ARRIVAL_FLY_MS } from './combatFx'

type AcidBattle = Pick<BattleState, 'alienCorrosion' | 'acidBursts'> & {
  distanceM?: number
  units: Record<string, { hp: { s: number; a: number; h: number }; downAtMs?: number }>
}

export function triggerAcidBurst(
  battle: AcidBattle,
  foe: { tag: string; acidBurst?: FoeShipDef['acidBurst'] },
  cause: 'attack' | 'killed',
  atMs: number,
): boolean {
  const effect = foe.acidBurst
  const rt = battle.units[foe.tag]
  if (!effect || !rt || battle.acidBursts?.[foe.tag]) return false
  if (cause === 'attack' && rt.hp.s + rt.hp.a + rt.hp.h <= 0) return false
  const range = cause === 'attack' ? effect.attackRangeM : effect.deathRangeM
  if (battle.distanceM === undefined || battle.distanceM > range) return false
  const book = battle.acidBursts ?? (battle.acidBursts = {})
  // 伤害在敌方开火段结算，先记录事件；旧纯状态单位仍立即施加腐蚀。
  book[foe.tag] = { cause, atMs, resolved: !((effect.damage ?? 0) > 0) }
  if (book[foe.tag]!.resolved) battle.alienCorrosion = (battle.alienCorrosion ?? 0) + effect.corrosionPct
  if (cause === 'attack') {
    rt.hp = { s: 0, a: 0, h: 0 }
    rt.downAtMs ??= atMs
  }
  return true
}

export function applyAlienCorrosion(spec: UnitSpec, pct: number): void {
  const delta = pct - (spec.corrosionAppliedPct ?? 0)
  if (!(delta > 0)) return
  // 2026-10-09 船长确认：酸液腐蚀只削减装甲抗性。
  const current = spec.resists.armor
  spec.resists.armor = {
    kinetic: Math.max(RESIST_FLOOR, (current?.kinetic ?? 0) - delta),
    explosive: Math.max(RESIST_FLOOR, (current?.explosive ?? 0) - delta),
    plasma: Math.max(RESIST_FLOOR, (current?.plasma ?? 0) - delta),
  }
  spec.corrosionAppliedPct = pct
}

export function advanceFoeHatcheries(
  battle: BattleState,
  foes: readonly { tag: string; foeHatchery?: FoeMountDef['hatchery'] }[],
  nowMs: number,
): void {
  if (battle.ended !== null) return
  // 同拍无限补损先处理，有限载体随后重读空槽，避免无效扣库存。
  const carriers = foes.filter(foe => foe.foeHatchery).sort((a, b) => Number(b.foeHatchery!.stock === 'unlimited') - Number(a.foeHatchery!.stock === 'unlimited'))
  for (const foe of carriers) {
    const config = foe.foeHatchery
    if (!config) continue
    const book = battle.foeHatcheries ?? (battle.foeHatcheries = {})
    const ledger = book[foe.tag] ?? (book[foe.tag] = { left: config.stock, revived: 0, queue: [] })
    if (!isAlive(battle, foe.tag)) {
      ledger.queue = []
      delete ledger.nextAtMs
      continue
    }
    const owners = config.fleet ? foes.filter(owner => isAlive(battle, owner.tag)) : [foe]
    const ownerTags = new Set(owners.map(owner => owner.tag))
    const slotOf = (slot: (typeof ledger.queue)[number]) => typeof slot === 'number' ? { tag: foe.tag, index: slot } : slot
    const missing = (slot: (typeof ledger.queue)[number]) => {
      const { tag, index } = slotOf(slot)
      const pool = battle.foeDronePools?.[tag]?.[index]
      return ownerTags.has(tag) && isAlive(battle, tag) && !!pool && !pool.alive && !pool.inHangar
    }
    ledger.queue = ledger.queue.filter(missing)
    for (const owner of owners) {
      for (const [index, pool] of (battle.foeDronePools?.[owner.tag] ?? []).entries()) {
        if (!pool.alive && !pool.inHangar && !ledger.queue.some(slot => { const ref = slotOf(slot); return ref.tag === owner.tag && ref.index === index })) {
          ledger.queue.push({ tag: owner.tag, index })
        }
      }
    }
    if (ledger.left === 0 || ledger.queue.length === 0) {
      delete ledger.nextAtMs
      continue
    }
    ledger.nextAtMs ??= nowMs + config.cycleMs
    if (ledger.nextAtMs > nowMs) continue
    while (ledger.left !== 0 && ledger.queue.length > 0) {
      const { tag, index } = slotOf(ledger.queue.shift()!)
      const pool = battle.foeDronePools?.[tag]?.[index]
      if (pool && !pool.alive) {
        pool.s = pool.maxS ?? 0
        pool.a = pool.maxA ?? 0
        pool.h = pool.maxH ?? 0
        pool.alive = true
        pool.inHangar = false
        delete pool.readyAtMs
        if (typeof ledger.left === 'number') ledger.left -= 1
        ledger.revived += 1
        const weaponIndex = index + 1
        if (battle.units[tag]) battle.units[tag]!.weapons[weaponIndex] = 0
      }
    }
    // 一次周期补齐当时战损，之后等待新战损，不能预积累补损次数。
    delete ledger.nextAtMs
  }
}

export function advanceFoeAbilityClocks(battle: BattleState, foes: readonly UnitSpec[], dtMs: number): void {
  for (const foe of foes) {
    if (!foe.foeFleetSpeedRamp && !foe.foeReviveEscort?.activeClock && !foe.foeSummonEscort?.activeClock) continue
    if (!isAlive(battle, foe.tag)) continue
    const rt = battle.units[foe.tag]!
    const entry = rt.enteredAtMs === undefined ? battle.startedAtGameMs : rt.enteredAtMs + battleShowWindowMs(battle, BATTLE_ARRIVAL_FLY_MS)
    const from = Math.max(battle.lastTickGameMs, entry)
    const elapsed = Math.max(0, Math.min(dtMs, battle.lastTickGameMs + dtMs - from))
    const clocks = battle.foeAbilityClocks ?? (battle.foeAbilityClocks = {})
    clocks[foe.tag] = (clocks[foe.tag] ?? 0) + elapsed
  }
}

/** 只读取当前存活来源，不把加成永久写入舰体规格。 */
export function foeFleetSpeedMulOf(battle: BattleState, foes: readonly UnitSpec[]): number {
  let bonus = 0
  for (const foe of foes) {
    const ramp = foe.foeFleetSpeedRamp
    if (!ramp || !isAlive(battle, foe.tag)) continue
    const seconds = Math.floor((battle.foeAbilityClocks?.[foe.tag] ?? 0) / 1000)
    bonus = Math.max(bonus, Math.min(1, seconds * 1000 / ramp.rampMs) * ramp.maxBonusPct)
  }
  return 1 + bonus
}
