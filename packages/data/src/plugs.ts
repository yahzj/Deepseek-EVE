import staticDocument from './static/plugs.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const SHIP_PLUGS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'plug-pirate-raider': { name: '袭击者插件', description: L10N['mod.factionPlug.001']!.zh },
  'plug-alien-shield-coating': { name: '护盾镀膜插件', description: L10N['mod.factionPlug.008']!.zh },
  'plug-gravekeeper-capacitor': { name: '护盾蓄能插件', description: L10N['mod.factionPlug.003']!.zh },
  'plug-titan-compression': { name: '空间压缩插件', description: L10N['mod.factionPlug.009']!.zh },
  'plug-deadarmy-printing': { name: '廉价打印插件', description: L10N['mod.factionPlug.005']!.zh },
  'plug-pirate-damage-management': { name: L10N['mod.factionPlug.010']!.zh, description: L10N['mod.factionPlug.011']!.zh },
  'plug-alien-nanobiomass': { name: L10N['mod.factionPlug.012']!.zh, description: L10N['mod.factionPlug.013']!.zh },
  'plug-gravekeeper-charge': { name: L10N['mod.factionPlug.014']!.zh, description: L10N['mod.factionPlug.015']!.zh },
  'plug-titan-drone-command': { name: L10N['mod.factionPlug.016']!.zh, description: L10N['mod.factionPlug.017']!.zh },
  'plug-deadarmy-reinforced-hull': { name: L10N['mod.factionPlug.018']!.zh, description: L10N['mod.factionPlug.019']!.zh },
  "plug-shield-plate": {
    name: '护盾强化插板',
    description: L10N['mod.copy.097']!.zh,
  },
  "plug-armor-plate": {
    name: '装甲强化插板',
    description: L10N['mod.copy.098']!.zh,
  },
  "plug-hull-plate": {
    name: '结构强化插板',
    description: L10N['mod.copy.099']!.zh,
  },
  "plug-mid-bay": {
    name: '中层舱段插件',
    description: L10N['mod.copy.100']!.zh,
  },
  "plug-low-bay": {
    name: '下层舱段插件',
    description: L10N['mod.copy.101']!.zh,
  },
  "plug-cpu-core": {
    name: '协处理插件',
    description: L10N['mod.copy.102']!.zh,
  },
  "plug-firepower": {
    name: '火力强化插件',
    description: L10N['mod.copy.103']!.zh,
  },
  "plug-sight": {
    name: '瞄具插件',
    description: L10N['mod.copy.104']!.zh,
  },
  "plug-rangefinder": {
    name: '射程插件',
    description: L10N['mod.copy.105']!.zh,
  },
  "plug-thruster": {
    name: '推进插件',
    description: L10N['mod.copy.106']!.zh,
  },
  "plug-target-beacon": {
    name: '靶标插件',
    description: L10N['mod.copy.107']!.zh,
  },
  "plug-concealment": {
    name: '隐匿插件',
    description: L10N['mod.copy.108']!.zh,
  },
}

import type { ModuleDef } from '@whale/core'
import { L10N } from './l10n/table'
export const FACTION_PLUG_BLUEPRINT_PRICE = 100_000_000

export function isFactionPlugId(id: string): boolean {
  return ['pirate', 'alien', 'gravekeeper', 'titan', 'deadarmy'].some(family => id.startsWith(`plug-${family}-`))
}
// ⟪文案调整 2026-10-04⟫ 船长授权整批说明重写，数值与功能不变。

export const PLUG_IDS = {
  shieldPlate: 'plug-shield-plate',
  armorPlate: 'plug-armor-plate',
  hullPlate: 'plug-hull-plate',
  midBay: 'plug-mid-bay',
  lowBay: 'plug-low-bay',
  cpuCore: 'plug-cpu-core',
  firepower: 'plug-firepower',
  sight: 'plug-sight',
  thruster: 'plug-thruster',
  rangefinder: 'plug-rangefinder',
  targetBeacon: 'plug-target-beacon',
  concealment: 'plug-concealment',
  pirateRaider: 'plug-pirate-raider',
  alienShieldCoating: 'plug-alien-shield-coating',
  gravekeeperCapacitor: 'plug-gravekeeper-capacitor',
  titanCompression: 'plug-titan-compression',
  deadarmyPrinting: 'plug-deadarmy-printing',
  pirateDamageManagement: 'plug-pirate-damage-management',
  alienNanobiomass: 'plug-alien-nanobiomass',
  gravekeeperCharge: 'plug-gravekeeper-charge',
  titanDroneCommand: 'plug-titan-drone-command',
  deadarmyReinforcedHull: 'plug-deadarmy-reinforced-hull',
} as const

export const SHIP_PLUGS: readonly ModuleDef[] = [
  ...staticDataGroup<ModuleDef>(staticDocument as unknown as DataDocument, 'SHIP_PLUGS_0', SHIP_PLUGS_0_TEXT_BINDINGS),
]
