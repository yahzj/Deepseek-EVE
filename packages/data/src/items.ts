
import staticDocument from './static/items.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const ORES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "ore-veldspar": {
    name: '橄榄岩',
    description: L10N['item.copy.001']!.zh,
  },
  "ore-scorched": {
    name: '辉长岩',
    description: L10N['item.copy.002']!.zh,
  },
  "ore-hemorphite": {
    name: '赤环岩',
    description: L10N['item.copy.003']!.zh,
  },
  "ore-glowstone": {
    name: '辉云岩',
    description: L10N['item.copy.004']!.zh,
  },
  "ore-sunshard": {
    name: '曦棱晶',
    description: L10N['item.copy.005']!.zh,
  },
  "ore-voidshard": {
    name: '玄晶',
    description: L10N['item.copy.006']!.zh,
  },
  "ore-nebulite": {
    name: '星幽矿',
    description: L10N['item.copy.007']!.zh,
  },
  "ore-voidmother": {
    name: '虚空母矿',
    description: L10N['item.signalSpace.001']!.zh,
  },
}

const RELIC_CONTAINERS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "box-relic-a": {
    name: '遗迹安全货柜（海盗）',
    description:
      L10N['item.copy.058']!.zh,
  },
  "box-relic-c": {
    name: '遗迹安全货柜（异形）',
    description:
      L10N['item.copy.059']!.zh,
  },
  "box-relic-d": {
    name: '遗迹安全货柜（守墓）',
    description:
      L10N['item.copy.060']!.zh,
  },
  "box-relic-e": {
    name: '遗迹安全货柜（巨构）',
    description:
      L10N['item.copy.061']!.zh,
  },
  "box-relic-g": {
    name: '遗迹安全货柜（亡军）',
    description:
      L10N['item.copy.062']!.zh,
  },
}

const BLUEPRINT_CONTAINERS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'box-encrypted-a': { name: L10N['item.encrypted.001']!.zh, description: L10N['item.encrypted.006']!.zh },
  'box-encrypted-c': { name: L10N['item.encrypted.002']!.zh, description: L10N['item.encrypted.006']!.zh },
  'box-encrypted-d': { name: L10N['item.encrypted.003']!.zh, description: L10N['item.encrypted.006']!.zh },
  'box-encrypted-e': { name: L10N['item.encrypted.004']!.zh, description: L10N['item.encrypted.006']!.zh },
  'box-encrypted-g': { name: L10N['item.encrypted.005']!.zh, description: L10N['item.encrypted.006']!.zh },
  "box-bp-shallow": {
    name: '图纸货柜（浅层）',
    description:
      L10N['item.copy.063']!.zh,
  },
  "box-bp-mid": {
    name: '图纸货柜（中层）',
    description:
      L10N['item.copy.064']!.zh,
  },
  "box-bp-deep": {
    name: '图纸货柜（深层）',
    description:
      L10N['item.copy.065']!.zh,
  },
}

const MINERALS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "min-tritanium": {
    name: '钛钢合金',
    description: L10N['item.copy.009']!.zh,
  },
  "min-pyerite": {
    name: '银纹超金属',
    description: L10N['item.copy.010']!.zh,
  },
  "min-mexallon": {
    name: '晶态胶体',
    description: L10N['item.copy.011']!.zh,
  },
  "min-nocxium": {
    name: '重钨合金',
    description: L10N['item.copy.012']!.zh,
  },
  "min-isotope": {
    name: '同位聚晶',
    description: L10N['item.copy.013']!.zh,
  },
  "min-starcore": {
    name: '星髓晶',
    description: L10N['item.copy.014']!.zh,
  },
  "min-darkiron": {
    name: '冥铁合金',
    description: L10N['item.copy.015']!.zh,
  },
  "min-voidcrystal": {
    name: '虚空晶',
    description: L10N['item.copy.016']!.zh,
  },
  "min-jumplasma": {
    name: '折跃等离子',
    description: L10N['item.copy.017']!.zh,
  },
  "min-cryoslurry": {
    name: '低温跃迁浆',
    description: L10N['item.copy.018']!.zh,
  },
  "min-curvature": {
    name: '曲率凝析物',
    description: L10N['item.copy.019']!.zh,
  },
}

const GASES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "gas-neon": {
    name: '氖云气',
    description: L10N['item.copy.034']!.zh,
  },
  "gas-phosphor": {
    name: '磷光霾',
    description: L10N['item.copy.035']!.zh,
  },
  "gas-ionstorm": {
    name: '离子风暴云',
    description: L10N['item.copy.036']!.zh,
  },
  "gas-aurora": {
    name: '极光云',
    description: L10N['item.copy.037']!.zh,
  },
}

const ICES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "ice-frost": {
    name: '蓝霜冰',
    description: L10N['item.copy.038']!.zh,
  },
  "ice-marrow": {
    name: '寒髓冰',
    description: L10N['item.copy.039']!.zh,
  },
  "ice-darkstar": {
    name: '暗星冰',
    description: L10N['item.copy.040']!.zh,
  },
}

const AMMO_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "ammo-kinetic-l": {
    name: '动能弹药',
    description: L10N['item.copy.041']!.zh,
  },
  "ammo-explosive-l": {
    name: '爆破弹药',
    description: L10N['item.copy.042']!.zh,
  },
  "ammo-plasma-l": {
    name: '能量弹药',
    description: L10N['item.copy.043']!.zh,
  },
  "ammo-kinetic-2": {
    name: '动能弹药 MK2',
    description: L10N['item.copy.044']!.zh,
  },
  "ammo-explosive-2": {
    name: '爆破弹药 MK2',
    description: L10N['item.copy.045']!.zh,
  },
  "ammo-plasma-2": {
    name: '能量弹药 MK2',
    description: L10N['item.copy.046']!.zh,
  },
  "ammo-kinetic-3": {
    name: '动能弹药 MK3',
    description: L10N['item.ammoMk3.001']!.zh,
  },
  "ammo-explosive-3": {
    name: '爆破弹药 MK3',
    description: L10N['item.ammoMk3.002']!.zh,
  },
  "ammo-plasma-3": {
    name: '能量弹药 MK3',
    description: L10N['item.ammoMk3.003']!.zh,
  },
}

const DRONES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'drone-jawclaw': {
    name: L10N['item.jawclaw.001']!.zh,
    description: L10N['item.jawclaw.002']!.zh,
  },
  "drone-repair-mil": {
    name: L10N['item.repairDrone.001']!.zh,
    description: L10N['item.repairDrone.002']!.zh,
  },
  "drone-scout": {
    name: '蜂鸟侦察无人机',
    description: L10N['item.copy.047']!.zh,
  },
  "drone-assault": {
    name: '赤鸢战斗无人机',
    description: L10N['item.copy.048']!.zh,
  },
  "drone-heavy": {
    name: '猎鹰攻坚无人机',
    description: L10N['item.copy.049']!.zh,
  },
  "drone-sentry": {
    name: '雷鸥哨戒无人机',
    description: L10N['item.copy.050']!.zh,
  },
  "drone-exile-bee": {
    name: '鱿蜂无人机',
    description:
      L10N['item.copy.051']!.zh,
  },
  "drone-wh-c-heavy": {
    name: '巢卫攻坚无人机',
    description:
      L10N['item.copy.052']!.zh,
  },
  "drone-wh-e-sentry": {
    name: '构件哨戒无人机',
    description:
      L10N['item.copy.053']!.zh,
  },
  "drone-ink-heavy": {
    name: '墨潮重袭无人机',
    description:
      L10N['item.copy.054']!.zh,
  },
}

const REPAIR_KITS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "repairkit-civ": {
    name: '民用修理组件',
    description: L10N['item.copy.055']!.zh,
  },
  "repairkit-mil": {
    name: '军用修理组件',
    description: L10N['item.copy.056']!.zh,
  },
  "repairkit-dc": {
    name: '损管修理组件',
    description: L10N['item.copy.057']!.zh,
  },
}

const MATTER_DEVICES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "mat-surveyor": {
    name: '深空测绘仪',
    description: L10N['item.signalSpace.002']!.zh,
  },
  "mat-chrono": {
    name: '时序核心',
    description: L10N['item.signalSpace.003']!.zh,
  },
  "mat-crane": {
    name: '打捞起重机',
    description: L10N['item.signalSpace.004']!.zh,
  },
  "mat-drill": {
    name: '采集钻机',
    description: L10N['item.signalSpace.005']!.zh,
  },
  "mat-nebula": {
    name: '星云驱散器',
    description: L10N['item.signalSpace.006']!.zh,
  },
  "mat-enricher": {
    name: '母矿富集器',
    description: L10N['item.signalSpace.007']!.zh,
  },
  "mat-expander": {
    name: '舱段扩展器',
    description: L10N['item.signalSpace.008']!.zh,
  },
  "mat-suppressor": {
    name: '压制力场',
    description: L10N['item.signalSpace.009']!.zh,
  },
  "mat-boss-analyzer": {
    name: '守卫解析仪',
    description: L10N['item.signalSpace.010']!.zh,
  },
  "mat-extract-cover": {
    name: '撤离掩护器',
    description: L10N['item.signalSpace.011']!.zh,
  },
  "mat-shield-res": {
    name: '护盾谐振片',
    description: L10N['item.signalSpace.012']!.zh,
  },
  "mat-armor-res": {
    name: '装甲强化片',
    description: L10N['item.signalSpace.013']!.zh,
  },
  "mat-hull-res": {
    name: '结构加固片',
    description: L10N['item.signalSpace.014']!.zh,
  },
  "mat-tracker": {
    name: '追踪阵列',
    description: L10N['item.signalSpace.015']!.zh,
  },
  "mat-gyro": {
    name: '陀螺稳定器',
    description: L10N['item.signalSpace.016']!.zh,
  },
  "mat-jammer": {
    name: '干扰发射器',
    description: L10N['item.signalSpace.017']!.zh,
  },
  "mat-rangefinder": {
    name: '射程扩展器',
    description: L10N['item.signalSpace.018']!.zh,
  },
  "mat-blindspot": {
    name: '盲区压制器',
    description: L10N['item.signalSpace.019']!.zh,
  },
  "mat-ammo-dmg": {
    name: '弹药增效器',
    description: L10N['item.signalSpace.020']!.zh,
  },
  "mat-reload": {
    name: '装填加速器',
    description: L10N['item.signalSpace.021']!.zh,
  },
  "mat-volley": {
    name: '齐射协调仪',
    description: L10N['item.signalSpace.022']!.zh,
  },
  "mat-ammo-back": {
    name: '弹药回收装置',
    description: L10N['item.signalSpace.023']!.zh,
  },
  "mat-drone-net": {
    name: '机群回收网',
    description: L10N['item.signalSpace.024']!.zh,
  },
  "mat-field-repair": {
    name: '战地维修单元',
    description: L10N['item.signalSpace.025']!.zh,
  },
}

const WORMHOLE_ESSENCES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "mat-wh-essence": {
    name: '信号谜质',
    description: L10N['item.copy.090']!.zh,
  },
}

const LUXURIES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "lux-1": {
    name: '星港陈酿',
    description: L10N['item.copy.091']!.zh,
  },
  "lux-2": {
    name: '贵族香料',
    description: L10N['item.copy.092']!.zh,
  },
  "lux-3": {
    name: '失落艺术品',
    description: L10N['item.copy.093']!.zh,
  },
  "lux-4": {
    name: '陈年雪茄',
    description: L10N['item.copy.094']!.zh,
  },
  "lux-5": {
    name: '异域织物',
    description: L10N['item.copy.095']!.zh,
  },
  "lux-6": {
    name: '香木雕刻',
    description: L10N['item.copy.096']!.zh,
  },
  "lux-7": {
    name: '宫廷乐谱',
    description: L10N['item.copy.097']!.zh,
  },
  "lux-8": {
    name: '古法香膏',
    description: L10N['item.copy.098']!.zh,
  },
  "lux-9": {
    name: '星图真迹',
    description: L10N['item.copy.099']!.zh,
  },
  "lux-10": {
    name: '王冠遗钻',
    description: L10N['item.copy.100']!.zh,
  },
}

const VALUABLES_CONTAINERS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "box-valuables": {
    name: '贵重品货柜',
    description: L10N['item.copy.101']!.zh,
  },
}

const MILITARY_CONTAINERS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "box-military": {
    name: '军用备货柜',
    description: L10N['item.copy.102']!.zh,
  },
}

const AI_CORE_ITEMS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "ai-core-gamma": {
    name: '伽马 AI 核心',
    description: L10N['item.copy.103']!.zh,
  },
  "ai-core-beta": {
    name: '贝塔 AI 核心',
    description: L10N['item.copy.104']!.zh,
  },
  "ai-core-alpha": {
    name: '阿尔法 AI 核心',
    description: L10N['item.copy.105']!.zh,
  },
}

const PARTS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "part-circuit": {
    name: '电路基板',
    description: L10N['item.copy.020']!.zh,
  },
  "part-armor-plate": {
    name: '装甲板',
    description: L10N['item.copy.021']!.zh,
  },
  "part-frame": {
    name: '结构框架',
    description: L10N['item.copy.022']!.zh,
  },
  "part-cable": {
    name: '超导电缆',
    description: L10N['item.copy.023']!.zh,
  },
  "part-coolant": {
    name: '冷却导管',
    description: L10N['item.copy.024']!.zh,
  },
  "part-gyro": {
    name: '陀螺稳定器座',
    description: L10N['item.copy.025']!.zh,
  },
  "part-lens": {
    name: '光学透镜组',
    description: L10N['item.copy.026']!.zh,
  },
  "part-drone-neural": {
    name: '无人机神经原件',
    description: L10N['item.copy.027']!.zh,
  },
  "part-shield-gen": {
    name: '护盾发生装置',
    description: L10N['item.copy.028']!.zh,
  },
  "part-jet-array": {
    name: '能量射流阵列',
    description: L10N['item.copy.029']!.zh,
  },
  "part-qchip": {
    name: '量子协处理器芯',
    description: L10N['item.copy.030']!.zh,
  },
  "part-keel": {
    name: '舰用龙骨组件',
    description: L10N['item.copy.031']!.zh,
  },
  "part-fire-control": {
    name: '军规火控计算机',
    description: L10N['item.copy.032']!.zh,
  },
  "part-grav-comp": {
    name: '引力子补偿器',
    description: L10N['item.copy.033']!.zh,
  },
}

const WEEKEND_TROPHIES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'blackbox-c': { name: L10N['item.alien.002']!.zh, description: L10N['item.alien.003']!.zh },
  "blackbox-h": {
    name: '墨潮旗舰黑匣',
    description: L10N['item.copy.106']!.zh,
  },
  "blackbox-r": {
    name: '光环旗舰黑匣',
    description:
      L10N['item.copy.107']!.zh,
  },
  "blackbox-d": {
    name: L10N['item.gravekeeper.001']!.zh,
    description: L10N['item.gravekeeper.002']!.zh,
  },
  "blackbox-universal": {
    name: '通用黑匣',
    description: L10N['item.copy.108']!.zh,
  },
}

const CONSUMABLES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "deep-space-probe": {
    name: L10N['ui.stellar.001']!.zh,
    description: L10N['ui.stellar.002']!.zh,
    unreleased: true,
  },
  "jump-fuel": {
    name: '超空间折跃燃料',
    description: L10N['item.copy.109']!.zh,
  },
  "invasion-beacon": {
    name: '信号发射器',
    description:
      L10N['item.copy.110']!.zh,
  },
  "synaptic-accelerant": {
    name: L10N['item.factionBeacon.009']!.zh,
    description:
      L10N['item.synaptic.001']!.zh,
  },
  'invasion-beacon-r': { name: L10N['item.factionBeacon.001']!.zh, description: L10N['item.factionBeacon.002']!.zh },
  'invasion-beacon-c': { name: L10N['item.factionBeacon.003']!.zh, description: L10N['item.factionBeacon.004']!.zh },
  'invasion-beacon-h': { name: L10N['item.factionBeacon.005']!.zh, description: L10N['item.factionBeacon.006']!.zh },
  'invasion-beacon-d': { name: L10N['item.factionBeacon.007']!.zh, description: L10N['item.factionBeacon.008']!.zh },
}

import type { ItemDef } from '@whale/core'
import { L10N } from './l10n/table'
// ⟪文案调整 2026-10-04⟫ 船长授权整批说明重写，数值与功能不变。

export const ORES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'ORES_0', ORES_0_TEXT_BINDINGS),
]

export const RELIC_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'RELIC_CONTAINERS_0', RELIC_CONTAINERS_0_TEXT_BINDINGS),
]

export const BLUEPRINT_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'BLUEPRINT_CONTAINERS_0', BLUEPRINT_CONTAINERS_0_TEXT_BINDINGS),
]

export const MINERALS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MINERALS_0', MINERALS_0_TEXT_BINDINGS),
]

export const GASES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'GASES_0', GASES_0_TEXT_BINDINGS),
]

export const ICES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'ICES_0', ICES_0_TEXT_BINDINGS),
]

export const AMMO: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'AMMO_0', AMMO_0_TEXT_BINDINGS),
]

export const DRONES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'DRONES_0', DRONES_0_TEXT_BINDINGS),
]

export const REPAIR_KITS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'REPAIR_KITS_0', REPAIR_KITS_0_TEXT_BINDINGS),
]

export const MATTER_DEVICES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MATTER_DEVICES_0', MATTER_DEVICES_0_TEXT_BINDINGS),
]


export const WORMHOLE_ESSENCES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'WORMHOLE_ESSENCES_0', WORMHOLE_ESSENCES_0_TEXT_BINDINGS),
]

export const LUXURIES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'LUXURIES_0', LUXURIES_0_TEXT_BINDINGS),
]

export const VALUABLES_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'VALUABLES_CONTAINERS_0', VALUABLES_CONTAINERS_0_TEXT_BINDINGS),
]

export const MILITARY_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MILITARY_CONTAINERS_0', MILITARY_CONTAINERS_0_TEXT_BINDINGS),
]
export const AI_CORE_ITEMS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'AI_CORE_ITEMS_0', AI_CORE_ITEMS_0_TEXT_BINDINGS),
]

export const PARTS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'PARTS_0', PARTS_0_TEXT_BINDINGS),
]

export const WEEKEND_TROPHIES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'WEEKEND_TROPHIES_0', WEEKEND_TROPHIES_0_TEXT_BINDINGS),
]

export const CONSUMABLES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'CONSUMABLES_0', CONSUMABLES_0_TEXT_BINDINGS),
]

export const ITEMS: readonly ItemDef[] = [
  ...ORES,
  ...MINERALS,
  ...PARTS,
  ...GASES,
  ...ICES,
  ...AMMO,
  ...DRONES,
  ...REPAIR_KITS,
  ...RELIC_CONTAINERS,
  ...BLUEPRINT_CONTAINERS,
  ...MATTER_DEVICES,
  ...WORMHOLE_ESSENCES,
  ...LUXURIES,
  ...VALUABLES_CONTAINERS,
  ...MILITARY_CONTAINERS,
  ...AI_CORE_ITEMS,
  ...WEEKEND_TROPHIES,
  ...CONSUMABLES,
]

export function buildItemCatalog(): ReadonlyMap<string, ItemDef> {
  return new Map(ITEMS.map((item) => [item.id, item]))
}
