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

import staticDocument from './static/market.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const MARKET_GOODS_RAW_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'mod-drone-launch-1': {}, 'mod-drone-launch-2': {}, 'mod-drone-launch-3': {},
  'mod-laser-calibration-2': {}, 'mod-laser-calibration-3': {},
  'bp-drone-launch-1': {}, 'bp-drone-launch-2': {}, 'bp-drone-launch-3': {},
  'bp-laser-calibration-2': {}, 'bp-laser-calibration-3': {},
  "ore-veldspar": {

  },
  "ore-scorched": {

  },
  "ore-hemorphite": {

  },
  "ore-glowstone": {

  },
  "ore-sunshard": {

  },
  "ore-voidshard": {

  },
  "ore-nebulite": {

  },
  "ore-voidmother": {

  },
  "box-relic-a": {

  },
  "box-relic-c": {

  },
  "box-relic-d": {

  },
  "box-relic-e": {

  },
  "box-relic-g": {

  },
  "box-bp-shallow": {

  },
  "box-bp-mid": {

  },
  "box-bp-deep": {

  },
  "ai-core-gamma": {

  },
  "ai-core-beta": {

  },
  "ai-core-alpha": {

  },
  "mat-surveyor": {

  },
  "mat-chrono": {

  },
  "mat-crane": {

  },
  "mat-drill": {

  },
  "mat-nebula": {

  },
  "mat-enricher": {

  },
  "mat-expander": {

  },
  "mat-suppressor": {

  },
  "mat-boss-analyzer": {

  },
  "mat-extract-cover": {

  },
  "mat-shield-res": {

  },
  "mat-armor-res": {

  },
  "mat-hull-res": {

  },
  "mat-tracker": {

  },
  "mat-gyro": {

  },
  "mat-jammer": {

  },
  "mat-rangefinder": {

  },
  "mat-blindspot": {

  },
  "mat-ammo-dmg": {

  },
  "mat-reload": {

  },
  "mat-volley": {

  },
  "mat-ammo-back": {

  },
  "mat-drone-net": {

  },
  "mat-field-repair": {

  },
  "min-tritanium": {

  },
  "min-pyerite": {

  },
  "min-mexallon": {

  },
  "min-nocxium": {

  },
  "min-isotope": {

  },
  "min-starcore": {

  },
  "min-darkiron": {

  },
  "min-voidcrystal": {
    limitedSupplyEveryMs: 6 * 60_000,
  },
  "min-jumplasma": {

  },
  "min-cryoslurry": {

  },
  "min-curvature": {

  },
  "jump-fuel": {

  },
  "invasion-beacon": {

  },
  "synaptic-accelerant": {

  },
  "mat-wh-essence": {

  },
  "blackbox-h": {

  },
  "blackbox-r": {

  },
  "blackbox-c": {},
  "blackbox-universal": {

  },
  "lux-1": {

  },
  "lux-2": {

  },
  "lux-3": {

  },
  "lux-4": {

  },
  "lux-5": {

  },
  "lux-6": {

  },
  "lux-7": {

  },
  "lux-8": {

  },
  "lux-9": {

  },
  "lux-10": {

  },
  "box-valuables": {

  },
  "box-military": {

  },
  "gas-neon": {

  },
  "gas-phosphor": {

  },
  "gas-ionstorm": {

  },
  "gas-aurora": {

  },
  "ice-frost": {

  },
  "ice-marrow": {

  },
  "ice-darkstar": {

  },
  "ammo-kinetic-l": {

  },
  "part-circuit": {

  },
  "part-armor-plate": {

  },
  "part-frame": {

  },
  "part-cable": {

  },
  "part-coolant": {

  },
  "part-gyro": {

  },
  "part-lens": {

  },
  "ammo-explosive-l": {

  },
  "ammo-plasma-l": {

  },
  "ammo-kinetic-2": {

  },
  "ammo-explosive-2": {

  },
  "ammo-plasma-2": {

  },
  "repairkit-civ": {

  },
  "repairkit-mil": {

  },
  "repairkit-dc": {

  },
  "drone-scout": {

  },
  "drone-assault": {

  },
  "drone-heavy": {

  },
  "drone-sentry": {

  },
  "mod-miner-civ": {

  },
  "mod-cargo-civ": {

  },
  "mod-turret-civ": {

  },
  "mod-miner-1": {

  },
  "mod-cargo-1": {

  },
  "mod-turret-kin-1": {

  },
  "mod-pd-e": {

  },
  "bp-pd-e": {

  },
  "mod-pd-e-2": {

  },
  "bp-pd-e-2": {

  },
  "mod-pd-e-3": {

  },
  "bp-pd-e-3": {

  },
  "mod-missile-1": {

  },
  "mod-laser-1": {

  },
  "mod-shield-kin-1": {

  },
  "mod-shield-exp-1": {

  },
  "mod-shield-pla-1": {

  },
  "mod-armor-kin-1": {

  },
  "mod-armor-exp-1": {

  },
  "mod-armor-pla-1": {

  },
  "mod-shield-ext-1": {

  },
  "mod-shieldchg-1": {

  },
  "mod-armor-plate-1": {

  },
  "mod-prop-1": {

  },
  "mod-drone-rack-1": {

  },
  "mod-drone-tac-1": {

  },
  "mod-drone-relay-1": {

  },
  "mod-drone-deck-1": {

  },
  "bp-miner-1": {

  },
  "bp-cargo-1": {

  },
  "bp-turret-1": {

  },
  "bp-miner-civ": {

  },
  "bp-cargo-civ": {

  },
  "bp-turret-civ": {

  },
  "bp-ammo-kinetic": {

  },
  "bp-ammo-explosive": {

  },
  "bp-ammo-plasma": {

  },
  "bp-ammo-kinetic-2": {

  },
  "bp-ammo-explosive-2": {

  },
  "bp-ammo-plasma-2": {

  },
  "ammo-kinetic-3": {},
  "ammo-explosive-3": {},
  "ammo-plasma-3": {},
  "bp-ammo-kinetic-3": {},
  "bp-ammo-explosive-3": {},
  "bp-ammo-plasma-3": {},
  "bp-repairkit-civ": {

  },
  "bp-repairkit-mil": {

  },
  "bp-repairkit-dc": {

  },
  "bp-laser-1": {

  },
  "bp-missile-1": {

  },
  "bp-drone-rack-1": {

  },
  "bp-drone-tac-1": {

  },
  "bp-shield-kin-1": {

  },
  "bp-shield-exp-1": {

  },
  "bp-shield-pla-1": {

  },
  "bp-shield-ext-1": {

  },
  "bp-shieldchg-1": {

  },
  "bp-armor-kin-1": {

  },
  "bp-armor-exp-1": {

  },
  "bp-armor-pla-1": {

  },
  "bp-armor-plate-1": {

  },
  "bp-prop-1": {

  },
  "bp-stab-kin-1": {

  },
  "bp-stab-exp-1": {

  },
  "bp-stab-pla-1": {

  },
  "bp-rof-1": {

  },
  "bp-track-1": {

  },
  "bp-gyro-1": {

  },
  "bp-salvager-1": {

  },
  "bp-hullrep-civ": {

  },
  "bp-hullrep-1": {

  },
  "bp-lock-1": {

  },
  "ship-burrower": {

  },
  "core-basic": {

  },
  "mod-miner-2": {

  },
  "mod-cargo-2": {

  },
  "mod-turret-kin-2": {

  },
  "mod-missile-2": {

  },
  "mod-laser-2": {

  },
  "mod-miner-3": {

  },
  "mod-cargo-3": {

  },
  "mod-turret-kin-3": {

  },
  "mod-missile-3": {

  },
  "mod-laser-3": {

  },
  "mod-shield-kin-2": {

  },
  "mod-shield-exp-2": {

  },
  "mod-shield-pla-2": {

  },
  "mod-armor-kin-2": {

  },
  "mod-armor-exp-2": {

  },
  "mod-armor-pla-2": {

  },
  "mod-prop-2": {

  },
  "mod-drone-rack-2": {

  },
  "mod-drone-tac-2": {

  },
  "mod-drone-relay-2": {

  },
  "mod-drone-deck-2": {

  },
  "mod-shield-kin-3": {

  },
  "mod-shield-exp-3": {

  },
  "mod-shield-pla-3": {

  },
  "mod-armor-kin-3": {

  },
  "mod-armor-exp-3": {

  },
  "mod-armor-pla-3": {

  },
  "mod-shield-ext-2": {

  },
  "mod-shieldchg-2": {

  },
  "mod-armor-plate-2": {

  },
  "mod-shield-ext-3": {

  },
  "mod-shieldchg-3": {

  },
  "mod-armor-plate-3": {

  },
  "mod-dc-1": {

  },
  "mod-dc-2": {

  },
  "mod-dc-3": {

  },
  "mod-prop-3": {

  },
  "mod-mwd-1": {

  },
  "bp-mwd-1": {

  },
  "mod-mwd-2": {

  },
  "bp-mwd-2": {

  },
  "mod-drone-rack-3": {

  },
  "mod-drone-tac-3": {

  },
  "mod-drone-relay-3": {

  },
  "mod-drone-deck-3": {

  },
  "mod-drone-shield-2": {

  },
  "mod-drone-shield-3": {

  },
  "mod-stab-kin-1": {

  },
  "mod-stab-exp-1": {

  },
  "mod-stab-pla-1": {

  },
  "mod-rof-1": {

  },
  "mod-track-1": {

  },
  "mod-gyro-1": {

  },
  "mod-hullrep-civ": {

  },
  "mod-stab-kin-2": {

  },
  "mod-stab-exp-2": {

  },
  "mod-stab-pla-2": {

  },
  "mod-rof-2": {

  },
  "mod-track-2": {

  },
  "mod-gyro-2": {

  },
  "mod-stab-kin-3": {

  },
  "mod-stab-exp-3": {

  },
  "mod-stab-pla-3": {

  },
  "mod-rof-3": {

  },
  "mod-track-3": {

  },
  "mod-gyro-3": {

  },
  "mod-warpcomp-2": {

  },
  "mod-warpcomp-3": {

  },
  "mod-cpu-1": {

  },
  "mod-cpu-2": {

  },
  "mod-hullrep-1": {

  },
  "mod-hullrep-2": {

  },
  "mod-lock-1": {

  },
  "mod-lock-2": {

  },
  "mod-lock-3": {

  },
  "mod-stealth-2": {

  },
  "mod-stealth-3": {

  },
  "mod-salvager-1": {

  },
  "mod-salvager-2": {

  },
  "mod-salvager-3": {

  },
  "bp-miner-2": {

  },
  "bp-cargo-2": {

  },
  "bp-turret-2": {

  },
  "bp-miner-3": {

  },
  "bp-cargo-3": {

  },
  "bp-turret-3": {

  },
  "bp-laser-2": {

  },
  "bp-laser-3": {

  },
  "bp-missile-2": {

  },
  "bp-missile-3": {

  },
  "bp-drone-rack-2": {

  },
  "bp-drone-rack-3": {

  },
  "bp-drone-tac-2": {

  },
  "bp-drone-tac-3": {

  },
  "bp-drone-relay-1": {

  },
  "bp-drone-deck-1": {

  },
  "bp-drone-relay-2": {

  },
  "bp-drone-deck-2": {

  },
  "bp-drone-relay-3": {

  },
  "bp-drone-deck-3": {

  },
  "bp-drone-shield-2": {

  },
  "bp-drone-shield-3": {

  },
  "bp-shield-kin-2": {

  },
  "bp-shield-exp-2": {

  },
  "bp-shield-pla-2": {

  },
  "bp-shield-kin-3": {

  },
  "bp-shield-exp-3": {

  },
  "bp-shield-pla-3": {

  },
  "bp-shield-ext-2": {

  },
  "bp-shieldchg-2": {

  },
  "bp-shield-ext-3": {

  },
  "bp-shieldchg-3": {

  },
  "bp-armor-kin-2": {

  },
  "bp-armor-exp-2": {

  },
  "bp-armor-pla-2": {

  },
  "bp-armor-kin-3": {

  },
  "bp-armor-exp-3": {

  },
  "bp-armor-pla-3": {

  },
  "bp-dc-1": {

  },
  "bp-dc-2": {

  },
  "bp-dc-3": {

  },
  "bp-drone-scout": {

  },
  "bp-drone-assault": {

  },
  "bp-drone-heavy": {

  },
  "bp-drone-sentry": {

  },
  "bp-armor-plate-2": {

  },
  "bp-armor-plate-3": {

  },
  "bp-prop-2": {

  },
  "bp-prop-3": {

  },
  "bp-stab-kin-2": {

  },
  "bp-stab-kin-3": {

  },
  "bp-stab-exp-2": {

  },
  "bp-stab-exp-3": {

  },
  "bp-stab-pla-2": {

  },
  "bp-stab-pla-3": {

  },
  "bp-rof-2": {

  },
  "bp-rof-3": {

  },
  "bp-track-2": {

  },
  "bp-track-3": {

  },
  "bp-gyro-2": {

  },
  "bp-gyro-3": {

  },
  "bp-warpcomp-2": {

  },
  "bp-warpcomp-3": {

  },
  "bp-cpu-1": {

  },
  "bp-cpu-2": {

  },
  "bp-salvager-2": {

  },
  "bp-salvager-3": {

  },
  "bp-hullrep-2": {

  },
  "part-drone-neural": {

  },
  "part-shield-gen": {

  },
  "part-jet-array": {

  },
  "part-qchip": {

  },
  "part-keel": {

  },
  "part-fire-control": {

  },
  "part-grav-comp": {

  },
  "bp-part-drone-neural": {

  },
  "bp-part-shield-gen": {

  },
  "bp-part-jet-array": {

  },
  "bp-part-qchip": {

  },
  "bp-part-keel": {

  },
  "bp-part-fire-control": {

  },
  "bp-part-grav-comp": {

  },
  "bp-lock-2": {

  },
  "bp-lock-3": {

  },
  "bp-stealth-2": {

  },
  "bp-stealth-3": {

  },
  "sbp-pioneer": {

  },
  "sbp-humpback": {

  },
  "ship-whale": {

  },
  "ship-pioneer": {

  },
  "ship-humpback": {

  },
  "ship-bowhead": {

  },
  "ship-falconet": {

  },
  "ship-shrike": {

  },
  "ship-tigershark": {

  },
  "ship-mako": {

  },
  "ship-swarm": {

  },
  "ship-tortoise": {

  },
  "ship-hawksbill": {

  },
  "ship-flyingfish": {

  },
  "ship-sailfish": {

  },
  "ship-manatee": {

  },
  "ship-thresher": {

  },
  "ship-electricray": {

  },
  "ship-hammerhead": {

  },
  "ship-bullshark": {

  },
  "ship-nautilus": {

  },
  "ship-whale-king": {

  },
  "sbp-whale-king": {

  },
  "ship-sentinel": {

  },
  "ship-whiteshark": {

  },
  "ship-swordfish": {

  },
  "ship-xuanwu": {

  },
  "ship-megalodon": {

  },
  "ship-colossal": {

  },
  "ship-orca": {

  },
  "ship-helicoprion": {

  },
  "sbp-burrower": {

  },
  "sbp-whale": {

  },
  "sbp-bowhead": {

  },
  "sbp-falconet": {

  },
  "sbp-shrike": {

  },
  "sbp-tigershark": {

  },
  "sbp-mako": {

  },
  "sbp-whiteshark": {

  },
  "sbp-swarm": {

  },
  "sbp-sentinel": {

  },
  "sbp-thresher": {

  },
  "sbp-electricray": {

  },
  "sbp-hammerhead": {

  },
  "sbp-bullshark": {

  },
  "sbp-nautilus": {

  },
  "sbp-tortoise": {

  },
  "sbp-hawksbill": {

  },
  "sbp-xuanwu": {

  },
  "sbp-flyingfish": {

  },
  "sbp-sailfish": {

  },
  "sbp-manatee": {

  },
  "sbp-swordfish": {

  },
  "sbp-megalodon": {

  },
  "sbp-orca": {

  },
  "sbp-helicoprion": {

  },
  "sbp-colossal": {

  },
  "sbp-once-pioneer": {

  },
  "sbp-once-sailfish": {

  },
  "sbp-once-manatee": {

  },
  "sbp-once-sentinel": {

  },
  "sbp-once-hawksbill": {

  },
  "sbp-once-humpback": {

  },
  "sbp-once-thresher": {

  },
  "sbp-once-nautilus": {

  },
  "sbp-once-hammerhead": {

  },
  "sbp-once-whale-king": {

  },
  "sbp-once-bullshark": {

  },
  "sbp-once-electricray": {

  },
  "sbp-once-swordfish": {

  },
  "sbp-once-bowhead": {

  },
  "sbp-once-xuanwu": {

  },
  "sbp-once-megalodon": {

  },
  "sbp-once-orca": {

  },
  "sbp-once-helicoprion": {

  },
  "sbp-once-colossal": {

  },
  "mod-miner-proto": {

  },
  "mod-cargo-proto": {

  },
  "mod-laser-proto": {

  },
  "mod-cpu-3": {

  },
  "core-gamma": {

  },
  "core-beta": {

  },
  "core-alpha": {

  },
}

const MARKET_GOODS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "sbp-wh-a-frigate": {

  },
  "sbp-wh-a-destroyer": {

  },
  "sbp-wh-a-cruiser": {

  },
  "sbp-wh-c-frigate": {

  },
  "sbp-wh-c-destroyer": {

  },
  "sbp-wh-c-cruiser": {

  },
  "sbp-wh-d-frigate": {

  },
  "sbp-wh-d-destroyer": {

  },
  "sbp-wh-d-cruiser": {

  },
  "sbp-wh-e-frigate": {

  },
  "sbp-wh-e-destroyer": {

  },
  "sbp-wh-e-carrier": {

  },
  "sbp-wh-g-frigate": {

  },
  "sbp-wh-g-destroyer": {

  },
  "sbp-wh-g-cruiser": {

  },
  "bp-wh-a-frag": {

  },
  "bp-wh-a-hangar": {

  },
  "bp-wh-a-prop": {

  },
  "bp-wh-a-coat": {

  },
  "bp-wh-a-scan": {

  },
  "bp-wh-a-shield": {

  },
  "bp-wh-c-laser": {

  },
  "bp-wh-c-prism": {

  },
  "bp-wh-c-pulse": {

  },
  "bp-wh-c-missile": {

  },
  "bp-wh-c-frame": {

  },
  "bp-wh-d-turret": {

  },
  "bp-wh-d-shield": {

  },
  "bp-wh-d-lock": {

  },
  "bp-wh-d-laser": {

  },
  "bp-wh-d-loader": {

  },
  "bp-wh-d-steady": {

  },
  "bp-wh-e-dc": {

  },
  "bp-wh-e-tac": {

  },
  "bp-wh-e-cpu": {

  },
  "bp-wh-e-pd": {

  },
  "bp-wh-e-shield": {

  },
  "bp-wh-g-hangar": {

  },
  "bp-wh-g-fcs": {

  },
  "bp-wh-g-ballistic": {

  },
  "bp-wh-g-hull": {

  },
  "bp-wh-g-turret": {

  },
  "bp-wh-g-prop": {

  },
  "mod-wh-a-frag": {

  },
  "mod-wh-a-hangar": {

  },
  "mod-wh-a-prop": {

  },
  "mod-wh-a-coat": {

  },
  "mod-wh-a-scan": {

  },
  "mod-wh-a-shield": {

  },
  "mod-wh-c-laser": {

  },
  "mod-wh-c-prism": {

  },
  "mod-wh-c-pulse": {

  },
  "mod-wh-c-missile": {

  },
  "mod-wh-c-frame": {

  },
  "mod-wh-d-turret": {

  },
  "mod-wh-d-shield": {

  },
  "mod-wh-d-lock": {

  },
  "mod-wh-d-laser": {

  },
  "mod-wh-d-loader": {

  },
  "mod-wh-d-steady": {

  },
  "mod-wh-e-dc": {

  },
  "mod-wh-e-tac": {

  },
  "mod-wh-e-cpu": {

  },
  "mod-wh-e-pd": {

  },
  "mod-wh-e-shield": {

  },
  "mod-wh-g-hangar": {

  },
  "mod-wh-g-fcs": {

  },
  "mod-wh-g-ballistic": {

  },
  "mod-wh-g-hull": {

  },
  "mod-wh-g-turret": {

  },
  "mod-wh-g-prop": {

  },
  "mod-shieldfield-2": {

  },
  "mod-shieldfield-3": {

  },
  "bp-shieldfield-2": {

  },
  "bp-shieldfield-3": {

  },
  "sh-wh-a-frigate": {

  },
  "sh-wh-a-destroyer": {

  },
  "sh-wh-a-cruiser": {

  },
  "sh-wh-c-frigate": {

  },
  "sh-wh-c-destroyer": {

  },
  "sh-wh-c-cruiser": {

  },
  "sh-wh-d-frigate": {

  },
  "sh-wh-d-destroyer": {

  },
  "sh-wh-d-cruiser": {

  },
  "sh-wh-e-frigate": {

  },
  "sh-wh-e-destroyer": {

  },
  "sh-wh-e-carrier": {

  },
  "sh-wh-g-frigate": {

  },
  "sh-wh-g-destroyer": {

  },
  "sh-wh-g-cruiser": {

  },
  "mod-lair-turret-a": {

  },
  "mod-lair-missile-a": {

  },
  "mod-lair-cargo-a": {

  },
  "mod-lair-armor-c": {

  },
  "mod-lair-dc-c": {

  },
  "mod-lair-laser-c": {

  },
  "mod-lair-shield-d": {

  },
  "mod-lair-turret-d": {

  },
  "mod-lair-armor-d": {

  },
  "mod-lair-turret-e": {

  },
  "mod-lair-hangar-e": {

  },
  "mod-lair-frame-e": {

  },
  "mod-lair-drone-tac-g": {

  },
  "mod-lair-drone-relay-g": {

  },
  "mod-lair-ecm-h": {

  },
  "mod-lair-web-h": {

  },
  "mod-lair-laser-r": {

  },
  "mod-lair-blink-r": {

  },
  "mod-lair-beam-r": {

  },
  "mod-lair-pd-r": {

  },
  "drone-exile-bee": {

  },
  "drone-wh-c-heavy": {

  },
  "drone-wh-e-sentry": {

  },
  "drone-ink-heavy": {

  },
  'drone-jawclaw': {},
  'bp-faction-drone-bee': {},
  'bp-faction-drone-hiveguard': {},
  'bp-faction-drone-construct': {},
  'bp-faction-drone-ink': {},
  'bp-faction-drone-jawclaw': {},
  "bp-lair-g-drone": {

  },
  "bp-wh-c-drone": {

  },
  "bp-wh-e-drone": {

  },
  "mod-mwd-3": {

  },
  "bp-mwd-3": {

  },
}

import type { MarketGoodDef } from '@whale/core'
import { rarityTierOf } from './rarityTier' // 2026-09-09 数字稀有度表（物品本体属性，市场调用）
import { BLACK_MARKET_EXCLUSIVE_REFS } from './blackMarketGoods'
import { wreckItemIdOf, WRECK_GROUPS } from '@whale/core'

export const MARKET_GOODS_RAW: readonly MarketGoodDef[] = [
  ...staticDataGroup<MarketGoodDef>(staticDocument as unknown as DataDocument, 'MARKET_GOODS_RAW_0', MARKET_GOODS_RAW_0_TEXT_BINDINGS),
]

/**
 * P2 抽取节拍制闸内商品（2026-09-06 船长定：声望 11 前以低权重（0.04）参与每 10 分钟 rare
 * 加权抽取、命中即 ×4 价暗市单可绕过买入；解锁后恢复正常权重与价格、不转常驻）。
 * 范围 = MK3 战斗件 19 件（武器三族/无人机架·导控/盾·甲抗容/支援件；剔除生产件 miner·cargo·salvager
 * 与机动 prop）+ 动能 MK3 蓝图书（自制渠道同闸，防绕过）。
 * 原型（proto）与顶船维持原 standingReq 纯硬拦，不加暗市。
 */
const BM_MK3_KEYS = new Set([
  'mod-drone-launch-3', 'bp-drone-launch-3', 'mod-laser-calibration-3', 'bp-laser-calibration-3',
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
  'bp-shieldchg-3',
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
  // 2026-09-14 跃迁计算机 MK3（+ 其蓝图）：按"**同槽支援件**"归入闸内（与 stab/rof/track/gyro 同列）。
  // ⚠ 它**不提升战斗力**（只缩短星系际航行时间）——与"机动 prop 剔出闸"那条理由相反；
  //   若船长要按 prop/MWD 口径放它出闸，删这两行即可（其余一行都不用动）。
  'mod-warpcomp-3',
  'bp-warpcomp-3',
  'bp-hullrep-2',
])

/* ═══════════ 残骸收购卡（2026-09-08 船长定：残骸可到市场出售，单独分类；只收不卖） ═══════════
 * - 收价按残骸**组档位**（常/险/危，与精炼炉「残骸回收」档一致）：30 / 40 / 50 信用点·m³。
 *   锚定口径（2026-09-08 修正）：三档无技能拆解保底均 ≈57/m³（Y×池均价反推齐平）——
 *   卖价必须**严格低于 57**（任何档直接卖都不如拆解），同时对"该档典型特色回收（含 m）"
 *   ≈ 50% 上下（常 60 / 险 71 / 危 97 估算 → 30/40/50 ≈ 50%/56%/52%）——拆解 + 彩头 + 碎片 +
 *   技能(×1.75) 仍明显更赚，卖站 = 折价清仓/应急通道；档位梯度保留（越危险卖价越高）；
 * - playerBuyable = false（只收不卖）：NPC 只挂收购单、不出售残骸（防"低价买残骸→拆解套利"）；
 * - 每单位 = 1 m³（残骸乙案记账：计数即体积）。
 *
 * ⚠ **2026-09-19 残骸合并**：收购卡从"每卡一张"（23 张）并为**每组一张**（13 组）——
 * 其中**洞内 5 组维持"无市场行"**（合并前洞内 15 张卡都是隐藏卡、本就没有收购行 ⇒ 逐字不变），
 * 故本表实际 **8 行**（`b-hi` 在列：B 族卡的残骸照样能卖）。
 */
/**
 * 残骸站内收价（信用点/m³；档位 = 组档位：常 30 / 险 40 / 危 50）
 *
 * ⚠ **2026-09-28 船长定：这条渠道只作"清理零星残骸"用，任何经济读数都不得把它算成收入**——
 * 船长原话（照抄）：「**所有残骸的价值都不统计将残骸直接销售到市场
 * （因为那个仅仅是作为玩家清理零星残骸用的）**」。
 *
 * 口径对照（满技能·残骸提纯学 5 后的回收炉产出 vs 本行的直销价）：
 * 常 **40.06** vs 30（直销 = 75%）· 险 **80.06** vs 40（50%）· 危 **120.11** vs 50（42%）
 * ⇒ 直接卖残骸**恒劣于**送回收炉，且档位越高差得越多（三档 1:2:3 之后差距拉开）。
 * 经济工具一律走 `wormholeWreckRecycleIskPerM3` / 回收炉口径，**不读本表**。
 */
const WRECK_BUY_PRICE = { common: 30, risky: 40, dire: 50 } as const

export const WRECK_BUY_GOODS: readonly MarketGoodDef[] = WRECK_GROUPS.filter((g) => g.region !== 'wh').map((g) => {
  const id = wreckItemIdOf(g.key)
  return {
    key: id,
    kind: 'item',
    refId: id,
    rarity: 'common',
    basePrice: WRECK_BUY_PRICE[g.tier],
    poolTarget: 30_000,
    supplyFlow: 500,
    playerBuyable: false, // 只收不卖：空间站回收站不出售残骸
  }
})

export const MARKET_GOODS: readonly MarketGoodDef[] = [
  ...MARKET_GOODS_RAW.map((g) => (BM_MK3_KEYS.has(g.key) ? { ...g, bmStanding: 11 } : g)),
  ...WRECK_BUY_GOODS,
  ...staticDataGroup<MarketGoodDef>(staticDocument as unknown as DataDocument, 'MARKET_GOODS_0', MARKET_GOODS_0_TEXT_BINDINGS),
  ...([
    'plug-shield-plate', 'plug-armor-plate', 'plug-hull-plate', 'plug-mid-bay', 'plug-low-bay', 'plug-cpu-core',
    'plug-firepower', 'plug-sight', 'plug-thruster', 'plug-rangefinder', 'plug-target-beacon', 'plug-concealment',
  ] as const).map((id) => ({
    key: id,
    kind: 'module' as const,
    refId: id,
    rarity: 'exotic' as const,
    basePrice: 0,
    demandMultiplier: 0,
    playerBuyable: false,
    unreleased: true,
  })),
  ...([
    'bp-plug-shield-plate', 'bp-plug-armor-plate', 'bp-plug-hull-plate', 'bp-plug-mid-bay', 'bp-plug-low-bay',
    'bp-plug-cpu-core', 'bp-plug-firepower', 'bp-plug-sight', 'bp-plug-thruster', 'bp-plug-rangefinder',
    'bp-plug-target-beacon', 'bp-plug-concealment'
  ] as const).map((id) => ({
    key: id,
    kind: 'blueprint' as const,
    refId: id,
    rarity: 'exotic' as const,
    basePrice: 0,
    demandMultiplier: 0,
    playerBuyable: false,
    unreleased: true,
  })),
]

/** 构建市场商品目录（数字稀有度按物品表 RARITY_TIER 填充——2026-09-09 船长拍板：
 * 稀有度入物品本体，市场调用；与渠道 rarity 分离，只驱动稀有订单渠道刷新权重）
 *
 * ⚠ **未上线商品在这里被挡掉**（2026-09-12 船长：「所有虫洞相关的内容需要等虫洞落地后才统一对玩家可见」）：
 * `unreleased: true` 的卡**不进本目录** ⇒ `ctx.marketGoods` 里没有它 ⇒ 市场页/挂单/订单/任务/事件
 * 一律看不到也交易不到；而它在 `MARKET_GOODS`（目录表）里，**契约照核**（`content:check` 用该表）。
 * 上线时把卡上的 `unreleased` 删掉即可。 */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.filter((g) => g.unreleased !== true).map((g) => [g.key, {
    ...g, rarityTier: rarityTierOf(g.refId),
    ...(g.playerBuyable === false && BLACK_MARKET_EXCLUSIVE_REFS.has(g.refId) ? { blackMarketBuyable: true } : {}),
  }]))
}
