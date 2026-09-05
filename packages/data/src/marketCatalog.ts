/**
 * 市场商品目录（V9 + V10 大扩容：31 → 97 张）。
 *
 * 目录规则（中文说明，设计文档 V4/V5/V10 已确认）：
 * - 市场只有两栏：常驻供应（common）/ 稀有订单（rare + exotic 奇货同栏展示）；
 * - 单件商品价格锚定旧商店价：常驻品=平价；稀有/限定品按稀缺度定溢价；
 * - 收购价 = demandMultiplier × L（防套利；装备/船 0.35~0.4 二手折价、蓝图 0.5、核心不可回卖）；
 * - 矿石/矿物/气体/冰矿/弹药/无人机走"池模型"：basePrice = 常驻均衡价，收购平价、供应微溢 6%；
 *   池 target/flow 随价格递减（防高价商品天量刷钱）；弹药/无人机为 NPC 补给池（占位消耗品，
 *   玩家可回卖但亏 6% 无套利）；
 * - V10 声望门槛（standingReq）：部分高端商品需协会声望才可买入（卖出不限）——给声望找新用途；
 *   门槛梯度：MK3 蓝图 4、武装/重装/航运顶级船 7~9、异星原型与旗舰 10~11。
 */

import type { MarketGoodDef } from '@whale/core'

export const MARKET_GOODS: readonly MarketGoodDef[] = [
  // ══════════ 常驻供应（common） ══════════

  // ── 矿石（池模型：玩家售矿主渠道；收购平价，池淤积压价） ──
  { key: 'ore-veldspar', kind: 'item', refId: 'ore-veldspar', rarity: 'common', basePrice: 12, poolTarget: 20_000, supplyFlow: 300 },
  { key: 'ore-scorched', kind: 'item', refId: 'ore-scorched', rarity: 'common', basePrice: 18, poolTarget: 8_000, supplyFlow: 120 },
  { key: 'ore-hemorphite', kind: 'item', refId: 'ore-hemorphite', rarity: 'common', basePrice: 55, poolTarget: 1_500, supplyFlow: 20 },
  { key: 'ore-glowstone', kind: 'item', refId: 'ore-glowstone', rarity: 'common', basePrice: 150, poolTarget: 3_600, supplyFlow: 50 },
  { key: 'ore-sunshard', kind: 'item', refId: 'ore-sunshard', rarity: 'common', basePrice: 115, poolTarget: 3_500, supplyFlow: 55 },
  { key: 'ore-voidshard', kind: 'item', refId: 'ore-voidshard', rarity: 'common', basePrice: 340, poolTarget: 700, supplyFlow: 11 },
  { key: 'ore-nebulite', kind: 'item', refId: 'ore-nebulite', rarity: 'common', basePrice: 490, poolTarget: 350, supplyFlow: 5 },
  // ── 矿物（池模型：制造原料主渠道；供应微溢 6%） ──
  { key: 'min-tritanium', kind: 'item', refId: 'min-tritanium', rarity: 'common', basePrice: 8, poolTarget: 24_000, supplyFlow: 800 },
  { key: 'min-pyerite', kind: 'item', refId: 'min-pyerite', rarity: 'common', basePrice: 12, poolTarget: 14_000, supplyFlow: 500 },
  { key: 'min-mexallon', kind: 'item', refId: 'min-mexallon', rarity: 'common', basePrice: 20, poolTarget: 6_000, supplyFlow: 220 },
  { key: 'min-nocxium', kind: 'item', refId: 'min-nocxium', rarity: 'common', basePrice: 90, poolTarget: 1_200, supplyFlow: 40 },
  { key: 'min-isotope', kind: 'item', refId: 'min-isotope', rarity: 'common', basePrice: 55, poolTarget: 2_400, supplyFlow: 60 },
  { key: 'min-starcore', kind: 'item', refId: 'min-starcore', rarity: 'common', basePrice: 245, poolTarget: 900, supplyFlow: 18 },
  { key: 'min-darkiron', kind: 'item', refId: 'min-darkiron', rarity: 'common', basePrice: 780, poolTarget: 300, supplyFlow: 5 },
  { key: 'min-voidcrystal', kind: 'item', refId: 'min-voidcrystal', rarity: 'common', basePrice: 1_800, poolTarget: 80, supplyFlow: 1 },
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
  { key: 'ammo-kinetic-l', kind: 'item', refId: 'ammo-kinetic-l', rarity: 'common', basePrice: 6, poolTarget: 4_000, supplyFlow: 150 },
  { key: 'ammo-explosive-l', kind: 'item', refId: 'ammo-explosive-l', rarity: 'common', basePrice: 7, poolTarget: 3_800, supplyFlow: 140 },
  { key: 'ammo-plasma-l', kind: 'item', refId: 'ammo-plasma-l', rarity: 'common', basePrice: 8, poolTarget: 3_500, supplyFlow: 120 },
  // ── 无人机（V10 占位：NPC 补给池） ──
  { key: 'drone-scout', kind: 'item', refId: 'drone-scout', rarity: 'common', basePrice: 900, poolTarget: 200, supplyFlow: 4 },
  { key: 'drone-assault', kind: 'item', refId: 'drone-assault', rarity: 'common', basePrice: 2_200, poolTarget: 120, supplyFlow: 2 },
  { key: 'drone-heavy', kind: 'item', refId: 'drone-heavy', rarity: 'common', basePrice: 5_000, poolTarget: 60, supplyFlow: 1 },
  { key: 'drone-sentry', kind: 'item', refId: 'drone-sentry', rarity: 'common', basePrice: 9_500, poolTarget: 30, supplyFlow: 1 },

  // ── 单件平价品 ──
  // 民用/入门装备（市场供应价 = 制造价的合理回本价；玩家自己造更便宜）
  { key: 'mod-miner-civ', kind: 'module', refId: 'mod-miner-civ', rarity: 'common', basePrice: 9_000, demandMultiplier: 0.4 },
  { key: 'mod-cargo-civ', kind: 'module', refId: 'mod-cargo-civ', rarity: 'common', basePrice: 8_000, demandMultiplier: 0.4 },
  { key: 'mod-turret-civ', kind: 'module', refId: 'mod-turret-civ', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.4 },
  { key: 'mod-miner-1', kind: 'module', refId: 'mod-miner-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.4 },
  { key: 'mod-cargo-1', kind: 'module', refId: 'mod-cargo-1', rarity: 'common', basePrice: 28_000, demandMultiplier: 0.4 },
  { key: 'mod-turret-kin-1', kind: 'module', refId: 'mod-turret-kin-1', rarity: 'common', basePrice: 53_000, demandMultiplier: 0.4 },
  { key: 'mod-missile-1', kind: 'module', refId: 'mod-missile-1', rarity: 'common', basePrice: 62_000, demandMultiplier: 0.4 },
  { key: 'mod-laser-1', kind: 'module', refId: 'mod-laser-1', rarity: 'common', basePrice: 66_000, demandMultiplier: 0.4 },
  // 战斗家族 MK1（V17 起真生效：护盾/装甲为分系专精三款、矢量推进器；低价鼓励勤换装）
  { key: 'mod-shield-kin-1', kind: 'module', refId: 'mod-shield-kin-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.4 },
  { key: 'mod-shield-exp-1', kind: 'module', refId: 'mod-shield-exp-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.4 },
  { key: 'mod-shield-pla-1', kind: 'module', refId: 'mod-shield-pla-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.4 },
  { key: 'mod-armor-kin-1', kind: 'module', refId: 'mod-armor-kin-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.4 },
  { key: 'mod-armor-exp-1', kind: 'module', refId: 'mod-armor-exp-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.4 },
  { key: 'mod-armor-pla-1', kind: 'module', refId: 'mod-armor-pla-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.4 },
  { key: 'mod-shield-ext-1', kind: 'module', refId: 'mod-shield-ext-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.4 },
  { key: 'mod-armor-plate-1', kind: 'module', refId: 'mod-armor-plate-1', rarity: 'common', basePrice: 5_500, demandMultiplier: 0.4 },
  { key: 'mod-prop-1', kind: 'module', refId: 'mod-prop-1', rarity: 'common', basePrice: 6_000, demandMultiplier: 0.4 },
  // V18 无人机装置（高槽；市场专供无蓝图）
  { key: 'mod-drone-rack-1', kind: 'module', refId: 'mod-drone-rack-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.4 },
  { key: 'mod-drone-tac-1', kind: 'module', refId: 'mod-drone-tac-1', rarity: 'common', basePrice: 18_000, demandMultiplier: 0.4 },
  // 低级蓝图（价格 = 蓝图商店价；买来学习后永久可造，重复蓝图回卖半价）
  { key: 'bp-miner-1', kind: 'blueprint', refId: 'bp-miner-1', rarity: 'common', basePrice: 5_000, demandMultiplier: 0.5 },
  { key: 'bp-cargo-1', kind: 'blueprint', refId: 'bp-cargo-1', rarity: 'common', basePrice: 6_000, demandMultiplier: 0.5 },
  { key: 'bp-turret-1', kind: 'blueprint', refId: 'bp-turret-1', rarity: 'common', basePrice: 12_000, demandMultiplier: 0.5 },
  { key: 'bp-miner-civ', kind: 'blueprint', refId: 'bp-miner-civ', rarity: 'common', basePrice: 2_200, demandMultiplier: 0.5 },
  { key: 'bp-cargo-civ', kind: 'blueprint', refId: 'bp-cargo-civ', rarity: 'common', basePrice: 2_400, demandMultiplier: 0.5 },
  { key: 'bp-turret-civ', kind: 'blueprint', refId: 'bp-turret-civ', rarity: 'common', basePrice: 2_800, demandMultiplier: 0.5 },
  // 弹药生产线蓝图（2026-09-05：基础弹自制；书籍价随弹型市场价）
  { key: 'bp-ammo-kinetic', kind: 'blueprint', refId: 'bp-ammo-kinetic', rarity: 'common', basePrice: 900, demandMultiplier: 0.5 },
  { key: 'bp-ammo-explosive', kind: 'blueprint', refId: 'bp-ammo-explosive', rarity: 'common', basePrice: 1_100, demandMultiplier: 0.5 },
  { key: 'bp-ammo-plasma', kind: 'blueprint', refId: 'bp-ammo-plasma', rarity: 'common', basePrice: 1_300, demandMultiplier: 0.5 },
  // 低级船（AI 副船军团的主力船）
  { key: 'ship-burrower', kind: 'ship', refId: 'burrower', rarity: 'common', basePrice: 120_000, demandMultiplier: 0.4 },
  // 基础 AI 核心（原直购并入市场，平价常驻；核心不支持回卖）
  { key: 'core-basic', kind: 'aicore', refId: 'basic', rarity: 'common', basePrice: 25_000, demandMultiplier: 0.5, playerSellable: false },

  // ══════════ 稀有订单（rare：低频刷新、寿命 9 分钟） ══════════

  // MK2 装备（制造党自用为主；偶有现货——现货价 = 自制成本 ×1.4 稀有溢价）
  { key: 'mod-miner-2', kind: 'module', refId: 'mod-miner-2', rarity: 'rare', basePrice: 181_000, demandMultiplier: 0.35 },
  { key: 'mod-cargo-2', kind: 'module', refId: 'mod-cargo-2', rarity: 'rare', basePrice: 199_000, demandMultiplier: 0.35 },
  { key: 'mod-turret-kin-2', kind: 'module', refId: 'mod-turret-kin-2', rarity: 'rare', basePrice: 385_000, demandMultiplier: 0.35 },
  { key: 'mod-missile-2', kind: 'module', refId: 'mod-missile-2', rarity: 'rare', basePrice: 451_000, demandMultiplier: 0.35 },
  { key: 'mod-laser-2', kind: 'module', refId: 'mod-laser-2', rarity: 'rare', basePrice: 481_000, demandMultiplier: 0.35 },
  // MK3 攻坚装备（V10 起蓝图可造 + 稀有现货高价应急；自制成本 ×1.7）
  { key: 'mod-miner-3', kind: 'module', refId: 'mod-miner-3', rarity: 'rare', basePrice: 991_000, demandMultiplier: 0.35 },
  { key: 'mod-cargo-3', kind: 'module', refId: 'mod-cargo-3', rarity: 'rare', basePrice: 1_122_000, demandMultiplier: 0.35 },
  { key: 'mod-turret-kin-3', kind: 'module', refId: 'mod-turret-kin-3', rarity: 'rare', basePrice: 1_916_000, demandMultiplier: 0.35 },
  { key: 'mod-missile-3', kind: 'module', refId: 'mod-missile-3', rarity: 'rare', basePrice: 2_242_000, demandMultiplier: 0.35 },
  { key: 'mod-laser-3', kind: 'module', refId: 'mod-laser-3', rarity: 'rare', basePrice: 2_395_000, demandMultiplier: 0.35 },
  // 战斗家族 MK2/MK3（V17：分系专精 ×3 款；MK3 市场专供——V18 复查：稀有溢价 ×1.4/×1.7）
  { key: 'mod-shield-kin-2', kind: 'module', refId: 'mod-shield-kin-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-exp-2', kind: 'module', refId: 'mod-shield-exp-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-pla-2', kind: 'module', refId: 'mod-shield-pla-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-kin-2', kind: 'module', refId: 'mod-armor-kin-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-exp-2', kind: 'module', refId: 'mod-armor-exp-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-pla-2', kind: 'module', refId: 'mod-armor-pla-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.35 },
  { key: 'mod-prop-2', kind: 'module', refId: 'mod-prop-2', rarity: 'rare', basePrice: 39_000, demandMultiplier: 0.35 },
  { key: 'mod-drone-rack-2', kind: 'module', refId: 'mod-drone-rack-2', rarity: 'rare', basePrice: 90_000, demandMultiplier: 0.35 },
  { key: 'mod-drone-tac-2', kind: 'module', refId: 'mod-drone-tac-2', rarity: 'rare', basePrice: 160_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-kin-3', kind: 'module', refId: 'mod-shield-kin-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-exp-3', kind: 'module', refId: 'mod-shield-exp-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-pla-3', kind: 'module', refId: 'mod-shield-pla-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-kin-3', kind: 'module', refId: 'mod-armor-kin-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-exp-3', kind: 'module', refId: 'mod-armor-exp-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-pla-3', kind: 'module', refId: 'mod-armor-pla-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-ext-2', kind: 'module', refId: 'mod-shield-ext-2', rarity: 'rare', basePrice: 28_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-plate-2', kind: 'module', refId: 'mod-armor-plate-2', rarity: 'rare', basePrice: 34_000, demandMultiplier: 0.35 },
  { key: 'mod-shield-ext-3', kind: 'module', refId: 'mod-shield-ext-3', rarity: 'rare', basePrice: 170_000, demandMultiplier: 0.35 },
  { key: 'mod-armor-plate-3', kind: 'module', refId: 'mod-armor-plate-3', rarity: 'rare', basePrice: 221_000, demandMultiplier: 0.35 },
  { key: 'mod-prop-3', kind: 'module', refId: 'mod-prop-3', rarity: 'rare', basePrice: 272_000, demandMultiplier: 0.35 },
  { key: 'mod-drone-rack-3', kind: 'module', refId: 'mod-drone-rack-3', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.35 },
  { key: 'mod-drone-tac-3', kind: 'module', refId: 'mod-drone-tac-3', rarity: 'rare', basePrice: 420_000, demandMultiplier: 0.35 },
  // V18.1 支援件（伤害稳定器/射速计算机 = 低槽；索敌阵列/姿态陀螺 = 中槽；MK1 常驻、MK2/3 稀有）
  { key: 'mod-stab-kin-1', kind: 'module', refId: 'mod-stab-kin-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.4 },
  { key: 'mod-stab-exp-1', kind: 'module', refId: 'mod-stab-exp-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.4 },
  { key: 'mod-stab-pla-1', kind: 'module', refId: 'mod-stab-pla-1', rarity: 'common', basePrice: 34_000, demandMultiplier: 0.4 },
  { key: 'mod-rof-1', kind: 'module', refId: 'mod-rof-1', rarity: 'common', basePrice: 30_000, demandMultiplier: 0.4 },
  { key: 'mod-track-1', kind: 'module', refId: 'mod-track-1', rarity: 'common', basePrice: 26_000, demandMultiplier: 0.4 },
  { key: 'mod-gyro-1', kind: 'module', refId: 'mod-gyro-1', rarity: 'common', basePrice: 24_000, demandMultiplier: 0.4 },
  { key: 'mod-stab-kin-2', kind: 'module', refId: 'mod-stab-kin-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.35 },
  { key: 'mod-stab-exp-2', kind: 'module', refId: 'mod-stab-exp-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.35 },
  { key: 'mod-stab-pla-2', kind: 'module', refId: 'mod-stab-pla-2', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.35 },
  { key: 'mod-rof-2', kind: 'module', refId: 'mod-rof-2', rarity: 'rare', basePrice: 185_000, demandMultiplier: 0.35 },
  { key: 'mod-track-2', kind: 'module', refId: 'mod-track-2', rarity: 'rare', basePrice: 160_000, demandMultiplier: 0.35 },
  { key: 'mod-gyro-2', kind: 'module', refId: 'mod-gyro-2', rarity: 'rare', basePrice: 150_000, demandMultiplier: 0.35 },
  { key: 'mod-stab-kin-3', kind: 'module', refId: 'mod-stab-kin-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.35 },
  { key: 'mod-stab-exp-3', kind: 'module', refId: 'mod-stab-exp-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.35 },
  { key: 'mod-stab-pla-3', kind: 'module', refId: 'mod-stab-pla-3', rarity: 'rare', basePrice: 1_050_000, demandMultiplier: 0.35 },
  { key: 'mod-rof-3', kind: 'module', refId: 'mod-rof-3', rarity: 'rare', basePrice: 920_000, demandMultiplier: 0.35 },
  { key: 'mod-track-3', kind: 'module', refId: 'mod-track-3', rarity: 'rare', basePrice: 800_000, demandMultiplier: 0.35 },
  { key: 'mod-gyro-3', kind: 'module', refId: 'mod-gyro-3', rarity: 'rare', basePrice: 750_000, demandMultiplier: 0.35 },
  /* ═══ B3 打捞器（2026-09-05；高槽无伤害件：升级只减周期；初价按低耗件梯队，可调） ═══ */
  { key: 'mod-salvager-1', kind: 'module', refId: 'mod-salvager-1', rarity: 'common', basePrice: 20_000, demandMultiplier: 0.4 },
  { key: 'mod-salvager-2', kind: 'module', refId: 'mod-salvager-2', rarity: 'rare', basePrice: 130_000, demandMultiplier: 0.35 },
  { key: 'mod-salvager-3', kind: 'module', refId: 'mod-salvager-3', rarity: 'rare', basePrice: 780_000, demandMultiplier: 0.35 },
  // 高级蓝图 MK2（旧）+ MK3（V10：学习需声望 4）
  { key: 'bp-miner-2', kind: 'blueprint', refId: 'bp-miner-2', rarity: 'rare', basePrice: 35_000, demandMultiplier: 0.5 },
  { key: 'bp-cargo-2', kind: 'blueprint', refId: 'bp-cargo-2', rarity: 'rare', basePrice: 45_000, demandMultiplier: 0.5 },
  { key: 'bp-turret-2', kind: 'blueprint', refId: 'bp-turret-2', rarity: 'rare', basePrice: 90_000, demandMultiplier: 0.5 },
  { key: 'bp-miner-3', kind: 'blueprint', refId: 'bp-miner-3', rarity: 'rare', basePrice: 140_000, demandMultiplier: 0.5, standingReq: 4 },
  { key: 'bp-cargo-3', kind: 'blueprint', refId: 'bp-cargo-3', rarity: 'rare', basePrice: 130_000, demandMultiplier: 0.5, standingReq: 4 },
  { key: 'bp-turret-3', kind: 'blueprint', refId: 'bp-turret-3', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.5, standingReq: 4 },
  // 舰船蓝图（造船；稀有）
  { key: 'sbp-pioneer', kind: 'blueprint', refId: 'sbp-pioneer', rarity: 'rare', basePrice: 150_000, demandMultiplier: 0.5 },
  { key: 'sbp-humpback', kind: 'blueprint', refId: 'sbp-humpback', rarity: 'rare', basePrice: 260_000, demandMultiplier: 0.5 },
  // 稀有舰船（V10 四条族线中坚）
  { key: 'ship-whale', kind: 'ship', refId: 'whale', rarity: 'rare', basePrice: 900_000, demandMultiplier: 0.35 },
  { key: 'ship-pioneer', kind: 'ship', refId: 'pioneer', rarity: 'rare', basePrice: 1_200_000, demandMultiplier: 0.35 },
  { key: 'ship-humpback', kind: 'ship', refId: 'sh-humpback', rarity: 'rare', basePrice: 1_350_000, demandMultiplier: 0.35 },
  { key: 'ship-bowhead', kind: 'ship', refId: 'sh-bowhead', rarity: 'rare', basePrice: 1_900_000, demandMultiplier: 0.35 },
  { key: 'ship-falconet', kind: 'ship', refId: 'sh-falconet', rarity: 'rare', basePrice: 42_000, demandMultiplier: 0.35 },
  { key: 'ship-shrike', kind: 'ship', refId: 'sh-shrike', rarity: 'rare', basePrice: 110_000, demandMultiplier: 0.35 },
  { key: 'ship-tigershark', kind: 'ship', refId: 'sh-tigershark', rarity: 'rare', basePrice: 240_000, demandMultiplier: 0.35 },
  { key: 'ship-mako', kind: 'ship', refId: 'sh-mako', rarity: 'rare', basePrice: 480_000, demandMultiplier: 0.35 },
  { key: 'ship-tortoise', kind: 'ship', refId: 'sh-tortoise', rarity: 'rare', basePrice: 330_000, demandMultiplier: 0.35 },
  { key: 'ship-hawksbill', kind: 'ship', refId: 'sh-hawksbill', rarity: 'rare', basePrice: 760_000, demandMultiplier: 0.35 },
  { key: 'ship-flyingfish', kind: 'ship', refId: 'sh-flyingfish', rarity: 'rare', basePrice: 210_000, demandMultiplier: 0.35 },
  { key: 'ship-sailfish', kind: 'ship', refId: 'sh-sailfish', rarity: 'rare', basePrice: 480_000, demandMultiplier: 0.35 },

  // ══════════ 限定奇货（exotic：极低概率、寿命 4 分钟、天价） ══════════

  { key: 'ship-whale-king', kind: 'ship', refId: 'whale-king', rarity: 'exotic', basePrice: 4_800_000, demandMultiplier: 0.3 },
  { key: 'sbp-whale-king', kind: 'blueprint', refId: 'sbp-whale-king', rarity: 'exotic', basePrice: 600_000, demandMultiplier: 0.5 },
  // V10 顶级船（声望解锁）
  { key: 'ship-whiteshark', kind: 'ship', refId: 'sh-whiteshark', rarity: 'exotic', basePrice: 1_100_000, demandMultiplier: 0.3, standingReq: 7 },
  { key: 'ship-swordfish', kind: 'ship', refId: 'sh-swordfish', rarity: 'exotic', basePrice: 1_250_000, demandMultiplier: 0.3, standingReq: 8 },
  { key: 'ship-xuanwu', kind: 'ship', refId: 'sh-xuanwu', rarity: 'exotic', basePrice: 2_200_000, demandMultiplier: 0.3, standingReq: 9 },
  { key: 'ship-colossal', kind: 'ship', refId: 'sh-colossal', rarity: 'exotic', basePrice: 5_500_000, demandMultiplier: 0.3, standingReq: 11 },
  { key: 'sbp-colossal', kind: 'blueprint', refId: 'sbp-colossal', rarity: 'exotic', basePrice: 900_000, demandMultiplier: 0.5, standingReq: 11 },
  // 异星原型装备（V10：超档收藏，无蓝图，需声望 10）
  { key: 'mod-miner-proto', kind: 'module', refId: 'mod-miner-proto', rarity: 'exotic', basePrice: 1_600_000, demandMultiplier: 0.3, standingReq: 10 },
  { key: 'mod-cargo-proto', kind: 'module', refId: 'mod-cargo-proto', rarity: 'exotic', basePrice: 1_500_000, demandMultiplier: 0.3, standingReq: 10 },
  { key: 'mod-laser-proto', kind: 'module', refId: 'mod-laser-proto', rarity: 'exotic', basePrice: 3_000_000, demandMultiplier: 0.3, standingReq: 10 },
  // 高级 AI 核心（远征掉落为主；奇货市场 = 等不及的玩家的捷径）
  { key: 'core-gamma', kind: 'aicore', refId: 'gamma', rarity: 'exotic', basePrice: 90_000, demandMultiplier: 0.5, playerSellable: false },
  { key: 'core-beta', kind: 'aicore', refId: 'beta', rarity: 'exotic', basePrice: 280_000, demandMultiplier: 0.5, playerSellable: false },
  { key: 'core-alpha', kind: 'aicore', refId: 'alpha', rarity: 'exotic', basePrice: 900_000, demandMultiplier: 0.5, playerSellable: false },
]

/** 构建市场商品目录 */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.map((g) => [g.key, g]))
}
