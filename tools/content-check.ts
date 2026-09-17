/**
 * 内容完整性体检（V10 数据大扩容后加入）：
 * 校验 data 包全部内容表的交叉引用，防止"加数据改漏引用"造成的死物品/坏目录。
 *
 * 覆盖（中文说明）：
 * - 目录键唯一；市场卡 refId 必须能按 kind 解析到真实条目；
 * - 每种物品（「原矿」「原材料」/气体/冰/弹药/无人机）都必须有市场卡（防死物品：买不了也卖不了）；
 *   （术语：2026-09-12 船长定 —— `ore` = 原矿、`mineral` = 原材料；旧名「矿石、矿物」作废）
 * - 采集点：id 唯一、产出物存在且可采集（ore/gas/ice）、声望门槛非负整数；
 * - 精炼配方：只有可精炼资源（ore/gas/ice）带配方、配方行原材料存在且 kind=mineral；
 * - 装备：id 唯一、slot 在六槽内、参数按家族齐备；**窝点专属装备例外**（无市场卡、无蓝图，只从高级箱出，见下方契约）；
 * - 蓝图：id 唯一、模块/船存在、材料都是矿物；蓝图卡存在时其 refId 必须解析到真实蓝图（否则无法购书学习）；
 * - 舰船：id 唯一、role 合法；蓝图的产物船存在；舰船蓝图引用船存在；
 * - 市场卡：refId 解析 + 池商品必须有 poolTarget/supplyFlow、单件门槛/倍数字段数值合法。
 *
 * 用法：npm run content:check（或 npx tsx tools/content-check.ts）
 */

import {
  BLUEPRINTS,
  BLUEPRINT_PRICE_STEP,
  BLUEPRINT_PRICE_OVERRIDES,
  blueprintBookPriceOf,
  blueprintTierCoefOf,
  ITEMS,
  BELTS,
  MARKET_GOODS,
  buildMarketGoodsCatalog,
  WRECK_BUY_GOODS,
  MODULES,
  DRONES,
  SHIP_BLUEPRINTS,
  SHIPS,
  ANOMALIES_FLAVORED,
  FOE_SHIPS,
  FOE_DRONES,
  RARITY_TIER,
  SKILLS,
  DRONE_ROLE_SPECS,
  DRONE_ROLE_ANCHORS,
  droneRoleIssues,
  droneRoleLadderIssues,
  droneTotalHp,
  HULL_CLASS_NAME,
  HULL_CLASS_BASE_SPEED,
  HULL_CLASS_MASS_RANGE,
  equivalentMassOf,
  buildItemCatalog,
  buildSimContext,
  RETIRED_LAIR_CARD_IDS,
  WORMHOLE_RARE_WRECK_CARD_IDS,
  ALIEN_BEAST_SHIP_IDS,
  ALIEN_CHARGE_MUL_BY_TIER,
  ALIEN_SLOW_SHIP_IDS,
  COMMS_MESSAGES,
  COMMS_FACTIONS,
  FACTION_AVATARS,
  TUTORIAL_TOTAL,
  DIALOGUES,
  STATION_SITES,
  GALAXIES,
  // 2026-09-15 船长「撞到的契约开白名单」：构成口径由舰级说了算的舰级（D 6:4 / E 纯爆炸）
  FOE_SHIP_MIX_AUTHORITY_IDS,
  WORMHOLE_FOE_CARD_IDS,
} from '@whale/data'
// ⚠ **跨层 import（有意为之）**：装配页卡片正文由渲染层 `moduleShortEffect` 生成，而 `apps/desktop`
//   **没有测试运行器** ⇒ 这条口径只能由体检兜住（见下方「装备卡片说明契约」）。
import { moduleShortEffect } from '../apps/desktop/src/renderer/src/ui/shipInfo'
// ⚠ 同款跨层 import：图鉴 →「↖ 查看市场」的条目→商品映射（2026-09-14 船长）在渲染层单点，
//   体检「图鉴市场跳转契约」逐个走它，防"按钮整类静默消失"。
//   ⚠ 只 import 这个**只依赖 `@whale/core`** 的小模块：`panels/Handbook.tsx` 会带上 `@whale/ui` 的
//   CSS，node 侧 tsx 加载即 `SyntaxError`（实测），故映射单点单独成文件。
import { handMarketKeyOf } from '../apps/desktop/src/renderer/src/ui/marketJump'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { join } from 'node:path'
import { tableOf } from './content-schema'
import {
  DEFAULT_BALANCE,
  ITEM_KIND_ORDER,
  MAX_SKILL_LEVEL,
  MODULE_SLOTS,
  typeLayerMult,
  REPAIR_PULSE_MS,
  SHIELD_PULSE_MS,
  DRONE_SKILL,
  MINEABLE_KINDS,
  RACK_SLOTS,
  RARE_WRECK_VOLUME_M3,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_POOLS,
  SHIP_ROLE_LABELS,
  FOE_MOUNTS,
  FOE_MOUNT_IDS,
  resolveFoeMounts,
  isArmorLineShip,
  shipCategoryKeyOf,
  createFoeSpecs, // 机群火力占比契约的守恒实测（Σ 单发对照）
  FOE_LAIR_GEAR,
  BOUNTY_ZONE_PLAN,
// 2026-09-12：安全分区**单一出处**（`sideTasks.securityZoneOf`）——体检不再自己内联重算边界
securityZoneOf,
  FACTION_RARE_DROP_CHANCE,
  FACTION_RARE_DROP_PITY_ROLLS,
  factionRareDropEffectiveRate,
  FACTION_RARE_DROP_COUNT,
  FRAGMENT_RECIPES,
  hasLairCore,
  isLairCandidate,
  lairGearOf,
  lairLevelOf,
  lairNameOf,
  lairAnomalyOf,
  subDamageTypeOf,
  type DamageType,
  rareWreckItemIdOf,
  rareBoxThemePoolOf,
  recycleProfileOf,
  recycleTierOf,
  rackOf,
  wreckBaseDensity,
  foeLayerSplit,
  // 2026-09-13：未上线闸门（给玩家看的物品目录 vs 引擎全目录）
  itemReleased,
  // 2026-09-14：图鉴市场跳转契约按**玩家可见物品目录**遍历（与手册·物品图鉴同一入口）
  visibleItemDefs,
  // 2026-09-13：洞内敌卡轮换表（与 data 清单、内容侧契约三处同序；见「虫洞不可见闸门」）
  WORMHOLE_FOE_CARD_IDS as coreWhIds,
  // 2026-09-13 F3b：按族掉落池（装备/装备图纸/舰船图纸；五族池非空契约）
  WORMHOLE_FAMILIES,
  wormholeFamilyPoolGaps,
  wormholeFamilyPoolOf,
  wormholeDilutionPoolOf,
  wormholeLootShares,
  // 2026-09-13 层间盘面 + 星云机制（船长三条裁定）：遗迹下限 / 空占比随层降 / 星云起效层与配额
  WORMHOLE_NEBULA_MIN_DEPTH,
  WORMHOLE_NEBULA_SHARE,
  wormholeEmptyShareFor,
  wormholeMakeGrid,
  wormholeRuinsFloorFor,
  // 2026-09-16 船长：「遗迹的保底，改为从3层开始保底。1层没有遗迹」
  WORMHOLE_RUINS_FLOOR_MIN_DEPTH,
  // F3c 谜质储存器（船长 2026-09-13）：装置表 / 形状登记 / 保底 1 格的常量
  WORMHOLE_DILUTION_MIN_DEPTH_FLOOR,
  // 2026-09-15 限时倍率表（船长：按现实日期给特定数值上倍率）——契约见文件尾
  TUNING_RULES,
  TUNABLE_KNOBS,
  localDayStartMs,
  // 2026-09-16 限时促销（船长：「虫洞大量生成」= 扫描加速 ＋ 一次性赠送）——契约见文件尾
  PROMOS,
  // 2026-09-14 图纸货柜（船长：遗迹打捞新增 · 占 2 格 · 一次性 + 5% 永久图纸）
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_BP_BOX_SHALLOW,
  WORMHOLE_BP_BOX_DEPTH,
  wormholePermanentPoolOf,
  WORMHOLE_BPBOX_PERMANENT_CHANCE,
  wormholeDilutionPoolOf,
  wormholeFamilyPoolGaps,
  WORMHOLE_MATTER_DEVICES,
  WORMHOLE_MATTER_DRAW_POOL,
  WORMHOLE_MATTER_DEVICE_IDS,
  WORMHOLE_MATTER_FLOOR,
  wormholeIsShapedItem,
  // 2026-09-14 AI 核心（船长：遗迹打捞 10% 掉落 · 60/30/10 · 各占 1 格 · 撤离后入核心账）
  WORMHOLE_CORE_ITEM_IDS,
  WORMHOLE_CORE_SHARE,
  WORMHOLE_CORE_WEIGHTS,
  wormholeCoreTypeOfItemId,
  wormholeShapeOf,
  // 2026-09-14 虫洞扫描解锁（船长：「扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家」）
  // 2026-09-14 船长：内容原型（丙）+ 敌族锁定（丁）——两张表的自洽契约
  WORMHOLE_ARCHETYPES,
  WORMHOLE_ARCHETYPE_WEIGHTS,
  WORMHOLE_ARCHETYPE_LABELS,
  WORMHOLE_SIGNAL_WEIGHTS,
  wormholeSignalWeightsFor,
  WORMHOLE_AUTO_ARCHETYPE_WEIGHTS,
  WORMHOLE_FAMILY_ORDER,
  // 2026-09-16 船长：扫描页虫洞卡片的"敌情"（族称 + 主系 + 三档构成）——契约见文件中部「卡片敌情契约」
  wormholeFamilyIntel,
  WORMHOLE_FAMILY_CARD,
  // 2026-09-15 洞内敌卡扩充：一族三档 / 出场池 / 分层血量修正 / 族定选靶
  WORMHOLE_FAMILY_CARDS,
  WORMHOLE_CARD_TIERS,
  WORMHOLE_TIER_THREAT_MUL,
  WORMHOLE_TIER_UNLOCK_DEPTH,
  WORMHOLE_FAMILY_TARGETING,
  WORMHOLE_FAMILY_TARGETING_CHANCE,
  wormholeCardPoolAt,
  wormholeAllCardIds,
  wormholeTierOfCard,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  DSI_FACTION_ID,
  // 2026-09-15 虫洞战利品与经济扩充（契约块见文件中部）：谜质 / 奢侈品 / 两个新货柜 / 打捞掷骰
  WORMHOLE_ESSENCE_ITEM_ID,
  WORMHOLE_ESSENCE_PER_DEVICE,
  WORMHOLE_LUXURY_ITEM_IDS,
  WORMHOLE_VALUABLES_BOX_ID,
  WORMHOLE_VALUABLES_UNITS_MIN,
  WORMHOLE_VALUABLES_UNITS_MAX,
  WORMHOLE_MILITARY_BOX_ID,
  WORMHOLE_MILITARY_PIECES_MIN,
  WORMHOLE_MILITARY_PIECES_MAX,
  WORMHOLE_SALVAGE_BOX_CHANCE,
  WORMHOLE_SALVAGE_BOX_MAX,
  WORMHOLE_RELIC_BOX_CHANCE,
  WORMHOLE_RELIC_VALUABLES_SHARE,
  wormholeRelicBoxPoolOf,
  wormholeRelicChanceOf,
  wormholeMk3PoolOf,
  wormholeRareBoxThemePoolOf,
  wormholeSalvageBoxClassesOf,
} from '@whale/core'

const errors: string[] = []
const warn: string[] = []

function check(cond: boolean, msg: string): void {
  if (!cond) errors.push(msg)
}

/* ═══════════ 族级速度口径（模块作用域：**敌速口径契约**与**舰级契约**两个块共用） ═══════════
 * ⚠ 为什么放模块作用域：这两个契约各在自己的 `{ }` 块里，块内 `const` 互不可见 ——
 *   2026-09-15 批 5 把 G 族常量写在其中一个块里 ⇒ 另一块直接 `ReferenceError`（实测踩到）。 */

/** **G 族速度定值**（船长 2026-09-12：「**速度口径按照 1.05 算**」） */
const G_SPEED_RATIO = 1.05
/**
 * **G 族族级速带**（2026-09-15 加）：全族 `speedRatio` 定值 1.05 ⇒ 实速随本档舰种基准下降
 * （357 / 310 / 271 / 215）⇒ 比率 **1.22 / 1.06 / 0.93 / 0.73**。
 * ⚠ 0.73 会被 orbit 战术带（0.90~1.25）**误拦** ⇒ 与 B/D/E 三次同款：**族级口径必须用族级带表达**。
 * 触发经过：2026-09-15 批 5 启用「亡军战列舰」——此前它无卡引用，这条口径从未被实战卡触发过。
 */
const G_SPEED_BAND: readonly [number, number] = [0.70, 1.25]

/* ── 基础目录 ── */
const items = buildItemCatalog()
/* 动态物品（残骸/蓝图碎片按敌群/逆向配方生成，不入静态物品表）——市场卡 item 解析用 */
const ctxItems = buildSimContext().items
const itemDefs = [...ITEMS]
const ores = itemDefs.filter((i) => i.kind === 'ore')
const minerals = itemDefs.filter((i) => i.kind === 'mineral')
const gases = itemDefs.filter((i) => i.kind === 'gas')
const ices = itemDefs.filter((i) => i.kind === 'ice')
const ammos = itemDefs.filter((i) => i.kind === 'ammo')
const drones = itemDefs.filter((i) => i.kind === 'drone')
/** 无人机四型定位契约的单发基准 = **锚点侦察机**单发（2026-09-10 船长拍板；
 * 专属强化机型不参与基准——见 data/droneRoles.ts 的 DRONE_ROLE_ANCHORS） */
const scoutDmg = drones.find((d) => d.id === DRONE_ROLE_ANCHORS.scout)?.dmg ?? 0
const DMG_TYPES = new Set(['kinetic', 'explosive', 'plasma'])

// 数量与目标规模（V10 设计确认；V16 矿带整合：矿石 10→7，总量 35→32；V18 口径取消：重弹并入通用弹 6→3；
// 2026-09-09 弹药 MK2：每族 +1 高级弹 → 弹药 6 种，物品总数 31→34；
// 2026-09-10 G 族专属无人机「鱿蜂无人机」→ 无人机 4→5 种、物品总数 34→35；
// 2026-09-12 虫洞线：新增**虚空母矿**（原矿 8 种、物品总数 35→36）——术语同步为「原矿 / 原材料」）
// 2026-09-13 虫洞族专属机型 2 型（`drone-wh-c-heavy` 巢卫攻坚 / `drone-wh-e-sentry` 构件哨戒，
// 船长：C 移「活性甲壳层」/ E 移「巨构稳态器」⇒ 换成族专属无人机）→ 物品总数 36→**38**、无人机 5→**7**
// 2026-09-13 F4：遗迹安全货柜 5 种（中间件，施工期 unreleased）→ 物品总数 38→**43**
// 2026-09-13 F3c：谜质储存器 7 台（A 批 = 探索与作业类；施工期 unreleased）→ 物品总数 43→**50**
// 2026-09-13 F3c-B1：谜质储存器再 13 台（威胁 3 + 战斗 10）→ 物品总数 50→**63**
// 2026-09-13 F3c-B2：谜质储存器再 4 台（溢火结转 / 弹药回收 / 机群回收网 / 战地维修）→ 物品总数 63→**67**
// 2026-09-14：图纸货柜 3 种（层档三种 · 施工期 unreleased）→ 物品总数 67→**70**
// 2026-09-14：AI 核心 3 种（伽马/贝塔/阿尔法 · 洞内实物形态 · 施工期 unreleased）→ 物品总数 70→**73**
// 2026-09-15：+6（谜质精华 · 奢侈品 ×3 · 贵重品货柜 · 军用备货柜）→ 物品总数 73→**79**
// 2026-09-16：奢侈品扩到十款（船长「添加更多奢侈品，让奢侈品有10个类型，分布在目前的3个奢侈品价格附近」）
//   ⇒ +7（陈年雪茄 / 异域织物 / 香木雕刻 / 宫廷乐谱 / 古法香膏 / 星图真迹 / 王冠遗钻）→ 物品总数 79→**86**
check(itemDefs.length === 86, `物品总数应为 86，实际 ${itemDefs.length}`)
check(ores.length === 8, `原矿应为 8 种（含虫洞线的虚空母矿），实际 ${ores.length}`)
check(minerals.length === 8, `原材料应为 8 种，实际 ${minerals.length}`)
check(gases.length === 4, `气体应为 4 种，实际 ${gases.length}`)
check(ices.length === 3, `冰矿应为 3 种，实际 ${ices.length}`)
check(ammos.length === 6, `弹药应为 6 种（每族基础弹 + MK2），实际 ${ammos.length}`)
check(drones.length === 7, `无人机应为 7 种（四型制式锚点 + 鱿蜂 + 2 型虫洞族专属），实际 ${drones.length}`)

/* ── 市场目录 ── */
const goodKeys = new Set<string>()
const itemGoods = new Map<string, { rarity: string; playerSellable: boolean; playerBuyable: boolean }>()
for (const g of MARKET_GOODS) {
  if (goodKeys.has(g.key)) errors.push(`市场卡键重复：${g.key}`)
  goodKeys.add(g.key)
  switch (g.kind) {
    case 'item':
      check(ctxItems.has(g.refId), `市场卡 ${g.key} → 物品 ${g.refId} 不存在`)
      if (ctxItems.has(g.refId)) {
        itemGoods.set(g.refId, {
          rarity: g.rarity,
          playerSellable: g.playerSellable !== false,
          // 2026-09-14 增：专属型号"只收不卖"判据要用它（原先这张表没带 playerBuyable）
          playerBuyable: g.playerBuyable !== false,
        })
      }
      break
    case 'module':
      check(MODULES.some((m) => m.id === g.refId), `市场卡 ${g.key} → 装备 ${g.refId} 不存在`)
      break
    case 'ship':
      check(SHIPS.some((s) => s.id === g.refId), `市场卡 ${g.key} → 舰船 ${g.refId} 不存在`)
      break
    case 'blueprint':
      check(
        BLUEPRINTS.some((b) => b.id === g.refId) || SHIP_BLUEPRINTS.some((b) => b.id === g.refId),
        `市场卡 ${g.key} → 蓝图 ${g.refId} 不存在`,
      )
      break
    case 'aicore':
      check(['basic', 'gamma', 'beta', 'alpha'].includes(g.refId), `市场卡 ${g.key} → 核心 ${g.refId} 非法`)
      break
    default:
      errors.push(`市场卡 ${g.key} 的 kind 未知：${g.kind}`)
  }
  if (g.kind !== 'item') {
    check(g.standingReq === undefined || (Number.isInteger(g.standingReq) && g.standingReq >= 0), `市场卡 ${g.key} standingReq 非法`)
  }
  if (g.poolTarget !== undefined) {
    check((g.poolTarget ?? 0) > 0 && (g.supplyFlow ?? 0) > 0, `池商品 ${g.key} 缺少 poolTarget/supplyFlow`)
  }
}
check(goodKeys.size === MARKET_GOODS.length, `市场卡键重复（${MARKET_GOODS.length - goodKeys.size} 处）`)
console.log(`· 市场商品卡：${MARKET_GOODS.length} 张`)

/* ── 数字稀有度表（2026-09-09 船长拍板：稀有度入物品本体 RARITY_TIER，市场调用）── */
{
  const tableKeys = new Set(Object.keys(RARITY_TIER))
  const refSet = new Set(MARKET_GOODS.map((g) => g.refId))
  check(tableKeys.size === MARKET_GOODS.length, `稀有度表键数 ${tableKeys.size} ≠ 市场卡数 ${MARKET_GOODS.length}`)
  for (const ref of refSet) {
    if (!tableKeys.has(ref)) errors.push(`市场卡 ${ref} 缺稀有度表项（RARITY_TIER）`)
  }
  for (const k of tableKeys) {
    if (!refSet.has(k)) errors.push(`稀有度表多余键 ${k}（无对应市场卡）`)
    const v = RARITY_TIER[k]!
    check(Number.isInteger(v) && v >= 1 && v <= 4, `稀有度表 ${k} 值非法：${v}（应为 1~4 整数）`)
  }
  // 渠道一致性：common 必须 1；rare 只能 2/3；exotic 只能 3/4（低值奇货可标 3，船长 2026-09-09）
  for (const g of MARKET_GOODS) {
    const v = RARITY_TIER[g.refId] ?? 0
    if (g.rarity === 'common') check(v === 1, `稀有度表 ${g.refId}：common 渠道应为 1，实际 ${v}`)
    else if (g.rarity === 'rare') check(v === 2 || v === 3, `稀有度表 ${g.refId}：rare 渠道应为 2/3，实际 ${v}`)
    else check(v === 3 || v === 4, `稀有度表 ${g.refId}：exotic 渠道应为 3/4，实际 ${v}`)
  }
}

// 每种物品必须有市场卡（防死物品）——**专属型号例外**（2026-09-10 船长：敌族窝点高级箱专属，
// 无蓝图、不入常规掉落：渠道唯一由下方「来源唯一契约」正向断言）。
// ⚠ **2026-09-14 船长改判**：「允许玩家挂卖，顺便检查下其他物品，维持所有物品允许玩家挂卖」
// ⇒ 专属型号**可以有市场卡，但必须是"只收不卖"**（`playerBuyable: false`：市场不出售现货、
// 玩家可挂卖/卖给 NPC 收购单）；**可购买的市场卡仍然禁止**（那才是"上市场卖现货"）。
for (const item of itemDefs) {
  const good = itemGoods.get(item.id)
  if (item.exclusive === true) {
    check(
      !good || good.playerBuyable === false,
      `专属物品 ${item.id} 的市场卡必须只收不卖（playerBuyable: false）——专属型号不上架卖现货，只允许玩家挂卖`,
    )
    continue
  }
  if (!good) {
    errors.push(`物品 ${item.id}（${item.name}）没有市场卡——将无法买卖（死物品）`)
  } else if (good.rarity !== 'common') {
    warn.push(`物品 ${item.id} 的市场卡非常驻（${good.rarity}），玩家产出将无法稳定卖出`)
  }
}

/**
 * **三类"无精炼配方但有真实用途"的虫洞中间件名单**（2026-09-14 虫洞上线后，把原先"施工期豁免"
 * 换成按用途判定；见下面 `item.refine` 那段的注释）：
 * - 货柜：5 种安全货柜（`box-relic-<族>`）+ 3 种图纸货柜（`WORMHOLE_BP_BOX_IDS`）⇒ 拆解台可开；
 * - 谜质储存器：`WORMHOLE_MATTER_DEVICE_IDS`（core 装置表）⇒ 洞内随行生效；
 * - AI 核心（实物形态）：指到它的**核心市场卡**（kind `aicore`）⇒ 撤离即入核心账本。
 */
const containerIds = new Set<string>([
  ...WORMHOLE_FAMILIES.map((f) => `box-relic-${f.toLowerCase()}`),
  ...WORMHOLE_BP_BOX_IDS,
  // 2026-09-15 船长确认的两个新货柜（贵重品 2 格 / 军用备货 4 格）：同样"带回后拆解"⇒ 无配方但登记在册
  'box-valuables',
  'box-military',
])
const matterDeviceIds = new Set<string>(WORMHOLE_MATTER_DEVICE_IDS)
const aicoreItemIds = new Set<string>(WORMHOLE_CORE_ITEM_IDS)

// 采集点
const beltIds = new Set<string>()
for (const b of BELTS) {
  if (beltIds.has(b.id)) errors.push(`采集点 id 重复：${b.id}`)
  beltIds.add(b.id)
  const item = items.get(b.oreId)
  check(!!item && MINEABLE_KINDS.has(item.kind), `采集点 ${b.id} 产物 ${b.oreId} 不存在或不可采集`)
  check(b.standingReq === undefined || (Number.isInteger(b.standingReq) && b.standingReq >= 0), `采集点 ${b.id} 声望门槛非法`)
}
check(BELTS.length === 17, `采集点应为 17 个，实际 ${BELTS.length}`)

// 精炼配方
for (const item of itemDefs) {
  const hasRefine = item.refine !== undefined && item.refine.length > 0
  if (hasRefine) {
    check(MINEABLE_KINDS.has(item.kind), `${item.id} 带了精炼配方但不是可采集资源（应无配方）`)
    for (const row of item.refine) {
      const target = items.get(row.mineralId)
      check(!!target && target.kind === 'mineral', `${item.id} 配方产物 ${row.mineralId} 不存在或不是矿物`)
      check(row.perOre > 0 && Number.isFinite(row.perOre), `${item.id} 配方系数非法：${row.perOre}`)
    }
  } else {
    check(
      item.kind === 'mineral' ||
        item.kind === 'ammo' ||
        item.kind === 'drone' ||
        item.kind === 'kit' ||
        /* **虫洞谜质（精华）与奢侈品**（船长 2026-09-15 确认的一批）：**纯贸易品**——只用来卖钱，
         * 不入精炼 / 拆解 / 制造链，故"没有配方"是**设计**（豁免）；来源分别是「撤离成功按台数换算」
         * 与「贵重品货柜拆解」（口径见 docs/glossary.md 八之二「战利品四件」）。 */
        item.kind === 'essence' ||
        item.kind === 'luxury' ||
        /* **货柜**（2026-09-14 虫洞上线后改判）：它不是可采集资源，而是"带回后**拆解**"的中间件
         * —— 上线后依然没有精炼配方，但有一条**真实用途**：拆解台（`industry.startUnboxRun`，
         * 90 秒/件、与精炼同一台机器）⇒ 这里改判"**必须是登记在册的货柜 id**"
         * （安全货柜 `box-relic-*` / 图纸货柜 `box-bp-*`；名单由 core 的常量给，不由本文件硬编码）。 */
        (item.kind === 'container' && containerIds.has(item.id)) ||
        /* **谜质储存器**（同批改判）：本趟虫洞内生效、离开即消失的装置，既不是原料也不进任何生产链
         * ⇒ 上线后依然没有精炼配方；改判"**必须在谜质装置表里**"（core `WORMHOLE_MATTER_DEVICE_IDS`，
         * 表里每台都带自己的生效口径）。 */
        (item.kind === 'matter' && matterDeviceIds.has(item.id)) ||
        /* **AI 核心（洞内实物形态）**（同批改判）：撤离成功即**直接入核心账本**（`state.aiCores`，
         * 不进仓库、不上拆解台、不进生产链）⇒ 上线后依然没有精炼配方；
         * 改判"**必须有一张指向它的核心市场卡**"（kind `aicore`，也就是核心账本的入口）。 */
        (item.kind === 'aicore' && aicoreItemIds.has(item.id)),
      `${item.id}（${item.kind}）没有精炼配方——可采集资源必须带配方（kit 为无配方消耗品豁免；` +
        `container 须是登记货柜、matter 须在谜质装置表、aicore 须有核心市场卡）`,
    )
  }
}

// 装备
const moduleIds = new Set<string>()
for (const m of MODULES) {
  if (moduleIds.has(m.id)) errors.push(`装备 id 重复：${m.id}`)
  moduleIds.add(m.id)
  check([...MODULE_SLOTS].includes(m.slot), `装备 ${m.id} 家族非法：${m.slot}`)
}
for (const g of MARKET_GOODS) {
  if (g.kind === 'module' && !moduleIds.has(g.refId)) errors.push(`市场卡 ${g.key} 装备缺失`)
}
check(MODULES.length >= 24, `装备应 ≥24 件，实际 ${MODULES.length}`)
console.log(`· 装备：${MODULES.length} 件`)

// 蓝图
const bpIds = new Set<string>()
/** 逆向研究产出的蓝图 id 集合（一次性图纸不得出现在这里，见下方契约） */
const FRAGMENT_RECIPES_IDS = new Set(Object.values(FRAGMENT_RECIPES).map((r) => r.blueprintId))
const moduleIdSet = new Set(MODULES.map((m) => m.id))
for (const bp of BLUEPRINTS) {
  if (bpIds.has(bp.id)) errors.push(`蓝图 id 重复：${bp.id}`)
  bpIds.add(bp.id)
  // 产物：moduleId（装备）或 itemId+outputUnits（消耗品/弹药，2026-09-05 弹药/修理组件同构）
  if (bp.moduleId !== undefined) {
    check(moduleIdSet.has(bp.moduleId), `蓝图 ${bp.id} → 装备 ${bp.moduleId} 不存在`)
  } else if (bp.itemId !== undefined) {
    const out = items.get(bp.itemId)
    check(!!out, `蓝图 ${bp.id} → 产物物品 ${bp.itemId} 不存在`)
    check(bp.outputUnits !== undefined && Number.isInteger(bp.outputUnits) && bp.outputUnits > 0, `蓝图 ${bp.id} 产物数量非法`)
  } else {
    errors.push(`蓝图 ${bp.id} 缺少 moduleId/itemId 产物声明`)
  }
  for (const need of bp.materials) {
    const mat = items.get(need.itemId)
    check(!!mat && mat.kind === 'mineral', `蓝图 ${bp.id} 材料 ${need.itemId} 不存在或不是矿物`)
    check(need.count > 0 && Number.isInteger(need.count), `蓝图 ${bp.id} 材料数量非法`)
  }
  // **一次性图纸豁免**（2026-09-12 船长：「玩家无法学会，只能制造一次的图纸」）：
  // 它**不上市场**（不能买入/不能学），来源由后续裁定指定（掉落/奖励），故不要求市场卡。
  check(
    bp.singleUse === true || MARKET_GOODS.some((g) => g.kind === 'blueprint' && g.refId === bp.id),
    `装备蓝图 ${bp.id} 没有市场卡（无法购书学习）`,
  )
  // 一次性图纸**不得进逆向研究**（否则碎片能刷出永久配方；船长同日裁定「6 不进」）
  check(
    bp.singleUse !== true || !FRAGMENT_RECIPES_IDS.has(bp.id),
    `一次性图纸 ${bp.id} 不得出现在碎片逆向配方表（会被逆向成永久配方）`,
  )
}
const shipIdSet = new Set(SHIPS.map((s) => s.id))
for (const sbp of SHIP_BLUEPRINTS) {
  if (bpIds.has(sbp.id)) errors.push(`蓝图 id 与其它蓝图重复：${sbp.id}`)
  bpIds.add(sbp.id)
  check(shipIdSet.has(sbp.shipId), `舰船蓝图 ${sbp.id} → 舰船 ${sbp.shipId} 不存在`)
  for (const need of sbp.materials) {
    const mat = items.get(need.itemId)
    check(!!mat && mat.kind === 'mineral', `舰船蓝图 ${sbp.id} 材料 ${need.itemId} 不存在或不是矿物`)
  }
  check(
    sbp.singleUse === true || MARKET_GOODS.some((g) => g.kind === 'blueprint' && g.refId === sbp.id),
    `舰船蓝图 ${sbp.id} 没有市场卡（无法购书学习）`,
  )
}

/* ── 蓝图说明契约（2026-09-11 加，船长：「部分图纸的说明和实际产物属性对对不上，进行核查」）──
 * 背景：蓝图说明是玩家**买书时唯一能看到的产物介绍**；历史上多次调数值（炮台射程 −30%、
 * 舰船货舱调整…）之后说明没跟着改 → 玩家按说明买的图纸与实物不符（本次核出 2 处：
 * 「重型炮台 MK2」说明仍写 8.2 km 实际 5.74 km；「鲸王级舰船蓝图」说明仍写 10,000 m³ 实际 7,000 m³）。
 * 此处把**能从数据机械核对**的声明全部钉住；蓝图名与产物名的差异（「X 级舰船蓝图」vs「X 级护卫舰」）
 * 属命名习惯，只提示不拦。 */
{
  const modById = new Map(MODULES.map((m) => [m.id, m]))
  const shipById = new Map(SHIPS.map((s) => [s.id, s]))
  const goodsByBp = new Map(MARKET_GOODS.filter((g) => g.kind === 'blueprint').map((g) => [g.refId!, g]))
  const mineralNameOf = (id: string): string => items.get(id)?.name ?? id
  let claims = 0
  let nameHints = 0
  const num = (s: string): number => Number(s.replace(/,/g, ''))
  for (const bp of [...BLUEPRINTS, ...SHIP_BLUEPRINTS]) {
    const d = bp.description
    const out = bp.outputUnits ?? 1
    const mod = bp.moduleId ? modById.get(bp.moduleId) : undefined
    const item = bp.itemId ? items.get(bp.itemId) : undefined
    const ship = (bp as { shipId?: string }).shipId ? shipById.get((bp as { shipId?: string }).shipId!) : undefined
    const product = mod ?? item ?? ship
    if (!product) continue // 产物缺失已由上面的用例拦下
    const pName = product.name
    // ① 引号内的产物名
    for (const m of d.matchAll(/「([^」]+)」/g)) {
      claims += 1
      check(m[1] === pName, `蓝图说明契约：${bp.id} 说明写「${m[1]}」，实际产物名「${pName}」`)
    }
    // ② 每批产出（N 发/个/枚 … 批）
    for (const m of d.matchAll(/(\d+)\s*[发个枚]/g)) {
      if (!/批/.test(d.slice(m.index ?? 0, (m.index ?? 0) + 12))) continue
      claims += 1
      check(Number(m[1]) === out, `蓝图说明契约：${bp.id} 说明写每批 ${m[1]}，实际 outputUnits = ${out}`)
    }
    // ③ 射程（远程/射程 N km）
    for (const m of d.matchAll(/(?:远程|射程)[^0-9]{0,6}([\d.]+)\s*km/gi)) {
      if (mod?.maxRangeM === undefined) continue
      claims += 1
      check(
        Math.abs(Number(m[1]) - mod.maxRangeM / 1000) < 0.05,
        `蓝图说明契约：${bp.id} 说明写射程 ${m[1]} km，实际 maxRangeM = ${mod.maxRangeM} m`,
      )
    }
    // ④ 修理组件基础回复
    for (const m of d.matchAll(/基础\s*(\d+)\s*HP/gi)) {
      if (item?.repairRestore === undefined) continue
      claims += 1
      check(Number(m[1]) === item.repairRestore, `蓝图说明契约：${bp.id} 说明写基础 ${m[1]} HP，实际 repairRestore = ${item.repairRestore}`)
    }
    // ⑤ 弹药克制声明
    if (item?.damageType) {
      for (const [layer, word] of [['shield', '护盾'], ['armor', '装甲']] as const) {
        for (const m of d.matchAll(new RegExp(`对${word}\\s*×\\s*([\\d.]+)`, 'g'))) {
          claims += 1
          const real = typeLayerMult(item.damageType, layer)
          check(
            Math.abs(Number(m[1]) - real) < 0.01,
            `蓝图说明契约：${bp.id} 说明写对${word} ×${m[1]}，实际 ${item.damageType} 对${word} ×${real}`,
          )
        }
      }
    }
    // ⑥ 声望门槛
    for (const m of d.matchAll(/声望\s*(\d+)/g)) {
      const g = goodsByBp.get(bp.id)
      claims += 1
      check(
        g?.standingReq !== undefined && Number(m[1]) === g.standingReq,
        `蓝图说明契约：${bp.id} 说明写需声望 ${m[1]}，实际市场 standingReq = ${g?.standingReq ?? "（无市场卡）"}`,
      )
    }
    // ⑦ 舰船：货舱 / 循环秒 / 每循环产量
    if (ship) {
      for (const m of d.matchAll(/货舱\s*([\d,]+)\s*m³/g)) {
        claims += 1
        check(num(m[1]!) === ship.cargoM3, `蓝图说明契约：${bp.id} 说明写货舱 ${m[1]} m³，实际 cargoM3 = ${ship.cargoM3}`)
      }
      for (const m of d.matchAll(/循环\s*([\d.]+)\s*秒|([\d.]+)\s*秒\s*循环/g)) {
        claims += 1
        check(
          Math.abs(Number(m[1] ?? m[2]) - ship.cycleSeconds) < 0.01,
          `蓝图说明契约：${bp.id} 说明写循环 ${m[1] ?? m[2]} 秒，实际 cycleSeconds = ${ship.cycleSeconds}`,
        )
      }
      for (const m of d.matchAll(/产\s*([\d,]+)\s*单位/g)) {
        claims += 1
        check(
          num(m[1]!) === ship.oreUnitsPerCycle,
          `蓝图说明契约：${bp.id} 说明写产 ${m[1]} 单位，实际 oreUnitsPerCycle = ${ship.oreUnitsPerCycle}`,
        )
      }
    }
    // ⑧ 说明点名的矿物必须在材料里（矿石放宽：其精炼产物落在材料里即可，如「赤环岩矿带」→ 重钨合金）
    const mats = new Set(bp.materials.map((x) => x.itemId))
    const oreFeeds = (oreId: string): boolean => (items.get(oreId)?.refine ?? []).some((r) => mats.has(r.mineralId))
    for (const def of items.values()) {
      if (def.kind !== 'mineral' && def.kind !== 'ore') continue
      if (!def.name || def.name.length < 2 || !d.includes(def.name)) continue
      if (mats.has(def.id)) continue
      if (def.kind === 'ore' && oreFeeds(def.id)) continue
      claims += 1
      check(
        false,
        `蓝图说明契约：${bp.id} 说明点名了「${def.name}」，实际材料只有 ${[...mats].map(mineralNameOf).join(" + ")}`,
      )
    }
    // ⑨ CPU 声明（2026-09-11 起：装备 cpuUse 允许为 0 —— 此时声明指的是**扩容量** cpuBonus，
    //    如协处理器说明「装配 CPU 上限 +10」；扩容件的蓝图说明同样按 cpuBonus 核对）
    for (const m of d.matchAll(/CPU\s*(\d+)|(\d+)\s*点\s*CPU/g)) {
      const real = mod ? (mod.cpuUse && mod.cpuUse > 0 ? mod.cpuUse : mod.cpuBonus) : ship?.cpu
      if (real === undefined) continue
      claims += 1
      check(Number(m[1] ?? m[2]) === real, `蓝图说明契约：${bp.id} 说明写 CPU ${m[1] ?? m[2]}，实际 = ${real}`)
    }
    // ⑩ 蓝图名 vs 产物名：命名习惯差异只提示
    const base = bp.name.replace(/图纸$|蓝图$/, '').trim()
    if (!pName.includes(base.replace(/[（(].*?[)）]/g, '').trim())) nameHints += 1
  }
  console.log(`· 蓝图说明契约：核对 ${claims} 条数值声明（${BLUEPRINTS.length + SHIP_BLUEPRINTS.length} 张蓝图）；蓝图名与产物名不同写法 ${nameHints} 张（命名习惯，不拦）`)
}

/* ── 产物说明契约（2026-09-11 加，船长：「是，扩到全部产物说明」）──
 * 上一契约钉住的是**蓝图说明**；本契约覆盖**装备与物品自身的说明**——市场卡悬浮面板
 * （`MarketPage` 的 note 位）与物品/装备悬浮层读的就是这些 `description`，玩家据此判断要不要买。
 * 做法：把说明里的每个数值声明抽出来，要求它**能被该产物的真实数值解释**：
 *   ① 直接命中某字段（含 分数→百分数、毫秒→秒、米→千米 三种换算）；
 *   ② 引擎口径换算命中——装填 −N% 的「约合射速 +M%」= 1/(1−N)−1；抗性示例「25% 基础船 → M%」
 *      = N + 25%×(1−N)（`gapCombine` 缺口复合）；推进器「命中 ×M」= 1−失稳罚；姿态陀螺
 *      「敌命中 60% → M%」= 60%×(1−缺口削减)；无人机射程示例 = 机型基础射程 ×(1+加成)；
 *   ③ 语境常量（点火周期 60 秒、抗性上限 90%、必中 100%、弹种克制倍率、维修脉冲 5 秒…）；
 *   ④ 与说明里点到名的另一件装备做差（「比 X 还高五个点」「省下 12 点 CPU」）。
 * 另外单独钉住「无人机舱 +N m³ → 可多带几架」这类换算式：说明里的 N 架必须等于
 * 地板(舱位 ÷ 该机型体积)——这条是 2026-09-11 抓到「+15 m³ 却写约多带 2-5 架中型」的地方。
 * 解释不了的声明一律报错：既防"改了数值忘改说明"，也防"新写说明抄错数"。 */
{
  const numVal = (s: string): number => Number(s.replace(/,/g, ''))
  type Claim = { raw: string; value: number; kind: string }
  const claimsOf = (d: string): Claim[] => {
    const out: Claim[] = []
    for (const m of d.matchAll(/[+＋−-]?\s*([\d.]+)\s*%/g)) out.push({ raw: m[0].trim(), value: numVal(m[1]!), kind: 'pct' })
    for (const m of d.matchAll(/×\s*([\d.]+)/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'mul' })
    for (const m of d.matchAll(/([\d.]+)\s*km/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'km' })
    for (const m of d.matchAll(/([\d.]+)\s*m³/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'm3' })
    for (const m of d.matchAll(/([\d.]+)\s*m(?![³a-zA-Z])/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'm' })
    for (const m of d.matchAll(/([\d.]+)\s*秒/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'sec' })
    for (const m of d.matchAll(/([\d.]+)\s*点/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'pt' })
    for (const m of d.matchAll(/(?:CPU|处理器)[^0-9]{0,6}([\d.]+)/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'cpu' })
    for (const m of d.matchAll(/([\d.]+)\s*(?:点\s*)?CPU/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'cpu' })
    return out
  }
  const flatNums = (o: unknown, prefix = '', out: Array<[string, number]> = []): Array<[string, number]> => {
    if (o === null || o === undefined) return out
    if (typeof o === 'number') {
      out.push([prefix, o])
      return out
    }
    if (typeof o === 'string' || typeof o === 'boolean') return out
    if (Array.isArray(o)) {
      o.forEach((v, i) => flatNums(v, `${prefix}[${i}]`, out))
      return out
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (['description', 'name', 'id', 'flavor'].includes(k)) continue
      flatNums(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return out
  }
  const droneVolumes = drones.map((d) => d.unitM3).filter((v): v is number => typeof v === 'number')
  const droneRanges = drones.map((d) => d.maxRangeM).filter((v): v is number => typeof v === 'number')
  // 语境常量（引擎现行口径；改了这里就等于承认说明可以滞后，故集中在此处便于复核）
  const ctxConst: Array<[string, number]> = [
    ['点火周期 60 秒', 60],
    ['抗性上限', 90],
    ['必中', 100],
    ['示例基础抗/基础船', 25],
    ['维修脉冲', REPAIR_PULSE_MS / 1000],
    ['护盾充能脉冲', SHIELD_PULSE_MS / 1000],
    ['动能对护盾', typeLayerMult('kinetic', 'shield')],
    ['动能对装甲', typeLayerMult('kinetic', 'armor')],
    ['爆破对装甲', typeLayerMult('explosive', 'armor')],
    ['爆破对护盾', typeLayerMult('explosive', 'shield')],
    ['能量对护盾', typeLayerMult('plasma', 'shield')],
    ['能量对装甲', typeLayerMult('plasma', 'armor')],
  ]
  let total = 0
  let unexplained = 0
  let countHints = 0
  const scan = (kindLabel: string, def: { id: string; name: string; description?: string }): void => {
    const d = def.description ?? ''
    if (!d) return
    const claims = claimsOf(d)
    if (claims.length === 0) return
    const self = flatNums(def)
    // ④ 说明里点到名的另一件装备：其数值与差值也算"可解释"
    const refs = MODULES.filter((o) => o.id !== def.id && d.includes(o.name))
    const cross = refs.flatMap((o) => flatNums(o).map(([, v]) => v))
    const crossDiff = refs.flatMap((o) => flatNums(o).flatMap(([, v]) => self.map(([, sv]) => Math.abs(v - sv))))
    for (const c of claims) {
      total += 1
      const cand = new Set<number>()
      for (const [, v] of self) {
        cand.add(v)
        cand.add(v * 100)
        cand.add(Math.round(v * 100))
        cand.add(v / 1000) // 毫秒→秒 / 米→千米
        cand.add(1 - v) // 命中 ×(1−罚)
        cand.add(60 * (1 - v)) // 姿态陀螺：敌命中 60% → M%
        cand.add(v + 0.25 * (1 - v)) // 抗性示例：25% 基础船 → M%（取整后比对）
        cand.add((v + 0.25 * (1 - v)) * 100)
        cand.add((1 / (1 - v) - 1) * 100) // 装填 −N% 的「约合射速 +M%」
        for (const dv of droneRanges) cand.add(dv * (1 + v)) // 无人机射程示例
      }
      for (const v of cross) {
        cand.add(v)
        cand.add(v * 100)
        cand.add(Math.round(v * 100))
      }
      for (const v of crossDiff) {
        cand.add(v)
        cand.add(v * 100)
      }
      for (const [, v] of ctxConst) {
        cand.add(v)
        cand.add(v * 100)
      }
      const hit = [...cand].some((x) => Math.abs(x - c.value) < 0.051 || Math.abs(Math.round(x) - c.value) < 0.51)
      if (!hit) {
        unexplained += 1
        check(false, `产物说明契约：${kindLabel} ${def.id} 说明里的「${c.raw}」无法由真实数值解释——说明与实际属性对不上，或说明写了凭空的数`)
      }
    }
    // 「无人机舱 +N m³ → 可多带 N 架」换算式：N 必须等于**某个机型**的地板(舱位 ÷ 该机型体积)
    for (const m of d.matchAll(/([\d.]+)(?:\s*[-–~]\s*([\d.]+))?\s*架/g)) {
      const lo = numVal(m[1]!)
      const hi = m[2] ? numVal(m[2]) : lo
      if (!/无人机舱|机库/.test(d)) continue
      countHints += 1
      const bay = self.find(([k]) => k.includes('droneBay'))?.[1] ?? 0
      const caps = drones.map((x) => Math.floor(bay / (x.unitM3 ?? 1)))
      const okCount = caps.includes(lo) && caps.includes(hi)
      check(
        okCount,
        `产物说明契约：${kindLabel} ${def.id} 说明写「${m[0]}」，但按无人机舱位换算不成立（实际可多带 ${drones.map((x, i) => `${x.name} ${caps[i]} 架`).join(" / ")}）`,
      )
    }
    // ⑤ 说明点名的弹种/组件必须与实际接线一致（文字与字段"对不上"的另一半：不是数字错、是名字错）
    const mod = def as { repairKit?: string; damageTypeBonusPct?: Record<string, number> } & Record<string, unknown>
    if (mod.repairKit) {
      const kitName = items.get(mod.repairKit)?.name ?? mod.repairKit
      check(d.includes(kitName), `产物说明契约：装备 ${def.id} 说明没点到实际消耗的修理组件「${kitName}」（接线 ${mod.repairKit}）`)
    }
    const typeWords: Array<[string, DamageType]> = [
      ['动能', 'kinetic'],
      ['高爆', 'explosive'],
      ['爆炸', 'explosive'],
      ['爆破', 'explosive'],
      ['等离子', 'plasma'],
      ['能量', 'plasma'],
    ]
    const mapFields = ['damageTypeBonusPct', 'shieldResistAdd', 'armorResistAdd', 'hullResistAdd'] as const
    for (const f of mapFields) {
      const keys = Object.keys((mod[f] as Record<string, number> | undefined) ?? {})
      if (keys.length !== 1) continue
      // 只看**首句**（抗性/伤害声明的正位）：后文常顺带提其它弹种（如「动能是协会最常用弹种」），
      // 全句扫描会把正误两种写法都算成"提了两系"从而漏判。
      const headline = d.split('。')[0] ?? d
      const mentioned = new Set(typeWords.filter(([w]) => headline.includes(w)).map(([, t]) => t))
      if (mentioned.size === 1) {
        const wordOf: Record<string, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }
        check(
          mentioned.has(keys[0] as DamageType),
          `产物说明契约：装备 ${def.id} 说明写的是「${wordOf[[...mentioned][0]!] ?? [...mentioned][0]}」系，实际字段 ${f} 挂在「${wordOf[keys[0]!] ?? keys[0]}」上`,
        )
      }
    }
  }
  for (const m of MODULES) scan('装备', m)
  for (const i of ITEMS) scan('物品', i)
  console.log(`· 产物说明契约：核对 ${total} 条数值声明（装备 ${MODULES.length} 件 + 物品 ${ITEMS.length} 种），其中舱位换算 ${countHints} 处；无法解释 ${unexplained} 条`)
}

/* ── 技能说明契约（2026-09-11 加，船长：「另开一批做技能说明 ↔ 引擎效果核查」）──
 * 背景：技能说明里每个数值都用 ⟦⟧ 标出（内容工作台口径：改 ⟦⟧ 需与引擎接线一致），
 * 但过去**没有任何自动检查**——改引擎数值忘改说明、或技能压根没接线，都只有玩家能发现。
 * 本契约把三处来源钉在一起（**引擎为准**）：
 *   ① **平衡表**：凡 `xxxSkillId/skillIds/familySkillIds` 与同层 `xxxPerLevel` 成对出现的地方，
 *      技能说明必须写出该每级值（含满级 = 每级 × 5）——如 mining.yieldPerLevel 0.06 ↔「每级 +6%」；
 *   ② **引擎导出的技能参数对象**：`DRONE_SKILL`（无人机六技能的每级值 + 回收基础/上限）；
 *   ③ **引擎内联常量表**（下方 `INLINE`）：数值写在各模块函数里（`1 - 0.04 * lv` 之类），
 *      逐条登记 `技能 id → 每级值 → 接线位置`；`wired: false` 表示**说明承诺了、但引擎里查无接线**
 *      （只警告不拦，与蓝图命名差异同口径）——2026-09-11 核查时唯一命中 = `cartography` 星图测绘学。
 * 另加**反向断言**：说明里带 ⟦⟧ 数值的技能必须能在上述三处之一登记，防新技能悄悄写一组没人负责的数。 */
{
  type Pair = { skill: string; per: number; from: string }
  const pairs: Pair[] = []
  const isSkillKey = (k: string): boolean => /skill/i.test(k)
  /** 键名去掉尾部 SkillId(s)/PerLevel 后的「语义前缀」，用于把技能名与每级值配到一起 */
  const prefixOf = (k: string): string => k.replace(/skill[a-z]*ids?$/i, '').replace(/perlevel$/i, '').toLowerCase()
  const related = (a: string, b: string): boolean =>
    a === b || a === '' || b === '' || a.startsWith(b) || b.startsWith(a)
  const collect = (o: unknown, path: string): void => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) {
      o.forEach((v, i) => collect(v, `${path}[${i}]`))
      return
    }
    const obj = o as Record<string, unknown>
    const ids: Array<{ id: string; prefix: string }> = []
    const pers: Array<{ per: number; prefix: string }> = []
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && isSkillKey(k)) ids.push({ id: v, prefix: prefixOf(k) })
      else if (typeof v === 'number' && /per\s*level/i.test(k)) pers.push({ per: v, prefix: prefixOf(k) })
      else if (Array.isArray(v) && isSkillKey(k)) {
        for (const x of v) if (typeof x === 'string') ids.push({ id: x, prefix: prefixOf(k) })
      } else if (v && typeof v === 'object' && isSkillKey(k)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          // industrySkillSlots: { '技能 id': 每级工位数 }——记录本身就是"技能 → 每级值"的成对表
          if (typeof v2 === 'number') pairs.push({ skill: k2, per: v2, from: `${path}.${k}` })
          // familySkillIds: { 武器族: '技能 id' }——与同层 familySkillPerLevel 配对
          else if (typeof v2 === 'string' && !isSkillKey(k2)) ids.push({ id: v2, prefix: prefixOf(k) })
        }
      }
    }
    for (const i of ids)
      for (const p of pers)
        if (related(i.prefix, p.prefix))
          pairs.push({
            skill: i.id,
            per: p.per,
            from: `${path}（${i.prefix || "技能"} ↔ ${p.prefix}）`,
          })
    for (const [k, v] of Object.entries(obj))
      if (v && typeof v === 'object') collect(v, path ? `${path}.${k}` : k)
  }
  collect(DEFAULT_BALANCE, 'balance');
  // ② 引擎导出的无人机技能参数
  pairs.push(
    { skill: 'drone-warfare', per: DRONE_SKILL.warfarePerLevel, from: 'combat.DRONE_SKILL.warfarePerLevel' },
    { skill: 'drone-strike', per: DRONE_SKILL.strikePerLevel, from: 'combat.DRONE_SKILL.strikePerLevel' },
    { skill: 'drone-durability', per: DRONE_SKILL.durabilityPerLevel, from: 'combat.DRONE_SKILL.durabilityPerLevel' },
    { skill: 'drone-reinforce', per: DRONE_SKILL.reinforcePerLevel, from: 'combat.DRONE_SKILL.reinforcePerLevel' },
    { skill: 'drone-evasion', per: DRONE_SKILL.evasionPerLevel, from: 'combat.DRONE_SKILL.evasionPerLevel' },
    { skill: 'drone-recovery', per: DRONE_SKILL.recoveryPerLevel, from: 'combat.DRONE_SKILL.recoveryPerLevel' },
  )
  // ③ 引擎内联常量（2026-09-11 逐条按现场代码登记；wired:false = 说明承诺但引擎无接线）
  const INLINE: Array<{ skill: string; per: number | null; call: string | null; note?: string }> = [
    { skill: 'spaceship-command', per: 0.02, call: 'travel.ts travelTimeFactor' },
    { skill: 'mining-frigate', per: 0.03, call: 'balance.mining.timePerLevel' },
    { skill: 'industrial-ops', per: 0.04, call: 'mining.ts（industrial 族产量）' },
    { skill: 'armed-ops', per: 0.03, call: 'combat.ts（**武装舰**类别单发；判据 = shipCategoryKeyOf）' },
    { skill: 'armored-ops', per: 0.04, call: 'combat.ts（**装甲舰**类别甲/结构容量；判据 = shipCategoryKeyOf）' },
    { skill: 'astro-geology', per: 0.04, call: 'mining.ts（全矿产量）' },
    { skill: 'deep-hole-blasting', per: 0.06, call: 'mining.ts（低品位矿 ≤55 ISK）' },
    { skill: 'deep-space-harvesting', per: 0.05, call: 'mining.ts（气/冰）' },
    { skill: 'rich-vein-prospecting', per: 0.2, call: 'mining.ts richVeinFactor' },
    { skill: 'core-smelting', per: 0.04, call: 'industry.ts（主控手动炉周期）' },
    { skill: 'furnace-expansion', per: 0.06, call: 'industry.ts（主控手动炉批容）' },
    { skill: 'batch-production', per: 0.03, call: 'manufacturing.ts calcBuildDurationMs' },
    { skill: 'materials', per: 0.015, call: 'manufacturing.ts materialFactor' },
    { skill: 'industrial-automation', per: 0.05, call: 'industry.ts / manufacturing.ts（炉线与制造线周期）' },
    { skill: 'ai-expert', per: 1, call: 'ai.ts aiCoreCap（每级 +1 枚核心上限）' },
    { skill: 'navigation', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'warp-drive-operation', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'acceleration-control', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'component-standardization', per: 0.008, call: 'manufacturing.ts materialFactor' },
    { skill: 'ai-servicing', per: 0.03, call: 'ai.ts（副船采矿循环）' },
    { skill: 'offline-ops', per: 0.2, call: 'simulation.ts simulateOffline（基础 8 小时）' },
    { skill: 'station-engineering', per: 0.08, call: 'station.ts engFactor' },
    { skill: 'salvage-recycling', per: 0.04, call: 'industry.ts（回收炉周期）' },
    { skill: 'salvage-rigging', per: 0.03, call: 'salvaging.ts（打捞器周期）' },
    { skill: 'wreck-assaying', per: 0.2, call: 'salvaging.ts assayChanceOf（×1.2/级）' },
    { skill: 'salvage-refining', per: 0.08, call: 'salvage.ts（保底矿物）' },
    { skill: 'energy-management', per: 0.03, call: 'combat.ts（激光单发）' },
    { skill: 'gunnery', per: 0.05, call: 'balance.battle.gunneryDmgPerLevel（跨节点配对）' },
    { skill: 'fire-control', per: 0.03, call: 'combat.ts（炮台/导弹命中）' },
    { skill: 'reload-drills', per: 0.04, call: 'combat.ts（装填）' },
    { skill: 'ammunition-condensing', per: 0.08, call: 'combat.ts（出发预载弹药）' },
    { skill: 'drone-servicing', per: 0.04, call: 'combat.ts（无人机装填）' },
    { skill: 'shield-operation', per: 0.04, call: 'combat.ts（护盾容量）' },
    { skill: 'hull-upgrades', per: 0.04, call: 'combat.ts（甲/结构容量）' },
    { skill: 'shield-tuning', per: 0.02, call: 'combat.ts tune（护盾三系抗）' },
    { skill: 'armor-tuning', per: 0.02, call: 'combat.ts tune（装甲三系抗）' },
    { skill: 'repair-engineering', per: 0.1, call: 'shipyard.ts（停站维修费）' },
    { skill: 'repair-engineering', per: 0.05, call: 'core/repair.ts quickRepairFactor（修理组件恢复量，2026-09-13 新增；rank 2→3）' },
    { skill: 'station-protocol', per: 0.05, call: 'shipyard.ts（停站维修费）' },
    { skill: 'hull-quick-repair', per: 0.05, call: 'core/repair.ts quickRepairFactor（修理组件恢复量：直接使用 + 船体维修装置每跳，2026-09-13 由 0.1 削弱）' },
    { skill: 'ai-core-dispatch', per: 0.02, call: 'balance.aiCore.dispatchPerLevel（百分点）' },
    { skill: 'accelerated-learning', per: 0.04, call: 'training.ts trainingTimeFactor' },
    { skill: 'marketing', per: 0.012, call: 'market.ts marketSellSkillMult' },
    { skill: 'source-sweeping', per: 0.1, call: 'market.ts SWEEP_PER_LEVEL（×1.1/级）', srcNear: false },
    { skill: 'secondhand-market', per: 0.02, call: 'market.ts SECONDHAND_PER_LEVEL', srcNear: false },
    { skill: 'galactic-happenings', per: 0.08, call: 'events.ts eventCadenceFactor（事件间隔 −8%/级）+ expedition.ts（×1.15/级）' },
    { skill: 'galactic-happenings', per: 0.2, call: 'wormholeScan.ts happeningsScanFactor（虫洞扫描窗口 · **满级阶跃 −20%**，2026-09-14 船长追加的第四项）' },
    { skill: 'chart-archive', per: 10, call: 'wormholeScan.ts wormholeStockMaxOf（虫洞保存上限 · **满级总量 +10 格**，2026-09-16 船长改判后满级值不变）' },
    { skill: 'chart-archive', per: 2, call: 'wormholeScan.ts WORMHOLE_STOCK_BONUS_PER_LEVEL（虫洞保存上限 · **每级 +2**，2026-09-16 船长「应该为每级+2，满级+10」）' },
    { skill: 'event-dividend', per: 0.15, call: 'events.ts（事件现金）' },
    { skill: 'event-dividend', per: 0.04, call: 'wormhole.ts blankShareFactorOf（洞内空白地点占比的相对系数 · 2026-09-14 船长「事件玄学」新增项）' },
    { skill: 'signal-analysis', per: 0.08, call: 'explore.ts scanSkillFactor' },
    { skill: 'signal-filtering', per: 0.06, call: 'explore.ts scanSkillFactor' },
    { skill: 'salvage-diving', per: 0.12, call: 'expedition.ts lootFactor + salvaging.ts' },
    { skill: 'seizure-appraisal', per: 0.1, call: 'encounters.ts（缴获）' },
    { skill: 'lowsec-survival', per: 0.12, call: 'encounters.ts（被抢上限）' },
    { skill: 'deep-space-logistics', per: 0.04, call: 'inventory.ts（货仓容量）' },
    { skill: 'hauler-ops', per: 0.05, call: 'inventory.ts（hauler 族货仓）' },
    { skill: 'compression', per: 0.06, call: 'inventory.ts（矿/气/冰体积）' },
    { skill: 'hold-management', per: 0.03, call: 'inventory.ts（货仓容量）' },
    { skill: 'bounty-hunting', per: 0.08, call: 'expedition.ts bountyRewardFactor' },
    { skill: 'cartography', per: 0.06, call: 'explore.ts scanSkillFactor（2026-09-11 船长裁决「乙」接活到就地扫描窗口）' },
  ]
  const skillById = new Map(SKILLS.map((s) => [s.id, s]))
  const claimsOfSkill = (d: string): number[] => [...d.matchAll(/⟦([\d.]+)/g)].map((m) => Number(m[1]))
  let checked = 0
  let srcChecked = 0
  const unwired: string[] = []
  const registered = new Set<string>()
  /** 内联常量的**现场复核**：登记表里的每级值必须仍出现在该技能的读取点附近
   * （说明↔表 只能防"改说明忘改数"，这一步才防"改引擎数忘改说明"）。
   * `srcNear: false` 的条目 = 数值写在文件级常量里（读取点附近看不到），只做表 ↔ 说明 核对。 */
  const root = process.cwd()
  const srcCache = new Map<string, string>()
  const sourceOf = (call: string): string | null => {
    const m = call.match(/([a-z0-9-]+\.tsx?)/i)
    return m ? `packages/core/src/${m[1]}` : null
  }
  const nearCheck = (item: { skill: string; per: number | null; call: string | null; srcNear?: boolean }): void => {
    if (item.per === null || !item.call || item.srcNear === false) return
    const rel = sourceOf(item.call)
    if (!rel) return
    let text = srcCache.get(rel)
    if (text === undefined) {
      try {
        text = readFileSync(join(root, rel), 'utf8')
      } catch {
        return
      }
      srcCache.set(rel, text)
    }
    const needle = `'${item.skill}'`
    if (!text.includes(needle)) return // 该技能不是在本文件用 id 字面量读取的（如经 balance 表间接引用）——跳过现场复核
    srcChecked += 1
    let seen = 0
    let at = text.indexOf(needle)
    while (at >= 0) {
      seen += 1
      const win = text.slice(Math.max(0, at - 400), at + 400)
      // 线性 +N%/级 与乘算式 ×(1+N)/级 两种写法都认
      if (win.includes(String(item.per)) || win.includes(String(Number((1 + item.per).toFixed(4))))) return
      at = text.indexOf(needle, at + 1)
    }
    check(
      seen === 0,
      `技能说明契约：${item.skill} 的每级值 ${item.per} 在 ${rel} 的读取点附近已找不到——引擎改了数值（请同步技能说明，并按新值更新本契约登记表）`,
    )
  }
  const verify = (p: Pair): void => {
    const def = skillById.get(p.skill)
    if (!def) {
      check(false, `技能说明契约：${p.from} 指向的技能 ${p.skill} 不在技能目录中`)
      return
    }
    registered.add(p.skill)
    const claims = claimsOfSkill(def.description)
    if (claims.length === 0) return
    checked += 1
    // 每级值本身，或它的 1~5 倍（满级/阶段值），或"乘算式"×1.1/×1.2 系的 1+每级值
    const allowed = new Set<number>()
    for (const lv of [1, 2, 3, 4, 5]) {
      allowed.add(Number((p.per * 100 * lv).toFixed(4)))
      allowed.add(Number((p.per * lv).toFixed(4)))
      allowed.add(Number((1 + p.per * lv).toFixed(4)))
    }
    const hit = claims.some((c) =>
      [...allowed].some((a) => Math.abs(a - c) < 0.051),
    )
    check(
      hit,
      `技能说明契约：技能「${def.name}」(${p.skill}) 说明写的是 ⟦${claims.join("% / ")}⟧，而 ${p.from} 是每级 ${p.per}——说明与引擎对不上`,
    )
  }
  for (const p of pairs) verify(p)
  for (const item of INLINE) {
    registered.add(item.skill)
    const def = skillById.get(item.skill)
    if (!def) {
      check(false, `技能说明契约：内联表里的 ${item.skill} 不在技能目录中`)
      continue
    }
    if (!item.call) {
      unwired.push(
        `${def.name}（${item.skill}）：${item.note ?? "说明承诺了效果，但引擎里查无接线"}`,
      )
      continue
    }
    if (item.per === null) continue
    verify({ skill: item.skill, per: item.per, from: `内联表 · ${item.call}` })
    nearCheck(item)
  }
  // 反向断言：说明里带 ⟦⟧ 的技能必须登记（防新技能悄悄写数）
  for (const s of SKILLS) {
    if (claimsOfSkill(s.description).length > 0 && !registered.has(s.id)) {
      check(false, `技能说明契约：技能「${s.name}」(${s.id}) 说明里有 ⟦数值⟧ 却没在契约里登记来源（引擎为准：补登记或删掉说明里的数）`)
    }
  }
  for (const u of unwired) warn.push(`技能说明契约：${u}`)
  console.log(
    `· 技能说明契约：${registered.size} 个技能登记来源（平衡表 ${pairs.length} 条 + 引擎参数对象 6 条 + 内联表 ${INLINE.length} 条），核对 ${checked} 个技能的每级值、其中 ${srcChecked} 条做了引擎现场复核；未接线 ${unwired.length} 个`,
  )
}

// ── 装备卡片说明契约（2026-09-14 船长报障「护盾充能装置，在装配时候的卡片上没有说明」）──
//
// 装配页换装卡的正文 = `moduleShortEffect(mod)`：它按 `slot` 分支拼串，**分支漏了某个槽位、或某个
// 新效果字段没接进分支 ⇒ 整张卡一个字都没有**（本轮实测：护盾充能装置 ×3 只有 `shieldPulsePct`、
// 打捞器 ×3 的 `salvager` 槽位连分支都没有 ⇒ 6 件全空）。
//
// ⚠ 放在体检而不是 core 用例：渲染层没有测试运行器（desktop 包不跑 vitest）；将来若把该函数
//   搬进 core（更正统），这条断言可原样迁进 core 用例。
for (const m of MODULES) {
  check(
    moduleShortEffect(m).trim().length > 0,
    `装备 ${m.id}（${m.name}）的**短效说明为空**——装配页卡片会一句话都没有（去 moduleShortEffect 补该 slot / 该字段的分支）`,
  )
}

/* ── 战斗宿主双口径契约（2026-09-14 船长报障「虫洞内的战斗，敌方舰船动画不对 / 战斗开始位置似乎不对」）──
 *
 * 根因 = **一类"洞内战读了远征口径"的漏接**：洞内战斗的宿主是 `state.wormhole.run.battle`
 * （**不占** `expedition.battle`、敌卡按层派生不落在 `expedition.anomalyId`）——凡是"只认远征"的读法
 * 在洞里都会静默取到 `null`/`undefined`，而界面照样渲染 ⇒ 只能靠船长肉眼发现。本轮一次抓到 5 处：
 *   ① `BattleScreen` 的 `foeAnomaly`（→ 族形兜底成 A 海盗、舰种体积回落 170/90，而它又喂 `layout()`
 *      的机位/米制跨度 ⇒ **动画与开局机位一起错**）② `BattleScreen` 死敌预登记（洞内退出再进战场，
 *      血量 0 的敌人复活）③ `BattleScreen` 星场基准船速 ④ `core.expedition.battleTacticDesire`
 *      （洞内点战术按钮 ⇒ 期望距离 0 ⇒ 整队贴脸）⑤ `ui/ShipStatusWin.sceneOfShipwin`（洞里不切交火场景）
 *      ＋ `panels/Announcements`（洞里鏖战时照样弹公告）。
 *
 * 契约（源码级扫描，与「装备卡片说明契约」同款跨层兜底）：
 * - `panels/BattleScreen.tsx` 的**非注释行**里：
 *   · **不许**出现 `expedition.anomalyId`（敌卡一律走已解析的 `foeAnomaly`）；
 *   · `expedition.battle` **只允许 1 处**，且那一行必须同时出现 `whView`（= 双口径解析那一行）。
 * - 另两处必须保留洞内分支（防日后被"简化"掉）：`ShipStatusWin.tsx` 含 `state.wormhole.run?.battle`、
 *   `Announcements.tsx` 含 `s.wormhole.run?.battle`。
 */
{
  // 本块自带工作目录（上方那个同名变量在别的块作用域里，这里取不到）
  const wsRoot = process.cwd()
  const readSrc = (rel: string): string => readFileSync(join(wsRoot, rel), 'utf8')
  const stripComments = (src: string): string[] =>
    src
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'))
      })
  const bsPath = 'apps/desktop/src/renderer/src/panels/BattleScreen.tsx'
  const bsLines = stripComments(readSrc(bsPath))
  const badAnomaly = bsLines.filter((l) => l.includes('expedition.anomalyId')).length
  check(
    badAnomaly === 0,
    `战斗宿主双口径契约：${bsPath} 里有 ${badAnomaly} 处直读 \`expedition.anomalyId\`——` +
      `洞内战取不到敌卡（族形/舰种体积/机位全错）。敌卡一律走已解析的 \`foeAnomaly\`（whView 优先）`,
  )
  const bsBattle = bsLines.filter((l) => l.includes('expedition.battle'))
  check(
    bsBattle.length === 1 && bsBattle[0]!.includes('whView'),
    `战斗宿主双口径契约：${bsPath} 里 \`expedition.battle\` 应恰好 1 处且带 \`whView\` 兜底（双口径解析），` +
      `实际 ${bsBattle.length} 处${bsBattle.length > 0 ? `：${bsBattle.map((l) => l.trim().slice(0, 60)).join(' / ')}` : ''}`,
  )
  for (const [rel, needle] of [
    ['apps/desktop/src/renderer/src/ui/ShipStatusWin.tsx', 'state.wormhole.run?.battle'],
    ['apps/desktop/src/renderer/src/panels/Announcements.tsx', 's.wormhole.run?.battle'],
  ] as const) {
    check(
      readSrc(rel).includes(needle),
      `战斗宿主双口径契约：${rel} 缺少洞内分支（应含 \`${needle}\`）——洞内战会被当成"没在打"`,
    )
  }
  console.log(
    `· 战斗宿主双口径契约：BattleScreen 非注释行 ${bsLines.length} 行 ⇒ \`expedition.anomalyId\` 0 处 · ` +
      `\`expedition.battle\` 1 处（带 whView 兜底）· 状态窗与公告均带洞内分支`,
  )

  /* ── 洞内威胁「显示口径」契约（船长 2026-09-15：「虫洞的面板威胁（显示给玩家看的）建议乘以2，
   *    玩家目前会因为 1 层的 50 威胁出现误判」）──
   * 洞内面板的威胁读数一律走 `wormholeDisplayThreat()`（显示 = 引擎威胁 × 2）。
   * 本契约挡两种回潮：① 面板又去**裸渲染**引擎威胁（玩家又会误判）；② 有人把显示倍率用歪到引擎侧。
   * 口径依据：引擎的 `threat` 是**血预算的输入**（`foeHpOfThreat(威胁) × 10`）——乘 2 就是难度翻倍。 */
  {
    const whPath = 'apps/desktop/src/renderer/src/panels/Wormhole.tsx'
    const whLines = stripComments(readSrc(whPath))
    const rawPatterns = ['{nodeThreat}', '${extractThreat}', '威胁 {wormholeLayerThreat(']
    const offenders = whLines.filter((l) => rawPatterns.some((p) => l.includes(p)))
    check(
      offenders.length === 0,
      `洞内威胁显示契约：${whPath} 里有 ${offenders.length} 处**裸渲染**引擎威胁` +
        `（${offenders.map((l) => l.trim().slice(0, 50)).join(' / ')}）——` +
        `面板威胁一律走 \`wormholeDisplayThreat(...)\`（×2 显示口径；引擎值不变）`,
    )
    check(
      whLines.some((l) => l.includes('wormholeDisplayThreat(')),
      `洞内威胁显示契约：${whPath} 没有任何 \`wormholeDisplayThreat(...)\` 调用——面板威胁读数丢了显示口径`,
    )
    console.log(
      `· 洞内威胁显示契约：面板三处读数（本层 / 撤离 / 下一层）均走 \`wormholeDisplayThreat\`（引擎威胁 ×${2}）· 裸渲染 0 处`,
    )
  }

  /* ── 市场「一级类型」契约（船长 2026-09-16：「**将货柜添加到市场的分类里，和货物同级**」
   *    ＋同日「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」）──
   * 挡三种回潮：① 下拉里丢了「货柜」这一项或改名；② 「货柜」没紧跟在「货物」之后（同级但顺序漂了）；
   * ③ 一级类型名被改回「物品」；④ 货柜键集合（`CONTAINER_KIND_KEYS`）被删——它是剔除判定的单点。
   * 口径依据：货柜（`container`）自本批起与「残骸」（2026-09-08 独立）、「消耗品」（2026-09-11 独立）同级；
   * 奢侈品（`luxury`）作为「货物」的**二级子分类**（不是一级类型）。 */
  {
    const mpPath = 'apps/desktop/src/renderer/src/pages/MarketPage.tsx'
    const mpSrc = stripComments(readSrc(mpPath)).join('\n')
    check(
      mpSrc.includes("container: '货柜'"),
      `市场类型契约：${mpPath} 里没有 \`container: '货柜'\`——货柜的一级类型名丢了或被改名`,
    )
    check(
      mpSrc.includes("'item', 'container'"),
      `市场类型契约：${mpPath} 的类型下拉里「货柜」没有紧跟「货物」（现应是 … 'all', 'item', 'container', 'consume' …）`,
    )
    check(
      !mpSrc.includes("item: '物品'"),
      `市场类型契约：${mpPath} 的一级类型名又变回「物品」了（船长 2026-09-16 定为「货物」）`,
    )
    const subPath = 'apps/desktop/src/renderer/src/ui/itemSubs.ts'
    const subSrc = stripComments(readSrc(subPath)).join('\n')
    check(
      subSrc.includes('CONTAINER_KIND_KEYS'),
      `市场类型契约：${subPath} 里没有 \`CONTAINER_KIND_KEYS\`——货柜的键集合单点丢了（剔除判定会失效）`,
    )
    check(
      subSrc.includes("{ key: 'luxury', label: '奢侈品' }"),
      `市场类型契约：${subPath} 的「货物」子分类里没有「奢侈品」一档（船长 2026-09-16 定）`,
    )
    check(
      subSrc.includes('export const CONTAINER_SUBS') && subSrc.includes('container: CONTAINER_SUBS'),
      `市场类型契约：${subPath} 的「货柜」没有挂上二级子分类（船长 2026-09-16 追答：「货柜要二级子分类」）`,
    )
    for (const label of ['遗迹安全货柜', '图纸货柜', '贵重品货柜', '军用备货柜']) {
      check(subSrc.includes(label), `市场类型契约：${subPath} 的货柜子分类里没有「${label}」一档`)
    }
    console.log(
      '· 市场类型契约：一级类型 = 全部 / 货物 / 货柜 / 消耗品 / 残骸 / 高·中·低槽装备 / 舰船 / 蓝图 / 核心 · ' +
        '「货柜」紧跟「货物」· 子分类 = 货物（原矿/原材料/气体/冰矿/奢侈品）· 货柜（遗迹安全/图纸/贵重品/军用）',
    )
  }
}

// 舰船
const roleSet = new Set(['industrial', 'armed', 'armored', 'hauler'])
/** 舰种子分类白名单（2026-09-13 船长定；与 `packages/core/src/types.ts` 的 `ShipSubClass` 同源） */
const SHIP_SUBCLASSES = [
  '电子舰',
  '炮舰', // 2026-09-17 船长：「掠袭炮艇改名掠袭炮舰」⇒ 子分类名由「炮艇」改为「炮舰」
  '重型突击巡洋舰',
  '截击舰',
  '指挥舰',
  '鱼雷舰',
  '无人机作战舰',
  '侦察舰',
  '后勤舰',
  // 2026-09-16 船长：「原先将非专属的三条乌龟船添加舰船的子分类：武装货舰」（陆龟/玳瑁/玄武三艘）
  '武装货舰',
] as const
/**
 * **非虫洞舰写子分类的登记表**（2026-09-13 船长：「**协会功能舰也可写子分类**」）。
 *
 * 背景：子分类原口径是「**只给 `sh-wh-*`**（虫洞族专属舰船）」——出处 = 2026-09-13 船长
 * 「虫洞族专属舰船按子分类重排并进界面」+ `packages/core/src/types.ts` 的 `ShipSubClass` 注释。
 * 同日新增鹦鹉螺级（协会 · 测绘处的侦察巡洋舰）时船长裁定放宽 ⇒ **取值仍限白名单**，
 * 但非虫洞舰要写子分类**必须在下面这张表里登记**（照 `ALIEN_BEAST_SHIP_IDS` 的既有写法，
 * 防"随手给现役舰贴标签"）。登记新舰时请连同出处一起写清。
 */
const SUBCLASS_NON_WH_SHIP_IDS = new Set([
  'sh-nautilus', // 鹦鹉螺级测绘巡洋舰（协会测绘处 · 侦察舰；2026-09-13 船长）
  // 2026-09-16 船长：「原先将非专属的三条乌龟船添加舰船的子分类：武装货舰」⇒ 甲壳装甲线三艘
  'sh-tortoise', // 陆龟级重装艇（T2）
  'sh-hawksbill', // 玳瑁级重装巡舰（T3）
  'sh-xuanwu', // 玄武级重装旗舰（T4）
  // 2026-09-17 船长：「给予大白鲨级炮舰舰船子分类炮舰」（官方掠食者线，T2 驱逐·奇货精装）
  'sh-whiteshark',
])
/**
 * **每档默认槽位总数**（船长 2026-09-14 原话：「默认的舰船，按级别分别是 7/9/11/14/18 个槽位。
 * 种族专属的会在这个基础上 +1 槽位」）。
 * 默认线 = 各档战斗舰现状（马鲛 7 / 灰鲭鲨 9 / 长尾鲨·电鳐 11 / 玄武·巨齿鲨 14 / 邓氏鱼 18）；
 * **专属舰 = 默认 + 1**（T1 8 / T2 10 / T3 12；专属目前只到 T3）。
 * ⚠ **只钉专属舰**：官方 23 艘里 19 艘不在线上（船长 2026-09-14 已收到核对表，待另裁）。
 */
const TIER_SLOT_BASE: Record<number, number> = { 1: 7, 2: 9, 3: 11, 4: 14, 5: 18 }
/**
 * **已经逐艘点名对齐基准线的官方船**（船长 2026-09-14 起分次点名；每点名一艘就往这里加一条并跑断言）。
 * 与专属舰不同：官方船**不是**「默认 +1」，而是**恰好等于该档默认**。
 * ⚠ 名单外的官方船现状不在契约内（还有 14 艘偏离，船长会逐艘点名）。
 */
const OFFICIAL_SLOT_ALIGNED = new Set(['sh-nautilus', 'sh-bullshark'])
/**
 * **非战斗舰血量目标总血**（2026-09-15 船长定；与 `packages/data/src/ships.ts` 头注同源）：
 * 同档**官方战斗舰**（role `armed`/`armored`，**不含**虫洞专属 `sh-wh-*`）总血**中位 × 0.8**。
 * 参考中位：T1 228 · T2 384 · T3 675 · T4 1273 · T5 2355 ⇒ 目标见下表。
 * ⚠ 官方战斗舰的血量若被调整，本表要跟着重算（`npm run ship:hp` 会打出当前中位与推荐值）。
 */
const CIVILIAN_HP_TARGET: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 182, 2: 307, 3: 540, 4: 1018, 5: 1884 }
const shipIds = new Set<string>()
const tierTotalAvg: Record<number, { industrial: number[]; others: number[] }> = {}
for (const s of SHIPS) {
  if (shipIds.has(s.id)) errors.push(`舰船 id 重复：${s.id}`)
  shipIds.add(s.id)
  check(roleSet.has(s.role), `舰船 ${s.id} role 非法：${s.role}`)
  check(s.cycleSeconds > 0 && s.oreUnitsPerCycle > 0 && s.cargoM3 > 0, `舰船 ${s.id} 数值非法`)
  // V10.5 战斗数值契约：三层血量必填且 >0
  check((s.shieldHp ?? 0) > 0 && (s.armorHp ?? 0) > 0 && (s.hullHp ?? 0) > 0, `舰船 ${s.id} 三层血量缺失或非正（V10.5 契约）`)
  /**
   * **非战斗舰血量契约**（2026-09-15 船长定：「提高所有非战斗舰船的血量，使其约等于同级官方战斗舰船血量的 0.8」）。
   * 判据与目标写死在下方常量里（改动必须两处同步 —— 这正是本契约要拦的"静默漂移"）：
   * 目标 = 同档**官方战斗舰**（role `armed`/`armored`，**不含**虫洞专属 `sh-wh-*`）总血**中位 × 0.8**。
   */
  if (s.role === 'industrial' || s.role === 'hauler') {
    const total = s.shieldHp + s.armorHp + s.hullHp
    const want = CIVILIAN_HP_TARGET[s.tier as 1 | 2 | 3 | 4 | 5]
    check(
      total === want,
      `非战斗舰血量契约：${s.id}（T${s.tier} ${s.role}）三层共 ${total} ≠ 目标 ${want}（= 同档官方战斗舰总血中位×0.8；改数请同步本表与 ships.ts 头注）`,
    )
  }
  // V10.5b：每层抗性为三系对象（0~0.9/系），键必须是合法伤害类型
  for (const r of ['shieldResist', 'armorResist', 'hullResist'] as const) {
    const res = s[r]
    if (res === undefined) continue
    if (typeof res !== 'object') {
      errors.push(`舰船 ${s.id} ${r} 应为三系对象（V10.5b）`)
      continue
    }
    for (const [t, val] of Object.entries(res)) {
      if (!DMG_TYPES.has(t)) errors.push(`舰船 ${s.id} ${r} 含未知伤害类型键：${t}`)
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 0.9) {
        errors.push(`舰船 ${s.id} ${r}.${t} 越界：${String(val)}`)
      }
    }
  }
  // V10.5b：CPU 总量必填正数；无人机舱 ≥0；间接属性若有则必须为正数
  check((s.cpu ?? 0) > 0 && Number.isInteger(s.cpu), `舰船 ${s.id} cpu 缺失或非法（V10.5b）`)
  check((s.droneBayM3 ?? 0) >= 0 && Number.isFinite(s.droneBayM3), `舰船 ${s.id} droneBayM3 非法`)
  // V18：槽位布局必填（高/中/低 ≥1 整数；总位 3~12）
  const slots = s.slots
  check(!!slots, `舰船 ${s.id} 缺少 V18 槽位布局 slots`)
  if (slots) {
    const total = slots.high + slots.mid + slots.low
    check(
      // ⚠ **2026-09-12 船长：「每种槽位上限提高到 7」**——原 高6/中5/低6 与"总槽位 3~12"同批，
      //   当日一并放宽；放宽后 **旗舰 7/7/4 = 18 槽**成立（且满足"武装舰高槽多于低槽"）。
      Number.isInteger(slots.high) && slots.high >= 1 && slots.high <= 7 &&
        Number.isInteger(slots.mid) && slots.mid >= 1 && slots.mid <= 7 &&
        Number.isInteger(slots.low) && slots.low >= 1 && slots.low <= 7,
      `舰船 ${s.id} slots 越界：${JSON.stringify(slots)}（需 高1-7/中1-7/低1-7）`,
    )
    // ⚠ **2026-09-12 船长：「总体槽位契约当初是为驱逐舰设定了，现在废除」**——
    //   原为 `total >= 3 && total <= 12`（上限当年以驱逐舰为标尺）。现**废除上限**：
    //   战列舰（T4）按**平均值 14**、旗舰（T5）**18**。下限保留 3（防手滑写成 1~2 槽的空壳）。
    check(total >= 3, `舰船 ${s.id} 总槽位 ${total} 过少（下限 3）`)
    // V18 族定位弱断言：**只剩"武装舰高槽多"半条**
    // ⚠ **2026-09-13 船长：「删掉」** ⇒ **装甲舰那半条（`low >= high + 1`）已删除**。
    //   出处回顾：该弱断言 2026-09-04 随 V18A 槽位落库（`68bb806f`），依据是 `docs/design/v18-slots.md`
    //   §四布局草案表（陆龟 2/2/3、玳瑁 2/3/3、玄武 2/3/4 的低槽偏多形态 + 注"甲厚（低槽多）"）。
    //   删除理由：① 它是**草案精神**而非独立裁定；② 草案数值早被后续平衡批突破（玄武已从 2/3/4 变 4/4/6）；
    //   ③ 虫洞族重装巡洋按新口径给到"高槽 4"（4/4/4、4/3/5）⇒ 与 `low >= high + 1` 冲突。
    //   保留"武装舰"半条（**官方船**；且与 armed 族的身份一致）。
    //   ⚠ **2026-09-17 船长「D 族移动到武装舰」** ⇒ 这条弱断言的适用范围收窄为**官方船**：
    //   虫洞专属舰的槽位是 2026-09-13 按**子分类**定的（电子舰 / 指挥舰 = 中槽型：2/3/3、2/4/4；
    //   陵寝巡洋舰 4/4/4）—— 让"高槽多"去推翻那套设计不成立。三艘的实际布局由
    //   `core/tests/wh-ship-baseline.test.ts`「D 族三艘的实际布局逐一钉住」逐条守着。
    if (s.role === 'armed' && !s.id.startsWith('sh-wh-')) {
      check(slots.high >= slots.low + 1, `武装舰 ${s.id} 高槽应显著多于低槽（${slots.high} vs ${slots.low}）`)
    }
    // **专属舰槽位基准线契约**（船长 2026-09-14：「默认的舰船，按级别分别是 7/9/11/14/18 个槽位。
    // 种族专属的会在这个基础上 +1 槽位」）——只钉 `sh-wh-*`；官方船现状不在此契约内（见 TIER_SLOT_BASE 注释）。
    // ⚠ 本契约是 2026-09-14 那次核账的钉子：此前 15 艘里 1 艘欠 1 格（掠袭电子舰）、4 艘各多 1 格
    //   （机库 / 亡军后勤 / 巨构 / 亡军鱼雷舰——创建值本就高于默认线，批次 +1 又叠了一格）。
    if (s.id.startsWith('sh-wh-')) {
      const base = TIER_SLOT_BASE[s.tier]
      if (base !== undefined) {
        check(
          total === base + 1,
          `专属舰 ${s.id} 槽位总数应为该档默认 ${base} +1 = ${base + 1}，实际 ${total}（船长 2026-09-14 基准线）`,
        )
      }
    }
    // **已点名对齐的官方船**：恰好等于该档默认（船长逐艘点名，名单见 OFFICIAL_SLOT_ALIGNED）
    if (OFFICIAL_SLOT_ALIGNED.has(s.id)) {
      const base = TIER_SLOT_BASE[s.tier]
      if (base !== undefined) {
        check(
          total === base,
          `官方舰 ${s.id} 已按船长裁定对齐基准线，槽位总数应为该档默认 ${base}，实际 ${total}`,
        )
      }
    }
  }
  // V12：回避 0~0.9、命中加成 0~0.5
  check(s.evasion === undefined || (s.evasion >= 0 && s.evasion <= 0.9), `舰船 ${s.id} evasion 越界：${String(s.evasion)}`)
  check(s.hitBonus === undefined || (s.hitBonus >= 0 && s.hitBonus <= 0.5), `舰船 ${s.id} hitBonus 越界：${String(s.hitBonus)}`)
  // **船体固有新机制三条**（2026-09-13 船长点名：炮舰动能射程 / 指挥舰全舰光环 / 侦察舰·电子舰扫码）
  for (const [rt, v] of Object.entries(s.weaponRangeBonusPct ?? {})) {
    check(
      DMG_TYPES.has(rt) && typeof v === 'number' && v > 0 && v <= 0.6,
      `舰船 ${s.id} weaponRangeBonusPct.${rt} 越界（应 0<x≤0.6）：${String(v)}`,
    )
  }
  check(
    s.fleetDamageBonusPct === undefined || (s.fleetDamageBonusPct > 0 && s.fleetDamageBonusPct <= 0.5),
    `舰船 ${s.id} fleetDamageBonusPct 越界（应 0<x≤0.5）：${String(s.fleetDamageBonusPct)}`,
  )
  check(
    s.wormholeScanRadiusBonus === undefined ||
      (Number.isInteger(s.wormholeScanRadiusBonus) && s.wormholeScanRadiusBonus > 0 && s.wormholeScanRadiusBonus <= 3),
    `舰船 ${s.id} wormholeScanRadiusBonus 越界（应 1~3 的整数）：${String(s.wormholeScanRadiusBonus)}`,
  )
  // **后勤舰维修脉冲字段**（2026-09-16 船长：「后勤舰添加特性，维修装置可以修理血量最少的队友。」
  // ＋同日「我发现之前给后勤舰的维修特性并添加到船体特性属性中？」⇒ 由 `subClass` 硬判据改为本字段驱动）：
  // 只认 true（或整条缺省）；写了就必须真是「后勤舰」子分类（防把"修队友"挂到别的船上）
  check(
    s.repairPulseTargetsFleet === undefined || s.repairPulseTargetsFleet === true,
    `舰船 ${s.id} repairPulseTargetsFleet 只认 true（或整条缺省）：${String(s.repairPulseTargetsFleet)}`,
  )
  check(
    s.repairPulseTargetsFleet !== true || s.subClass === '后勤舰',
    `舰船 ${s.id} 写了 repairPulseTargetsFleet（维修脉冲修队友）但子分类不是「后勤舰」：${String(s.subClass)}`,
  )
  // **舰种子分类**（2026-09-13 船长：虫洞族专属舰船按子分类重排并进界面；同日放宽：协会功能舰也可写）
  // 取值限白名单（防手滑写错标签；D 族巡洋舰按裁定**不设**子分类）；非虫洞舰须在登记表里
  if (s.subClass !== undefined) {
    check(
      SHIP_SUBCLASSES.includes(s.subClass as (typeof SHIP_SUBCLASSES)[number]),
      `舰船 ${s.id} 子分类非法：${String(s.subClass)}`,
    )
    check(
      s.id.startsWith('sh-wh-') || SUBCLASS_NON_WH_SHIP_IDS.has(s.id),
      `舰船 ${s.id} 写了子分类（${String(s.subClass)}）但既不是虫洞族专属舰、也不在非虫洞登记表里（协会功能舰须登记）`,
    )
  }
  for (const f of ['maxSpeedMps', 'warpSpeedAus', 'massKg', 'lockRangeM', 'signatureM', 'scanResMm'] as const) {
    const v = s[f]
    check(v === undefined || (typeof v === 'number' && Number.isFinite(v) && v > 0), `舰船 ${s.id} 间接属性 ${f} 非法：${String(v)}`)
  }
  // ⚠ **判据按"类别"而非 `role`**（2026-09-17）：换血转线的牛鲨 + E 族三艘 `role` 仍是 `armed`
  //   但类别是「装甲舰」——它们已按专条移除 powerBonus（改给甲层抗性），不该再被这条要求"必带单发加成"。
  const catOfThis = shipCategoryKeyOf(s)
  if (catOfThis === 'armed') {
    // 2026-09-17 船长：「武装舰T1~T5获得单发伤害加成…**如果是无人机船，则改为同等数值的无人机伤害加成**」
    // ⇒ 无人机船（梭鱼 / 王鲭）没有 `powerBonus`，那笔加成改走 `droneDmgBonus`（档位阶梯值另由专条钉住）。
    check(
      (s.powerBonus ?? s.droneDmgBonus) !== undefined && (s.powerBonus ?? s.droneDmgBonus)! > 0 && (s.powerBonus ?? s.droneDmgBonus)! <= 2,
      `武装舰 ${s.id} 必须有合法 powerBonus 或 droneDmgBonus（无人机船口径）`,
    )
    /**
     * 2026-09-16 船长丙案：「**将装甲占比比护盾高的船也归入装甲舰**」＋裁决「**只在武装舰里判**」，
     * 同日还要求「**将牛鲨级突击舰和E族专属舰的护盾和装甲互换**」⇒ 这 4 艘（role 仍 `armed`）
     * 换完就是**装甲占比 > 护盾占比** ⇒ 归入「装甲舰」类别。故原硬契约放宽为：
     * **盾 > 甲，或者它属于装甲线**（判据 = `isArmorLineShip`，与界面类别筛选同源）。
     */
    check(
      (s.shieldHp ?? 0) > (s.armorHp ?? 0) || isArmorLineShip(s),
      `武装舰 ${s.id} 护盾应大于装甲（族定位）——除非它归入「装甲舰」类别（装甲占比 > 护盾占比）`,
    )
  } else if (catOfThis === 'industrial' || catOfThis === 'hauler') {
    // 采矿舰 / 货运舰不带伤害加成（装甲舰的例外 = 子分类给的炮舰/鱼雷舰加成，另由「加成与抗性新口径」管）
    check(s.powerBonus === undefined, `非武装舰 ${s.id} 不应带 powerBonus`)
  }
  const total = (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
  const bucket = (tierTotalAvg[s.tier] ??= { industrial: [], others: [] })
  ;(s.role === 'industrial' ? bucket.industrial : bucket.others).push(total)
}
// 族定位弱断言：同 tier 下工业系平均总血量应低于非工业系（工业 = 采矿机器）
for (const [tier, b] of Object.entries(tierTotalAvg)) {
  if (b.industrial.length === 0 || b.others.length === 0) continue
  const indAvg = b.industrial.reduce((a, x) => a + x, 0) / b.industrial.length
  const othAvg = b.others.reduce((a, x) => a + x, 0) / b.others.length
  check(indAvg < othAvg, `tier ${tier} 工业系平均总血量（${Math.round(indAvg)}）应低于非工业系（${Math.round(othAvg)}）`)
}
// 2026-09-12：25 → **27**（船长「T4,T5 可以先立个模子」⇒ 新增巨齿鲨级战列舰 sh-megalodon、
// 邓氏鱼级旗舰 sh-dunkleosteus 两具**壳体**：定制船口径 priceIsk 0、不上市场/不接蓝图/不接卡）。
// 2026-09-13：27 → **42**（船长「护卫，驱逐，巡洋，都可以有，你干脆都安排设计吧」⇒ 新增
// **虫洞专属舰船 15 艘**：A/C/D/E/G 五族各 护卫 T1 / 驱逐 T2 / 巡洋 T3，只由一次性舰船图纸制造；
// ✅ 2026-09-14 虫洞上线后它们**全部已上线**（`unreleased` 字段已删，见「虫洞专属内容契约」）；
// 计数是"防手滑"的守卫，改数据时同步改这里与 `hull-class.test.ts`）。
// 2026-09-13（同日第二批 · 船长「完善战列舰」）：**巨齿鲨级 sh-megalodon 已定案接图纸线**
// （补掠食者线 `shieldResist` 动能 0.5；市场行 225M `playerBuyable: false` 只收不卖 ⇒ `priceIsk` 仍为 0；
// 蓝图 sbp-megalodon 900M）；**邓氏鱼级 sh-dunkleosteus 仍是壳体**（不上市场/不接蓝图/不接卡）。
// 同批：**T4 档价位全面上调**（玄武 16.5M / 蝠鲼 13.5M / 剑鱼 4.8M）+ **全舰工期阶梯重排**（见
// `docs/design/t4-battleship-20260913.md`）。
// 2026-09-13（同日第三批 · 船长「添加一艘新的巡洋舰，子分类为侦查舰…」）：42 → **43** ⇒ 新增
// **鹦鹉螺级测绘巡洋舰 sh-nautilus**（协会测绘处 · T3 侦察舰 · 10 槽 · 机舱 80 · 虫洞扫码 +1；
// 奇货 + 数字 4（✅ 2026-09-14 虫洞上线后闸门已删）；子分类契约同日放宽为"白名单 + 非虫洞登记表"；见
// `docs/design/scout-cruiser-20260913.md`）。
check(SHIPS.length === 43, `舰船应为 43 艘（既有 27 + 虫洞专属 15 + 鹦鹉螺级 1），实际 ${SHIPS.length}`)
console.log(
  `· 舰船：${SHIPS.length} 艘（role 分布：${["industrial", "armed", "armored", "hauler"].map((r) => `${r}=${SHIPS.filter((s) => s.role === r).length}`).join(" ")})`,
)

/* ── V10.5 战斗数值契约：弹药 / 无人机 / 装备字段 ── */
for (const a of ammos) {
  check(a.damageType !== undefined && DMG_TYPES.has(a.damageType), `弹药 ${a.id} damageType 缺失或非法`)
  check((a.dmg ?? 0) > 0 && Number.isFinite(a.dmg), `弹药 ${a.id} dmg 缺失或非正`)
}
// V18（口径取消）+ 2026-09-09 弹药 MK2：每族 2 件 = 基础弹（-l）+ MK2（-2），各档能量基数最高
for (const t of DMG_TYPES) {
  const list = ammos.filter((a) => a.damageType === t)
  check(list.length === 2, `弹药：${t} 型应恰有 2 件（基础 -l + MK2 -2），实际 ${list.length}`)
  check(list.some((a) => a.id.endsWith('-l')), `弹药：${t} 型缺基础弹（-l）`)
  check(list.some((a) => a.id.endsWith('-2')), `弹药：${t} 型缺 MK2 弹（-2）`)
}
{
  // 能量(plasma)基数最高契约按档成立（基础 6/7/9、MK2 8/9/12 各自档内 plasma 最高）
  for (const suffix of ['-l', '-2']) {
    const byType = (t: string) => ammos.find((a) => a.damageType === t && a.id.endsWith(suffix))?.dmg ?? 0
    check(
      byType('plasma') > byType('kinetic') &&
        byType('plasma') > byType('explosive'),
      `弹药：能量(plasma)基数应最高（${suffix} 档），实际 kin=${byType("kinetic")} exp=${byType("explosive")} pla=${byType("plasma")}`,
    )
  }
  // MK2 纯数值上级契约：同族 MK2 dmg > 基础（防未来反超/混档）
  for (const t of DMG_TYPES) {
    const base = ammos.find((a) => a.damageType === t && a.id.endsWith('-l'))
    const mk2 = ammos.find((a) => a.damageType === t && a.id.endsWith('-2'))
    check((mk2?.dmg ?? 0) > (base?.dmg ?? 0), `弹药：${t} MK2 单发应高于基础弹`)
  }
}
/** 射程豁免机型（船长 2026-09-13「专属无人机开豁免」）——只登记并打印，不参与断言 */
const exclusiveRangeNotes: string[] = []
for (const d of drones) {
  check(d.damageType !== undefined && DMG_TYPES.has(d.damageType), `无人机 ${d.id} damageType 缺失或非法`)
  check((d.dmg ?? 0) > 0 && Number.isFinite(d.dmg), `无人机 ${d.id} dmg 缺失或非正`)
  check((d.cpuUse ?? 0) > 0 && Number.isInteger(d.cpuUse), `无人机 ${d.id} cpuUse 缺失或非法（V10.5b 放飞占 CPU）`)
  // 2026-09-10 射程分类 + 分类字段契约（船长：机型分类入本体，界面「种类」显示无人机 · 侦察机）
  const DRONE_CLASS_RANGE: Record<string, number> = { scout: 4000, combat: 4500, assault: 5000, sentry: 6500 } // 2026-09-14 船长「只有我方无人机，射程+1500」⇒ 档位标准整体 +1500（原 2500/3000/3500/5000）
  const dc = d.droneClass
  check(dc !== undefined && DRONE_CLASS_RANGE[dc] !== undefined, `无人机 ${d.id} droneClass 缺失或非法：${String(dc)}`)
  if (dc !== undefined && DRONE_CLASS_RANGE[dc] !== undefined) {
    // **2026-09-13 船长：「专属无人机开豁免」** ⇒ `exclusive` 机型不受「射程分类」档位硬钉约束
    //（仍受 droneRoles 的两道约束：区间 `DRONE_ROLE_SPECS[cls].rangeM` 与硬边界 500~20000m）。
    if (d.exclusive === true) {
      exclusiveRangeNotes.push(`${d.id}（${dc}）射程 ${String(d.maxRangeM)} · 档位标准 ${DRONE_CLASS_RANGE[dc]}`)
    } else {
      check(
        d.maxRangeM === DRONE_CLASS_RANGE[dc],
        `无人机 ${d.id}（${dc}）射程应为 ${DRONE_CLASS_RANGE[dc]}，实际 ${String(d.maxRangeM)}`,
      )
    }
  }
  // V11：无人机生存包契约（三层血量必填、回避与抗性界内）
  const def = d.defense
  check(!!def && (def.shieldHp ?? 0) > 0 && (def.armorHp ?? 0) > 0 && (def.hullHp ?? 0) > 0, `无人机 ${d.id} defense 缺失或三层血量非正（V11）`)
  check(def === undefined || def.evasion === undefined || (def.evasion >= 0 && def.evasion <= 0.9), `无人机 ${d.id} defense.evasion 越界`)
  for (const r of ['shieldResist', 'armorResist', 'hullResist'] as const) {
    const res = def?.[r]
    if (!res) continue
    for (const [t, val] of Object.entries(res)) {
      if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 0.9) {
        errors.push(`无人机 ${d.id} defense.${r}.${t} 非法：${String(val)}`)
      }
    }
  }
  // 2026-09-10 四型定位契约（船长拍板；新增机型必须落在区间内——契约定义见 data/droneRoles.ts）
  // 专属强化型（exclusive）由船长裁决豁免区间校验，只受硬边界约束（会打印在下面的清单里）
  for (const issue of droneRoleIssues(d, scoutDmg)) errors.push(issue)
}
{
  // 跨四类阶梯（闪避严格递减 / 血量与单发阶梯 / 哨戒血量与侦察机相仿）——**只比锚点机型**
  const ladderIssues = droneRoleLadderIssues(drones as never)
  for (const issue of ladderIssues) errors.push(`无人机定位契约：${issue}`)
  if (drones.length > 0) {
    const base = drones.find((d) => d.id === DRONE_ROLE_ANCHORS.scout)
    console.log(
      `· 无人机四型定位：${drones
        .map((d) => {
          const cls = d.droneClass ?? '?'
          const tag =
            d.exclusive === true
              ? '专属'
              : (DRONE_ROLE_SPECS[cls as keyof typeof DRONE_ROLE_SPECS]
                  ?.label ?? cls)
          return `${tag} 闪避 ${d.defense?.evasion ?? "—"}·血 ${droneTotalHp(d)}·单发 ${d.dmg ?? 0}`
        })
        .join('　')}（单发基准 = 锚点侦察机 ${base?.name ?? '—'} ${scoutDmg}）`,
    )
  }
  if (exclusiveRangeNotes.length > 0) {
    console.log(`· 无人机射程豁免（船长 2026-09-13「专属无人机开豁免」）：${exclusiveRangeNotes.join('　')}`)
  }
}
for (const m of MODULES) {
  // 2026-09-11 船长裁决「甲」（新增协处理器时）：**cpuUse 必填整数 ≥ 0**——零占用只允许"本件就是
  // 加预算"的件（带 cpuBonus），别的件漏写占用照旧报错（保住 V10.5b「每件都占 CPU」的原意）。
  const cpuUse = m.cpuUse
  check(
    cpuUse !== undefined && Number.isInteger(cpuUse) && cpuUse >= 0,
    `装备 ${m.id} cpuUse 缺失或非法（V10.5b：必填整数 ≥ 0）`,
  )
  check(
    (cpuUse ?? 0) > 0 || (m.cpuBonus ?? 0) > 0,
    `装备 ${m.id} cpuUse = 0 却没有 cpuBonus——零占用只允许"加预算"件（协处理器族）`,
  )
  check(
    (m.cpuBonus ?? 0) >= 0 && Number.isInteger(m.cpuBonus ?? 0),
    `装备 ${m.id} cpuBonus 非法（需非负整数）`,
  )
  // V18：家族合法（六家族 + 无人机装置两家族）
  check([...MODULE_SLOTS].includes(m.slot), `装备 ${m.id} 家族非法：${m.slot}`)
  // V18：槽类归属 rack 必填且与 rackOf 推导一致（Q3 映射集中落数据；防标注漂移）
  check(m.rack !== undefined && RACK_SLOTS.includes(m.rack), `装备 ${m.id} 缺少 V18 rack 归属`)
  if (m.rack !== undefined) {
    check(m.rack === rackOf(m), `装备 ${m.id} rack 标注（${m.rack}）与 Q3 推导（${rackOf(m)}）不一致`)
  }
  /**
   * **作业装备归高槽**（船长 2026-09-14：「**改回高槽**」——采集器 / 打捞器回到高槽组，
   * 与炮台/无人机装置同槽竞争；2026-09-13 的「给作业开」（归低槽）口径作废：
   * 低槽口径下作业装备混进低槽组，与装甲/货舱错位，船长实测判定为 BUG）。
   *
   * ⚠ 为什么必须单列一条：上面那条 `m.rack === rackOf(m)` 对**显式标了 rack 的件是同义反复**
   * （`rackOf` 优先返回显式值）⇒ 把采集器写回 `low` 也照样通过。这条才是真钉子。
   */
  if (m.slot === 'miner' || m.slot === 'salvager') {
    check(
      m.rack === 'high',
      `作业装备 ${m.id}（${m.slot}）必须归**高槽**：船长 2026-09-14「改回高槽」——作业装备归高槽组，不占低槽`,
    )
  }
  if (m.slot === 'drone-rack' || m.slot === 'drone-tac') {
    // V18 无人机装置：字段自洽（甲板扩展 = +droneBayM3；战术导控 = +droneDmgBonus；互斥）
    const hasBay = (m.droneBayBonusM3 ?? 0) > 0
    const hasDmg = (m.droneDmgBonus ?? 0) > 0
    check(hasBay !== hasDmg, `无人机装置 ${m.id} 必须且只能给一个效果字段（bay/dmg）`)
    if (hasBay) check((m.droneBayBonusM3 ?? 0) <= 500, `无人机甲板 ${m.id} droneBayBonusM3 越界`)
    if (hasDmg) check((m.droneDmgBonus ?? 0) <= 1, `战术导控 ${m.id} droneDmgBonus 越界`)
  }
  if (m.slot === 'drone-relay') {
    // 2026-09-10 无人机中继天线：百分比射程加成（值域 (0, 2]，多件线性求和乘入机型射程）
    check(
      (m.droneRangeBonusPct ?? 0) > 0 && (m.droneRangeBonusPct ?? 0) <= 2,
      `无人机中继天线 ${m.id} droneRangeBonusPct 非法（需 (0, 2]）`,
    )
  }
  if (m.slot === 'miner' || m.slot === 'cargo') {
    // V17：工业槽保留加成系数形态
    check((m.bonus ?? 0) > 0 && Number.isFinite(m.bonus), `工业装备 ${m.id} bonus 缺失或非法（V17 仅工业槽使用）`)
  } else if (m.slot === 'turret') {
    // V17：炮台不再携带工业 bonus（火力参数 = 武器卡，见下方全参数检查）
    check(m.bonus === undefined, `炮台 ${m.id} 不应携带 bonus（V17 起炮台用武器参数）`)
    check(m.damageType !== undefined && DMG_TYPES.has(m.damageType), `炮台 ${m.id} damageType 缺失或非法（V17.2 炮族制：固定弹种）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `炮台 ${m.id} ammoPerEngagement 缺失或非法`)
    // V12：武器参数必填且值域合法
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `炮台 ${m.id} maxRangeM 缺失或非法`)
    check(m.minRangeM !== undefined && m.minRangeM >= 0 && m.minRangeM < (m.maxRangeM ?? 0), `炮台 ${m.id} minRangeM 非法`)
    check(m.hitRate !== undefined && m.hitRate > 0 && m.hitRate <= 1, `炮台 ${m.id} hitRate 非法`)
    check(m.falloff !== undefined && m.falloff > 0 && m.falloff <= 1, `炮台 ${m.id} falloff 非法`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `炮台 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `炮台 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'shield') {
    // V17.1 拆族：容量件（shieldHpBonus）与抗性件（shieldResistAdd）互斥，且必须给一项
    const cap = m.shieldHpBonus
    const add = m.shieldResistAdd
    const hasCap = cap !== undefined
    const hasAdd = add !== undefined && Object.keys(add).length > 0
    /** 2026-09-14 护盾充能装置：护盾槽的**第三类**——脉冲充能（既不给容量也不给抗性） */
    const pulse = m.shieldPulsePct
    const hasPulse = pulse !== undefined
    check(hasCap || hasAdd || hasPulse, `护盾 ${m.id} 未声明容量、抗性或脉冲充能（V17.1 拆族 + 2026-09-14 充能件）`)
    if (hasPulse) {
      check(
        pulse !== undefined && pulse > 0 && pulse <= 0.8,
        `护盾充能件 ${m.id} shieldPulsePct 非法：${String(pulse)}（需 (0, 0.8]）`,
      )
      check(m.rack === 'mid', `护盾充能件 ${m.id} 应为中槽，实际 ${m.rack}`)
    }
    // 2026-09-13 船长（巨构护盾矩阵：「动能和能量抗性 +32%、护盾上限 +42%」）⇒ **取消"容量与抗性互斥"**：
    // 允许同一件并给容量与抗性；V17.1 拆族只保留"至少给其中一项"。
    if (hasCap) check(cap !== undefined && cap > 0 && cap <= 2, `护盾 ${m.id} shieldHpBonus 非法`)
    if (hasAdd) {
      for (const [t, val] of Object.entries(add ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`护盾 ${m.id} shieldResistAdd.${t} 非法：${String(val)}（需 (0, 0.9]，乘入缺口值）`)
        }
      }
    }
  } else if (m.slot === 'armor') {
    // V17.1 拆族：同上（装甲镀层=抗性 / 装甲增厚板=容量）
    const cap = m.armorHpBonus
    const add = m.armorResistAdd
    const hasCap = cap !== undefined
    const hasAdd = add !== undefined && Object.keys(add).length > 0
    /* 2026-09-13 虫洞专属（船长逐条给定）：装甲槽放开为**"防护类任一项"**——
     * 几丁质骨架层（结构容量 + 机动）、巨构损管阵列（结构抗 + 结构容量）、掠袭折射涂层（全层抗性削减 + 闪避）
     * 三件都不再给"甲容量/甲抗"，但仍属防护向。**同件同时给甲容量与甲抗**依旧禁止（拆族口径保留）。 */
    const hasHull =
      m.hullHpBonus !== undefined ||
      (m.hullResistAdd !== undefined && Object.keys(m.hullResistAdd).length > 0)
    const hasDefOther = m.allResistPenaltyPct !== undefined || m.speedBonusPct !== undefined
    check(
      hasCap || hasAdd || hasHull || hasDefOther,
      `装甲 ${m.id} 未声明任何防护类效果（甲容量 / 甲抗 / 结构容量 / 结构抗 / 全层抗性削减 / 机动加成）`,
    )
    check(!(hasCap && hasAdd), `装甲 ${m.id} 同时携带甲容量与甲抗——抗性/容量件已拆族（V17.1）`)
    if (hasCap) check(cap !== undefined && cap > 0 && cap <= 2, `装甲 ${m.id} armorHpBonus 非法`)
    if (hasAdd) {
      for (const [t, val] of Object.entries(add ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`装甲 ${m.id} armorResistAdd.${t} 非法：${String(val)}（需 (0, 0.9]，乘入缺口值）`)
        }
      }
    }
    // 2026-09-10 船长：重甲件的**机动代价**（陵寝装甲层 −25%）——值域 (0, 0.9]；
    // 只挂在容量件上（抗性件不该借代价换额外厚度），多件不叠加、战斗内取最重一件
    if (m.speedPenaltyPct !== undefined) {
      check(
        m.speedPenaltyPct > 0 && m.speedPenaltyPct <= 0.9,
        `装甲 ${m.id} speedPenaltyPct 非法（需 (0, 0.9]，战斗速度代价）`,
      )
      check(hasCap, `装甲 ${m.id} 带 speedPenaltyPct 却不给容量——机动代价只挂在容量件上`)
    }
    // 2026-09-10 船长：**结构层容量**（E 族巨构骨架引出）——值域 (0, 2]，通常与装甲容量同件
    if (m.hullHpBonus !== undefined) {
      check(
        m.hullHpBonus > 0 && m.hullHpBonus <= 2,
        `装甲 ${m.id} hullHpBonus 非法（需 (0, 2]，结构层容量加成）`,
      )
    }
  } else if (m.slot === 'propulsion') {
    // 2026-09-08 船长：取消 speedBonusPct ≤0.9 上限护栏（推进器提速档位改由设计定；命中代价 hitPenalty 仍受检）
    check(m.speedBonusPct !== undefined && m.speedBonusPct > 0, `推进器 ${m.id} speedBonusPct 非法（需为正）`)
    check(m.hitPenalty === undefined || (m.hitPenalty >= 0 && m.hitPenalty <= 0.5), `推进器 ${m.id} hitPenalty 非法（需 [0, 0.5]，V17.1 命中代价）`)
  } else if (m.slot === 'missile') {
    // V18B-1 导弹架：爆炸系武器形态——追踪命中（不随距离衰减）+ 近盲安全射距（防自爆）
    check(m.bonus === undefined, `导弹架 ${m.id} 不应携带工业 bonus`)
    check(m.damageType === 'explosive', `导弹架 ${m.id} damageType 必须为 explosive（爆炸系武器形态）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `导弹架 ${m.id} ammoPerEngagement 缺失或非法`)
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `导弹架 ${m.id} maxRangeM 缺失或非法`)
    check((m.minRangeM ?? 0) > 0 && (m.minRangeM ?? 0) < (m.maxRangeM ?? 0), `导弹架 ${m.id} minRangeM 必须为近盲正数（太近会炸到自己）`)
    check(m.hitRate !== undefined && m.hitRate > 0 && m.hitRate <= 1, `导弹架 ${m.id} hitRate 非法`)
    check(m.falloff === 1, `导弹架 ${m.id} falloff 必须为 1（命中不随距离衰减）`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `导弹架 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `导弹架 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态——必中光束（消耗能量弹药，威力随距离衰减）
    check(m.bonus === undefined, `激光炮 ${m.id} 不应携带工业 bonus`)
    check(m.damageType === 'plasma', `激光炮 ${m.id} damageType 必须为 plasma（能量系武器形态）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `激光炮 ${m.id} ammoPerEngagement 缺失或非法`)
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `激光炮 ${m.id} maxRangeM 缺失或非法`)
    check(m.minRangeM === 0, `激光炮 ${m.id} minRangeM 必须为 0（光束无近盲）`)
    check(m.hitRate === 1, `激光炮 ${m.id} hitRate 必须为 1（必中，不掷命中）`)
    check(m.falloff !== undefined && m.falloff > 0 && m.falloff <= 1, `激光炮 ${m.id} falloff（威力衰减参）非法`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `激光炮 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `激光炮 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'support') {
    // V18.1 支援件：恰好一类效果字段（伤害稳定器按系/射速/命中/闪避互斥），值域合法；
    // 2026-09-09 维修装置：修复系 = repairArmorHp/repairHullHp 可同带（装甲+结构双层修复）——
    // 修复系与旧四类效果互斥（一件只给一个功能系）
    const stabKeys = Object.entries(m.damageTypeBonusPct ?? {}).filter(([, v]) => (v ?? 0) > 0).length
    const hasRof = m.reloadCutPct !== undefined
    const hasHit = m.hitBonusPct !== undefined
    const hasEva = m.evasionGapPct !== undefined
    // 2026-09-14 跃迁计算机：**跃迁**成为支援件的第六类效果（低槽；只缩短星系际航行时间）
    const hasWarp = m.warpSpeedBonusPct !== undefined
    // 2026-09-15 隐秘行动装置：**隐身**成为支援件的第七类效果（**高槽**；开火前隐身 20/30 秒）
    const hasStealth = m.stealthMs !== undefined
    const hasRepair = (m.repairArmorHp ?? 0) > 0 || (m.repairHullHp ?? 0) > 0
    const kinds =
      (stabKeys > 0 ? 1 : 0) + (hasRof ? 1 : 0) + (hasHit ? 1 : 0) + (hasEva ? 1 : 0) + (hasRepair ? 1 : 0) + (hasWarp ? 1 : 0) + (hasStealth ? 1 : 0)
    check(kinds === 1, `支援件 ${m.id} 必须且只能给一类效果（伤害系/射速/命中/闪避/修复/跃迁/隐身）`)
    if (hasRepair) {
      // 修复系：装甲/结构修复值 ∈ [1, 100]、周期缺省 5 秒（2000~60_000 毫秒）、必须指明消耗的修理组件
      check((m.repairArmorHp ?? 0) >= 0 && (m.repairArmorHp ?? 0) <= 100 && (m.repairHullHp ?? 0) >= 0 && (m.repairHullHp ?? 0) <= 100,
        `支援件 ${m.id} 修复值非法（需 [0, 100] 且至少一层 > 0）`)
      const interval = m.repairIntervalMs ?? 5_000
      check(Number.isInteger(interval) && interval >= 2_000 && interval <= 60_000, `支援件 ${m.id} repairIntervalMs 非法（需 2000~60000 毫秒）`)
      // 2026-09-10 船长：异形生体件 = **无消耗自愈**（repairFree）——与消耗件互斥：
      // 要么指明民用/军用修理组件，要么标 repairFree（不吃组件、永不停机）
      check(
        (m.repairKit === 'repairkit-civ' || m.repairKit === 'repairkit-mil') !== (m.repairFree === true),
        `支援件 ${m.id} 必须二选一：指明消耗组件（民用/军用修理组件）或标 repairFree（无消耗自愈）`,
      )
      check(m.rack === 'mid', `支援件 ${m.id}（修复）应为中槽，实际 ${m.rack}`)
      check(m.reloadCutPct === undefined && m.hitBonusPct === undefined && m.evasionGapPct === undefined && stabKeys === 0,
        `支援件 ${m.id} 修复系不得与其它支援效果同带`)
    } else {
      for (const [t, val] of Object.entries(m.damageTypeBonusPct ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`支援件 ${m.id} damageTypeBonusPct.${t} 非法：${String(val)}`)
        }
      }
      if (hasRof) check((m.reloadCutPct ?? 0) > 0 && (m.reloadCutPct ?? 0) <= 0.9, `支援件 ${m.id} reloadCutPct 非法（需 (0, 0.9]）`)
      if (hasHit) check((m.hitBonusPct ?? 0) > 0 && (m.hitBonusPct ?? 0) <= 0.9, `支援件 ${m.id} hitBonusPct 非法（需 (0, 0.9]）`)
      if (hasEva) check((m.evasionGapPct ?? 0) > 0 && (m.evasionGapPct ?? 0) <= 0.9, `支援件 ${m.id} evasionGapPct 非法（需 (0, 0.9]）`)
      // 跃迁计算机（2026-09-14）：跃迁速度加成值域 (0, 0.9]——单件 0.20 / 0.35，多件由 EVE 曲线收敛
      if (hasWarp) check((m.warpSpeedBonusPct ?? 0) > 0 && (m.warpSpeedBonusPct ?? 0) <= 0.9, `支援件 ${m.id} warpSpeedBonusPct 非法（需 (0, 0.9]）`)
      // 隐秘行动装置（2026-09-15 船长）：隐身窗口值域 (0, 120000] 毫秒（两档 = 20 / 30 秒；
      // 档位与"每档多少秒"由下面「隐秘行动装置契约」逐条核）
      if (hasStealth) check((m.stealthMs ?? 0) > 0 && (m.stealthMs ?? 0) <= 120_000, `支援件 ${m.id} stealthMs 非法（需 (0, 120000] 毫秒）`)
      // 归槽语义：伤害/射速/**跃迁** = 低槽；命中/闪避 = 中槽；**隐身 = 高槽**（数据显式 rack，rackOf 已校验一致）
      if (stabKeys > 0 || hasRof || hasWarp) check(m.rack === 'low', `支援件 ${m.id}（伤害/射速/跃迁）应为低槽，实际 ${m.rack}`)
      if (hasHit || hasEva) check(m.rack === 'mid', `支援件 ${m.id}（命中/闪避）应为中槽，实际 ${m.rack}`)
      if (hasStealth) check(m.rack === 'high', `支援件 ${m.id}（隐身）应为高槽，实际 ${m.rack}`)
    }
    check(m.bonus === undefined, `支援件 ${m.id} 不应携带工业 bonus`)
    check(m.maxRangeM === undefined && m.damageType === undefined, `支援件 ${m.id} 不应携带炮台武器参数`)
  } else if (m.slot === 'target-lock') {
    // 2026-09-09 目标锁定阵列（高槽 target-lock）：携带 lockDmgBonus 值域合法、必须高槽、
    // 不携带其它效果/武器参数
    check((m.lockDmgBonus ?? 0) > 0 && (m.lockDmgBonus ?? 0) <= 0.9, `锁定装置 ${m.id} lockDmgBonus 非法（需 (0, 0.9]）`)
    check(m.rack === 'high', `锁定装置 ${m.id} 应为高槽，实际 ${m.rack}`)
    check(m.bonus === undefined && m.damageType === undefined && m.maxRangeM === undefined, `锁定装置 ${m.id} 不应携带工业/武器参数`)
  }
}

/* ── 隐秘行动装置契约（2026-09-15 船长：「添加隐秘行动装置，高槽，效果是自身武器开火前，隐身30秒
 *   （不被锁定，不被攻击）」；**2026-09-16 船长定数与渠道**：「MK2吃55CPU，价格提高到300W，MK3吃80CPU，
 *   价格提高到1000W，MK2为稀有订单稀有度3，MK3为奇货，稀有度4」）──
 * 本条把**船长给定值逐项钉死**（数值是船长的数 ⇒ 回归时改一处就会被拦下）：
 *   ① 恰好两档：MK2 = 20 秒 · CPU 55 · 300 万 · 稀有渠道 · 档 3；MK3 = 30 秒 · CPU 80 · 1000 万 · **奇货渠道 · 档 4**；
 *   ② 高槽支援件；③ 市场可买（不挂 unreleased）+ 有蓝图可造，且**蓝图渠道/档位与产物一致**；
 *   ④ 蓝图书价照档位系数（MK2 ×2.5 = 750 万 · 奇货 ×4 = 4000 万）。
 * ⚠「**带推进器则直接解除隐身**」是**引擎口径**（`combat.createPlayerSpec`：`propDefs` 非空即判 0），
 *   数据侧没有可核字段 ⇒ 由 core 用例钉住（`tests/stealth-device.test.ts`）。 */
{
  const stealthMods = MODULES.filter((m) => (m.stealthMs ?? 0) > 0)
  check(stealthMods.length === 2, `隐秘行动装置应为两档（MK2/MK3），实际 ${stealthMods.length} 件`)
  const byId = new Map(stealthMods.map((m) => [m.id, m]))
  /** 船长 2026-09-16 给定值（逐项钉死）：id → 窗口 / CPU / 市场价 / 渠道 / 档位 / 蓝图书价 */
  const SPEC: ReadonlyArray<{ id: string; bpId: string; ms: number; cpu: number; price: number; rarity: string; tier: number; book: number }> = [
    { id: 'mod-stealth-2', bpId: 'bp-stealth-2', ms: 20_000, cpu: 55, price: 3_000_000, rarity: 'rare', tier: 3, book: 7_500_000 },
    { id: 'mod-stealth-3', bpId: 'bp-stealth-3', ms: 30_000, cpu: 80, price: 10_000_000, rarity: 'exotic', tier: 4, book: 40_000_000 },
  ]
  for (const spec of SPEC) {
    const m = byId.get(spec.id)
    check(m !== undefined, `隐秘行动装置缺件：${spec.id}`)
    if (!m) continue
    check(m.stealthMs === spec.ms, `${spec.id} 的隐身窗口应为 ${spec.ms / 1000} 秒（船长给定）`)
    check(m.cpuUse === spec.cpu, `${spec.id} 的 CPU 占用应为 ${spec.cpu}（船长给定），实际 ${m.cpuUse}`)
    check(m.slot === 'support' && m.rack === 'high', `隐秘行动装置 ${m.id} 应为高槽支援件，实际 ${m.slot}/${m.rack}`)
    check(m.unreleased !== true, `隐秘行动装置 ${m.id} 标着未上线 —— 船长要的是玩家能拿到它`)
    const good = MARKET_GOODS.find((g) => g.kind === 'module' && g.refId === m.id)
    check(good !== undefined && good.unreleased !== true, `隐秘行动装置 ${m.id} 没有常驻市场行（玩家买不到）`)
    check(good?.rarity === spec.rarity, `${spec.id} 的市场渠道应为 ${spec.rarity}（船长给定），实际 ${good?.rarity}`)
    check(good?.basePrice === spec.price, `${spec.id} 的市场价应为 ${spec.price.toLocaleString('zh-CN')}（船长给定），实际 ${good?.basePrice}`)
    check(RARITY_TIER[spec.id] === spec.tier, `${spec.id} 的稀有度档应为 ${spec.tier}（与 ${spec.rarity} 渠道同带），实际 ${RARITY_TIER[spec.id]}`)
    const bp = BLUEPRINTS.find((b) => b.moduleId === m.id)
    check(bp !== undefined, `隐秘行动装置 ${m.id} 没有蓝图（不可制造）`)
    check(bp?.priceIsk === spec.book, `${spec.bpId} 的书价应为 ${spec.book.toLocaleString('zh-CN')}（产物价 × 档位系数），实际 ${bp?.priceIsk?.toLocaleString('zh-CN')}`)
    const bpRow = MARKET_GOODS.find((g) => g.kind === 'blueprint' && g.refId === spec.bpId)
    check(bpRow !== undefined && bpRow.unreleased !== true, `${spec.bpId} 没有市场行（玩家买不到图纸）`)
    check(bpRow?.rarity === spec.rarity && bpRow?.basePrice === spec.book, `${spec.bpId} 的渠道/书价应与产物同渠道同值`)
    check(RARITY_TIER[spec.bpId] === spec.tier, `${spec.bpId} 的稀有度档应与产物一致（${spec.tier}）`)
  }
  console.log(
    `· 隐秘行动装置契约：${SPEC.map((s) => `${byId.get(s.id)?.name} ${s.ms / 1000} 秒 · CPU ${s.cpu} · ${s.price / 10_000} 万（${s.rarity} 档 ${s.tier}）`).join(' · ')}` +
      ` · 带推进器即解除（引擎口径，见 core 用例；**侦察舰特性例外**见下一条契约）`,
  )
}

/* ── 侦察舰特性契约（船长 2026-09-16：「**侦查舰添加特性，隐秘行动装置所需CPU降低50%，且移除推进器
 *   失效惩罚**」；口径四答：只有「侦察舰」子分类那两艘 · CPU **向上取整**（55→28 · 80→40）·
 *   **完全移除**推进器惩罚 · 特性栏与装配页都显示）──
 * 本条钉三件事（数值是船长的数 ⇒ 改一处即红）：
 *   ① **恰好两艘**（鹦鹉螺级测绘巡洋舰 / 幽影侦察舰）带这两个字段，且值 = 0.5 / true；
 *   ② **别的船一件都不许带**（防"顺手给某艘船也开个口子"）；
 *   ③ 装置**限制说明**的措辞 =「与任何类型推进器一起使用时失效」（船长指定原话）。
 * ⚠ 引擎侧口径（折算单点 `equipment.cpuUseOf` · 推进器豁免在 `combat.createPlayerSpec`）
 *   由 core 用例钉住：`tests/stealth-device.test.ts` 的「侦察舰特性」组。 */
{
  const SCOUTS = ['sh-nautilus', 'sh-wh-g-frigate'] as const
  const byId = new Map(SHIPS.map((s) => [s.id, s]))
  for (const id of SCOUTS) {
    const s = byId.get(id)
    check(s !== undefined, `侦察舰缺件：${id}`)
    if (!s) continue
    check(s.subClass === '侦察舰', `${id} 的子分类应为「侦察舰」，实际 ${s.subClass ?? '(无)'}`)
    check(s.stealthCpuMul === 0.5, `${id} 的隐秘装置 CPU 倍率应为 0.5（船长给定），实际 ${s.stealthCpuMul}`)
    check(s.stealthIgnoresPropulsion === true, `${id} 应带「免推进器失效」特性（船长给定）`)
  }
  const extra = SHIPS.filter(
    (s) => !(SCOUTS as readonly string[]).includes(s.id) && (s.stealthCpuMul !== undefined || s.stealthIgnoresPropulsion === true),
  )
  check(
    extra.length === 0,
    `只有「侦察舰」那两艘能带该特性，实际多出：${extra.map((s) => `${s.name}(${s.id})`).join(' · ')}`,
  )
  const LIMIT = '与任何类型推进器一起使用时失效'
  for (const id of ['mod-stealth-2', 'mod-stealth-3']) {
    const m = MODULES.find((x) => x.id === id)
    check(
      (m?.description ?? '').includes(LIMIT),
      `${id} 的限制说明应含「${LIMIT}」（船长 2026-09-16 指定措辞）`,
    )
  }
  console.log(
    `· 侦察舰特性契约：${SCOUTS.map((id) => byId.get(id)?.name ?? id).join(' · ')} ⇒ 隐秘装置 CPU ×0.5（向上取整：55→28 · 80→40）· 装推进器亦可隐身 · ` +
      `其余 ${SHIPS.length - SCOUTS.length} 艘船一律不带（实测多带 0 件）· 装置限制说明已改写`,
  )
}

/* ── B3.1 敌群特色回收池（2026-09-08 收尾：池均价 ÷ 档基数 ∈ 保底乘数 m ±3%）
 *   公式（docs/design/b3-flavor-content.md）：m = mSec(≤1.45) × mThreat(≤1.30)，
 *   mSec = 1 + 0.45×max(0,−sec)；mThreat = 1 + 0.004×threat；档基数 = RECYCLE_POOL_AVG_ISK[tier] */
{
  const ctx = buildSimContext()
  let flavored = 0
  for (const def of ANOMALIES_FLAVORED) {
    if (!def.recyclePool || def.recyclePool.length === 0) continue
    flavored += 1
    const galaxy = ctx.galaxies.get(def.galaxyId)
    const sec = typeof galaxy?.security === 'number' && Number.isFinite(galaxy.security) ? galaxy.security : 0.5
    const mSec = Math.min(1.45, 1 + 0.45 * Math.max(0, -sec))
    const mThreat = Math.min(1.3, 1 + 0.004 * (def.threat ?? 0))
    const m = mSec * mThreat
    const pool = def.recyclePool
    const wSum = pool.reduce((s, [, w]) => s + w, 0)
    let avg = 0
    let missing: string | null = null
    for (const [id, w] of pool) {
      const item = ctx.items.get(id)
      if (!item || (item.baseSellPriceIsk ?? 0) <= 0) {
        missing = missing ?? `池矿物 ${id} 缺失或价格非法`
        continue
      }
      avg += (w / wSum) * item.baseSellPriceIsk!
    }
    const tier = recycleTierOf(wreckBaseDensity(def.galaxyId, ctx))
    const base = RECYCLE_POOL_AVG_ISK[tier]
    const ratio = avg / base
    const dev = ((ratio - m) / m) * 100
    check(
      missing === null && Math.abs(dev) <= 3,
      `B3.1 ${def.name}（${def.id}）特色池校验失败：${missing ?? `池均价 ${avg.toFixed(2)} ÷ 档基数 ${base} = ${ratio.toFixed(3)}，目标 m=${m.toFixed(3)}（偏差 ${dev.toFixed(1)}% > ±3%）`}`,
    )
    // 2026-09-14 船长：「在所有残骸的回收里，添加钛钢合金。已有钛钢合金的不做改变。」
    // ⇒ **每一张特色池都必须含钛钢**（档位基础池由下面的 B3.2 契约覆盖）
    check(
      pool.some(([id]) => id === 'min-tritanium'),
      `B3.1 ${def.name}（${def.id}）特色池缺钛钢合金（船长 2026-09-14：所有残骸回收都要能出钛钢）`,
    )
  }
  check(flavored >= 21, `B3.1 特色池卡数应为 21，实际 ${flavored}`)
  console.log(`· B3.1 特色回收池：${flavored} 张（约束：池均价 = m × 档基数 ±3% · **每池必含钛钢合金** · 占比 ≥40% 见 B3.3）`)

  /* ── B3.2 档位基础池（2026-09-14 船长「所有残骸回收都加钛钢」）：
   *   ① 三档基础池**都必须含钛钢合金**（常驻档本来就有，险/危同批补入）；
   *   ② 基础池均价必须等于档基数 `RECYCLE_POOL_AVG_ISK`（±3%）——两条互为单点，改池必同步改常量。 */
  for (const tier of ['common', 'risky', 'dire'] as const) {
    const pool = RECYCLE_POOLS[tier]
    check(
      pool.some(([id]) => id === 'min-tritanium'),
      `B3.2 ${tier} 档基础池缺钛钢合金（船长 2026-09-14：所有残骸回收都要能出钛钢）`,
    )
    const wSum = pool.reduce((s, [, w]) => s + w, 0)
    const avg = pool.reduce((s, [id, w]) => s + (w / wSum) * (ctx.items.get(id)?.baseSellPriceIsk ?? 0), 0)
    const dev = ((avg / RECYCLE_POOL_AVG_ISK[tier] - 1) * 100)
    check(
      Math.abs(dev) <= 3,
      `B3.2 ${tier} 档基础池均价 ${avg.toFixed(2)} 与档基数 ${RECYCLE_POOL_AVG_ISK[tier]} 偏差 ${dev.toFixed(1)}% > ±3%`,
    )
  }
  console.log(
    `· B3.2 档位基础池：三档均含钛钢合金 · 均价 = 档基数（常 ${RECYCLE_POOL_AVG_ISK.common} / 险 ${RECYCLE_POOL_AVG_ISK.risky} / 危 ${RECYCLE_POOL_AVG_ISK.dire}）`,
  )

  /* ── B3.3 钛钢占比下限（2026-09-14 船长第二批「提高钛钢占比到 40~60」+ 三答：
   *   **只提不降 · 统一 40% · 均价不变**）⇒ 三档基础池 + 每一张特色池的钛钢**权重占比都 ≥40%**；
   *   已有 65~80% 的池按"只提不降"原样保持（区间上限不是硬闸，硬闸只有下限 40%）。 */
  {
    const shares: { name: string; share: number }[] = []
    const shareOf = (pool: ReadonlyArray<readonly [string, number]>): number => {
      const wSum = pool.reduce((s, [, w]) => s + w, 0)
      return pool.filter(([id]) => id === 'min-tritanium').reduce((s, [, w]) => s + w, 0) / wSum
    }
    for (const tier of ['common', 'risky', 'dire'] as const) shares.push({ name: `档位基础池·${tier}`, share: shareOf(RECYCLE_POOLS[tier]) })
    for (const def of ANOMALIES_FLAVORED) {
      if (!def.recyclePool || def.recyclePool.length === 0) continue
      shares.push({ name: `${def.id}`, share: shareOf(def.recyclePool) })
    }
    let min = shares[0]!
    for (const s of shares) {
      if (s.share < min.share) min = s
      check(
        s.share >= 0.4,
        `B3.3 ${s.name} 钛钢价值占比 ${(s.share * 100).toFixed(1)}% < 40%（船长 2026-09-14：提高钛钢占比到 40~60 ⇒ 只提不降、统一 40%；2026-09-14 二次改判后**池权重即价值占比**）`,
      )
    }
    console.log(`· B3.3 钛钢价值占比下限：${shares.length} 个池（3 档基础池 + ${shares.length - 3} 张特色池）全部 ≥40%（最低 = ${min.name} ${(min.share * 100).toFixed(1)}%；池权重＝价值占比）`)
  }
  // 残骸收购卡价格锚（2026-09-08 船长定 + 当日修正）：收价 < 无技能拆解保底（≈57/m³，三档齐平），
  // 且与档位表一致（常 30 / 险 40 / 危 50，≈该档典型特色回收的五成上下）
  const wreckBuyPrice = { common: 30, risky: 40, dire: 50 }
  const noSkillPerM3 = 82_000 / 1_440
  for (const g of WRECK_BUY_GOODS) {
    const anoId = g.refId.startsWith('wreck-') ? g.refId.slice('wreck-'.length) : ''
    const def = ANOMALIES_FLAVORED.find((a) => a.id === anoId)
    const sec = typeof ctx.galaxies.get(def?.galaxyId ?? '')?.security === 'number' ? ctx.galaxies.get(def!.galaxyId)!.security! : 0.5
    const density = Math.min(40, Math.max(10, Math.round(10 + 15 * (1 - sec))))
    const tier = density >= 30 ? 'dire' : density >= 20 ? 'risky' : 'common'
    check(g.basePrice === wreckBuyPrice[tier], `残骸卡 ${g.key} 价格档错位：期望 ${wreckBuyPrice[tier]}（${tier}），实际 ${g.basePrice}`)
    check(g.basePrice < noSkillPerM3, `残骸卡 ${g.key} 收价 ${g.basePrice} 不低于无技能拆解保底 ${noSkillPerM3.toFixed(1)}/m³——会击穿回收线最低锚`)
    check(g.playerBuyable === false, `残骸卡 ${g.key} 必须只收不卖（playerBuyable=false）`)
  }
  console.log(`· 残骸收购卡：${WRECK_BUY_GOODS.length} 张（收价 = 常 30 / 险 40 / 危 50 ISK·m³，须低于无技能拆解保底）`)
  // 2026-09-08 船长定稿：①主题彩头（recycleLoot 追加件）只允许 sec < 0.5 星系；
  // ②主题追加件不得含武器（炮/激光/导弹架），唯一例外 = 穹顶守卫门槛线追加三把 MK3 武器；
  // ③MK3 一律走碎片，穹顶守卫 × {三把 MK3 武器} 为唯一 MK3 直出白名单
  const weaponIds = new Set(MODULES.filter((m) => m.slot === 'turret' || m.slot === 'laser' || m.slot === 'missile').map((m) => m.id))
  const mk3Weapons = ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3']
  let lootCards = 0
  for (const def of ANOMALIES_FLAVORED) {
    const loot = def.recycleLoot
    if (!loot || (!loot.modules?.length && !loot.mk2?.length)) continue
    lootCards += 1
    const galaxy = ctx.galaxies.get(def.galaxyId)
    const sec = typeof galaxy?.security === 'number' && Number.isFinite(galaxy.security) ? galaxy.security : 0.5
    check(sec < 0.5, `B3.1 主题彩头仅限 sec<0.5 星系：${def.name}（${def.galaxyId}）sec=${sec}`)
    // 2026-09-12 船长裁定（「档位**仍逐卡手写**，但**加断言拦住**」）：档位必须与所在星系的**安全分区**一致——
    // 中安（0 < sec < 0.5）只允许 `modules`（直出基础池追加件）、低安（sec ≤ 0）只允许 `mk2`
    // （低安门槛 MK2 池追加件）。**为什么需要**：2026-09-11 船长互换安全等级时，两张卡的档位是
    // **靠人手改的**（`ano-mirage-hijackers` 中安→低安、`ano-cinder-siege` 低安→中安）⇒ 改漏了没人拦。
    // ⚠ 分区读 `securityZoneOf`（**单一出处**），不在这里重算边界。
    const lootZone = securityZoneOf(ctx, def.galaxyId)
    if ((loot.modules?.length ?? 0) > 0) {
      check(
        lootZone === '中安',
        `B3.1 主题件档位与星系分区不符：${def.name}（${def.galaxyId}，${lootZone}）挂了**中安档** modules——` +
          `中安档只用于 0 < sec < 0.5 的星系；低安（sec ≤ 0）须改用 mk2`,
      )
    }
    if ((loot.mk2?.length ?? 0) > 0) {
      check(
        lootZone === '低安',
        `B3.1 主题件档位与星系分区不符：${def.name}（${def.galaxyId}，${lootZone}）挂了**低安档** mk2——` +
          `低安档只用于 sec ≤ 0 的星系；中安（0 < sec < 0.5）须改用 modules`,
      )
    }
    for (const group of ['modules', 'mk2'] as const) {
      for (const id of loot[group] ?? []) {
        const isMk3 = id.endsWith('-3')
        const vaultMk3 = def.id === 'ano-vault-sentinel' && mk3Weapons.includes(id)
        check(!isMk3 || vaultMk3, `B3.1 MK3 直出收口失败：${def.name} 主题件 ${id}（MK3 一律走碎片，唯一白名单 = 穹顶守卫 × 三把 MK3 武器）`)
        check(!weaponIds.has(id) || vaultMk3, `B3.1 武器移出主题失败：${def.name} 主题追加件 ${id} 是武器（主题只放增幅装备；唯一武器例外 = 穹顶守卫三把 MK3）`)
      }
    }
  }
  console.log(`· B3.1 主题追加件：${lootCards} 张卡（sec<0.5 增幅件；武器白名单仅穹顶守卫 × MK3 三武）`)
}

/* ── 远端衰减取值域契约（2026-09-12 审计 B1 加）──
 * **为什么需要**：`beamPowerFactor`（能量**威力**衰减）与 `distFactor`（动能/爆炸**命中**衰减）原本是
 * 两份**逐字相同**的实现，前者只多一层 `Math.max(0, …)`；而该层在 **`falloff ∈ [0,1]`** 时**恒不生效**
 * （`t` 已 clamp 到 `[0,1]` ⇒ `1 − t(1−falloff) ≥ falloff ≥ 0`）。两条已合并为一条（`beamPowerFactor`
 * 改为委托 `distFactor`），**本契约就是那个前提的守卫**：任何一处 `falloff` 越出 [0,1]，合并即不再等价
 * （会静默产生负命中/负威力）⇒ 直接报错。 */
{
  let ffChecked = 0
  const badFf: string[] = []
  const chkFf = (where: string, v: number | undefined): void => {
    if (v === undefined) return
    ffChecked += 1
    if (!(v >= 0 && v <= 1)) badFf.push(`${where} = ${v}`)
  }
  for (const m of MODULES) chkFf(`装备 ${m.id}`, m.falloff)
  for (const s of FOE_SHIPS) chkFf(`敌舰级 ${s.id}`, s.falloff)
  for (const d of FOE_DRONES) chkFf(`敌机 ${d.id}`, d.falloff)
  for (const d of DRONES) chkFf(`我方无人机 ${d.id}`, d.falloff)
  for (const def of ANOMALIES_FLAVORED) {
    for (const slot of def.ships ?? []) chkFf(`卡 ${def.id} 的条目「${slot.ship.name}」`, slot.falloff)
  }
  chkFf('balance.battle.foeFalloff', DEFAULT_BALANCE.battle.foeFalloff)
  for (const b of badFf) {
    check(false, `远端衰减取值域：${b}——须落在 [0,1]（越界会作废「beamPowerFactor ≡ distFactor」的合并前提）`)
  }
  console.log(
    `· 远端衰减取值域：${ffChecked} 处 falloff ` +
      (badFf.length === 0
        ? '全部落在 [0,1]（beamPowerFactor ≡ distFactor 的合并前提）'
        : `有 ${badFf.length} 处越界（见上方错误）`),
  )
}

/* ── 敌方混伤契约（2026-09-10 船长定）──
 * ①**除教学卡与纯能量卡外**每张敌军卡必须写**两系** `dmgMix`（主 8 : 副 2 = 80%/20%）——
 *   教学卡（演习场讨伐令）保持纯系：不给新手第一场上混伤；
 *   纯能量卡（2026-09-10 船长：**深渊之门卫队改为纯能量伤害**）允许只写一系 `plasma`，
 *   但**必须同时显式给 `foeFalloff`**（能量走 `beamPowerFactor` 威力衰减，纯能量卡的火力只能靠它收住）；
 * ②副系必须 = 该敌族签名副系序里第一个"不与主系相同"的系（`lairs.subDamageTypeOf`）；
 * ③窝点派生卡（`lairAnomalyOf`）= 同一主系 + **6:4**（60%/40%）；主系**不许变**；
 * ④**E 族特例**（2026-09-11 船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」）：
 *   泰坦巨构全族 = **50% 动能 + 50% 爆炸**（族格「动能 + 爆炸为主」的对称落点）⇒
 *   **常驻卡与窝点派生卡一律 5:5**（窝点**不套 6:4**——族级特例优先于'窝点比悬赏更混'的一般口径）。 */
{
  const TEACHING_CARD = 'ano-training'
  let mixed = 0
  let pureBeam = 0
  /** 「舰级口径优先」白名单计数（船长 2026-09-15） */
  let whitelisted = 0
  /** E 族特例（5:5）计数——见下方 ④ */
  let symmetric = 0
  const positive = (mix: Partial<Record<string, number>> | undefined): Array<[string, number]> =>
    Object.entries(mix ?? {}).filter(([, v]) => typeof v === 'number' && v > 0) as Array<[string, number]>
  for (const def of ANOMALIES_FLAVORED) {
    if (def.id === TEACHING_CARD) {
      check(positive(def.dmgMix).length <= 1, `混伤契约：教学卡 ${def.id} 应保持纯系（不写两系 dmgMix）`)
      continue
    }
    const rows = positive(def.dmgMix)
    // 纯能量特例（2026-09-10 船长：深渊之门卫队改纯能量；2026-09-11 裁定⑤放宽）：
    // 单系 plasma 合法，但**必须有"收束旋钮"**——远端不许既必中又不衰减：
    // - **旧威胁推导路径**：必须**显式给 `foeFalloff`**（能量走 `beamPowerFactor` 威力衰减，写缺省 0.30 太轻）；
    // - **舰级路径**（2026-09-11 裁定⑤「能量·掷命中」档后）：放宽为「**衰减或命中任给其一**」——
    //   掷命中形态下"命中随距离衰减 + 消费 hitRate"本身就是收束旋钮。契约据此**要求显式声明形态**：
    //   `energyForm: 'spit'`（掷命中）⇒ 必须 `hitRate < 1`（掷命中的意义就是有掷的成分）；
    //   缺省 / `'beam'`（必中光束）⇒ 必须显式收紧 `falloff`（≤ 缺省 0.5，不许宽于全局默认）。
    if (rows.length === 1 && rows[0]![0] === 'plasma') {
      const pureShips = [...new Map((def.ships ?? []).map((s) => [s.ship.id, s.ship])).values()]
      if (pureShips.length > 0) {
        for (const ship of pureShips) {
          check(
            ship.energyForm !== undefined,
            `混伤契约：纯能量卡 ${def.name} 引用的舰级「${ship.name}」未显式声明 energyForm——` +
              `纯能量必须有收束旋钮：'spit'（能量掷命中：掷命中 + 命中随距离衰减）或 'beam'（必中光束，须收紧 falloff）`,
          )
          if (ship.energyForm === 'spit') {
            check(
              ship.hitRate < 1,
              `混伤契约：纯能量卡 ${def.name} 的舰级「${ship.name}」声明了 'spit'（能量掷命中）却给 hitRate ${ship.hitRate}——` +
                `掷命中形态须给小于 1 的命中率（否则与"必中"无异、收束旋钮形同虚设）`,
            )
          } else {
            check(
              ship.falloff <= 0.5,
              `混伤契约：纯能量卡 ${def.name} 的舰级「${ship.name}」走必中光束却给了 falloff ${ship.falloff}——` +
                `必中光束的远端收束只能靠 falloff，须不宽于全局缺省 0.5`,
            )
          }
        }
      } else {
        check(
          def.foeFalloff !== undefined,
          `混伤契约：纯能量卡 ${def.name} 必须显式给 foeFalloff（远端威力衰减，缺省 0.30 太轻）`,
        )
      }
      pureBeam += 1
      continue
    }
    // **④b「舰级口径优先」白名单**（船长 2026-09-15：「**撞到的契约开白名单**」）——
    // 主体舰级登记了自有构成口径的卡（D 族战列舰 6:4 · E 族导弹残段纯爆炸，见 `FOE_SHIP_MIX_AUTHORITY_IDS`）：
    // 卡面按"**与主体一致**"校验，**不套**通用主 8 副 2、也不套 E 族 5:5。
    // ⚠ 放行的只是"不必等于 8:2 / 5:5"——卡面写错（与主体不符）照样红。
    const mixKey = (m?: Partial<Record<string, number>>): string =>
      Object.entries(m ?? {})
        .filter(([, v]) => (v ?? 0) > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',')
    {
      const mains = (def.ships ?? []).filter((s) => s.escort !== true)
      const authority = new Set<string>(FOE_SHIP_MIX_AUTHORITY_IDS)
      if (mains.length > 0 && mains.every((s) => authority.has(s.ship.id))) {
        const eff = mixKey(mains[0]!.dmgMix ?? mains[0]!.ship.dmgMix)
        check(
          mixKey(def.dmgMix) === eff,
          `混伤白名单：${def.name} 的卡面构成（${mixKey(def.dmgMix)}）与主体舰级「${mains[0]!.ship.name}」的有效构成（${eff}）不一致——` +
            `白名单只放行"不必等于 8:2/5:5"，卡面仍须与主体逐键一致`,
        )
        // **纯系卡必须留"收束旋钮"**（与纯能量分支同款纪律）：单系卡只有靠"掷命中 + 命中 < 1"
        // 收住远端收益；必中光束 + 无衰减 = 既必中又满效，等于没有约束。
        const keys = Object.keys(def.dmgMix ?? {}).filter((k) => ((def.dmgMix ?? {}) as Record<string, number>)[k]! > 0)
        if (keys.length === 1) {
          const ship = mains[0]!.ship
          check(
            ship.energyForm !== 'beam' && ship.hitRate < 1,
            `混伤白名单：纯系卡 ${def.name} 的主体「${ship.name}」必须留收束旋钮` +
              `（掷命中 + 命中 < 1；实测 energyForm=${String(ship.energyForm)} / hitRate=${ship.hitRate}）`,
          )
        }
        whitelisted += 1
        continue
      }
    }
    // **④ E 族特例**（2026-09-11 船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」）：
    // 泰坦巨构全族 = **50% 动能 + 50% 爆炸**（族格「动能 + 爆炸为主」的对称落点）——
    // **常驻卡与窝点派生卡一律 5:5**（窝点不套 6:4：族级特例优先于"窝点比悬赏更混"的一般口径）。
    if (def.foeFamily === 'E') {
      const w = new Map(rows)
      check(
        rows.length === 2 && w.get('kinetic') === 5 && w.get('explosive') === 5,
        `混伤契约：E 族（泰坦巨构）${def.name} 应写 **50% 动能 + 50% 爆炸**（\`{ kinetic: 5, explosive: 5 }\`）——` +
          `船长 2026-09-11「**E 族单独调整，包括 E 族赏金任务的伤害比例**」；实际 ${JSON.stringify(def.dmgMix)}`,
      )
      const eLair = lairAnomalyOf(def, 3)
      const eRows = positive(eLair.dmgMix)
      check(
        eRows.length === 2 && eRows.every(([, v]) => v === 5),
        `混伤契约：E 族 ${def.name} 的**窝点派生卡**应同为 5:5（不套全局 6:4），实际 ${JSON.stringify(eLair.dmgMix)}`,
      )
      symmetric += 1
      continue
    }
    check(rows.length === 2, `混伤契约：${def.name} 应写两系 dmgMix（主 8 : 副 2），实际 ${rows.length} 系`)
    if (rows.length !== 2) continue
    const sorted = [...rows].sort((a, b) => b[1] - a[1])
    check(sorted[0]![1] === 8 && sorted[1]![1] === 2, `混伤契约：${def.name} 权重应为主 8 : 副 2，实际 ${sorted[0]![1]}:${sorted[1]![1]}`)
    const main = sorted[0]![0] as DamageType
    const sub = sorted[1]![0] as DamageType
    check(
      sub === subDamageTypeOf(def, main),
      `混伤契约：${def.name} 副系 ${sub} 与族签名序列不符（应为 ${subDamageTypeOf(def, main)}）`,
    )
    // 窝点派生：同主系 + 6:4
    const lair = lairAnomalyOf(def, 3)
    const lRows = positive(lair.dmgMix)
    const lSorted = [...lRows].sort((a, b) => b[1] - a[1])
    check(
      lRows.length === 2 && lSorted[0]![1] === 6 && lSorted[1]![1] === 4 && (lSorted[0]![0] as DamageType) === main,
      `混伤契约：${def.name} 窝点派生应为同一主系 ${main} + 副系 6:4，实际 ${JSON.stringify(lair.dmgMix)}`,
    )
    mixed += 1
  }
  console.log(
    `· 敌方混伤契约：${mixed} 张敌军卡主 8 : 副 2（窝点派生 6:4、主系不变）；教学卡保持纯系` +
      `${symmetric > 0 ? `；**E 族特例 ${symmetric} 张 50% 动能 + 50% 爆炸**（窝点派生同值，不套 6:4）` : ""}` +
      `${pureBeam > 0 ? `；纯能量卡 ${pureBeam} 张（单系 plasma + 收束旋钮：舰级路径须显式 energyForm，旧路径须显式 foeFalloff）` : ""}` +
      `${whitelisted > 0 ? `；**舰级口径优先** ${whitelisted} 张（船长 2026-09-15「撞到的契约开白名单」：卡面 = 主体构成，不套 8:2/5:5）` : ""}`,
  )

  /* ── 敌速口径契约（2026-09-10 加）──
   * 船长 2026-09-10 裁决「采取固定锚定，参考按照速度中位线的船只进行参考」：
   *   基准船 = 船池按 maxSpeedMps 排序取中位（长尾鲨级 272 / 敏捷 0.54）
   *   基准战斗机动 = 船速 × speedFactor ×(1+(敏捷−0.5)×2×agilitySpeedBonus) ≈ 165.2 m/s
   *   比率 = 敌战斗机动 ÷ 基准战斗机动，其中敌战斗机动 = foeSpeedMps × speedFactor × 0.94（敌敏捷固定 0.3）
   * 契约：① 每张敌军卡必须**逐卡显式**写 foeSpeedMps（防止新增卡悄悄回落到段参考船旧公式口径）；
   *       ② 比率必须落在该战术口径带内（brawl 1.05~1.55 / orbit 0.90~1.25 / kite 0.60~0.85）。
   *
   * ⚠ **A 族例外（2026-09-11 数值落地批，船长确认「A 族速度都快（方便突袭）」）**——
   * 海盗族舰级路径卡**不受旧"战术比率带"约束**：旧带锚定"中位玩家船"，其中 kite 带 0.60~0.85
   * 与船长「劫掠团也跑得快、方便突袭」的设定**直接冲突**（狙击舰新实速 325 比率 ≈1.11）。
   * 该族改按**族口径**校验：**实速必须高于本档舰种基准**（护卫 340 / 驱逐 295 / 巡洋 258）
   * 且比率落在**全族提速带 1.00~1.60**（下限 = "比基准船快"，上限防失控）。
   * 其余族（非 A）舰级路径卡仍按上面的战术带；旧路径卡（未写 ships）一律不变。 */
  {
    const bal = DEFAULT_BALANCE.battle
    const agiMul = (ag: number): number => bal.speedFactor * (1 + (ag - 0.5) * 2 * bal.agilitySpeedBonus)
    const sortedShips = [...SHIPS].sort((a, b) => (a.maxSpeedMps ?? 0) - (b.maxSpeedMps ?? 0))
    // ⚠ **2026-09-12（工具更新批）：基准船由"船池中位"改为"固定锚定"**——
    //   船长 2026-09-10 的原话就是「采取**固定锚定**，参考按照速度中位线的船只进行参考」，
    //   但实现取的是"每次按当前船池重算的中位"⇒ **船池一变、尺子就跟着动**：
    //   本轮新增两具 T4/T5 壳体后，中位从**长尾鲨级**滑到**锤头鲨级**，
    //   基准战斗机动 **165.2 → 160.8 m/s（−2.7%）**，把「围攻残兵舰」从 ≤1.25 顶到边界外
    //   ⇒ 与敌人数值无关的**契约假报警**（实测：改动前全绿、改动后 2 红）。
    //   现按"固定锚定"钉死到裁决当时的中位船（长尾鲨级），并把回退写清。
    const refShip =
      SHIPS.find((s) => s.name.startsWith('长尾鲨')) ?? sortedShips[Math.floor(sortedShips.length / 2)]!
    const refCombat = (refShip.maxSpeedMps ?? 0) * agiMul(refShip.agility ?? 0.5)
    const foeAgi = agiMul(0.3)
    const SPEED_BAND: Record<string, readonly [number, number]> = {
      brawl: [1.05, 1.55],
      orbit: [0.9, 1.25],
      kite: [0.6, 0.85],
    }
    /** A 族（海盗）全族提速带：下限 = 快于基准船，上限防失控（船长 2026-09-11 裁定） */
    const PIRATE_SPEED_BAND: readonly [number, number] = [1.0, 1.6]
    /** B 族（武装拾荒者）**全族慢速带**（船长 2026-09-11「速度偏慢」→ 裁决「B 族速落实 0.8」）：
     *  上限 1.00 = **慢于基准船**（"偏慢"的可验证表达）；下限 **0.75** 防失控（防被调到极慢变成"玩家白嫖"）。
     *  取值与三号 `handover-faction-b-20260911.md` §三 登记的 B 族偏慢带 **0.75~1.00×** 对齐。
     *  **必须用族级带、不能用战术带**：orbit 常规带 0.90~1.25 与"全族慢速"冲突（0.80 口径下拾荒火力舰 0.81× 会被误拦）。 */
    const SCAV_SPEED_BAND: readonly [number, number] = [0.75, 1.0]
    /** C 族（异形生物）**全族提速带**（船长 2026-09-11 裁定②：「**C 族速度比 A 海盗还快**」）：
     *  - **倍率口径**（设计稿表格的"倍率"列，即 `speedRatio`）：**1.30~2.10**——四档实测 1.35 / 1.60 / 1.62 / 1.65；
     *  - **基准船比率口径**（与 A / B 族同度量，见下）：**1.30~2.10**，**T4 巨兽豁免**
     *    （船长裁定③：「允许 T4 战列舰（生物巨兽）；**T4 例外允许慢**」——噬口巨兽 328 m/s 比率 ≈1.12）；
     *  - **横向断言**：**同档实速必须高于 A 族同档最快舰级**（A 族无 T4 ⇒ T4 只做白名单登记校验）。 */
    const ALIEN_SPEED_RATIO_BAND: readonly [number, number] = [1.3, 2.1]
    const ALIEN_SPEED_BAND: readonly [number, number] = [1.3, 2.1];
    /** D 族（守墓古舰）**族格速带**（船长 2026-09-11 亲定「幽灵舰 1.10 · 守墓长舰 1.00 · 静滞卫舰 0.50」
     *  ⇒ 族格读法 = **越往里越慢**，实测比率 **0.44 / 0.88 / 1.11**）：
     *  带取 **0.40~1.15×**——下限要吃下'半速的静滞卫舰'（0.44），上限略高于'提速的幽灵舰'（1.11）。
     *  ⚠ **必须用族级带、不能用战术带**：kite 常规带 0.60~0.85 会把 0.44× **误拦**（与 B 族 0.81× 同款教训）。 */
    const GRAVE_SPEED_BAND: readonly [number, number] = [0.4, 1.15];
    /**
     * **E 族（泰坦巨构）族格速带**（2026-09-11 机群批 · 船长裁定「族速带 0.65~0.95 × 本档基准」；
     * **同日终裁**「**族速度倍率设为 0**。依靠无人机攻击炮台范围外敌人」⇒ 下限放开到 **0**）。
     * 族格 = **巨构不讲机动，只讲撑到最后**（'还在跑的老机器'；速度 0 = **静物残骸**，火力由机群投送）
     * ——全族**实速不高于本档舰种基准**（`speedRatio ≤ 1`）。带取 **0~0.90×**（比率 = 实速 × 敌敏捷 ÷
     * 基准船战斗机动，与 A/B/C/D 同一口径）：下限 0 是'静物'这一族级口径的落点，上限吃下族内任何
     * 非零速度（历史顶格 = T4 × 0.95 = 195 ⇒ 0.67×）。
     * ⚠ **必须用族级带、不能用战术带**：brawl 常规带 1.05~1.55 会把慢的巨构**误拦**（与 B/D 同款教训）。
     */
    const TITAN_SPEED_BAND: readonly [number, number] = [0, 0.9]
    /** A 族各档**最快实速**（横向对照用；从舰级表现算，不手抄数字） */
    const pirateFastestByTier = new Map<number, number>()
    for (const ship of FOE_SHIPS) {
      if (ship.family !== 'A') continue
      const spd = Math.round(HULL_CLASS_BASE_SPEED[ship.hullClassTier] * ship.speedRatio)
      pirateFastestByTier.set(ship.hullClassTier, Math.max(pirateFastestByTier.get(ship.hullClassTier) ?? 0, spd))
    }
    let speedCounted = 0
    let speedShipPath = 0
    let pirateReadings = 0
    const pirateSample: string[] = []
    let alienReadings = 0
    const alienSample: string[] = []
    let graveReadings = 0
    const graveSample: string[] = []
    let swarmReadings = 0
    const swarmSample: string[] = []
    let titanReadings = 0
    const titanSample: string[] = []
    let scavReadings = 0
    const scavSample: string[] = []
    for (const def of ANOMALIES_FLAVORED) {
      // 舰级路径（2026-09-11）：速度由**舰级登记值**决定，故不再要求逐卡 foeSpeedMps；
      // 改按"该卡实际会建出的单位速度"（非僚机编成条目）校验比率。
      const mains = (def.ships ?? []).filter((s) => s.escort !== true)
      if (mains.length > 0) {
        speedShipPath++
        for (const slot of mains) {
          // 2026-09-11 追加裁决：舰级速度改登记「舰种档 + 倍率」→ 实速 = 舰种基准 × 倍率 × 条目 speedMul
          const base = HULL_CLASS_BASE_SPEED[slot.ship.hullClassTier]
          const spd = Math.round(base * slot.ship.speedRatio * (slot.speedMul ?? 1))
          const tactic = slot.tactic ?? slot.ship.tactic
          const ratio = (spd * foeAgi) / refCombat
          // ⚠ **旧 hidden 遭遇模板豁免族级提速带**（2026-09-12 加）：`enc-pirate-1..4` 归属 A 族
          //   （F 族废弃并入）但属**旧档兜底模板**，其速度是"迁移守恒"来的（`speedMul` 反算回迁移前实速
          //   281 / 291 / 394 / 418）⇒ 不套 A 族"每档都高于基准"的设计口径。
          // ⚠ **2026-09-16 收窄豁免**：原判据写成 `def.hidden !== true` ⇒ 把**洞内三张 A 族卡**
          //   （`wh-pirate-*` 也标了 hidden）一起豁免了 ⇒ 它们的护卫舰被条目 `speedMul 0.9` 压到
          //   **337 < 本档基准 340** 却全绿（船长 2026-09-16「海盗的平均速度好像有些太慢」）。
          //   现只豁免**迁移守恒反算**的那四个旧模板（按 id 前缀认），洞内 A 族卡从此受同一口径约束。
          if (def.foeFamily === 'A' && !def.id.startsWith('enc-')) {
            // A 族口径（见上方⚠）：高于本档舰种基准 + 落在全族提速带
            pirateReadings++
            pirateSample.push(`${def.id}/${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              spd > base,
              `敌速口径契约：A 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未高于本档舰种基准 ${base} m/s**——` +
                `船长 2026-09-11 裁定 A 族「速度都快（方便突袭）」，每档都必须高于基准（护卫 340 / 驱逐 295 / 巡洋 258）`,
            )
            check(
              ratio >= PIRATE_SPEED_BAND[0] && ratio <= PIRATE_SPEED_BAND[1],
              `敌速口径契约：A 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出全族提速带 ` +
                `${PIRATE_SPEED_BAND[0]}~${PIRATE_SPEED_BAND[1]}×（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'B') {
            // **B 族（武装拾荒者）口径**（船长 2026-09-11：「**速度偏慢**」→ 裁决「**B 族速落实 0.8**」）：
            // ①族级硬口径 = **实速必须低于本档舰种基准**（`speedRatio < 1`）——与倍率口径无关，恒成立；
            // ②比率按 **B 族专用慢速带 `SCAV_SPEED_BAND = 0.75~1.00×`**（= **慢于基准船**）校验。
            //   实测读数：拾荒武装艇 272（**0.93×**）、拾荒火力舰 236（**0.81×**）。
            // ⚠ **为什么不用战术带**：战术带（orbit 0.90~1.25×）描述的是"普通 orbit 单位的机动区间"，
            //   与"**全族慢速**"这一族级口径**直接冲突**——0.80 口径下拾荒火力舰 236 m/s ⇒ 比率 **0.81×**
            //   会被 orbit 带**误拦**（本批实测踩到）。族级口径必须用族级带表达。
            scavReadings++
            scavSample.push(`${def.id}/${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              spd < base,
              `敌速口径契约：B 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未低于本档舰种基准 ${base} m/s**——` +
                `船长 2026-09-11 裁定「**速度偏慢**」（倍率须 < 1）`,
            )
            check(
              ratio >= SCAV_SPEED_BAND[0] && ratio <= SCAV_SPEED_BAND[1],
              `敌速口径契约：B 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**全族慢速带** ` +
                `${SCAV_SPEED_BAND[0]}~${SCAV_SPEED_BAND[1]}×（船长「速度偏慢」；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'C') {
            // **C 族（异形生物）口径**（船长 2026-09-11 裁定②「C 族速度比 A 海盗还快」+ 裁定③「T4 例外允许慢」）：
            // ①倍率口径（speedRatio）落全族提速带 1.30~2.10；②基准船比率口径同带，**T4 巨兽豁免**；
            // ③**同档实速必须高于 A 族同档最快舰级**（A 族无 T4 档 ⇒ 只做巨兽白名单登记校验）。
            // ⚠ **2026-09-16 追加例外**（船长「**孢群异虫速度削减到300**」）：无人机母舰不追人
            //   ⇒ 登记在 `ALIEN_SLOW_SHIP_IDS` 的舰级**豁免这三条**（照"T4 允许慢"先例），并**反查**
            //   "它确实低于族格要求"——防白名单变成随手减速的口子。
            const tier = slot.ship.hullClassTier
            if (alienSample.some((s) => s.startsWith(`${slot.ship.id} `))) continue // 同一舰级被多条编成引用时只校验一次
            alienReadings++
            const slowOk = ALIEN_SLOW_SHIP_IDS.includes(slot.ship.id)
            alienSample.push(
              `${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})` + (slowOk ? '【允许慢】' : ''),
            )
            if (slowOk) {
              const aFast = pirateFastestByTier.get(tier)
              check(
                slot.ship.speedRatio < ALIEN_SPEED_RATIO_BAND[0] || (aFast !== undefined && spd <= aFast),
                `敌速口径契约：C 族「${slot.ship.name}」登记在**允许慢白名单**里，但速度并未低于族格要求` +
                  `（倍率 ${slot.ship.speedRatio.toFixed(2)}× vs 带下限 ${ALIEN_SPEED_RATIO_BAND[0]}×` +
                  `${aFast !== undefined ? ` · 同档 A 族最快 ${aFast} m/s` : ''}）`,
              )
              continue
            }
            check(
              slot.ship.speedRatio >= ALIEN_SPEED_RATIO_BAND[0] && slot.ship.speedRatio <= ALIEN_SPEED_RATIO_BAND[1],
              `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」倍率 ${slot.ship.speedRatio.toFixed(2)}× 越出**全族提速带** ` +
                `${ALIEN_SPEED_RATIO_BAND[0]}~${ALIEN_SPEED_RATIO_BAND[1]}×（船长裁定②「C 族速度比 A 海盗还快」）`,
            )
            if (tier === 4 || tier === 5) {
              check(
                ALIEN_BEAST_SHIP_IDS.includes(slot.ship.id),
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」登记了 T${tier} 档却不在**巨兽白名单**` +
                  `（ALIEN_BEAST_SHIP_IDS）——船长裁定③只允许「生物巨兽」用 T4，且**允许慢**（本档免比率校验）`,
              )
            } else {
              check(
                ratio >= ALIEN_SPEED_BAND[0] && ratio <= ALIEN_SPEED_BAND[1],
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**全族提速带** ` +
                  `${ALIEN_SPEED_BAND[0]}~${ALIEN_SPEED_BAND[1]}×（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
              )
            }
            const aFastest = pirateFastestByTier.get(tier)
            if (aFastest !== undefined) {
              check(
                spd > aFastest,
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未高于 A 族同档最快** ${aFastest} m/s——` +
                  `船长裁定②「**C 族速度比 A 海盗还快**」（同档必须更快；T4 巨兽例外不在此列）`,
              )
            }
            continue
          }
          if (def.foeFamily === 'D') {
            // **D 族（守墓古舰）口径**（船长 2026-09-11 三次亲定：档位「**1 驱逐 2 巡洋**」/ 战法「**静滞卫舰远程、
            // 幽灵舰中程**」/ 速度「幽灵舰 **1.10** · 守墓长舰 **1.00** · 静滞卫舰 **0.50**」）：
            // 族格读法 = **越往里越慢**（外围巡哨还要机动 / 陵区主力按基准 / 最内层的守誓者只有半速）
            // ⇒ 实测比率 0.44 / 0.88 / 1.11，**必须用族级速带**校验，
            //   不能用战术带（kite 常规带 0.60~0.85 会把 0.44× 的静滞卫舰**误拦**——与 B 族那次同款教训：
            //   **族级口径必须用族级带表达**）。
            if (graveSample.some((s) => s.startsWith(`${slot.ship.id} `)))
              continue; // 同一舰级被多条编成引用时只校验一次
            graveReadings++
            graveSample.push(
              `${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`,
            )
            check(
              ratio >= GRAVE_SPEED_BAND[0] && ratio <= GRAVE_SPEED_BAND[1],
              `敌速口径契约：D 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**族格速带** ` +
                `${GRAVE_SPEED_BAND[0]}~${GRAVE_SPEED_BAND[1]}×（船长「越往里越慢」：幽灵舰 1.10 / 守墓长舰 1.00 / 静滞卫舰 0.50；` +
                `基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'E') {
            // **E 族（泰坦巨构）口径**（船长 2026-09-11 机群批：「巨构不讲机动，只讲撑到最后」；
            // 同日晚些终裁：「**族速度倍率设为 0**。依靠无人机攻击炮台范围外敌人」）：
            // 族格 = **静物残骸**（'还在跑的老机器'）⇒ 实速落 **E 族族格速带 0~0.90 × 本档舰种基准**。
            // ⚠ 与 D 族同款教训：**族级口径必须用族级带表达**——战术带（brawl 1.05~1.55×）会把
            // 慢的巨构**误拦**（它本来就是慢的，慢是设定不是失衡；速度 0 更是族规本身）。
            if (titanSample.some((s) => s.startsWith(`${slot.ship.id} `)))
              continue; // 同一舰级只校验一次
            titanReadings++
            titanSample.push(
              `${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`,
            )
            check(
              slot.ship.speedRatio <= 1,
              `敌速口径契约：E 族 ${def.name} 的舰级「${slot.ship.name}」速度倍率 ${slot.ship.speedRatio} **高于本档舰种基准**——` +
                `船长族格「巨构不讲机动」（E 族族带 0~0.90 × 本档基准）`,
            )
            check(
              ratio >= TITAN_SPEED_BAND[0] && ratio <= TITAN_SPEED_BAND[1],
              `敌速口径契约：E 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**族格速带** ` +
                `${TITAN_SPEED_BAND[0]}~${TITAN_SPEED_BAND[1]}×（船长「巨构不讲机动，只讲撑到最后」；基准船 ${refShip.name} ` +
                `战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'G') {
            // **G 族（鱿烬亡军）口径**（船长 2026-09-12：「**速度口径按照 1.05 算**」⇒ 全族 `speedRatio` 定值 1.05）：
            // 族格 = **残军按舰种走**（1~4 档同倍率 ⇒ 实速随本档舰种基准下降：357 / 310 / 271 / 215）。
            // ⚠ **为什么必须用族级带**（与 B/D/E 三次同款教训）：战术带（orbit 0.90~1.25×）锚定的是"中位玩家船"，
            //   而 1.05 × **T4 基准 205** 只有 215 m/s ⇒ 比率 **0.73×**，会被 orbit 带**误拦** ——
            //   它本来就是"战列舰慢"，慢是族规（1.05 定值 + 舰种基准）算出来的，不是失衡。
            //   2026-09-15 洞内扩充批 5 启用亡军战列舰（此前无卡引用 ⇒ 这条口径从未被实战卡触发过）时暴露。
            //   ⇒ **族级口径必须用族级带表达**：带 = 1.05 × 五档基准所覆盖的比率区间，取 [0.70, 1.25]。
            if (swarmSample.some((s) => s.startsWith(`${slot.ship.id} `))) continue // 同一舰级只校验一次
            swarmReadings++
            swarmSample.push(`${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              Math.abs(slot.ship.speedRatio - G_SPEED_RATIO) < 1e-9,
              `敌速口径契约：G 族 ${def.name} 的舰级「${slot.ship.name}」速度倍率 ${slot.ship.speedRatio} ≠ ${G_SPEED_RATIO}——` +
                `船长 2026-09-12「速度口径按照 1.05 算」`,
            )
            check(
              ratio >= G_SPEED_BAND[0] && ratio <= G_SPEED_BAND[1],
              `敌速口径契约：G 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**族级速带** ` +
                `${G_SPEED_BAND[0]}~${G_SPEED_BAND[1]}×（船长「速度口径按照 1.05 算」＝残军按舰种走；基准船 ${refShip.name} ` +
                `战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          const band = SPEED_BAND[tactic] ?? SPEED_BAND.orbit!
          check(
            ratio >= band[0] && ratio <= band[1],
            `敌速口径契约：${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越界（应 ${band[0]}~${band[1]}×；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
          )
        }
        continue
      }
      const spd = def.foeSpeedMps
      check(
        spd !== undefined && spd > 0,
        `敌速口径契约：${def.name} 未显式声明 foeSpeedMps（2026-09-10 起全卡逐卡标定，见设计稿 enemy-speed-retune-20260910.md；舰级路径卡改为引用舰级速度）`,
      )
      if (spd === undefined) continue
      speedCounted++
      const tactic = def.tactic ?? 'orbit'
      const band = SPEED_BAND[tactic] ?? SPEED_BAND.orbit!
      const ratio = (spd * foeAgi) / refCombat
      check(
        ratio >= band[0] && ratio <= band[1],
        `敌速口径契约：${def.name}（${tactic}）比率 ${ratio.toFixed(2)}× 越界（应 ${band[0]}~${band[1]}×；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
      )
    }
    console.log(
      `· 敌速口径契约：${speedCounted} 张逐卡显式标定 + ${speedShipPath} 张引用舰级速度，比率均在战术带内（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）；` +
        `其中 A 族 ${pirateReadings} 条按**全族提速口径**（实速高于本档舰种基准、比率 ${PIRATE_SPEED_BAND[0]}~${PIRATE_SPEED_BAND[1]}×）、` +
        `B 族 ${scavReadings} 条按**全族慢速口径**（实速低于本档舰种基准、比率落 ${SCAV_SPEED_BAND[0]}~${SCAV_SPEED_BAND[1]}×；船长「速度偏慢」→「B 族速落实 0.8」）、` +
        `C 族 ${alienReadings} 条按**全族更快口径**（倍率 ${ALIEN_SPEED_RATIO_BAND[0]}~${ALIEN_SPEED_RATIO_BAND[1]}×、比率 ${ALIEN_SPEED_BAND[0]}~${ALIEN_SPEED_BAND[1]}×、` +
        `同档实速须高于 A 族；T4 巨兽例外允许慢${ALIEN_SLOW_SHIP_IDS.length > 0 ? `；${ALIEN_SLOW_SHIP_IDS.join(' / ')} 例外允许慢（无人机母舰）` : ''}）、` +
        `D 族 ${graveReadings} 条按**族格"越往里越慢"口径**（幽灵舰 1.10 / 守墓长舰 1.00 / 静滞卫舰 0.50，比率落 ${GRAVE_SPEED_BAND[0]}~${GRAVE_SPEED_BAND[1]}×）、` +
        `E 族 ${titanReadings} 条按**族格"巨构不讲机动"口径**（族速度倍率 0 = 静物残骸、靠机群作战，比率落 ${TITAN_SPEED_BAND[0]}~${TITAN_SPEED_BAND[1]}×）、` +
        `G 族 ${swarmReadings} 条按**族级速带口径**（船长「速度口径按照 1.05 算」＝残军按舰种走，比率落 ${G_SPEED_BAND[0]}~${G_SPEED_BAND[1]}×）`,
    )
    if (pirateSample.length > 0)
      console.log(`  ↳ A 族实测读数（实速/比率）：${pirateSample.join("　")}`)
    if (scavSample.length > 0)
      console.log(`  ↳ B 族实测读数（实速/比率）：${scavSample.join("　")}`)
    if (alienSample.length > 0)
      console.log(`  ↳ C 族实测读数（实速/比率）：${alienSample.join("　")}`)
    if (graveSample.length > 0)
      console.log(`  ↳ D 族实测读数（实速/比率）：${graveSample.join("　")}`)
    if (swarmSample.length > 0) console.log(`  ↳ G 族实测读数（实速/比率）：${swarmSample.join("　")}`)
    if (titanSample.length > 0)
      console.log(`  ↳ E 族实测读数（实速/比率）：${titanSample.join("　")}`)
  }

  /* ── 机群与防空契约（2026-09-11 机群批 S4 加 · 船长「我记得巨构需要制作敌方无人机系统」+
   *    A1「玩家武器通常不可打，需要带有防空属性的武器（为近防炮做铺垫）」+ C1/C2 分族先做 E 族）──
   * ① **防空武器必须短射程**：带**「防空」属性**（`ModuleDef.antiDrone`）的装备射程上限须 ≤ `PD_MAX_RANGE_M`——
   *    防空是'贴身护卫'；射程一放开，它就会变成'对舰能打、对空也能打'的通用最优解，
   *    而它的定位恰恰是**用一门主炮的槽位换'带机群的仗'的答案**。
   *    ①b **「防空」是一条属性两个含义**（船长 2026-09-12：「**给近防炮系列添加一个属性"防空"，
   *    将近防炮的对无人机伤害 ×2 写到防空属性里**」）：①**能筛到敌方机群**（原 `canHitDrones`）
   *    ②**对无人机伤害 ×该值**（原 `antiDroneDmgMul`）⇒ 现值须 = `PD_ANTI_DRONE_DMG_MUL`（2）。
   * ② **敌机只能挂在舰级上**：`drones` 只允许出现在 `FOE_SHIPS` 的舰级行（卡面不写机群）
   *    —— 与'舰级给绝对值、卡上用修正'同一纪律：改一艘船的影响面一眼可见。
   * ③ **机型必须在本族机型表内且族一致**（E 族用警戒机、G 族用蜂群机，不许串族）。
   * ④ **架数为 ≥1 的整数**（'机库存量、打光为止'的语义）。
   * ⑤ **E 族射程带与受击增程**（2026-09-11 船长：「E 族射程按照**最低 100**，**最高根据 7000~10000** 设定，
   *    **无人机射程设为 5000**，添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）：
   *    a) **带机群的 E 族舰级**射程下限 = `TITAN_RANGE_MIN_M`（100）、上限须落在
   *       `TITAN_RANGE_MAX_BAND`（7,000~10,000）内 —— 族级射程口径由契约锁住，防逐卡漂移；
   *    b) **警戒机射程 = `TITAN_DRONE_RANGE_M`（5,000）**（机型表绝对值就是族级口径，改它要过船长）；
   *    c) **受击增程倍率**只允许**带机群的 E 族舰级**写，且 ≤ `DRONE_RANGE_ON_HIT_CAP`（4 = 船长裁定的
   *       「提高 400%」= ×4 ⇒ 5,000 → 20,000m 本场永久、不封顶）。
   * ⑥ **机群火力占比**（2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。这个要根据每个悬赏卡
   *    制定**」）：a) 取值域 **0~1**；b) **只有"该条目会展开出机群"（舰级 `drones` 非空）才允许写**；
   *    c) **守恒**——写了比例的卡，其**实收总单发**必须与"同卡去掉比例"逐字相等（机群与炮台此消彼长，
   *    总量不动）。
   */
  {
    // 2026-09-11 船长裁定「**近防炮射程按照 2500m 算**」⇒ 阈值随之上抬（点防仍远短于主炮 7 km）
    const PD_MAX_RANGE_M = 2_500
    /** E 族射程带（船长 2026-09-11：「最低 100，最高根据 7000~10000 设定」） */
    const TITAN_RANGE_MIN_M = 100
    const TITAN_RANGE_MAX_BAND: readonly [number, number] = [7_000, 10_000]
    /** 警戒机射程（船长同日：「无人机射程设为 5000」） */
    const TITAN_DRONE_RANGE_M = 5_000
    /** 警戒机三层血（船长 2026-09-12：「**将警戒机的血量削弱40%**」⇒ 92 × 0.6 = 55） */
    const E_ALERT_DRONE_HP = 55
    /** 防空武器对无人机伤害倍率（船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」） */
    const PD_ANTI_DRONE_DMG_MUL = 2
    /** 受击增程倍率上限（船长同日：「提高 400%」＝×4） */
    const DRONE_RANGE_ON_HIT_CAP = 4
  /** **炮台受击增程倍率上限**（2026-09-12 船长：D 族静滞卫舰「挨打后射程增加 50%」⇒ 现值 1.5、上限 2） */
  const GUN_RANGE_ON_HIT_CAP = 2
    /** **G 族蜂群机射程定值**（船长 2026-09-12：「**敌方蜂群攻击范围提高到 7000**」）——
     *  落点即族格「全 orbit：**蜂群远距压制**」：旧值 2,800m（侦察机档"近身护航"）会让蜂群
     *  **够不着本族卡自己的期望交距**（天底静区封锁 ≈ 3,858m）⇒ 挂上去等于白挂。 */
    const SWARM_DRONE_RANGE_M = 7_000
    const aaMods = MODULES.filter((m) => m.antiDrone !== undefined)
    check(
      aaMods.length > 0,
      '机群与防空契约：没有任何装备带「防空」属性（`ModuleDef.antiDrone`）——玩家将没有反制敌方机群的手段',
    )
    for (const m of aaMods) {
      const r = m.maxRangeM ?? 0
      check(
        r > 0 && r <= PD_MAX_RANGE_M,
        `机群与防空契约：防空武器「${m.name}」射程 ${r}m 超过 ${PD_MAX_RANGE_M}m——防空是贴身护卫，不是万能武器`,
      )
      // ⑤f **「防空」属性的取值**（船长 2026-09-12：「**给近防炮系列添加一个属性"防空"，将近防炮的
      // 对无人机伤害 ×2 写到防空属性里**」）：带该属性的装备，其值 = 对无人机伤害倍率，
      // 须为正整数/正数且现值 = 2（"能打机群"由"有该属性"本身表达，不再另设布尔字段）。
      // ⚠ 编号 ⑤f/⑤g = 2026-09-12 合并解冲突时的**改号**（我方两条原取 ⑤d/⑤e，与二号同日新增的
      // 「⑤d G 族等离子在场」「⑤e 已备未挂机型」撞号）——按"后来者改号、先到者不动"处理。
      const mul = m.antiDrone
      check(
        mul !== undefined && mul > 0,
        `机群与防空契约：防空武器「${m.name}」的「防空」属性取值非法（现值 ${mul ?? '缺省'}）——` +
          `该值就是"对无人机伤害倍率"，须为正`,
      )
      check(
        mul === PD_ANTI_DRONE_DMG_MUL,
        `机群与防空契约：防空武器「${m.name}」防空属性值 ${mul ?? '缺省'} ≠ ${PD_ANTI_DRONE_DMG_MUL}——` +
          `船长 2026-09-12「**那伤害倍率按2倍算**」`,
      )
    }
    let droneSlots = 0
    /** G 族蜂群机型射程读数（落到汇总行） */
    const swarmRanges: string[] = []
    for (const d of FOE_DRONES.filter((x) => x.family === 'G')) {
      check(
        d.maxRangeM === SWARM_DRONE_RANGE_M,
        `机群与防空契约：G 族机型「${d.name}」（${d.id}）射程 ${d.maxRangeM}m ≠ ${SWARM_DRONE_RANGE_M}m——` +
          `船长 2026-09-12「**敌方蜂群攻击范围提高到 7000**」；该值须与族格「全 orbit：蜂群远距压制」一致` +
          `（低于本族卡期望交距时蜂群等于白挂）`,
      )
      swarmRanges.push(`${d.id} ${d.maxRangeM}`)
    }
    /** E 族射程读数（逐舰级一条，落到汇总行） */
    const titanRanges: string[] = []
    let onHitShips = 0
    /** 写了**炮台受击增程**的舰级数（D 族静滞卫舰，落到汇总行） */
    let gunOnHitShips = 0
    /** 被任何舰级引用的机型 id —— 用来算「**已备未挂**」（P-20a 的教训：漏挂要一眼可辨） */
    const mountedDroneIds = new Set<string>()
    /** G 族机群里是否真的挂了**等离子系**（P-20a 交付物守卫的判据） */
    let swarmHasPlasma = false
    /** G 族机群实际挂载的机型 id（落到汇总行） */
    const mountedSwarmIds: string[] = []
    for (const ship of FOE_SHIPS) {
      const hasDrones = (ship.drones ?? []).length > 0
      // ⑤a **E 族射程带**（只约束带机群的 E 族舰级——即本批落码的那三条）
      if (ship.family === 'E' && hasDrones) {
        check(
          ship.rangeMinM === TITAN_RANGE_MIN_M,
          `机群与防空契约：E 族舰级「${ship.name}」射程下限 ${ship.rangeMinM}m ≠ ${TITAN_RANGE_MIN_M}m——` +
            `船长 2026-09-11「E 族射程按照**最低 100**」`,
        )
        check(
          ship.rangeMaxM >= TITAN_RANGE_MAX_BAND[0] && ship.rangeMaxM <= TITAN_RANGE_MAX_BAND[1],
          `机群与防空契约：E 族舰级「${ship.name}」射程上限 ${ship.rangeMaxM}m 越出 ${TITAN_RANGE_MAX_BAND[0]}~${TITAN_RANGE_MAX_BAND[1]}m——` +
            `船长 2026-09-11「最高根据 **7000~10000** 设定」`,
        )
        titanRanges.push(`${ship.name} ${ship.rangeMinM}~${ship.rangeMaxM}`)
      }
      // ⑤c **受击增程**：只给带机群的 E 族舰级，且倍率 ≤ 4（= +400%）。
      // 2026-09-16 起这两条改走**挂载件**（船长：「将D族和E族的射程增加也迁成挂载件」）——
      // 这里读"挂载件解析后的值"（旧字段仍作兼容回退 ⇒ 两代写法都能过体检）。
      const mountRes = resolveFoeMounts(ship.mounts)
      const droneOnHit = mountRes.foeDroneRangeMulOnHit ?? ship.droneRangeMulOnHit
      const gunOnHit = mountRes.foeGunRangeMulOnHit ?? ship.gunRangeMulOnHit
      if (droneOnHit !== undefined) {
        check(
          ship.family === 'E' && hasDrones,
          `机群与防空契约：舰级「${ship.name}」（${ship.family} 族${hasDrones ? '' : '、无机群'}）挂了机群受击增程——` +
            `本机制目前只允许**带机群的 E 族舰级**（船长 2026-09-11 E 族专属裁定）`,
        )
        check(
          droneOnHit > 1 && droneOnHit <= DRONE_RANGE_ON_HIT_CAP,
          `机群与防空契约：舰级「${ship.name}」受击增程倍率 ${droneOnHit} 越界（须 >1 且 ≤ ${DRONE_RANGE_ON_HIT_CAP}）`,
        )
        onHitShips++
      }
      // ⑤c-2 **炮台受击增程**（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
      //   不过仅影响所有静滞卫舰。挨打后射程增加 50%」）：只允许 D 族「静滞卫舰」、倍率 ≤ 2；
      //   且该舰级**必须真出现在某张卡的编成里**（否则是死字段，玩家永远遇不到）
      if (gunOnHit !== undefined) {
        check(
          ship.family === 'D' && ship.name === '静滞卫舰',
          `机群与防空契约：舰级「${ship.name}」（${ship.family} 族）挂了炮台受击增程——` +
            `本机制目前只允许 **D 族「静滞卫舰」**（船长 2026-09-12 指名）`,
        )
        check(
          gunOnHit > 1 && gunOnHit <= GUN_RANGE_ON_HIT_CAP,
          `机群与防空契约：舰级「${ship.name}」炮台受击增程倍率 ${gunOnHit} 越界` +
            `（须 >1 且 ≤ ${GUN_RANGE_ON_HIT_CAP}）`,
        )
        check(
          ANOMALIES_FLAVORED.some((a) => (a.ships ?? []).some((s) => s.ship.id === ship.id)),
          `机群与防空契约：舰级「${ship.name}」挂了炮台受击增程，但**没有任何卡使用该舰级**——玩家永远遇不到这个机制`,
        )
        gunOnHitShips++
      }
      for (const ds of ship.drones ?? []) {
        droneSlots++
        mountedDroneIds.add(ds.drone.id)
        if (ship.family === 'G') {
          mountedSwarmIds.push(ds.drone.id)
          if (ds.drone.damageType === 'plasma') swarmHasPlasma = true
        }
        check(
          FOE_DRONES.some((d) => d.id === ds.drone.id),
          `机群与防空契约：舰级「${ship.name}」引用的机型 ${ds.drone.id} 不在机型表（FOE_DRONES）内`,
        )
        check(
          ds.drone.family === ship.family,
          `机群与防空契约：舰级「${ship.name}」（${ship.family} 族）挂了 ${ds.drone.family} 族的机型「${ds.drone.name}」——不许串族`,
        )
        check(
          Number.isInteger(ds.count) && ds.count >= 1,
          `机群与防空契约：舰级「${ship.name}」的机群架数 ${ds.count} 必须是 ≥1 的整数`,
        )
        // ⑤b **警戒机射程 = 5,000**（E 族族级口径）
        if (ship.family === 'E') {
          check(
            ds.drone.maxRangeM === TITAN_DRONE_RANGE_M,
            `机群与防空契约：E 族机型「${ds.drone.name}」射程 ${ds.drone.maxRangeM}m ≠ ${TITAN_DRONE_RANGE_M}m——` +
              `船长 2026-09-11「**无人机射程设为 5000**」`,
          )
          // ⑤g **警戒机三层血 = 55**（船长 2026-09-12：「**将警戒机的血量削弱40%**」⇒ 28/20/44 = 92 → 17/12/26 = 55）
          const dhp = ds.drone.defense.shieldHp + ds.drone.defense.armorHp + ds.drone.defense.hullHp
          check(
            dhp === E_ALERT_DRONE_HP,
            `机群与防空契约：E 族机型「${ds.drone.name}」三层血 ${dhp} ≠ ${E_ALERT_DRONE_HP}——` +
              `船长 2026-09-12「**将警戒机的血量削弱40%**」（原 92 的 60% = 55）`,
          )
        }
      }
    }
    // ⑤d **G 族蜂群机挂载：等离子系必须在场**（P-20a 收口 · 2026-09-12 船长选「丙」＝换系）——
    //    三种机型只有**两个机位** ⇒ 任何"换系"路线都必然空出一个（本轮把等离子换上、爆炸转为未挂）。
    //    故本条钉的是**交付物**（"等离子真的上了战场"），而不是具体组合 ⇒ 日后换别的组合不会误伤。
    //    ⚠ 编号取 ⑤d（不取 ⑥）：**⑥ 已被下方「机群火力占比」占用且被设计稿引用**，不许改号。
    const gSwarmShips = FOE_SHIPS.filter((s) => s.family === 'G' && (s.drones ?? []).length > 0)
    if (gSwarmShips.length > 0) {
      check(
        swarmHasPlasma,
        `机群与防空契约：G 族有 ${gSwarmShips.length} 条舰级挂了机群，但**没有一架是等离子系**——` +
          `P-20a（2026-09-12 船长选「丙」）要求等离子机型 \`foe-drone-g-bee-pla\` 必须在场` +
          `（"已备未挂"正是本条要防的复发形态）`,
      )
    }
    // ⑤e **已备未挂机型**（机型表里有、却没有任何舰级引用）：**预警**、不阻断——
    //    把"漏挂"从**静默消失**变成体检输出里的一行字（2026-09-12 P-20a 的教训）。
    const unmountedDrones = FOE_DRONES.filter((d) => !mountedDroneIds.has(d.id))
    if (unmountedDrones.length > 0) {
      warn.push(
        `机群与防空契约：机型表 ${FOE_DRONES.length} 条中 ${unmountedDrones.length} 条**未被任何舰级引用（已备未挂）**：` +
          `${unmountedDrones.map((d) => `${d.name}（${d.id}）`).join('、')}——` +
          `确认是有意留档还是待挂（三种机型两个机位时，换系必然空出一个）`,
      )
    }
    /* ⑤f **后勤契约**（船长 2026-09-16：「**后勤舰添加特性，维修装置可以修理血量最少的队友**」＋
     *    「**敌人后勤舰则是将50%的自身DPS转换为修理值**」＋「**敌方后勤舰新增一艘舰船**（T3巡洋）」
     *    ＋「**先不进卡**」＋「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）：
     *    钉四件事：① `repairPct` 取值域 **(0,1]**（写 0 或 >1 都是坏值）；
     *    ② **有 repairPct 的舰级必须在白名单里显式登记**（防"悄悄给某艘敌舰加修理"）；
     *    ③ 我方**判据在役**：至少一艘玩家舰 `subClass === '后勤舰'`（否则这条特性是死的）；
     *    ④ **已备未上场**（有 `repairPct` 但没有任何卡引用）：**预警**、不阻断——照机群「已备未挂」先例
     *       （2026-09-16 船长定「先不进卡」⇒ 本批应收在这一行里）。 */
    {
      const REPAIR_SHIP_WHITELIST = new Set(['foe-g-remnant-tender'])
      const referenced = new Set<string>()
      const repCtx = buildSimContext()
      for (const card of repCtx.anomalies.values()) for (const slot of card.ships ?? []) referenced.add(slot.ship.id)
      const withRepair = FOE_SHIPS.filter((s) => s.repairPct !== undefined)
      const bad: string[] = []
      for (const s of withRepair) {
        const pct = s.repairPct ?? 0
        if (!(pct > 0 && pct <= 1)) bad.push(`${s.id}（repairPct = ${pct}，应在 (0,1]）`)
        if (!REPAIR_SHIP_WHITELIST.has(s.id)) bad.push(`${s.id}（带 repairPct 但不在登记表里——请显式登记）`)
      }
      check(bad.length === 0, `后勤契约：敌方后勤舰登记与取值域——${bad.join(' · ')}`)
      const logisticsShips = SHIPS.filter((s) => s.subClass === '后勤舰')
      check(
        logisticsShips.length > 0,
        '后勤契约：玩家侧没有任何 `subClass: 后勤舰` 的船 —— 「修最缺血的队友」这条特性会永远不生效',
      )
      const unmounted = withRepair.filter((s) => !referenced.has(s.id))
      if (unmounted.length > 0) {
        warn.push(
          `后勤契约：敌方后勤舰 ${unmounted.map((s) => `${s.name}（${s.id}）`).join('、')}**已备未上场**` +
            `（没有任何卡引用它）——船长 2026-09-16 定「先不进卡」⇒ 机制已就位、实战暂不出现；` +
            `上场时只需把它写进某张卡的 ships（编成改动须过船长）`,
        )
      }
      console.log(
        `· 后勤契约：玩家后勤舰 ${logisticsShips.map((s) => s.name).join('、')}（${logisticsShips.length} 艘 · 维修脉冲改修三层比例最低的队友）· ` +
          `敌方后勤舰 ${withRepair.map((s) => `${s.name}（T${s.hullClassTier} · repairPct ${s.repairPct}）`).join('、')}（${withRepair.length} 艘` +
          `${unmounted.length > 0 ? ' · **未上场**' : ' · 已上场'}）`,
      )
    }
    /* ⑤g **敌方挂载件契约**（2026-09-16 船长三句：「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人
     *    装配就行了**」＋「**除了C族，将D族和E族的射程增加也迁成挂载件**」＋ A 族洞内海盗
     *    「**冲锋倍率为1.6，冷却30秒**」）。钉五件事：
     *    ① **C 族**：全族每条舰级的冲锋件倍率 = 按档阶梯 `ALIEN_CHARGE_MUL_BY_TIER`、冷却 10 秒；
     *    ② **A 族**：**洞内三张 A 族卡的每条编成条目**必须挂海盗冲锋件，参数 = **×1.6 / 30 秒**；
     *    ③ **洞外不许挂冲锋件**——A 族那三条舰级洞外（低安遭遇 / 悬赏）也在用，
     *       挂舰级就会连洞外一起冲（这正是船长选"条目级挂载"的原因）；
     *    ④ 挂载件 id 必须都在 `FOE_MOUNTS` 里（写错 id = 红灯，引擎侧不生效）；
     *    ⑤ D/E 的增程件归属沿用原口径（D 只静滞卫舰 · E 只带机群的三舰）。 */
    {
      const bad: string[] = []
      const wantPirate = FOE_MOUNTS[FOE_MOUNT_IDS.chargePirate].charge!
      // ① C 族按档
      const aliens = FOE_SHIPS.filter((s) => s.family === 'C')
      for (const s of aliens) {
        const r = resolveFoeMounts(s.mounts)
        const want = ALIEN_CHARGE_MUL_BY_TIER[s.hullClassTier]
        if (r.foeCanCharge !== true) bad.push(`${s.name}（${s.id}）未挂冲锋件`)
        else if (want === undefined) bad.push(`${s.name}（${s.id}）的档位 T${s.hullClassTier} 在按档表里没有倍率`)
        else if (r.foeChargeMul !== want)
          bad.push(`${s.name}（${s.id}）冲锋件倍率 ${r.foeChargeMul ?? '未写'} ≠ 按档 ${want}（T${s.hullClassTier}）`)
        else if (r.foeChargeCooldownMs !== 10_000) bad.push(`${s.name}（${s.id}）冲锋冷却 ${r.foeChargeCooldownMs} ≠ 10 秒`)
      }
      // ② A 族洞内三卡（条目级）：必须 = 海盗件
      const whPirateCards = ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband']
      for (const id of whPirateCards) {
        const card = ANOMALIES_FLAVORED.find((a) => a.id === id)
        if (!card) {
          bad.push(`洞内 A 族卡 ${id} 不在目录里`)
          continue
        }
        const slots = card.ships ?? []
        if (slots.length === 0) bad.push(`洞内 A 族卡 ${id} 没有编成条目`)
        for (const sl of slots) {
          // ⚠ **有效挂载 = 条目 mounts ?? 舰级 mounts**（与引擎同一条优先级）：新舰「劫掠电子舰」
          // 把两件挂载件写在**舰级**上（它不外借），条目那一侧是空的 ⇒ 只看条目会误判为"没挂"。
          const r = resolveFoeMounts(sl.mounts ?? sl.ship.mounts)
          if (r.foeCanCharge !== true || r.foeChargeMul !== wantPirate.mul || r.foeChargeCooldownMs !== wantPirate.cooldownMs) {
            bad.push(`${id} 的 ${sl.ship.name}（条目或舰级）未挂海盗冲锋件（×${wantPirate.mul} / ${wantPirate.cooldownMs / 1000} 秒）`)
          }
        }
        // **捕获网件归属**（船长 2026-09-16）：只允许出现在「劫掠电子舰」上，且深层战团必须带它一条
        for (const sl of slots) {
          const eff = sl.mounts ?? sl.ship.mounts
          const hasWeb = resolveFoeMounts(eff).foeCaptureWeb !== undefined
          if (hasWeb && sl.ship.id !== 'foe-pirate-raider') {
            bad.push(`${id} 的 ${sl.ship.name} 挂了劫掠捕获网——该件只允许挂在「劫掠电子舰」上`)
          }
          if (sl.ship.id === 'foe-pirate-raider' && !hasWeb) bad.push(`${id} 的劫掠电子舰没挂捕获网件`)
        }
      }
      // ③ 洞外不许挂冲锋件（除 C 族舰级、洞内三张 A 族卡条目）。
      //    ⚠ 按**有效挂载**（条目 ?? 舰级）判：新舰「劫掠电子舰」把海盗冲锋件写在**舰级**上
      //    （它只进深层战团），若只看条目，日后把它放进洞外卡会漏检 ⇒ 冲锋跟着上洞外。
      const whSet = new Set(whPirateCards)
      for (const a of ANOMALIES_FLAVORED) {
        if (whSet.has(a.id)) continue
        for (const sl of a.ships ?? []) {
          const charge = resolveFoeMounts(sl.mounts ?? sl.ship.mounts).foeChargeMul
          if (charge !== undefined && sl.ship.family !== 'C') {
            bad.push(`洞外卡 ${a.id} 的条目 ${sl.ship.name} 挂了冲锋件——冲锋只允许 C 族舰级与洞内三张 A 族卡`)
          }
        }
      }
      // ④ 挂载件 id 全部可解析（舰级 + 条目两处都查）
      const unknown: string[] = []
      for (const s of FOE_SHIPS) {
        for (const u of resolveFoeMounts(s.mounts).unknown) unknown.push(`${s.id} → ${u}`)
      }
      for (const a of ANOMALIES_FLAVORED) {
        for (const sl of a.ships ?? []) {
          for (const u of resolveFoeMounts(sl.mounts).unknown) unknown.push(`${a.id}/${sl.ship.id} → ${u}`)
        }
      }
      if (unknown.length > 0) bad.push(`未知挂载件 id：${unknown.join(' · ')}`)
      check(bad.length === 0, `敌方挂载件契约：${bad.join(' · ')}`)
      // 汇总行**按目录实算**（血泪清单：硬编码"冲锋 5 · 增程 2"会在加件时说过期话）
      const allMounts = Object.values(FOE_MOUNTS)
      const nCharge = allMounts.filter((m) => m.charge !== undefined).length
      const nDrone = allMounts.filter((m) => m.droneRangeOnHit !== undefined).length
      const nGun = allMounts.filter((m) => m.gunRangeOnHit !== undefined).length
      const nWeb = allMounts.filter((m) => m.web !== undefined).length
      console.log(
        `· 敌方挂载件契约：${allMounts.length} 件（冲锋 ${nCharge} · 机群增程 ${nDrone} · 炮台增程 ${nGun} · 捕获网 ${nWeb}）· ` +
          `C 族 ${aliens.length} 条按档挂件（${aliens.map((s) => `${s.name} T${s.hullClassTier}×${resolveFoeMounts(s.mounts).foeChargeMul}`).join('　')}）· ` +
          `A 族洞内 3 卡条目挂海盗件（×${wantPirate.mul} / ${wantPirate.cooldownMs / 1000} 秒）· 洞外零冲锋件` +
          `${nWeb > 0 ? ` · **劫掠捕获网** 仅「劫掠电子舰」（首次开火钉住目标：减速 90% / 关推进器 / 闪避归零 / 射程 −500m）` : ''}`,
      )
    }
    console.log(
      `· 机群与防空契约：防空武器 ${aaMods.length} 件（射程上限 ≤ ${PD_MAX_RANGE_M}m）· 敌机登记 ${droneSlots} 处（机型在表内 / 族一致 / 架数合法）` +
        `${titanRanges.length > 0 ? ` · **E 族射程带** ${titanRanges.join('　')}（机型射程 ${TITAN_DRONE_RANGE_M}m）` : ''}` +
        `${onHitShips > 0 ? ` · **受击增程** ${onHitShips} 条舰级 ×${DRONE_RANGE_ON_HIT_CAP}（母舰被命中 ⇒ 全机群射程 ×4 = ${TITAN_DRONE_RANGE_M * DRONE_RANGE_ON_HIT_CAP}m，本场永久、不封顶）` : ''}` +
        `${swarmRanges.length > 0 ? ` · **G 族蜂群机射程** ${swarmRanges.join('　')}（船长 2026-09-12「提高到 7000」；无受击增程）` : ''}` +
        // ⚠ 汇总行**按结果分支**（血泪清单：有错时不许仍打印"含等离子 ✓"）
        `${gSwarmShips.length > 0 ? ` · **G 族蜂群机挂载** ${mountedSwarmIds.join(' + ')}${swarmHasPlasma ? '（含等离子 ✓）' : '（⚠ **无机型含等离子** —— 见上方错误）'}` : ''}` +
        `${unmountedDrones.length > 0 ? ` · **已备未挂机型** ${unmountedDrones.map((d) => d.id).join('、')}` : ' · 机型表全部在役'}` +
        `${gunOnHitShips > 0 ? ` · **炮台受击增程** ${gunOnHitShips} 条舰级 ×1.5（D 族静滞卫舰：被打中 ⇒ 该型舰 12,000 → 18,000m，本场永久、仅该型舰）` : ''}` +
        ` · **防空属性** ${aaMods.map((m) => `${m.name} ×${m.antiDrone ?? 1}`).join('　')}（能打敌方机群 + 对无人机伤害 ×该值；对舰伤害不受影响）`,
    )

    /* ⑥ **机群火力占比**（2026-09-11 船长：「允许调整敌舰的无人机/炮台火力比例。这个要根据每个
     *    悬赏卡制定」）——守恒拆分：条目实收总单发不变，机群与炮台此消彼长。
     *    a) 取值域 0~1；b) 只有"会展开出机群"的条目/舰级可写；c) **守恒实测**：写了比例的卡，
     *    其单位武器 Σ 必须与"同卡去掉比例"逐字相等（多舰补偿/取整都在同一链上，故可比）。 */
    {
      const shareCtx = buildSimContext()
      let shareShips = 0
      let shareSlots = 0
      /** 写了**总火力锚点**的卡数（锚点口径：架数变动不影响总量） */
      let anchorCards = 0
      for (const ship of FOE_SHIPS) {
        if (ship.droneFireShare === undefined) continue
        shareShips++
        check(
          ship.droneFireShare >= 0 && ship.droneFireShare <= 1,
          `机群与防空契约：舰级「${ship.name}」机群火力占比 ${ship.droneFireShare} 越界（须 0~1）`,
        )
        check(
          (ship.drones ?? []).length > 0,
          `机群与防空契约：舰级「${ship.name}」写了机群火力占比却**没有机群**——本旋钮只拆"机群 vs 母舰武器组"`,
        )
      }
      const sumShots = (def: (typeof ANOMALIES_FLAVORED)[number]): number =>
        createFoeSpecs(def, shareCtx.balance.battle).reduce(
          // ⚠ **排除备用机条目**（`w.reserve`）——备用机库是"库存深度"（战损后才放出），
          // 不属于常驻齐射；本契约判的是"比例有没有动总量"，故两边都不计备用机。
          (n, u) =>
            n +
            u.weapons.reduce((m, w) => m + (w.reserve === true ? 0 : (w.shotDmg ?? 0)), 0),
          0,
        )
      /** 去掉卡上所有 `droneFireShare`（舰级缺省也要压掉）的克隆——用于守恒对照。
       *  ⚠ **同时压掉 `droneReserve`**（2026-09-12 乙）——备用机库是**另一个维度**（库存深度）：
       *  它按"拆分后的逐架单发"额外贡献火力，若只压比例不压备用，对照两边会差出备用机的份额，
       *  误判成"不守恒"。本契约只判**比例**本身（同一编成下 T 不变）。 */
      const stripShare = (def: (typeof ANOMALIES_FLAVORED)[number]) => ({
        ...def,
        ships: def.ships?.map((s) => ({
          ...s,
          droneFireShare: undefined,
          ship: {
            ...s.ship,
            droneFireShare: undefined,
            droneReserve: undefined,
          },
        })),
      })
      for (const def of ANOMALIES_FLAVORED) {
        const slots = def.ships ?? []
        if (!slots.some((s) => (s.droneFireShare ?? s.ship.droneFireShare) !== undefined)) continue
        for (const s of slots) {
          const share = s.droneFireShare ?? s.ship.droneFireShare
          if (share === undefined) continue
          shareSlots++
          check(
            share >= 0 && share <= 1,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」机群火力占比 ${share} 越界（须 0~1）`,
          )
          check(
            (s.ship.drones ?? []).length > 0,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」写了机群火力占比却**没有机群**`,
          )
        }
        const withShare = sumShots(def)
        const anchorSum = slots.reduce((n, s) => n + (s.firepowerAnchor ?? 0), 0)
        const anchoredSlots = slots.filter((s) => s.firepowerAnchor !== undefined)
        for (const s of anchoredSlots) {
          check(
            Number.isInteger(s.firepowerAnchor) && (s.firepowerAnchor ?? 0) >= 1,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」总火力锚点 ${s.firepowerAnchor} 须为 ≥1 的整数`,
          )
          check(
            (s.droneFireShare ?? s.ship.droneFireShare) !== undefined,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」写了**总火力锚点**却没写**机群占比**——` +
              `锚点定"总量"、占比定"构成"，两者须成对（2026-09-12 船长「架数变多、总火力不动」）`,
          )
        }
        if (anchoredSlots.length === slots.length && slots.length > 0) {
          anchorCards++
          // **锚点口径**：卡的总量由锚点说了算 ⇒ 直接核"实收总单发 = 锚点合计"
          check(
            withShare === anchorSum,
            `机群与防空契约：${def.name} 写了总火力锚点 ⇒ 实收总单发须等于锚点合计（实际 ${withShare} vs 锚点 ${anchorSum}）`,
          )
        } else {
          const without = sumShots(stripShare(def) as typeof def)
          check(
            withShare === without,
            `机群与防空契约：${def.name} 写了机群火力占比后**总单发不守恒**（${withShare} vs 去掉比例 ${without}）——` +
              `比例只改"机群 / 炮台"的构成，**总量不动**`,
          )
        }
      }
      if (shareShips + shareSlots > 0)
        console.log(
          `· 机群火力占比契约：舰级缺省 ${shareShips} 条 · 卡上条目 ${shareSlots} 处（0~1 · 须有机群 · **总单发守恒**${anchorCards > 0 ? `；其中 **${anchorCards} 张卡写了总火力锚点**（架数变动不影响总量）` : ''}）`,
        )
    }

    /* ⑦ **备用机库**（2026-09-12 船长「或给敌机添加**备用机库**（损坏后补充敌机）」⇒ **本轮只采用乙**）
     *    与 ⑧ **单次出击上限**（同日「限制敌机单次出击数量」⇒ 船长裁定「**甲留作后续其他机制**」）：
     *    a) 乙：`droneReserve` 只允许**带机群的舰级**写；`count` = ≥1 整数、`respawnMs` = 500~60000ms
     *       （⚠ 与 A3 裁定「打光为止不补充」相反 = 船长 2026-09-12 **改判**）；
     *    b) 甲：机制已实现但**本轮不采用** ⇒ 契约**禁止任何舰级写 `droneLaunch`**
     *       （与「敌突进 / 单波增援」同款"机制实现、不启用"纪律：开关就是"契约不许写"）。
     */
    {
      let reserveShips = 0
      let launchShips = 0
      for (const ship of FOE_SHIPS) {
        if (ship.droneReserve !== undefined) {
          reserveShips++
          check(
            (ship.drones ?? []).length > 0,
            `机群与防空契约：舰级「${ship.name}」写了备用机库却**没有机群**`,
          )
          check(
            Number.isInteger(ship.droneReserve.count) && ship.droneReserve.count >= 1,
            `机群与防空契约：舰级「${ship.name}」备用机库架数 ${ship.droneReserve.count} 须为 ≥1 的整数`,
          )
          check(
            ship.droneReserve.respawnMs >= 500 && ship.droneReserve.respawnMs <= 60000,
            `机群与防空契约：舰级「${ship.name}」备用机补位间隔 ${ship.droneReserve.respawnMs}ms 越界（须 500~60000ms）`,
          )
        }
        if (ship.droneLaunch !== undefined) {
          launchShips++
          check(
            false,
            `机群与防空契约：舰级「${ship.name}」写了单次出击上限（\`droneLaunch\`）——` +
              `船长 2026-09-12 裁定「**甲留作后续其他机制**」⇒ 本轮**不许任何舰级启用**（机制已实现、待启用）`,
          )
        }
      }
      console.log(
        `· 机群出击契约：**备用机库** ${reserveShips} 条舰级启用（战损后满血补位；A3「不补充」已按船长改判）· **单次出击上限** ${launchShips} 条启用（机制就位、本轮不采用）`,
      )
    }
  }

  /* ── 舰级契约（2026-09-11 加，船长定案「敌舰配置表 + 卡上修正 + 允许混编」）──
   * ① **引用有效**：卡上每个编成条目的舰级必须登记在 `FOE_SHIPS` 表内（禁止内联随手造舰级）；
   * ② **族一致**：舰级 `family` 必须等于卡的 `foeFamily`；
   * ③ **声明一致**：卡面 `tactic` / `defProfile` / `dmgMix` 必须与"**主体单位**"一致
   *    （舰级路径下这三项是**卡面口径**，与舰级定义重复，故用契约锁死，防两边漂移）；
   *    **主体（prime）定义（2026-09-11 数值落地批改定）**：混编卡（如「头目舰 ×1 + 杂鱼 ×3」）
   *    的卡面**只能写一族**的血型与伤害构成，故 prime 取**单位数最多的非僚机条目** ——
   *    即编成的**数量主体**（例：头目 ×1 + 劫掠狙击舰 ×3 → prime = 劫掠狙击舰，
   *    卡面 `defProfile: 'shield'` / `dmgMix plasma8:kinetic2` 讲的就是它）。
   *    ⚠ 头目那份血量不随卡面血型走（`FoeShipSlot` 无 `split` 覆写位）——已知口径，见设计稿。
   * ④ **编成合法**：至少一条非僚机条目（要有主体）；
   * ⑤ **舰种档合法**（2026-09-11 追加裁决「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）：
   *    每个敌舰级的 `hullClassTier` 必须落在 `1~5`；且**海盗族（family 'A'）不得登记 4 战列舰 / 5 旗舰档**；
   * ⑥ **A 族编成契约（2026-09-11 数值落地批加，船长确认）**：
   *    a) **编成必须是「头目舰 ×1 + 同族杂鱼 ×3」**（共 4 个单位，杂鱼同族同型）；
   *    b) **头目血量占比 = 60% ±1%**（按编成实算：`Σ(舰级血 × hpMul × 数量)`）。
   *    依据 = 船长 A 族设定「**鱼龙混杂 / 装备较差数值偏低 / 靠数量弥补 / 一个头目强大带一堆杂鱼 /
   *    速度都快**」——数量弥补所以要 3 艘杂鱼，头目强大所以头目独占 60% 血与 60% 名义火力。 */
  {
    const known = new Set(FOE_SHIPS.map((s) => s.id))
    /** 编成条目的**单位数**（`count` 缺省 1）——"数量主体"与 A 族编成契约共用同一口径 */
    const unitCount = (slot: { count?: number }): number => Math.max(1, Math.floor(slot.count ?? 1))
    /** 编成实算总血（舰级血 × hpMul × 数量） */
    const slotsHp = (slots: readonly { ship: { hp: number }; hpMul?: number; count?: number }[]): number =>
      slots.reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * unitCount(s), 0)
    // ⑤ 舰种档：先校验登记表全表（档位越界 / 各族**不配的档**）
    const PIRATE_BANNED_TIERS: readonly number[] = [4, 5] // 4 战列舰 / 5 旗舰
    /** **G 族四档「亡军战列舰」= 唯一合法的 T4 壳体**（船长 2026-09-12「**战列舰先建壳体**」；
     *  **2026-09-15 已由洞内扩充批 5 启用**（船长「G族添加战列舰动能伤害为主」＋「G族战列可以添加机群」→「挂」）
     *  ⇒ 它现在**有卡引用**（洞内 G 族深层卡「残军战列线」）；本条契约的用意不变：**G 族的 T4 只能是它**，
     *  防日后把战列档顺手塞给杂鱼。 */
    const G_RESERVED_BATTLESHIP_ID = 'foe-g-exile-battleship'
    /** **B 族（武装拾荒者）不得 ≥ 3 巡洋舰**（2026-09-11 船长七裁决：「**确认为新手过渡种族**」+
     *  拾荒者拿的是拼装小艇）⇒ 只登记 **T1 护卫舰 / T2 驱逐舰**两档 */
    const SCAV_BANNED_FROM_TIER = 3
    let tiered = 0
    for (const ship of FOE_SHIPS) {
      const t = ship.hullClassTier
      check(
        Number.isInteger(t) && t >= 1 && t <= 5,
        `舰级契约：舰级「${ship.name}」（${ship.id}）的舰种档 ${t} 越界（须落在 1~5：1 护卫舰 / 2 驱逐舰 / 3 巡洋舰 / 4 战列舰 / 5 旗舰）`,
      )
      if (ship.family === 'A') {
        check(
          !PIRATE_BANNED_TIERS.includes(t),
          `舰级契约：海盗族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——**海盗不配战列级（维护成本大，不符合海盗背景设定）**；海盗舰队只用 1 护卫舰 / 2 驱逐舰 / 3 巡洋舰三档（船长 2026-09-11：「海盗应该是护卫驱逐巡洋构成」）`,
        )
      }
      if (ship.family === 'B') {
        check(
          t < SCAV_BANNED_FROM_TIER,
          `舰级契约：拾荒族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——` +
            `**武装拾荒者不配 T3 及以上**：船长 2026-09-11 定「**确认为新手过渡种族**」，` +
            `拾荒者开的是拼装小艇 ⇒ 只登记 **1 护卫舰 / 2 驱逐舰两档**`,
        )
      }
      if (ship.family === 'C') {
        // **C 族（异形生物）舰种档**（船长 2026-09-11 裁定③：「**允许 T4 战列舰**（"生物巨兽"）」）：
        // ①允许 1~4 档（**不配 5 旗舰**——生物再大也是"巨兽"而非"旗舰"编队）；
        // ②**T4 必须登记为"巨兽"用途**（`ALIEN_BEAST_SHIP_IDS` 白名单）——目的是**防日后随手给杂鱼挂 T4**
        //   （把战列档当普通量产物用，等于把"巨兽"的意义抹平）。白名单是"显式登记"的代码化表达。
        check(
          t <= 4,
          `舰级契约：异形族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——` +
            `异形族只允许 1 护卫舰 ~ 4 战列舰（船长裁定③「**允许 T4 战列舰**（生物巨兽）」），**不配 5 旗舰**`,
        )
        if (t === 4) {
          check(
            ALIEN_BEAST_SHIP_IDS.includes(ship.id),
            `舰级契约：异形族舰级「${ship.name}」（${ship.id}）登记了 4 战列舰档却**未登记为"巨兽"用途**——` +
              `T4 是"**生物巨兽**"专档（船长 2026-09-11 裁定③），须显式登记在 \`ALIEN_BEAST_SHIP_IDS\`（packages/data/src/foe-ships.ts）；` +
              `目的是防日后随手给杂鱼挂 T4`,
          )
        }
      }
      if (ship.family === 'G') {
        // **G 族（鱿烬亡军）舰种档 + 速度定值**（船长 2026-09-12 六裁决；2026-09-15 战列舰启用）：
        // ①「**G组分5档。从护卫舰到战列舰。**」⇒ 允许 **1~4 档**（1 护卫舰 ~ 4 战列舰）、
        //   **不配 5 旗舰**（旗舰留给 E 族巨构的"核心舱段"）；
        // ②「**战列舰先建壳体**」⇒ T4 就是那条壳体（`G_RESERVED_BATTLESHIP_ID`）；**2026-09-15 已启用**
        //   （洞内 G 族深层卡用它），本条**仍然只允许这一条 T4**，防日后把战列档顺手塞给杂鱼；
        // ③「**速度口径按照 1.05 算**」⇒ 全族 `speedRatio` **定值 1.05**（四档同倍率，不逐舰写不同值）。
        check(
          t <= 4,
          `舰级契约：鱿烬亡军舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——` +
            `G 族按 5 档体系登记、本次铺 **1 护卫舰 ~ 4 战列舰**（船长「G组分5档。从护卫舰到战列舰」），**不配 5 旗舰**`,
        )
        if (t === 4) {
          check(
            ship.id === G_RESERVED_BATTLESHIP_ID,
            `舰级契约：鱿烬亡军的 4 战列舰档只能是那条壳体（船长「战列舰先建壳体」= ${G_RESERVED_BATTLESHIP_ID}；` +
              `2026-09-15 已启用并挂蜂群机）——不得再登记第二条 T4`,
          )
        }
        check(
          Math.abs(ship.speedRatio - G_SPEED_RATIO) < 1e-9,
          `舰级契约：鱿烬亡军舰级「${ship.name}」（${ship.id}）的速度倍率是 ${ship.speedRatio}——` +
            `船长 2026-09-12 定「**速度口径按照 1.05 算**」⇒ 全族定值 **${G_SPEED_RATIO}**`,
        )
      }
      tiered++
    }
    const normMix = (m?: Partial<Record<string, number>>): string =>
      Object.entries(m ?? {})
        .filter(([, w]) => (w ?? 0) > 0)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, w]) => `${k}:${w}`)
        .join(',')
    let shipCards = 0
    let slotTotal = 0
    let mixed = 0
    let aCompositionCards = 0
    for (const def of ANOMALIES_FLAVORED) {
      const ships = def.ships
      if (!ships || ships.length === 0) continue
      shipCards++
      slotTotal += ships.length
      if (new Set(ships.map((x) => x.ship.id)).size > 1) mixed++
      for (const slot of ships) {
        check(
          known.has(slot.ship.id),
          `舰级契约：${def.name} 引用了未登记的舰级 ${slot.ship.id}（须登记在 packages/data/src/foe-ships.ts）`,
        )
        if (def.foeFamily) {
          check(
            slot.ship.family === def.foeFamily,
            `舰级契约：${def.name}（族 ${def.foeFamily}）引用了族 ${slot.ship.family} 的舰级「${slot.ship.name}」`,
          )
        }
      }
      const mains = ships.filter((x) => x.escort !== true)
      check(mains.length >= 1, `舰级契约：${def.name} 没有任何非僚机编成条目（至少需要一艘主体）`)
      // 主体 = 单位数最多的非僚机条目（数量相同时取先写的；见上方 ③ 的 prime 定义）
      const prime = mains.reduce<(typeof mains)[number] | undefined>(
        (best, x) => (best && unitCount(best) >= unitCount(x) ? best : x),
        undefined,
      )
      if (prime && def.tactic) {
        // 卡面战术是"这一场怎么打"的摘要；混编允许各主体用不同战术（如狙击头目 + 贴脸杂鱼），
        // 故契约只要求**卡面战术落在主体们的有效战术集合内**（有效 = 卡上覆写优先，2026-09-11 头目多战术）。
        const effTactics = new Set(mains.map((m) => m.tactic ?? m.ship.tactic))
        check(
          effTactics.has(def.tactic),
          `舰级契约：${def.name} 卡面战术 ${def.tactic} 不在主体编成的有效战术集合内 [${[...effTactics].join(" / ")}]`,
        )
      }
      // **血型 / 构成：逐条主体按「有效值」判定**（2026-09-11 船长裁决①「头目血型随卡片走」）——
      // 有效 split = 条目 `split` 覆写 ?? 舰级 `split`；卡面 `defProfile` / `dmgMix` 是**卡**的口径，
      // 必须对**每一条非僚机编成**都成立（否则"头目一份血在卡面描述之外"）。
      // ⚠ **A 族不做族级血型约束**（船长同日：海盗鱼龙混杂 ⇒ 什么血型都有），血型逐卡自定。
      // 想配异质编成时的正解 = 在条目里写覆写使其与卡面对齐，而不是让卡面失真。
      for (const slot of mains) {
        if (def.defProfile) {
          const want = foeLayerSplit(def.defProfile)
          const got = slot.split ?? slot.ship.split
          const via = slot.split ? '条目 `split` 覆写' : '沿用舰级 split'
          check(
            Math.abs(want.s - got.s) < 1e-9 && Math.abs(want.a - got.a) < 1e-9 && Math.abs(want.h - got.h) < 1e-9,
            `舰级契约：${def.name} 卡面血型 ${def.defProfile}（${want.s}/${want.a}/${want.h}）与编成条目「${slot.ship.name}」（${via}：${got.s}/${got.a}/${got.h}）不一致——` +
              `船长 2026-09-11：「**头目血型随卡片走**」；若该条目要配别的血型，请写 \`split\` 覆写使其与卡面对齐`,
          )
          check(
            Math.abs(got.s + got.a + got.h - 1) < 1e-9,
            `舰级契约：${def.name} 的编成条目「${slot.ship.name}」有效血型 Σ ≠ 1（${got.s}+${got.a}+${got.h}）——血型比例须归一`,
          )
        }
        if (def.dmgMix) {
          const eff = slot.dmgMix ?? slot.ship.dmgMix
          check(
            normMix(def.dmgMix) === normMix(eff),
            `舰级契约：${def.name} 卡面伤害构成（${normMix(def.dmgMix)}）与编成条目「${slot.ship.name}」有效构成（${normMix(eff)}）不一致`,
          )
        }
      }
      /* ⑥ **A 族编成契约**（2026-09-11 数值落地批 + 同日追加两条裁定）——两个分支：
       * **分支一 · 有头目**（灰霾/赤潮/蜃影）——依据「靠数量弥补」+「一个头目强大带一堆杂鱼」：
       *   a) 编成 = 头目 ×1 + 同族同型杂鱼 ×3（共 4 单位）；b) 头目血量占比 = 60% ±1%。
       * **分支二 · 无首领**（边境/碎晶/信标，船长 2026-09-11「**边境海盗前哨 / 碎晶带劫匪通缉 /
       *   信标猎手悬赏 都设定无首领**」）——**全队同族同型、无 elite 头目**，且按船长给定的**波次结构**：
       *   边境「**1+2**」（首波 1 艘 + 次波 2 艘 = 3 单位）、碎晶与信标「**2+2**」（每波 2 艘 = 4 单位），
       *   并要求登记 `anomaly.waves` 两波（引擎靠它切波；舰级路径的波次由 `slot.wave` 决定）。
       *
       * ⚠ **旧 hidden 遭遇模板豁免**（2026-09-12 加）：`enc-pirate-1..4` 因 2026-09-11 船长
       *   「**废弃F族，将F族融合进A族**」而**归属** A 族，但它们是**旧档遗留遭遇的战斗兜底模板**
       *   （`hidden: true`，不进悬赏目录、不参与派发）——编成是 2026-09-12 从旧路径"主 + 僚"
       *   **守恒迁移**来的（血量 / 单发 / 射程 / 命中 / 衰减逐项对齐迁移前实测值），
       *   **不是** A 族设定「头目 + 杂鱼」的产物；把族设计契约套上去只会逼旧档兜底卡改难度。 */
      if (def.foeFamily === 'A' && def.hidden !== true) {
        /** A 族**无首领**三张卡（船长 2026-09-11 追加裁定）与其波次结构：边境「1+2」、碎晶/信标「2+2」 */
        const NO_BOSS_A_CARDS: Record<
          string,
          { units: number; wave0: number; wave1: number; shape: string }
        > = {
          'ano-pirate-post': { units: 3, wave0: 1, wave1: 2, shape: '1+2' },
          'ano-shard-bandits': { units: 4, wave0: 2, wave1: 2, shape: '2+2' },
          'ano-lantern-saboteurs': {
            units: 4,
            wave0: 2,
            wave1: 2,
            shape: '2+2',
          },
        }
        const totalUnits = ships.reduce((n, s) => n + unitCount(s), 0)
        const bosses = ships.filter((s) => s.ship.elite === true)
        const minions = ships.filter((s) => s.ship.elite !== true)
        const bossUnits = bosses.reduce((n, s) => n + unitCount(s), 0)
        const minionUnits = minions.reduce((n, s) => n + unitCount(s), 0)
        const minionTypes = new Set(minions.map((s) => s.ship.id))
        const waveUnits = (w: number): number =>
          ships
            .filter((s) => (s.wave ?? 0) === w)
            .reduce((n, s) => n + unitCount(s), 0)
        const noBoss = NO_BOSS_A_CARDS[def.id]
        if (noBoss) {
          check(
            bosses.length === 0 && bossUnits === 0,
            `舰级契约：A 族卡 ${def.name} 已按船长 2026-09-11 裁定「**设定无首领**」——编成里不得再有 elite 头目；` +
              `实际 elite 条目 ${bosses.length} 条 / ${bossUnits} 个单位`,
          )
          check(
            minionTypes.size === 1,
            `舰级契约：A 族卡 ${def.name}（无首领）应为**同族同型**编队（单一舰级）；实际 ${[...minionTypes].join(" / ")}`,
          )
          check(
            totalUnits === noBoss.units,
            `舰级契约：A 族卡 ${def.name} 的单位总数应为 **${noBoss.units}**（船长「**${noBoss.shape}**」），实际 ${totalUnits}`,
          )
          check(
            waveUnits(0) === noBoss.wave0 && waveUnits(1) === noBoss.wave1,
            `舰级契约：A 族卡 ${def.name} 的波次结构应为「**${noBoss.shape}**」（首波 ${noBoss.wave0} 艘 + 次波 ${noBoss.wave1} 艘，` +
              `用 slot.wave 的 0/1 表达）；实际 首波 ${waveUnits(0)} 艘 / 次波 ${waveUnits(1)} 艘`,
          )
          check(
            (def.waves?.length ?? 0) === 2,
            `舰级契约：A 族卡 ${def.name}（无首领 · ${noBoss.shape}）须登记 anomaly.waves **两波**（引擎据此切波），实际 ${def.waves?.length ?? 0} 波`,
          )
        } else {
          check(
            bosses.length === 1 && bossUnits === 1,
            `舰级契约：A 族卡 ${def.name} 的编成应为「**头目舰 ×1** + 杂鱼 ×3」——船长 2026-09-11 设定「**一个头目强大带一堆杂鱼**」；` +
              `实际头目条目 ${bosses.length} 条 / 头目单位 ${bossUnits} 个（头目 = 登记为 elite 的 A 族舰级）`,
          )
          check(
            minions.length === 1 && minionUnits === 3 && minionTypes.size === 1,
            `舰级契约：A 族卡 ${def.name} 的编成应为「头目舰 ×1 + **同族同型杂鱼 ×3**」——船长 2026-09-11 设定「**靠数量弥补**」；` +
              `实际杂鱼条目 ${minions.length} 条（${[...minionTypes].join(" / ")}）/ 杂鱼单位 ${minionUnits} 个（须为 3、且同一条目同型）`,
          )
          check(
            totalUnits === 4,
            `舰级契约：A 族卡 ${def.name} 编成单位总数应为 **4**（头目 ×1 + 杂鱼 ×3，多舰船补偿系数按 N=4 = 1.6 标定），实际 ${totalUnits}`,
          )
          const totalHp = slotsHp(ships)
          check(
            totalHp > 0,
            `舰级契约：A 族卡 ${def.name} 编成总血为 0（无法校验头目血占比）`,
          )
          const bossHp = slotsHp(bosses)
          const share = totalHp > 0 ? bossHp / totalHp : 0
          check(
            Math.abs(share - 0.6) <= 0.01,
            `舰级契约：A 族卡 ${def.name} 的**头目血量占比应为 60% ±1%**（按编成实算：Σ舰级血 × hpMul × 数量），实际 ` +
              `${(share * 100).toFixed(2)}%（头目 ${bossHp.toFixed(2)} / 总血 ${totalHp.toFixed(2)}）——` +
              `依据船长 2026-09-11 A 族设定：头目强大（独占 60% 血）、杂鱼靠数量弥补（各 40%÷3）`,
          )
        }
        aCompositionCards++
      }
    }
    console.log(
      `· 舰级契约：${shipCards} 张舰级路径卡（${slotTotal} 条编成，其中混编 ${mixed} 张）引用有效、族与卡面口径一致；` +
        `舰种档 ${tiered} 个舰级全部落在 1~5，海盗族（A）无 4 战列舰 / 5 旗舰档、拾荒族（B）无 T3 及以上（新手过渡族）、` +
        `异形族（C）允许 T4（须登记为"巨兽"用途：${ALIEN_BEAST_SHIP_IDS.join(" / ")}）且不配 T5；` +
        `鱿烬亡军（G）登记 1~4 档（**T4 战列舰 = 那条壳体**（船长「战列舰先建壳体」；**2026-09-15 已启用**并挂蜂群机 ×3）、不配 T5；` +
        `全族速度定值 **${G_SPEED_RATIO}×**）；` +
        `A 族编成契约 ${aCompositionCards} 张：灰霾/赤潮/蜃影 = 头目 ×1 + 同族杂鱼 ×3（共 4 单位）· 头目血量 60% ±1%；` +
        `边境/碎晶/信标 = **无首领**（同族同型 + 船长给定波次 1+2 / 2+2 / 2+2）`,
    )
  }

  /* ── 增援机制未启用契约（2026-09-11 加）──
   * 船长裁决原文：「**先完成相应的系统机制，不使用。用作后续机制。**」
   * 口径：`BattleBalance.foeReinforceEnabled` **关闭期间，任何卡不得携带 `enterAt`**——
   * 让"未使用"这个状态**由代码守住**（而不是靠人记）：一旦有人在关着开关时给卡写 `enterAt`
   * （比如以为写了就生效），**内容体检立刻失败并说清依据**。
   * 启用流程 = 先开开关（`balance.foeReinforceEnabled = true`）再编成条目写 `enterAt`，
   * 同时按注释解除本契约并补实测（见 `docs/design/foe-reinforce-20260911.md`）。 */
  {
    const enabled = DEFAULT_BALANCE.battle.foeReinforceEnabled === true
    let carriers = 0
    const named: string[] = []
    for (const def of ANOMALIES_FLAVORED) {
      for (const slot of def.ships ?? []) {
        if (!slot.enterAt) continue
        carriers++
        named.push(def.name)
        check(
          enabled,
          `增援机制未启用契约：${def.name} 的编成条目携带了 \`enterAt\`，但总开关 \`foeReinforceEnabled\` 为 false——` +
            `**单波次内增援机制已实现、但按船长裁决不启用**` +
            `（船长 2026-09-11：「先完成相应的系统机制，不使用。用作后续机制。」）；` +
            `要启用请先打开总开关（core \`balance.ts\`），再同步解除本契约（tools/content-check.ts）并补实测`,
        )
      }
    }
    console.log(
      `· 增援机制未启用契约：总开关 **${enabled ? "开" : "关"}**，${carriers} 张卡携带 \`enterAt\`` +
        `${carriers > 0 ? `（${[...new Set(named)].join('、')}）` : ""}——` +
        `机制（三种触发 / 存档零迁移 / 距离重开）已实现并有用例覆盖，**按船长裁决不启用，留作后续机制**`,
    )
  }

  /* ── 族→战术契约（2026-09-11 加）──
   * 船长 2026-09-11 定 A 族性格「**鱼龙混杂，所以应该各个战术的敌人都有**」→ A 族三种战术全合法。
   * **B 族（武装拾荒者）**：船长 2026-09-11 七裁决「**战术性格统一为 orbit**」→ **只允许 orbit**。
   * 其余族正按字母顺序逐族商讨中，**只登记已裁定的族**，未登记 = 不校验（不预设、不猜）。 */
  {
    const FAMILY_TACTICS: Partial<Record<string, readonly string[]>> = {
      A: ['brawl', 'orbit', 'kite'], // 鱼龙混杂（船长 2026-09-11）
      B: ['orbit'], // 武装拾荒者·全族 orbit（船长 2026-09-11「战术性格统一为 orbit」）
      C: ['brawl'], // 异形生物·贴脸生物（C 族第二批「虫群编成」后全族 brawl）
      D: ['orbit', 'kite'], // 守墓古舰·**全远程**（船长 2026-09-11「D 族以远程为主」⇒ 不许 brawl）
      E: ['orbit', 'kite'], // 泰坦巨构·**中距为主**（设定裁定③：主体 orbit / kite 单卡变体 / brawl 退役）
      G: ['orbit'], // 鱿烬亡军·全 orbit（蜂群远距压制）
    }
    let checked = 0
    for (const def of ANOMALIES_FLAVORED) {
      const allow = def.foeFamily ? FAMILY_TACTICS[def.foeFamily] : undefined
      if (!allow) continue
      const tactics =
        def.ships && def.ships.length > 0
          ? def.ships.filter((x) => x.escort !== true).map((x) => x.tactic ?? x.ship.tactic)
          : [def.tactic ?? 'orbit']
      for (const t of tactics) {
        checked++
        check(
          allow.includes(t),
          `族→战术契约：${def.name}（族 ${def.foeFamily}）用了战术 ${t}，超出该族已裁定的允许范围 [${allow.join(" / ")}]`,
        )
      }
    }
    console.log(
      `· 族→战术契约：${checked} 处族内战术声明均在已裁定范围内（**A 族 = 三战术全允许 / B·G 族 = 统一 orbit / C 族 = 贴脸 brawl / D·E 族 = 远程·中距（brawl 退役）**；F 已废弃不校验）`,
    )
  }
}

/* ── 图标覆盖契约（2026-09-10 加）：每个物品种类 / 装备槽位 / 舰船族都必须有 Glyphs 图形与色调 ──
 * 背景：仓库·货仓·图鉴·工业页卡片的行首图标一律按 kind / slot / role 取图形，缺键会**静默**落兜底圆环徽
 *（当天补齐的正是 wreck / fragment / kit / salvager / target-lock 五个键）——新增内容种类时在此拦住。 */
{
  const glyphPath = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'ui', 'Glyphs.tsx')
  if (!existsSync(glyphPath)) {
    check(false, `图标契约：找不到渲染层图标库 ${glyphPath}（文件移位请同步本检查）`)
  } else {
    const glyphSrc = readFileSync(glyphPath, 'utf8')
    const keysOf = (block: string): Set<string> => {
      const m = glyphSrc.match(new RegExp(`${block}: Record<string, (?:string|ReactNode)> = \\{([\\s\\S]*?)\\n\\}`))
      return new Set([...(m?.[1] ?? '').matchAll(/^\s*'?([A-Za-z0-9-]+)'?:/gm)].map((x) => x[1]))
    }
    const shapes = keysOf('SHAPES')
    const tones = keysOf('TONES')
    const needed = [...ITEM_KIND_ORDER, ...MODULE_SLOTS, ...Object.keys(SHIP_ROLE_LABELS), 'blueprint']
    for (const key of needed) {
      check(shapes.has(key), `图标契约：${key} 缺 Glyphs 图形（列表/卡片行首会落兜底圆环徽；请在 ui/Glyphs.tsx 补 SHAPES.${key}）`)
      check(tones.has(key), `图标契约：${key} 缺 TONES 色调（未知键一律落默认灰）`)
    }
    if (needed.every((key) => shapes.has(key) && tones.has(key))) {
      console.log(
        `· 图标契约：物品 ${ITEM_KIND_ORDER.length} 类 + 槽位 ${MODULE_SLOTS.length} 个 + 舰船族 ${Object.keys(SHIP_ROLE_LABELS).length} 个 图形/色调齐备` +
          `（图标库共 ${shapes.size}/${tones.size} 键）`,
      )
    }
  }
}

/* ── 舰船图形契约（2026-09-16 加）：**每一艘船都必须有自己的 SVG 形与挂点** ──
 * 船长 2026-09-16：「**新增的舰船没有SVG图形，按照之前的规则每艘需要单独的SVG图形**」。
 *
 * 根因：2026-09-09 那批图形是**手工全量**接入的，此后新加的船（2026-09-12 的 T4/T5 模子与鹦鹉螺、
 * 2026-09-13 的虫洞族专属 15 艘）没人补 ⇒ `ShipSprite` 静默回退 140×64 的 role 兜底剪影：
 * 舰队卡 / 舰船仓库 / 战斗画面里长得一模一样，且**四道闸门全绿也照样漏**（就像这次的实测）。
 * 同款缺口还有一处：挂点表（引擎喷口 / 真实炮口）——缺了不会报错，只是尾焰落回"单焰"、
 * 开火锚落回舰艏前缘。故本契约把**两张表**一起钉住。
 *
 * 口径：`ships.ts` 的每一艘船，在
 *   ① `ui/shipArt.tsx` / `shipArtData.tsx` / `shipArtWh.tsx` 的形表里有一条；
 *   ② `ui/shipMounts.ts` 的 `SHIP_MOUNTS` 里有一条（**敌族表不在此列**，另有 `FOE_ART` 覆盖）。
 * 静态读源码（与「图标覆盖契约」「市场类型契约」同款做法，不引 UI 依赖）。 */
{
  const uiDir = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'ui')
  const artFiles = ['shipArt.tsx', 'shipArtData.tsx', 'shipArtWh.tsx']
  const missingFiles = artFiles.filter((f) => !existsSync(join(uiDir, f)))
  const mountPath = join(uiDir, 'shipMounts.ts')
  if (missingFiles.length > 0 || !existsSync(mountPath)) {
    check(
      false,
      `舰船图形契约：找不到 ${[...missingFiles, ...(existsSync(mountPath) ? [] : ['shipMounts.ts'])].join(' · ')}（文件移位请同步本检查）`,
    )
  } else {
    const artSrc = artFiles.map((f) => readFileSync(join(uiDir, f), 'utf8')).join('\n')
    /** 形表键 = `'sh-xxx': (` 或 `"sh-xxx": (`（含敌族 A~G 字母键，故下面只按船 id 取交集） */
    const artKeys = new Set([...artSrc.matchAll(/["']([A-Za-z0-9-]+)["']\s*:\s*\(/g)].map((m) => m[1]!))
    const mountSrc = readFileSync(mountPath, 'utf8')
    const mountBlock = mountSrc.slice(
      mountSrc.indexOf('export const SHIP_MOUNTS'),
      mountSrc.indexOf('export const FOE_MOUNTS'),
    )
    /** 挂点表键 = 两空格缩进的 `'sh-xxx': {` / `id: {`（敌族块在 SHIP_MOUNTS 之后，已切掉） */
    const mountKeys = new Set(
      [...mountBlock.matchAll(/^\s{2}(?:'([A-Za-z0-9-]+)'|([A-Za-z0-9-]+)):\s*\{/gm)].map(
        (m) => m[1] ?? m[2]!,
      ),
    )
    const noArt = SHIPS.filter((s) => !artKeys.has(s.id)).map((s) => `${s.id}（${s.name}）`)
    const noMount = SHIPS.filter((s) => !mountKeys.has(s.id)).map((s) => `${s.id}（${s.name}）`)
    check(
      noArt.length === 0,
      `舰船图形契约：${noArt.join(' · ')} 没有独立 SVG 形 —— 舰队卡/舰船仓库/战斗画面会落 role 兜底剪影（船长 2026-09-16：「每艘需要单独的SVG图形」）；请在 ui/shipArt.tsx 或 ui/shipArtWh.tsx 补形（画布 240×110 · 舰首朝右 · 无类元素 = 主轮廓）`,
    )
    check(
      noMount.length === 0,
      `舰船图形契约：${noMount.join(' · ')} 没有挂点 —— 尾焰回落单焰、开火锚回落舰艏前缘；请在 ui/shipMounts.ts 补 engines/muzzles（坐标 = 该舰 240×110 本地几何）`,
    )
    if (noArt.length === 0 && noMount.length === 0) {
      console.log(
        `· 舰船图形契约：${SHIPS.length} 艘船形与挂点齐备（形表 ${artKeys.size} 键 · 玩家挂点 ${mountKeys.size} 键）`,
      )
    }
  }
}

/* ── 悬停提示契约（2026-09-14 船长报障「部分情况仍会出现系统默认的鼠标悬浮 title 窗口」后加）：
 * 全站悬停说明一律走**元素的 `title` 属性**（由 `ui/Tooltip.tsx` 的全局接管层换成站内自绘提示：
 * 限宽 300px、跟随鼠标、可多行）；**SVG 的 `<title>` 子元素一律禁止** —— 它不是属性、接管层
 * 看不见它，浏览器会照弹**系统默认**提示（实测：`closest('[title]')` 命中不到、`<title>` 子元素
 * 还在）。作者层已把那两处（星图航线时长 / 虫洞格子）改成属性写法，这里按"静态读源码"再守一道。 */
{
  const uiRoot = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = join(dir, d.name)
      if (d.isDirectory()) return walk(p)
      return p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : []
    })
  const offenders: string[] = []
  for (const file of walk(uiRoot)) {
    // 先剥注释（`/* */`、`{/* */}`、`//` 行）——注释里写 `<title>` 讲解是合法的
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    if (/<title[\s>]/.test(code)) offenders.push(file.slice(process.cwd().length + 1))
  }
  check(
    offenders.length === 0,
    `悬停提示契约：渲染层出现 SVG \`<title>\` 子元素 ⇒ 浏览器会弹**系统默认**提示（请改成父元素的 title 属性，由自绘提示接管）：${offenders.join(' · ')}`,
  )
  /**
   * ② **一个元素只能有一个提示归属**（2026-09-15 统一时加 · 船长报障「按钮的提示会和上一级的悬浮提示
   * 相互冲突」）：同一 JSX 元素同时带 `title` 与 `{...hoverTipProps(...)}` ⇒ `title` 走全局接管层、
   * `hoverTipProps` 走富内容路径，两者画在**同一个单例提示层**上 ⇒ 会互相顶掉（先弹一个再被另一个替换）。
   *
   * ⚠ **不按标签大小写过滤**：`<Tag {...hoverTipProps(content)}>` 这种"变量标签"（ShipHover / InfoHover
   * 的写法，`Tag = as ?? 'span'` 最终仍是原生标签）正是本契约要拦的场景之一——只在"一个元素同时出现
   * 两者"时判红，组件调用点（如 `<InfoHover title=…>`，标题是它自己的 prop）不会被误伤。
   */
  const dualOwners: string[] = []
  for (const file of walk(uiRoot)) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('hoverTipProps(')) continue
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let hasTitle = false
        let hasHover = false
        for (const a of node.attributes.properties) {
          if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'title') hasTitle = true
          if (ts.isJsxSpreadAttribute(a) && a.expression.getText(sf).includes('hoverTipProps(')) hasHover = true
        }
        if (hasTitle && hasHover) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          dualOwners.push(`${file.slice(process.cwd().length + 1)}:${line + 1}（<${node.tagName.getText(sf)}>）`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  check(
    dualOwners.length === 0,
    `悬停提示契约：同一元素同时带 \`title\` 与 \`{...hoverTipProps(…)}\` ⇒ 两个提示归属抢同一个单例提示层（会互相顶掉）。二选一：静态文案写 \`title\`、富内容用 \`hoverTipProps\`：${dualOwners.join(' · ')}`,
  )
  if (offenders.length === 0 && dualOwners.length === 0) {
    console.log(
      '· 悬停提示契约：渲染层无 SVG `<title>` 子元素（HTML 元素用 title 属性、SVG 元素用 data-tip ⇒ 自绘提示接管）· 无"双提示归属"元素',
    )
  }
}

/* ── 三条"静态读 AST"的契约（同一个遍历里一起扫，省一遍解析）：
 * ①**模板串契约**（2026-09-14 船长报障「虫洞探索地图的背景变成全黑了」后加）：`url("${pinnedSpaceBg}")`
 *   漏了反引号 ⇒ 输出的是**字面量文本**而不是插值，底图 URL 永远 404 ⇒ 地图只剩压暗层与 1px 星点。
 *   类型系统看不出这种错（它就是个合法字符串）⇒ 按 AST 精确扫 **StringLiteral 的 text 里含 `${`**；
 * ②**文案纯净契约**（2026-09-14 船长问「为什么有些说明文字有 ** 文字**」后加）：游戏文案是**纯文本渲染**，
 *   开发文档里那套 Markdown 强调记号（连续两个星号）写进玩家可见字符串就会**原样显示**。
 *   ⚠ **本契约刻意不写进约定/AGENTS**（船长 2026-09-14 裁定：「B 可以不用写入规则」）——它只是体检里的一道防线，
 *   不派活、不加条款。
 *   扫的是**文本节点**：字符串 / 模板串文本块 / JSX 文本；**注释不算**（注释里写强调记号是合法的，
 *   本仓大量注释就是这么写的）⇒ 三类契约都只看文本节点，互不干扰。
 * ③**陈旧术语契约**（2026-09-14 船长批准加：当日文案体检靠人工才抓出 41 处旧称，加契约自动拦）：
 *   把历次**已改判的旧称**列成黑名单，玩家可见文本里再出现即红——每条附"现行口径 + 裁定日期"，
 *   并保留一份**极短的白名单**（确有叙事用途的专名，逐条写明理由）。 */

/** 陈旧术语黑名单（正则 → 现行口径与出处）；命中即红 */
const STALE_COPY_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/三钛合金|类银超金属|类晶体胶体|超噬矿/, '旧矿物名（2026-09-14 起：钛钢合金 / 银纹超金属 / 晶态胶体 / 重钨合金）'],
  [/(?<!原)矿石|矿物(?!质)/, '旧称（2026-09-12 起：ore = 原矿、mineral = 原材料）'],
  [/弹药蓝图/, '旧档名（2026-09-11 起：消耗品蓝图——该档含弹药 + 修理组件）'],
  [/工业舰|工业族/, '旧角色名（2026-09-09 起：采矿舰 / 采矿族）'],
  [/舰船市场/, '旧档名（2026-09-14 起：该档为「舰船仓库」；买卖在市场页）'],
  [/船坞/, '旧称（现口径：机库 / 舰船仓库）'],
  /**
   * 2026-09-15 船长报障后加（原话：「虫洞内回合耗尽后的提示：……文本不符合虫洞探索的游戏设定」）：
   * 「撤离拦截 / 撤离拦截战」是**施工期漂移**叫法。
   *
   * ⚠ 2026-09-15 二次改判（船长「**虫洞的撤离战取消吧**」）：**「撤离战」这个名字本身也退役了**
   * ——撤离不再触发任何战斗 ⇒ 玩家文案里两个名字都不许再出现（新文案口径见手册与词典八之一）。
   * 历史公告里的旧说法走 `STALE_COPY_FILE_ALLOW` 豁免。
   */
  [/撤离拦截/, '施工期漂移叫法（2026-09-15 起整条退役：撤离不再有战斗）'],
  [/撤离战/, '已退役机制名（2026-09-15 船长「虫洞的撤离战取消吧」⇒ 撤离零战斗，玩家文案不得再提）'],
  /**
   * 2026-09-16 船长报障加（原话：「**游戏内依旧有高级箱，开箱等不符合游戏的名词使用，进行检查。**」
   * ＋追问后的口径：「**我并没有设定是游戏内文案，将不符合的文案全部修改**」）。
   *
   * 背景：**「高级箱」不是游戏内文案**，是 2026-09-10 施工期给"稀有残骸额外掉落"起的工作名
   * （词典当时"预留口子"、工业页 2026-09-14 选甲时把它当档名写上去了）⇒ 一路漏进了
   * 工业页二级筛选标签、卡面说明、悬停、物品说明与事件日志。现行口径：
   * 「高级箱」→ **档名「稀有残骸」/ 叙述「额外战利品」**；「开箱」→ 货柜写 **拆解**、残骸写 **解体 / 回收**。
   *
   * ⚠ 「开箱」这条其实是**补执行**词典 2026-09-14 已定的口径（「开箱那一步一律写『货柜拆解』，
   * 玩家可见文案里不出现「拆解台」」）——当时只改了引擎错误文案，散在各处的日志/手册/悬停漏了。
   */
  [/高级箱/, '施工期工作名（2026-09-16 起：档名写「稀有残骸」、叙述写「额外战利品」）'],
  [/开箱/, '施工期叫法（2026-09-14 词典已定「货柜一律写拆解」；2026-09-16 收口：货柜=拆解 / 残骸=解体·回收）'],
  [/奖池|卡池/, '开发词（2026-09-16 收口：玩家文案写「产出 / 掉落」）'],
  [/抽奖|抽卡|盲盒|礼包/, '与设定不符的现代游戏用词（2026-09-16 船长报障）'],
  /**
   * ⚠ 「开出」**只拦"从箱子里开出来"那一义**（后接战利品名词），不拦「开出悬赏 / 开出价码」这类正当用法——
   * 首版写成裸 `/开出/` 时把 `anomalies.ts` 的「协会为能拆开它的人开出了长期悬赏」误报了一次（2026-09-16 当场收窄）。
   */
  [
    /开出(?=[^，。；）]{0,6}(?:装备|图纸|舰船|无人机|核心|奢侈品|残骸|矿物|原材料|件东西))/,
    '把产出说成"从箱子里开出来"（2026-09-16 收口：写「产出 / 得到 / 缴获 / 解体」）',
  ],
  /**
   * 2026-09-16 船长定名批（原话：「**将弹药 爆破导弹改名为爆破弹药，其他的弹药也进行类似的改名**」）：
   * 弹药全族统一到《系+弹药》——**动能弹 → 动能弹药** · **爆破导弹 → 爆破弹药**（能量弹药本就合规），
   * 含 MK2 两档与 6 张生产线蓝图。三条旧名列入黑名单防回潮。
   *
   * ⚠ `动能弹` 必须带负向断言 `(?!药)`：**它是新名「动能弹药」的前缀**，裸写会把新名一起判红。
   */
  [/动能弹(?!药)/, '旧弹药名（2026-09-16 起：动能弹药）'],
  [/爆破导弹/, '旧弹药名（2026-09-16 起：爆破弹药——发射架仍叫导弹架，打出去的是弹药）'],
  [/等离子弹/, '旧弹药名（V18B-2 起即为「能量弹药」，2026-09-16 补齐存量文案）'],
  /**
   * 2026-09-16 船长定名批（原话：「**将重装舰类的名称改为装甲舰。**」）：
   * `armored` 的展示名由「重装」改「**装甲**」⇒ 类别名「重装舰」、角色徽标「重装」、技能「重装舰操作」全部换新；
   * 这条黑名单只拦**「重装舰」三个字连写**（旧类别名与旧技能名），不拦三艘乌龟船的**舰名**
   * （「陆龟级重装艇 / 玳瑁级重装巡舰 / 玄武级重装旗舰」——船长选甲案，单舰名与蓝图描述保持原样）。
   */
  [/重装舰/, '旧类别名（2026-09-16 起：装甲舰）——单舰名「重装艇/重装巡舰/重装旗舰」不受此条约束'],
  /**
   * 2026-09-16 船长改名（原话：「**采矿护卫舰操作改名为采集器入门学。**」）：
   * 技能 `mining-frigate`（每级缩短采集循环时间 3%）的展示名换新；id 不动 ⇒ 存档零迁移。
   */
  [/采矿护卫舰/, '旧技能名（2026-09-16 起：采集器入门学）'],
]

/**
 * 陈旧术语**按文件 + 按词**豁免（逐条写明理由）：只用于**已上线的历史公告数据**里那些
 * **属于当时事实的陈述**（改它 = 篡改历史）。
 *
 * ⚠ 2026-09-16 收窄（船长报障「游戏内依旧有高级箱，开箱等不符合游戏的名词」）：原先**整份文件**一律豁免
 * ⇒ 新写的公告里再出现旧词也拦不住。现改为"只豁免点名的那几个词"，其余黑名单词在公告里照拦
 *（同日按船长「一起改」把两处已发布公告里的「高级箱 / 开箱」改掉了，仅"撤离战"这类事实陈述保留）。
 */
const STALE_COPY_FILE_ALLOW: ReadonlyArray<readonly [string, RegExp, string]> = [
  [
    'packages/data/src/announcements.ts',
    /撤离拦截|撤离战/,
    '已上线公告数据（历史留档：当时确实写着"自第 2 层起要打赢撤离战"⇒ 属当时事实，不改写）',
  ],
]

/** 陈旧术语**白名单**（逐条写明理由；只有确属叙事专名的才可登记） */
const STALE_COPY_ALLOW: ReadonlyArray<readonly [RegExp, string]> = [
  [/隐蔽船坞/, '敌方窝点叙事专名（D 族据点名，非设施旧称）'],
]

/**
 * **跨件对比契约**（2026-09-16 二次报障后加）：玩家可见文案**只讲本件**，不许拿别的装备/舰船做标尺。
 *
 * 船长两次点到同一类：① 2026-09-16 第一轮文案审查（「炮台装填间隔 ÷1.18（射速计算机 MK3 是 ÷1.12）」这类）；
 * ② 当日二次报障：「**文案中依旧还有类（总输出 ≈ 攻坚炮台的八成）这种文案，建议重新审查一遍所有带有括号的文案。**」
 * ——第一轮清掉的是**常规装备**那一批，**窝点/虫洞专属**（2026-09-10 之后新增的那批）漏了 6 条，
 * 且都藏在括号或破折号后面（如「射速只有攻坚炮台的四成、单发威力是它的两倍（总输出 ≈ 攻坚炮台的八成）」）。
 *
 * 判据（**只认"点名了别的装备/舰种"的对比**，避免误伤自比与玩法对比）：
 * - 出现装备/舰种类名词（炮台 / 激光炮 / 导弹架 / 导弹巢 / 近防炮 / 稳定器 / 计算机 / 阵列 / 甲板 …）
 *   且其后 12 字内出现「的 N 成 / 的 N 倍 / 相当 / 同档」；
 * - 或出现指代他人的「它 / 该件 / 原型」＋「N 成 / N 倍」。
 *
 * ⚠ **刻意放过的（不算跨件对比）**：自比（「满级间隔约为原来的六成」）· 跨玩法对比（「收益约为亲自探索的四成」）·
 * 数值读数（「≈15.5 万 信用点/h」）——这三类在第一轮审查里都判为合规，契约不拦。
 */
const CROSS_ITEM_COMPARE: readonly RegExp[] = [
  /(炮台|激光炮|导弹架|导弹巢|近防炮|稳定器|计算机|阵列|甲板|扩展|推进器)[^。；]{0,12}(的 ?[一二三四五六七八九十百]+成|的 ?[0-9.]+ ?倍|相当|同档)/,
  /(它|该件|原型)[^。；]{0,6}(的 ?[一二三四五六七八九十百]+成|的 ?[0-9.]+ ?倍)/,
]

{
  const tplRoots = [
    'apps/desktop/src/renderer/src',
    'apps/desktop/src/main',
    'apps/desktop/src/preload',
    'packages/core/src',
    'packages/data/src',
    'packages/ui/src',
  ]
  const tplFiles: string[] = []
  const walkTpl = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name)
      if (d.isDirectory()) walkTpl(p)
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) tplFiles.push(p)
    }
  }
  for (const r of tplRoots) {
    const abs = join(process.cwd(), r)
    if (existsSync(abs)) walkTpl(abs)
  }
  const tplOffenders: string[] = []
  const mdOffenders: string[] = []
  const staleOffenders: string[] = []
  const compareOffenders: string[] = []
  const isPlayerText = (node: ts.Node): boolean =>
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    node.kind === ts.SyntaxKind.JsxText
  for (const file of tplFiles) {
    const src = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const rel = file.slice(process.cwd().length + 1)
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && node.text.includes('${')) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        tplOffenders.push(`${rel}:${line + 1}`)
      }
      if (isPlayerText(node) && node.getText(sf).includes('**')) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        mdOffenders.push(`${rel}:${line + 1}`)
      }
      if (isPlayerText(node) && node.getText(sf).length > 1) {
        const relNorm = rel.replace(/\\/g, '/')
        /**
         * 本文件被点名豁免的**词**（其余黑名单词照拦；2026-09-16 由"整份文件豁免"收窄而来）。
         * ⚠ 比对用 `exemptRe.test(termRe.source)`：豁免模式写的是**词组**（如 `/撤离拦截|撤离战/`），
         * 而黑名单里是拆开的两条 ⇒ 比"正则源码全等"会漏（首版如此，当场被 `announcements.ts:54` 的
         * 「撤离战」报出来才发现）。
         */
        const exemptRe = STALE_COPY_FILE_ALLOW.filter(([p]) => relNorm === p || relNorm.endsWith(p)).map(
          ([, termRe]) => termRe,
        )
        const text = node.getText(sf)
        let probe = text
        for (const [re] of STALE_COPY_ALLOW) probe = probe.replace(new RegExp(re.source, 'g'), '')
        for (const [re, why] of STALE_COPY_TERMS) {
          if (exemptRe.some((x) => x.test(re.source))) continue
          if (re.test(probe)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
            staleOffenders.push(`${rel}:${line + 1}（${text.slice(0, 40)}…）→ ${why}`)
          }
        }
        // 跨件对比（2026-09-16 二次报障后加）：只认"点名了别的装备/舰种"的对比，详见 CROSS_ITEM_COMPARE 注释
        for (const re of CROSS_ITEM_COMPARE) {
          if (re.test(text)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
            const hit = text.match(re)?.[0] ?? ''
            compareOffenders.push(`${rel}:${line + 1}（…${hit}…）`)
            break
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  check(
    tplOffenders.length === 0,
    `模板串契约：字符串里出现 \${…} 字面量（漏写反引号 ⇒ 输出的是字面量文本而非插值；2026-09-14「虫洞地图背景全黑」就是这个坑）：${tplOffenders.join(' · ')}`,
  )
  if (tplOffenders.length === 0) {
    console.log(`· 模板串契约：${tplFiles.length} 个源文件无「引号字符串里含 \${…}」的漏反引号写法`)
  }
  check(
    mdOffenders.length === 0,
    `文案纯净契约：玩家可见文本里出现 Markdown 强调记号（连续两个星号）——游戏里是纯文本渲染，它会被**原样显示**给玩家（2026-09-14 船长报障）；请去掉记号（要强调用 <b>/颜色类，注释随意，注释不算文本节点）：${mdOffenders.join(' · ')}`,
  )
  if (mdOffenders.length === 0) {
    console.log(`· 文案纯净契约：${tplFiles.length} 个源文件的文本节点无 Markdown 强调记号`)
  }
  check(
    staleOffenders.length === 0,
    `陈旧术语契约（2026-09-14 船长批准加）：玩家可见文本里出现**已改判的旧称**——请按现行口径改写（旧矿物名 → 钛钢合金/银纹超金属/晶态胶体/重钨合金；矿石/矿物 → 原矿/原材料；弹药蓝图 → 消耗品蓝图；工业舰/工业族 → 采矿舰/采矿族；舰船市场 → 舰船仓库；船坞 → 机库/舰船仓库）：${staleOffenders.join(' · ')}`,
  )
  if (staleOffenders.length === 0) {
    console.log(
      `· 陈旧术语契约：${tplFiles.length} 个源文件无已改判旧称（黑名单 ${STALE_COPY_TERMS.length} 组 · 白名单 ${STALE_COPY_ALLOW.length} 条专名）`,
    )
  }
  check(
    compareOffenders.length === 0,
    `跨件对比契约（2026-09-16 船长二次报障后加）：玩家可见文案**只讲本件**——不许拿别的装备/舰船当标尺（船长原话：「文案中依旧还有类（总输出 ≈ 攻坚炮台的八成）这种文案」）。请改写为**本件自述**（射速/单发/射程各自定性即可，绝对值界面卡上已有）：${compareOffenders.join(' · ')}`,
  )
  if (compareOffenders.length === 0) {
    console.log(`· 跨件对比契约：${tplFiles.length} 个源文件无"点名的跨件对比"（判据 ${CROSS_ITEM_COMPARE.length} 条 · 自比/跨玩法对比/数值读数不算）`)
  }
}


/* ── 赏金任务·敌人窝点契约（2026-09-10 加）：可作窝点目标的敌群必须齐备"派生所需的三件套" ──
 * ①稀有残骸物品（窝点战利品，打捞必得 → 高级箱）已注册进 ctx.items；
 * ②三档称呼词齐全（敌族词表或卡级覆盖）；
 * ③该敌族的**专属装备**至少一件，且 id 必须真实存在（B/F 两族留空，见下）。
 * 另：**B 族（武装拾荒者）已取消**——任何 B 族卡都不得成为窝点候选（船长 2026-09-10 定）。 */
{
  let lairCards = 0
  const famWithGear = new Set<string>()
  const lairCtx = buildSimContext()
  for (const def of ANOMALIES_FLAVORED) {
    if (def.foeFamily === 'B') {
      check(
        !isLairCandidate(def),
        `窝点契约：B 族已取消（2026-09-10 船长定），${def.name} 不得作为窝点候选`,
      )
      check(
        FOE_LAIR_GEAR.B.length === 0,
        `窝点契约：B 族专属装备应已撤下，实际 ${FOE_LAIR_GEAR.B.join("、")}`,
      )
    }
    if (!isLairCandidate(def)) continue
    lairCards += 1
    const rareId = rareWreckItemIdOf(def.id)
    const rareDef = lairCtx.items.get(rareId)
    check(!!rareDef, `窝点契约：${def.name} 缺稀有残骸物品 ${rareId}（data/context.ts 需按 hasLairCore 注册）`)
    if (rareDef) {
      check(rareDef.kind === 'wreck', `窝点契约：稀有残骸 ${rareId} 种类应为 wreck，实际 ${rareDef.kind}`)
      check(
        rareDef.unitM3 === 1,
        `窝点契约：稀有残骸 ${rareId} 必须沿用"计数即体积"台账（unitM3 = 1，1 件 = ${RARE_WRECK_VOLUME_M3} 单位 = ${RARE_WRECK_VOLUME_M3} m³），实际 unitM3=${rareDef.unitM3}`,
      )
    }
    const names = [1, 2, 3].map((t) => lairNameOf(def, t as 1 | 2 | 3))
    for (const n of names)
      check(
        n.trim().length > 0 && !n.endsWith('·'),
        `窝点契约：${def.name} 档位称呼为空（name=${n}）`,
      )
    check(
      new Set(names).size === 3,
      `窝点契约：${def.name} 三档称呼重复（${names.join(" / ")}）`,
    )
    const gear = lairGearOf(def)
    if (def.foeFamily) famWithGear.add(def.foeFamily)
    for (const id of gear) {
      // 池内元素可以是模块 / 专属物品 / 蓝图（2026-09-10 船长：G 族第一件 = 专属无人机"物品"；
      // 2026-09-14 船长：专属无人机出一次性蓝图 ⇒ G 族池再收 `bp-lair-g-drone`）
      check(
        moduleIdSet.has(id) || lairCtx.items.has(id) || lairCtx.blueprints.has(id),
        `窝点契约：${def.name} 专属装备 ${id} 不存在（modules.ts / items.ts / blueprints.ts 均未登记）`,
      )
    }
  }
  for (const fam of famWithGear) {
    check(
      FOE_LAIR_GEAR[fam].length > 0,
      `窝点契约：敌族 ${fam} 有窝点成员但没配专属装备（FOE_LAIR_GEAR，每族至少一件）`,
    )
  }
  /* ── 敌族显式登记契约（2026-09-12 加；F 族废弃批 P-15 的落码项）──
   * 背景：船长 2026-09-11「**废弃F族，将F族融合进A族**」⇒「未录族」不再有默认族
   * （旧兜底 = 制式巡逻形）。政策改为**强制显式登记**，三条：
   * ① **每张敌军卡必须有 `foeFamily`**——缺族会让造型 / 窝点三档称呼 / 专属装备 / 副系签名四处
   *   各按缺省静默分叉（F 族当年正是"事实上的缺省容器"）；显式登记后，新增卡漏写立刻暴露；
   * ② **`'F'` 是已废弃的空位**（字母位保留、防旧内容表/旧导出解析出错），任何卡再写 `'F'` 即报错；
   * ③ 登记的族必须是合法族字母（A~E / G；`'F'` 除外）。
   * 落码顺序：**先**给四张旧遭遇模板（`enc-pirate-1..4`）显式登记 A 族、**后**加本契约。 */
  {
    const LEGAL_FAMILIES: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'G']
    let famRegistered = 0
    for (const def of ANOMALIES_FLAVORED) {
      check(
        !!def.foeFamily,
        `敌族登记契约：${def.name}（${def.id}）没有登记 foeFamily——每张敌军卡必须**显式登记族**` +
          `（F 族已废弃、"未录族"不再有默认兜底）`,
      )
      if (def.foeFamily) {
        check(
          def.foeFamily !== 'F',
          `敌族登记契约：${def.name}（${def.id}）登记了 'F'——制式巡逻族已于 2026-09-11 废弃并入 A 族，` +
            `'F' 仅作空置字母位，不许再登记`,
        )
        check(
          LEGAL_FAMILIES.includes(def.foeFamily),
          `敌族登记契约：${def.name} 的族「${def.foeFamily}」不是合法族字母（合法：${LEGAL_FAMILIES.join(" / ")}）`,
        )
        famRegistered++
      }
    }
    console.log(
      `· 敌族登记契约：${famRegistered} 张敌军卡**全部显式登记族**（无缺省兜底；'F' 空位无卡占用）`,
    )
  }
  /* ── 退役窝点卡契约（2026-09-11 船长「按方案 2 执行」）──
   * 背景：B 族两卡（新港商路护航令 / 占港武装通缉）的 `lairCore` **已退役删除**（B 族无窝点），
   * 但 `data/context.ts` 的稀有残骸注册改用显式白名单 `RETIRED_LAIR_CARD_IDS` 保住旧档兼容。
   * 本契约四条（防止白名单腐烂 / 防止字段被加回来 / 防止退役卡复活成窝点候选）：
   * ①白名单里的 id **必须真实存在于 ANOMALIES**（写错 id = 白名单形同虚设，旧档照样"未知物品"）；
   * ②这些卡 **`lairCore` 必须确实为空**（否则"退役"没落地，或后人把字段加回来）；
   * ③这些卡**必须仍被 `isLairCandidate()` 排除**（否则退役卡重新变成窝点候选、又派发起来）；
   * ④对应的**稀有残骸物品仍能被注册**（在 ctx.items 里）——这正是白名单存在的唯一目的。 */
  {
    let retiredChecked = 0
    for (const id of RETIRED_LAIR_CARD_IDS) {
      const def = ANOMALIES_FLAVORED.find((d) => d.id === id)
      check(!!def, `退役窝点卡契约：白名单 id「${id}」在 ANOMALIES 里不存在（写错 id ⇒ 旧档稀有残骸照样认不出）`)
      if (!def) continue
      retiredChecked += 1
      check(
        !hasLairCore(def),
        `退役窝点卡契约：${def.name}（${def.id}）的 lairCore 应为空——2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」，` +
          `字段退役后**不得加回来**（旧档兼容已由 RETIRED_LAIR_CARD_IDS 白名单承接）`,
      )
      check(
        !isLairCandidate(def),
        `退役窝点卡契约：${def.name}（${def.id}）仍是窝点候选（isLairCandidate 为真）——退役卡不得重新派发窝点`,
      )
      const rareId = rareWreckItemIdOf(def.id)
      check(
        lairCtx.items.has(rareId),
        `退役窝点卡契约：旧档稀有残骸 ${rareId} 未注册（data/context.ts 的注册条件须含 RETIRED_LAIR_CARD_IDS.has(a.id)）` +
          `——否则旧档里已有的这件的会显示成"未知物品"`,
      )
    }
    console.log(
      `· 退役窝点卡契约：${retiredChecked} 张退役卡字段已清、白名单有效、稀有残骸仍可识别` +
        `（${[...RETIRED_LAIR_CARD_IDS].map((id) => rareWreckItemIdOf(id)).join(" / ")}）`,
    )
  }

  /* ── 洞内高级箱契约（2026-09-16 船长**甲1案**：`rareBoxThemePoolOf` 的洞内回落）──
   * 背景（当日玩家报障「**稀有残骸拆解只拆除了 300 钛钢合金**」）：**洞内 15 张卡从没配 `recycleLoot`**
   * ⇒ 高级箱第②支（未中族专属时的"特色装备"）恒空、只剩第③支那批矿物（常档 300 单位 · 基础池钛钢 65%）。
   * 裁定甲1 = 洞内卡回落**「军用备货柜」同款 MK3 池**抽 1 件。钉三件事：
   *  ① 回落池本身非空（MK3 池被清空 ⇒ 这条兜底会退化成"只有一批矿物"，红线）；
   *  ② 洞内每张卡的稀有残骸**能建出回收画像**；
   *  ③ 每张卡的**高级箱主题件池非空**（= 未中族专属时**必有装备**）。
   *  ⚠ 洞外卡一律回落空池 ⇒ 洞外行为逐字不变（用例另有对照钉子）。 */
  {
    const mk3 = wormholeMk3PoolOf(lairCtx)
    check(
      mk3.length > 0,
      '洞内高级箱契约：军用备货柜 MK3 池为空——洞内稀有残骸"未中族专属时的主题件回落"会退化成只剩矿物',
    )
    const bad: string[] = []
    for (const cardId of WORMHOLE_RARE_WRECK_CARD_IDS) {
      const profile = recycleProfileOf(lairCtx, rareWreckItemIdOf(cardId))
      if (!profile) {
        bad.push(`${cardId}（建不出回收画像）`)
        continue
      }
      const pool = rareBoxThemePoolOf(profile, wormholeRareBoxThemePoolOf(lairCtx, profile.anomalyId))
      if (pool.length === 0) bad.push(`${cardId}（高级箱主题件池为空）`)
    }
    check(bad.length === 0, `洞内高级箱契约：${bad.join(' · ')}`)
    console.log(
      `· 洞内高级箱契约：${WORMHOLE_RARE_WRECK_CARD_IDS.length} 张洞内卡的稀有残骸高级箱**主题件池均非空**` +
        `（未中族专属时回落军用备货柜 MK3 池 ${mk3.length} 件抽 1 件）`,
    )
  }

  /* ── 窝点地图级别契约（2026-09-10 船长定：档位由地图级别硬封顶） ──
   * ①每张窝点候选卡必须**显式标级**（`lairLevel` 缺省 3 只是"漏标不误伤"，不是可省；
   *   忘了标级的地图会永远出全档，与"越低级的图越出不了高档位"直接冲突）；
   * ②每个有窝点成员的敌族**至少一张 3 级**（船长 2026-09-10 定）——否则该族在日板上永远打不到深层；
   * ③（提示，不拦）同族内"级别更高而奖金更低"属反常，多半是标反了。 */
  {
    const levelByFam = new Map<string, number[]>()
    for (const def of ANOMALIES_FLAVORED) {
      if (!isLairCandidate(def)) continue
      const fam = def.foeFamily ?? '?'
      const lv = def.lairLevel
      check(
        lv === 1 || lv === 2 || lv === 3,
        `窝点级别契约：${def.name} 未标 lairLevel（须显式写 1/2/3——1 = 只出外围、2 = 到核心、3 = 全档）`,
      )
      if (lv === 1 || lv === 2 || lv === 3) levelByFam.set(fam, [...(levelByFam.get(fam) ?? []), lv])
    }
    for (const [fam, levels] of levelByFam) {
      check(
        levels.includes(3),
        `窝点级别契约：敌族 ${fam} 没有任何 3 级地图（船长 2026-09-10 定：每族至少一张 3 级，否则该族永远出不了深层档）`,
      )
      const cards = [...ANOMALIES_FLAVORED].filter((d) => isLairCandidate(d) && d.foeFamily === fam)
      for (const lo of cards) {
        for (const hi of cards) {
          if (lairLevelOf(hi) > lairLevelOf(lo) && hi.rewardIsk < lo.rewardIsk) {
            warn.push(
              `窝点级别提示：${fam} 族「${hi.name}」（级别 ${lairLevelOf(hi)}）奖金低于「${lo.name}」（级别 ${lairLevelOf(lo)}）——请复核级别是否标反`,
            )
          }
        }
      }
    }
    const levelCount = { 1: 0, 2: 0, 3: 0 }
    let total = 0
    for (const levels of levelByFam.values()) {
      for (const l of levels) {
        levelCount[l as 1 | 2 | 3] += 1
        total += 1
      }
    }
    console.log(
      `· 窝点级别契约：${total} 张候选卡全数显式标级（L1×${levelCount[1]} / L2×${levelCount[2]} / L3×${levelCount[3]}），` +
        `${levelByFam.size} 个敌族各至少一张 3 级`,
    )
  }

  /* ── 窝点派生契约（2026-09-11 加，船长裁决④「按甲处理」）──
   * 派生卡（`lairAnomalyOf`，tier 1/2/3）必须满足两条：
   * ① **每波单位数 ≥ 1**：旧路径的波表（`LAIR_WAVES`）按"每波几队"描述**旧路径**编队，
   *    而**舰级路径**的编队由 `slot.wave` 决定（**2026-09-11 起：边境/碎晶/信标 三张已按船长裁定
   *    显式分配 `wave: 0/1` 两波**，其余舰级路径卡仍在 `wave: 0`）⇒ 直接套用旧波表会让第 2/3 波
   *    **刷出 0 个单位**（探针实测）；舰级路径派生卡因此**不套旧波表**（按 `slot.wave` 接波），本例即守这件事——
   *    将来谁把波表接回舰级路径，这里立刻失败。
   * ② **派生后总血 / 总火力随 tier 单调不降、且不低于主题卡**：旧路径靠"威胁 → 血/火力曲线"自动变强；
   *    **舰级路径是绝对值、不会自己涨** ⇒ 派生时必须按「原威胁 → 派生威胁」的比例同乘 `hpMul`/`dmgMul`。
   *    （火力用"舰级单发 × dmgMul × 数量"作**单调性代理值**——不含命中/补偿，只比档位间强弱。）
   * 适用范围：② 只对**舰级路径**候选卡生效（旧路径由威胁曲线负责，天生随 tier 变强）。 */
  {
    /** 每波单位数：舰级路径数 `slot.wave`，旧路径读波表；无波表 = 单波 1 条 */
    const unitsInWave = (card: AnomalyDef, waveIdx: number): number => {
      const slots = card.ships
      if (slots && slots.length > 0) {
        return slots
          .filter((s) => (s.wave ?? 0) === waveIdx)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0)
      }
      const w = card.waves?.[waveIdx]
      return w ? Math.max(0, Math.floor(w.units ?? 1)) : waveIdx === 0 ? 1 : 0
    }
    /** 舰级路径派生卡的**总血 / 火力代理值**（绝对值口径，不含命中与多舰补偿——只比档位单调） */
    const hpOf = (card: AnomalyDef): number =>
      (card.ships ?? []).reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)), 0)
    const powerOf = (card: AnomalyDef): number =>
      (card.ships ?? []).reduce(
        (n, s) => n + s.ship.shotDmg * (s.dmgMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
        0,
      )
    let waveChecked = 0
    let scaledCards = 0
    for (const def of ANOMALIES_FLAVORED) {
      if (!isLairCandidate(def)) continue
      const isShipPath = !!def.ships && def.ships.length > 0
      let prevHp = isShipPath ? hpOf(def) : 0
      let prevPower = isShipPath ? powerOf(def) : 0
      for (const tier of [1, 2, 3] as const) {
        const lair = lairAnomalyOf(def, tier)
        // ① 每波 ≥ 1 单位（波表没写 = 单波）
        const waveCount = Math.max(1, lair.waves?.length ?? 1)
        for (let w = 0; w < waveCount; w++) {
          const units = unitsInWave(lair, w)
          waveChecked++
          check(
            units >= 1,
            `窝点派生契约：${def.name} 的 ${tier} 档派生卡**第 ${w + 1} 波刷出 0 个单位**——` +
              `舰级路径的编队由 \`slot.wave\` 决定，套用旧路径波表（LAIR_WAVES）会刷空（探针实测）；` +
              `舰级路径的窝点应维持单波（或按 \`slot.wave\` 显式分配条目后再接波次）`,
          )
        }
        if (!isShipPath) continue
        // ② 总血 / 火力随 tier **严格递增**，且第一档就高于主题卡
        // （"单调不降"若按 ≥ 判定，把缩放整个摘掉也能过——负向验证要求"摘掉即报错"，故用严格递增）
        const hpNow = hpOf(lair)
        const powerNow = powerOf(lair)
        check(
          hpNow > prevHp + 1e-6,
          `窝点派生契约：${def.name} 的 ${tier} 档派生卡总血 ${hpNow.toFixed(1)} **未高于**上一档/主题卡 ${prevHp.toFixed(1)}——` +
            `舰级路径是绝对值、不会随威胁自动变强，派生时必须按「原威胁 → 派生威胁」的比例缩放 \`hpMul\`（船长 2026-09-11 裁决④「按甲处理」）`,
        )
        check(
          powerNow > prevPower + 1e-6,
          `窝点派生契约：${def.name} 的 ${tier} 档派生卡火力代理值 ${powerNow.toFixed(1)} **未高于**上一档/主题卡 ${prevPower.toFixed(1)}——同上（须同乘 \`dmgMul\`）`,
        )
        prevHp = hpNow
        prevPower = powerNow
      }
      if (isShipPath) scaledCards++
    }
    console.log(
      `· 窝点派生契约：${scaledCards} 张舰级路径候选卡的 tier1/2/3 派生卡**总血与火力代理值随档严格递增**（且首档高于主题卡）；` +
        `${waveChecked} 个波次全部 ≥ 1 单位（舰级路径派生卡**不套旧 LAIR_WAVES 波表**，波次按 slot.wave 表达）`,
    )
  }
  /* 专属装备的"来源唯一"契约（2026-09-10 加；2026-09-10 扩到专属**物品**）：
   * 这批东西**只能**从高级箱（稀有残骸额外掉落）出——不得有**可购买**的市场卡、
   * 不得有碎片逆向配方、不得混进任何敌群的常规残骸主题池（否则普通残骸就能刷出窝点专属，稀释窝点价值）。
   * 2026-09-10 船长：G 族第一件改为**无人机物品**（`item.exclusive`），同一套契约对它同样成立。
   * ⚠ **2026-09-14 船长两条改判**：①「允许玩家挂卖…维持所有物品允许玩家挂卖」⇒ 允许**只收不卖**的市场卡
   * （玩家可挂卖，市场不出售现货）；②「专属无人机出一次性蓝图（每次制造50架）」⇒
   * 允许**一次性蓝图**存在，但**只许 `singleUse`**（普通蓝图仍禁——那等于开一条制造渠道）。 */
  {
    const lairGearIds = new Set<string>(Object.values(FOE_LAIR_GEAR).flat())
    const bpByModule = new Map<string, string>()
    for (const bp of BLUEPRINTS) if (bp.moduleId) bpByModule.set(bp.moduleId, bp.id)
    let marketCards = 0
    let itemGear = 0
    for (const id of lairGearIds) {
      const isModule = lairCtx.modules.has(id)
      const itemDef = lairCtx.items.get(id)
      const isBlueprint = lairCtx.blueprints.has(id)
      check(
        isModule || itemDef !== undefined || isBlueprint,
        `来源唯一契约：窝点专属 ${id} 既不是装备、物品也不是蓝图（id 无法解析）`,
      )
      const kindText = isModule ? '装备' : itemDef ? '物品' : '图纸'
      if (isBlueprint) {
        // 专属无人机的一次性图纸（2026-09-14）：**只许一次性**（普通图纸 = 变相开制造渠道）
        check(
          lairCtx.blueprints.get(id)?.singleUse === true,
          `来源唯一契约：窝点专属图纸 ${id} 必须是 singleUse（一次性）——普通图纸等于给专属件开制造渠道`,
        )
        continue
      }
      if (!isModule) {
        if (itemDef) {
          itemGear += 1
          check(
            itemDef.exclusive === true,
            `来源唯一契约：窝点专属物品 ${id} 必须标 exclusive（专属型号：渠道唯一、不入常规掉落）`,
          )
          // 2026-09-14：专属物品**只许一次性蓝图**（船长「专属无人机出一次性蓝图」）；
          // 普通图纸 = 变相开制造渠道，仍禁
          for (const bp of BLUEPRINTS) {
            if (bp.itemId !== id) continue
            check(
              bp.singleUse === true,
              `来源唯一契约：窝点专属物品 ${id} 的蓝图 ${bp.id} 必须是 singleUse（一次性）`,
            )
          }
          check(
            itemDef.kind === 'drone',
            `来源唯一契约：窝点专属物品 ${id} 目前只支持无人机类（kind = ${itemDef.kind}）`,
          )
        }
      }
      const bp = bpByModule.get(id)
      check(!bp, `来源唯一契约：窝点专属${kindText} ${id} 不得有蓝图（现被 ${bp} 产出；专属装备只能从高级箱出）`)
      const card = [...lairCtx.marketGoods.values()].find((g) => g.key === id || g.refId === id)
      // 2026-09-14：只收不卖的行**不算"上架"**（市场不出售现货 ⇒ 稀缺性不变）；可购买的行才违契约
      const sellableCard = card && card.playerBuyable !== false
      if (sellableCard) marketCards += 1
      check(
        !sellableCard,
        `来源唯一契约：窝点专属${kindText} ${id} 不得有**可购买**的市场卡（现被 ${card?.key} 上架卖现货；只收不卖行允许）`,
      )
      const frag = FRAGMENT_RECIPES[id]
      check(
        !frag,
        `来源唯一契约：窝点专属${kindText} ${id} 不得有碎片逆向配方（现指向 ${frag?.blueprintId}；专属装备只能从高级箱出）`,
      )
      for (const def of ANOMALIES_FLAVORED) {
        const inPool = [...(def.recycleLoot?.modules ?? []), ...(def.recycleLoot?.mk2 ?? [])].includes(id)
        check(
          !inPool,
          `来源唯一契约：窝点专属${kindText} ${id} 不得混进 ${def.name} 的常规残骸主题池（专属装备只能从高级箱出）`,
        )
      }
    }
    check(marketCards === 0, `来源唯一契约：窝点专属装备共 ${marketCards} 件在市场上架卖现货（应为 0）`)
    console.log(
      `· 来源唯一契约：${lairGearIds.size} 件窝点专属（装备 ${lairGearIds.size - itemGear} + 专属物品/图纸 ${itemGear}）` +
        `无**可购买**市场卡（只收不卖行允许 · 2026-09-14 船长「允许玩家挂卖」）、无碎片配方、不进常规掉落池（唯一来源＝高级箱）`,
    )
  }
  /* **挂卖可达契约**（2026-09-14 船长：「允许玩家挂卖，顺便检查下其他物品，维持所有物品允许玩家挂卖」）：
   * 三条判据——
   * ① **任何市场行都不得禁止玩家出售**（`playerSellable: false`）——"所有物品都允许挂卖"是硬口径；
   * ② **可获得的内容必须有市场行**（没行 = 挂不了卖也卖不掉，等于死物）。**例外表**只放"有意不补"的：
   *    协会保底艇（开局船，防卖光起步资产）与壳体（无任何获取渠道）——逐条写明理由；
   * ③ **专属内容的市场行必须"只收不卖"**（`playerBuyable: false`）：市场不出售现货（渠道与稀缺性不变），
   *    但玩家可挂卖、也可卖给 NPC 收购单（奇货档 = 全价回收）。判据 = id 带 `-wh-` 的洞内专属 +
   *    窝点专属池成员（`FOE_LAIR_GEAR`）。 */
  {
    // ① 全表可挂卖
    const notSellable = MARKET_GOODS.filter((g) => g.playerSellable === false).map((g) => g.key)
    check(
      notSellable.length === 0,
      `挂卖可达契约：${notSellable.join(' · ')} 标了 playerSellable: false——2026-09-14 船长「维持所有物品允许玩家挂卖」`,
    )
    // ② 可获得内容必须有市场行（例外表逐条写理由）
    const NO_ROW_OK: ReadonlyArray<readonly [string, string]> = [
      ['sandcat', '协会保底艇（开局船）：不给市场行，防"卖光起步资产"把新档卡死'],
      ['sh-dunkleosteus', '邓氏鱼级壳体：无蓝图、无掉落、无任何获取渠道（内容未做）⇒ 补行等于给拿不到的东西标价'],
    ]
    const noRowOk = new Set(NO_ROW_OK.map(([id]) => id))
    const rowKeys = new Set(MARKET_GOODS.map((g) => g.refId))
    const gaps: string[] = []
    for (const it of ITEMS) if (itemReleased(it) && !rowKeys.has(it.id) && !noRowOk.has(it.id)) gaps.push(`物品 ${it.id}`)
    for (const m of MODULES) if (itemReleased(m) && !rowKeys.has(m.id) && !noRowOk.has(m.id)) gaps.push(`装备 ${m.id}`)
    for (const s of SHIPS) if (itemReleased(s) && !rowKeys.has(s.id) && !noRowOk.has(s.id)) gaps.push(`舰船 ${s.id}`)
    for (const b of BLUEPRINTS) if (itemReleased(b) && !rowKeys.has(b.id) && !noRowOk.has(b.id)) gaps.push(`装备图纸 ${b.id}`)
    for (const b of SHIP_BLUEPRINTS) if (itemReleased(b) && !rowKeys.has(b.id) && !noRowOk.has(b.id)) gaps.push(`舰船图纸 ${b.id}`)
    check(
      gaps.length === 0,
      `挂卖可达契约：${gaps.length} 条可获得内容没有市场行（既挂不了卖也卖不掉）——${gaps.slice(0, 8).join(' · ')}${gaps.length > 8 ? ' …' : ''}；若要豁免请登记进 NO_ROW_OK 并写明理由`,
    )
    // ③ 专属内容"只收不卖"
    const exclusiveIds = new Set<string>([
      ...Object.values(FOE_LAIR_GEAR).flat(),
      ...[...moduleIdSet].filter((id) => id.includes('-wh-')),
      ...[...lairCtx.items.keys()].filter((id) => id.includes('-wh-')),
      ...[...lairCtx.blueprints.keys()].filter((id) => id.includes('-wh-')),
      ...[...lairCtx.shipBlueprints.keys()].filter((id) => id.includes('-wh-')),
      ...[...lairCtx.ships.keys()].filter((id) => id.includes('-wh-')),
    ])
    const sellableExclusive: string[] = []
    let exclusiveRows = 0
    for (const g of MARKET_GOODS) {
      if (!exclusiveIds.has(g.refId)) continue
      exclusiveRows += 1
      if (g.playerBuyable !== false) sellableExclusive.push(g.key)
    }
    check(
      sellableExclusive.length === 0,
      `挂卖可达契约：专属内容的市场行必须"只收不卖"（playerBuyable: false）——${sellableExclusive.slice(0, 8).join(' · ')} 在卖现货`,
    )
    console.log(
      `· 挂卖可达契约：市场 ${MARKET_GOODS.length} 行**全部允许玩家挂卖**（playerSellable 无 false）· 可获得内容无市场行的仅 ${NO_ROW_OK.length} 条有意例外（${NO_ROW_OK.map(([id]) => id).join(' / ')}）· 专属内容 ${exclusiveRows} 行**全部只收不卖**`,
    )
  }
  /* **图鉴市场跳转契约**（2026-09-14 船长：「玩家查看图鉴内的道具时，添加一个跳转市场的按钮」）：
   * 图鉴详情浮层那枚「↖ 查看市场」按 `cell.tab` → 市场 kind 映射到商品（渲染层单点 `handMarketKeyOf`，
   * 本处**跨层 import 同一个函数**逐个走一遍）。判据 = 四类图鉴目录里的条目都要能命中一行，
   * 放行四类（前两类是"**市场页本来就看不到它**"，不是漏行）：
   *   ① 能命中 ⇒ 正常；
   *   ② 市场行**被 `unreleased` 闸掉**（施工期市行，`buildMarketGoodsCatalog` 会过滤 ⇒ 市场页里搜不到，
   *      按钮本就不该显示）：谜质装置 24 + AI 核心 3；
   *   ③ 物品 kind = `wreck` / `fragment`：残骸**唯一变现 = 回收炉开箱**（隐藏卡残骸没有收购卡、
   *      稀有残骸明确"无市场卡"）、碎片不进市场 ⇒ 无行是设计；
   *   ④ 名单例外（理由同「挂卖可达契约」的 NO_ROW_OK）：协会保底艇 / 无渠道壳体。
   * 为什么值得一条常驻契约：映射错位（改图鉴主键语义、改某族的 market kind）不会报错，只会让
   * **整类图鉴的按钮静默消失**——玩家看不见"少了个按钮"，只有这条契约会点名。 */
  {
    const jumpCtx = buildSimContext()
    const handNoJumpOk = new Set(['sandcat', 'sh-dunkleosteus'])
    const unreleasedRowIds = new Set(
      MARKET_GOODS.filter((g) => (g as { unreleased?: boolean }).unreleased === true).map((g) => g.refId),
    )
    const noMarketItemKinds = new Set(['wreck', 'fragment'])
    const groups: Array<{ label: string; tab: string; ids: string[] }> = [
      { label: '物品图鉴', tab: 'items', ids: visibleItemDefs(jumpCtx).map((d) => d.id) },
      { label: '装备图鉴', tab: 'modules', ids: MODULES.filter((d) => itemReleased(d)).map((d) => d.id) },
      { label: '舰船图鉴', tab: 'ships', ids: SHIPS.filter((d) => itemReleased(d)).map((d) => d.id) },
      {
        label: '蓝图图鉴',
        tab: 'blueprints',
        ids: [...BLUEPRINTS, ...SHIP_BLUEPRINTS].filter((d) => itemReleased(d)).map((d) => d.id),
      },
    ]
    const noJump: string[] = []
    let checkedEntries = 0
    let skippedGated = 0
    let skippedKinds = 0
    for (const g of groups) {
      for (const id of g.ids) {
        checkedEntries += 1
        if (handMarketKeyOf(jumpCtx, g.tab, id) !== null) continue
        if (handNoJumpOk.has(id)) continue
        if (unreleasedRowIds.has(id)) {
          skippedGated += 1
          continue
        }
        const kind = String(jumpCtx.items.get(id)?.kind ?? '')
        if (g.tab === 'items' && noMarketItemKinds.has(kind)) {
          skippedKinds += 1
          continue
        }
        noJump.push(`${g.label} ${id}`)
      }
    }
    check(
      noJump.length === 0,
      `图鉴市场跳转契约：${noJump.length} 个图鉴条目查不到市场行（详情浮层的「↖ 查看市场」会不显示）——` +
        `${noJump.slice(0, 8).join(' · ')}${noJump.length > 8 ? ' …' : ''}；确实不该给按钮的请写进放行规则并注明理由`,
    )
    // 反向：不涉市场的页签**必须拿不到键**（防"给技能/说明页也挂上按钮"）
    const nonMarketTabs = ['guide', 'rules', 'skills']
    check(
      nonMarketTabs.every((t) => handMarketKeyOf(jumpCtx, t, 'anything') === null),
      '图鉴市场跳转契约：玩法速览 / 航行须知 / 技能速查不该命中市场商品（这些页签不给跳转按钮）',
    )
    console.log(
      `· 图鉴市场跳转契约：四类图鉴 ${checkedEntries} 个条目逐个走渲染层 \`handMarketKeyOf\` ⇒ ` +
        `可跳 ${checkedEntries - skippedGated - skippedKinds - handNoJumpOk.size} 条 · ` +
        `市行被 unreleased 闸掉 ${skippedGated}（谜质装置 / AI 核心：市场页本就搜不到）· ` +
        `残骸/碎片无市场卡 ${skippedKinds}（唯一变现 = 回收炉）· ` +
        `名单例外 ${handNoJumpOk.size}（${[...handNoJumpOk].join(' / ')}）· 说明类页签恒不命中`,
    )
  }
  /**
   * **洞内非商品契约**（2026-09-14 船长报障后加 · 常驻防回归）——
   *
   * 报障原话：「**谜质出现在了市场内，还有一些虫洞专属产物也出现在市场内并且可以购买**」；
   * 定性时的追加口径：「**AI核心已经存在了**」＋「谜质则不一样，**需要设置不出现在市场**」。
   *
   * 根因（值得记住）：这批卡原本是"照『每种物品必须有市场卡』的既有契约补卡 + `unreleased` 施工期闸门"，
   * 注释里写着「**上线动作 = 删这个字段**」；上线那批照注释删了 ⇒ 它们变成 `rarity: 'common'` 的**常驻现货**，
   * 市场按"单件平价品"铺供应单（价 = `basePrice 1` ×1.06 ≈ **1 信用点**）⇒ 1 块钱买走谜质储存器/货柜/AI 核心实物。
   * **"不上市交易"这个意图本来靠 `unreleased` 实现**，删字段时没人核这一层 ⇒ 本契约把它钉死。
   *
   * 三条口径：
   * - ① **谜质储存器**（`WORMHOLE_MATTER_DEVICE_IDS`）：本趟生效、离开即消失 ⇒ 市场行必须 **`unreleased`**；
   * - ② **AI 核心实物**（`WORMHOLE_CORE_ITEM_IDS`）：撤离即转核心账本、**永不进仓库**，且市场已有
   *   `core-basic/gamma/beta/alpha` 四档账本核心 ⇒ 同上 **`unreleased`**（不再给第二张卡）；
   * - ③ **洞内货柜**（`box-relic-*` / `box-bp-*`）：会带回仓库、可拆解也可换现 ⇒ **允许有市场行**，
   *   但必须 **`playerBuyable: false`**（不出售现货，否则花钱就能买箱子、把洞内打捞这条渠道架穿）
   *   且 **`basePrice > 1`**（价 = 内容期望市值 ×0.6，不能再是"1 信用点的垃圾价"）。
   */
  {
    /** 洞内货柜 = 模块级那张 `containerIds`（安全货柜 5 + 图纸货柜 3，与拆解契约同一个出处） */
    const boxIds = containerIds
    const shouldHide = [...matterDeviceIds, ...aicoreItemIds]
    const leaked: string[] = []
    const visible = new Set<string>(buildMarketGoodsCatalog().keys())
    for (const g of MARKET_GOODS) {
      if (shouldHide.includes(g.refId) && g.unreleased !== true) leaked.push(`${g.key}（应不出现在市场）`)
    }
    for (const id of shouldHide) {
      if (visible.has(id)) leaked.push(`${id}（在 ctx.marketGoods 里——玩家看得到也买得到）`)
    }
    check(
      leaked.length === 0,
      `洞内非商品契约：${leaked.length} 处漏卖（2026-09-14 船长报障「谜质出现在了市场内…并且可以购买」）——` +
        `谜质储存器与 AI 核心实物必须 \`unreleased: true\`（不进市场）；${leaked.slice(0, 8).join(' · ')}`,
    )
    const boxBad: string[] = []
    for (const g of MARKET_GOODS) {
      if (!boxIds.has(g.refId)) continue
      if (g.playerBuyable !== false) boxBad.push(`${g.key}（在卖现货）`)
      if ((g.basePrice ?? 0) <= 1) boxBad.push(`${g.key}（basePrice 还是 ${g.basePrice}）`)
    }
    check(
      boxBad.length === 0,
      `洞内非商品契约：洞内货柜必须"只收不卖 + 有像样的价"（基础价 = 内容期望市值 ×0.6）——${boxBad.slice(0, 8).join(' · ')}`,
    )
    /**
     * ④ **洞内产出链**（2026-09-14 船长：「**虚空晶和虚空母矿也添加只收不卖。**」＋
     *   「**市场不会出现虚空晶和母矿的卖单。**」）：虚空母矿与虚空晶必须 `playerBuyable: false`
     *   ——市场不出售现货（NPC 侧一笔卖单都不铺，见 `core/market.ts seedCommonBook` 的门），
     *   否则"花钱买原矿/晶体"就能跳过洞内挖矿与精炼这条链。**收购照常**（玩家可以卖）。
     */
    const chainBad: string[] = []
    for (const id of ['ore-voidmother', 'min-voidcrystal']) {
      const g = MARKET_GOODS.find((x) => x.refId === id)
      if (!g) chainBad.push(`${id}（没有市场行 ⇒ 带回来的产出卖不掉）`)
      else if (g.playerBuyable !== false) chainBad.push(`${g.key}（在卖现货）`)
    }
    check(
      chainBad.length === 0,
      `洞内非商品契约：洞内产出链（虚空母矿 / 虚空晶）必须"只收不卖"——${chainBad.join(' · ')}`,
    )
    console.log(
      `· 洞内非商品契约：谜质 ${matterDeviceIds.size} 台 + AI 核心实物 ${aicoreItemIds.size} 种**均不在市场目录** · 洞内货柜 ${boxIds.size} 种**只收不卖**且基础价 > 1 · 洞内产出链 2 种（虚空母矿 / 虚空晶）**只收不卖**`,
    )
  }
  /**
   * **虫洞战利品与经济扩充契约**（船长 2026-09-15 确认；口径见 `docs/glossary.md` 八之二「战利品四件」
   * 与 `docs/roadmap.md` 滚动窗口里那一批）。
   *
   * 七组哨（都在"改一处必红"的位置上）：
   * - ① **谜质只收不卖**（船长「该物品只收不卖」）：市场行必须存在、`playerBuyable: false`、
   *   且**行价 = 物品卡价**（70,000）——不让"卡上一个价、市场另一个价"这种两套口径出现；
   * - ② **奢侈品正常交易**（船长「奢侈品纯粹用来卖钱，市场正常交易」＋「奢侈品是精炼拆解后的，不算在内」）：
   *   三档必须 **可买**（`playerBuyable !== false`）且 **`common` 常驻**（否则内容体检另有一条
   *   "非常驻 ⇒ 玩家产出无法稳定卖出"的预警，等于"卖不掉的钱"）；
   * - ③ **拆解件数/概率哨**：谜质 1 台 = 1 枚 · 奢侈品 5~30 件 · 军用 1~3 件 · 打捞 0.75% 每堆 / 上限 1；
   * - ④ **四类货柜池齐备**：安全柜（按族）· 图纸柜三档 · 贵重品柜 · 军用柜，**类等权 4 类**，
   *   且**每个 id 都有形状登记与市场行**（否则掷中了却放不进、卖不掉）；
   * - ⑤ **军用拆解池排除专属（反向守卫）**：非空 · 一律 `-3` 结尾 · **不含** `-wh-`（洞内族专属）、
   *   `mod-lair-*`（窝点专属）与 `unreleased` · **含三把常备 MK3 武器**（船长「含武器」）；
   * - ⑥ **常量与 data 同步**：两个新货柜 id 必须在物品目录里（core 侧常量写的是字面量，靠这条钉住）。
   */
  {
    const itemsById = new Map(ITEMS.map((i) => [i.id, i] as const))
    const rowOf = (id: string): (typeof MARKET_GOODS)[number] | undefined =>
      MARKET_GOODS.find((g) => g.kind === 'item' && g.refId === id)
    // ① 谜质
    {
      const row = rowOf(WORMHOLE_ESSENCE_ITEM_ID)
      const card = itemsById.get(WORMHOLE_ESSENCE_ITEM_ID)
      const bad: string[] = []
      if (!row) bad.push('没有市场行（带回来的谜质卖不掉）')
      else {
        if (row.playerBuyable !== false) bad.push('在卖现货（应只收不卖）')
        if (card && row.basePrice !== card.baseSellPriceIsk) {
          bad.push(`行价 ${row.basePrice} ≠ 物品卡价 ${card.baseSellPriceIsk}`)
        }
      }
      if (!card) bad.push('物品目录里没有这张卡')
      check(bad.length === 0, `战利品扩充契约①：虫洞谜质必须"只收不卖 + 行价 = 卡价"——${bad.join(' · ')}`)
    }
    // ② 奢侈品三档
    {
      const bad: string[] = []
      for (const id of WORMHOLE_LUXURY_ITEM_IDS) {
        const row = rowOf(id)
        const card = itemsById.get(id)
        if (!card) bad.push(`${id}（物品目录里没有这张卡）`)
        if (!row) {
          bad.push(`${id}（没有市场行 ⇒ 卖不掉）`)
          continue
        }
        if (row.playerBuyable === false) bad.push(`${row.key}（只收不卖 ⇒ 与"市场正常交易"相反）`)
        if (row.rarity !== 'common') bad.push(`${row.key}（${row.rarity} ⇒ 非常驻、产出无法稳定卖出）`)
        if (card && row.basePrice !== card.baseSellPriceIsk) bad.push(`${row.key}（行价 ${row.basePrice} ≠ 卡价 ${card.baseSellPriceIsk}）`)
      }
      check(bad.length === 0, `战利品扩充契约②：奢侈品三档必须"可买可卖 + 常驻 + 行价 = 卡价"——${bad.join(' · ')}`)
    }
    // ③ 件数与概率哨
    {
      const want: Array<[string, number, number]> = [
        ['谜质每台枚数 WORMHOLE_ESSENCE_PER_DEVICE', WORMHOLE_ESSENCE_PER_DEVICE, 1],
        ['奢侈品件数下限 WORMHOLE_VALUABLES_UNITS_MIN', WORMHOLE_VALUABLES_UNITS_MIN, 5],
        ['奢侈品件数上限 WORMHOLE_VALUABLES_UNITS_MAX', WORMHOLE_VALUABLES_UNITS_MAX, 30],
        ['军用件数下限 WORMHOLE_MILITARY_PIECES_MIN', WORMHOLE_MILITARY_PIECES_MIN, 1],
        ['军用件数上限 WORMHOLE_MILITARY_PIECES_MAX', WORMHOLE_MILITARY_PIECES_MAX, 3],
        ['残骸堆出货率 WORMHOLE_SALVAGE_BOX_CHANCE', WORMHOLE_SALVAGE_BOX_CHANCE, 0.0075],
        ['单次打捞上限 WORMHOLE_SALVAGE_BOX_MAX', WORMHOLE_SALVAGE_BOX_MAX, 1],
      ]
      const bad = want.filter(([, got, exp]) => got !== exp).map(([name, got, exp]) => `${name} = ${got}（应为 ${exp}）`)
      check(bad.length === 0, `战利品扩充契约③：数值与船长口径不符——${bad.join(' · ')}`)
    }
    // ④ 四类货柜池齐备
    {
      const classes = wormholeSalvageBoxClassesOf(WORMHOLE_FAMILY_ORDER[0]!)
      const bad: string[] = []
      if (classes.length !== 4) bad.push(`类数 ${classes.length}（应为 4 类等权）`)
      for (const cls of classes) {
        if (cls.length === 0) bad.push('有一类是空的')
        for (const id of cls) {
          if (!itemsById.has(id)) bad.push(`${id}（物品目录里没有）`)
          if (!wormholeIsShapedItem(id)) bad.push(`${id}（没有形状登记 ⇒ 掷中了放不进仓）`)
          if (!rowOf(id)) bad.push(`${id}（没有市场行 ⇒ 拆不出也卖不掉）`)
        }
      }
      check(bad.length === 0, `战利品扩充契约④：四类货柜池必须齐备——${bad.slice(0, 8).join(' · ')}`)
    }
    // ⑤ 军用拆解池排除专属（反向守卫）
    {
      const mk3Ctx = buildSimContext()
      const pool = wormholeMk3PoolOf(mk3Ctx)
      const bad: string[] = []
      if (pool.length === 0) bad.push('池是空的（军用柜会开出空气）')
      for (const id of pool) {
        if (!id.endsWith('-3')) bad.push(`${id}（不是 MK3）`)
        if (id.includes('-wh-')) bad.push(`${id}（洞内族专属混进了军用池）`)
        if (id.startsWith('mod-lair-')) bad.push(`${id}（窝点专属混进了军用池）`)
        if (mk3Ctx.modules.get(id)?.unreleased === true) bad.push(`${id}（未上线件混进了军用池）`)
      }
      for (const w of ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3']) {
        if (!pool.includes(w)) bad.push(`${w}（三把常备 MK3 武器应在池里——船长「含武器」）`)
      }
      check(bad.length === 0, `战利品扩充契约⑤：军用拆解池必须"含武器、不含专属"——${bad.slice(0, 8).join(' · ')}`)
      /**
       * ⑧ **贵重品货柜的箱价口径**（船长 2026-09-15 改判：「**单价差距提高（10/40/200万），数量上下限拉大到 5~30，
       *   箱价 = 内容期望 ×0.25**」）：这条是**本箱专属折扣**（其余三类柜仍是 ×0.6）⇒ 单独钉一次，
       *   免得日后调奢侈品价或件数时忘了同步箱价（"箱价高于拆解期望"会让玩家只卖箱不拆箱）。
       *   期望 = 三档均价 × 件数均值；取整容差 ±1%。
       */
      const luxPrices = WORMHOLE_LUXURY_ITEM_IDS.map((id) => rowOf(id)?.basePrice ?? 0)
      if (luxPrices.some((p) => p <= 0)) {
        bad.push('奢侈品三档里有行价 ≤ 0 的（箱价期望算不出来）')
      } else {
        const meanPiece = luxPrices.reduce((s, p) => s + p, 0) / luxPrices.length
        const meanUnits = (WORMHOLE_VALUABLES_UNITS_MIN + WORMHOLE_VALUABLES_UNITS_MAX) / 2
        const ev = meanPiece * meanUnits
        const boxPrice = rowOf(WORMHOLE_VALUABLES_BOX_ID)?.basePrice ?? 0
        const want = ev * 0.25
        if (Math.abs(boxPrice - want) > want * 0.01) {
          bad.push(
            `贵重品货柜箱价 ${Math.round(boxPrice).toLocaleString('zh-CN')} ≠ 内容期望 ` +
              `${Math.round(ev).toLocaleString('zh-CN')} ×0.25 = ${Math.round(want).toLocaleString('zh-CN')}（±1%）`,
          )
        }
        console.log(
          `· 贵重品货柜读数：奢侈品 ${(WORMHOLE_VALUABLES_UNITS_MIN + '~' + WORMHOLE_VALUABLES_UNITS_MAX)} 件 × 均价 ` +
            `${Math.round(meanPiece).toLocaleString('zh-CN')}（${luxPrices.map((p) => Math.round(p / 10_000) + '万').join('/')}）` +
            ` ⇒ 一箱期望 ${Math.round(ev).toLocaleString('zh-CN')} · 箱价 ${Math.round(boxPrice).toLocaleString('zh-CN')}（= ×0.25）`,
        )
      }
      /**
       * ⑨ **箱价两处一致 + 军用柜的 ×0.6 口径**（2026-09-15 补的空白：批 A 曾出现"物品卡改了价、市场行没跟"
       *   ⇒ 同一个箱子两张价；而 0.6 这条折扣此前只写在注释里，没人算过）。
       *   - **卡价 = 行价**：两个新货柜的物品卡 `baseSellPriceIsk` 必须等于市场行 `basePrice`；
       *   - **军用柜 = MK3 池期望 ×0.6**（池内等权、件数均值 2）——"箱价高于拆解期望"会诱导只卖箱不拆箱。
       */
      for (const id of [WORMHOLE_VALUABLES_BOX_ID, WORMHOLE_MILITARY_BOX_ID]) {
        const card = itemsById.get(id)
        const row = rowOf(id)
        if (card && row && card.baseSellPriceIsk !== row.basePrice) {
          bad.push(`${id}：物品卡价 ${card.baseSellPriceIsk} ≠ 市场行价 ${row.basePrice}（同物两价）`)
        }
      }
      {
        const mk3Rows = wormholeMk3PoolOf(buildSimContext())
          .map((id) => rowOf(id)?.basePrice ?? 0)
          .filter((p) => p > 0)
        const piecesMean = (WORMHOLE_MILITARY_PIECES_MIN + WORMHOLE_MILITARY_PIECES_MAX) / 2
        if (mk3Rows.length > 0) {
          const meanPiece = mk3Rows.reduce((s, p) => s + p, 0) / mk3Rows.length
          const ev = meanPiece * piecesMean
          const want = ev * 0.6
          const got = rowOf(WORMHOLE_MILITARY_BOX_ID)?.basePrice ?? 0
          if (Math.abs(got - want) > want * 0.01) {
            bad.push(
              `军用备货柜箱价 ${Math.round(got).toLocaleString('zh-CN')} ≠ MK3 期望 ${Math.round(ev).toLocaleString('zh-CN')} ×0.6 = ${Math.round(want).toLocaleString('zh-CN')}（±1%）`,
            )
          }
          console.log(
            `· 军用备货柜读数：MK3 池均价 ${Math.round(meanPiece).toLocaleString('zh-CN')} × 期望 ${piecesMean} 件 ⇒ ` +
              `期望 ${Math.round(ev).toLocaleString('zh-CN')} · 箱价 ${Math.round(got).toLocaleString('zh-CN')}（= ×0.6）`,
          )
        }
      }
      check(bad.length === 0, `战利品扩充契约⑤/⑧/⑨：军用拆解池 · 箱价口径 · 卡价=行价——${bad.slice(0, 8).join(' · ')}`)
      console.log(
        `· 战利品扩充契约：谜质 1 台→${WORMHOLE_ESSENCE_PER_DEVICE} 枚 · 奢侈品 ${WORMHOLE_VALUABLES_UNITS_MIN}~${WORMHOLE_VALUABLES_UNITS_MAX} 件（三档可买可卖）· ` +
          `军用 MK3 ${WORMHOLE_MILITARY_PIECES_MIN}~${WORMHOLE_MILITARY_PIECES_MAX} 件（池 ${pool.length} 件）· ` +
          `残骸堆 ${(WORMHOLE_SALVAGE_BOX_CHANCE * 100).toFixed(2)}%/堆（单次上限 ${WORMHOLE_SALVAGE_BOX_MAX}）· 四类货柜等权`,
      )
    }
    // ⑥ 两个新货柜 id 常量与 data 同步
    {
      const bad: string[] = []
      for (const [name, id] of [
        ['WORMHOLE_VALUABLES_BOX_ID', WORMHOLE_VALUABLES_BOX_ID],
        ['WORMHOLE_MILITARY_BOX_ID', WORMHOLE_MILITARY_BOX_ID],
      ] as const) {
        if (!itemsById.has(id)) bad.push(`${name} = ${id}（物品目录里没有这个 id）`)
        if (!rowOf(id)) bad.push(`${name} = ${id}（没有市场行）`)
        if (!wormholeIsShapedItem(id)) bad.push(`${name} = ${id}（没有形状登记）`)
      }
      check(bad.length === 0, `战利品扩充契约⑥：core 常量与 data 目录必须同步——${bad.join(' · ')}`)
    }
    /**
     * ⑩ **卡片敌情契约**（船长 2026-09-16：「扫描虫洞界面，给虫洞卡片添加更多信息
     *   （虫洞内是什么敌人，以什么类型伤害为主）」）：五族 × 三档都必须能算出
     *   **非空卡名 + 非空火力构成 + 非空主系文案**——否则扫描页那行会显示内部 id 或空白。
     *   ⚠ 五张洞内卡都是 `hidden`（不进悬赏目录）⇒ 这里必须用 `ctx.anomalies` **全表**取值，
     *   与 `engine.wormholeFamilyIntel` 同一把尺（2026-09-14 那次漏出 `wh-alien-swarm` 的坑）。
     */
    {
      const intelCtx = buildSimContext()
      const bad: string[] = []
      for (const fam of WORMHOLE_FAMILY_ORDER) {
        const it = wormholeFamilyIntel(fam, intelCtx)
        if (!it.ethnic) bad.push(`${fam} 族没有族称`)
        if (!it.primaryText) bad.push(`${fam} 族没有主系文案`)
        if (!it.firstCardName || it.firstCardName.startsWith('wh-')) bad.push(`${fam} 族浅层卡名取不到（漏出内部 id）`)
        if (it.tiers.length !== WORMHOLE_CARD_TIERS.length) bad.push(`${fam} 族三档不全（${it.tiers.length}）`)
        for (const t of it.tiers) {
          if (!t.cardName || t.cardName.startsWith('wh-')) bad.push(`${fam}/${t.tier} 卡名取不到`)
          if (t.parts.length === 0) bad.push(`${fam}/${t.tier} 火力构成为空`)
          const sum = t.parts.reduce((s, p) => s + p.share, 0)
          if (Math.abs(sum - 1) > 1e-6) bad.push(`${fam}/${t.tier} 构成份额之和 ${sum.toFixed(3)} ≠ 1`)
        }
      }
      check(bad.length === 0, `卡片敌情契约：五族"族称 + 主系 + 三档构成"必须齐备——${bad.slice(0, 8).join(' · ')}`)
      console.log(
        `· 卡片敌情读数：${WORMHOLE_FAMILY_ORDER.map((f) => {
          const it = wormholeFamilyIntel(f, intelCtx)
          return `${f} ${it.ethnic}「${it.primaryText}」`
        }).join(' · ')}`,
      )
    }
    /**
     * ⑦ **遗迹掉落池**（船长 2026-09-15 改判：「**遗迹出货柜概率提高到70%，货柜类型改为所有货柜中随机，
     *   贵重品货柜占比50%**」）：概率固定 70%（层 2 起、层 1 恒 0）· 贵重品柜占 50% ·
     *   池 = **10 种**（贵重品柜 + 安全柜五族 + 图纸柜三档 + 军用柜），每种都要"有卡 + 有形状 + 有市场行"。
     *   ⚠ 两条旧口径已作废（概率 12%×1.3 封顶 50% · 安全柜 50 : 图纸货柜 50）。
     */
    {
      const bad: string[] = []
      if (wormholeRelicChanceOf(1) !== 0) bad.push(`层 1 概率 ${wormholeRelicChanceOf(1)}（应恒 0）`)
      for (const d of [2, 4, 9]) {
        if (wormholeRelicChanceOf(d) !== WORMHOLE_RELIC_BOX_CHANCE) bad.push(`层 ${d} 概率 ${wormholeRelicChanceOf(d)} ≠ ${WORMHOLE_RELIC_BOX_CHANCE}`)
      }
      if (WORMHOLE_RELIC_BOX_CHANCE !== 0.7) bad.push(`遗迹出货柜概率 = ${WORMHOLE_RELIC_BOX_CHANCE}（应为 0.7）`)
      if (WORMHOLE_RELIC_VALUABLES_SHARE !== 0.5) bad.push(`贵重品柜占比 = ${WORMHOLE_RELIC_VALUABLES_SHARE}（应为 0.5）`)
      const relicPool = wormholeRelicBoxPoolOf(buildSimContext())
      if (relicPool.length !== 10) bad.push(`池 = ${relicPool.length} 种（应为 10：贵重品柜 + 其余 9）`)
      if (!relicPool.includes(WORMHOLE_VALUABLES_BOX_ID)) bad.push('池里没有贵重品货柜')
      const relicOthers = relicPool.filter((id) => id !== WORMHOLE_VALUABLES_BOX_ID)
      for (const [label, want] of [
        ['五族安全柜', ['box-relic-a', 'box-relic-c', 'box-relic-d', 'box-relic-e', 'box-relic-g']],
        ['图纸柜三档', [...WORMHOLE_BP_BOX_IDS]],
        ['军用柜', [WORMHOLE_MILITARY_BOX_ID]],
      ] as const) {
        for (const id of want) if (!relicOthers.includes(id)) bad.push(`${label}缺 ${id}`)
      }
      for (const id of relicPool) {
        if (!itemsById.has(id)) bad.push(`${id}（物品目录里没有）`)
        if (!wormholeIsShapedItem(id)) bad.push(`${id}（没有形状登记 ⇒ 掉出来放不进仓）`)
        if (!rowOf(id)) bad.push(`${id}（没有市场行）`)
      }
      check(bad.length === 0, `战利品扩充契约⑦：遗迹掉落池必须"70% · 贵重品 50% · 10 种齐备"——${bad.slice(0, 8).join(' · ')}`)
      console.log(
        `· 遗迹掉落契约：层 2 起固定 ${(WORMHOLE_RELIC_BOX_CHANCE * 100).toFixed(0)}%（层 1 恒 0）· 池 ${relicPool.length} 种 ⇒ ` +
          `贵重品柜 ${(WORMHOLE_RELIC_VALUABLES_SHARE * 100).toFixed(0)}% + 其余 9 种各 ${((WORMHOLE_RELIC_VALUABLES_SHARE / 9) * 100).toFixed(1)}%`,
      )
    }
  }
  // 日板席位可行性（2026-09-10 船长定：高安不派发，中安 2 席 + 低安 3 席）：各区都要有候选可抽
  const zoneCount = { 中安: 0, 低安: 0 }
  for (const def of ANOMALIES_FLAVORED) {
    if (!isLairCandidate(def)) continue
    // 2026-09-12：改读 `securityZoneOf`（**单一出处**）——此前这里**内联重算**了分区边界，
    // 船长裁定「0 也算低安」后它仍是旧边界 `v >= 0`，与 `securityZoneOf`（`v > 0`）成了两套口径（已修）
    const zone = securityZoneOf(lairCtx, def.galaxyId)
    if (zone === '中安') zoneCount.中安 += 1
    else if (zone === '低安') zoneCount.低安 += 1
  }
  for (const plan of BOUNTY_ZONE_PLAN) {
    const have = plan.zone === '高安' ? 0 : zoneCount[plan.zone as '中安' | '低安']
    check(
      have >= plan.count,
      `日板席位：${plan.zone} 需 ${plan.count} 个候选地点，实际只有 ${have} 个（抽不满就少发，请补内容）`,
    )
  }
  // 敌对派系活跃（2026-09-10）：候选 = 中安/低安星系的常驻悬赏（非隐藏、有核心词、奖金 > 0）——
  // 至少要有 1 个，否则这条置顶任务永远刷不出来
  const factionPool = new Set<string>()
  for (const def of ANOMALIES_FLAVORED) {
    if (!hasLairCore(def) || !(def.rewardIsk > 0)) continue
    const sec = lairCtx.galaxies.get(def.galaxyId)?.security
    const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
    if (v >= 0.5) continue
    factionPool.add(def.galaxyId)
  }
  check(
    factionPool.size > 0,
    '派系活跃：中安/低安至少要有一个可作目标的星系（常驻悬赏），否则这条置顶任务永远刷不出来',
  )
  console.log(
    `· 派系活跃：候选 ${factionPool.size} 个中安/低安星系（掉落概率 ${Math.round(FACTION_RARE_DROP_CHANCE * 100)}% ×${FACTION_RARE_DROP_COUNT} 件，船长 2026-09-10 核定；` +
      `**含保底**——连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出必掉，实际 ≈${(factionRareDropEffectiveRate() * 100).toFixed(1)}%/趟，船长 2026-09-11）`,
  )
  console.log(`· 窝点契约：${lairCards} 张窝点卡（稀有残骸 + 三档称呼 + 专属装备齐备，覆盖 ${famWithGear.size} 个敌族）`)
}

/* ── AI 扩容技能契约（2026-09-11 加）：工业专用工位扩容表里的技能 id 必须真实存在 ──
 * 背景：`balance.aiCore.industrySkillSlots` 是「技能 id → 每级工位数」的表；**写错 id 不会报错**，
 * 只会静默不生效（玩家练满也没工位）——在这里拦住；同时打印"满级合计"，与设计口径对照。 */
{
  const table = DEFAULT_BALANCE.aiCore.industrySkillSlots
  const ids = Object.keys(table ?? {})
  check(ids.length > 0, 'AI 扩容技能契约：工业专用工位扩容表不得为空')
  const catalog = new Map(SKILLS.map((s) => [s.id, s]))
  let total = 0
  const shown: string[] = []
  for (const id of ids) {
    const per = table[id] ?? 0
    const def = catalog.get(id)
    check(Boolean(def), `AI 扩容技能契约：${id} 不在技能目录中（写错 id 会静默不生效）`)
    check(Number.isInteger(per) && per > 0, `AI 扩容技能契约：${id} 的每级工位数应为正整数，实际 ${per}`)
    total += per * MAX_SKILL_LEVEL
    shown.push(`${def?.name ?? id}(rank${def?.rank ?? "?"}) +${per}/级`)
  }
  // 反向护栏（2026-09-11）：技能说明里承诺了「工业专用工位」的技能，必须在扩容表里——
  // 否则会出现"练满也不生效"的静默失效（删表/改名/新增技能漏登记都会被抓到）。
  for (const s of SKILLS) {
    if (!s.description.includes('工业专用工位')) continue
    check(
      ids.includes(s.id),
      `AI 扩容技能契约：技能「${s.name}」(${s.id}) 说明里承诺工业专用工位，却不在 balance.aiCore.industrySkillSlots 表里（练满也不生效）`,
    )
  }
  const sharedCap = MAX_SKILL_LEVEL // 共用上限满级 = AI 核心操作学满级（每级 +1）
  console.log(
    `· AI 扩容技能契约：${ids.length} 个工业工位技能（${shown.join("、")}）→ 满级站内工位 = 共用 ${sharedCap} + 扩容 ${total} = ${sharedCap + total}`,
  )
}

/* ── 模块跨族字段契约（2026-09-11 加；船长反馈「赃物强化舱的属性并没有显示装甲容量的加成数值」）──
 * 背景：模块的界面呈现**按槽位分支**（装甲槽画装甲、货舱槽画货舱……），所以"槽位族之外的搭车加成"
 * 一旦出现，就很容易被界面整段吞掉（赃物强化舱 = 货舱槽 + 装甲容量 15% 就是典型；生体甲壳板 = 装甲槽 +
 * 自愈在信息卡里也曾漏）。界面侧已加"跨族尾巴"补齐，这里再加一道**数据侧护栏**：
 *   「字段归属槽位 ≠ 本件槽位」的组合必须逐一登记在白名单里 —— 新增一件跨族件时，
 *   契约会报错提醒"先确认界面能显示、再登记"，避免又出现静默漏显示。
 * 字段归属表与界面 `crossFamilyLines`（apps/desktop .../ui/shipInfo.tsx）保持同一口径。 */
{
  /** 字段 → 归属槽位（"本职"归属；写在其它槽位上即视为跨族） */
  const OWNER: Record<string, string> = {
    bonus: 'miner|cargo',
    shieldHpBonus: 'shield',
    shieldResistAdd: 'shield',
    // 护盾充能装置（2026-09-14 船长新增件）：本职属护盾槽
    shieldPulsePct: 'shield',
    armorHpBonus: 'armor',
    armorResistAdd: 'armor',
    speedPenaltyPct: 'armor',
    hullHpBonus: 'armor',
    hullResistAdd: 'armor',
    speedBonusPct: 'propulsion',
    hitPenalty: 'propulsion',
    droneBayBonusM3: 'drone-rack',
    droneDmgBonus: 'drone-tac',
    droneRangeBonusPct: 'drone-relay',
    damageTypeBonusPct: 'support',
    reloadCutPct: 'support',
    hitBonusPct: 'support',
    evasionGapPct: 'support',
    repairArmorHp: 'support',
    repairHullHp: 'support',
    repairKit: 'support',
    lockDmgBonus: 'target-lock',
    // 2026-09-15 隐秘行动装置：隐身窗口（本职 = 支援件族；高槽 rack 由支援件契约另行钉住）
    stealthMs: 'support',
    // 2026-09-11 协处理器：CPU 预算扩容（本职在 cpu 族；写在别的槽位上才算跨族，需登记）
    cpuBonus: 'cpu',
    /* ═══ 2026-09-13 虫洞专属装备引出的新字段（本职归属；写在别的槽位上即跨族，需登记）═══ */
    secondaryDamagePct: 'turret|missile|laser', // 附加伤害段（武器专职）
    secondaryDamageType: 'turret|missile|laser',
    ammoPerShot: 'turret|missile|laser',
    rangeCutPct: 'turret|missile|laser', // 全武器射程削减（武器件专职）
    rangeTypeBonusPct: 'turret|missile|laser', // 按系射程加成
    damageBonusPct: 'support', // 通用单发加成（支援件族）
    reloadPenaltyPct: 'support', // 装填惩罚（支援件族）
    allResistPenaltyPct: 'armor', // 全层抗性削减（装甲族）
    droneCycleCutPct: 'drone-rack', // 无人机出击周期（甲板扩展族）
  }
  /** 已核过界面呈现的跨族组合（id:字段）——新增组合必须先确认能显示再登记 */
  const REGISTERED: readonly string[] = [
    'mod-lair-cargo-a:armorHpBonus', // 赃物强化舱（货舱槽 + 装甲容量）→ 界面「装甲容量 +15%」
    'mod-lair-armor-c:repairArmorHp', // 生体甲壳板（装甲槽 + 自愈）→ 信息卡「生体自愈」
    'mod-lair-dc-c:hullResistAdd', // 生体损管腔（支援槽 + 结构抗性）→ 结构抗性行
    // 2026-09-13 虫洞专属（船长逐条给定）：
    'mod-wh-c-pulse:speedBonusPct', // 生体脉搏加速器（支援槽 + 舰船速度 +10%）→ 界面「航速」
    'mod-wh-a-coat:evasionGapPct', // 掠袭折射涂层（装甲槽 + 闪避缺口）→ 界面「闪避」
    'mod-wh-a-scan:rangeCutPct', // 赃物扫描阵（支援槽 + 武器射程 −15%）→ 界面「射程代价」
    'mod-wh-a-shield:rangeCutPct', // 掠袭者护盾笼（护盾槽 + 武器射程 −25%）→ 界面「射程代价」
    'mod-wh-c-frame:speedBonusPct', // 几丁质骨架层（装甲槽 + 舰船速度 +5%）→ 界面「航速」
    'mod-wh-e-cpu:reloadPenaltyPct', // 巨构协处理器（协处理器槽 + 装填 +12%）→ 界面「装填代价」
    'mod-wh-g-ballistic:rangeTypeBonusPct', // 幽灵弹道校正器（支援槽 + 动能射程 +22%）→ 界面「动能射程」
  ]
  let counted = 0
  const found: string[] = []
  for (const m of MODULES) {
    for (const [field, owner] of Object.entries(OWNER)) {
      if (owner.split('|').includes(m.slot)) continue
      const v = (m as unknown as Record<string, unknown>)[field]
      if (v === undefined || v === null) continue
      if (typeof v === 'number' && v === 0) continue
      if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
      counted++
      const key = `${m.id}:${field}`
      found.push(key)
      check(
        REGISTERED.includes(key),
        `模块跨族字段契约：${m.name}（${m.id}，槽位 ${m.slot}）带了「${field}」（归属槽位 ${owner}）——` +
          `请确认界面能显示该加成（shipInfo.tsx 的 crossFamilyLines / crossFamilyShort），再把「${key}」登记进本契约白名单`,
      )
    }
  }
  console.log(
    `· 模块跨族字段契约：${MODULES.length} 件装备中 ${counted} 处"槽位族之外的搭车加成"，全部已登记且界面有呈现口径` +
      `（${found.length > 0 ? found.join("、") : "无"}）`,
  )
}

/* ── 舰种契约（2026-09-11 加；船长定案：舰种 5 档、敌我共用、按等效质量落档）──
 * 背景：舰种**收敛为 5 档**（原 7 档作废），「重型巡洋」归巡洋舰档、「战列巡洋」归战列舰档
 * （皆为称号不是独立档）。本契约只做**归类校验**，不改任何船的 tier、不重切任何质量区间：
 *   ① 每艘船的 `tier` 必须与其**等效质量落档**一致——不一致即报错并点名
 *      （船名/质量/等效质量/实际 tier/应为 tier）⇒ 专抓"质量改了却忘改档"或"档标错"；
 *   ② 每个舰种档**恰好**一档命名 + 一个基准速度，且基准速度落在合理值域 100~500；
 *   ③ 打印一行归类统计（各档船数 + 五个基准速度）。
 * ⚠ 若 ① 真抓到不一致：**不要顺手改船的 tier**——把不一致的船交船长裁决。 */
{
  /** 等效质量落在哪一档（自高向低取第一个"下界 ≤ 等效质量"的档；低于最低下界 = 0 表示落不进任何档） */
  const tierOfMass = (eq: number): number => {
    for (const t of [5, 4, 3, 2, 1] as const) {
      if (eq >= HULL_CLASS_MASS_RANGE[t][0]) return t
    }
    return 0
  }
  const classCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let matched = 0
  for (const ship of SHIPS) {
    const eq = equivalentMassOf(ship)
    const expect = tierOfMass(eq)
    check(
      expect !== 0,
      `舰种契约：${ship.name}（${ship.id}）等效质量 ${eq} 低于最低档下界 ${HULL_CLASS_MASS_RANGE[1][0]}（落不进任何舰种档）`,
    )
    check(
      ship.tier === expect,
      `舰种契约：${ship.name}（${ship.id}）质量 ${ship.massKg} → 等效质量 ${eq}，实际 tier ${ship.tier}，应为 tier ${expect}（落档区间与 tier 不一致；请船长裁决，勿自行改档）`,
    )
    if (ship.tier === expect && expect !== 0) matched += 1
    if (expect !== 0) classCount[expect] += 1
  }
  for (const t of [1, 2, 3, 4, 5] as const) {
    const [lo, hi] = HULL_CLASS_MASS_RANGE[t]
    check(
      Number.isFinite(lo) && hi > lo,
      `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）等效质量区间非法 [${lo}, ${hi})`,
    )
    if (t < 5) {
      check(
        HULL_CLASS_MASS_RANGE[t][1] === HULL_CLASS_MASS_RANGE[(t + 1) as 2 | 3 | 4 | 5][0],
        `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）与 ${HULL_CLASS_NAME[(t + 1) as 2 | 3 | 4 | 5]}（T${t + 1}）的质量区间不接续（有缝或重叠）`,
      )
    }
    check(
      typeof HULL_CLASS_NAME[t] === 'string' && HULL_CLASS_NAME[t].length > 0,
      `舰种契约：T${t} 档缺少舰种命名`,
    )
    const spd = HULL_CLASS_BASE_SPEED[t]
    check(
      typeof spd === 'number' && Number.isFinite(spd) && spd >= 100 && spd <= 500,
      `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）基准速度 ${spd} 越界（合理值域 100~500 m/s）`,
    )
  }
  const shown = ([1, 2, 3, 4, 5] as const)
    .map((t) => `${HULL_CLASS_NAME[t]} ${classCount[t]}`)
    .join(' / ')
  console.log(
    `· 舰种契约：${matched}/${SHIPS.length} 艘船归类与等效质量一致（${shown}）；` +
      `基准速度 ${([1, 2, 3, 4, 5] as const).map((t) => HULL_CLASS_BASE_SPEED[t]).join("/")}` +
      // 后勤舰特性（2026-09-16 船长：进「船体特性」栏）——读数放这儿，日后加第二艘后勤舰一眼能看见
      (() => {
        const logi = SHIPS.filter((x) => x.repairPulseTargetsFleet === true)
        return logi.length > 0
          ? ` · 后勤舰特性（维修脉冲修编队最缺血者）${logi.length} 艘（${logi.map((x) => x.name).join('、')}）`
          : ' · 后勤舰特性（维修脉冲修编队最缺血者）**0 艘**'
      })(),
  )
}

/* ── 舰船「类别」契约（2026-09-16 船长：类别名改名 + 装甲线判据）────────────────────
   船长原话（照抄）：「**将重装舰类的名称改为装甲舰。**」＋「**同时将一些装甲占比比护盾高的船也归入装甲舰。**」
   ＋裁决「**只在武装舰里判**」（丙案）＋「**将牛鲨级突击舰和E族专属舰的护盾和装甲互换**」。

   口径（单点在 `packages/core/src/labels.ts`，界面四处筛选/徽标与词典同源）：
   - **展示名**：`armored` ⇒ 「**装甲**」/「**装甲舰**」（id 不变，存档零迁移）；
   - **装甲线判据** = `role === 'armored'` **或**（`role === 'armed'` 且 装甲占比 > 护盾占比）
     —— **只判"类别"（显示层）**：`role` 不动 ⇒ 等效质量不折抵、不吃「装甲舰操作」、仍算战斗舰。
   为什么钉：这条判据一旦漂回"只看 role"，船长点名的牛鲨级与 E 族专属舰就会从「装甲舰」里掉出去。 */
{
  check(SHIP_ROLE_LABELS.armored === '装甲', `类别契约：armored 展示名应为「装甲」（现「${SHIP_ROLE_LABELS.armored}」）`)
  const armorLine = SHIPS.filter((s) => isArmorLineShip(s))
  const bySwap = SHIPS.filter((s) => s.role === 'armed' && isArmorLineShip(s))
  // 船长点名的四艘（"护盾和装甲互换"进来的；换完必须是装甲占比更高）
  for (const id of ['sh-bullshark', 'sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier']) {
    const s = SHIPS.find((x) => x.id === id)
    check(!!s, `类别契约：舰船目录里没有 ${id}`)
    check(s?.role === 'armed', `类别契约：${id} 的 role 应保持 ` + '`armed`（丙案：只判类别、不动机制）')
    check(isArmorLineShip(s!), `类别契约：${id} 换盾/甲后应归入「装甲舰」类别（现 盾 ${s?.shieldHp} / 甲 ${s?.armorHp}）`)
    check(shipCategoryKeyOf(s!) === 'armored', `类别契约：${id} 的类别键应为 ` + '`armored`')
  }
  // 非战斗舰（采矿/货舰）**不许**被这条判据吸进装甲线（丙案明确"只在武装舰里判"）
  for (const s of SHIPS) {
    if (s.role === 'industrial' || s.role === 'hauler') {
      check(!isArmorLineShip(s), `类别契约：${s.id}（${s.role}）不该归入装甲线（船长 2026-09-16：只在武装舰里判）`)
    }
  }
  /**
   * **换血转线 4 艘的抗性口径**（船长 2026-09-17）：它们已是"装甲主打" ⇒ **盾层不得挂任何抗性**；
   * 甲层抗性 = 装甲舰档位阶梯（见上一条专条：动能 + 能量 30/30/35/35/35）；
   * E 三艘的**壳等离子抗 0.25 保留**（族给，不属"移除"范围）。
   */
  for (const id of ['sh-bullshark', 'sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier']) {
    const s = SHIPS.find((x) => x.id === id)
    check(s?.shieldResist === undefined, `类别契约：${id} 已按装甲主打用血 ⇒ 护盾层不应带任何抗性（船长 2026-09-17）`)
    check(
      s?.armorResist?.kinetic !== undefined && s?.armorResist?.plasma !== undefined,
      `类别契约：${id} 的甲层应带动能 + 能量抗性（档位阶梯；现 ${JSON.stringify(s?.armorResist)}）`,
    )
  }
  for (const id of ['sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier']) {
    const s = SHIPS.find((x) => x.id === id)
    check(s?.hullResist?.plasma === 0.25, `类别契约：${id} 的结构层等离子抗 0.25 应保留（船长 2026-09-17 甲案）`)
  }
  /**
   * **两类舰的"额外加成"新口径**（船长 2026-09-17，原话照抄）：
   * 「**武装舰T1~T5获得单发伤害加成，分别是15/20/25/35/50.允许出现上下浮动。如果是无人机船，
   *   则改为同等数值的无人机伤害加成。移除每条船的50动能抗性**」＋
   * 「**装甲舰T~T5获得装甲的动能和能量抗性加成，分别为30/30/35/35/35。移除之前获得的单发伤害加成。
   *   （这里所有的移除都不会影响舰船子类型和种族给予的额外属性。）**」＋（同日追加）
   * 「**所有炮舰伤害倍率额外+0.15。鱼雷舰获得伤害倍率+0.2。**」
   *
   * 契约五条：
   * ① **武装舰**：`powerBonus`（无人机船看 `droneDmgBonus`）= 档位阶梯 0.15/0.20/0.25/0.35/0.50
   *    ＋ **子分类附加**（炮舰 +0.15 · 鱼雷舰 +0.2），**允许 ±0.05 浮动**；
   * ② **装甲舰（类别口径）**：甲层 `kinetic` = 0.30/0.30/0.35/0.35/0.35（±0.05）；**不得有档位单发加成**，
   *    唯一例外 = **子分类给的**（构件鱼雷舰 +0.2）；
   * ③ **全局**：三层抗性里**任何一层都不许再出现 `kinetic: 0.5`**（"移除每条船的 50 动能抗性"）；
   * ④ **装甲舰甲层能量抗**：幼虫截击舰 / 甲壳截击舰**已按船长移除** ⇒ 只查其余装甲舰 = 档位值；
   * ⑤ **不变量**：装甲舰甲层高爆抗 = 甲壳线 **0.25**（船长：「陆龟级，玳瑁级，玄武级，爆炸抗性削弱到0.25」）·
   *    C 族 **0.3**（船长：「装甲船的C族高爆抗性改为0.3」）· D 族三艘**甲层/壳层抗性已全删**（只留盾层 0.25×3）·
   *    E 三艘 `hullResist.plasma` 0.25 保留。
   */
  {
    const bad: string[] = []
    const ARMED_DMG: Record<number, number> = { 1: 0.15, 2: 0.2, 3: 0.25, 4: 0.35, 5: 0.5 }
    const ARMOR_RES: Record<number, number> = { 1: 0.3, 2: 0.3, 3: 0.35, 4: 0.35, 5: 0.35 }
    const SUBCLASS_DMG: Record<string, number> = { 炮舰: 0.15, 鱼雷舰: 0.2 }
    const FLOAT = 0.05
    /** 装甲舰甲层能量抗被船长点名移除的两艘（C 族截击舰） */
    const NO_ARMOR_PLASMA = new Set(['sh-wh-c-frigate', 'sh-wh-c-destroyer'])
    let armedN = 0
    let armorN = 0
    for (const s of SHIPS) {
      const cat = shipCategoryKeyOf(s)
      const subExtra = s.subClass !== undefined ? (SUBCLASS_DMG[s.subClass] ?? 0) : 0
      if (cat === 'armed') {
        armedN++
        const droneShip = s.powerBonus === undefined && s.droneDmgBonus !== undefined
        const v = droneShip ? s.droneDmgBonus! : (s.powerBonus ?? NaN)
        const want = (ARMED_DMG[s.tier] ?? NaN) + subExtra
        if (ARMED_DMG[s.tier] === undefined) bad.push(`${s.name}（${s.id}）档位 T${s.tier} 不在阶梯表里`)
        else if (!(Math.abs(v - want) <= FLOAT + 1e-9))
          bad.push(
            `${s.name}（${s.id}）${droneShip ? '无人机伤害' : '单发'}加成 ${v} ∉ ${want}±${FLOAT}` +
              `（T${s.tier} 档位 ${ARMED_DMG[s.tier]}${subExtra > 0 ? ` ＋ 子分类 ${s.subClass} ${subExtra}` : ''}）`,
          )
        if (droneShip && s.powerBonus !== undefined) bad.push(`${s.name}（${s.id}）是无人机船却又带 powerBonus（应改给 droneDmgBonus）`)
      } else if (cat === 'armored') {
        armorN++
        const want = ARMOR_RES[s.tier]
        for (const t of ['kinetic', 'plasma'] as const) {
          if (t === 'plasma' && NO_ARMOR_PLASMA.has(s.id)) continue // 船长点名移除
          const v = s.armorResist?.[t]
          if (want === undefined) bad.push(`${s.name}（${s.id}）档位 T${s.tier} 不在阶梯表里`)
          else if (v === undefined || Math.abs(v - want) > FLOAT + 1e-9)
            bad.push(`${s.name}（${s.id}）甲层 ${t} 抗 ${v ?? '未写'} ∉ ${want}±${FLOAT}（T${s.tier}）`)
        }
        // 档位单发加成必须已移除；唯一例外 = 子分类给的（鱼雷舰 +0.2）
        const allowed = subExtra
        const got = s.powerBonus ?? 0
        if (Math.abs(got - allowed) > 1e-9)
          bad.push(`${s.name}（${s.id}）属装甲舰 ⇒ 单发加成只允许子分类给的 ${allowed}（现 ${s.powerBonus ?? '无'}）`)
      }
      for (const [layer, r] of [['盾', s.shieldResist], ['甲', s.armorResist], ['壳', s.hullResist]] as const) {
        if (r?.kinetic === 0.5) bad.push(`${s.name}（${s.id}）${layer}层仍有 50 动能抗（船长：「移除每条船的 50 动能抗性」）`)
      }
    }
    // ⑤ 不变量：子类型 / 种族给的抗性按船长新口令核对
    const EXPLOSIVE_WANT: Record<string, number> = {
      'sh-tortoise': 0.25,
      'sh-hawksbill': 0.25,
      'sh-xuanwu': 0.25,
      'sh-wh-c-frigate': 0.3,
      'sh-wh-c-destroyer': 0.3,
      'sh-wh-c-cruiser': 0.3,
    }
    for (const [id, want] of Object.entries(EXPLOSIVE_WANT)) {
      const s = SHIPS.find((x) => x.id === id)
      if (s?.armorResist?.explosive !== want) bad.push(`${id} 的甲层高爆抗应为 ${want}（现 ${s?.armorResist?.explosive ?? '无'}）`)
    }
    for (const id of ['sh-wh-d-frigate', 'sh-wh-d-destroyer', 'sh-wh-d-cruiser']) {
      const s = SHIPS.find((x) => x.id === id)
      if (s?.armorResist !== undefined) bad.push(`${id} 的甲层抗性应已全部移除（船长：「D族船，装甲爆炸抗性…移除」）`)
      if (s?.hullResist !== undefined) bad.push(`${id} 的结构层抗性应已全部移除（船长：「…结构所有抗性移除」）`)
      if (s?.shieldResist === undefined) bad.push(`${id} 的盾层抗性应保留（船长只点名甲层爆炸与结构层）`)
    }
    for (const id of ['sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier']) {
      const s = SHIPS.find((x) => x.id === id)
      if (s?.hullResist?.plasma !== 0.25) bad.push(`${id} 的壳层等离子抗 0.25（族给）被误删`)
    }
    check(bad.length === 0, `加成与抗性新口径：${bad.join(' · ')}`)
    console.log(
      `· 加成与抗性新口径（船长 2026-09-17）：武装舰 ${armedN} 艘按档位给单发/无人机伤害（15/20/25/35/50 ±5；` +
        `炮舰 +15 · 鱼雷舰 +20 另加）· 装甲舰 ${armorN} 艘按档位给甲层动能（30/30/35/35/35 ±5）· ` +
        `全局已无 50 动能抗 · D 族甲层/壳层抗性已清 · C 族两艘截击舰能量抗已清`,
    )
  }

  console.log(
    `· 舰船类别契约：类别名 = 采矿舰 / 货运舰 / 武装舰 / **装甲舰**（armored 展示名「装甲」）· ` +
      `装甲线合计 ${armorLine.length} 艘（按 role ${SHIPS.filter((s) => s.role === 'armored').length} + 武装舰换血转线 ${bySwap.length}：` +
      `${bySwap.map((s) => s.name).join('、')}）`,
  )
}

/* ── 舰船价格口径**预警**（2026-09-11 船长：「3 改为预警」）──────────────────────────
   背景（实证）：2026-09-09「巡洋价位定档 9/11/13/15M」的重放按**旧数值**匹配，把阶梯写到了
   陆龟/玳瑁/飞鱼/旗鱼头上（330k/760k/210k/480k → 9M/11M/13M/15M），4 艘巡洋自己反而没改；
   因当时没有护栏，漂移一路带进维修费档位（`repairTierWeight` 读 `priceIsk`）与平衡工具。
   口径（三处同源）：
   - `ships.ts priceIsk` = 该船**市场行 basePrice**（无市场行者必须为 0 = 仅定制）；
   - `shipBlueprints priceIsk` = 市场行价 × 档位系数（≤30 万 ×2 / 30~100 万 ×2.5 /
     100~400 万 ×3 / >400 万 ×4），允许 ±1 万整万取整余量；
   - 市场行价本身就是玩家真正付的价（`buyShip` 走 marketCatalog），故它是锚。
   **按船长裁决只发预警（`warn`），不阻断体检**——它是"口径漂移"的哨兵，不是硬契约。 */
{
  const tierCoefOf = (market: number): number => {
    if (market > 4_000_000) return 4
    if (market > 1_000_000) return 3
    if (market > 300_000) return 2.5
    return 2
  }
  const shipGoods = MARKET_GOODS.filter((g) => g.kind === 'ship' && typeof g.refId === 'string')
  const marketOfShip = new Map(shipGoods.map((g) => [g.refId!, g]))
  let driftPrice = 0
  let driftBp = 0
  for (const ship of SHIPS) {
    const good = marketOfShip.get(ship.id)
    // 定制船口径（2026-09-09「蓝图船成品现货下架」）：无市场行、或市场行 playerBuyable=false（只收不卖）
    // ⇒ `priceIsk` 必须为 0（图鉴据此显示「定制 / 仅可制造」，维修费档位走"层容量"兜底）。
    const custom = good === undefined || good.playerBuyable === false
    if (custom) {
      if (ship.priceIsk !== 0) {
        warn.push(
          `舰船价格口径：${ship.name}（${ship.id}）属定制船（${good ? '市场行只收不卖' : '无市场行'}），ships.ts priceIsk = ${ship.priceIsk.toLocaleString('zh-CN')}（应为 0）`,
        )
        driftPrice += 1
      }
    } else if (ship.priceIsk !== (good.basePrice ?? 0)) {
      const market = good.basePrice ?? 0
      warn.push(
        `舰船价格口径：${ship.name}（${ship.id}）ships.ts priceIsk = ${ship.priceIsk.toLocaleString('zh-CN')}，市场行价 = ${market.toLocaleString('zh-CN')}（两处应一致；维修费档位读 priceIsk，玩家付款读市场行）`,
      )
      driftPrice += 1
    }
    // 2026-09-13 船长：T3/T4/T5 各有一张**一次性蓝图**；**2026-09-14 船长改判价格口径**
    // （原话「将一次性蓝图的价格下调到舰船的0.5倍」，旧口径"行价 ×100%"作废）⇒
    // 一次性那张核 **= 行价 ×50%**、普通那张仍核 ×档位系数。
    const bps = SHIP_BLUEPRINTS.filter((b) => b.shipId === ship.id)
    if (bps.length === 0) continue
    // 定制船只有一次性图纸时：它的价也是"行价 ×50%"（行价 = 只收不卖的市场基准价）⇒ 仍按 ×0.5 核
    const market = (good?.basePrice ?? 0) || ship.priceIsk
    for (const bp of bps) {
      if (bp.singleUse === true) {
        const expectOnce = Math.round(market * 0.5)
        if (market > 0 && Math.abs(bp.priceIsk - expectOnce) > 10_000) {
          warn.push(
            `一次性舰船蓝图价格口径：${ship.name}（${ship.id}）${bp.id} 价 = ${bp.priceIsk.toLocaleString('zh-CN')}，` +
              `按船长口径「**舰船价格的 0.5 倍**」应为 ${expectOnce.toLocaleString('zh-CN')}（±1 万取整余量内视为达标）`,
          )
          driftBp += 1
        }
        continue
      }
      // 永久（可学）蓝图：定制船的蓝图价 = 唯一定价（无"市场价 × 系数"可比），不参与系数比对
      if (custom) continue
      const expect = Math.round(market * tierCoefOf(market))
      if (Math.abs(bp.priceIsk - expect) > 10_000) {
        warn.push(
          `舰船蓝图价格口径：${ship.name}（${ship.id}）蓝图价 = ${bp.priceIsk.toLocaleString('zh-CN')}，按「市场价 × 档位系数」应为 ${expect.toLocaleString('zh-CN')}（±1 万取整余量内视为达标）`,
        )
        driftBp += 1
      }
    }
    // **一次性蓝图必须存在**（船长 2026-09-13：「给T3船也添加一次性蓝图」＋「T4T5舰船都出一张」）：
    // 判据 = 有市场行价（即非壳体）的 T3/T4/T5 舰，必须有一张 `singleUse` 舰船蓝图。
    if (ship.tier >= 3 && market > 0 && !bps.some((b) => b.singleUse === true)) {
      errors.push(
        `一次性舰船蓝图缺失：${ship.name}（${ship.id}，T${ship.tier}）没有一次性蓝图——` +
          `船长 2026-09-13 裁定「T3/T4/T5 各出一张，价格按舰船价格的 0.5 倍」（价格口径 2026-09-14 改判）`,
      )
    }
  }
  console.log(
    `· 舰船价格口径（预警）：${SHIPS.length} 艘船中 priceIsk 与市场行价不符 ${driftPrice} 处、蓝图价与档位系数不符 ${driftBp} 处`,
  )
}

/* ── 蓝图价格口径契约（2026-09-11 船长：「调整所有蓝图到合适价格」→ 裁决「甲」）────────────
   规则（单点 = `packages/data/src/blueprints.ts` 的 `blueprintTierCoefOf` / `blueprintBookPriceOf`）：
   **装备/物品蓝图书价 = 产物现货价 × 档位系数**——`奇货 ×4 · 民用/基础/MK1 ×2 · MK2 ×2.5 · MK3 ×3`
   （奇货档 2026-09-11 船长复核补正：「蓝图价格排除奇货档。奇货档默认 4 倍」），
   取整到 `BLUEPRINT_PRICE_STEP`（500 ISK）。产物现货价 = 市场行 basePrice（item 类 × 单次产出数量）。
   背景（实证）：2026-09-10「MK2/MK3 装备价对齐同级武器价」只改成品价、书价没跟，
   91 张里 56 张的「书价 ÷ 产物价」漂到 0.18~1.88（武器线与新件合规），本批按系数全量对齐。
   **系数即默认值，个例可覆盖**（船长：「如果有单独调整过的则允许覆盖默认值」）——
   `BLUEPRINT_PRICE_OVERRIDES` 里登记的 id：跳过系数比对，但覆盖价必须与两处落账同值、且键必须是真实蓝图。
   两层校验：
   - **硬契约**：`blueprints.ts priceIsk` == 市场蓝图行 `basePrice`（两处必须同值——玩家付款读市场行，
     图鉴/工业页读书价，任一处漏改都会让玩家看到两个价）；覆盖表键非法 ⇒ 也算硬错；
   - **预警**：书价与规则值差 > 500 ISK（口径漂移哨兵，与舰船价格口径同为 warn）；
   - **预警**：料/价（材料成本 ÷ 产物现货价）落在 30%~60% 之外（同族锚 45%，口径见 manufacture:econ）。 */
{
  const bpGoods = MARKET_GOODS.filter((g) => g.kind === 'blueprint' && typeof g.refId === 'string')
  const marketOfBp = new Map(bpGoods.map((g) => [g.refId!, g]))
  const marketOfModule = new Map(MARKET_GOODS.filter((g) => g.kind === 'module' && typeof g.refId === 'string').map((g) => [g.refId!, g]))
  const marketOfItem = new Map(MARKET_GOODS.filter((g) => g.kind === 'item' && typeof g.refId === 'string').map((g) => [g.refId!, g]))
  const modName = new Map(MODULES.map((m) => [m.id, m.name]))
  const itemName = new Map(ITEMS.map((i) => [i.id, i.name]))
  const itemSell = new Map(ITEMS.map((i) => [i.id, i.baseSellPriceIsk ?? 0]))
  let mismatchPrice = 0
  let driftCoef = 0
  let driftMatRatio = 0
  let okCoef = 0
  let overridden = 0
  /** 一次性图纸（不上市场 ⇒ 无市场行）的豁免计数——不参与书价与料/价比对，单独留痕 */
  let exemptSingleUse = 0
  /** 专属一次性图纸（有市场行但为"只收不卖"）的计数——书价 = 产物价，不套档位系数/不比料价带 */
  let exclusiveOnceBp = 0
  const tiers: Record<string, number> = {}
  for (const bpId of Object.keys(BLUEPRINT_PRICE_OVERRIDES)) {
    if (!BLUEPRINTS.some((b) => b.id === bpId)) {
      errors.push(`蓝图价格口径：覆盖表里的 ${bpId} 不是真实蓝图 id——删掉它或修正拼写`)
      mismatchPrice += 1
    }
  }
  /* ── 【未上线商品闸门】契约（2026-09-12 加 · 船长：「所有虫洞相关的内容需要等虫洞落地后才统一对玩家可见」）──
   * 口径：`unreleased: true` 的卡**留在目录表**（契约照核），但**必须不在玩家可见目录里**——
   * 否则市场页/挂单/任务就会提前暴雷。反向也钉住：没标 `unreleased` 的商品**必须真的在可见目录里**
   * （防"标了没生效"或"忘了删字段却以为没上线"两种错法）。 */
  {
    const visible = buildMarketGoodsCatalog()
    for (const g of MARKET_GOODS) {
      const inVisible = visible.has(g.key)
      if (g.unreleased === true && inVisible) {
        errors.push(`未上线闸门：${g.key} 标了 unreleased 却仍在玩家可见目录里（会提前泄露）`)
      }
      if (g.unreleased !== true && !inVisible) {
        errors.push(`未上线闸门：${g.key} 没标 unreleased 却不在玩家可见目录里（玩家买不到）`)
      }
    }
    const hiddenCount = MARKET_GOODS.filter((g) => g.unreleased === true).length
    console.log(`· 未上线闸门：目录 ${MARKET_GOODS.length} 张卡中 **${hiddenCount}** 张标了「未上线」并对玩家不可见`)
  }
  /**
   * **虫洞施工期不可见闸门**（船长 2026-09-13 铁律：「虫洞完成前对玩家不可见」）。
   *
   * 口径：虫洞这条线的三样东西**在船长拍板前一律不得进玩家可见面** ——
   * ①**洞内敌卡**（`wh-*`，2026-09-13 起**五张**：A/C/D/E/G 各一）必须 `hidden: true`（否则会出现在
   *   悬赏目录/日板派发里，玩家在星图上就能看到"虫洞"敌人）；②**虚空母矿**必须仍标 `unreleased`；
   * ③**洞内敌卡不带赏金/战利品**（`rewardIsk = 0` 且 `loot` 空）——它们只由虫洞生成，
   *   若挂了奖金/掉落，任何一条别的路径引用到它都会白送收益。
   * ④**（2026-09-13 补）物品卡也要标 `unreleased`**：市场闸门只管 `ctx.marketGoods`，
   *   而工业页「可精炼资源」/舰船页 AI 精炼炉下拉/组装机材料提示/手册物品图鉴都是
   *   **直接扫 `ctx.items` 全目录**的——只标市场卡 ⇒ 虚空母矿连卡带描述挂在工业页上（实测泄露）。
   * ⑤**（2026-09-13 补）"虫洞"字样闸门**：凡**未隐藏**的敌卡 / **未上线**的物品，其**玩家可见字段**
   *   （名称/描述）里出现「虫洞」即报错——把铁律的文案面也变成机器守的。
   * ⚠ 审计的是"标注"这一层；**入口走调试开关**这层没法在这里自动核（见 `panels/Wormhole.tsx` 头注释）。
   */
  {
    const whIds = [
      // 浅层五张（2026-09-13）
      'wh-pirate-scout',
      'wh-alien-swarm',
      'wh-grave-watch',
      'wh-exile-blockade',
      'wh-titan-echo',
      // 中/深（2026-09-15 洞内敌卡扩充：批 1 A 族 · 批 2 C 族 · 批 3 D 族 · 批 4 E 族 · 批 5 G 族 —— 15 张齐备）
      'wh-pirate-hunt',
      'wh-pirate-warband',
      'wh-alien-brood',
      'wh-alien-hive',
      'wh-grave-sentry',
      'wh-grave-throne',
      'wh-titan-missile',
      'wh-titan-hulk',
      'wh-exile-swarm',
      'wh-exile-line',
    ]
    // **轮换表的双向契约**（2026-09-13 补第五张时加）：内容侧这张清单、data 的 `WORMHOLE_FOE_CARDS`
    // 与 core 的 `WORMHOLE_FOE_CARD_IDS` **三处必须逐字同序** —— 少一张/换序都会让"按族掉落池"
    // 取错卡（掉落物跟着族走，错一张就是整族拿不到东西）。
    const dataIds = WORMHOLE_FOE_CARD_IDS
    if (dataIds.join('|') !== whIds.join('|')) {
      errors.push(
        `虫洞不可见闸门：洞内敌卡三处清单不一致 —— 内容侧契约 [${whIds.join(', ')}] vs data 表 [${dataIds.join(', ')}]`,
      )
    }
    if (coreWhIds.join('|') !== whIds.join('|')) {
      errors.push(
        `虫洞不可见闸门：洞内敌卡三处清单不一致 —— 内容侧契约 [${whIds.join(', ')}] vs core 轮换表 [${coreWhIds.join(', ')}]`,
      )
    }
    /**
     * **内容原型（丙）+ 敌族锁定（丁）的两张表自洽**（船长 2026-09-14 定案）。
     *
     * ① 五档原型齐、权重为正、中文名齐，且 `WORMHOLE_ARCHETYPES` 与权重表同集合；
     * ② **原型只改配比**：每档的权重总和恒 = 基准总和、**信标权重一字不动**（它是每层唯一的指路件）；
     * ③ **族 ↔ 洞内卡 1:1**：五族各有一张卡、且那张卡的 `foeFamily` 就是该族（错一张 ⇒ 整族拿不到东西）；
     * ④ 自动探索的口味权重表（`wormholeAuto` 里的字面量副本）与网格表**同值**（防两处漂移）。
     */
    {
      const archs: string[] = [...WORMHOLE_ARCHETYPES]
      const weightKeys = Object.keys(WORMHOLE_ARCHETYPE_WEIGHTS)
      if (archs.length !== 5 || archs.some((a) => !weightKeys.includes(a)) || weightKeys.length !== 5) {
        errors.push(`内容原型：WORMHOLE_ARCHETYPES 与权重表不同集合（${archs.join('、')} vs ${weightKeys.join('、')}）`)
      }
      const baseTotal = WORMHOLE_SIGNAL_WEIGHTS.ship + WORMHOLE_SIGNAL_WEIGHTS.wreck + WORMHOLE_SIGNAL_WEIGHTS.resource + WORMHOLE_SIGNAL_WEIGHTS.radar + WORMHOLE_SIGNAL_WEIGHTS.beacon
      for (const a of WORMHOLE_ARCHETYPES) {
        if (!(WORMHOLE_ARCHETYPE_WEIGHTS[a] > 0)) errors.push(`内容原型 ${a} 的抽取权重必须为正`)
        if (!WORMHOLE_ARCHETYPE_LABELS[a]) errors.push(`内容原型 ${a} 缺中文名（界面徽标要用）`)
        const w = wormholeSignalWeightsFor(a)
        const total = w.ship + w.wreck + w.resource + w.radar + w.beacon
        if (Math.abs(total - baseTotal) > 1e-6) {
          errors.push(`内容原型 ${a} 改动了信号权重总和（${total} ≠ ${baseTotal}）—— 原型只许改配比`)
        }
        if (w.beacon !== WORMHOLE_SIGNAL_WEIGHTS.beacon) {
          errors.push(`内容原型 ${a} 改动了信标权重（${w.beacon} ≠ ${WORMHOLE_SIGNAL_WEIGHTS.beacon}）—— 信标不参与口味`)
        }
        if (WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[a as never] !== WORMHOLE_ARCHETYPE_WEIGHTS[a]) {
          errors.push(`内容原型 ${a} 的自动探索口味权重与网格抽取权重不同值（两处必须同值）`)
        }
      }
      for (const f of WORMHOLE_FAMILY_ORDER) {
        const cardId = WORMHOLE_FAMILY_CARD[f]
        const card = ANOMALIES_FLAVORED.find((x) => x.id === cardId)
        if (!card) {
          errors.push(`敌族锁定：族 ${f} 的洞内卡 ${cardId} 不在数据里`)
          continue
        }
        if (card.foeFamily !== f) {
          errors.push(`敌族锁定：卡 ${cardId} 的 foeFamily = ${String(card.foeFamily)}，与族 ${f} 不符（1:1 契约）`)
        }
      }
      /* **一族三档契约**（船长 2026-09-15：「增加敌人的配置种类和敌族新舰船」＋「选靶按照族限定」＋
       * 「浅层中层深层分别定为 1/2/4 层开始出现」＋「层 2~3 出场抽取按照 2:1 抽。层 4+ 按照 2:1：1 抽」＋
       * 「中层配置血量*1.1.深层配置血量*1.2」）——本段是这些裁定的**体检哨**：
       * ① 档位表与卡清单**同集合**（少一张/多一张都算漂移；缺档是"还没做"，允许 `null`）；
       * ② 每张卡的 `foeFamily` = 它所在族的族字母（错一张 ⇒ 整族掉落池拿错东西）；
       * ③ **选靶按族限定**：卡面模式与概率必须等于族定值（随机族不许写概率）；
       * ④ 出场层 / 出场权重 / 分层血量修正 = 裁定值（读 core 常量，防两处漂移）。 */
      {
        const tiered = wormholeAllCardIds()
        if (new Set(tiered).size !== tiered.length) {
          errors.push(`一族三档：档位表里有重复卡 id（同一张卡占了两个档位）`)
        }
        for (const id of tiered) {
          if (!whIds.includes(id)) errors.push(`一族三档：档位表里的卡 ${id} 不在洞内清单（三处清单必须一致）`)
        }
        for (const id of whIds) {
          if (!tiered.includes(id)) errors.push(`一族三档：洞内清单里的卡 ${id} 没进档位表（不知道该在第几层出场）`)
        }
        for (const f of WORMHOLE_FAMILY_ORDER) {
          for (const t of WORMHOLE_CARD_TIERS) {
            const id = WORMHOLE_FAMILY_CARDS[f][t]
            if (id === null) continue
            const card = ANOMALIES_FLAVORED.find((x) => x.id === id)
            if (!card) continue // 已由上面的"清单一致性"报出
            if (card.foeFamily !== f) errors.push(`一族三档：卡 ${id}（族 ${f} · ${t} 档）的 foeFamily = ${String(card.foeFamily)}`)
            if (wormholeTierOfCard(id) !== t) errors.push(`一族三档：卡 ${id} 的档位反查结果不是 ${t}`)
            const wantMode = WORMHOLE_FAMILY_TARGETING[f]
            const gotMode = card.foeTargeting ?? 'random'
            if (gotMode !== wantMode) {
              errors.push(`族定选靶：卡 ${id}（族 ${f}）的模式是 ${gotMode}，应为 ${wantMode}（船长「选靶按照族限定」）`)
            }
            if (wantMode === 'random') {
              if (card.foeTargetingChance !== undefined) {
                errors.push(`族定选靶：卡 ${id} 是随机模式，不该写 foeTargetingChance（写了也按 1 处理）`)
              }
            } else if (card.foeTargetingChance !== WORMHOLE_FAMILY_TARGETING_CHANCE) {
              errors.push(
                `族定选靶：卡 ${id} 的倾向概率 ${String(card.foeTargetingChance)} ≠ ${WORMHOLE_FAMILY_TARGETING_CHANCE}（船长 2026-09-14 定的 0.4）`,
              )
            }
          }
        }
        // ④ 出场层 / 权重 / 分层**威胁预算**修正（读 core 常量）
        const wantUnlock: Record<string, number> = { shallow: 1, mid: 2, deep: 4 }
        for (const t of WORMHOLE_CARD_TIERS) {
          if (WORMHOLE_TIER_UNLOCK_DEPTH[t] !== wantUnlock[t]) {
            errors.push(`出场层：${t} 档从第 ${WORMHOLE_TIER_UNLOCK_DEPTH[t]} 层起，应为第 ${wantUnlock[t]} 层（船长「1/2/4 层开始出现」）`)
          }
        }
        // 分层修正（2026-09-16 船长改口径：「档位血量修正改为**威胁预算**修正，比例降为 **1 : 1.05 : 1.1**」）
        const wantMul: Record<string, number> = { shallow: 1, mid: 1.05, deep: 1.1 }
        for (const t of WORMHOLE_CARD_TIERS) {
          if (Math.abs(WORMHOLE_TIER_THREAT_MUL[t] - wantMul[t]) > 1e-9) {
            errors.push(
              `分层威胁预算修正：${t} 档 ×${WORMHOLE_TIER_THREAT_MUL[t]}，应为 ×${wantMul[t]}（船长「改为威胁预算修正，比例降为 1:1.05:1.1」）`,
            )
          }
        }
        const wantWeights: Array<[number, Record<string, number>]> = [
          [1, { shallow: 1 }],
          [2, { shallow: 1, mid: 2 }],
          [3, { shallow: 1, mid: 2 }],
          [4, { shallow: 1, mid: 1, deep: 2 }],
          [9, { shallow: 1, mid: 1, deep: 2 }],
        ]
        for (const [depth, want] of wantWeights) {
          // 用"全档齐备"的族（A 族）读权重 ⇒ 测的是权重口径本身，不是某族的缺档兜底
          const got = Object.fromEntries(wormholeCardPoolAt('A', depth).map((e) => [e.tier, e.weight]))
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            errors.push(
              `出场权重：层 ${depth} 的池权重 ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}（船长「层 2~3 = 2:1 · 层 4+ = 2:1:1」）`,
            )
          }
        }
      }
    }
    let leaked = 0
    for (const id of whIds) {
      const card = ANOMALIES_FLAVORED.find((a) => a.id === id)
      if (!card) {
        errors.push(`虫洞不可见闸门：目录里找不到洞内敌卡 ${id}（被删或被改名？契约与 core 的轮换表会不一致）`)
        continue
      }
      if (card.hidden !== true) {
        errors.push(`虫洞不可见闸门：${id}（${card.name}）没有 hidden —— 会出现在悬赏目录/派发里，施工期提前泄露`)
        leaked += 1
      }
      /** 洞内卡的「稀有残骸」物品（F3b 打捞产物）：**上线后照旧要注册**（否则打捞产物解析不到定义），
       * 但 2026-09-14 虫洞上线后**不再要求标 `unreleased`**（它本来就该在图鉴里）。 */
      const rareWh = ctxItems.get(`wreck-rare-${id}`)
      if (!rareWh) {
        errors.push(`虫洞不可见闸门：洞内敌卡 ${id}（${card.name}）没有注册「稀有残骸」物品 —— 墓场/遗迹打捞出的稀有残骸会解析不到定义（读档后显示成未知物品）`)
      }
      if (card.rewardIsk !== 0 || (card.loot?.length ?? 0) > 0) {
        errors.push(`虫洞不可见闸门：${id}（${card.name}）带了奖金/掉落 —— 洞内敌卡不应有赏金收益（收益走背包拾取）`)
      }
    }
    /* **遗迹安全货柜契约**（F4 · 2026-09-13 船长：装备与图纸改走中间件、货柜 2000 m³ = 4 格）：
     * 五族各一种，必须 ① `kind === 'container'` ② **2000 m³**（与 `wormholeHold` 的形状表 2×2 对得上）
     * ③ **能被拆解台打开**（`startUnboxRun` 认 `container` 类货柜；2026-09-14 上线后不再要求 `unreleased`）；
     * 少一种 ⇒ 那一族的遗迹专属掉落会散落出一件"读不懂的东西"。 */
    for (const fam of WORMHOLE_FAMILIES) {
      const boxId = `box-relic-${fam.toLowerCase()}`
      const box = ctxItems.get(boxId)
      if (!box) {
        errors.push(`货柜契约：没有 ${boxId}（${fam} 族的遗迹安全货柜）—— 该族专属掉落会散落出无定义的物品`)
        continue
      }
      if (box.kind !== 'container') errors.push(`货柜契约：${boxId} 的 kind = ${box.kind}，应为 container`)
      if (box.unitM3 !== 3000) errors.push(`货柜契约：${boxId} 的体积 = ${box.unitM3} m³，应为 3000（**2026-09-15 船长「将安全货柜大小增加到6格」：2000（4 格）→ 3000（3×2 = 6 格）**，旧口径作废）`)
    }
    /* **图纸货柜契约**（2026-09-14 船长：「给虫洞的遗迹打捞新增图纸货柜。占 2 格大小。
     * 内部是随机 T3T4T5 舰船的一次性图纸。有较低概率出 T3 或 T4 的永久图纸。」）：
     * 三种 = **层档**（浅层 2 / 中层 3~4 / 深层 5+，由 `wormholeBpBoxIdOf` 单一出处决定），必须
     * ① `kind === 'container'` ② **1000 m³**（= 500 m³/格 × 2 格，与形状表 2×1 对得上）
     * ③ 在 core 形状表里**登记过**（没登记 ⇒ 被当散货：1000 m³ 会让"每格单位数"退化 ⇒ 只占 1 格、形状丢失，
     * 与货柜/谜质那次同款坑）；2026-09-14 虫洞上线后**不再要求 `unreleased`**。 */
    for (const id of WORMHOLE_BP_BOX_IDS) {
      const box = ctxItems.get(id)
      if (!box) {
        errors.push(`图纸货柜契约：物品目录里没有 ${id} —— 遗迹掉落会散落出无定义的物品`)
        continue
      }
      if (box.kind !== 'container') errors.push(`图纸货柜契约：${id} 的 kind = ${box.kind}，应为 container`)
      if (box.unitM3 !== 1000) errors.push(`图纸货柜契约：${id} 的体积 = ${box.unitM3} m³，应为 1000（= 500 m³/格 × 2 格）`)
      if (!wormholeIsShapedItem(id)) {
        errors.push(`图纸货柜契约：${id} 没在 core 形状表里登记 —— 会被当散货塞进背包（只占 1 格、形状丢失）`)
      }
    }
    /* **贵重品 / 军用货柜契约**（2026-09-15 船长：「新增贵重品货柜，2格，精炼炉拆解后获得随机数量的'奢侈品'」
     * ＋「新增军用备货柜4格，精炼炉可以从中拆出数件随机MK3装备」；**2026-09-16 船长「奢侈品货柜调整为2*2」**
     * ⇒ 贵重品柜 **2×1 = 2 格 → 2×2 = 4 格**）：
     * 两种都必须 ① `kind === 'container'` ② **体积 = 500 m³/格 × w × h**（与形状表对得上）
     * ③ 在 core 形状表里登记过（没登记 ⇒ 被当散货：2000 m³ 会让"每格单位数"退化 ⇒ 只占 1 格、形状丢失）。
     * ⚠ 这两条原先没有哨（2026-09-16 补）：**形状在 core、体积在 data**，只改一处四道闸门都不会报错 ⇒ 现钉住这一对。 */
    for (const [boxId, w, h] of [
      [WORMHOLE_VALUABLES_BOX_ID, 2, 2], // 2026-09-16 船长「奢侈品货柜调整为2*2」（原 2×1 = 2 格 · 1000 m³）
      [WORMHOLE_MILITARY_BOX_ID, 2, 2], // 2026-09-15 船长「新增军用备货柜4格」
    ] as const) {
      const box = ctxItems.get(boxId)
      if (!box) {
        errors.push(`货柜契约：物品目录里没有 ${boxId} —— 遗迹掉落会散落出无定义的物品`)
        continue
      }
      if (box.kind !== 'container') errors.push(`货柜契约：${boxId} 的 kind = ${box.kind}，应为 container`)
      const shp = wormholeShapeOf(boxId)
      if (shp.w !== w || shp.h !== h) {
        errors.push(
          `货柜契约：${boxId} 的形状 = ${shp.w}×${shp.h}，应为 ${w}×${h}（船长「奢侈品货柜调整为2*2」/「新增军用备货柜4格」）`,
        )
      }
      if (box.unitM3 !== 500 * w * h) {
        errors.push(
          `货柜契约：${boxId} 的体积 = ${box.unitM3} m³，应为 ${500 * w * h}（= 500 m³/格 × ${w}×${h} = ${w * h} 格）`,
        )
      }
      if (!wormholeIsShapedItem(boxId)) {
        errors.push(`货柜契约：${boxId} 没在 core 形状表里登记 —— 会被当散货塞进背包（形状丢失）`)
      }
    }
    /**
     * **AI 核心契约**（2026-09-14 船长：「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的掉落。
     * AI 核心单独占 1 格。出率为 10%，不挤占旧有出率。三种核心根据稀有度区分出货权重。」）。
     *
     * 三种核心必须：① `kind === 'aicore'`（**不是 `container`** ——
     * 拆解台的资格判据就是 `kind === 'container'`，混了会让核心上拆解台、还被丢进货柜抽奖）
     * ② **500 m³**（= 500 m³/格 × **1 格**，与形状表 1×1 对得上）③ 在 core 形状表里登记过
     * ④ id 与 `WORMHOLE_CORE_ITEM_IDS` **一一对应**（少一边 ⇒ 掉出来一件读不懂的物品）
     * ⑤ **能反查回核心账本键**（撤离成功即入 `state.aiCores` —— 这就是它的"用途"，上线后仍不需要配方）；
     * 2026-09-14 虫洞上线后**不再要求 `unreleased`**。
     *
     * 另外两条市场口径（船长同日改判）：
     * ⑥ **贝塔 / 阿尔法「只收不卖」**（`playerBuyable === false`）—— 它们已由虫洞遗迹产出，
     *    市场再卖现货等于"花钱跳过副本"；伽马**必须仍可买**（船长只点了贝塔与阿尔法）。
     * ⑦ 四档行价 = 船长给定的 **2.5 万 / 20 万 / 150 万 / 1000 万**（改价必须同步改这条钉子）。
     */
    for (const id of WORMHOLE_CORE_ITEM_IDS) {
      const item = ctxItems.get(id)
      if (!item) {
        errors.push(`AI 核心契约：物品目录里没有 ${id} —— 遗迹掉落会散落出无定义的物品`)
        continue
      }
      if (item.kind !== 'aicore') errors.push(`AI 核心契约：${id} 的 kind = ${item.kind}，应为 aicore（container 会上拆解台）`)
      if (item.unitM3 !== 500) errors.push(`AI 核心契约：${id} 的体积 = ${item.unitM3} m³，应为 500（= 500 m³/格 × 1 格）`)
      if (!wormholeIsShapedItem(id)) errors.push(`AI 核心契约：${id} 没在 core 形状表里登记 —— 会被当散货塞进背包（形状丢失）`)
      if (wormholeShapeOf(id).w !== 1 || wormholeShapeOf(id).h !== 1) {
        errors.push(`AI 核心契约：${id} 的形状 = ${wormholeShapeOf(id).w}×${wormholeShapeOf(id).h}，应为 1×1（船长「单独占 1 格」）`)
      }
      if (wormholeCoreTypeOfItemId(id) === null) errors.push(`AI 核心契约：${id} 在 core 里反查不出核心账本键`)
    }
    for (const [key, price, buyable] of [
      ['core-basic', 25_000, true],
      ['core-gamma', 200_000, true],
      ['core-beta', 1_500_000, false],
      ['core-alpha', 10_000_000, false],
    ] as const) {
      const g = MARKET_GOODS.find((m) => m.key === key)
      if (!g) {
        errors.push(`AI 核心契约：市场目录里没有 ${key}`)
        continue
      }
      if (g.basePrice !== price) errors.push(`AI 核心契约：${key} 的行价 = ${g.basePrice}，应为 ${price}（船长 2026-09-14「2.5 万 / 20 万 / 150 万 / 1000 万」）`)
      const isBuyable = g.playerBuyable !== false
      if (isBuyable !== buyable) {
        errors.push(
          `AI 核心契约：${key} 的可买入 = ${isBuyable}，应为 ${buyable}` +
            (buyable ? '（伽马仍可市场购入）' : '（船长：「移除市场的贝塔和阿尔法 AI 核心的出售订单」⇒ 只收不卖）'),
        )
      }
    }
    /**
     * ⑦ **谜质储存器契约**（F3c · 船长 2026-09-13：「谜质玩家采集后，在货仓内显示为4格的『谜质储存器』」）。
     *
     * 每一台都必须：① `kind === 'matter'` ② **2000 m³**（正是 2×2 = 4 格）③ 在 core 形状表里**登记过**
     * （没登记 ⇒ 会被当散货合并进背包：2000 m³ 的单价体积会让"每格单位数"退化成 1 ⇒ 只占 1 格、形状也丢了，
     * 与货柜那次同款坑）；2026-09-14 虫洞上线后**不再要求 `unreleased`**（它本来就该在图鉴里）。
     * 另外 core 装置表与 data 物品表**两边 id 必须一一对应**（少一边 = 取回来一件读不懂/没有效果的东西）。
     */
    const matterIds = ITEMS.filter((i) => i.kind === 'matter').map((i) => i.id)
    for (const id of matterIds) {
      const item = ctxItems.get(id)
      if (!item) {
        errors.push(`谜质契约：物品目录里没有 ${id}（谜质储存器）—— 取回时会是"读不懂的东西"`)
        continue
      }
      if (item.kind !== 'matter') errors.push(`谜质契约：${id} 的 kind = ${item.kind}，应为 matter`)
      if (item.unitM3 !== 2000) errors.push(`谜质契约：${id} 的体积 = ${item.unitM3} m³，应为 2000（= 2×2 = 4 格）`)
      if (!wormholeIsShapedItem(id)) {
        errors.push(`谜质契约：${id} 没在 core 形状表里登记 —— 会被当散货塞进背包（只占 1 格、形状丢失）`)
      }
    }
    if (
      WORMHOLE_MATTER_DEVICE_IDS.length !== matterIds.length ||
      WORMHOLE_MATTER_DEVICE_IDS.some((id, i) => id !== matterIds[i])
    ) {
      errors.push(
        `谜质契约：core 装置表 [${WORMHOLE_MATTER_DEVICE_IDS.join(', ')}] 与 data 物品表 [${matterIds.join(', ')}] 不一致`,
      )
    }
    if (WORMHOLE_MATTER_FLOOR < 1) {
      errors.push(`谜质契约：每层保底谜质格数 = ${WORMHOLE_MATTER_FLOOR}，应 ≥ 1（船长：「每层保底 1 个谜质格」）`)
    }
    /**
     * ⑦b **退役装置不许再抽出**（2026-09-15 · 撤离战取消带出的第一批退役）。
     *
     * 口径：退役项**留在装置表与物品表**（老档读得懂、上面那条"两表一致"也要求如此），
     * 但**必须被排除在抽取池之外** —— 抽取只看 `WORMHOLE_MATTER_DRAW_POOL`。
     * 本契约双向把关：① 池子里不许有 `retired: true` 的项；② 池子不许空（否则 `% length` 会取到 undefined）。
     */
    const retiredInPool = WORMHOLE_MATTER_DRAW_POOL.filter((d) => d.retired === true).map((d) => d.id)
    if (retiredInPool.length > 0) {
      errors.push(`谜质契约：退役装置仍在抽取池里（${retiredInPool.join(', ')}）—— 退役项只许留档、不许抽出`)
    }
    if (WORMHOLE_MATTER_DRAW_POOL.length === 0) {
      errors.push('谜质契约：抽取池为空 —— 取谜质会崩（`h % pool.length`）')
    }
    for (const d of WORMHOLE_MATTER_DEVICES) {
      if (d.retired === true && WORMHOLE_MATTER_DRAW_POOL.some((p) => p.id === d.id)) {
        errors.push(`谜质契约：${d.id} 标了 retired 但仍在池里`)
      }
    }
    /**
     * ⑧ **图标契约**（F3c · 船长 2026-09-13：「**货仓内物品采用图标而不是纯文字，安全货仓和谜质的
     * SVG图标也需要绘制**」）：谜质 20 台与 5 种安全货柜**都必须有专属图形与色调**
     * （登记在 `ui/Glyphs.tsx` 的 `SHAPES` / `TONES` 里）。图标集在**渲染层**（core/data 看不到），
     * 所以这一条按"静态读源码"来核 —— 与"文档行数自检"同款，防的是"加了物品忘了画图标 ⇒
     * 货仓格里落成兜底圆环、玩家分不清"。
     */
    const glyphSrc = readFileSync(join(process.cwd(), 'apps/desktop/src/renderer/src/ui/Glyphs.tsx'), 'utf8')
    const blockOf = (from: string, to: string): string => {
      const a = glyphSrc.indexOf(from)
      const b = glyphSrc.indexOf(to)
      return a >= 0 && b > a ? glyphSrc.slice(a, b) : ''
    }
    const shapesBlock = blockOf('const SHAPES', 'export function Glyph')
    const tonesBlock = blockOf('export const TONES', 'export function toneOf')
    const hasKey = (block: string, key: string): boolean =>
      block.includes(`'${key}':`) || new RegExp(`(^|\\s)${key}:`, 'm').test(block)
    for (const id of [...matterIds, 'box-relic', 'box-bp', 'ai-core']) {
      if (!hasKey(shapesBlock, id)) errors.push(`图标契约：${id} 在 ui/Glyphs.tsx 的 SHAPES 里没有图形`)
      if (!hasKey(tonesBlock, id)) errors.push(`图标契约：${id} 在 ui/Glyphs.tsx 的 TONES 里没有色调`)
    }
    for (const fam of WORMHOLE_FAMILIES) {
      const boxId = `box-relic-${fam.toLowerCase()}`
      if (!hasKey(tonesBlock, boxId)) errors.push(`图标契约：安全货柜 ${boxId} 没有族色调（货仓格里按族分色）`)
    }
    // 图纸货柜三种按**层档**分色（浅/中/深），与安全货柜"按族分色"同一套做法
    for (const id of WORMHOLE_BP_BOX_IDS) {
      if (!hasKey(tonesBlock, id)) errors.push(`图标契约：图纸货柜 ${id} 没有层档色调（货仓格里按层档分色）`)
    }
    // AI 核心三种按**稀有度**分色（伽马 → 贝塔 → 阿尔法），同上做法
    for (const id of WORMHOLE_CORE_ITEM_IDS) {
      if (!hasKey(tonesBlock, id)) errors.push(`图标契约：AI 核心 ${id} 没有稀有度色调（货仓格里按稀有度分色）`)
    }
    /**
     * ⑨ **拆解链路契约**（F4d · 船长 2026-09-13 定：精炼炉拆解；2026-09-14 起两台口径分岔）：
     * - **安全货柜** = 100% 族专属池 ⇒ 该族池必须非空（原「族池 0.7 : 稀释池 0.3」的稀释池**已收回**）；
     * - **图纸货柜** = 5% 永久 / 95% 一次性 ⇒ **两种池在它的层档上都必须非空**。
     * 否则玩家拆一箱得到空气（或停炉），而 `content:check` 一声不吭。
     */
    const unboxCtx = buildSimContext()
    const floorDilution = wormholeDilutionPoolOf(unboxCtx, WORMHOLE_DILUTION_MIN_DEPTH_FLOOR)
    const shallowPerm = wormholePermanentPoolOf(unboxCtx, WORMHOLE_BP_BOX_DEPTH[WORMHOLE_BP_BOX_SHALLOW]!)
    console.log(
      '· 拆解链路读数：最低档一次性池', floorDilution.length, '张 · 浅层永久池', shallowPerm.length,
      '张 · 图纸货柜永久概率', WORMHOLE_BPBOX_PERMANENT_CHANCE,
      '（并列比例口径已于 2026-09-15 作废 ⇒ 见「战利品扩充契约⑦」的遗迹掉落池）',
    )
    if (floorDilution.length === 0) {
      errors.push('拆解契约：最低档一次性池为空 —— 图纸货柜会开出空气（池里要放一次性舰船蓝图）')
    }
    for (const id of WORMHOLE_BP_BOX_IDS) {
      const d = WORMHOLE_BP_BOX_DEPTH[id]!
      if (wormholeDilutionPoolOf(unboxCtx, d).length === 0) errors.push(`拆解契约：${id}（层档 ${d}）的一次性图纸池为空`)
      if (wormholePermanentPoolOf(unboxCtx, d).length === 0) errors.push(`拆解契约：${id}（层档 ${d}）的永久图纸池为空`)
    }
    for (const fam of WORMHOLE_FAMILIES) {
      const gap = wormholeFamilyPoolGaps(unboxCtx).filter((g) => g.includes(fam))
      if (gap.length > 0) errors.push(`拆解契约：${fam} 族池有空档 —— ${gap.join(' / ')}`)
    }
    /**
     * **AI 核心掉落契约**（2026-09-14 船长：「出率为 10%，**不挤占旧有出率**。三种核心根据稀有度
     * 区分出货权重」）。"不挤占"这条在代码里靠**独立随机流**实现，这里把口径钉成可验的断言：
     * ① 出货率 = 10%；② 权重 = 60/30/10（且按稀有度递减）；③ **核心不得混进任何既有抽取池**
     * —— 混进去就说明"两处都在发核心"，那才是真的挤占（同一个东西两个来源）。
     */
    if (WORMHOLE_CORE_SHARE !== 0.1) {
      errors.push(`AI 核心掉落契约：出货率 = ${WORMHOLE_CORE_SHARE}，应为 0.1（船长「出率为 10%」）`)
    }
    const cw = WORMHOLE_CORE_WEIGHTS
    if (cw.gamma + cw.beta + cw.alpha !== 100) {
      errors.push(`AI 核心掉落契约：权重和 = ${cw.gamma + cw.beta + cw.alpha}，应为 100（现 ${cw.gamma}/${cw.beta}/${cw.alpha}）`)
    }
    if (!(cw.gamma > cw.beta && cw.beta > cw.alpha)) {
      errors.push(`AI 核心掉落契约：权重未按稀有度递减（伽马 ${cw.gamma} / 贝塔 ${cw.beta} / 阿尔法 ${cw.alpha}）`)
    }
    const coreIds = [...WORMHOLE_CORE_ITEM_IDS] as readonly string[]
    const hitIn = (label: string, ids: readonly string[]): void => {
      const bad = ids.filter((id) => coreIds.includes(id))
      if (bad.length > 0) errors.push(`AI 核心掉落契约：核心混进了「${label}」抽取池（${bad.join('、')}）—— 同一件东西两个来源 = 挤占`)
    }
    for (const fam of WORMHOLE_FAMILIES) {
      const p = wormholeFamilyPoolOf(unboxCtx, fam)
      hitIn(`${fam} 族专属池`, [...p.modules, ...p.moduleBlueprints, ...p.shipBlueprints])
    }
    for (const d of [2, 3, 5]) {
      hitIn(`稀释池（层档 ${d}）`, wormholeDilutionPoolOf(unboxCtx, d))
      hitIn(`永久图纸池（层档 ${d}）`, wormholePermanentPoolOf(unboxCtx, d))
    }    const ore = MARKET_GOODS.find((g) => g.key === 'ore-voidmother')
    if (!ore) {
      errors.push('虫洞原矿契约：市场目录里找不到 ore-voidmother（虚空母矿）—— 产出会卖不出去')
    }
    // 物品卡：虚空母矿必须真的在「玩家可见物品目录」里（2026-09-14 上线后从"必须挡住"翻成"必须可见"）
    const oreItem = ITEMS.find((i) => i.id === 'ore-voidmother')
    if (!oreItem) {
      errors.push('虫洞原矿契约：物品目录里找不到 ore-voidmother（虚空母矿）')
    } else if (!itemReleased(oreItem)) {
      errors.push('虫洞原矿契约：虚空母矿不在「玩家可见物品目录」（visibleItemDefs）里 —— 工业页可精炼资源/图鉴都看不到它')
    }
    /**
     * ⑤ **「虫洞」字样**：2026-09-14 船长裁定「**解除虫洞对玩家的不可见状态**」＋「公开就叫**虫洞**」
     * ⇒ 当年那条「已上线内容不得出现『虫洞』字样」的**施工期保密闸门就此退休**（不再是错误）。
     * 这里只留一条**信息性**统计，供日后查文案一致性时参照（不计入 errors/warn）。
     */
    void ANOMALIES_FLAVORED.length
    /* ⑥ **（2026-09-13 补）装备 / 舰船 / 蓝图 / 无人机**：当年要求虫洞专属内容（id 前缀
     *  `mod-wh-` / `sh-wh-` / `bp-wh-` / `drone-wh-`）**一律标 `unreleased`** 以挡住三处"全目录枚举"的图鉴；
     *  **2026-09-14 上线后该闸门退休**（这些内容现在**必须**在图鉴里）。
     *  但**按族池契约照旧有效**（见下面 ⑦：五族各要有一池"装备 + 装备图纸 + 舰船图纸"，不许空池）。 */
    const WH_PREFIXES = ['mod-wh-', 'bp-wh-', 'sbp-wh-', 'sh-wh-', 'drone-wh-'] as const
    /**
     * ⚠ **2026-09-15 补（三号 · 船长报障「精炼炉好像缺少虫洞的稀有残骸回收」）**：上面五个前缀
     * **盖不到物品**，而洞内稀有残骸的物品 id = `wreck-rare-wh-<卡 id>`（前缀是 `wreck-rare-`）⇒
     * 它当年那条"施工期标 `unreleased`、上线删字段"的闸门**漏摘了也没人拦**，实机后果 =
     * 精炼炉「残骸回收」看不到洞内稀有残骸（该列表与手册物品图鉴都走 `visibleItemDefs`）。
     * 现把物品纳入本契约（id 前缀 `wreck-rare-wh-`）。
     */
    const WH_ITEM_PREFIX = 'wreck-rare-wh-'
    /**
     * ⚠ 稀有残骸物品**不在静态 `ITEMS` 数组里**（它们由 `data/src/context.ts` 按敌卡**运行时注册**）
     * ⇒ 本节一律读**真 context 的物品目录**（`buildSimContext().items`），读 `ITEMS` 会得到空集、
     * 哨子就变成永远通过（这条坑是首版写错后实测抓出来的）。
     */
    const whItemCtx = buildSimContext()
    const whItems = [...whItemCtx.items.values()].filter((i) => i.id.startsWith(WH_ITEM_PREFIX))
    const whTyped: ReadonlyArray<{ kind: string; id: string; name: string; description?: string; unreleased?: boolean }> = [
      ...MODULES.map((m) => ({ kind: '装备', id: m.id, name: m.name, description: m.description, unreleased: m.unreleased })),
      ...SHIPS.map((s) => ({ kind: '舰船', id: s.id, name: s.name, description: s.description, unreleased: s.unreleased })),
      ...BLUEPRINTS.map((b) => ({ kind: '装备图纸', id: b.id, name: b.name, description: b.description, unreleased: b.unreleased })),
      ...SHIP_BLUEPRINTS.map((b) => ({ kind: '舰船图纸', id: b.id, name: b.name, description: b.description, unreleased: b.unreleased })),
      ...DRONES.map((d) => ({ kind: '无人机', id: d.id, name: d.name, description: d.description, unreleased: d.unreleased })),
      ...whItems.map((i) => ({ kind: '残骸', id: i.id, name: i.name, description: i.description, unreleased: i.unreleased })),
    ]
    const isWhContent = (id: string): boolean =>
      WH_PREFIXES.some((p) => id.startsWith(p)) || id.startsWith(WH_ITEM_PREFIX)
    /**
     * **虫洞专属内容（`mod-wh-` / `sh-wh-` / `bp-wh-` / `sbp-wh-` / `drone-wh-`）现在必须真的在图鉴里**
     * （2026-09-14 船长解除不可见后，把当年"必须标 unreleased"的闸门翻成反向断言）——
     * 少一条就意味着"掉落抽到它、图鉴里却查不到"。
     */
    const whContent = whTyped.filter((d) => isWhContent(d.id))
    if (whContent.length === 0) {
      errors.push('虫洞专属内容契约：目录里一条 `*-wh-*` 内容都没有 —— 按族池会整片空掉')
    }
    for (const d of whContent) {
      if (d.unreleased === true) {
        errors.push(
          `虫洞专属内容契约：${d.kind} ${d.id}（${d.name}）仍标着 unreleased —— ` +
            `虫洞已上线（2026-09-14 船长解除不可见），图鉴/组装机/船坞都该看得到它`,
        )
      }
    }
    /**
     * **每张洞内敌卡都要有对应的稀有残骸物品**（2026-09-15 补）：缺一件 = 那一趟打捞带回来的箱子
     * 在回收炉里找不到定义（旧档更显示成"未知物品"）。注册走 `context.ts` 的白名单
     * （`hasLairCore` 不覆盖洞内卡），故这里按 `WORMHOLE_FOE_CARD_IDS` 逐张核。
     */
    for (const card of WORMHOLE_FOE_CARD_IDS) {
      const wreckId = `wreck-rare-${card}`
      if (!whItemCtx.items.has(wreckId)) {
        errors.push(`虫洞专属内容契约：洞内敌卡 ${card} 没有对应的稀有残骸物品 ${wreckId}（打捞回来的箱子开不了）`)
      }
    }
    /* ⑦ **（2026-09-13 F3b 补）按族池契约**（船长：「虫洞专属掉落按种族库走，蓝图也是按种族库」）：
     * 五族（A/C/D/E/G）各要有一池「装备本体 + 装备图纸 + 舰船图纸」——缺一族就有一整族拿不到东西
     * （E 族此前正是这个状态，靠补第五张洞内卡 `wh-titan-echo` 才通）。池本身由 core 从目录按 id
     * 前缀派生（`wormholeFamilyPoolOf`），这里断言"派生出来必须非空"，顺带把 id 前缀约定钉成契约。
     * **（2026-09-13 二号接线单补）族专属无人机**（`drone-wh-<族>-`）是 C/E 两族的**第 6 件替换物**
     * ⇒ **不进"五族齐备"判据**（只有两族有，缺了不算空池），但**要进孤儿检查**：
     * 族标记写错一个字母的无人机永远掉不出来，且不会有任何别的报错——正是要机器守的地方。 */
    const poolCtx = buildSimContext()
    const poolGaps = wormholeFamilyPoolGaps(poolCtx)
    if (poolGaps.length > 0) {
      errors.push(`虫洞按族池契约：${poolGaps.join('、')} —— 该族的洞内掉落会空池（见设计稿 §11.6）`)
    }
    const poolCounts = WORMHOLE_FAMILIES.map((f) => {
      const p = wormholeFamilyPoolOf(poolCtx, f)
      return `${f} ${p.modules.length}/${p.moduleBlueprints.length}/${p.shipBlueprints.length}${p.drones.length > 0 ? `+机${p.drones.length}` : ''}`
    }).join(' · ')
    // **无孤儿**：所有 `mod-wh-` / `bp-wh-` / `sbp-wh-` / `drone-wh-` 内容都必须落进某一族池（族标记写错一个字母
    // ⇒ 那件内容**永远不会掉出来**，而且不会有任何别的报错——这正是要机器守的地方）。
    const pooled = new Set<string>()
    for (const f of WORMHOLE_FAMILIES) {
      const p = wormholeFamilyPoolOf(poolCtx, f)
      for (const id of [...p.modules, ...p.moduleBlueprints, ...p.shipBlueprints, ...p.drones]) pooled.add(id)
    }
    const orphans: string[] = []
    for (const id of poolCtx.modules.keys()) if (id.startsWith('mod-wh-') && !pooled.has(id)) orphans.push(id)
    for (const id of poolCtx.blueprints.keys()) if (id.startsWith('bp-wh-') && !pooled.has(id)) orphans.push(id)
    for (const id of poolCtx.shipBlueprints.keys()) if (id.startsWith('sbp-wh-') && !pooled.has(id)) orphans.push(id)
    for (const id of poolCtx.items.keys()) if (id.startsWith('drone-wh-') && !pooled.has(id)) orphans.push(id)
    if (orphans.length > 0) {
      errors.push(`虫洞按族池契约：这些内容没落进任何族池（族标记写错了？⇒ 永远掉不出来）：${orphans.join('、')}`)
    }
    const droneIds = [...poolCtx.items.keys()].filter((id) => id.startsWith('drone-wh-'))
    if (droneIds.length > 0) {
      // 无人机是**替换物**：有它的族，装备件数应比别族少 1（C/E = 5 件装备 + 1 型无人机）
      const odd = WORMHOLE_FAMILIES.filter((f) => {
        const p = wormholeFamilyPoolOf(poolCtx, f)
        if (p.drones.length === 0) return false
        return p.modules.length + p.drones.length !== 6
      })
      if (odd.length > 0) {
        errors.push(
          `虫洞按族池契约：${odd.join('、')} 族的「装备 + 无人机」不等于 6 件 —— 无人机是替换物（移除一件装备、补一型无人机），件数不该净增（见专属稿 §6.1）`,
        )
      }
    }
    /* ⑦b **稀释池契约**（2026-09-13 船长：「将新增的一次性蓝图放入虫洞的专属奖池内作为稀释」＋
     * 「按70:30，不过T4降到3层，T5降到5层」）：
     * 池内容 = T3/T4/T5 的一次性舰船蓝图，**按层分档**进池（T3 层 2 起 / T4 层 3 起 / T5 层 5 起），
     * 抽取时族专属池 70% / 稀释池 30%。本契约钉四件事：① 层分档的**件数**；② 池里**只许**一次性蓝图；
     * ③ 与族池**不重叠**（稀释池不该混进族专属件）；④ 权重和恒为 1。 */
    const dil2 = wormholeDilutionPoolOf(poolCtx, 2)
    const dil3 = wormholeDilutionPoolOf(poolCtx, 3)
    const dil5 = wormholeDilutionPoolOf(poolCtx, 5)
    // 件数是"防手滑"守卫：现内容 = T3 十艘 / T4 四艘 / T5 一艘（加船时这里与用例要一起改）
    check(dil2.length === 10, `稀释池契约：层 2 应为 T3 十张，实际 ${dil2.length} 张（${dil2.join('、')}）`)
    check(dil3.length === 14, `稀释池契约：层 3 应加 T4 四张（共 14），实际 ${dil3.length} 张`)
    check(dil5.length === 15, `稀释池契约：层 5 应加 T5 一张（共 15），实际 ${dil5.length} 张`)
    for (const id of dil5) {
      const bp = poolCtx.shipBlueprints.get(id)
      check(bp?.singleUse === true, `稀释池契约：${id} 不是一次性舰船蓝图（稀释池只放 ` + '`sbp-once-*` + singleUse）')
      if (pooled.has(id)) errors.push(`稀释池契约：${id} 同时落在族专属池里——稀释池与族池必须互斥`)
    }
    // ⚠ 2026-09-14：船长新增**图纸货柜**并裁定「与安全货柜并列」⇒ 安全货柜改 **100% 族专属池**，
    //   70:30 那条稀释池分支**已停用** ⇒ 这里只断言"留档常量仍自洽、值未被误改"，
    //   不再断言它参与抽取（运行时抽取口径见 `wormholeUnboxRoll`）。
    const shares = wormholeLootShares()
    check(
      Math.abs(shares.family + shares.dilution - 1) < 1e-9 && Math.abs(shares.dilution - 0.3) < 1e-9,
      `稀释池契约（**已停用·仅留档**）：常量应为族 0.7 / 稀释 0.3，实际 ${shares.family} / ${shares.dilution}`,
    )
    const vis = (arr: ReadonlyArray<{ unreleased?: boolean }>): string =>
      `${arr.filter((d) => d.unreleased !== true).length}/${arr.length}`
    /* ⑦c **层间盘面契约**（2026-09-13 船长三条：「让遗迹格数量随层数增加并给每层增加一个遗迹格下限」＋
     * 「空地块允许随着高层权重降低」＋「在四层以上及以上，添加星云机制…空地没有星云」；
     * **2026-09-16 船长改判**：「**遗迹的保底，改为从3层开始保底。1层没有遗迹**」）：
     * 钉五件事：① **逐层遗迹 ≥ 下限**（真生成 12 seed 实数，不只看公式；层 1/2 下限 = 0）；
     * ①b **层 1 恒 0 张遗迹**（船长 2026-09-16 明示）＋ **层 2 无保底**；
     * ② **信标恒 ≥1**（每层都要有指路标记——借格子只从资源/谜质借）；
     * ③ **层 1~3 绝不出星云、层 4 起配额与"有信号格数 × 15%"一致、空地与入口不长星云**；
     * ④ 空占比与 `wormholeEmptyShareFor` 一致（**量纲 = 占可分配池**）。 */
    {
      const planSeeds = Array.from({ length: 12 }, (_, i) => 20260913 + i * 37)
      const depths = [1, 2, 3, 4, 5, 6, 8]
      let nebAcc = 0
      for (const depth of depths) {
        const floor = wormholeRuinsFloorFor(depth)
        for (const seed of planSeeds) {
          const g = wormholeMakeGrid(seed, depth, 0)
          const ruins = g.cells.filter((c) => c.place === 'ruins').length
          check(
            ruins >= floor,
            `层间盘面契约：第 ${depth} 层（seed ${seed}）遗迹格 ${ruins} < 下限 ${floor} —— 「给每层增加一个遗迹格下限」没生效`,
          )
          if (depth === 1) {
            check(ruins === 0, `层间盘面契约：第 1 层（seed ${seed}）出了 ${ruins} 张遗迹 —— 船长 2026-09-16「1层没有遗迹」`)
          }
          const beacons = g.cells.filter((c) => c.place === 'beacon').length
          check(beacons >= 1, `层间盘面契约：第 ${depth} 层（seed ${seed}）没有信标——每层必须有一个指路标记`)
          const empties = g.cells.filter((c) => c.place === 'empty').length
          const wantEmpty = Math.ceil((g.cells.length - 1) * wormholeEmptyShareFor(depth))
          check(
            empties >= wantEmpty && empties <= wantEmpty + 1,
            `层间盘面契约：第 ${depth} 层（seed ${seed}）空格 ${empties} 不在 [${wantEmpty}, ${wantEmpty + 1}]` +
              `（口径 = 占可分配池 ${wormholeEmptyShareFor(depth)}）`,
          )
          const nebs = g.cells.filter((c) => c.nebula === true)
          if (depth < WORMHOLE_NEBULA_MIN_DEPTH) {
            check(nebs.length === 0, `层间盘面契约：第 ${depth} 层不该有星云（起效层 = ${WORMHOLE_NEBULA_MIN_DEPTH}）`)
          } else {
            for (const c of nebs) {
              check(
                c.place !== 'empty',
                `层间盘面契约：第 ${depth} 层（seed ${seed}）空地点上长了星云 —— 船长明示「空地没有星云」`,
              )
              check(
                c.key !== `${g.exit.q},${g.exit.r}`,
                `层间盘面契约：第 ${depth} 层（seed ${seed}）下一层入口被星云罩住（导航标记不该被遮）`,
              )
            }
            const cands = g.cells.filter((c) => c.place !== 'empty' && c.key !== `${g.exit.q},${g.exit.r}`).length
            const quota = Math.min(Math.ceil(cands * WORMHOLE_NEBULA_SHARE), Math.floor(cands * 0.5))
            check(
              nebs.length === quota,
              `层间盘面契约：第 ${depth} 层（seed ${seed}）星云 ${nebs.length} ≠ 配额 ${quota}`,
            )
          }
          nebAcc += nebs.length        }
      }
      const samples = planSeeds.length
      const perDepthRuins = depths.map((d) => {
        let sum = 0
        for (const seed of planSeeds) sum += wormholeMakeGrid(seed, d, 0).cells.filter((c) => c.place === 'ruins').length
        return `层${d}=${(sum / samples).toFixed(2)}`
      })
      console.log(
        `· 层间盘面契约：遗迹格下限 ${depths.map((d) => `层${d}≥${wormholeRuinsFloorFor(d)}`).join(' · ')}` +
          `（**保底从层 ${WORMHOLE_RUINS_FLOOR_MIN_DEPTH} 起**；层 1 恒 0 张 · 层 2 无保底）` +
          `（实测均值 ${perDepthRuins.join(' / ')} · ${samples} seed/层）` +
          ` · 空占比（占可分配池）${depths.map((d) => `${(wormholeEmptyShareFor(d) * 100).toFixed(0)}%`).join('/')}` +
          ` · 星云：层 ${WORMHOLE_NEBULA_MIN_DEPTH} 起、配额 ${(WORMHOLE_NEBULA_SHARE * 100).toFixed(0)}%、只长在有信号的地点上` +
          `（实测合计 ${nebAcc} 格）`,
      )
    }
    console.log(
      `· 虫洞内容契约（2026-09-14 上线后口径）：洞内敌卡 ${whIds.length} 张全部 hidden 且无赏金` +
        ` · 虚空母矿「市场卡 + 物品卡」双双可见` +
        ` · 虫洞专属装备/舰船/图纸 **${whContent.length}** 条**全部已上线**（无 unreleased）` +
        ` · 按族池（装备/装备图/舰船图[+族专属无人机]）${poolCounts} · 族专属无人机 ${droneIds.length} 型（不进五族齐备判据：C/E 替换物）` +
        ` · **稀释池**（族 ${shares.family} : 稀释 ${shares.dilution}）层 2 = ${dil2.length} / 层 3 = ${dil3.length} / 层 5 = ${dil5.length} 张一次性舰船蓝图` +
        ` · 玩家可见目录（装备 ${vis(MODULES)} · 舰船 ${vis(SHIPS)} · 装备图纸 ${vis(BLUEPRINTS)} · 舰船图纸 ${vis(SHIP_BLUEPRINTS)}）` +
        ` · 文案：「虫洞」字样已解禁（公开叫法，2026-09-14 船长定）${leaked > 0 ? `（⚠ ${leaked} 张未 hidden）` : ''}`,
    )
  }
  for (const bp of BLUEPRINTS) {
    const label = bp.moduleId !== undefined ? (modName.get(bp.moduleId) ?? bp.moduleId) : bp.itemId !== undefined ? `${itemName.get(bp.itemId) ?? bp.itemId} ×${bp.outputUnits ?? 1}` : '?'
    const good = marketOfBp.get(bp.id)
    /**
     * **专属一次性图纸**（2026-09-14 船长「允许玩家挂卖」批 + 「专属无人机出一次性蓝图」）：
     * 这类图纸**只从洞内打捞 / 窝点高级箱出**，市场行是"只收不卖"（玩家可挂卖、市场不出售现货）⇒
     * 它们的书价口径与"市场在售的蓝图"不同：
     *   ① **不套档位系数**——`书价 = 产物价`（产物与图纸同料单 ⇒ 同值）；
     *      正常蓝图的 ×2/×2.5/×3/×4 是"市场垄断售卖"的加价，专属掉落物没有这一层；
     *   ② 因而 **料/价 恒 ≈11.25%**（= 0.45 ÷ 4，专属 ×4 口径），天然落在 30%~60% 带外 ⇒ 一并豁免；
     *   ③ 舰船那 15 张另守船长 2026-09-14「一次性舰船蓝图 = 舰价 ×0.5」，由上方
     *      「一次性舰船蓝图价格口径」单独核（不重复计预警）。
     */
    const exclusiveOnce = bp.singleUse === true && good?.playerBuyable === false
    if (exclusiveOnce) exclusiveOnceBp += 1
    if (!good) {
      /* **一次性图纸豁免**（2026-09-13 船长：「不掉永久图纸」⇒ 虫洞专属装备/舰船只出一次性图纸）：
       * 它**不上市场**（2026-09-12 船长裁定「来源由掉落/奖励指定」），故"没有市场行"不是错；
       * 但也**不参与**档位系数与料/价比对（没有产物现货价可比），单独计数留痕。 */
      if (bp.singleUse === true) {
        exemptSingleUse += 1
        continue
      }
      errors.push(`蓝图价格口径：${bp.id}（${label}）在市场目录里没有蓝图行——玩家买不到，也无法比对书价`)
      mismatchPrice += 1
      continue
    }
    if ((good.basePrice ?? 0) !== bp.priceIsk) {
      errors.push(
        `蓝图价格口径：${bp.id}（${label}）blueprints.ts 书价 = ${bp.priceIsk.toLocaleString('zh-CN')}，市场行 basePrice = ${(good.basePrice ?? 0).toLocaleString('zh-CN')}（两处必须同值）`,
      )
      mismatchPrice += 1
    }
    // 专属一次性图纸：只核「书价 = 产物价」（不套系数、不比料/价带），核过就继续
    if (exclusiveOnce) {
      const prodEx =
        bp.moduleId !== undefined
          ? (marketOfModule.get(bp.moduleId)?.basePrice ?? 0)
          : (marketOfItem.get(bp.itemId ?? '')?.basePrice ?? 0) * (bp.outputUnits ?? 1)
      // 舰船产物（`itemId`/`moduleId` 都没有的走上面分支取不到）不在这里核，交给舰船契约
      if (prodEx > 0 && bp.itemId !== undefined && bp.priceIsk !== prodEx) {
        warn.push(
          `蓝图价格口径：${bp.id}（${label}）是专属一次性图纸，书价应 = 产物价 ${prodEx.toLocaleString('zh-CN')}（专属掉落不套档位系数），实际 ${bp.priceIsk.toLocaleString('zh-CN')}`,
        )
        driftCoef += 1
      } else {
        okCoef += 1
      }
      continue
    }
    // 产物现货价（item 类按单次产出数量折算）
    const product =
      bp.moduleId !== undefined
        ? (marketOfModule.get(bp.moduleId)?.basePrice ?? 0)
        : (marketOfItem.get(bp.itemId ?? '')?.basePrice ?? 0) * (bp.outputUnits ?? 1)
    const { coef, label: tierLabel } = blueprintTierCoefOf(bp.id, good.rarity)
    tiers[tierLabel] = (tiers[tierLabel] ?? 0) + 1
    if (product <= 0) {
      warn.push(`蓝图价格口径：${bp.id}（${label}）找不到产物现货价——无法按档位系数核算书价`)
      continue
    }
    const expect = blueprintBookPriceOf(bp.id, product, good.rarity)
    const ov = BLUEPRINT_PRICE_OVERRIDES[bp.id]
    if (ov) {
      overridden += 1
      if (bp.priceIsk !== ov.price || (good.basePrice ?? 0) !== ov.price) {
        errors.push(
          `蓝图价格口径：${bp.id}（${label}）已登记单独覆盖价 ${ov.price.toLocaleString('zh-CN')}（理由：${ov.reason}），但 blueprints.ts = ${bp.priceIsk.toLocaleString('zh-CN')}、市场行 = ${(good.basePrice ?? 0).toLocaleString('zh-CN')}——三处必须同值`,
        )
        mismatchPrice += 1
      } else {
        okCoef += 1
      }
    } else if (bp.priceIsk !== expect) {
      warn.push(
        `蓝图价格口径：${bp.id}（${label}）书价 = ${bp.priceIsk.toLocaleString('zh-CN')}，按「${tierLabel} 产物价 ${product.toLocaleString('zh-CN')} ×${coef}」应为 ${expect.toLocaleString('zh-CN')}（±${BLUEPRINT_PRICE_STEP} ISK 取整余量内视为达标；若是有意偏离，请在 BLUEPRINT_PRICE_OVERRIDES 登记）`,
      )
      driftCoef += 1
    } else {
      okCoef += 1
    }
    // 料/价（材料成本 ÷ 产物现货价；材料按物品站内收价计）
    let mat = 0
    for (const m of bp.materials) mat += Math.max(1, Math.floor(m.count)) * (itemSell.get(m.itemId) ?? 0)
    const ratio = product > 0 ? mat / product : 0
    if (ratio < 0.3 || ratio > 0.6) {
      warn.push(
        `蓝图价格口径：${bp.id}（${label}）料/价 = ${(ratio * 100).toFixed(1)}%（材料 ${mat.toLocaleString('zh-CN')} ÷ 产物 ${product.toLocaleString('zh-CN')}）落在 30%~60% 之外（同族锚 45%）`,
      )
      driftMatRatio += 1
    }
  }
  console.log(
    `· 蓝图价格口径：${BLUEPRINTS.length} 张装备/物品蓝图中，书价与规则值一致 ${okCoef} 张（${Object.entries(tiers)
      .map(([k, v]) => `${k} ${v}`)
      .join(' / ')}；单独覆盖 ${overridden} 张；**无市场行的一次性图纸豁免 ${exemptSingleUse} 张**；**专属一次性图纸（只收不卖）${exclusiveOnceBp} 张**（书价 = 产物价，不套档位系数、不比料/价带——2026-09-14 船长「允许玩家挂卖」批））；书价与市场行不符 ${mismatchPrice} 处（硬契约）、与档位系数不符 ${driftCoef} 处（预警）、料/价出带 ${driftMatRatio} 处（预警）`,
  )
}

/* ── 通讯消息契约（2026-09-11 通讯系统）────────────────────────────────────────────
   体检口径：id 唯一、字段齐备、触发器字段可解析（星系/技能/站点必须真实存在）、
   跳转目标页合法（及其页面内标签）、玩家可见文案不含开发用词；
   剧本（DIALOGUES）侧只查主题与正文可用（它们也要进同一个收件箱）。
   2026-09-11 v2 扩展：发件方改为「势力 + 部门」引用，故新增
   **势力契约**（species 恒为章鱼人、部门 id 势力内唯一、立场合法、色调/图标有口径）
   与**发件方引用契约**（factionId/deptId 必须存在、kind 必须落在势力白名单、每个势力至少被引用一次）。 */
{
  // 注：'task' = 任务中心（2026-09-14 起是独立一级页，不再是星图页的选项卡）
const JUMP_PAGES = new Set(['map', 'ship', 'fit', 'items', 'market', 'industry', 'skills', 'comms', 'task'])
  const MAP_TABS = new Set(['star', 'mine', 'bounty', 'salvage', 'haul', 'task'])
  /** 舰船页内标签（`hint.shipTab`；与 App.tsx 的 ShipTab 同口径）
   *  ⚠ 2026-09-15 同步（三号）：2026-09-14 船长把舰船页第三档「舰船市场」整档换成「**舰船仓库**」
   *  （`ShipPage.tsx`：`ShipTab = 'fleet' | 'ai' | 'store'`），本白名单当时漏改，仍写着早已不存在的
   *  `'fit'`、缺 `'store'` ⇒ 本批（首艘自造船通讯要跳 `store`）按现行类型同步。 */
  const SHIP_TABS = new Set(['fleet', 'ai', 'store'])
  /** 任务中心内层标签（`hint.taskTab`；与 panels/Expedition.tsx 的 TaskTabKey 同口径） */
  const TASK_TABS = new Set(['important', 'resource', 'courier', 'bounty'])
  const TRIGGER_KINDS = new Set([
    'start', 'day', 'explored', 'galaxy', 'skill', 'isk', 'siteBuilt', 'tutorial',
    // 2026-09-12 星系机制通讯：低安空域（**低安 = sec ≤ 0，含 0**，与伏击掷骰同源）· 某族敌人所在的星系
    'lowSec', 'foeFamily',
  // 2026-09-16 首次遭遇某敌舰级（船长：首次遭遇劫掠电子舰后发一封介绍捕获网的通讯）
  'foeShipSeen',
    // 2026-09-13 星云机制（船长：「除了一次性事件，通讯内也发一条相关的讯息给玩家」）
    'wormholeNebula',
    // 2026-09-14 虫洞扫描解锁（船长：「扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家」）
    'standing',
    // 2026-09-14 被袭后的自动撤离（船长：「当玩家第一次因为低安袭击导致舰船自动撤离时触发」）
    'ambushRetreat',
    // 2026-09-15 造出第一艘自造船（船长：「当玩家造好第一条船后，弹出通讯祝贺玩家，并告诉玩家
    // 新建造的舰船在舰船仓库页面」）——判定读随档三态标记 `state.firstShipBuilt`
    'shipBuilt',
  ])
  const KINDS = new Set(['剧情', '提示', '委托', '教程'])
  const ALIGNMENTS = new Set(['官方', '民间', '中立', '系统'])
  /**
   * 既有线稿图标名（`apps/desktop/src/renderer/src/ui/Glyphs.tsx` 的 `GLYPHS` 表；
   * 势力 `glyph` 只能复用它们，不许自造图标名——界面查不到会渲染空白）。
   */
  const ICON_NAMES = new Set([
    'drone-rack', 'drone-tac', 'drone-relay', 'target-lock',
    'nav-map', 'nav-ship', 'nav-fit', 'nav-items', 'nav-market', 'nav-industry', 'nav-skills',
    'nav-mail', 'nav-mine', 'nav-bounty', 'nav-salvage', 'nav-task', 'nav-ai', 'nav-shop', 'nav-haul',
    // 官方章鱼人头像（2026-09-11 船长定：代表官方章鱼人；所有 NPC 势力共用，只靠色调区分）
    'faction-octopus',
    'ico-home', 'ico-lock', 'ico-clock', 'ico-loop', 'ico-flag', 'ico-star', 'ico-scan',
    'ico-swap', 'ico-cross', 'ico-crane', 'ico-antenna', 'ico-tact',
  ])
  /** 玩家可见文案禁用的开发/出戏用词（与词典「玩家可见文案禁用彩头/主题件/掉池」同口径，宽清单） */
  const BANNED = ['彩头', '主题件', '掉池', '基础池', '区划', '口径', '断言', '白名单', '体检', '待定', '占位', 'EVE', 'npm', 'ISK', 'NPC']
  /**
   * 世界观铁律（2026-09-11 船长定，`docs/design/npc-factions-20260911.md`）：
   * **对外（章鱼人 NPC）玩家是「飞行员」——他们不追问船里是谁**；**对内（船自己的系统）玩家知道自己就是舰载 AI**
   * （船长 2026-09-11：「外部认知中我们是飞行员，但内部系统中我们知道自己是舰载 AI」）。
   *
   * 判定方式：先按"玩家本质词"命中，再**豁免既有系统官方名**（`AI 核心`、`人工智能专家`、
   * `AI` + 中文的既有系统名，以及「舰载 AI」这一自我认知表述——它正是船内系统的正当说法）。
   * **豁免是按发件方分级的**：NPC 势力（官方/民间/中立）用完整豁免；
   * **船内系统（`alignment === '系统'`，如信息库）不吃「舰载 AI」豁免**——它本该知道玩家是什么。
   */
  const PLAYER_ESSENCE = ['AI', '智能', '旧时代', '人类']
  const LORE_EXEMPT = ['AI 核心', '人工智能']
  /**
   * `keepSelfKnowledge = true`（**仅船内系统来源**，如信息库）时额外豁免「舰载 AI / 船载 AI / 舰船 AI / 旧时代」——
   * 那是玩家自己的系统在说自己的事，正是船长定的"内部系统中我们知道自己是舰载 AI"
   * （`旧时代` 也在内：序章收尾台词「一艘不该存在的旧时代舰船 AI」本来就是船的自我认知）。
   * NPC 来源**不给**这条豁免：章鱼人不该知道船里是谁，写了就该被拦（先写反过一次，负向验证抓出来的）。
   */
  const SELF_KNOWLEDGE = /舰载\s*AI|船载\s*AI|舰船\s*AI|旧时代/g
  const loreHits = (text: string, opts?: { keepSelfKnowledge?: boolean }): string[] => {
    let masked = text
    for (const ex of LORE_EXEMPT) masked = masked.split(ex).join('□'.repeat(ex.length))
    // 既有系统名的其余写法（「AI 指挥中心」「AI 副船」等）：**连空格一起**吃掉；
    // 纯「AI」或「AI + 非中文」仍会命中（那才是把玩家当成 AI 说话的写法）。
    masked = masked.replace(/AI\s*(?=[\u4e00-\u9fa5])/g, '□□')
    if (opts?.keepSelfKnowledge) masked = masked.replace(SELF_KNOWLEDGE, '□□□')
    return PLAYER_ESSENCE.filter((w) => masked.includes(w))
  }
  /** 玩家与船不可分离（玩家就是那条船）：直接查说法，不做豁免 */
  const LORE_SPLIT = ['你的舰船']
  const galaxyIds = new Set(GALAXIES.map((g) => g.id))
  const skillIds = new Set(SKILLS.map((s) => s.id))
  const siteIds = new Set(STATION_SITES.map((s) => s.id))

  /* ① 势力契约（NPC 势力档案本身） */
  const factionIds = new Set<string>()
  const deptKeys = new Set<string>()
  for (const f of COMMS_FACTIONS) {
    check(f.id.trim().length > 0 && !factionIds.has(f.id), `势力 id 重复或为空：${f.id}`)
    factionIds.add(f.id)
    check(f.name.trim().length > 0, `势力 ${f.id} 缺名称`)
    // 铁律：所有 **NPC** 势力都是章鱼人（防设定漂移）；船内系统（alignment = 系统）不是 NPC，无物种要求
    const isSystem = f.alignment === '系统'
    check(
      isSystem ? f.species.trim().length > 0 : f.species === '章鱼人',
      isSystem ? `系统来源 ${f.id} 缺物种标注` : `势力 ${f.id} 的物种必须是章鱼人（世界观铁律），实际：${f.species}`,
    )
    check(ALIGNMENTS.has(f.alignment), `势力 ${f.id} 立场非法：${f.alignment}`)
    check(/^#[0-9a-fA-F]{6}$/.test(f.tone), `势力 ${f.id} 色调不是六位十六进制：${f.tone}`)
    check(ICON_NAMES.has(f.glyph), `势力 ${f.id} 图标不在既有线稿图标表内：${f.glyph}`)
    // 头像口径（2026-09-11 船长：「头像换成类似核心的SVG」⇒ 按发件方分两种头像）：
    // 船内系统 → 核心形图标；NPC 势力 → 官方章鱼头。写别的图标会打破"一个符号代表一类发件方"的口径。
    const wantAvatar = FACTION_AVATARS[f.id] ?? 'faction-octopus'
    check(
      f.glyph === wantAvatar,
      `势力 ${f.id} 的头像应为 ${wantAvatar}（${isSystem ? "船内系统用核心形图标" : "NPC 用官方章鱼头"}），实际：${f.glyph}`,
    )
    check(
      f.brief.trim().length > 0,
      `势力 ${f.id} 缺简介（界面「这是谁」说明）`,
    )
    check(f.kinds.length > 0, `势力 ${f.id} 没有可发内容类型白名单`)
    for (const k of f.kinds) check(KINDS.has(k), `势力 ${f.id} 白名单里的内容类型非法：${k}`)
    check(f.departments.length > 0, `势力 ${f.id} 没有部门（发件人写法的后半截）`)
    const deptIds = new Set<string>()
    for (const d of f.departments) {
      check(d.id.trim().length > 0 && !deptIds.has(d.id), `势力 ${f.id} 的部门 id 重复或为空：${d.id}`)
      deptIds.add(d.id)
      deptKeys.add(`${f.id}/${d.id}`)
      check(d.name.trim().length > 0, `势力 ${f.id} 部门 ${d.id} 缺名称`)
      check(d.brief.trim().length > 0, `势力 ${f.id} 部门 ${d.id} 缺简介`)
      check(d.kinds.length > 0, `势力 ${f.id} 部门 ${d.id} 没有可发内容类型白名单`)
      for (const k of d.kinds) {
        check(KINDS.has(k), `势力 ${f.id} 部门 ${d.id} 白名单里的内容类型非法：${k}`)
        check(f.kinds.includes(k), `势力 ${f.id} 部门 ${d.id} 白名单「${k}」超出势力白名单`)
      }
    }
  }

  /* ② 发件方引用契约（消息 + 剧本都必须挂靠到真实势力/部门） */
  const referenced = new Set<string>()
  const seen = new Set<string>()
  let hints = 0
  for (const m of COMMS_MESSAGES) {
    check(m.id.length > 0 && !seen.has(m.id), `通讯消息 id 重复或为空：${m.id}`)
    seen.add(m.id)
    check(m.subject.trim().length > 0, `通讯 ${m.id} 缺主题`)
    check(m.body.length > 0 && m.body.every((p) => p.trim().length > 0), `通讯 ${m.id} 正文为空段`)
    // 发件方：势力必须存在；有部门则部门必须在**该势力**下存在；kind 必须落在两级白名单里
    const faction = COMMS_FACTIONS.find((f) => f.id === m.factionId)
    check(faction !== undefined, `通讯 ${m.id} 的发件势力不存在：${m.factionId}`)
    check(KINDS.has(m.kind), `通讯 ${m.id} 内容类型非法：${m.kind}`)
    if (faction) {
      referenced.add(faction.id)
      check(faction.kinds.includes(m.kind), `通讯 ${m.id} 的内容类型「${m.kind}」不在势力 ${faction.id} 白名单内`)
      if (m.deptId !== undefined) {
        const dept = faction.departments.find((d) => d.id === m.deptId)
        check(dept !== undefined, `通讯 ${m.id} 的发件部门不在势力 ${faction.id} 下：${m.deptId}`)
        if (dept) check(dept.kinds.includes(m.kind), `通讯 ${m.id} 的内容类型「${m.kind}」不在部门 ${m.deptId} 白名单内`)
      }
    }
    check(TRIGGER_KINDS.has(m.trigger.kind), `通讯 ${m.id} 触发器 kind 未知：${m.trigger.kind}`)
    switch (m.trigger.kind) {
      case 'day':
        check(Number.isInteger(m.trigger.days) && m.trigger.days >= 1, `通讯 ${m.id} day.days 应为 ≥1 整数`)
        break
      case 'explored':
        check(Number.isInteger(m.trigger.count) && m.trigger.count >= 1, `通讯 ${m.id} explored.count 应为 ≥1 整数`)
        break
      case 'galaxy':
        check(galaxyIds.has(m.trigger.galaxyId), `通讯 ${m.id} 指向的星系不存在：${m.trigger.galaxyId}`)
        break
      case 'skill':
        check(skillIds.has(m.trigger.skillId), `通讯 ${m.id} 指向的技能不存在：${m.trigger.skillId}`)
        check(Number.isInteger(m.trigger.level) && m.trigger.level >= 1, `通讯 ${m.id} skill.level 应为 ≥1 整数`)
        break
      case 'isk':
        check(m.trigger.amount > 0, `通讯 ${m.id} isk.amount 应为正数`)
        break
      case 'siteBuilt':
        check(siteIds.has(m.trigger.siteId), `通讯 ${m.id} 指向的建站点不存在：${m.trigger.siteId}`)
        break
      case 'tutorial':
        // 教程通讯：0 = 序章简报（信息库检索重启），1..TUTORIAL_TOTAL = 七步教程（与 core 的 ONB_* 同值）
        check(
          Number.isInteger(m.trigger.step) && m.trigger.step >= 0 && m.trigger.step <= TUTORIAL_TOTAL,
          `通讯 ${m.id} tutorial.step 应在 0..${TUTORIAL_TOTAL}：${m.trigger.step}`,
        )
        break
      case 'lowSec':
        // 死触发器守卫（2026-09-12 星系机制通讯）：数据里必须真的存在低安星系，否则这封信永远不会送达。
        // 低安口径与引擎**同一出处**（`balance.encounter.lowSecMax`，缺省 0 = 含 0，见船长「0也算低安」）
        check(
          GALAXIES.some((g) => (g.security ?? 1) <= DEFAULT_BALANCE.encounter.lowSecMax),
          `通讯 ${m.id} 用 lowSec 触发器，但数据里没有低安星系（安全等级 ≤ ${DEFAULT_BALANCE.encounter.lowSecMax}）`,
        )
        break
      case 'foeFamily':
        // 死触发器守卫：该族必须真的有敌卡（读敌卡数据判定，故这里也按数据核）
        check(
          ANOMALIES_FLAVORED.some((a) => a.foeFamily === m.trigger.family),
          `通讯 ${m.id} 指向的敌族没有任何敌卡（死触发器）：${m.trigger.family}`,
        )
        break
      case 'standing': {
        /**
         * 死触发器守卫（2026-09-14 虫洞解锁信）：这封信靠「协会声望 ≥ N」送达，门槛值与 core 的
         * `WORMHOLE_SCAN_UNLOCK_STANDING` **必须同值** —— 两处不一致时，要么信送了却扫不了、
         * 要么能扫了却永远收不到信。这里与引擎常量同一出处地核一遍。
         */
        check(m.trigger.min > 0, `通讯 ${m.id} 的 standing 触发门槛必须为正：${m.trigger.min}`)
        check(
          m.trigger.factionId === DSI_FACTION_ID,
          `通讯 ${m.id} 的 standing 触发指向未知声望势力：${m.trigger.factionId}`,
        )
        if (m.trigger.factionId === DSI_FACTION_ID) {
          check(
            m.trigger.min === WORMHOLE_SCAN_UNLOCK_STANDING,
            `通讯 ${m.id} 的 standing 门槛 ${m.trigger.min} 与引擎常量 ${WORMHOLE_SCAN_UNLOCK_STANDING} 不一致`,
          )
        }
        break
      }
      case 'wormholeNebula':
        /**
         * 死触发器守卫（2026-09-13 星云机制）：这封信靠 `state.wormhole.nebulaHintShown` 送达，
         * 而那个标记只在「**玩家下到星云起始层**」时置位 ⇒ 若星云起效层被改到本工具测不到的深度、
         * 或星云被整体撤掉，这封信就永远送不出去。这里与引擎常量**同一出处**地核一遍。
         */
        check(
          WORMHOLE_NEBULA_MIN_DEPTH >= 1 && WORMHOLE_NEBULA_SHARE > 0,
          `通讯 ${m.id} 用 wormholeNebula 触发器，但星云机制没开（起效层 ${WORMHOLE_NEBULA_MIN_DEPTH} · 配额 ${WORMHOLE_NEBULA_SHARE}）`,
        )
        break
      case 'shipBuilt':
        /**
         * 死触发器守卫（2026-09-15 首艘自造船通讯）：这封信靠"组装机交出第一艘船"送达 ⇒
         * 数据里必须真存在**可造的舰船蓝图**（`SHIP_BLUEPRINTS`），否则没有船可造、信永远送不出去
         * （同 `lowSec` / `foeFamily` / `wormholeNebula` 那三条守卫的用意）。
         */
        check(
          SHIP_BLUEPRINTS.length > 0,
          `通讯 ${m.id} 用 shipBuilt 触发器，但数据里没有任何舰船蓝图（死触发器）`,
        )
        break
      default:
        break
    }
    if (m.hint) {
      hints++
      check(JUMP_PAGES.has(m.hint.page), `通讯 ${m.id} 跳转目标页非法：${m.hint.page}`)
      check(m.hint.text.trim().length > 0, `通讯 ${m.id} 跳转提示为空`)
      if (m.hint.tab !== undefined) {
        check(m.hint.page === 'map', `通讯 ${m.id} 只有星图页支持标签跳转，实际页：${m.hint.page}`)
        check(MAP_TABS.has(m.hint.tab), `通讯 ${m.id} 星图标签非法：${m.hint.tab}`)
      }
      // 任务中心内层标签（2026-09-11 船长：步骤 2 跳转要切到「重要任务」）——只有"星图 · 任务中心"才有内层标签
      if (m.hint.taskTab !== undefined) {
        check(
          /**
           * ⚠ **2026-09-14 改判**（船长：「将任务中心界面移出星图，放入左侧导航栏，通讯的上方」）：
           * 任务中心从"星图页的一个选项卡（`page: 'map'` + `tab: 'task'`）"变成**独立一级页** ⇒
           * 内层标签的合法载体改为 `page: 'task'`；老的 `map + tab: 'task'` 仍放行一档（兼容未改道的旧数据）。
           */
          m.hint.page === 'task' || (m.hint.page === 'map' && m.hint.tab === 'task'),
          `通讯 ${m.id} 只有任务中心页支持内层标签跳转（实际 page=${m.hint.page} tab=${m.hint.tab ?? '无'}）`,
        )
        check(TASK_TABS.has(m.hint.taskTab), `通讯 ${m.id} 任务中心内层标签非法：${m.hint.taskTab}`)
      }
      if (m.hint.shipTab !== undefined) {
        check(m.hint.page === 'ship', `通讯 ${m.id} 只有舰船页支持标签跳转，实际页：${m.hint.page}`)
        check(SHIP_TABS.has(m.hint.shipTab), `通讯 ${m.id} 舰船标签非法：${m.hint.shipTab}`)
      }
    }
    for (const p of [m.subject, ...m.body, ...(m.hint ? [m.hint.text] : [])]) {
      for (const w of BANNED) {
        check(!p.includes(w), `通讯 ${m.id} 的玩家可见文案含开发用词「${w}」：${p.slice(0, 24)}…`)
      }
      // 船内系统（信息库）= 玩家自己的系统，可以直说「舰载 AI」这类自我认知；NPC 文案不许（见 loreHits 注释）
      for (const w of loreHits(p, { keepSelfKnowledge: faction?.alignment === '系统' })) {
        check(false, `通讯 ${m.id} 的文案触碰世界观铁律「${w}」（章鱼人不追问船里是谁）：${p.slice(0, 24)}…`)
      }
      for (const w of LORE_SPLIT) {
        check(!p.includes(w), `通讯 ${m.id} 的文案把玩家与船分开说「${w}」（玩家就是那条船）：${p.slice(0, 24)}…`)
      }
    }
    // 强调行契约（2026-09-11 船长：训前简报的任务链要高亮）：`highlight` 的每一条都必须是 `body` 里
    // **逐字相等**的一段——否则界面上静默不高亮，改文案时很容易漏（同 `action` 透传那类"看不出来"的坑）。
    if (m.highlight !== undefined) {
      check(m.highlight.length > 0, `通讯 ${m.id} 的 highlight 是空数组（要么去掉字段，要么给出要强调的段落）`)
      for (const h of m.highlight) {
        check(h.trim().length > 0, `通讯 ${m.id} 的 highlight 含空段落`)
        check(m.body.includes(h), `通讯 ${m.id} 的 highlight 段落不在正文里（界面不会高亮）：${h.slice(0, 24)}…`)
      }
    }
  }
  /* ③ 星系机制通讯登记契约（2026-09-12 船长定：探索到带特殊机制的星系后，发一封通讯讲解对应机制）
     口径：①四封机制信**必须都在**（缺一封 = 那处机制对玩家失声）；②四者必须落在**互不相同**的触发面上
     （同一星系 / 同一敌族 / 同一阈值登记两封 ⇒ 玩家会收到两封讲同一件事的信，属"静默重复"，本契约拦下）。 */
  {
    const MECH_MAILS: ReadonlyArray<{ id: string; face: string }> = [
      { id: 'msg-auro-megastructure', face: '星系 galaxy-auro（巨构残骸带）' },
      { id: 'msg-exile-swarm', face: '敌族 G（鱿烬亡军的蜂群）' },
      { id: 'msg-lowsec-rules', face: '低安空域（安全等级 ≤ 0，含 0）' },
      { id: 'msg-redring-outpost', face: '星系 galaxy-redring（前哨站选址）' },
    ]
    /** 触发面键：同一键 = 同一触发面（星系信按星系 id · 族信按族字母 · 低安按阈值） */
    const faceOf = (t: (typeof COMMS_MESSAGES)[number]['trigger']): string => {
      switch (t.kind) {
        case 'galaxy':
          return `galaxy:${t.galaxyId}`
        case 'foeFamily':
          return `foe:${t.family}`
        case 'lowSec':
          return 'lowSec'
        default:
          return t.kind
      }
    }
    const byFace = new Map<string, string>()
    for (const mm of MECH_MAILS) {
      const msg = COMMS_MESSAGES.find((m) => m.id === mm.id)
      check(msg !== undefined, `星系机制通讯缺登记：${mm.id}（${mm.face}）`)
      if (!msg) continue
      const key = faceOf(msg.trigger)
      const prev = byFace.get(key)
      check(prev === undefined, `星系机制通讯重复登记同一触发面：${prev} 与 ${mm.id}（触发面 = ${key}）`)
      byFace.set(key, mm.id)
    }
  }
  for (const d of DIALOGUES) {
    check(d.lines.length > 0, `通讯剧本 ${d.id} 没有台词`)
    check(d.title.trim().length > 0, `通讯剧本 ${d.id} 缺标题（收件箱发件人栏）`)
    for (const w of LORE_SPLIT) {
      check(!d.title.includes(w), `通讯剧本 ${d.id} 标题把玩家与船分开说「${w}」`)
    }
    // 剧本可挂靠势力（挂靠后收件箱里与数据消息同口径）；挂了就必须真实存在
    if (d.commsFactionId !== undefined) {
      const faction = COMMS_FACTIONS.find((f) => f.id === d.commsFactionId)
      check(faction !== undefined, `通讯剧本 ${d.id} 的挂靠势力不存在：${d.commsFactionId}`)
      if (faction) {
        referenced.add(faction.id)
        if (d.commsDeptId !== undefined) {
          const dept = faction.departments.find((x) => x.id === d.commsDeptId)
          check(dept !== undefined, `通讯剧本 ${d.id} 的挂靠部门不在势力 ${faction.id} 下：${d.commsDeptId}`)
        }
      }
    } else {
      check(d.commsDeptId === undefined, `通讯剧本 ${d.id} 有挂靠部门却没有挂靠势力`)
    }
    for (const line of d.lines) {
      for (const w of loreHits(line.text)) {
        check(false, `通讯剧本 ${d.id} 的台词触碰世界观铁律「${w}」：${line.text.slice(0, 24)}…`)
      }
      for (const w of LORE_SPLIT) {
        check(!line.text.includes(w), `通讯剧本 ${d.id} 的台词把玩家与船分开说「${w}」：${line.text.slice(0, 24)}…`)
      }
    }
  }
  // 每个势力至少被引用一次（登记了却没人发消息 = 空档案，容易被遗忘）
  for (const f of COMMS_FACTIONS) {
    check(referenced.has(f.id), `势力 ${f.id}（${f.name}）已登记但没有任何消息或剧本引用它`)
  }
  console.log(
    `· 通讯消息契约：${COMMS_MESSAGES.length} 条消息（${hints} 条带跳转提示）+ ${DIALOGUES.length} 份剧本，` +
      `触发器与跳转目标全部可解析；势力档案 ${COMMS_FACTIONS.length} 个（${COMMS_FACTIONS.map((f) => `${f.name}·${f.departments.length} 部门`).join(" / ")}），` +
      `发件方引用与内容类型白名单全通过`,
  )
}

/* ── 内容工作台 schema 契约（2026-09-12 加 · 背景 = 卡关 ②）────────────────────────────
   背景（实证）：`tools/content-schema.ts` 的 modules「家族slot」枚举曾**手写 12 个值**，而引擎
   `ModuleSlot` 有 **15** 个（缺 `cpu` / `drone-relay` / `target-lock`）⇒ `content:import modules`
   对那 10 行报「非法枚举」并**整表拒绝写入**——而且只在"有人真要导 modules 表"时才暴露。
   现 schema 的成员类枚举已改为**由引擎单点派生**（`MODULE_SLOTS` / `RACK_SLOTS`），本契约再加一道网：
   **工作台枚举必须 ⊆ 引擎值域**（且非空、无重复），防日后又手写一份漂移。 */
{
  const moduleSpec = tableOf('modules')
  if (!moduleSpec) {
    check(false, '内容工作台契约：找不到 modules 表定义（content-schema.ts 被改名或删除）')
  } else {
    const engineSlots = new Set<string>(MODULE_SLOTS)
    const engineRacks = new Set<string>(RACK_SLOTS)
    const engineTypes = new Set<string>(['kinetic', 'explosive', 'plasma'])
    const pairs: Array<[string, string, ReadonlySet<string>]> = [
      ['家族slot', 'slot', engineSlots],
      ['物理槽rack', 'rack', engineRacks],
      ['弹种damageType', 'damageType', engineTypes],
    ]
    let valCount = 0
    for (const [label, p, legal] of pairs) {
      const c = moduleSpec.cols.find((x) => x.p === p)
      if (!c) {
        check(false, `内容工作台契约：modules 表缺「${label}」列（p=${p}）`)
        continue
      }
      const vals = c.vals ?? []
      check(vals.length > 0, `内容工作台契约：modules「${label}」列没有登记任何合法值`)
      check(
        new Set(vals).size === vals.length,
        `内容工作台契约：modules「${label}」列的合法值有重复`,
      )
      const illegal = vals.filter((v) => !legal.has(v))
      check(
        illegal.length === 0,
        `内容工作台契约：modules「${label}」列的合法值越出引擎值域：${illegal.join('、')}——` +
          `引擎侧合法值 ${[...legal].join('/')}（工作台枚举必须由引擎单点派生；越界会让 content:import 整表被拒）`,
      )
      valCount += vals.length
    }
    console.log(
      `· 内容工作台契约：modules 表 3 个成员类枚举共 ${valCount} 个值全部落在引擎值域内` +
        `（槽位 ${engineSlots.size} 个 · 槽类 ${engineRacks.size} 个 · 弹种 ${engineTypes.size} 个）`,
    )
  }
}

/* ── 限时倍率表契约（2026-09-15 船长新增功能：按现实日期给特定数值上倍率） ── */
{
  /**
   * **限时倍率表契约**（`packages/core/src/tuning.ts` 的 `TUNING_RULES`）。
   *
   * 四条判据：
   * ① 每条规则的 `key` 必须是白名单 `TUNABLE_KNOBS` 里的开关（写错字 = 静默不生效）；
   * ② 倍率必须 > 0 且有限（0/负数/NaN 会让"乘上去"变成清零或崩）；
   * ③ 日期必须是合法 `YYYY-MM-DD`，且 `from ≤ until`（写反 = 永不生效）；
   * ④ **每个开关都必须被引擎真正消费**（源码里至少一处 `tuningMul(state, 'key')`）——
   *    这条防的是"登记了开关却没接线"：白名单越长越容易漏接，而漏接是**静默失效**。
   *
   * ⚠ **已过期的规则允许留档**（不报错）：表就是"活动史"，删不删由船长定。
   */
  const known = new Set(Object.keys(TUNABLE_KNOBS) as string[])
  const srcText: string[] = []
  const walkSrc = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name)
      if (d.isDirectory()) walkSrc(p)
      else if (p.endsWith('.ts')) srcText.push(readFileSync(p, 'utf8'))
    }
  }
  const coreSrc = join(process.cwd(), 'packages/core/src')
  if (existsSync(coreSrc)) walkSrc(coreSrc)
  const allSrc = srcText.join('\n')
  let ruleCount = 0
  for (const r of TUNING_RULES) {
    ruleCount += 1
    const key = String(r.key)
    check(known.has(key), `限时倍率契约：规则用了未知开关「${key}」—— 白名单里没有它（写错字就静默不生效）`)
    check(Number.isFinite(r.mul) && r.mul > 0, `限时倍率契约：${key} 的倍率 ${String(r.mul)} 非法（必须 > 0 且有限）`)
    const untilMs = localDayStartMs(r.until)
    check(untilMs !== null, `限时倍率契约：${key} 的截止日期「${r.until}」不是合法的 YYYY-MM-DD`)
    const fromMs = r.from === undefined ? null : localDayStartMs(r.from)
    check(r.from === undefined || fromMs !== null, `限时倍率契约：${key} 的起始日期「${String(r.from)}」不是合法的 YYYY-MM-DD`)
    check(fromMs === null || untilMs === null || fromMs <= untilMs, `限时倍率契约：${key} 的起始日期晚于截止日期（永不生效）`)
  }
  for (const key of known) {
    check(
      allSrc.includes(`tuningMul(state, '${key}')`),
      `限时倍率契约：开关「${key}」在引擎里没有任何读取点（tuningMul(state, '${key}') 一处都没有）——` +
        `登记了却没接线 = 设了倍率也不生效`,
    )
  }
  console.log(`· 限时倍率契约：${ruleCount} 条规则 · 白名单 ${known.size} 个开关逐个核对「已被引擎消费」`)

  /**
   * **限时促销契约**（`packages/core/src/tuning.ts` 的 `PROMOS`，2026-09-16 船长「虫洞大量生成」）。
   *
   * 七条判据（每条都对应一种"静默失效"）：
   * ① `id` 非空且唯一（id 是 `state.promoClaimed` 的键 ⇒ 重复 id = 两个活动抢同一次领取记录）；
   * ② `label` / `detail` 非空（这是**玩家可见文案**，空着等于活动栏只剩一个没字的徽标）；
   * ③ 日期合法且 `from ≤ until`（写反 = 永不生效）；
   * ④ `scanMul`（若写）> 0 且有限（0/负/NaN 会把扫描窗口算成 0 或崩）；
   * ⑤ `giftWormholes`（若写）是正整数（小数/负数 = 发不出或发错数）；
   * ⑥ **至少有一项效果**（`scanMul` 或 `giftWormholes`）——都没有就是空转的活动；
   * ⑦ `claims` 里的键必须在白名单，且**认领 `wormholeScanMs` 就必须写 `scanMul`**
   *    （否则活动栏会把一条与本活动无关的倍率徽标藏起来，玩家看不到）。
   *
   * ⚠ 与限时倍率表同款：**已过期的促销允许留档**（不报错）——收口靠 `npm run tuning:expired` 手动跑。
   */
  const promoIds = new Set<string>()
  /** 促销徽标的**已知去向**（与 `PromoRule.open` 的联合类型同源；加新去向时这里与 UI 一起改） */
  const PROMO_OPEN_TARGETS: readonly string[] = ['wormhole-scan']
  for (const p of PROMOS) {
    const id = String(p.id)
    check(id.length > 0, '限时促销契约：有促销条目的 id 为空')
    check(!promoIds.has(id), `限时促销契约：促销 id「${id}」重复（id 是领取记录的键 ⇒ 会互相顶掉）`)
    promoIds.add(id)
    check(p.label.trim().length > 0, `限时促销契约：${id} 的 label 为空（活动栏徽标没有可显示的字）`)
    check(p.detail.trim().length > 0, `限时促销契约：${id} 的 detail 为空（悬停说明空着）`)
    const untilMs = localDayStartMs(p.until)
    check(untilMs !== null, `限时促销契约：${id} 的截止日期「${p.until}」不是合法的 YYYY-MM-DD`)
    const fromMs = p.from === undefined ? null : localDayStartMs(p.from)
    check(p.from === undefined || fromMs !== null, `限时促销契约：${id} 的起始日期「${String(p.from)}」不是合法的 YYYY-MM-DD`)
    check(fromMs === null || untilMs === null || fromMs <= untilMs, `限时促销契约：${id} 的起始日期晚于截止日期（永不生效）`)
    if (p.scanMul !== undefined) {
      check(Number.isFinite(p.scanMul) && p.scanMul > 0, `限时促销契约：${id} 的 scanMul ${String(p.scanMul)} 非法（必须 > 0 且有限）`)
    }
    if (p.giftWormholes !== undefined) {
      check(
        Number.isFinite(p.giftWormholes) && Number.isInteger(p.giftWormholes) && p.giftWormholes > 0,
        `限时促销契约：${id} 的 giftWormholes ${String(p.giftWormholes)} 非法（必须是正整数）`,
      )
    }
    check(
      p.scanMul !== undefined || p.giftWormholes !== undefined,
      `限时促销契约：${id} 既没有 scanMul 也没有 giftWormholes（空转的活动：徽标会显示，但什么都不发生）`,
    )
    for (const k of p.claims ?? []) {
      check(known.has(String(k)), `限时促销契约：${id} 认领了未知开关「${String(k)}」（白名单里没有它）`)
      if (k === 'wormholeScanMs') {
        check(
          p.scanMul !== undefined,
          `限时促销契约：${id} 认领了 wormholeScanMs 却没写 scanMul —— 活动栏会把那条倍率徽标藏起来，玩家看不到它`,
        )
      }
    }
    // ⑧ 点击徽标的去向必须是已知目标（写错 = 点进去找不到东西；活动栏按它决定跳哪一页）
    if (p.open !== undefined) {
      check(
        PROMO_OPEN_TARGETS.includes(String(p.open)),
        `限时促销契约：${id} 的 open「${String(p.open)}」不是已知去向（可选值：${PROMO_OPEN_TARGETS.join(' / ')}）`,
      )
    }
  }
  console.log(`· 限时促销契约：${PROMOS.length} 条促销 · id/文案/日期/两项效果/认领开关/去向逐个核对`)
}

/* ── 输出 ── */
console.log(`· 蓝图：装备 ${BLUEPRINTS.length} 张 + 舰船 ${SHIP_BLUEPRINTS.length} 张`)
if (warn.length > 0) {
  console.log('· 警告：')
  for (const w of warn) console.log(`  ⚠ ${w}`)
}
if (errors.length > 0) {
  console.error(`\n❌ 内容体检失败：${errors.length} 处错误`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('\n✅ 内容体检通过：全部交叉引用可解析，无死物品。')
