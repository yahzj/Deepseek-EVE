import type { AiCoreType, DroneClass, ItemKind, ModuleSlot, ShipDef, ShipRole, WormholeArchetype, WormholePlace } from '@whale/core'
import { AI_CORE_IDS, WORMHOLE_ARCHETYPE_IDS } from '@whale/core'
import { FACTION_CODEX, factionOfExclusive } from '@whale/data'
import { tr } from '../i18n/locale'
import { RACK_SUBS, subText } from './itemSubs'

const KIND_ID: Record<ItemKind, string> = {
  ore: 'ui.IndustryPage.005',
  mineral: 'ui.itemSubs.006',
  gas: 'ui.IndustryPage.006',
  ice: 'ui.IndustryPage.007',
  ammo: 'ui.BattleScreen.003',
  drone: 'ui.Handbook.004',
  wreck: 'ui.MarketPage.009',
  container: 'ui.MarketPage.006',
  kit: 'ui.itemSubs.001',
  luxury: 'ui.itemSubs.007',
  aicore: 'ui.MarketPage.008',
  matter: 'ui.Handbook.314',
  essence: 'ui.MatterTechTab.005',
  part: 'ui.labelsText.001',
  fragment: 'ui.labelsText.002',
  blackbox: 'ui.labelsText.069',
  consumable: 'ui.labelsText.073',
}

const DRONE_CLASS_ID: Record<DroneClass, string> = {
  scout: 'ui.labelsText.003',
  combat: 'ui.labelsText.004',
  assault: 'ui.labelsText.005',
  sentry: 'ui.labelsText.006',
  repair: 'ui.repairDrone.001',
}

const ROLE_ID: Record<ShipRole, string> = {
  industrial: 'ui.Handbook.258',
  armed: 'ui.labelsText.007',
  armored: 'ui.FitPage.003',
  hauler: 'ui.labelsText.008',
}

const AICORE_ID: Record<AiCoreType, string> = AI_CORE_IDS

export function kindText(kind: ItemKind): string {
  const id = KIND_ID[kind]
  return id !== undefined ? tr(id) : kind
}

export function kindTextOfItem(item: { kind: ItemKind; droneClass?: DroneClass }): string {
  const base = kindText(item.kind)
  if (item.kind === 'drone' && item.droneClass !== undefined) {
    const cls = DRONE_CLASS_ID[item.droneClass]
    return tr('ui.labelsText.013', { p1: base, p2: cls !== undefined ? tr(cls) : item.droneClass })
  }
  return base
}

export function shipRoleText(role: ShipRole): string {
  const id = ROLE_ID[role]
  return id !== undefined ? tr(id) : role
}

const SHIP_SUBCLASS_ID: Record<NonNullable<ShipDef['subClass']>, string> = {
  '电子舰': 'ui.shipSubClass.001',
  '炮舰': 'ui.shipSubClass.002',
  '重型突击巡洋舰': 'ui.shipSubClass.003',
  '截击舰': 'ui.shipSubClass.004',
  '指挥舰': 'ui.shipSubClass.005',
  '鱼雷舰': 'ui.shipSubClass.006',
  '无人机作战舰': 'ui.shipSubClass.007',
  '侦察舰': 'ui.shipSubClass.008',
  '后勤舰': 'ui.shipSubClass.009',
  '武装货舰': 'ui.shipSubClass.010',
}

export function shipSubClassText(subClass: NonNullable<ShipDef['subClass']>): string {
  return tr(SHIP_SUBCLASS_ID[subClass])
}

const SLOT_ID: Readonly<Record<ModuleSlot, string>> = {
  miner: 'ui.Wormhole.238',
  cargo: 'ui.labelsText.049',
  turret: 'ui.labelsText.050',
  missile: 'ui.labelsText.051',
  laser: 'ui.labelsText.052',
  salvager: 'ui.Wormhole.001',
  shield: 'ui.labelsText.053',
  armor: 'ui.labelsText.054',
  propulsion: 'ui.BattleScreen.004',
  'drone-rack': 'ui.labelsText.055',
  'drone-tac': 'ui.labelsText.056',
  'drone-relay': 'ui.labelsText.057',
  'drone-launch': 'ui.launchCalibration.003',
  'drone-deck': 'ui.labelsText.071',
  'drone-shield': 'ui.labelsText.072',
  support: 'ui.labelsText.058',
  cpu: 'ui.labelsText.059',
  'target-lock': 'ui.itemSubs.013',
  'shield-field': 'ui.labelsText.065',
  plug: 'ui.itemSubs.042',
}

export function slotText(slot: string): string {
  const id = SLOT_ID[slot as ModuleSlot]
  return id !== undefined ? tr(id) : slot
}

export function rackText(rack: string): string {
  const sub = RACK_SUBS.find((s) => s.key === rack)
  return sub !== undefined ? subText(sub) : rack
}

const LAIR_TIER_ID: Record<number, string> = {
  1: 'ui.labelsText.066',
  2: 'ui.labelsText.067',
  3: 'ui.labelsText.068',
}
export function lairTierText(tier: number): string {
  const id = LAIR_TIER_ID[tier]
  return id !== undefined ? tr(id) : String(tier)
}

const PLACE_ID: Readonly<Record<WormholePlace, string>> = {
  empty: 'ui.Wormhole.223',
  graveyard: 'core.wormholePlace.001',
  ruins: 'core.wormholePlace.002',
  research: 'ui.researchLab.001',
  ship: 'ui.Wormhole.221',
  vein: 'core.wormholePlace.003',
  matter: 'ui.MatterTechTab.005',
  beacon: 'core.wormholePlace.004',
}
export function placeText(place: WormholePlace): string {
  return tr(PLACE_ID[place])
}

const ARCHETYPE_ID: Readonly<Record<WormholeArchetype, string>> = WORMHOLE_ARCHETYPE_IDS
export function archetypeText(archetype: WormholeArchetype): string {
  return tr(ARCHETYPE_ID[archetype])
}


export function shipTierText(tier: number): string {
  const id = `ui.labelsText.0${13 + tier}`
  return tr(id, { p1: tier })
}

export function aiCoreText(type: AiCoreType): string {
  const id = AICORE_ID[type]
  return id !== undefined ? tr(id) : type
}

export function aiCoreTextId(type: AiCoreType): string | undefined {
  return AICORE_ID[type]
}

export function kindLabelText(key: string): string {
  if (key === '舰船') return tr('ui.labelsText.019')
  if (key === '装备') return tr('ui.MarketPage.178')
  if (key === '零件') return tr('ui.labelsText.001')
  if (key === '消耗品') return tr('ui.itemSubs.037')
  if (key === '舰船插件') return tr('ui.itemSubs.042')
  return key
}
export function ownedWhereText(where: string): string {
  if (where === '仓库') return tr('ui.ItemsPage.001')
  if (where === '仓库＋机库') return tr('ui.Shipyard.002')
  return where
}

const SKILL_GROUP_ID: Record<string, string> = {
  舰船: 'ui.labelsText.019',
  工业: 'ui.labelsText.020',
  矿业: 'ui.labelsText.070',
  战斗: 'ui.labelsText.021',
  工程: 'ui.labelsText.022',
  贸易: 'ui.labelsText.023',
  物流: 'ui.labelsText.024',
  探索: 'ui.labelsText.025',
}
export function skillGroupText(group: string): string {
  const id = SKILL_GROUP_ID[group]
  return id !== undefined ? tr(id) : group
}

const SKILL_BRANCH_ID: Record<string, string> = {
  'b-deep-space': 'ui.stellar.060',
  'b-probe-assembly': 'ui.stellar.061',
  'b-fly': 'ui.labelsText.026',
  'b-mine': 'ui.labelsText.027',
  'b-refine': 'ui.labelsText.028',
  'b-craft': 'ui.labelsText.029',
  'b-salvage': 'ui.labelsText.030',
  'b-auto': 'ui.labelsText.031',
  'b-build': 'ui.labelsText.032',
  'b-lab': 'ui.labelsText.074',
  'b-indship': 'ui.labelsText.033',
  'b-weapon': 'ui.labelsText.034',
  'b-aim': 'ui.labelsText.035',
  'b-ammo': 'ui.labelsText.036',
  'b-drone': 'ui.labelsText.037',
  'b-warship': 'ui.labelsText.038',
  'b-command': 'ui.command.005',
  'b-protect': 'ui.labelsText.039',
  'b-repair': 'ui.labelsText.040',
  'b-ship-recovery': 'ui.shipRecovery.001',
  'b-shipfit': 'ui.labelsText.041',
  'b-ai': 'ui.labelsText.042',
  'b-learn': 'ui.labelsText.043',
  'b-scan': 'ui.labelsText.044',
  'b-survive': 'ui.labelsText.045',
  'b-market': 'ui.labelsText.046',
  'b-bounty': 'ui.labelsText.047',
  'b-logistics': 'ui.labelsText.048',
}
export function skillBranchText(branch: string): string {
  const id = SKILL_BRANCH_ID[branch]
  return id !== undefined ? tr(id) : branch
}

export function crestFamOf(id: string | undefined): string | undefined {
  const fam = id === undefined ? undefined : factionOfExclusive(id)
  return fam ?? undefined
}

export function crestLabelOf(fam: string): string {
  const entry = FACTION_CODEX[fam]
  return entry === undefined ? fam : tr(entry.nameId)
}
