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
import { wreckItemIdOf } from '@whale/core'
import { ANOMALIES } from './anomalies'
import { GALAXIES } from './universe'

export const MARKET_GOODS_RAW: readonly MarketGoodDef[] = [
  // ══════════ 常驻供应（common） ══════════

  // ── 矿石（池模型：玩家售矿主渠道；收购平价，池淤积压价） ──
  // 2026-09-05 船长：低级矿石/矿物是海量消耗品，池量与流量按"越低级越大"放大（稀有矿保持小）
  { key: 'ore-veldspar', kind: 'item', refId: 'ore-veldspar', rarity: 'common', basePrice: 12, poolTarget: 60_000, supplyFlow: 5_000 },
  { key: 'ore-scorched', kind: 'item', refId: 'ore-scorched', rarity: 'common', basePrice: 18, poolTarget: 40_000, supplyFlow: 2_000 },
  { key: 'ore-hemorphite', kind: 'item', refId: 'ore-hemorphite', rarity: 'common', basePrice: 55, poolTarget: 9_000, supplyFlow: 150 },
  { key: 'ore-glowstone', kind: 'item', refId: 'ore-glowstone', rarity: 'common', basePrice: 150, poolTarget: 15_000, supplyFlow: 300 },
  { key: 'ore-sunshard', kind: 'item', refId: 'ore-sunshard', rarity: 'common', basePrice: 115, poolTarget: 14_000, supplyFlow: 330 },
  { key: 'ore-voidshard', kind: 'item', refId: 'ore-voidshard', rarity: 'common', basePrice: 340, poolTarget: 3_000, supplyFlow: 60 },
  { key: 'ore-nebulite', kind: 'item', refId: 'ore-nebulite', rarity: 'common', basePrice: 490, poolTarget: 1_200, supplyFlow: 20 },
  // ── 矿物（池模型：制造原料主渠道；供应微溢 6%） ──
  { key: 'min-tritanium', kind: 'item', refId: 'min-tritanium', rarity: 'common', basePrice: 8, poolTarget: 300_000, supplyFlow: 10_000 },
  { key: 'min-pyerite', kind: 'item', refId: 'min-pyerite', rarity: 'common', basePrice: 12, poolTarget: 180_000, supplyFlow: 6_000 },
  { key: 'min-mexallon', kind: 'item', refId: 'min-mexallon', rarity: 'common', basePrice: 20, poolTarget: 90_000, supplyFlow: 3_000 },
  { key: 'min-nocxium', kind: 'item', refId: 'min-nocxium', rarity: 'common', basePrice: 90, poolTarget: 15_000, supplyFlow: 400 },
  { key: 'min-isotope', kind: 'item', refId: 'min-isotope', rarity: 'common', basePrice: 55, poolTarget: 24_000, supplyFlow: 500 },
  { key: 'min-starcore', kind: 'item', refId: 'min-starcore', rarity: 'common', basePrice: 245, poolTarget: 9_000, supplyFlow: 120 },
  { key: 'min-darkiron', kind: 'item', refId: 'min-darkiron', rarity: 'common', basePrice: 780, poolTarget: 2_500, supplyFlow: 20 },
  { key: 'min-voidcrystal', kind: 'item', refId: 'min-voidcrystal', rarity: 'common', basePrice: 1_800, poolTarget: 500, supplyFlow: 3 },
  // ── 气体（V10 池商品） ──
  { key: 'gas-neon', kind: 'item', refId: 'gas-neon', rarity: 'common', basePrice: 85, poolTarget: 2_500, supplyFlow: 45 },
  { key: 'gas-phosphor', kind: 'item', refId: 'gas-phosphor', rarity: 'common', basePrice: 330, poolTarget: 700, supplyFlow: 10 },
  { key: 'gas-ionstorm', kind: 'item', refId: 'gas-ionstorm', rarity: 'common', basePrice: 230, poolTarget: 800, supplyFlow: 12 },
  { key: 'gas-aurora', kind: 'item', refId: 'gas-aurora', rarity: 'common', basePrice: 330, poolTarget: 450, supplyFlow: 6 },
  // ── 冰矿（V10 池商品） ──
  { key: 'ice-frost', kind: 'item', refId: 'ice-frost', rarity: 'common', basePrice: 150, poolTarget: 2_000, supplyFlow: 35 },
  { key: 'ice-marrow', kind: 'item', refId: 'ice-marrow', rarity: 'common', basePrice: 230, poolTarget: 1_000, supplyFlow: 16 },
  { key: 'ice-darkstar', kind: 'item', refId: 'ice-darkstar', rarity: 'common', basePrice: 360, poolTarget: 400, supplyFlow: 6 },
  // ── 弹药（V10 占位消耗品：NPC 补给池，玩家可囤可回卖） ──
  { key: 'ammo-kinetic-l', kind: 'item', refId: 'ammo-kinetic-l', rarity: 'common', basePrice: 7, demandMultiplier: 0.6, poolTarget: 4_000, supplyFlow: 150 }, // 2026-09-08 工业收益体检：低周转行只升不砍（净率→≥20%）
  { key: 'ammo-explosive-l', kind: 'item', refId: 'ammo-explosive-l', rarity: 'common', basePrice: 8, demandMultiplier: 0.6, poolTarget: 3_800, supplyFlow: 140 },
  { key: 'ammo-plasma-l', kind: 'item', refId: 'ammo-plasma-l', rarity: 'common', basePrice: 9, demandMultiplier: 0.6, poolTarget: 3_500, supplyFlow: 120 },
  // ── 修理组件（2026-09-05：承伤持久化配套消耗品；民用/军用两档 NPC 常驻补给池） ──
  { key: 'repairkit-civ', kind: 'item', refId: 'repairkit-civ', rarity: 'common', basePrice: 3_300, demandMultiplier: 0.6, poolTarget: 300, supplyFlow: 4 },
  { key: 'repairkit-mil', kind: 'item', refId: 'repairkit-mil', rarity: 'common', basePrice: 23_100, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 1.5 },
  // ── 无人机（V10 占位：NPC 补给池） ──
  { key: 'drone-scout', kind: 'item', refId: 'drone-scout', rarity: 'common', basePrice: 900, demandMultiplier: 0.6, poolTarget: 200, supplyFlow: 4 },
  { key: 'drone-assault', kind: 'item', refId: 'drone-assault', rarity: 'common', basePrice: 2_200, demandMultiplier: 0.6, poolTarget: 120, supplyFlow: 2 },
  { key: 'drone-heavy', kind: 'item', refId: 'drone-heavy', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6, poolTarget: 60, supplyFlow: 1 },
  { key: 'drone-sentry', kind: 'item', refId: 'drone-sentry', rarity: 'common', basePrice: 9_500, demandMultiplier: 0.6, poolTarget: 30, supplyFlow: 1 },

  // ── 单件平价品 ──
  // 民用/入门装备（市场供应价 = 制造价的合理回本价；玩家自己造更便宜）
  { key: 'mod-miner-civ', kind: 'module', refId: 'mod-miner-civ', rarity: 'common', basePrice: 9_000, demandMultiplier: 0.6 },
  { key: 'mod-cargo-civ', kind: 'module', refId: 'mod-cargo-civ', rarity: 'common', basePrice: 8_000, demandMultiplier: 0.6 },
  { key: 'mod-turret-civ', kind: 'module', refId: 'mod-turret-civ', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-miner-1', kind: 'module', refId: 'mod-miner-1', rarity: 'common', basePrice: 31_200, demandMultiplier: 0.6 },
  { key: 'mod-cargo-1', kind: 'module', refId: 'mod-cargo-1', rarity: 'common', basePrice: 29_200, demandMultiplier: 0.6 },
  { key: 'mod-turret-kin-1', kind: 'module', refId: 'mod-turret-kin-1', rarity: 'common', basePrice: 53_000, demandMultiplier: 0.6 },
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
  // V18 无人机装置（高槽；市场专供无蓝图）
  { key: 'mod-drone-rack-1', kind: 'module', refId: 'mod-drone-rack-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'mod-drone-tac-1', kind: 'module', refId: 'mod-drone-tac-1', rarity: 'common', basePrice: 18_000, demandMultiplier: 0.6 },
  // 低级蓝图（价格 = 蓝图商店价；买来学习后永久可造，重复蓝图回卖按 common 档 0.6L 收购）
  { key: 'bp-miner-1', kind: 'blueprint', refId: 'bp-miner-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.6 },
  { key: 'bp-cargo-1', kind: 'blueprint', refId: 'bp-cargo-1', rarity: 'common', basePrice: 6_000, demandMultiplier: 0.6 },
  { key: 'bp-turret-1', kind: 'blueprint', refId: 'bp-turret-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.6 },
  { key: 'bp-miner-civ', kind: 'blueprint', refId: 'bp-miner-civ', rarity: 'common', basePrice: 2_200, demandMultiplier: 0.6 },
  { key: 'bp-cargo-civ', kind: 'blueprint', refId: 'bp-cargo-civ', rarity: 'common', basePrice: 2_400, demandMultiplier: 0.6 },
  { key: 'bp-turret-civ', kind: 'blueprint', refId: 'bp-turret-civ', rarity: 'common', basePrice: 2_800, demandMultiplier: 0.6 },
  // 弹药生产线蓝图（2026-09-05：基础弹自制；书籍价随弹型市场价）
  { key: 'bp-ammo-kinetic', kind: 'blueprint', refId: 'bp-ammo-kinetic', rarity: 'common', basePrice: 900, demandMultiplier: 0.6 },
  { key: 'bp-ammo-explosive', kind: 'blueprint', refId: 'bp-ammo-explosive', rarity: 'common', basePrice: 1_100, demandMultiplier: 0.6 },
  { key: 'bp-ammo-plasma', kind: 'blueprint', refId: 'bp-ammo-plasma', rarity: 'common', basePrice: 1_300, demandMultiplier: 0.6 },
  // 修理组件蓝图（2026-09-05：书籍价随组件市场价同构）
  { key: 'bp-repairkit-civ', kind: 'blueprint', refId: 'bp-repairkit-civ', rarity: 'common', basePrice: 3_600, demandMultiplier: 0.6 },
  { key: 'bp-repairkit-mil', kind: 'blueprint', refId: 'bp-repairkit-mil', rarity: 'common', basePrice: 9_000, demandMultiplier: 0.6 },
  // 低级船（AI 副船军团的主力船）
  { key: 'ship-burrower', kind: 'ship', refId: 'burrower', rarity: 'common', basePrice: 120_000, demandMultiplier: 0.6 },
  // 基础 AI 核心（原直购并入市场，平价常驻；可回卖：收购档 common 0.6×L）
  { key: 'core-basic', kind: 'aicore', refId: 'basic', rarity: 'common', basePrice: 25_000, demandMultiplier: 0.6 },

  // ══════════ 稀有订单（rare：低频刷新、寿命 9 分钟） ══════════

  // MK2 装备（制造党自用为主；偶有现货——现货价 = 自制成本 ×1.4 稀有溢价）
  { key: 'mod-miner-2', kind: 'module', refId: 'mod-miner-2', rarity: 'rare', basePrice: 181_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-2', kind: 'module', refId: 'mod-cargo-2', rarity: 'rare', basePrice: 199_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-2', kind: 'module', refId: 'mod-turret-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-2', kind: 'module', refId: 'mod-missile-2', rarity: 'rare', basePrice: 451_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-2', kind: 'module', refId: 'mod-laser-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.65 },
  // MK3 攻坚装备（V10 起蓝图可造 + 稀有现货高价应急；自制成本 ×1.7）
  { key: 'mod-miner-3', kind: 'module', refId: 'mod-miner-3', rarity: 'rare', basePrice: 991_000, demandMultiplier: 0.65 },
  { key: 'mod-cargo-3', kind: 'module', refId: 'mod-cargo-3', rarity: 'rare', basePrice: 1_122_000, demandMultiplier: 0.65 },
  { key: 'mod-turret-kin-3', kind: 'module', refId: 'mod-turret-kin-3', rarity: 'rare', basePrice: 1_916_000, demandMultiplier: 0.65 },
  { key: 'mod-missile-3', kind: 'module', refId: 'mod-missile-3', rarity: 'rare', basePrice: 2_242_000, demandMultiplier: 0.65 },
  { key: 'mod-laser-3', kind: 'module', refId: 'mod-laser-3', rarity: 'rare', basePrice: 2_395_000, demandMultiplier: 0.65 },
  // 战斗家族 MK2/MK3（V17：分系专精 ×3 款；MK3 市场专供——V18 复查：稀有溢价 ×1.4/×1.7）
  { key: 'mod-shield-kin-2', kind: 'module', refId: 'mod-shield-kin-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-2', kind: 'module', refId: 'mod-shield-exp-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-2', kind: 'module', refId: 'mod-shield-pla-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-2', kind: 'module', refId: 'mod-armor-kin-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-2', kind: 'module', refId: 'mod-armor-exp-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-2', kind: 'module', refId: 'mod-armor-pla-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-2', kind: 'module', refId: 'mod-prop-2', rarity: 'rare', basePrice: 39_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-2', kind: 'module', refId: 'mod-drone-rack-2', rarity: 'rare', basePrice: 90_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-2', kind: 'module', refId: 'mod-drone-tac-2', rarity: 'rare', basePrice: 160_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-kin-3', kind: 'module', refId: 'mod-shield-kin-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-exp-3', kind: 'module', refId: 'mod-shield-exp-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-pla-3', kind: 'module', refId: 'mod-shield-pla-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-kin-3', kind: 'module', refId: 'mod-armor-kin-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-exp-3', kind: 'module', refId: 'mod-armor-exp-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-pla-3', kind: 'module', refId: 'mod-armor-pla-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-2', kind: 'module', refId: 'mod-shield-ext-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-plate-2', kind: 'module', refId: 'mod-armor-plate-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.65 },
  { key: 'mod-shield-ext-3', kind: 'module', refId: 'mod-shield-ext-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.65 },
  { key: 'mod-armor-plate-3', kind: 'module', refId: 'mod-armor-plate-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.65 },
  { key: 'mod-prop-3', kind: 'module', refId: 'mod-prop-3', rarity: 'rare', basePrice: 272_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-rack-3', kind: 'module', refId: 'mod-drone-rack-3', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.65 },
  { key: 'mod-drone-tac-3', kind: 'module', refId: 'mod-drone-tac-3', rarity: 'rare', basePrice: 420_000, demandMultiplier: 0.65 },
  // V18.1 支援件（伤害稳定器/射速计算机 = 低槽；索敌阵列/姿态陀螺 = 中槽；MK1 常驻、MK2/3 稀有）
  { key: 'mod-stab-kin-1', kind: 'module', refId: 'mod-stab-kin-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-exp-1', kind: 'module', refId: 'mod-stab-exp-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-pla-1', kind: 'module', refId: 'mod-stab-pla-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.6 },
  { key: 'mod-rof-1', kind: 'module', refId: 'mod-rof-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.6 },
  { key: 'mod-track-1', kind: 'module', refId: 'mod-track-1', rarity: 'common', basePrice: 26_000, demandMultiplier: 0.6 },
  { key: 'mod-gyro-1', kind: 'module', refId: 'mod-gyro-1', rarity: 'common', basePrice: 24_000, demandMultiplier: 0.6 },
  // 船体维修装置（2026-09-09：中槽自动修复件——消耗型；民用级常驻、MK1/MK2 稀有现货）
  { key: 'mod-hullrep-civ', kind: 'module', refId: 'mod-hullrep-civ', rarity: 'common', basePrice: 20_000, demandMultiplier: 0.6 },
  { key: 'mod-stab-kin-2', kind: 'module', refId: 'mod-stab-kin-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-2', kind: 'module', refId: 'mod-stab-exp-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-2', kind: 'module', refId: 'mod-stab-pla-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-2', kind: 'module', refId: 'mod-rof-2', rarity: 'rare', basePrice: 185_000, demandMultiplier: 0.65 },
  { key: 'mod-track-2', kind: 'module', refId: 'mod-track-2', rarity: 'rare', basePrice: 160_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-2', kind: 'module', refId: 'mod-gyro-2', rarity: 'rare', basePrice: 150_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-kin-3', kind: 'module', refId: 'mod-stab-kin-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-exp-3', kind: 'module', refId: 'mod-stab-exp-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.65 },
  { key: 'mod-stab-pla-3', kind: 'module', refId: 'mod-stab-pla-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.65 },
  { key: 'mod-rof-3', kind: 'module', refId: 'mod-rof-3', rarity: 'rare', basePrice: 920_000, demandMultiplier: 0.65 },
  { key: 'mod-track-3', kind: 'module', refId: 'mod-track-3', rarity: 'rare', basePrice: 800_000, demandMultiplier: 0.65 },
  { key: 'mod-gyro-3', kind: 'module', refId: 'mod-gyro-3', rarity: 'rare', basePrice: 750_000, demandMultiplier: 0.65 },
  // 船体维修装置 MK1/MK2（消耗型修复件：档位价锚定中槽支援件 MK2/MK3；MK2 即顶档）
  { key: 'mod-hullrep-1', kind: 'module', refId: 'mod-hullrep-1', rarity: 'rare', basePrice: 150_000, demandMultiplier: 0.65 },
  { key: 'mod-hullrep-2', kind: 'module', refId: 'mod-hullrep-2', rarity: 'rare', basePrice: 780_000, demandMultiplier: 0.65 },
  /* ═══ B3 打捞器（2026-09-05；高槽无伤害件：升级只减周期；初价按低耗件梯队，可调） ═══ */
  { key: 'mod-salvager-1', kind: 'module', refId: 'mod-salvager-1', rarity: 'common', basePrice: 20_000, demandMultiplier: 0.6 },
  { key: 'mod-salvager-2', kind: 'module', refId: 'mod-salvager-2', rarity: 'rare', basePrice: 130_000, demandMultiplier: 0.65 },
  { key: 'mod-salvager-3', kind: 'module', refId: 'mod-salvager-3', rarity: 'rare', basePrice: 780_000, demandMultiplier: 0.65 },
  // 高级蓝图 MK2（旧）+ MK3（V10：学习需声望 4）
  { key: 'bp-miner-2', kind: 'blueprint', refId: 'bp-miner-2', rarity: 'rare', basePrice: 35_000, demandMultiplier: 0.65 },
  { key: 'bp-cargo-2', kind: 'blueprint', refId: 'bp-cargo-2', rarity: 'rare', basePrice: 45_000, demandMultiplier: 0.65 },
  { key: 'bp-turret-2', kind: 'blueprint', refId: 'bp-turret-2', rarity: 'rare', basePrice: 90_000, demandMultiplier: 0.65 },
  { key: 'bp-miner-3', kind: 'blueprint', refId: 'bp-miner-3', rarity: 'rare', basePrice: 140_000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-cargo-3', kind: 'blueprint', refId: 'bp-cargo-3', rarity: 'rare', basePrice: 130_000, demandMultiplier: 0.65, standingReq: 4 },
  { key: 'bp-turret-3', kind: 'blueprint', refId: 'bp-turret-3', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.65, standingReq: 4 },
  // 舰船蓝图（造船；稀有）
  { key: 'sbp-pioneer', kind: 'blueprint', refId: 'sbp-pioneer', rarity: 'rare', basePrice: 150_000, demandMultiplier: 0.65 },
  { key: 'sbp-humpback', kind: 'blueprint', refId: 'sbp-humpback', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.65 },
  // 稀有舰船（V10 四条族线中坚）
  { key: 'ship-whale', kind: 'ship', refId: 'whale', rarity: 'rare', basePrice: 900_000, demandMultiplier: 0.65 },
  { key: 'ship-pioneer', kind: 'ship', refId: 'pioneer', rarity: 'rare', basePrice: 1_200_000, demandMultiplier: 0.65 },
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

  { key: 'ship-whale-king', kind: 'ship', refId: 'whale-king', rarity: 'exotic', basePrice: 4_800_000, demandMultiplier: 1.0, standingReq: 11 },
  { key: 'sbp-whale-king', kind: 'blueprint', refId: 'sbp-whale-king', rarity: 'exotic', basePrice: 600_000, demandMultiplier: 1.0, standingReq: 11 },
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
  { key: 'sbp-colossal', kind: 'blueprint', refId: 'sbp-colossal', rarity: 'exotic', basePrice: 900_000, demandMultiplier: 1.0, standingReq: 11 },
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

/** 构建市场商品目录 */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.map((g) => [g.key, g]))
}
