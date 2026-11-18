
import { DEFAULT_BALANCE } from './balance'
import type { BattleBalance, DroneClass, FittedModules, ItemDef, ItemKind, ModuleSlot, RackSlot, ShipRole, ShipSlots } from './types'

export const MODULE_SLOTS: readonly ModuleSlot[] = [
  'miner',
  'cargo',
  'turret',
  'missile',
  'laser',
  'salvager',
  'shield',
  'armor',
  'propulsion',
  'drone-rack',
  'drone-tac',
  'drone-relay',
  'drone-launch',
  'drone-deck',
  'drone-shield',
  'support',
  'cpu',
  'target-lock',
  'shield-field',
  'plug',
]

export const SLOT_LABELS: Record<ModuleSlot, string> = {
  miner: '采集器',
  cargo: '货舱扩展',
  turret: '炮台',
  missile: '导弹架',
  laser: '激光炮',
  salvager: '打捞器',
  shield: '护盾装置',
  armor: '装甲装置',
  propulsion: '推进器',
  'drone-rack': '无人机甲板扩展',
  'drone-tac': '战术导控阵列',
  'drone-relay': '无人机中继天线',
  'drone-launch': '无人机出击加速器',
  'drone-deck': '无人机储备甲板',
  'drone-shield': '无人机护盾投射仪',
  support: '支援件',
  cpu: '协处理器',
  'target-lock': '锁定装置',
  'shield-field': '护盾力场',
  plug: '舰船插件',
}

export function slotLabel(slot: ModuleSlot): string {
  return SLOT_LABELS[slot] ?? slot
}


export const RACK_SLOTS: readonly RackSlot[] = ['high', 'mid', 'low']

export const RACK_LABELS: Record<RackSlot, string> = {
  high: '高槽',
  mid: '中槽',
  low: '低槽',
}

export function rackLabel(rack: RackSlot): string {
  return RACK_LABELS[rack] ?? rack
}

export function shipSlotsOf(ship: { slots?: ShipSlots }): ShipSlots {
  return ship.slots ?? { high: 1, mid: 1, low: 1 }
}

export function rackOf(def: {
  slot: ModuleSlot
  rack?: RackSlot
  droneBayBonusM3?: number
  droneDmgBonus?: number
  droneRangeBonusPct?: number
  droneReviveCycleMs?: number
}): RackSlot {
  if (def.rack !== undefined) return def.rack
  if (
    def.slot === 'turret' ||
    def.slot === 'missile' ||
    def.slot === 'laser' ||
    def.slot === 'drone-tac' ||
    def.slot === 'drone-relay' ||
    def.slot === 'drone-launch' ||
    def.slot === 'drone-deck' ||
    def.slot === 'target-lock'
  )
    return 'high'
  if (def.slot === 'shield' || def.slot === 'propulsion') return 'mid'
  if (def.slot === 'shield-field') return 'high'
  if (def.slot === 'miner' || def.slot === 'salvager') return 'high'
  if (def.slot === 'drone-rack') return 'low'
  if (def.slot === 'drone-shield') return 'mid'
  if (def.slot === 'cpu') return 'low'
  return 'low'
}

export function isRackModule(def: { slot: ModuleSlot }): boolean {
  return def.slot !== 'plug'
}

export const ITEM_KIND_ORDER: readonly ItemKind[] = ['ore', 'mineral', 'part', 'gas', 'ice', 'ammo', 'drone', 'wreck', 'container', 'matter', 'essence', 'luxury', 'fragment', 'blackbox', 'kit', 'consumable', 'aicore']

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  ore: '原矿',
  mineral: '原材料',
  part: '零件',
  gas: '气体',
  ice: '冰矿',
  ammo: '弹药',
  drone: '无人机',
  wreck: '残骸',
  container: '货柜',
  matter: '谜质储存器',
  essence: '虫洞谜质',
  luxury: '奢侈品',
  fragment: '蓝图碎片',
  blackbox: '黑匣',
  consumable: '道具',
  kit: '修理组件',
  aicore: 'AI 核心',
}

export function itemKindLabel(kind: ItemKind): string {
  return ITEM_KIND_LABELS[kind] ?? kind
}

export const DRONE_CLASS_LABELS: Record<DroneClass, string> = {
  scout: '侦察机',
  combat: '战斗机',
  assault: '攻坚机',
  sentry: '哨戒机',
  repair: '修理机',
}

export function itemKindText(item: { kind: ItemKind; droneClass?: DroneClass }): string {
  const base = itemKindLabel(item.kind)
  if (item.kind === 'drone' && item.droneClass !== undefined) {
    return `${base} · ${DRONE_CLASS_LABELS[item.droneClass] ?? item.droneClass}`
  }
  return base
}

export const SHIP_ROLE_LABELS: Record<ShipRole, string> = {
  industrial: '采矿',
  armed: '武装',
  armored: '装甲',
  hauler: '航运',
}

export function shipRoleLabel(role: ShipRole): string {
  return SHIP_ROLE_LABELS[role] ?? role
}

export function isArmorLineShip(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): boolean {
  if (ship.role === 'armored') return true
  if (ship.role !== 'armed') return false
  return (ship.armorHp ?? 0) > (ship.shieldHp ?? 0)
}

export function shipCategoryKeyOf(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): ShipRole {
  return isArmorLineShip(ship) ? 'armored' : (ship.role ?? 'industrial')
}

export function shipCategoryLabelOf(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): string {
  return shipRoleLabel(shipCategoryKeyOf(ship))
}

export const SHIP_SIZE_CLASS: Record<number, string> = {
  1: '护卫舰',
  2: '驱逐舰',
  3: '巡洋舰',
  4: '战列舰',
  5: '泰坦',
}

export function shipSizeLabel(tier: number): string {
  return SHIP_SIZE_CLASS[tier] ?? ''
}

export const MINEABLE_KINDS: ReadonlySet<ItemKind> = new Set(['ore', 'gas', 'ice'])

export function isMineableItem(item: ItemDef | undefined): item is ItemDef {
  return !!item && MINEABLE_KINDS.has(item.kind)
}

export function emptyFitted(slots: ShipSlots = { high: 1, mid: 1, low: 1 }): FittedModules {
  return {
    high: Array<string | null>(slots.high).fill(null),
    mid: Array<string | null>(slots.mid).fill(null),
    low: Array<string | null>(slots.low).fill(null),
  }
}

export function rackBays(fitted: FittedModules, rack: RackSlot): Array<string | null> {
  return fitted[rack]
}

export function allFittedIds(fitted: FittedModules): string[] {
  const out: string[] = []
  for (const rack of RACK_SLOTS) {
    for (const id of fitted[rack]) if (id) out.push(id)
  }
  return out
}


export interface ThrusterCycleOverride {
  boostMs?: number
  cooldownMs?: number
}

export function thrusterCycleOfModule(m: {
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
}): ThrusterCycleOverride | undefined {
  return m.thrusterBoostMs === undefined && m.thrusterCooldownMs === undefined
    ? undefined
    : { boostMs: m.thrusterBoostMs, cooldownMs: m.thrusterCooldownMs }
}

export function thrusterCycleSeconds(
  bal: BattleBalance = DEFAULT_BALANCE.battle,
  cycle?: ThrusterCycleOverride,
): { boost: number; cooldown: number } {
  return {
    boost: Math.round((cycle?.boostMs ?? bal.thrusterBoostMs) / 1_000),
    cooldown: Math.round((cycle?.cooldownMs ?? bal.thrusterCooldownMs) / 1_000),
  }
}

export function thrusterCycleText(bal: BattleBalance = DEFAULT_BALANCE.battle, cycle?: ThrusterCycleOverride): string {
  const { boost, cooldown } = thrusterCycleSeconds(bal, cycle)
  return `点火 ${boost} 秒 / 冷却 ${cooldown} 秒`
}

export function thrusterCycleFullText(
  bal: BattleBalance = DEFAULT_BALANCE.battle,
  cycle?: ThrusterCycleOverride,
): string {
  const { boost, cooldown } = thrusterCycleSeconds(bal, cycle)
  return `${boost} 秒点火 / ${cooldown} 秒冷却，开场即点火`
}

export function thrusterCycleNote(
  bal: BattleBalance = DEFAULT_BALANCE.battle,
  cycle?: ThrusterCycleOverride,
): { text: string; textId: string; params: Record<string, string | number> } {
  const { boost, cooldown } = thrusterCycleSeconds(bal, cycle)
  return {
    text: `${boost} 秒点火 / ${cooldown} 秒冷却，开场即点火`,
    textId: 'core.combat.007',
    params: { p1: boost, p2: cooldown },
  }
}


export function uidDefId(uid: string): string {
  const i = uid.indexOf('#')
  return i > 0 ? uid.slice(0, i) : uid
}

export function uidSeqNum(uid: string): number {
  const i = uid.indexOf('#')
  if (i < 0) return 1
  const n = Number(uid.slice(i + 1))
  return Number.isInteger(n) && n > 1 ? n : 1
}
