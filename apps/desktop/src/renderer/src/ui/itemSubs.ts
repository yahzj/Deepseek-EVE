import {
  isRareWreck,
  ownsBlueprint,
  rackOf,
  shipCategoryKeyOf,
  shipSizeLabel,
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_MILITARY_BOX_ID,
  WORMHOLE_VALUABLES_BOX_ID,
} from '@whale/core'
import type { GameState, MarketGoodDef, ModuleSlot, RackSlot, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'

export const SUB_ALL = 'sub-all'
export const DOMAIN_ALL = 'domain-all'
export const DOMAIN_ITEM = 'domain-item'
export const DOMAIN_SHIP = 'domain-ship'

const KNOWN_ITEM_CATEGORIES = new Set([
  'ore', 'mineral', 'part', 'gas', 'ice', 'matter', 'essence', 'luxury', 'fragment',
])
const SHIP_ROLE_KEYS = ['industrial', 'hauler', 'armed', 'armored'] as const

export interface SubOption {
  key: string
  label: string
  id?: string
  idParam?: string
  itemId?: string
}

export const CONSUME_SUBS: SubOption[] = [
  { key: 'ammo', label: '弹药', id: 'ui.BattleScreen.003' },
  { key: 'kit', label: '修理组件', id: 'ui.itemSubs.001' },
  { key: 'drone', label: '无人机', id: 'ui.Handbook.004' },
]

export const CONSUME_KIND_KEYS: readonly string[] = CONSUME_SUBS.map((s) => s.key)

export const CONSUMABLE_SUB_PREFIX = 'consume-item-'

export const CONSUMABLE_ITEM_SUBS: SubOption[] = [
  { key: `${CONSUMABLE_SUB_PREFIX}deep-space-probe`, itemId: 'deep-space-probe', get label() { return tr('ui.stellar.001') } },
  { key: `${CONSUMABLE_SUB_PREFIX}jump-fuel`, itemId: 'jump-fuel', label: '超空间折跃燃料' },
  { key: `${CONSUMABLE_SUB_PREFIX}invasion-beacon`, itemId: 'invasion-beacon', label: '信号发射器' },
  { key: `${CONSUMABLE_SUB_PREFIX}synaptic-accelerant`, itemId: 'synaptic-accelerant', get label() { return tr('item.factionBeacon.009') } },
  { key: `${CONSUMABLE_SUB_PREFIX}invasion-beacon-r`, itemId: 'invasion-beacon-r', get label() { return tr('item.factionBeacon.001') } },
  { key: `${CONSUMABLE_SUB_PREFIX}invasion-beacon-c`, itemId: 'invasion-beacon-c', get label() { return tr('item.factionBeacon.003') } },
  { key: `${CONSUMABLE_SUB_PREFIX}invasion-beacon-h`, itemId: 'invasion-beacon-h', get label() { return tr('item.factionBeacon.005') } },
  { key: `${CONSUMABLE_SUB_PREFIX}invasion-beacon-d`, itemId: 'invasion-beacon-d', get label() { return tr('item.factionBeacon.007') } },
]

export const CONSUME_BUCKET_SUBS: SubOption[] = [...CONSUME_SUBS, ...CONSUMABLE_ITEM_SUBS]

export const BLACKBOX_KIND_KEYS: readonly string[] = ['blackbox']

export const CONTAINER_KIND_KEYS: readonly string[] = ['container']

export const CONTAINER_SUBS: SubOption[] = [
  { key: 'encrypted', label: '加密货柜', id: 'ui.researchLab.003' },
  { key: 'safe', label: '遗迹安全货柜', id: 'ui.itemSubs.002' },
  { key: 'bp', label: '图纸货柜', id: 'ui.itemSubs.003' },
  { key: 'valuables', label: '贵重品货柜', id: 'ui.itemSubs.004' },
  { key: 'military', label: '军用备货柜', id: 'ui.itemSubs.005' },
]

export function containerSubKeyOf(refId: string): string {
  if (/^box-encrypted-[acdeg]$/.test(refId)) return 'encrypted'
  if (/^box-relic-[a-z]$/.test(refId)) return 'safe'
  if ((WORMHOLE_BP_BOX_IDS as readonly string[]).includes(refId)) return 'bp'
  if (refId === WORMHOLE_VALUABLES_BOX_ID) return 'valuables'
  if (refId === WORMHOLE_MILITARY_BOX_ID) return 'military'
  return ''
}

export const WRECK_SUBS: SubOption[] = [
  { key: 'common', label: '普通残骸', id: 'ui.IndustryPage.008' },
  { key: 'rare', label: '稀有残骸', id: 'ui.IndustryPage.009' },
]

export function wreckTierOf(refId: string): 'rare' | 'common' {
  return isRareWreck(refId) ? 'rare' : 'common'
}

export const ITEM_SUBS: SubOption[] = [
  { key: 'ore', label: '原矿', id: 'ui.IndustryPage.005' },
  { key: 'mineral', label: '原材料', id: 'ui.itemSubs.006' },
  { key: 'gas', label: '气体', id: 'ui.IndustryPage.006' },
  { key: 'ice', label: '冰矿', id: 'ui.IndustryPage.007' },
  { key: 'part-basic', label: '基础零件', id: 'ui.itemSubs.033' },
  { key: 'part-advanced', label: '高级零件', id: 'ui.itemSubs.034' },
  { key: 'luxury', label: '奢侈品', id: 'ui.itemSubs.007' },
  { key: 'matter', label: '谜质储存器', id: 'ui.Handbook.314' },
  { key: 'essence', label: '虫洞谜质', id: 'ui.MatterTechTab.005' },
  { key: 'fragment', label: '蓝图碎片', id: 'ui.labelsText.002' },
]

export const PART_SUBS: SubOption[] = [
  { key: 'part-basic', label: '基础零件', id: 'ui.itemSubs.033' },
  { key: 'part-advanced', label: '高级零件', id: 'ui.itemSubs.034' },
]

export const MODULE_SUBS: SubOption[] = [
  { key: 'prod', label: '采集与货舱', id: 'ui.itemSubs.008' },
  { key: 'weapon', label: '武器', id: 'ui.itemSubs.009' },
  { key: 'shield', label: '护盾', id: 'ui.FitPage.001' },
  { key: 'armor', label: '装甲', id: 'ui.FitPage.003' },
  { key: 'prop', label: '推进', id: 'ui.BattleScreen.004' },
  { key: 'drone', label: '无人机装置', id: 'ui.itemSubs.010' },
  { key: 'support-combat', label: '战斗支援件', id: 'ui.itemSubs.038' },
  { key: 'support-aux', label: '辅助支援件', id: 'ui.itemSubs.039' },
  { key: 'support-repair', label: '修理装置', id: 'ui.itemSubs.040' },
  { key: 'cpu', label: '协处理器', id: 'ui.itemSubs.012' },
  { key: 'salvager', label: '打捞', id: 'ui.Wormhole.001' },
  { key: 'lock', label: '目标锁定', id: 'ui.itemSubs.013' },
  { key: 'plug', label: '舰船插件', id: 'ui.itemSubs.042' },
  { key: 'other', label: '其他', id: 'ui.hud.137' },
]

export const SUPPORT_MODULE_KEYS: Record<string, readonly string[]> = {
  'support-combat': [
    'mod-gravekeeper-crisis',
    'mod-laser-calibration-2', 'mod-laser-calibration-3',
    'mod-stab-kin-1', 'mod-stab-kin-2', 'mod-stab-kin-3',
    'mod-stab-exp-1', 'mod-stab-exp-2', 'mod-stab-exp-3',
    'mod-stab-pla-1', 'mod-stab-pla-2', 'mod-stab-pla-3',
    'mod-rof-1', 'mod-rof-2', 'mod-rof-3',
    'mod-track-1', 'mod-track-2', 'mod-track-3',
    'mod-gyro-1', 'mod-gyro-2', 'mod-gyro-3',
    'mod-wh-a-scan',
    'mod-wh-g-fcs',
    'mod-wh-d-steady',
    'mod-wh-d-loader',
    'mod-wh-g-ballistic',
    'mod-lair-web-h',
    'mod-lair-ecm-h',
    'mod-lair-blink-r',
    'mod-stealth-2', 'mod-stealth-3',
  ],
  'support-aux': [
    'mod-alien-pressure-chamber',
    'mod-warpcomp-2', 'mod-warpcomp-3',
    'mod-wh-c-pulse',
  ],
  'support-repair': [
    'mod-gravekeeper-rebirth',
    'mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2',
    'mod-lair-dc-c',
    'mod-dc-1', 'mod-dc-2', 'mod-dc-3',
  ],
}

export const MODULE_SUB_SLOTS: Record<string, readonly string[]> = {
  prod: ['miner', 'cargo'],
  weapon: ['turret', 'laser', 'missile'],
  shield: ['shield', 'shield-field'],
  armor: ['armor'],
  prop: ['propulsion'],
  drone: ['drone-rack', 'drone-tac', 'drone-relay', 'drone-launch', 'drone-shield', 'drone-deck'],
  'support-combat': ['support'],
  'support-aux': ['support'],
  'support-repair': ['support'],
  cpu: ['cpu'],
  salvager: ['salvager'],
  lock: ['target-lock'],
  plug: ['plug'],
}

export const SHIP_SUBS: SubOption[] = [
  { key: 'industrial', label: '采矿舰', id: 'ui.itemSubs.014' },
  { key: 'hauler', label: '货运舰', id: 'ui.itemSubs.015' },
  { key: 'armed', label: '武装舰', id: 'ui.itemSubs.016' },
  { key: 'armored', label: '装甲舰', id: 'ui.itemSubs.017' },
]

export const SHIP_TIER_KEYS = [1, 2, 3, 4, 5] as const

export const SHIP_TIER_SUBS: SubOption[] = SHIP_TIER_KEYS.map((t) => ({
  key: `t${t}`,
  label: `T${t} ${shipSizeLabel(t)}`,
  id: `ui.labelsText.0${13 + t}`,
  idParam: String(t),
}))

export const BLUEPRINT_LEARN_SUBS: SubOption[] = [
  { key: 'learned', label: '已学会', id: 'ui.itemSubs.031' },
  { key: 'unlearned', label: '未学会', id: 'ui.itemSubs.032' },
]

export const BLUEPRINT_SUBS: SubOption[] = [
  { key: 'high', label: '高槽装备蓝图', id: 'ui.itemSubs.018' },
  { key: 'mid', label: '中槽装备蓝图', id: 'ui.itemSubs.019' },
  { key: 'low', label: '低槽装备蓝图', id: 'ui.itemSubs.020' },
  { key: 'plug', label: '舰船插件', id: 'ui.itemSubs.042' },
  ...SHIP_TIER_SUBS.map((s) => ({
    key: s.key,
    label: `${s.label}蓝图`,
    id: `ui.labelsText.0${59 + (s.idParam ? Number(s.idParam) : 0)}`,
    idParam: s.idParam,
  })),
  { key: 'supply', label: '消耗品蓝图（弹药·修理组件）', id: 'ui.itemSubs.021' },
  { key: 'part-advanced', label: '零件蓝图', id: 'ui.itemSubs.035' },
]

export const MARKET_BLUEPRINT_SUBS: SubOption[] = [...BLUEPRINT_SUBS, ...BLUEPRINT_LEARN_SUBS]

export const CORE_SUBS: SubOption[] = [
  { key: 'basic', label: '基础核心', id: 'ui.MarketPage.020' },
  { key: 'gamma', label: '伽马核心', id: 'ui.itemSubs.022' },
  { key: 'beta', label: '贝塔核心', id: 'ui.itemSubs.023' },
  { key: 'alpha', label: '阿尔法核心', id: 'ui.itemSubs.024' },
]

export const RACK_KIND_KEYS = ['module-high', 'module-mid', 'module-low', 'module-plug'] as const
export type RackKind = (typeof RACK_KIND_KEYS)[number]

export const RACK_LABELS: Record<string, string> = {
  get high() { return tr("ui.itemSubs.025") },
  get mid() { return tr("ui.itemSubs.026") },
  get low() { return tr("ui.itemSubs.027") },
  get plug() { return tr("ui.itemSubs.042") },
}

export const RACK_SUBS: SubOption[] = (['high', 'mid', 'low', 'plug'] as const).map((k) => ({
  key: k,
  label: RACK_LABELS[k],
  id: k === 'plug' ? 'ui.itemSubs.042' : `ui.itemSubs.${k === 'high' ? '025' : k === 'mid' ? '026' : '027'}`,
}))


export const SUBS_OF_KIND: Record<string, SubOption[]> = {
  item: ITEM_SUBS,
  container: CONTAINER_SUBS,
  consume: CONSUME_BUCKET_SUBS,
  module: MODULE_SUBS,
  'module-high': MODULE_SUBS,
  'module-mid': MODULE_SUBS,
  'module-low': MODULE_SUBS,
  'module-plug': MODULE_SUBS,
  ship: SHIP_SUBS,
  blueprint: MARKET_BLUEPRINT_SUBS,
  aicore: CORE_SUBS,
  wreck: WRECK_SUBS,
}

export const MARKET_DOMAIN_TABS: readonly SubOption[] = [
  { key: 'domain-item', label: '物品', id: 'ui.itemFilters.001' },
  { key: 'domain-ship', label: '舰船', id: 'ui.App.002' },
]

export const ITEM_DOMAIN_SUBS: readonly SubOption[] = [
  { key: 'item', label: '货物', id: 'ui.MarketPage.005' },
  { key: 'module', label: '装备', id: 'ui.MarketPage.178' },
  { key: 'consume', label: '消耗品', id: 'ui.MarketPage.007' },
  { key: 'container', label: '货柜', id: 'ui.MarketPage.006' },
  { key: 'wreck', label: '残骸', id: 'ui.MarketPage.009' },
  { key: 'blackbox', label: '黑匣', id: 'ui.labelsText.069' },
  { key: 'blueprint', label: '蓝图', id: 'ui.MarketPage.004' },
  { key: 'aicore', label: 'AI 核心', id: 'ui.MarketPage.008' },
  { key: 'other', label: '其他', id: 'ui.hud.137' },
]

export const ITEM_CODEX_SUBS: readonly SubOption[] = ITEM_DOMAIN_SUBS.filter(
  (s) => s.key !== 'module' && s.key !== 'blueprint',
)

export const ITEM_CARGO_SUBS: readonly SubOption[] = ITEM_CODEX_SUBS

export const SHIP_DOMAIN_SUBS: readonly SubOption[] = [
  ...SHIP_SUBS,
  { key: 'other', label: '其他', id: 'ui.hud.137' },
]

export function subPasses(ctx: SimContext, good: MarketGoodDef, kind: string, sub: string, state?: GameState): boolean {
  if (sub === SUB_ALL || kind === 'all') return true
  if (good.kind === 'item' || good.kind === 'module') return itemSubPasses(ctx, good.refId, kind, sub)
  if (ITEM_SPACE_BUCKETS.includes(kind)) return false
  if (kind === 'ship') {
    return shipRolePasses(ctx.ships.get(good.refId), sub)
  }
  if (kind === 'blueprint') {
    if (sub === 'learned' || sub === 'unlearned') {
      if (!state) return false
      const single = ctx.blueprints.get(good.refId)?.singleUse === true
      const learned = ownsBlueprint(state, good.refId)
      return sub === 'learned' ? learned : !learned && !single
    }
    const eq = ctx.blueprints.get(good.refId)
    if (eq) {
      if (eq.partTier) return partSubPasses(ctx, good.refId, sub)
      if (eq.moduleId === undefined) return sub === 'supply'
      const mod = ctx.modules.get(eq.moduleId)
      return mod ? rackDimKeyOf(mod) === sub : false
    }
    const shipBp = ctx.shipBlueprints.get(good.refId)
    if (!shipBp) return false
    const ship = ctx.ships.get(shipBp.shipId)
    return ship !== undefined && `t${ship.tier}` === sub
  }
  if (kind === 'aicore') return good.refId === sub
  return true
}

export function marketDomainPasses(
  ctx: SimContext,
  good: MarketGoodDef,
  domain: string,
  sub: string,
  state?: GameState,
  detail: string = SUB_ALL,
  rack: string = SUB_ALL,
): boolean {
  if (domain === DOMAIN_ALL) return true
  if (domain === DOMAIN_SHIP) {
    return good.kind === 'ship' && shipRolePasses(ctx.ships.get(good.refId), sub) && shipTierPasses(ctx.ships.get(good.refId), detail)
  }
  if (domain !== DOMAIN_ITEM) return false
  if (sub === SUB_ALL) return good.kind !== 'ship'
  const category = good.kind === 'item' ? itemCategoryOf(ctx.items.get(good.refId)) : good.kind
  if (category !== sub) return false
  if (good.kind === 'module' && !rackPasses(ctx, good.refId, rack)) return false
  return subPasses(ctx, good, sub, detail, state)
}

export function moduleSubKeyOf(slot: string, moduleId?: string): string {
  if (moduleId !== undefined) {
    for (const [key, ids] of Object.entries(SUPPORT_MODULE_KEYS)) {
      if (ids.includes(moduleId)) return key
    }
    if (slot === 'support') return 'other'
  }
  for (const [key, slots] of Object.entries(MODULE_SUB_SLOTS)) {
    if (slots.includes(slot)) return key
  }
  return 'other'
}

export function bpFilterKeysOf(ctx: SimContext, bpId: string): { tab: ManuTabKey; subKey: string; singleUse: boolean } {
  const sbp = ctx.shipBlueprints.get(bpId)
  if (sbp) {
    const def = ctx.ships.get(sbp.shipId)
    return { tab: 'ship', subKey: def ? `t${def.tier}` : '', singleUse: sbp.singleUse === true }
  }
  const bp = ctx.blueprints.get(bpId)
  if (bp?.itemId !== undefined) {
    const item = ctx.items.get(bp.itemId)
    const tier = partTierOf(ctx, bpId)
    if (tier !== null) return { tab: 'part', subKey: `part-${tier}`, singleUse: bp.singleUse === true }
    return { tab: 'supply', subKey: item?.kind ?? '', singleUse: bp.singleUse === true }
  }
  const mod = bp?.moduleId ? ctx.modules.get(bp.moduleId) : undefined
  if (mod?.slot === 'plug') return { tab: 'plug', subKey: '', singleUse: bp?.singleUse === true }
  return { tab: 'equip', subKey: mod ? moduleSubKeyOf(mod.slot, mod.id) : '', singleUse: bp?.singleUse === true }
}


export function partTierOf(ctx: SimContext, refId: string): 'basic' | 'advanced' | null {
  const bp = ctx.blueprints.get(refId)
  if (bp?.partTier) return bp.partTier
  const item = ctx.items.get(refId)
  if (item?.kind !== 'part') return null
  for (const b of ctx.blueprints.values()) {
    if (b.itemId === refId && b.partTier) return b.partTier
  }
  return null
}

export function partSubPasses(ctx: SimContext, refId: string, sub: string): boolean {
  if (sub === SUB_ALL) return true
  const tier = partTierOf(ctx, refId)
  return tier !== null && `part-${tier}` === sub
}


export function itemBucketPasses(ctx: SimContext, refId: string, bucket: string): boolean {
  if (bucket === SUB_ALL || bucket === 'all') return true
  if (bucket === 'module' || bucket.startsWith('module-')) {
    const mod = ctx.modules.get(refId)
    if (!mod) return false
    if (bucket === 'module') return true
    return rackDimKeyOf(mod) === bucket.slice('module-'.length)
  }
  const it = ctx.items.get(refId)
  if (!it) return false
  if (bucket === 'item' || bucket === 'consume' || bucket === 'container' || bucket === 'wreck' || bucket === 'blackbox' || bucket === 'aicore' || bucket === 'other') {
    return itemCategoryOf(it) === bucket
  }
  return it.kind === bucket
}

export function itemCategoryOf(def: { kind?: string } | undefined): string {
  const kind = def?.kind ?? ''
  if (kind === 'wreck') return 'wreck'
  if (CONSUME_KIND_KEYS.includes(kind) || kind === 'consumable') return 'consume'
  if (CONTAINER_KIND_KEYS.includes(kind)) return 'container'
  if (BLACKBOX_KIND_KEYS.includes(kind)) return 'blackbox'
  if (kind === 'aicore') return 'aicore'
  return KNOWN_ITEM_CATEGORIES.has(kind) ? 'item' : 'other'
}

export function rackDimKeyOf(def: { slot: ModuleSlot; rack?: RackSlot }): string {
  return def.slot === 'plug' ? 'plug' : rackOf(def)
}

export function rackPasses(ctx: SimContext, refId: string, key: string): boolean {
  if (key === SUB_ALL) return true
  const mod = ctx.modules.get(refId)
  return mod !== undefined && rackDimKeyOf(mod) === key
}


export function subText(
  opt: { id?: string; label: string; idParam?: string; itemId?: string },
  nameOf?: (itemId: string) => string | undefined,
): string {
  if (opt.itemId !== undefined) {
    const byItem = nameOf?.(opt.itemId)
    if (byItem !== undefined && byItem !== '') return byItem
  }
  if (opt.id === undefined) return opt.label
  return opt.idParam !== undefined ? tr(opt.id, { p1: opt.idParam }) : tr(opt.id)
}


export function presentSubs<T extends { key: string }>(options: readonly T[], hasAny: (key: string) => boolean): T[] {
  return options.filter((s) => s.key === SUB_ALL || hasAny(s.key))
}


export function itemSubPasses(ctx: SimContext, refId: string, bucket: string, sub: string): boolean {
  if (sub === SUB_ALL) return true
  if (bucket === 'container') {
    const it = ctx.items.get(refId)
    return it !== undefined && CONTAINER_KIND_KEYS.includes(it.kind) && containerSubKeyOf(refId) === sub
  }
  if (bucket === 'wreck') {
    const it = ctx.items.get(refId)
    return it !== undefined && it.kind === 'wreck' && wreckTierOf(refId) === sub
  }
  if (bucket === 'aicore') return refId === `ai-core-${sub}`
  if (bucket === 'fragment') {
    const modId = refId.startsWith('frag-') ? refId.slice('frag-'.length) : ''
    const mod = modId ? ctx.modules.get(modId) : undefined
    return mod !== undefined && moduleSubKeyOf(mod.slot, mod.id) === sub
  }
  if (bucket === 'module' || bucket.startsWith('module-')) {
    const mod = ctx.modules.get(refId)
    return mod !== undefined && moduleSubKeyOf(mod.slot, mod.id) === sub
  }
  if (sub === 'part-basic' || sub === 'part-advanced') return partSubPasses(ctx, refId, sub)
  const it = ctx.items.get(refId)
  if (!it) return false
  if (sub.startsWith(CONSUMABLE_SUB_PREFIX)) {
    return it.kind === 'consumable' && refId === sub.slice(CONSUMABLE_SUB_PREFIX.length)
  }
  if (sub === 'other') return itemCategoryOf(it) === 'other'
  return it.kind === sub
}

export const ITEM_SPACE_BUCKETS: readonly string[] = ['item', 'container', 'consume', 'wreck', 'blackbox', 'module', ...RACK_KIND_KEYS]


export const FLEET_STATE_TABS: SubOption[] = [
  { key: SUB_ALL, get label() { return tr("ui.IndustryPage.001") } },
  { key: 'pilot', get label() { return tr("ui.ShipPage.010") } },
  { key: 'ai', get label() { return tr("ui.ShipPage.118") } },
  { key: 'idle', get label() { return tr("ui.ShipPage.117") } },
  { key: 'damaged', get label() { return tr("ui.ShipPage.119") } },
]

export const STORE_OWN_TABS: SubOption[] = [
  { key: SUB_ALL, get label() { return tr("ui.IndustryPage.001") } },
  { key: 'owned', get label() { return tr("ui.ShipPage.122") } },
  { key: 'unowned', get label() { return tr("ui.ShipPage.041") } },
]

type ShipCategoryInput = Parameters<typeof shipCategoryKeyOf>[0]

export function shipRolePasses(def: ShipCategoryInput | undefined, role: string): boolean {
  if (role === SUB_ALL) return true
  if (!def?.role || !(SHIP_ROLE_KEYS as readonly string[]).includes(def.role)) return role === 'other'
  const actual = shipCategoryKeyOf(def ?? {})
  if (role === 'other') return !(SHIP_ROLE_KEYS as readonly string[]).includes(actual)
  return actual === role
}

export function shipTierPasses(def: { tier?: number } | undefined, tier: string): boolean {
  if (tier === SUB_ALL) return true
  return def !== undefined && `t${def.tier}` === tier
}


export type ManuTabKey = 'all' | 'equip' | 'ship' | 'supply' | 'part' | 'plug'
export const MANU_TABS: Array<{ key: ManuTabKey; label: string; id: string }> = [
  { key: 'all', label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'equip', label: '装备蓝图', id: 'ui.ShipPage.115' },
  { key: 'ship', label: '舰船蓝图', id: 'ui.ShipPage.116' },
  { key: 'supply', label: '消耗品蓝图', id: 'ui.ShipPage.114' },
]
export const MANU_TABS_CRAFT: Array<{ key: ManuTabKey; label: string; id: string }> = [
  { key: 'all', label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'equip', label: '装备', id: 'ui.MarketPage.178' },
  { key: 'part', label: '零件', id: 'ui.itemSubs.036' },
  { key: 'supply', label: '消耗品', id: 'ui.itemSubs.037' },
  { key: 'plug', label: '舰船插件', id: 'ui.itemSubs.042' },
]

export function manuSubsOf(tab: ManuTabKey): SubOption[] {
  if (tab === 'equip') return MODULE_SUBS
  if (tab === 'ship') return SHIP_TIER_SUBS
  if (tab === 'supply') return CONSUME_SUBS
  if (tab === 'part') return PART_SUBS
  return []
}

export type BlueprintUseKey = 'perm' | 'single' | typeof SUB_ALL
export const BLUEPRINT_USE_TABS: Array<{ key: BlueprintUseKey; label: string; id: string }> = [
  { key: SUB_ALL, label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'perm', label: '永久蓝图', id: 'ui.itemSubs.029' },
  { key: 'single', label: '一次性蓝图', id: 'ui.itemSubs.030' },
]

export type BlueprintLearnKey = 'learned' | 'unlearned' | 'single' | typeof SUB_ALL
export const BLUEPRINT_LEARN_TABS: Array<{ key: BlueprintLearnKey; label: string; id: string }> = [
  { key: SUB_ALL, label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'learned', label: '已学会', id: 'ui.itemSubs.031' },
  { key: 'unlearned', label: '未学会', id: 'ui.itemSubs.032' },
  { key: 'single', label: '一次性蓝图', id: 'ui.itemSubs.030' },
]
