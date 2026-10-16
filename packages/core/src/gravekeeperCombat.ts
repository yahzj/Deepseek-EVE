import type { BattleState } from './state'
import type { UnitSpec } from './combat'
import { clamp, isAlive } from './combatMath'

type RebirthBattle = Pick<BattleState, 'foeRebirths'> & {
  lastTickGameMs?: number
  units: Record<string, { hp: { s: number; a: number; h: number }; hpMax?: { s: number; a: number; h: number } }>
}

/** 每段只消费该时间段的维修额度，满层溢出不保留到之后补发。 */
export function advanceFoeRebirthRepair(b: RebirthBattle, spec: Pick<UnitSpec, 'tag' | 'hp' | 'foeRebirthProtocol'>, nowMs: number): void {
  const protocol = spec.foeRebirthProtocol
  const record = b.foeRebirths?.[spec.tag]
  const rt = b.units[spec.tag]
  if (!protocol || !record || !rt || rt.hp.s + rt.hp.a + rt.hp.h <= 0) return
  const until = Math.min(nowMs, record.repairUntilMs)
  const dt = Math.max(0, until - record.lastRepairAtMs)
  if (dt <= 0) return
  const max = rt.hpMax ?? spec.hp
  const healA = Math.min(Math.max(0, max.a - rt.hp.a), max.a * protocol.armorTotalPct * dt / protocol.repairMs)
  const healH = Math.min(Math.max(0, max.h - rt.hp.h), max.h * protocol.hullTotalPct * dt / protocol.repairMs)
  rt.hp.a += healA
  rt.hp.h += healH
  record.armorHealed += healA
  record.hullHealed += healH
  record.lastRepairAtMs = until
}

/** 独立到期的装甲叠层；加百分点后封顶，再由酸蚀层减去抗性。 */
export function gravekeeperResistsOf(
  b: Pick<BattleState, 'foeCoatingLayers'>,
  spec: Pick<UnitSpec, 'tag' | 'foeCoatingArmor'>,
  base: UnitSpec['resists'],
  nowMs: number,
): UnitSpec['resists'] {
  const coating = spec.foeCoatingArmor
  if (!coating) return base
  const book = b.foeCoatingLayers
  const active = book?.[spec.tag]?.filter(layer => layer.untilMs > nowMs) ?? []
  if (book?.[spec.tag]) {
    if (active.length) book[spec.tag] = active
    else delete book[spec.tag]
  }
  if (!active.length) return base
  const add = active.length * coating.resistAdd
  return { ...base, armor: {
    kinetic: Math.min(coating.cap, (base.armor?.kinetic ?? 0) + add),
    explosive: Math.min(coating.cap, (base.armor?.explosive ?? 0) + add),
    plasma: Math.min(coating.cap, (base.armor?.plasma ?? 0) + add),
  } }
}

export function activateFoeCapacitor(b: Pick<BattleState, 'foeShieldCapacitorActive'>, tag: string): void {
  const active = b.foeShieldCapacitorActive ?? (b.foeShieldCapacitorActive = {})
  active[tag] = true
}

/** 共享池可能在本次入场前已破盾，也必须启动；回盾后不退出。 */
export function syncFoeCapacitors(b: BattleState, foes: readonly UnitSpec[]): void {
  for (const foe of foes) {
    if (foe.foeShieldCapacitor && b.units[foe.tag]?.hp.s === 0 && isAlive(b, foe.tag)) activateFoeCapacitor(b, foe.tag)
  }
}

export function foeCapacitorRangeBonusOf(b: Pick<BattleState, 'foeShieldCapacitorActive'>, tag: string, device: UnitSpec['foeShieldCapacitor']): number {
  return device && b.foeShieldCapacitorActive?.[tag] ? device.rangeMul - 1 : 0
}

export function foeCapacitorMultiplierOf(b: Pick<BattleState, 'foeShieldCapacitorActive' | 'foeShieldCapacitorAttacks'>, foe: Pick<UnitSpec, 'tag' | 'foeShieldCapacitor'>, index: number | 'pd', kind: 'damageMul' | 'reloadMul'): number {
  if (!foe.foeShieldCapacitor || !b.foeShieldCapacitorActive?.[foe.tag]) return 1
  const count = b.foeShieldCapacitorAttacks?.[`${foe.tag}#${index}`] ?? 0
  // 不设玩法层数上限；仅避免极端长战产生Infinity污染装填或伤害。
  return Math.exp(Math.min(Math.log(Number.MAX_SAFE_INTEGER), count * Math.log(foe.foeShieldCapacitor[kind])))
}

/** 一次武器组攻击至少一炮命中才推进，当前齐射不受新层影响。 */
export function noteFoeCapacitorAttack(b: Pick<BattleState, 'foeShieldCapacitorActive' | 'foeShieldCapacitorAttacks'>, foe: Pick<UnitSpec, 'tag' | 'foeShieldCapacitor'>, index: number | 'pd'): void {
  if (!foe.foeShieldCapacitor || !b.foeShieldCapacitorActive?.[foe.tag]) return
  const book = b.foeShieldCapacitorAttacks ?? (b.foeShieldCapacitorAttacks = {})
  const key = `${foe.tag}#${index}`
  book[key] = clamp(0, Number.MAX_SAFE_INTEGER, (book[key] ?? 0) + 1)
}

export interface GravekeeperStatus {
  name: string
  kind: 'rebirth' | 'coating' | 'capacitor'
  used?: boolean
  lockMs?: number
  repairMs?: number
  layers?: number
  active?: boolean
  attacks?: number
  damageMul?: number
  reloadMul?: number
}

/** 仅为当前在场存活舰提供运行读数，不参与结算、不写战斗状态。 */
export function gravekeeperStatusesOf(b: BattleState, foes: readonly UnitSpec[]): GravekeeperStatus[] {
  return foes.filter(f => isAlive(b, f.tag)).flatMap(f => {
    const out: GravekeeperStatus[] = []
    if (f.foeRebirthProtocol) {
      const r = b.foeRebirths?.[f.tag]
      out.push({name:f.name,kind:'rebirth',used:r !== undefined,
        lockMs:Math.max(0,(r?.lockUntilMs??0)-b.lastTickGameMs), repairMs:Math.max(0,(r?.repairUntilMs??0)-b.lastTickGameMs)})
    }
    if (f.foeCoatingArmor) out.push({name:f.name,kind:'coating',layers:(b.foeCoatingLayers?.[f.tag]??[]).filter(l=>l.untilMs>b.lastTickGameMs).length})
    if (f.foeShieldCapacitor) out.push({name:f.name,kind:'capacitor',active:b.foeShieldCapacitorActive?.[f.tag]===true,
      attacks:b.foeShieldCapacitorAttacks?.[`${f.tag}#0`]??0,
      damageMul:foeCapacitorMultiplierOf(b,f,0,'damageMul'),reloadMul:foeCapacitorMultiplierOf(b,f,0,'reloadMul')})
    return out
  })
}
