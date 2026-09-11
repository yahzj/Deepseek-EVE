/**
 * 市场商品目录（V9 + V10 大扩容：31 → 97 张）。
 *
 * 目录规则（中文说明，设计文档 V4/V5/V10 已确认）：
 * - 市场只有两栏：常驻供应（common）/ 稀有订单（rare + exotic 奇货同栏展示）；
 * - 单件商品价格锚定旧商店价：常驻品=平价；稀有/限定品按稀缺度定溢价；
 * - 收购档位（2026-09-08 船长定，防套利 = 收购恒低于供应、倒买倒卖亏税）：
 *   单件收购价 = demandMultiplier × L —— common **0.6** / rare **0.65** / exotic **1.0**；
 *   池商品收购价 = L × demandMultiplier（留空 = 原料平价 1.0L；弹药/修理组件/无人机
 *   池耗材显式 0.6，防"造弹卖站"近无本回血）；
 * - 矿石/矿物/气体/冰矿/弹药/无人机走"池模型"：basePrice = 常驻均衡价，收购平价、供应微溢 6%；
 *   池 target/flow 随价格递减（防高价商品天量刷钱）；弹药/无人机为 NPC 补给池（占位消耗品，
 *   玩家可回卖但收购仅 0.6L，倒卖无套利）；
 * - V10 声望门槛（standingReq）：部分高端商品需协会声望才可买入（卖出不限）——给声望找新用途；
 *   门槛梯度：MK3 蓝图 4、武装/重装/航运顶级船 7~9、异星原型与旗舰 10~11。
 */

import type { MarketGoodDef } from '@whale/core'
import { rarityTierOf } from './rarityTier' // 2026-09-09 数字稀有度表（物品本体属性，市场调用）
import { wreckItemIdOf } from '@whale/core'
import { ANOMALIES } from './anomalies'
import { GALAXIES } from './universe'

export const MARKET_GOODS_RAW: readonly MarketGoodDef[] = [
  // ══════════ 常驻供应（common） ══════════

  // ── 矿石（池模型：玩家售矿主渠道；收购平价，池淤积压价） ──
  // 2026-09-05 船长：低级矿石/矿物是海量消耗品，池量与流量按"越低级越大"放大（稀有矿保持小）
  // 【2026-09-10 船长定：**按玩家生产能力标定**（原值按感觉定，17 个矿带里 15 个覆盖比 <1 = 采了卖不掉）。
  //   基准 = 掘洞级 + 满采矿技能 + 2×强化采集器 MK1（引擎实测 15.4k~20.0k 件/h ⇒ 日产 37~48 万件）；
  //   规则 = **按单价分层覆盖比**：≤20 ISK → ×15（大宗）／≤200 → ×6（中阶）／≤400 → ×3（高阶）／>400 → ×2（顶级）；
  //   `supplyFlow`（每 60 秒窗吸收/补单量）按 `目标日吸收 ÷ 1440` 定、`poolTarget = supplyFlow × 120`。
  //   效果：梯度保留（建议 flow 513~4,991/窗 = **9.7× 差距**，原 6~5,000 = 833×），最低档仍是基准产能的 2 倍 ⇒ 挖高阶矿也卖得掉；
  //   低阶几乎不动（富凡 ×1.0、灼烧 ×2.5）。价格、产率、弹药/修理件/无人机池**一律未动**。】
  // 【2026-09-11 船长定：**消耗品池按同一把尺重标**（弹药/修理组件玩家可自造 → 基准 = **单工位无技能日产**；
  //   无人机**无蓝图**（纯市场货源）→ 基准按 144 场/天战损折算）。
  //   实测改前产能覆盖比：动能弹 0.21× / 动能弹 MK2 0.03× / 民用修理组件 0.40× / 军用修理组件 0.33×
  //   ——"一个工位造出来的量，市场一天都吃不下"，故按 ≤20 → ×15、≤200 → ×6、>400 → ×2 重标：
  //   弹药 MK1 150 → **10,800/窗**（池 4,000 → **1,296,000**）、弹药 MK2 20 → **4,320**（池 → **518,400**）、
  //   民用修理组件 4 → **20**（池 300 → **2,400**）、军用修理组件 1.5 → **9**（池 120 → **1,080**）、
  //   无人机池同步为 flow×120（4/2/1/1 → 池 480/240/120/120）。价格、产率、其它池一律未动。】
  { key: 'ore-veldspar', kind: 'item', refId: 'ore-veldspar', rarity: 'common', basePrice: 12, poolTarget: 598_920, supplyFlow: 4_991 },
  { key: 'ore-scorched', kind: 'item', refId: 'ore-scorched', rarity: 'common', basePrice: 18, poolTarget: 598_920, supplyFlow: 4_991 },
  { key: 'ore-hemorphite', kind: 'item', refId: 'ore-hemorphite', rarity: 'common', basePrice: 55, poolTarget: 239_640, supplyFlow: 1_997 },
  { key: 'ore-glowstone', kind: 'item', refId: 'ore-glowstone', rarity: 'common', basePrice: 150, poolTarget: 184_680, supplyFlow: 1_539 },
  { key: 'ore-sunshard', kind: 'item', refId: 'ore-sunshard', rarity: 'common', basePrice: 115, poolTarget: 184_680, supplyFlow: 1_539 },
  { key: 'ore-voidshard', kind: 'item', refId: 'ore-voidshard', rarity: 'common', basePrice: 340, poolTarget: 92_400, supplyFlow: 770 },
  { key: 'ore-nebulite', kind: 'item', refId: 'ore-nebulite', rarity: 'common', basePrice: 490, poolTarget: 61_560, supplyFlow: 513 },
  // ── 矿物（池模型：制造原料主渠道；供应微溢 6%） ──
  // 【2026-09-10 同批按"单炉满技能精炼产能"标定（矿 → 矿物取该矿物产率最高的那支矿）：
  //   三钛 90,734 件/h、类银 63,385、类晶体 22,523、同位聚晶 78,408、超噬 29,233、星髓 29,730、冥铁 7,722
  //   ——冥铁/星髓/超噬/同位聚晶原覆盖比 0.16~0.82×（炼出来卖不掉），三钛/类银/类晶体本就 ≥5.7× 故仅微调；
  //   虚空晶无精炼来源（回收彩头），池不动。】
  { key: 'min-tritanium', kind: 'item', refId: 'min-tritanium', rarity: 'common', basePrice: 8, poolTarget: 2_722_080, supplyFlow: 22_684 },
  { key: 'min-pyerite', kind: 'item', refId: 'min-pyerite', rarity: 'common', basePrice: 12, poolTarget: 1_901_640, supplyFlow: 15_847 },
  { key: 'min-mexallon', kind: 'item', refId: 'min-mexallon', rarity: 'common', basePrice: 20, poolTarget: 675_720, supplyFlow: 5_631 },
  { key: 'min-nocxium', kind: 'item', refId: 'min-nocxium', rarity: 'common', basePrice: 90, poolTarget: 350_880, supplyFlow: 2_924 },
  { key: 'min-isotope', kind: 'item', refId: 'min-isotope', rarity: 'common', basePrice: 55, poolTarget: 940_920, supplyFlow: 7_841 },
  { key: 'min-starcore', kind: 'item', refId: 'min-starcore', rarity: 'common', basePrice: 245, poolTarget: 178_440, supplyFlow: 1_487 },
  { key: 'min-darkiron', kind: 'item', refId: 'min-darkiron', rarity: 'common', basePrice: 780, poolTarget: 30_960, supplyFlow: 258 },
  { key: 'min-voidcrystal', kind: 'item', refId: 'min-voidcrystal', rarity: 'common', basePrice: 1_800, poolTarget: 500, supplyFlow: 3 },
  // ── 气体（V10 池商品） ──
  { key: 'gas-neon', kind: 'item', refId: 'gas-neon', rarity: 'common', basePrice: 85, poolTarget: 227_880, supplyFlow: 1_899 },
  { key: 'gas-phosphor', kind: 'item', refId: 'gas-phosphor', rarity: 'common', basePrice: 330, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'gas-ionstorm', kind: 'item', refId: 'gas-ionstorm', rarity: 'common', basePrice: 230, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'gas-aurora', kind: 'item', refId: 'gas-aurora', rarity: 'common', basePrice: 330, poolTarget: 114_000, supplyFlow: 950 },
  // ── 冰矿（V10 池商品） ──
  { key: 'ice-frost', kind: 'item', refId: 'ice-frost', rarity: 'common', basePrice: 150, poolTarget: 227_880, supplyFlow: 1_899 },
  { key: 'ice-marrow', kind: 'item', refId: 'ice-marrow', rarity: 'common', basePrice: 230, poolTarget: 114_000, supplyFlow: 950 },
  { key: 'ice-darkstar', kind: 'item', refId: 'ice-darkstar', rarity: 'common', basePrice: 360, poolTarget: 114_000, supplyFlow: 950 },
  // ── 弹药（V10 占位消耗品：NPC 补给池，玩家可囤可回卖） ──
  { key: 'ammo-kinetic-l', kind: 'item', refId: 'ammo-kinetic-l', rarity: 'common', basePrice: 7, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 }, // 2026-09-11 消耗品池按产能标定（原 4,000/150）
  { key: 'ammo-explosive-l', kind: 'item', refId: 'ammo-explosive-l', rarity: 'common', basePrice: 8, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 },
  { key: 'ammo-plasma-l', kind: 'item', refId: 'ammo-plasma-l', rarity: 'common', basePrice: 9, demandMultiplier: 0.6, poolTarget: 1_296_000, supplyFlow: 10_800 },
  // ── 弹药 MK2（2026-09-09 船长拍板：攻坚/提速消耗品；补给池高价低耗节流，参数可调） ──
  { key: 'ammo-kinetic-2', kind: 'item', refId: 'ammo-kinetic-2', rarity: 'common', basePrice: 45, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 }, // 2026-09-11 消耗品池按产能标定（原 1,200/20）
  { key: 'ammo-explosive-2', kind: 'item', refId: 'ammo-explosive-2', rarity: 'common', basePrice: 60, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 },
  { key: 'ammo-plasma-2', kind: 'item', refId: 'ammo-plasma-2', rarity: 'common', basePrice: 80, demandMultiplier: 0.6, poolTarget: 518_400, supplyFlow: 4_320 },
  // ── 修理组件（2026-09-05：承伤持久化配套消耗品；民用/军用两档 NPC 常驻补给池） ──
  { key: 'repairkit-civ', kind: 'item', refId: 'repairkit-civ', rarity: 'common', basePrice: 3_300, demandMultiplier: 0.6, poolTarget: 2_400, supplyFlow: 20 }, // 2026-09-11 消耗品池按产能标定（原 300/4）
  { key: 'repairkit-mil', kind: 'item', refId: 'repairkit-mil', rarity: 'common', basePrice: 23_100, demandMultiplier: 0.6, poolTarget: 1_080, supplyFlow: 9 }, // 2026-09-11（原 120/1.5；船长定：与其它消耗品同口径，激战单场可吃 23 枚 ⇒ 池约撑 45 场）
  // ── 无人机（V10 占位：NPC 补给池） ──
  { key: 'drone-scout', kind: 'item', refId: 'drone-scout', rarity: 'common', basePrice: 900, demandMultiplier: 0.6, poolTarget: 480, supplyFlow: 4 }, // 2026-09-11 池 = flow×120（原 200）
  { key: 'drone-assault', kind: 'item', refId: 'drone-assault', rarity: 'common', basePrice: 2_200, demandMultiplier: 0.6, poolTarget: 240, supplyFlow: 2 },
  { key: 'drone-heavy', kind: 'item', refId: 'drone-heavy', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 1 },
  { key: 'drone-sentry', kind: 'item', refId: 'drone-sentry', rarity: 'common', basePrice: 9_500, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 1 },

  // ── 单件平价品 ──
  // 民用/入门装备（市场供应价 = 制造价的合理回本价；玩家自己造更便宜）
  { key: 'mod-miner-civ', kind: 'module', refId: 'mod-miner-civ', rarity: 'common', basePrice: 9_000, demandMultiplier: 0.6 },
  { key: 'mod-cargo-civ', kind: 'module', refId: 'mod-cargo-civ', rarity: 'common', basePrice: 8_000, demandMultiplier: 0.6 },
  { key: 'mod-turret-civ', kind: 'module', refId: 'mod-turret-civ', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-miner-1', kind: 'module', refId: 'mod-miner-1', rarity: 'common', basePrice: 31_200, demandMultiplier: 0.6 },
  { key: 'mod-cargo-1', kind: 'module', refId: 'mod-cargo-1', rarity: 'common', basePrice: 29_200, demandMultiplier: 0.6 },
  { key: 'mod-turret-kin-1', kind: 'module', refId: 'mod-turret-kin-1', rarity: 'common', basePrice: 53_000, demandMultiplier: 0.6 },
  // 巨构近防炮（2026-09-11 机群批 S4）：**唯一能打敌方机群**的武器类型（防空属性），点上架
  { key: 'mod-pd-e', kind: 'module', refId: 'mod-pd-e', rarity: 'rare', basePrice: 118_000, demandMultiplier: 0.7 },
  { key: 'bp-pd-e', kind: 'blueprint', refId: 'bp-pd-e', rarity: 'rare', basePrice: 120_000, demandMultiplier: 0.7 },
  { key: 'mod-pd-e-2', kind: 'module', refId: 'mod-pd-e-2', rarity: 'rare', basePrice: 315_000, demandMultiplier: 0.7 },
  { key: 'bp-pd-e-2', kind: 'blueprint', refId: 'bp-pd-e-2', rarity: 'rare', basePrice: 315_000, demandMultiplier: 0.7 },
  { key: 'mod-pd-e-3', kind: 'module', refId: 'mod-pd-e-3', rarity: 'exotic', basePrice: 690_000, demandMultiplier: 0.75 },
  { key: 'bp-pd-e-3', kind: 'blueprint', refId: 'bp-pd-e-3', rarity: 'exotic', basePrice: 690_000, demandMultiplier: 0.75 },
  { key: 'mod-missile-1', kind: 'module', refId: 'mod-missile-1', rarity: 'common', basePrice: 62_000, demandMultiplier: 0.6 },
  { key: 'mod-laser-1', kind: 'module', refId: 'mod-laser-1', rarity: 'common', basePrice: 66_000, demandMultiplier: 0.6 },
  // 战斗家族 MK1（V17 起真生效：护盾/装甲为分系专精三款、矢量推进器；低价鼓励勤换装）
  { key: 'mod-shield-kin-1', kind: 'module', refId: 'mod-shield-kin-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-shield-exp-1', kind: 'module', refId: 'mod-shield-exp-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-shield-pla-1', kind: 'module', refId: 'mod-shield-pla-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-armor-kin-1', kind: 'module', refId: 'mod-armor-kin-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-armor-exp-1', kind: 'module', refId: 'mod-armor-exp-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-armor-pla-1', kind: 'module', refId: 'mod-armor-pla-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-shield-ext-1', kind: 'module', refId: 'mod-shield-ext-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'mod-armor-plate-1', kind: 'module', refId: 'mod-armor-plate-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.6 },
  { key: 'mod-prop-1', kind: 'module', refId: 'mod-prop-1', rarity: 'common', basePrice: 6_000, demandMultiplier: 0.6 },
  // V18 无人机装置（高槽；现货 + 蓝图双渠道——2026-09-09 全蓝图化后有书可学）
  { key: 'mod-drone-rack-1', kind: 'module', refId: 'mod-drone-rack-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-drone-tac-1', kind: 'module', refId: 'mod-drone-tac-1', rarity: 'common', basePrice: 18_000, demandMultiplier: 0.6 },
  { key: 'mod-drone-relay-1', kind: 'module', refId: 'mod-drone-relay-1', rarity: 'common', basePrice: 15_000, demandMultiplier: 0.6 }, // 无人机中继天线 MK1（2026-09-10 现货）
  // 低级蓝图（价格 = 蓝图商店价；买来学习后永久可造，重复蓝图回卖按 common 档 0.6L 收购）
  { key: 'bp-miner-1', kind: 'blueprint', refId: 'bp-miner-1', rarity: 'common', basePrice: 62400, demandMultiplier: 0.6 },
  { key: 'bp-cargo-1', kind: 'blueprint', refId: 'bp-cargo-1', rarity: 'common', basePrice: 58400, demandMultiplier: 0.6 },
  { key: 'bp-turret-1', kind: 'blueprint', refId: 'bp-turret-1', rarity: 'common', basePrice: 106000, demandMultiplier: 0.6 },
  { key: 'bp-miner-civ', kind: 'blueprint', refId: 'bp-miner-civ', rarity: 'common', basePrice: 18000, demandMultiplier: 0.6 },
  { key: 'bp-cargo-civ', kind: 'blueprint', refId: 'bp-cargo-civ', rarity: 'common', basePrice: 16000, demandMultiplier: 0.6 },
  { key: 'bp-turret-civ', kind: 'blueprint', refId: 'bp-turret-civ', rarity: 'common', basePrice: 24000, demandMultiplier: 0.6 },
  // 弹药生产线蓝图（2026-09-05：基础弹自制；书籍价随弹型市场价；2026-09-09 全蓝图化补给线现价 ×1.5）
  { key: 'bp-ammo-kinetic', kind: 'blueprint', refId: 'bp-ammo-kinetic', rarity: 'common', basePrice: 1350, demandMultiplier: 0.6 },
  { key: 'bp-ammo-explosive', kind: 'blueprint', refId: 'bp-ammo-explosive', rarity: 'common', basePrice: 1650, demandMultiplier: 0.6 },
  { key: 'bp-ammo-plasma', kind: 'blueprint', refId: 'bp-ammo-plasma', rarity: 'common', basePrice: 1950, demandMultiplier: 0.6 },
  // 弹药 MK2 生产线蓝图（2026-09-09：奇货书——船长追加拍板 rare→exotic；书价 ×1.5 与全蓝图化补给线同批；
  // 收购档随奇货惯例 1.0L 全价回收，与全部 exotic 蓝图书行一致）
  { key: 'bp-ammo-kinetic-2', kind: 'blueprint', refId: 'bp-ammo-kinetic-2', rarity: 'exotic', basePrice: 9_000, demandMultiplier: 1.0 },
  { key: 'bp-ammo-explosive-2', kind: 'blueprint', refId: 'bp-ammo-explosive-2', rarity: 'exotic', basePrice: 12_750, demandMultiplier: 1.0 },
  { key: 'bp-ammo-plasma-2', kind: 'blueprint', refId: 'bp-ammo-plasma-2', rarity: 'exotic', basePrice: 18_000, demandMultiplier: 1.0 },
  // 修理组件蓝图（2026-09-05：书籍价随组件市场价同构）
  { key: 'bp-repairkit-civ', kind: 'blueprint', refId: 'bp-repairkit-civ', rarity: 'common', basePrice: 5400, demandMultiplier: 0.6 },
  { key: 'bp-repairkit-mil', kind: 'blueprint', refId: 'bp-repairkit-mil', rarity: 'common', basePrice: 13500, demandMultiplier: 0.6 },
  // 2026-09-09 全蓝图化：全部装备可学蓝图自造（双渠道，现货保留）；蓝图价 = 产物市场价 × 档位系数（民用级/MK1 ×2、MK2 ×2.5、MK3/顶档 ×3）；蓝图书出现概率 −50%
  { key: 'bp-laser-1', kind: 'blueprint', refId: 'bp-laser-1', rarity: 'common', basePrice: 132000, demandMultiplier: 0.6 }, // 轻型激光炮 MK1（蓝图=产物×2）
  { key: 'bp-missile-1', kind: 'blueprint', refId: 'bp-missile-1', rarity: 'common', basePrice: 124000, demandMultiplier: 0.6 }, // 轻型导弹架 MK1（蓝图=产物×2）
  { key: 'bp-drone-rack-1', kind: 'blueprint', refId: 'bp-drone-rack-1', rarity: 'common', basePrice: 24000, demandMultiplier: 0.6 }, // 无人机甲板扩展 MK1（蓝图=产物×2）
  { key: 'bp-drone-tac-1', kind: 'blueprint', refId: 'bp-drone-tac-1', rarity: 'common', basePrice: 36000, demandMultiplier: 0.6 }, // 战术导控阵列 MK1（蓝图=产物×2）
  { key: 'bp-shield-kin-1', kind: 'blueprint', refId: 'bp-shield-kin-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·动能型（蓝图=产物×2）
  { key: 'bp-shield-exp-1', kind: 'blueprint', refId: 'bp-shield-exp-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·高爆型（蓝图=产物×2）
  { key: 'bp-shield-pla-1', kind: 'blueprint', refId: 'bp-shield-pla-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾增强器 MK1·能量型（蓝图=产物×2）
  { key: 'bp-shield-ext-1', kind: 'blueprint', refId: 'bp-shield-ext-1', rarity: 'common', basePrice: 10000, demandMultiplier: 0.6 }, // 护盾扩展器 MK1（蓝图=产物×2）
  { key: 'bp-armor-kin-1', kind: 'blueprint', refId: 'bp-armor-kin-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·动能型（蓝图=产物×2）
  { key: 'bp-armor-exp-1', kind: 'blueprint', refId: 'bp-armor-exp-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·高爆型（蓝图=产物×2）
  { key: 'bp-armor-pla-1', kind: 'blueprint', refId: 'bp-armor-pla-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲镀层 MK1·能量型（蓝图=产物×2）
  { key: 'bp-armor-plate-1', kind: 'blueprint', refId: 'bp-armor-plate-1', rarity: 'common', basePrice: 11000, demandMultiplier: 0.6 }, // 装甲增厚板 MK1（蓝图=产物×2）
  { key: 'bp-prop-1', kind: 'blueprint', refId: 'bp-prop-1', rarity: 'common', basePrice: 12000, demandMultiplier: 0.6 }, // 矢量推进器 MK1（蓝图=产物×2）
  { key: 'bp-stab-kin-1', kind: 'blueprint', refId: 'bp-stab-kin-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 动能稳定器 MK1（蓝图=产物×2）
  { key: 'bp-stab-exp-1', kind: 'blueprint', refId: 'bp-stab-exp-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 高爆稳定器 MK1（蓝图=产物×2）
  { key: 'bp-stab-pla-1', kind: 'blueprint', refId: 'bp-stab-pla-1', rarity: 'common', basePrice: 68000, demandMultiplier: 0.6 }, // 等离子稳定器 MK1（蓝图=产物×2）
  { key: 'bp-rof-1', kind: 'blueprint', refId: 'bp-rof-1', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 射速计算机 MK1（蓝图=产物×2）
  { key: 'bp-track-1', kind: 'blueprint', refId: 'bp-track-1', rarity: 'common', basePrice: 52000, demandMultiplier: 0.6 }, // 索敌阵列 MK1（蓝图=产物×2）
  { key: 'bp-gyro-1', kind: 'blueprint', refId: 'bp-gyro-1', rarity: 'common', basePrice: 48000, demandMultiplier: 0.6 }, // 姿态陀螺 MK1（蓝图=产物×2）
  { key: 'bp-salvager-1', kind: 'blueprint', refId: 'bp-salvager-1', rarity: 'common', basePrice: 40000, demandMultiplier: 0.6 }, // 打捞器 MK1（蓝图=产物×2）
  { key: 'bp-hullrep-civ', kind: 'blueprint', refId: 'bp-hullrep-civ', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 民用船体维修装置（蓝图=产物×2）
  { key: 'bp-hullrep-1', kind: 'blueprint', refId: 'bp-hullrep-1', rarity: 'common', basePrice: 370000, demandMultiplier: 0.6 }, // 船体维修装置 MK1（蓝图=产物×2）
  { key: 'bp-lock-1', kind: 'blueprint', refId: 'bp-lock-1', rarity: 'common', basePrice: 60000, demandMultiplier: 0.6 }, // 目标锁定阵列 MK1（蓝图=产物×2）
  // 低级船（AI 副船军团的主力船）
  { key: 'ship-burrower', kind: 'ship', refId: 'burrower', rarity: 'common', basePrice: 120_000, demandMultiplier: 0.6 },
  // 基础 AI 核心（原直购并入市场，平价常驻；可回卖：收购档 common 0.6×L）
  { key: 'core-basic', kind: 'aicore', refId: 'basic', rarity: 'common', basePrice: 25_000, demandMultiplier: 0.6 },

  // ══════════ 稀有订单（rare：低频刷新、寿命 9 分钟） ══════════

  // MK2 装备（制造党自用为主；偶有现货——现货价 = 自制成本 ×1.4 稀有溢价）
  // 【2026-09-10 船长定：MK2/MK3 **装备**价一律**对齐同级武器价**（线性映射进攻器带；三武为锚点）。
  //   第 2 档：原 2.8~21 万 → 38.5~48.1 万（×3.70）；第 3 档：原 17~112.2 万 → 192~240 万（×3.69）。
  //   武器价、第 1 档与民用价、奇货价、蓝图价与舰船价**一律未动**；属性/数值零改动。
  //   同批 12 件 MK3 装备的稀有感档位由 T2 升 T3（见 rarityTier.ts），并 `rareTier3Weight` 0.25 → 0.15。】
  { key: 'mod-miner-2', kind: 'module', refId: 'mod-miner-2', rarity: 'rare', basePrice: 466_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-2', kind: 'module', refId: 'mod-cargo-2', rarity: 'rare', basePrice: 475_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-2', kind: 'module', refId: 'mod-turret-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-2', kind: 'module', refId: 'mod-missile-2', rarity: 'rare', basePrice: 451_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-2', kind: 'module', refId: 'mod-laser-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  // MK3 攻坚装备（V10 起蓝图可造 + 稀有现货高价应急；自制成本 ×1.7）
  { key: 'mod-miner-3', kind: 'module', refId: 'mod-miner-3', rarity: 'rare', basePrice: 2_330_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-3', kind: 'module', refId: 'mod-cargo-3', rarity: 'rare', basePrice: 2_400_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-3', kind: 'module', refId: 'mod-turret-kin-3', rarity: 'rare', basePrice: 1_916_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-3', kind: 'module', refId: 'mod-missile-3', rarity: 'rare', basePrice: 2_242_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-3', kind: 'module', refId: 'mod-laser-3', rarity: 'rare', basePrice: 2_395_000, demandMultiplier: 0.65 },
  // 战斗家族 MK2/MK3（V17：分系专精 ×3 款；MK3 市场专供——V18 复查：稀有溢价 ×1.4/×1.7）
  // 2026-09-10 船长定：**MK2/MK3 装备价对齐同级武器价**（规则 = 线性映射进攻器带：
  // 第 2 档全部落进 38.5~48.1 万、第 3 档全部落进 192~240 万；锚点 = 三武价，各级中位 45.1 万 / 224.2 万）
  { key: 'mod-shield-kin-2', kind: 'module', refId: 'mod-shield-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-2', kind: 'module', refId: 'mod-shield-exp-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-2', kind: 'module', refId: 'mod-shield-pla-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-2', kind: 'module', refId: 'mod-armor-kin-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-2', kind: 'module', refId: 'mod-armor-exp-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-2', kind: 'module', refId: 'mod-armor-pla-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-2', kind: 'module', refId: 'mod-prop-2', rarity: 'rare', basePrice: 391_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-2', kind: 'module', refId: 'mod-drone-rack-2', rarity: 'rare', basePrice: 418_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-2', kind: 'module', refId: 'mod-drone-tac-2', rarity: 'rare', basePrice: 455_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-relay-2', kind: 'module', refId: 'mod-drone-relay-2', rarity: 'rare', basePrice: 449_000, demandMultiplier: 0.65 }, // 无人机中继天线 MK2（2026-09-10 现货）
  { key: 'mod-shield-kin-3', kind: 'module', refId: 'mod-shield-kin-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-3', kind: 'module', refId: 'mod-shield-exp-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-3', kind: 'module', refId: 'mod-shield-pla-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-3', kind: 'module', refId: 'mod-armor-kin-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-3', kind: 'module', refId: 'mod-armor-exp-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-3', kind: 'module', refId: 'mod-armor-pla-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-2', kind: 'module', refId: 'mod-shield-ext-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-plate-2', kind: 'module', refId: 'mod-armor-plate-2', rarity: 'rare', basePrice: 388_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-3', kind: 'module', refId: 'mod-shield-ext-3', rarity: 'rare', basePrice: 1_920_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-plate-3', kind: 'module', refId: 'mod-armor-plate-3', rarity: 'rare', basePrice: 1_940_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-3', kind: 'module', refId: 'mod-prop-3', rarity: 'rare', basePrice: 1_970_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-3', kind: 'module', refId: 'mod-drone-rack-3', rarity: 'rare', basePrice: 1_960_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-3', kind: 'module', refId: 'mod-drone-tac-3', rarity: 'rare', basePrice: 2_040_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-relay-3', kind: 'module', refId: 'mod-drone-relay-3', rarity: 'rare', basePrice: 2_030_000, demandMultiplier: 0.65 }, // 无人机中继天线 MK3（2026-09-10 现货）
  // V18.1 支援件（伤害稳定器/射速计算机 = 低槽；索敌阵列/姿态陀螺 = 中槽；MK1 常驻、MK2/3 稀有）
  { key: 'mod-stab-kin-1', kind: 'module', refId: 'mod-stab-kin-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-exp-1', kind: 'module', refId: 'mod-stab-exp-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-pla-1', kind: 'module', refId: 'mod-stab-pla-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-rof-1', kind: 'module', refId: 'mod-rof-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-track-1', kind: 'module', refId: 'mod-track-1', rarity: 'common', basePrice: 26_000, demandMultiplier: 0.6 },
  { key: 'mod-gyro-1', kind: 'module', refId: 'mod-gyro-1', rarity: 'common', basePrice: 24_000, demandMultiplier: 0.6 },
  // 船体维修装置（2026-09-09：中槽自动修复件——消耗型；民用级常驻、MK1/MK2 稀有现货；
  // 2026-09-09 船长定：价格档位对位升一级 = 民用级对标支援件 MK1 档、MK1 对标 MK2 档、MK2 对标 MK3 档）
  { key: 'mod-hullrep-civ', kind: 'module', refId: 'mod-hullrep-civ', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-kin-2', kind: 'module', refId: 'mod-stab-kin-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-2', kind: 'module', refId: 'mod-stab-exp-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-2', kind: 'module', refId: 'mod-stab-pla-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-2', kind: 'module', refId: 'mod-rof-2', rarity: 'rare', basePrice: 468_000, demandMultiplier: 0.65 },
  { key: 'mod-track-2', kind: 'module', refId: 'mod-track-2', rarity: 'rare', basePrice: 455_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-2', kind: 'module', refId: 'mod-gyro-2', rarity: 'rare', basePrice: 449_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-kin-3', kind: 'module', refId: 'mod-stab-kin-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-3', kind: 'module', refId: 'mod-stab-exp-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-3', kind: 'module', refId: 'mod-stab-pla-3', rarity: 'rare', basePrice: 2_360_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-3', kind: 'module', refId: 'mod-rof-3', rarity: 'rare', basePrice: 2_290_000, demandMultiplier: 0.65 },
  { key: 'mod-track-3', kind: 'module', refId: 'mod-track-3', rarity: 'rare', basePrice: 2_230_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-3', kind: 'module', refId: 'mod-gyro-3', rarity: 'rare', basePrice: 2_210_000, demandMultiplier: 0.65 },
  // 船体维修装置 MK1/MK2（消耗型修复件：2026-09-09 船长定档位价对位——MK1 对标支援件 MK2 档、MK2 对标支援件 MK3 档；
  // 2026-09-10 起改按「同级武器价对齐」→ MK1 落第 2 档带 46.8 万、MK2 落第 3 档带 229 万）
  { key: 'mod-hullrep-1', kind: 'module', refId: 'mod-hullrep-1', rarity: 'rare', basePrice: 468_000, demandMultiplier: 0.65 },
  { key: 'mod-hullrep-2', kind: 'module', refId: 'mod-hullrep-2', rarity: 'rare', basePrice: 2_290_000, demandMultiplier: 0.65 },
  // 目标锁定阵列（2026-09-09 高槽 target-lock：集火 + 被锁目标受击加深；MK1 常驻、MK2/3 稀有——价档对齐索敌阵列同梯队）
  { key: 'mod-lock-1', kind: 'module', refId: 'mod-lock-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-lock-2', kind: 'module', refId: 'mod-lock-2', rarity: 'rare', basePrice: 465_000, demandMultiplier: 0.65 },
  { key: 'mod-lock-3', kind: 'module', refId: 'mod-lock-3', rarity: 'rare', basePrice: 2_270_000, demandMultiplier: 0.65 },
  /* ═══ B3 打捞器（2026-09-05；高槽无伤害件：升级只减周期；初价按低耗件梯队，可调） ═══ */
  { key: 'mod-salvager-1', kind: 'module', refId: 'mod-salvager-1', rarity: 'common', basePrice: 20_000, demandMultiplier: 0.6 },
  { key: 'mod-salvager-2', kind: 'module', refId: 'mod-salvager-2', rarity: 'rare', basePrice: 439_000, demandMultiplier: 0.65 },
  { key: 'mod-salvager-3', kind: 'module', refId: 'mod-salvager-3', rarity: 'rare', basePrice: 2_220_000, demandMultiplier: 0.65 },
  // 高级蓝图 MK2（旧）+ MK3（V10：学习需声望 4）
  { key: 'bp-miner-2', kind: 'blueprint', refId: 'bp-miner-2', rarity: 'rare', basePrice: 452500, demandMultiplier: 0.65 },
  { key: 'bp-cargo-2', kind: 'blueprint', refId: 'bp-cargo-2', rarity: 'rare', basePrice: 497500, demandMultiplier: 0.65 },
  { key: 'bp-turret-2', kind: 'blueprint', refId: 'bp-turret-2', rarity: 'rare', basePrice: 962500, demandMultiplier: 0.65 },
  { key: 'bp-miner-3', kind: 'blueprint', refId: 'bp-miner-3', rarity: 'rare', basePrice: 2973000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-cargo-3', kind: 'blueprint', refId: 'bp-cargo-3', rarity: 'rare', basePrice: 3366000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-turret-3', kind: 'blueprint', refId: 'bp-turret-3', rarity: 'rare', basePrice: 5748000, demandMultiplier: 0.65, standingReq: 4 },
  // 2026-09-09 全蓝图化（MK2 蓝图稀有；MK3 蓝图稀有+声望 4，战斗系 MK3 与维修装置 MK2 进声望 11 暗市闸）
  { key: 'bp-laser-2', kind: 'blueprint', refId: 'bp-laser-2', rarity: 'rare', basePrice: 1202500, demandMultiplier: 0.65 }, // 重型激光炮 MK2（蓝图=产物×2.5）
  { key: 'bp-laser-3', kind: 'blueprint', refId: 'bp-laser-3', rarity: 'rare', basePrice: 7185000, demandMultiplier: 0.65, standingReq: 4 }, // 攻坚激光炮 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-missile-2', kind: 'blueprint', refId: 'bp-missile-2', rarity: 'rare', basePrice: 1127500, demandMultiplier: 0.65 }, // 重型导弹架 MK2（蓝图=产物×2.5）
  { key: 'bp-missile-3', kind: 'blueprint', refId: 'bp-missile-3', rarity: 'rare', basePrice: 6726000, demandMultiplier: 0.65, standingReq: 4 }, // 巡航导弹架 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-rack-2', kind: 'blueprint', refId: 'bp-drone-rack-2', rarity: 'rare', basePrice: 225000, demandMultiplier: 0.65 }, // 无人机甲板扩展 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-rack-3', kind: 'blueprint', refId: 'bp-drone-rack-3', rarity: 'rare', basePrice: 780000, demandMultiplier: 0.65, standingReq: 4 }, // 无人机甲板扩展 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-tac-2', kind: 'blueprint', refId: 'bp-drone-tac-2', rarity: 'rare', basePrice: 400000, demandMultiplier: 0.65 }, // 战术导控阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-tac-3', kind: 'blueprint', refId: 'bp-drone-tac-3', rarity: 'rare', basePrice: 1260000, demandMultiplier: 0.65, standingReq: 4 }, // 战术导控阵列 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-drone-relay-1', kind: 'blueprint', refId: 'bp-drone-relay-1', rarity: 'common', basePrice: 30000, demandMultiplier: 0.6 }, // 无人机中继天线 MK1（蓝图=产物×2）
  { key: 'bp-drone-relay-2', kind: 'blueprint', refId: 'bp-drone-relay-2', rarity: 'rare', basePrice: 375000, demandMultiplier: 0.65 }, // 无人机中继天线 MK2（蓝图=产物×2.5）
  { key: 'bp-drone-relay-3', kind: 'blueprint', refId: 'bp-drone-relay-3', rarity: 'rare', basePrice: 1200000, demandMultiplier: 0.65, standingReq: 4 }, // 无人机中继天线 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-shield-kin-2', kind: 'blueprint', refId: 'bp-shield-kin-2', rarity: 'rare', basePrice: 70000, demandMultiplier: 0.65 }, // 护盾增强器 MK2·动能型（蓝图=产物×2.5）
  { key: 'bp-shield-exp-2', kind: 'blueprint', refId: 'bp-shield-exp-2', rarity: 'rare', basePrice: 70000, demandMultiplier: 0.65 }, // 护盾增强器 MK2·高爆型（蓝图=产物×2.5）
  { key: 'bp-shield-pla-2', kind: 'blueprint', refId: 'bp-shield-pla-2', rarity: 'rare', basePrice: 70000, demandMultiplier: 0.65 }, // 护盾增强器 MK2·能量型（蓝图=产物×2.5）
  { key: 'bp-shield-kin-3', kind: 'blueprint', refId: 'bp-shield-kin-3', rarity: 'rare', basePrice: 510000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·动能型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-exp-3', kind: 'blueprint', refId: 'bp-shield-exp-3', rarity: 'rare', basePrice: 510000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·高爆型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-pla-3', kind: 'blueprint', refId: 'bp-shield-pla-3', rarity: 'rare', basePrice: 510000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾增强器 MK3·能量型（蓝图=产物×3）（入闸）
  { key: 'bp-shield-ext-2', kind: 'blueprint', refId: 'bp-shield-ext-2', rarity: 'rare', basePrice: 70000, demandMultiplier: 0.65 }, // 护盾扩展器 MK2（蓝图=产物×2.5）
  { key: 'bp-shield-ext-3', kind: 'blueprint', refId: 'bp-shield-ext-3', rarity: 'rare', basePrice: 510000, demandMultiplier: 0.65, standingReq: 4 }, // 护盾扩展器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-armor-kin-2', kind: 'blueprint', refId: 'bp-armor-kin-2', rarity: 'rare', basePrice: 85000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·动能型（蓝图=产物×2.5）
  { key: 'bp-armor-exp-2', kind: 'blueprint', refId: 'bp-armor-exp-2', rarity: 'rare', basePrice: 85000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·高爆型（蓝图=产物×2.5）
  { key: 'bp-armor-pla-2', kind: 'blueprint', refId: 'bp-armor-pla-2', rarity: 'rare', basePrice: 85000, demandMultiplier: 0.65 }, // 装甲镀层 MK2·能量型（蓝图=产物×2.5）
  { key: 'bp-armor-kin-3', kind: 'blueprint', refId: 'bp-armor-kin-3', rarity: 'rare', basePrice: 663000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·动能型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-exp-3', kind: 'blueprint', refId: 'bp-armor-exp-3', rarity: 'rare', basePrice: 663000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·高爆型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-pla-3', kind: 'blueprint', refId: 'bp-armor-pla-3', rarity: 'rare', basePrice: 663000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲镀层 MK3·能量型（蓝图=产物×3）（入闸）
  { key: 'bp-armor-plate-2', kind: 'blueprint', refId: 'bp-armor-plate-2', rarity: 'rare', basePrice: 85000, demandMultiplier: 0.65 }, // 装甲增厚板 MK2（蓝图=产物×2.5）
  { key: 'bp-armor-plate-3', kind: 'blueprint', refId: 'bp-armor-plate-3', rarity: 'rare', basePrice: 663000, demandMultiplier: 0.65, standingReq: 4 }, // 装甲增厚板 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-prop-2', kind: 'blueprint', refId: 'bp-prop-2', rarity: 'rare', basePrice: 97500, demandMultiplier: 0.65 }, // 矢量推进器 MK2（蓝图=产物×2.5）
  { key: 'bp-prop-3', kind: 'blueprint', refId: 'bp-prop-3', rarity: 'rare', basePrice: 816000, demandMultiplier: 0.65, standingReq: 4 }, // 矢量推进器 MK3（蓝图=产物×3）
  { key: 'bp-stab-kin-2', kind: 'blueprint', refId: 'bp-stab-kin-2', rarity: 'rare', basePrice: 525000, demandMultiplier: 0.65 }, // 动能稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-kin-3', kind: 'blueprint', refId: 'bp-stab-kin-3', rarity: 'rare', basePrice: 3150000, demandMultiplier: 0.65, standingReq: 4 }, // 动能稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-stab-exp-2', kind: 'blueprint', refId: 'bp-stab-exp-2', rarity: 'rare', basePrice: 525000, demandMultiplier: 0.65 }, // 高爆稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-exp-3', kind: 'blueprint', refId: 'bp-stab-exp-3', rarity: 'rare', basePrice: 3150000, demandMultiplier: 0.65, standingReq: 4 }, // 高爆稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-stab-pla-2', kind: 'blueprint', refId: 'bp-stab-pla-2', rarity: 'rare', basePrice: 525000, demandMultiplier: 0.65 }, // 等离子稳定器 MK2（蓝图=产物×2.5）
  { key: 'bp-stab-pla-3', kind: 'blueprint', refId: 'bp-stab-pla-3', rarity: 'rare', basePrice: 3150000, demandMultiplier: 0.65, standingReq: 4 }, // 等离子稳定器 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-rof-2', kind: 'blueprint', refId: 'bp-rof-2', rarity: 'rare', basePrice: 462500, demandMultiplier: 0.65 }, // 射速计算机 MK2（蓝图=产物×2.5）
  { key: 'bp-rof-3', kind: 'blueprint', refId: 'bp-rof-3', rarity: 'rare', basePrice: 2760000, demandMultiplier: 0.65, standingReq: 4 }, // 射速计算机 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-track-2', kind: 'blueprint', refId: 'bp-track-2', rarity: 'rare', basePrice: 400000, demandMultiplier: 0.65 }, // 索敌阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-track-3', kind: 'blueprint', refId: 'bp-track-3', rarity: 'rare', basePrice: 2400000, demandMultiplier: 0.65, standingReq: 4 }, // 索敌阵列 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-gyro-2', kind: 'blueprint', refId: 'bp-gyro-2', rarity: 'rare', basePrice: 375000, demandMultiplier: 0.65 }, // 姿态陀螺 MK2（蓝图=产物×2.5）
  { key: 'bp-gyro-3', kind: 'blueprint', refId: 'bp-gyro-3', rarity: 'rare', basePrice: 2250000, demandMultiplier: 0.65, standingReq: 4 }, // 姿态陀螺 MK3（蓝图=产物×3）（入闸）
  { key: 'bp-salvager-2', kind: 'blueprint', refId: 'bp-salvager-2', rarity: 'rare', basePrice: 325000, demandMultiplier: 0.65 }, // 打捞器 MK2（蓝图=产物×2.5）
  { key: 'bp-salvager-3', kind: 'blueprint', refId: 'bp-salvager-3', rarity: 'rare', basePrice: 2340000, demandMultiplier: 0.65, standingReq: 4 }, // 打捞器 MK3（蓝图=产物×3）
  { key: 'bp-hullrep-2', kind: 'blueprint', refId: 'bp-hullrep-2', rarity: 'rare', basePrice: 2760000, demandMultiplier: 0.65, standingReq: 4 }, // 船体维修装置 MK2（蓝图=产物×3）（入闸）
  { key: 'bp-lock-2', kind: 'blueprint', refId: 'bp-lock-2', rarity: 'rare', basePrice: 450000, demandMultiplier: 0.65 }, // 目标锁定阵列 MK2（蓝图=产物×2.5）
  { key: 'bp-lock-3', kind: 'blueprint', refId: 'bp-lock-3', rarity: 'rare', basePrice: 2640000, demandMultiplier: 0.65, standingReq: 4 }, // 目标锁定阵列 MK3（蓝图=产物×3）
  // 舰船蓝图（造船；稀有）
  { key: 'sbp-pioneer', kind: 'blueprint', refId: 'sbp-pioneer', rarity: 'exotic', basePrice: 3_600_000, demandMultiplier: 1.0, standingReq: 11 }, // 开拓级（蓝图=船价×3；2026-09-09 随全蓝图化升奇货档+声望 11）
  { key: 'sbp-humpback', kind: 'blueprint', refId: 'sbp-humpback', rarity: 'exotic', basePrice: 4_050_000, demandMultiplier: 1.0, standingReq: 11 }, // 座头鲸级（蓝图=船价×3；2026-09-09 随全蓝图化升奇货档+声望 11）
  // 稀有舰船（V10 四条族线中坚）
  { key: 'ship-whale', kind: 'ship', refId: 'whale', rarity: 'rare', basePrice: 900_000, demandMultiplier: 0.65 },
  // 蓝图船（2026-09-09 船长：成品无现货、只收不卖）——玩家已拥有的开拓级可二手挂售，NPC 收购，
  // 市场不出售成品（图鉴「仅可制造」标注自洽；供给抽取侧 playerBuyable=false 天然排除）
  { key: 'ship-pioneer', kind: 'ship', refId: 'pioneer', rarity: 'rare', basePrice: 1_200_000, demandMultiplier: 0.65, playerBuyable: false },
  { key: 'ship-humpback', kind: 'ship', refId: 'sh-humpback', rarity: 'rare', basePrice: 1_350_000, demandMultiplier: 0.65 },
  { key: 'ship-bowhead', kind: 'ship', refId: 'sh-bowhead', rarity: 'rare', basePrice: 1_900_000, demandMultiplier: 0.65 },
  { key: 'ship-falconet', kind: 'ship', refId: 'sh-falconet', rarity: 'rare', basePrice: 42_000, demandMultiplier: 0.65 },
  { key: 'ship-shrike', kind: 'ship', refId: 'sh-shrike', rarity: 'rare', basePrice: 110_000, demandMultiplier: 0.65 },
  { key: 'ship-tigershark', kind: 'ship', refId: 'sh-tigershark', rarity: 'rare', basePrice: 240_000, demandMultiplier: 0.65 },
  { key: 'ship-mako', kind: 'ship', refId: 'sh-mako', rarity: 'rare', basePrice: 480_000, demandMultiplier: 0.65 },
  { key: 'ship-swarm', kind: 'ship', refId: 'sh-swarm', rarity: 'rare', basePrice: 620_000, demandMultiplier: 0.65 },
  { key: 'ship-tortoise', kind: 'ship', refId: 'sh-tortoise', rarity: 'rare', basePrice: 330_000, demandMultiplier: 0.65 },
  { key: 'ship-hawksbill', kind: 'ship', refId: 'sh-hawksbill', rarity: 'rare', basePrice: 760_000, demandMultiplier: 0.65 },
  { key: 'ship-flyingfish', kind: 'ship', refId: 'sh-flyingfish', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.65 },
  { key: 'ship-sailfish', kind: 'ship', refId: 'sh-sailfish', rarity: 'rare', basePrice: 480_000, demandMultiplier: 0.65 },

  // ══════════ 限定奇货（exotic：极低概率、寿命 4 分钟、天价） ══════════

  // 鲸王级成品 2026-09-09 船长定只收不卖：蓝图船无现货——市场只供其造船蓝图书（sbp 奇货）；
  // 玩家已拥有的鲸王级可二手挂售（NPC 收购），成品永不出售
  { key: 'ship-whale-king', kind: 'ship', refId: 'whale-king', rarity: 'exotic', basePrice: 4_800_000, demandMultiplier: 1.0, standingReq: 11, playerBuyable: false },
  { key: 'sbp-whale-king', kind: 'blueprint', refId: 'sbp-whale-king', rarity: 'exotic', basePrice: 19_200_000, demandMultiplier: 1.0, standingReq: 11 },
  // V10 顶级船（声望解锁）
  { key: 'ship-sentinel', kind: 'ship', refId: 'sh-sentinel', rarity: 'exotic', basePrice: 2_600_000, demandMultiplier: 1.0, standingReq: 10 }, // 2026-09-09 船长定:无人机母舰声望 6→10
  { key: 'ship-whiteshark', kind: 'ship', refId: 'sh-whiteshark', rarity: 'exotic', basePrice: 1_100_000, demandMultiplier: 1.0, standingReq: 7 },
  // 掠食者巡洋舰线（2026-09-09 尺寸分级：T3 巡洋入奇货；价位 2026-09-09 船长定档：按战力序 9/11/13/15M）
  { key: 'ship-thresher', kind: 'ship', refId: 'sh-thresher', rarity: 'exotic', basePrice: 9_000_000, demandMultiplier: 1.0, standingReq: 8 },
  { key: 'ship-electricray', kind: 'ship', refId: 'sh-electricray', rarity: 'exotic', basePrice: 15_000_000, demandMultiplier: 1.0, standingReq: 8 },
  { key: 'ship-hammerhead', kind: 'ship', refId: 'sh-hammerhead', rarity: 'exotic', basePrice: 11_000_000, demandMultiplier: 1.0, standingReq: 9 },
  { key: 'ship-bullshark', kind: 'ship', refId: 'sh-bullshark', rarity: 'exotic', basePrice: 13_000_000, demandMultiplier: 1.0, standingReq: 10 },
  { key: 'ship-swordfish', kind: 'ship', refId: 'sh-swordfish', rarity: 'exotic', basePrice: 1_250_000, demandMultiplier: 1.0, standingReq: 8 },
  { key: 'ship-xuanwu', kind: 'ship', refId: 'sh-xuanwu', rarity: 'exotic', basePrice: 2_200_000, demandMultiplier: 1.0, standingReq: 9 },
  { key: 'ship-colossal', kind: 'ship', refId: 'sh-colossal', rarity: 'exotic', basePrice: 5_500_000, demandMultiplier: 1.0, standingReq: 11 },
  // 2026-09-09 全舰船蓝图化（第二批）：全部可造舰船开放蓝图书；蓝图价 = 船市场价 × 档位系数（≤30 万 ×2 / 30~100 万 ×2.5 / 100~400 万 ×3 / >400 万 ×4）；船价 ≤100 万 → 稀有、>100 万 → 奇货+声望 11
  { key: 'sbp-burrower', kind: 'blueprint', refId: 'sbp-burrower', rarity: 'rare', basePrice: 240000, demandMultiplier: 0.65 }, // 掘洞级（蓝图=船价×2）
  { key: 'sbp-whale', kind: 'blueprint', refId: 'sbp-whale', rarity: 'rare', basePrice: 2250000, demandMultiplier: 0.65 }, // 鲸吞级（蓝图=船价×2.5）
  { key: 'sbp-bowhead', kind: 'blueprint', refId: 'sbp-bowhead', rarity: 'exotic', basePrice: 5700000, demandMultiplier: 1.0, standingReq: 11 }, // 蝠鲼级（蓝图=船价×3）
  { key: 'sbp-falconet', kind: 'blueprint', refId: 'sbp-falconet', rarity: 'rare', basePrice: 80000, demandMultiplier: 0.65 }, // 鲣鱼级（蓝图=船价×2）
  { key: 'sbp-shrike', kind: 'blueprint', refId: 'sbp-shrike', rarity: 'rare', basePrice: 220000, demandMultiplier: 0.65 }, // 马鲛级（蓝图=船价×2）
  { key: 'sbp-tigershark', kind: 'blueprint', refId: 'sbp-tigershark', rarity: 'rare', basePrice: 480000, demandMultiplier: 0.65 }, // 虎鲨级（蓝图=船价×2）
  { key: 'sbp-mako', kind: 'blueprint', refId: 'sbp-mako', rarity: 'rare', basePrice: 1200000, demandMultiplier: 0.65 }, // 灰鲭鲨级（蓝图=船价×2.5）
  { key: 'sbp-whiteshark', kind: 'blueprint', refId: 'sbp-whiteshark', rarity: 'exotic', basePrice: 3300000, demandMultiplier: 1.0, standingReq: 11 }, // 大白鲨级（蓝图=船价×3）
  { key: 'sbp-swarm', kind: 'blueprint', refId: 'sbp-swarm', rarity: 'rare', basePrice: 1550000, demandMultiplier: 0.65 }, // 梭鱼级（蓝图=船价×2.5）
  { key: 'sbp-sentinel', kind: 'blueprint', refId: 'sbp-sentinel', rarity: 'exotic', basePrice: 7800000, demandMultiplier: 1.0, standingReq: 11 }, // 王鲭级（蓝图=船价×3）
  { key: 'sbp-thresher', kind: 'blueprint', refId: 'sbp-thresher', rarity: 'exotic', basePrice: 36000000, demandMultiplier: 1.0, standingReq: 11 }, // 长尾鲨级（蓝图=船价×4）
  { key: 'sbp-electricray', kind: 'blueprint', refId: 'sbp-electricray', rarity: 'exotic', basePrice: 60000000, demandMultiplier: 1.0, standingReq: 11 }, // 电鳐级（蓝图=船价×4）
  { key: 'sbp-hammerhead', kind: 'blueprint', refId: 'sbp-hammerhead', rarity: 'exotic', basePrice: 44000000, demandMultiplier: 1.0, standingReq: 11 }, // 锤头鲨级（蓝图=船价×4）
  { key: 'sbp-bullshark', kind: 'blueprint', refId: 'sbp-bullshark', rarity: 'exotic', basePrice: 52000000, demandMultiplier: 1.0, standingReq: 11 }, // 牛鲨级（蓝图=船价×4）
  { key: 'sbp-tortoise', kind: 'blueprint', refId: 'sbp-tortoise', rarity: 'rare', basePrice: 830000, demandMultiplier: 0.65 }, // 陆龟级（蓝图=船价×2.5）
  { key: 'sbp-hawksbill', kind: 'blueprint', refId: 'sbp-hawksbill', rarity: 'rare', basePrice: 1900000, demandMultiplier: 0.65 }, // 玳瑁级（蓝图=船价×2.5）
  { key: 'sbp-xuanwu', kind: 'blueprint', refId: 'sbp-xuanwu', rarity: 'exotic', basePrice: 6600000, demandMultiplier: 1.0, standingReq: 11 }, // 玄武级（蓝图=船价×3）
  { key: 'sbp-flyingfish', kind: 'blueprint', refId: 'sbp-flyingfish', rarity: 'rare', basePrice: 420000, demandMultiplier: 0.65 }, // 飞鱼级（蓝图=船价×2）
  { key: 'sbp-sailfish', kind: 'blueprint', refId: 'sbp-sailfish', rarity: 'rare', basePrice: 1200000, demandMultiplier: 0.65 }, // 旗鱼级（蓝图=船价×2.5）
  { key: 'sbp-swordfish', kind: 'blueprint', refId: 'sbp-swordfish', rarity: 'exotic', basePrice: 3750000, demandMultiplier: 1.0, standingReq: 11 }, // 剑鱼级（蓝图=船价×3）

// 旧 4 张：pioneer 1200000×3=3,600,000；whale-king 4800000×4=19,200,000；humpback 1350000×3=4,050,000；colossal 5500000×4=22,000,000（材料保留原单不动）
  { key: 'sbp-colossal', kind: 'blueprint', refId: 'sbp-colossal', rarity: 'exotic', basePrice: 22_000_000, demandMultiplier: 1.0, standingReq: 11 }, // 皇带鱼级（蓝图=船价×4；2026-09-09 全蓝图化定价）
  // 异星原型装备（V10：超档收藏，无蓝图，需声望 10）
  { key: 'mod-miner-proto', kind: 'module', refId: 'mod-miner-proto', rarity: 'exotic', basePrice: 1_600_000, demandMultiplier: 1.0, standingReq: 10 },
  { key: 'mod-cargo-proto', kind: 'module', refId: 'mod-cargo-proto', rarity: 'exotic', basePrice: 1_500_000, demandMultiplier: 1.0, standingReq: 10 },
  { key: 'mod-laser-proto', kind: 'module', refId: 'mod-laser-proto', rarity: 'exotic', basePrice: 3_000_000, demandMultiplier: 1.0, standingReq: 10 },
  // 高级 AI 核心（远征掉落为主；奇货市场 = 等不及的玩家的捷径；可回卖：收购档 exotic 1.0×L）
  { key: 'core-gamma', kind: 'aicore', refId: 'gamma', rarity: 'exotic', basePrice: 90_000, demandMultiplier: 1.0 },
  { key: 'core-beta', kind: 'aicore', refId: 'beta', rarity: 'exotic', basePrice: 280_000, demandMultiplier: 1.0 },
  { key: 'core-alpha', kind: 'aicore', refId: 'alpha', rarity: 'exotic', basePrice: 900_000, demandMultiplier: 1.0 },
]

/**
 * P2 抽取节拍制闸内商品（2026-09-06 船长定：声望 11 前以低权重（0.04）参与每 10 分钟 rare
 * 加权抽取、命中即 ×4 价暗市单可绕过买入；解锁后恢复正常权重与价格、不转常驻）。
 * 范围 = MK3 战斗件 19 件（武器三族/无人机架·导控/盾·甲抗容/支援件；剔除生产件 miner·cargo·salvager
 * 与机动 prop）+ 动能 MK3 蓝图书（自制渠道同闸，防绕过）。
 * 原型（proto）与顶船维持原 standingReq 纯硬拦，不加暗市。
 */
const BM_MK3_KEYS = new Set([
  'mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3',
  'mod-drone-rack-3', 'mod-drone-tac-3',
  'mod-shield-kin-3', 'mod-shield-exp-3', 'mod-shield-pla-3', 'mod-shield-ext-3',
  'mod-armor-kin-3', 'mod-armor-exp-3', 'mod-armor-pla-3', 'mod-armor-plate-3',
  'mod-stab-kin-3', 'mod-stab-exp-3', 'mod-stab-pla-3', 'mod-rof-3', 'mod-track-3', 'mod-gyro-3',
  'bp-turret-3',
  'bp-laser-3',
  'bp-missile-3',
  'bp-drone-rack-3',
  'bp-drone-tac-3',
  'bp-shield-kin-3',
  'bp-shield-exp-3',
  'bp-shield-pla-3',
  'bp-shield-ext-3',
  'bp-armor-kin-3',
  'bp-armor-exp-3',
  'bp-armor-pla-3',
  'bp-armor-plate-3',
  'bp-stab-kin-3',
  'bp-stab-exp-3',
  'bp-stab-pla-3',
  'bp-rof-3',
  'bp-track-3',
  'bp-gyro-3',
  'bp-hullrep-2',
])

/* ═══════════ 残骸收购卡（2026-09-08 船长定：残骸可到市场出售，单独分类；只收不卖） ═══════════
 * - 收价按残骸所在星系回收档（常/险/危，与精炼炉「残骸回收」档一致）：30 / 40 / 50 ISK·m³。
 *   锚定口径（2026-09-08 修正）：三档无技能拆解保底均 ≈57/m³（Y×池均价反推齐平）——
 *   卖价必须**严格低于 57**（任何档直接卖都不如拆解），同时对"该档典型特色回收（含 m）"
 *   ≈ 50% 上下（常 60 / 险 71 / 危 97 估算 → 30/40/50 ≈ 50%/56%/52%）——拆解 + 彩头 + 碎片 +
 *   技能(×1.75) 仍明显更赚，卖站 = 折价清仓/应急通道；档位梯度保留（越危险卖价越高）；
 * - playerBuyable = false（只收不卖）：NPC 只挂收购单、不出售残骸（防"低价买残骸→拆解套利"）；
 * - 每单位 = 1 m³（残骸乙案记账：计数即体积）。
 */

const GALAXY_SEC = new Map(GALAXIES.map((g) => [g.id, typeof g.security === 'number' ? g.security : 0.5]))
/** 残骸站内收价（ISK/m³；档位 = 该星系基础密度回收档：常 <20 / 险 20~29 / 危 ≥30） */
const WRECK_BUY_PRICE = { common: 30, risky: 40, dire: 50 } as const

export const WRECK_BUY_GOODS: readonly MarketGoodDef[] = ANOMALIES.filter((a) => a.hidden !== true).map((a) => {
  const sec = GALAXY_SEC.get(a.galaxyId) ?? 0.5
  const density = Math.min(40, Math.max(10, Math.round(10 + 15 * (1 - sec))))
  const tier = density >= 30 ? 'dire' : density >= 20 ? 'risky' : 'common'
  const id = wreckItemIdOf(a.id)
  return {
    key: id,
    kind: 'item',
    refId: id,
    rarity: 'common',
    basePrice: WRECK_BUY_PRICE[tier],
    poolTarget: 30_000,
    supplyFlow: 500,
    playerBuyable: false, // 只收不卖：空间站回收站不出售残骸
  }
})

export const MARKET_GOODS: readonly MarketGoodDef[] = [
  ...MARKET_GOODS_RAW.map((g) => (BM_MK3_KEYS.has(g.key) ? { ...g, bmStanding: 11 } : g)),
  ...WRECK_BUY_GOODS,
]

/** 构建市场商品目录（数字稀有度按物品表 RARITY_TIER 填充——2026-09-09 船长拍板：
 * 稀有度入物品本体，市场调用；与渠道 rarity 分离，只驱动稀有订单渠道刷新权重） */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.map((g) => [g.key, { ...g, rarityTier: rarityTierOf(g.refId) }]))
}
