/**
 * 物品表（M1 + V10 扩容）：矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机。
 *
 * 数值设计（中文说明）：
 * - 矿石/气体/冰矿 1 单位占 1 m³ 货舱，矿物精炼后体积骤减（0.01 m³/单位）；
 * - 精炼配方 = 「产出倍率基准下每 1 单位资源的矿物产出」（玩家口径：产出倍率，旧称收率；
 *   balance.refining 基础倍率 1.2（无技能净率 ≈+20%）、精炼学 +6%/级、高级回收处理 +3%/级、
 *   满级倍率 1.65（技能本身每级加成较原值下调约 20%）。2026-09-08 工业工位收益体检再定
 *   （配方仍按倍率 1.0 时代的 perOre 值，由引擎倍率驱动产值；perOre 取整允许 ±2pp 漂移）；
 * - 新矿物只由新资源产出 → 不稀释旧矿价值；V10 起高价值采集点需协会声望（见 belts.ts）；
 * - 弹药/无人机为占位消耗品：市场流通、可囤可回卖，战斗系统开放后启用消耗。
 */

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
  "blackbox-universal": {
    name: '通用黑匣',
    description: L10N['item.copy.108']!.zh,
  },
}

const CONSUMABLES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
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
    name: '突触加速剂',
    description:
      L10N['item.copy.111']!.zh,
  },
}

import type { ItemDef } from '@whale/core'
import { L10N } from './l10n/table'
// ⟪文案调整 2026-10-04⟫ 船长授权整批说明重写，数值与功能不变。

/**
 * **矿石（可精炼）· 2026-09-28 船长令：按体积平衡**
 *
 * 船长原话（照抄）：「**原版 EVE 是通过不同矿石每单位体积不同来进行平衡的。体积越小的矿石，
 * 每次挖掘采集到的单位量越多**」＋（锚点）「**1 没问题**」（= 甲案 · 保新手）＋（精炼份额）
 * 「**2，40%**」（= 精炼增值率 **+67%**）＋「**其他按你推荐**」。
 *
 * **三条定档口径**（全批同源，改一处必须三处一起看）：
 * 1. **每 m³ 价值按稀有度递增、域极差 ≤ 1.30**：R1 14.0 / R2 15.0 / R3 16.0 / R4 17.0 / R5 18.125 ISK — 实测 **1.295×**；
 * 2. **体积阶梯**：越稀有越占地方 ⇒ `unitM3` = **0.5 / 1 / 2 / 4 / 8**（R1~R5）；
 * 3. **精炼增值率 = +67%**（精炼份额 40%）：`Σ(perOre × 矿物价) = 1.67 × 单价`，
 *    即"炼成矿物卖"稳定比"直接卖矿"多赚 67%；各矿的矿物**配比**保持原样，只整体缩放。
 *
 * ⚠ 引擎侧按体积结算见 `packages/core/src/mining.ts` 的 `getMiningParams`（件数 = 每循环 m³ ÷ unitM3）；
 *   满舱节奏不受影响（件数 × unitM3 = 每循环 m³，恒定）。
 * ⚠ 存档存量按**体积守恒**折算（v31→v32，见 `packages/core/src/save.ts`）。
 */
export const ORES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'ORES_0', ORES_0_TEXT_BINDINGS),
]

/**
 * **遗迹安全货柜**（F4 · 船长 2026-09-13：「装备和蓝图的产出加一个中间件：玩家从遗迹获得
 * 『遗迹安全货柜』，货柜体积是 2000 立方（也就是 4 格），将安全货柜带回后在精炼炉拆解」）。
 *
 * 口径：
 * - **按族各一种**（A/C/D/E/G）——保住「专属掉落按种族库走」这条裁定：拆解时才知道内容物，
 *   但**族信息不能丢**，所以族写在物品 id 与名字里；
 * - **2000 m³ / 件，占货仓 2×2 = 4 格**（`packages/core/src/wormholeHold.ts` 的形状表已登记这 5 个 id）；
 * - **市场口径**（2026-09-14 船长改判）：它**可带回、可拆解、也可换现** ⇒ 市场**只收不卖**
 *   （`playerBuyable: false`——玩家不能买箱子，否则花钱就能买、把洞内打捞这条渠道架穿）；
 *   **基础价 = 该族内容期望市值 ×0.6**（真引擎 `wormholeUnboxRoll` 抽 4000 次量得，与 `baseSellPriceIsk` 同值）。
 *   ⚠ 2026-09-14 之前这里写着"施工期一律 unreleased、上线动作 = 删字段"——那批字段上线时删掉了，
 *   结果这 8 行**变成 1 信用点的常驻现货**（船长报障「谜质出现在了市场内…并且可以购买」的同源问题）。
 */
export const RELIC_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'RELIC_CONTAINERS_0', RELIC_CONTAINERS_0_TEXT_BINDINGS),
]

/**
 * **图纸货柜**（2026-09-14 船长定：虫洞遗迹打捞新增）。
 *
 * 口径（船长逐条裁定）：
 * - **占货仓 2×1 = 2 格**（`packages/core/src/wormholeHold.ts` 的形状表已登记这 3 个 id）·
 *   **1000 m³ / 件**（与安全货柜同尺：货仓规则是 **500 m³/格**，2000 m³ = 4 格 ⇒ 1000 = 2 格）；
 * - **三种 = 层档**：浅层（第 2 层）· 中层（第 3~4 层）· 深层（第 5 层起）。
 *   ⚠ **层档必须写进物品 id**：拆解读的是精炼炉产线记录里的 `itemId`，而货柜撤离后进仓库
 *   只剩「物品 id + 数量」⇒ 层信息无处可挂。好在稀释池的层门槛是 2/3/5，**三段精确等价**。
 * - **内容物**（拆解时揭）：一次性舰船图纸（T3 / T4 / T5，按层档过滤）+ **5%** 永久图纸（T3 / T4）；
 * - **市场口径**（2026-09-14）：与安全货柜同款——**只收不卖** + 基础价 = 内容期望市值 ×0.6。
 *   ⚠ 这三种箱子"贵"是**内容决定的**（船长问过「为什么图纸货柜那么贵」）：深箱 EV 4,326 万里
 *   **单张皇带鱼一次性图纸（3.2 亿 × 6.3% 出货）就占 46%**；该定价锚由船长选定「维持 EV×0.6」。
 */
export const BLUEPRINT_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'BLUEPRINT_CONTAINERS_0', BLUEPRINT_CONTAINERS_0_TEXT_BINDINGS),
]

/** 矿物（精炼产物，可出售；制造原料） */
export const MINERALS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MINERALS_0', MINERALS_0_TEXT_BINDINGS),
]

/** 气体（可采集可精炼；V10 新资源类） */
export const GASES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'GASES_0', GASES_0_TEXT_BINDINGS),
]

/** 冰矿（可采集可精炼；V10 新资源类） */
export const ICES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'ICES_0', ICES_0_TEXT_BINDINGS),
]

/** 弹药（V10.5 战斗数值契约就位：克制体系见 docs/design/v10b-combat-data.md；
 * 动能弹药对护盾 ×1.5 对装甲 ×0.75、爆破弹药（爆炸）反之、能量弹药（能量系）对护盾 ×1.25 其余 ×1.0；
 * V18 口径取消：每型只留单档通用弹；V18B-1/2：高爆弹更名"爆破弹药"（导弹架专用）、
 * 等离子弹更名"能量弹药"（激光炮专用）——武器形态与弹药一一对应；
 * ⚠ **2026-09-16 船长定名批**：「将弹药 爆破导弹改名为爆破弹药，其他的弹药也进行类似的改名」
 * ⇒ 全族统一到《系+弹药》：**动能弹 → 动能弹药** · **爆破导弹 → 爆破弹药** · 能量弹药不变（含 MK2 两档）。 */
export const AMMO: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'AMMO_0', AMMO_0_TEXT_BINDINGS),
]

/** 无人机（V10.5 战斗数值契约就位：自带伤害源不耗弹；放飞占用船体 CPU——V10.5b 带宽并入；
 * 携带上限受无人机舱容积（ship.droneBayM3）与 CPU 双约束；defense（V11）= 三层血量/回避契约，
 * v1 并入主船火力不单独承伤，"可被击落"机制启用时零迁移）
 * 体积档（2026-09-09 船长拍板）：unitM3 按机种大小分 5/10/20/40 四档——机巢能装几架由体积主导
 * （小护卫带蜂鸟/赤鸢、炮舰带猎鹰、母舰带雷鸥；甲板扩展 +m³ 恢复意义），每架 CPU 不变 */
export const DRONES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'DRONES_0', DRONES_0_TEXT_BINDINGS),
]

/** 修理组件（P2 定稿 2026-09-05；**2026-09-13 船长改数值**：基础回复对齐「船体维修装置每跳」口径——
 * 民用 30 → **5**、军用 70 → **10**；甲、结构各按此值 × 该层容量增幅 × 舰体快修学（与装置侧同吃该技能）。
 * 厚甲船绝对回复更大 = 甲抗流特征保留） */
export const REPAIR_KITS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'REPAIR_KITS_0', REPAIR_KITS_0_TEXT_BINDINGS),
]

/**
 * **谜质储存器**（F3c · 船长 2026-09-13 逐条裁定；A 批 = 探索与作业类 7 台）。
 *
 * 船长原话（照抄）：「**现在做，谜质玩家采集后，在货仓内显示为4格的『谜质储存器』，
 * 在本次虫洞探索中提供临时增益**」＋「多种效果……包括探索上的增益：扫描+1.回合数+10.威胁-5%。
 * 每个装置额外打捞/采集等」。
 *
 * 口径：
 * - **一台 = 2000 m³ = 2×2 = 4 格**形状件（`packages/core/src/wormholeHold.ts` 形状表已登记这 7 个 id）；
 * - **放在货仓里就生效、本趟结束随趟消失**（不进仓库、不拆解；效果一律现算，见 `wormholeMatter.ts`）；
 * - **施工期一律 `unreleased`**（与虫洞同批上线；`content:check` 有契约钉住）；
 * - 战斗类与威胁类装置（12 + 3 台）在 B 批追加。
 */
export const MATTER_DEVICES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MATTER_DEVICES_0', MATTER_DEVICES_0_TEXT_BINDINGS),
]

/**
 * **AI 核心（洞内实物形态）**（船长 2026-09-14：「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的
 * 掉落。AI 核心单独占 1 格。出率为 10%，不挤占旧有出率。三种核心根据稀有度区分出货权重」）。
 *
 * 为什么要"实物形态"这一层：AI 核心在游戏里**是一本账**（`state.aiCores`：市场买卖、技能上限、
 * 副船与产线占用全按它走），而**虫洞货仓只认物品 id**（占格、拖拽、临时空间、散落、结算全按物品走）
 * ⇒ 想让它"占 1 格"就必须先有物品卡。船长裁定：**撤离成功那一刻自动接入核心库、不进仓库**
 * （避免"仓库里有 3 个核心却不能接"的两本账）。
 *
 * **`kind: 'aicore'` 是本次新增的分类**（不复用 `container`）：拆解台的门是 `def.kind !== 'container'`
 * ⇒ 复用会让核心出现在拆解台、还会被丢进货柜抽奖（抽不出东西）；新分类语义干净，
 * `ITEM_KIND_ORDER` / `ITEM_KIND_LABELS` 两处登记，漏登记 typecheck 直接失败。
 *
 * **id 为什么是 `ai-core-*` 而不是 `core-*`**：市场那本账的 key 就叫 `core-gamma`（`kind:'aicore'`、
 * `refId:'gamma'`，见 `marketCatalog.ts`）——两者是不同命名空间，但同名会让人以为是一回事。
 *
 * `unitM3: 500` 与"1 格"对得上（货仓 500 m³/格，形状表登记 1×1）；`baseSellPriceIsk: 1` 与货柜同款
 * 兜底（它不上市交易，市场卡 `basePrice 1` / `demandMultiplier 0`）。施工期一律 `unreleased`。
 */
/* ══════════ 虫洞战利品与经济扩充（船长 2026-09-15 确认；口径见 docs/glossary.md 八之二「战利品四件」）══════════ */

/**
 * **虫洞谜质**（精华形态 · 船长 2026-09-15：「**谜质在虫洞结束时不再删除，而是转化成虫洞谜质存入仓库。
 * 介绍是虫洞内存在的奇幻物资，具备研究价值。该物品只收不卖。且具备较高价值，目前纯粹作为虫洞的金钱收益。**」）。
 *
 * 口径：
 * - **撤离成功时**按本趟**已取回**的谜质装置台数换算（**1 台 = 1 枚**）；**全损不转**（随货仓一起丢）；
 *   **没捡的不补发**；装置本身的「取回即生效、离洞失效」增益**保留**（本批只新增"转成物品"这一条）；
 * - **只收不卖**（`playerBuyable: false`）、市场行 `demandMultiplier: 1.0` ⇒ **NPC 收购 = 700,000/枚**
 *   （2026-09-19 船长：「**谜质单价提高到70W**」——同时它是「谜质科技树」的双货币之一，见 `matterTech.ts`）；
 * - 它是**仓库物品**（不占虫洞货仓形状格、不进拆解/精炼/制造链）。
 */
export const WORMHOLE_ESSENCES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'WORMHOLE_ESSENCES_0', WORMHOLE_ESSENCES_0_TEXT_BINDINGS),
]

/**
 * **奢侈品**（船长 2026-09-15：「新增贵重品货柜，2格，精炼炉拆解后获得随机数量的'奢侈品'，
 * 奢侈品纯粹用来卖钱，**市场正常交易**」）——纯贸易品：**可买可卖**、不参与拆解/精炼/制造链，
 * 来源 = 贵重品货柜拆解（每箱 **5~30 件**、**十款等权**）。
 * ⚠ **2026-09-15 船长改判**（原 2.4 / 4.8 / 9.6 万）：「**单价差距提高（10/40/200万）**」。
 * ⚠ **2026-09-16 船长扩表**：「**添加更多奢侈品，让奢侈品有10个类型，分布在目前的3个奢侈品价格附近**」
 * ⇒ 由 3 款扩到 **10 款**（低带 ≈6~14 万 / 中带 ≈25~80 万 / 高带 ≈120~320 万，围绕原来的
 * 10 万 / 40 万 / 200 万三档铺开）；**十款等权**（船长同日选定）⇒ 均价 **87.5 万**、
 * 一箱期望 = 87.5 × 17.5 ≈ **1,531.25 万**、箱价 = ×0.25 = **382.8 万**
 * （契约 `content:check`「战利品扩充契约②⑧」按本表现算，改价必须同步箱价）。
 * ⚠ 价格波动：船长 2026-09-16 明确「**保持不变**」——实测奢侈品在 30 天里已能摆到
 * **−40% ~ +39%**（撞满市场噪声的 ±0.4 钳制），故本条**不动**任何行情参数。
 */
export const LUXURIES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'LUXURIES_0', LUXURIES_0_TEXT_BINDINGS),
]

/**
 * **贵重品货柜**（船长 2026-09-15）——**4 格**（2000 m³ / 2×2，与军用备货柜同形同积）、**只收不卖**、
 * 拆解产物 = 奢侈品 **5~30 件**（`industry` 的拆解台产出表）。
 * ⚠ **2026-09-16 船长**：「**奢侈品货柜调整为2*2**」——占货仓 **2×1 = 2 格 → 2×2 = 4 格**、
 * 体积 **1000 → 2000 m³**（500 m³/格 × 4 格）；形状表与 `content:check` 的货柜契约两处同改。
 * 箱价口径（船长 2026-09-15 改判）：**= 内容期望 ×0.25**（本箱专属折扣；其余三类柜仍是 ×0.6）——
 * ⚠ **2026-09-16 随奢侈品扩到十款重算**：期望 = 17.5 件 × 均价 **87.5 万** ≈ **1,531.25 万**
 * ⇒ 箱价 **382.8 万**（原 365 万 = 三款均价 83.33 万 × 17.5 × 0.25）。
 */
export const VALUABLES_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'VALUABLES_CONTAINERS_0', VALUABLES_CONTAINERS_0_TEXT_BINDINGS),
]

/**
 * **军用备货柜**（船长 2026-09-15：「新增军用备货柜4格，精炼炉可以从中拆出数件随机MK3装备」
 * ＋「**军用备货柜含武器，不含专属**」）——**4 格**（2000 m³ / 2×2）、**只收不卖**、
 * 拆解产物 = **随机 MK3 装备 1~3 件**（**含武器**；**排除** `mod-lair-*` 族专属与 `mod-wh-*` 虫洞专属）。
 */
export const MILITARY_CONTAINERS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'MILITARY_CONTAINERS_0', MILITARY_CONTAINERS_0_TEXT_BINDINGS),
]
export const AI_CORE_ITEMS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'AI_CORE_ITEMS_0', AI_CORE_ITEMS_0_TEXT_BINDINGS),
]

/**
 * **零件**（2026-09-20 船长「组装机内新增零件分页」）：工业中间件。
 * 基础 7 件 = 组装机「零件」分页直接可造（隐式蓝图 `bp-part-*`，无需学习；市场常驻可买卖）；
 * 高级 7 件 = 需学习蓝图（`bp-part-*-advanced` 系蓝图）后制造（市场稀有订单层）。
 * 用途：专属装备/专属舰船/旗舰配方与空间站建材；定价 = 材料成本 ×1.3~1.5（基础）/ ×1.4~1.6（高级）。
 */
export const PARTS: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'PARTS_0', PARTS_0_TEXT_BINDINGS),
]

/**
 * **入侵旗舰黑匣**（船长 2026-09-25：「**黑匣先做壳**」）：周末入侵击毁旗舰必掉 ×1。
 * 本批只做"壳"——**可存、可回收、可售予回收商**；**用途（开特殊装备/改装件）留待改装件那批**，
 * 故描述里只写它是什么、不写"将来能开什么"（开发口径不进玩家可见文案）。
 *
 * ⚠ **`kind` 沿革（2026-09-26 船长报障「入侵获得的黑匣在仓库内查看不到，需要新增分类」）**：
 * 09-25 那批临时借 `kit`（"无配方消耗品豁免"档）⇒ 仓库/货仓/手册/市场**全按 kind 分类**，
 * 它被塞进「**修理组件**」里 ⇒ 玩家按「黑匣」找永远找不到。现独立成 `'blackbox'` 一档
 * （见 `ItemKind` 注释）：仓库分类 / 货仓分组 / 手册物品图鉴按 `ITEM_KIND_ORDER` 渲染 ⇒ **自动**多出
 * 「黑匣」；市场一级类型另在 `MarketPage` 的类型下拉里显式登记一档。
 *
 * 价格按2026-10-06船长确认下调；物品基础收价与市场目录基价保持同值，用例核对。
 */
export const WEEKEND_TROPHIES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'WEEKEND_TROPHIES_0', WEEKEND_TROPHIES_0_TEXT_BINDINGS),
]

/**
 * **道具**（`kind: 'consumable'`；**2026-09-29 船长令 · 跃迁燃料批**）。
 *
 * **超空间折跃燃料**（`jump-fuel`）：
 * - **计量 = 秒**：1 单位燃料 ⇒ 抵扣 **1 秒「原返航时长」**（原返航 = 不含燃料时的返航时长，
 *   已含"货仓占比缩放"）；返航腿开始时**扣一次** `ceil(原返航秒)` 单位；
 * - **效果 = 返航速度 ×10**（时长 ÷10，见 `core/jumpFuel.ts` 的 `JUMP_FUEL_SPEED_MUL`）；
 * - **来源** = 工业页「**实验室**」合成（每批 600 单位 · 见 `labRecipes.ts`），
 *   解锁门槛 = **已建成空间站 ≥ 1 座**（船长令：「需要玩家建设第一个空间站后才解锁相关内容」）；
 * - **市场** = 稀有档（池商品，可买卖）——船长 2026-09-29「燃料可买卖放入稀有（但是是池子）」；
 * - **体积 1 m³/单位，且普通舰船货仓无法装入**（**2026-09-30 船长令**：「每单位燃料体积为1m³，
 *   但是普通舰船的货仓无法装入」⇒ `holdForbidden`）：燃料只存在于**物品仓库**，
 *   上限也只算仓库（`core/jumpFuel.ts` 的 `JUMP_FUEL_CAP_BASE`）；老档残留在货仓的那份由读档迁移归仓。
 */
export const CONSUMABLES: readonly ItemDef[] = [
  ...staticDataGroup<ItemDef>(staticDocument as unknown as DataDocument, 'CONSUMABLES_0', CONSUMABLES_0_TEXT_BINDINGS),
]

/** 全部物品（矿石/矿物在前为兼容旧展示顺序，其后气体/冰/弹药/无人机/修理组件） */
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

/** 构建"物品 id → 定义"目录 */
export function buildItemCatalog(): ReadonlyMap<string, ItemDef> {
  return new Map(ITEMS.map((item) => [item.id, item]))
}
