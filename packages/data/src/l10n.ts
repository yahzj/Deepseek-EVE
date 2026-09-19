/**
 * **英文覆盖层（P2）** · 2026-09-19 船长令「希望对游戏进行英语本地化处理」。
 *
 * 口径：`docs/glossary-en.md`（术语与专名权威；本文件只放**已冻结**的译名，不即兴造词）。
 * 做法：**按 id 索引的覆盖表 + `localizeCtx(ctx, locale)`** —— 只覆盖 `name / description`，
 * **id 与一切数值一字不动**；`locale === 'zh'` 时**原样返回同一个 ctx**（零拷贝 ⇒ 工具 / 测试 /
 * 模拟的既有读数逐字不变）。
 *
 * 为什么不在调用点翻译：界面取名字基本都读 `ctx.<表>.get(id)!.name`（上千处），覆盖层让这些点
 * **一行都不用改**——架构取舍见 `docs/design/l10n-en-20260919.md`。
 *
 * 分批：本批 = **舰船 43 条（名称）**；装备 / 物品 / 技能 / 蓝图 / 异常点 / 敌舰的名字与短说明按
 * P2 后续批次追加（`localizeCtx` 里没登记的目录 ⇒ 原样中文）。
 * ⚠ 覆盖表里的 id 必须真实存在于内容表 —— `packages/core/tests/l10n-overlay.test.ts` 钉住这条。
 */
import type { SimContext } from '@whale/core'
import { BLUEPRINTS } from './blueprints'
import { SHIP_BLUEPRINTS } from './shipBlueprints'

export type Locale = 'zh' | 'en'

/** 一条覆盖：只许覆盖这两个字段（name / description），其余字段不许在此出现 */
export interface EnText {
  readonly name?: string
  readonly description?: string
}

export type EnTable = Readonly<Record<string, EnText>>

/** 舰船（43 · `docs/glossary-en.md` §四；**名称 + 说明**。说明逐条译自中文原文，括号里的规格照留） */
export const EN_SHIPS: EnTable = {
  // ── 采矿 / 工业 / 货运
  sandcat: {
    name: 'Sandcat-class Mining Corvette',
    description: 'The starter mining boat: basic hold and a single mining laser. Your first ship — and, for now, your only one.',
  },
  burrower: {
    name: 'Burrower-class Mining Corvette',
    description: 'A larger hold and twin mining lasers — nearly double the output. The mark of graduating from the starter grounds.',
  },
  whale: {
    name: 'Whaleswallow-class Mining Corvette',
    description: 'A deep-space industrial beast: four mining lasers strip half an asteroid in one pass. The name fits.',
  },
  pioneer: {
    name: 'Pioneer-class Mining Corvette',
    description: "The Association shipyard's custom boat: not for sale — build it on your own pad from raw materials. A step faster than the Whaleswallow-class.",
  },
  'whale-king': {
    name: 'Whaleking-class Mining Corvette',
    description: 'The peak of deep-space industry: double the Whaleswallow-class output. A heavy-tungsten devourer, and the longest-term material goal in the game.',
  },
  'sh-humpback': {
    name: 'Humpback-class Mining Ship',
    description: 'The third-generation Leviathan mining ship: a freighter-grade hold with another step up in output.',
  },
  'sh-bowhead': {
    name: 'Manta-class Heavy Freighter',
    description: 'A heavy freighter assembled by the Leviathan yards: over 26,000 m³ of hold — the backbone of offline stockpiling and long hauls.',
  },
  'sh-colossal': {
    name: 'Oarfish-class Flagship Freighter',
    description: 'The flagship freighter of the Leviathan yards: 108,000 m³ of hold — a mobile fortress of deep-space logistics.',
  },
  'sh-flyingfish': {
    name: 'Flyingfish-class Courier',
    description: 'A courier: hold space and combat ability traded away for high-speed warping. The entry choice for small-scale stockpiling.',
  },
  'sh-sailfish': {
    name: 'Sailfish-class Fast Freighter',
    description: 'A fast freighter: 8,500 m³ of hold while still warping at speed.',
  },
  'sh-swordfish': {
    name: 'Swordfish-class Heavy Freighter',
    description: "Mirage Shipping's flagship freighter: 14,000 m³ of capacity — the trader's ultimate dream.",
  },
  // ── 武装舰
  'sh-falconet': {
    name: 'Skipjack-class Frigate',
    description: 'The Association training gunship: poor at mining but startlingly quick — already a nimble ride for low-risk expeditions.',
  },
  'sh-shrike': {
    name: 'Mackerel-class Frigate',
    description: "The Predator armament division's standard frigate: high mobility, low yield — a fine escort for AI auxiliaries.",
  },
  'sh-tigershark': {
    name: 'Tigershark-class Armed Frigate',
    description: 'A heavier armed frigate: a stronger firepower frame, and a familiar sight on deep-space escort duty.',
  },
  'sh-mako': {
    name: 'Mako-class Destroyer',
    description: "A large destroyer: the backbone hull of the Association's armed forces.",
  },
  'sh-whiteshark': {
    name: 'Whiteshark-class Gunboat',
    description: 'A top-tier gunboat: a symbol of both reputation and capability.',
  },
  'sh-swarm': {
    name: 'Barracuda-class Drone Frigate',
    description: "The Predator armament division's drone frigate: a large drone nest that launches swarms to back up thin gun batteries.",
  },
  'sh-sentinel': {
    name: 'Kingfish-class Drone Carrier',
    description: "A drone carrier custom-built by the Predator armament division: double the nest and ample fitting space — the peak platform for drone power.",
  },
  'sh-thresher': {
    name: 'Thresher-class Missile Cruiser',
    description: 'A new-generation missile cruiser of the Predator armament division: a long-range hunter named for its tail, opening with a missile salvo. The hull is tuned for missile arrays — explosive ammo gains extra damage.',
  },
  'sh-electricray': {
    name: 'Electricray-class Laser Cruiser',
    description: 'A beam cruiser of the Predator armament division: laser arrays like high-voltage arcs that burn through shields on contact. The hull is tuned for beam focusing — energy weapons gain extra damage.',
  },
  'sh-hammerhead': {
    name: 'Hammerhead-class Gunnery Cruiser',
    description: "The Predator armament division's gunnery mainstay: the core of heavy kinetic broadsides and the fleet's long spear in deep-space hunts. The hull is tuned for kinetic batteries — kinetic weapons gain extra damage.",
  },
  'sh-bullshark': {
    name: 'Bullshark-class Assault Cruiser',
    description: "The Predator armament division's fiercest biter: an assault cruiser of thick shields and heavy guns, built for point-blank brawls. The hull is tuned for kinetic batteries — kinetic weapons gain extra damage.",
  },
  'sh-nautilus': {
    name: 'Nautilus-class Survey Cruiser',
    description: 'An Association survey cruiser: joining a wormhole fleet widens scan range by one ring (multiple ships stack).',
  },
  // ── 重装 / 旗舰
  'sh-tortoise': {
    name: 'Tortoise-class Heavy Corvette',
    description: 'A slow, steady armored transport: a big hold and a thick hide.',
  },
  'sh-hawksbill': {
    name: 'Hawksbill-class Heavy Cruiser',
    description: 'A heavy cruiser: a mobile warehouse in thick shell — a reliable partner for long offline operations.',
  },
  'sh-xuanwu': {
    name: 'Leatherback-class Heavy Flagship',
    description: 'The apex of the heavy line: said to be forged from the rocky shell of an entire asteroid.',
  },
  'sh-megalodon': {
    name: 'Megalodon-class Battleship',
    description: 'A battleship named for a prehistoric giant: a front-line damage sponge and fire platform. Three thick HP layers and generous fitting space let it stand at the head of the formation — at the cost of slow turns and slow starts.',
  },
  'sh-dunkleosteus': {
    name: 'Dunkleosteus-class Flagship',
    description: "The fleet's apex: damage soaking, firepower and fitting space all above its generation — as are its price and build time. It sets the pace of the whole formation: when it is slow, everyone waits.",
  },
  // ── 虫洞族舰（敌舰模板名，不带 -class）
  'sh-wh-a-frigate': {
    name: 'Raider EW Frigate',
    description: 'A pirate electronic-warfare boat: strong in fire control and evasion — it locks first, hits first, and is harder to pin. Joining a wormhole fleet widens scan range by one ring (multiple ships stack).',
  },
  'sh-wh-a-destroyer': {
    name: 'Raider Gunboat',
    description: 'A pirate gunboat: kinetic batteries stretch kinetic weapon range by a further 30% — open fire from beyond reach. Cramped holds, and shields give way to armor.',
  },
  'sh-wh-a-cruiser': {
    name: 'Raider Heavy Assault Cruiser',
    description: 'A pirate heavy assault cruiser: all three resistances covered and another 10% more HP, built to crack hard targets. No extra firepower bonus; the cost is slow turns and a small hold.',
  },
  'sh-wh-c-frigate': {
    name: 'Larva Interceptor',
    description: 'A living interceptor of the hive: impossibly fast, hunting stragglers. Shields are barely there — a carapace and a frame hold it together.',
  },
  'sh-wh-c-destroyer': {
    name: 'Carapace Interceptor',
    description: 'A living interceptor of the hive: speed and agility maxed for slash-in, slash-out runs. Shields are paper-thin; armor and hull take every hit.',
  },
  'sh-wh-c-cruiser': {
    name: 'Hiveswarm Heavy Assault Cruiser',
    description: 'A heavy assault cruiser of the hive: all three resistances covered and another 10% more carapace, made for head-on collisions. No extra firepower bonus, and it turns very slowly.',
  },
  'sh-wh-d-frigate': {
    name: 'Sentry EW Frigate',
    description: 'A mausoleum electronic sentry: thick shields over thin armor, with fire control and evasion both raised to open fire before the fleet. Joining a wormhole fleet widens scan range by one ring (multiple ships stack).',
  },
  'sh-wh-d-destroyer': {
    name: 'Tombwarden Command Ship',
    description: "A mausoleum command ship: shield-heavy, and it adds 15% to the whole formation's single-shot damage — multiple command ships take the highest only, no stacking. The price is thin armor and hull: once the shield drops, it is fragile.",
  },
  'sh-wh-d-cruiser': {
    name: 'Mausoleum Cruiser',
    description: 'A mausoleum heavy cruiser: thick shields over thin armor, the most gun mounts and the largest hold — holding the center of the line on shields and resistances.',
  },
  'sh-wh-e-frigate': {
    name: 'Construct Torpedo Frigate',
    description: 'A megastructure torpedo ship: explosive warheads strip armor and hit solidly. A big signature and clumsy turns mean it needs allies in front.',
  },
  'sh-wh-e-destroyer': {
    name: 'Hangar Drone Combat Ship',
    description: 'A megastructure drone combat ship: a big nest and strong swarms — a mobile hangar for long drone sorties. Hold space and its own guns both give way to the swarm.',
  },
  'sh-wh-e-carrier': {
    name: 'Megastructure Drone Combat Ship',
    description: 'A megastructure drone combat ship: the largest nest and the highest drone damage in the game — launching is its main weapon. Hold space goes to the hangar, and its own guns are supporting only.',
  },
  'sh-wh-g-frigate': {
    name: 'Wraith Scout Frigate',
    description: 'A deadarmy scout: very high evasion with solid fire control. Joining a wormhole fleet widens scan range by one ring (multiple ships stack) — it is the one that sees the others first.',
  },
  'sh-wh-g-destroyer': {
    name: 'Deadarmy Logistics Ship',
    description: 'A deadarmy logistics ship: the largest hold and drone nest, following the formation to resupply and swap drones. Its guns are for self-defense only.',
  },
  'sh-wh-g-cruiser': {
    name: 'Deadarmy Torpedo Cruiser',
    description: 'A deadarmy torpedo ship: explosive warheads with solid accuracy, aimed at the armor of big targets. A big signature and slow turns make it an open hammer.',
  },
}

/**
 * 装备（142 · `docs/glossary-en.md` §十二；分「采集/货舱 · 武器 · 无人机件 · 护盾/装甲 · 推进/支援/维修/隐秘 ·
 * 窝点专属 · 虫洞族专属」七组，逐条与中文表对齐——完整性由用例按 id 集合比对钉住）。
 */
export const EN_MODULES: EnTable = {
  // 采集 / 货舱
  'mod-miner-civ': { name: 'Civilian Mining Laser' },
  'mod-miner-1': { name: 'Reinforced Mining Laser MK1' },
  'mod-miner-2': { name: 'Reinforced Mining Laser MK2' },
  'mod-miner-3': { name: 'Precision Mining Laser MK3' },
  'mod-miner-proto': { name: 'Alien Prototype Mining Laser' },
  'mod-cargo-civ': { name: 'Civilian Cargo Expander' },
  'mod-cargo-1': { name: 'Cargo Expander MK1' },
  'mod-cargo-2': { name: 'Cargo Expander MK2' },
  'mod-cargo-3': { name: 'Folding Cargo Expander MK3' },
  'mod-cargo-proto': { name: 'Alien Prototype Cargo Hold' },
  // 武器
  'mod-turret-civ': { name: 'Civilian Cannon' },
  'mod-turret-kin-1': { name: 'Light Turret MK1 · Kinetic' },
  'mod-turret-kin-2': { name: 'Heavy Turret MK2 · Kinetic' },
  'mod-turret-kin-3': { name: 'Siege Turret MK3 · Kinetic' },
  'mod-pd-e': { name: 'Point Defense Gun MK1' },
  'mod-pd-e-2': { name: 'Point Defense Gun MK2' },
  'mod-pd-e-3': { name: 'Point Defense Gun MK3' },
  'mod-laser-1': { name: 'Light Laser Cannon MK1' },
  'mod-laser-2': { name: 'Heavy Laser Cannon MK2' },
  'mod-laser-3': { name: 'Siege Laser Cannon MK3' },
  'mod-laser-proto': { name: 'Alien Prototype Laser Cannon' },
  'mod-missile-1': { name: 'Light Missile Launcher MK1' },
  'mod-missile-2': { name: 'Heavy Missile Launcher MK2' },
  'mod-missile-3': { name: 'Cruise Missile Launcher MK3' },
  // 无人机件
  'mod-drone-rack-1': { name: 'Drone Deck Expansion MK1' },
  'mod-drone-rack-2': { name: 'Drone Deck Expansion MK2' },
  'mod-drone-rack-3': { name: 'Drone Deck Expansion MK3' },
  'mod-drone-tac-1': { name: 'Tactical Control Array MK1' },
  'mod-drone-tac-2': { name: 'Tactical Control Array MK2' },
  'mod-drone-tac-3': { name: 'Tactical Control Array MK3' },
  'mod-drone-relay-1': { name: 'Drone Relay Antenna MK1' },
  'mod-drone-relay-2': { name: 'Drone Relay Antenna MK2' },
  'mod-drone-relay-3': { name: 'Drone Relay Antenna MK3' },
  // 护盾 / 装甲
  'mod-shield-kin-1': { name: 'Shield Amplifier MK1 · Kinetic' },
  'mod-shield-exp-1': { name: 'Shield Amplifier MK1 · Explosive' },
  'mod-shield-pla-1': { name: 'Shield Amplifier MK1 · Energy' },
  'mod-shield-kin-2': { name: 'Shield Amplifier MK2 · Kinetic' },
  'mod-shield-exp-2': { name: 'Shield Amplifier MK2 · Explosive' },
  'mod-shield-pla-2': { name: 'Shield Amplifier MK2 · Energy' },
  'mod-shield-kin-3': { name: 'Shield Amplifier MK3 · Kinetic' },
  'mod-shield-exp-3': { name: 'Shield Amplifier MK3 · Explosive' },
  'mod-shield-pla-3': { name: 'Shield Amplifier MK3 · Energy' },
  'mod-shield-ext-1': { name: 'Shield Extender MK1' },
  'mod-shield-ext-2': { name: 'Shield Extender MK2' },
  'mod-shield-ext-3': { name: 'Shield Extender MK3' },
  'mod-shieldchg-1': { name: 'Shield Recharger MK1' },
  'mod-shieldchg-2': { name: 'Shield Recharger MK2' },
  'mod-shieldchg-3': { name: 'Shield Recharger MK3' },
  'mod-armor-kin-1': { name: 'Armor Plating MK1 · Kinetic' },
  'mod-armor-exp-1': { name: 'Armor Plating MK1 · Explosive' },
  'mod-armor-pla-1': { name: 'Armor Plating MK1 · Energy' },
  'mod-armor-kin-2': { name: 'Armor Plating MK2 · Kinetic' },
  'mod-armor-exp-2': { name: 'Armor Plating MK2 · Explosive' },
  'mod-armor-pla-2': { name: 'Armor Plating MK2 · Energy' },
  'mod-armor-kin-3': { name: 'Armor Plating MK3 · Kinetic' },
  'mod-armor-exp-3': { name: 'Armor Plating MK3 · Explosive' },
  'mod-armor-pla-3': { name: 'Armor Plating MK3 · Energy' },
  'mod-armor-plate-1': { name: 'Armor Thickening Plate MK1' },
  'mod-armor-plate-2': { name: 'Armor Thickening Plate MK2' },
  'mod-armor-plate-3': { name: 'Armor Thickening Plate MK3' },
  // 推进 / 支援 / 维修 / 隐秘
  'mod-prop-1': { name: 'Vector Thruster MK1' },
  'mod-prop-2': { name: 'Vector Thruster MK2' },
  'mod-prop-3': { name: 'Vector Thruster MK3' },
  'mod-mwd-1': { name: 'Micro Warp Drive MK1' },
  'mod-mwd-2': { name: 'Micro Warp Drive MK2' },
  'mod-mwd-3': { name: 'Micro Warp Drive MK3' },
  'mod-stab-kin-1': { name: 'Kinetic Stabilizer MK1' },
  'mod-stab-kin-2': { name: 'Kinetic Stabilizer MK2' },
  'mod-stab-kin-3': { name: 'Kinetic Stabilizer MK3' },
  'mod-stab-exp-1': { name: 'Explosive Stabilizer MK1' },
  'mod-stab-exp-2': { name: 'Explosive Stabilizer MK2' },
  'mod-stab-exp-3': { name: 'Explosive Stabilizer MK3' },
  'mod-stab-pla-1': { name: 'Plasma Stabilizer MK1' },
  'mod-stab-pla-2': { name: 'Plasma Stabilizer MK2' },
  'mod-stab-pla-3': { name: 'Plasma Stabilizer MK3' },
  'mod-rof-1': { name: 'Rate-of-Fire Computer MK1' },
  'mod-rof-2': { name: 'Rate-of-Fire Computer MK2' },
  'mod-rof-3': { name: 'Rate-of-Fire Computer MK3' },
  'mod-warpcomp-2': { name: 'Warp Computer MK2' },
  'mod-warpcomp-3': { name: 'Warp Computer MK3' },
  'mod-track-1': { name: 'Tracking Array MK1' },
  'mod-track-2': { name: 'Tracking Array MK2' },
  'mod-track-3': { name: 'Tracking Array MK3' },
  'mod-gyro-1': { name: 'Attitude Gyro MK1' },
  'mod-gyro-2': { name: 'Attitude Gyro MK2' },
  'mod-gyro-3': { name: 'Attitude Gyro MK3' },
  'mod-cpu-1': { name: 'Coprocessor MK1' },
  'mod-cpu-2': { name: 'Coprocessor MK2' },
  'mod-cpu-3': { name: 'Coprocessor MK3' },
  'mod-salvager-1': { name: 'Salvager MK1' },
  'mod-salvager-2': { name: 'Salvager MK2' },
  'mod-salvager-3': { name: 'Salvager MK3' },
  'mod-hullrep-civ': { name: 'Civilian Hull Repair Unit' },
  'mod-hullrep-1': { name: 'Hull Repair Unit MK1' },
  'mod-hullrep-2': { name: 'Hull Repair Unit MK2' },
  'mod-lock-1': { name: 'Target Lock Array MK1' },
  'mod-lock-2': { name: 'Target Lock Array MK2' },
  'mod-lock-3': { name: 'Target Lock Array MK3' },
  'mod-stealth-2': { name: 'Stealth Module MK2' },
  'mod-stealth-3': { name: 'Stealth Module MK3' },
  // 窝点专属（lair）
  'mod-lair-turret-a': { name: 'Raider Gatling Cannon' },
  'mod-lair-missile-a': { name: 'Raider Missile Nest' },
  'mod-lair-cargo-a': { name: 'Spoils Reinforcement Bay' },
  'mod-lair-armor-c': { name: 'Bio Carapace Plate' },
  'mod-lair-dc-c': { name: 'Bio Damage Control Chamber' },
  'mod-lair-laser-c': { name: 'Acid Sprayer' },
  'mod-lair-shield-d': { name: 'Mausoleum Shield Array' },
  'mod-lair-turret-d': { name: 'Gravekeeper Long Cannon' },
  'mod-lair-armor-d': { name: 'Mausoleum Armor Layer' },
  'mod-lair-turret-e': { name: 'Megastructure Wreck Cannon' },
  'mod-lair-hangar-e': { name: 'Deep Hangar' },
  'mod-lair-frame-e': { name: 'Megastructure Frame' },
  'mod-lair-drone-tac-g': { name: 'Squidwasp Swarm Control' },
  'mod-lair-drone-relay-g': { name: 'Exile Relay Mast' },
  // 虫洞族专属（mod-wh-*）
  'mod-wh-a-frag': { name: 'Raider Fragment Cannon' },
  'mod-wh-a-hangar': { name: 'Raider Hangar' },
  'mod-wh-a-prop': { name: 'Raider Afterburner' },
  'mod-wh-a-coat': { name: 'Raider Refraction Coating' },
  'mod-wh-a-scan': { name: 'Spoils Scan Array' },
  'mod-wh-a-shield': { name: 'Raider Shield Cage' },
  'mod-wh-c-laser': { name: 'Bio Prism Beam' },
  'mod-wh-c-prism': { name: 'Carapace Prism Layer' },
  'mod-wh-c-pulse': { name: 'Bio Pulse Accelerator' },
  'mod-wh-c-missile': { name: 'Spore Missile Nest' },
  'mod-wh-c-frame': { name: 'Chitin Frame Layer' },
  'mod-wh-d-turret': { name: 'Tombwarden Linked Cannon' },
  'mod-wh-d-shield': { name: 'Mausoleum Shield Core' },
  'mod-wh-d-lock': { name: 'Gravekeeper Death Knell' },
  'mod-wh-d-laser': { name: 'Mausoleum Prism Cannon' },
  'mod-wh-d-loader': { name: 'Gravekeeper Rapid Loader' },
  'mod-wh-d-steady': { name: 'Mausoleum Ballistic Inscription' },
  'mod-wh-e-dc': { name: 'Megastructure Damage Control Array' },
  'mod-wh-e-tac': { name: 'Megastructure Control Tower' },
  'mod-wh-e-cpu': { name: 'Megastructure Coprocessor' },
  'mod-wh-e-pd': { name: 'Megastructure Point Defense Array' },
  'mod-wh-e-shield': { name: 'Megastructure Shield Matrix' },
  'mod-wh-g-hangar': { name: 'Deadarmy Hive Dock' },
  'mod-wh-g-fcs': { name: 'Deadarmy Fire Control' },
  'mod-wh-g-ballistic': { name: 'Wraith Ballistic Corrector' },
  'mod-wh-g-hull': { name: 'Squidwasp Hull Layer' },
  'mod-wh-g-turret': { name: 'Deadarmy Wreck Cannon' },
  'mod-wh-g-prop': { name: 'Wraith Thruster' },
}

/** 物品（86 · `docs/glossary-en.md` §八：矿 / 材料 / 气 / 冰 / 弹药 / 无人机 / 修理组件 / 谜质装置 / 货柜 / 奢侈品 / AI 核心） */
export const EN_ITEMS: EnTable = {
  // 原矿
  'ore-veldspar': { name: 'Peridotite' },
  'ore-scorched': { name: 'Gabbro' },
  'ore-hemorphite': { name: 'Redring Ore' },
  'ore-glowstone': { name: 'Glowcloud Ore' },
  'ore-sunshard': { name: 'Dawnshard Crystal' },
  'ore-voidshard': { name: 'Voidcrystal' },
  'ore-nebulite': { name: 'Starwraith Ore' },
  'ore-voidmother': { name: 'Voidmother Ore' },
  // 精炼产物
  'min-tritanium': { name: 'Tritanium Alloy' },
  'min-pyerite': { name: 'Silvervein Supermetal' },
  'min-mexallon': { name: 'Crystalline Colloid' },
  'min-nocxium': { name: 'Heavy Tungsten Alloy' },
  'min-isotope': { name: 'Isotope Polycrystal' },
  'min-starcore': { name: 'Starcore Crystal' },
  'min-darkiron': { name: 'Darkiron Alloy' },
  'min-voidcrystal': { name: 'Void Crystal' },
  // 气体 / 冰矿
  'gas-neon': { name: 'Neon Cloud Gas' },
  'gas-phosphor': { name: 'Phosphor Haze' },
  'gas-ionstorm': { name: 'Ionstorm Cloud' },
  'gas-aurora': { name: 'Aurora Cloud' },
  'ice-frost': { name: 'Bluefrost Ice' },
  'ice-marrow': { name: 'Frostmarrow Ice' },
  'ice-darkstar': { name: 'Darkstar Ice' },
  // 弹药
  'ammo-kinetic-l': { name: 'Kinetic Ammo' },
  'ammo-explosive-l': { name: 'Explosive Ammo' },
  'ammo-plasma-l': { name: 'Energy Ammo' },
  'ammo-kinetic-2': { name: 'Kinetic Ammo MK2' },
  'ammo-explosive-2': { name: 'Explosive Ammo MK2' },
  'ammo-plasma-2': { name: 'Energy Ammo MK2' },
  // 无人机
  'drone-scout': { name: 'Hummingbird Scout Drone' },
  'drone-assault': { name: 'Redkite Combat Drone' },
  'drone-heavy': { name: 'Falcon Siege Drone' },
  'drone-sentry': { name: 'Thundergull Sentry Drone' },
  'drone-exile-bee': { name: 'Squidwasp Drone' },
  'drone-wh-c-heavy': { name: 'Hiveguard Siege Drone' },
  'drone-wh-e-sentry': { name: 'Construct Sentry Drone' },
  // 修理组件
  'repairkit-civ': { name: 'Civilian Repair Kit' },
  'repairkit-mil': { name: 'Military Repair Kit' },
  // 谜质装置（Enigma Device）
  'mat-surveyor': { name: 'Deepspace Surveyor' },
  'mat-chrono': { name: 'Chrono Core' },
  'mat-crane': { name: 'Salvage Crane' },
  'mat-drill': { name: 'Mining Drill' },
  'mat-nebula': { name: 'Nebula Disperser' },
  'mat-enricher': { name: 'Voidmother Enricher' },
  'mat-expander': { name: 'Hold Expander' },
  'mat-suppressor': { name: 'Suppression Field' },
  'mat-boss-analyzer': { name: 'Guardian Analyzer' },
  'mat-extract-cover': { name: 'Extraction Cover' },
  'mat-shield-res': { name: 'Shield Resonance Plate' },
  'mat-armor-res': { name: 'Armor Reinforcement Plate' },
  'mat-hull-res': { name: 'Hull Reinforcement Plate' },
  'mat-tracker': { name: 'Tracking Array' },
  'mat-gyro': { name: 'Gyro Stabilizer' },
  'mat-jammer': { name: 'Jammer Emitter' },
  'mat-rangefinder': { name: 'Rangefinder Extender' },
  'mat-blindspot': { name: 'Blindspot Suppressor' },
  'mat-ammo-dmg': { name: 'Ammo Enhancer' },
  'mat-reload': { name: 'Reload Accelerator' },
  'mat-volley': { name: 'Volley Coordinator' },
  'mat-ammo-back': { name: 'Ammo Recovery Unit' },
  'mat-drone-net': { name: 'Drone Recovery Net' },
  'mat-field-repair': { name: 'Field Repair Unit' },
  'mat-wh-essence': { name: 'Wormhole Enigma' },
  // 货柜
  'box-relic-a': { name: 'Ruins Safe Container (Pirate)' },
  'box-relic-c': { name: 'Ruins Safe Container (Alien)' },
  'box-relic-d': { name: 'Ruins Safe Container (Gravekeeper)' },
  'box-relic-e': { name: 'Ruins Safe Container (Titan)' },
  'box-relic-g': { name: 'Ruins Safe Container (Deadarmy)' },
  'box-bp-shallow': { name: 'Blueprint Container (Shallow)' },
  'box-bp-mid': { name: 'Blueprint Container (Mid)' },
  'box-bp-deep': { name: 'Blueprint Container (Deep)' },
  'box-valuables': { name: 'Valuables Container' },
  'box-military': { name: 'Military Supply Container' },
  // 奢侈品
  'lux-1': { name: 'Starport Vintage' },
  'lux-2': { name: 'Noble Spice' },
  'lux-3': { name: 'Lost Artwork' },
  'lux-4': { name: 'Aged Cigars' },
  'lux-5': { name: 'Exotic Textiles' },
  'lux-6': { name: 'Aromatic Wood Carving' },
  'lux-7': { name: 'Court Sheet Music' },
  'lux-8': { name: 'Ancient Balm' },
  'lux-9': { name: 'Original Star Chart' },
  'lux-10': { name: 'Crown Diamond' },
  // AI 核心
  'ai-core-gamma': { name: 'Gamma AI Core' },
  'ai-core-beta': { name: 'Beta AI Core' },
  'ai-core-alpha': { name: 'Alpha AI Core' },
}

/** 技能（79 · `docs/glossary-en.md` §九） */
export const EN_SKILLS: EnTable = {
  'spaceship-command': { name: 'Spaceship Command' },
  navigation: { name: 'Navigation' },
  'warp-drive-operation': { name: 'Warp Drive Operation' },
  'acceleration-control': { name: 'Acceleration Control' },
  'mining-frigate': { name: 'Mining Frigate' },
  'industrial-ops': { name: 'Industrial Ship Operations' },
  'armed-ops': { name: 'Armed Ship Operations' },
  'armored-ops': { name: 'Armored Ship Operations' },
  'vector-maneuvering': { name: 'Vector Maneuvering' },
  'evasion-maneuvering': { name: 'Evasive Maneuvering' },
  'targeting-integration': { name: 'Targeting Integration' },
  mining: { name: 'Mining' },
  'deep-space-harvesting': { name: 'Deep Space Harvesting' },
  refining: { name: 'Refining' },
  reprocessing: { name: 'Reprocessing' },
  industry: { name: 'Industry' },
  materials: { name: 'Materials' },
  'industrial-automation': { name: 'Production Cadence' },
  'industrial-ai-cap-basic': { name: 'Industrial Automation Basics' },
  'industrial-ai-cap': { name: 'Industrial Automation' },
  'astro-geology': { name: 'Astrogeology' },
  'deep-hole-blasting': { name: 'Deep-hole Blasting' },
  'rich-vein-prospecting': { name: 'Rich Vein Prospecting' },
  'core-smelting': { name: 'Core Smelting' },
  'furnace-expansion': { name: 'Furnace Expansion' },
  'batch-production': { name: 'Batch Production' },
  'component-standardization': { name: 'Component Standardization' },
  'ai-servicing': { name: 'Auxiliary Ship Servicing' },
  'offline-ops': { name: 'Offline Operations' },
  'station-engineering': { name: 'Station Engineering' },
  'salvage-recycling': { name: 'Salvage Recycling' },
  'salvage-rigging': { name: 'Salvage Rigging' },
  'wreck-assaying': { name: 'Wreck Assaying' },
  'salvage-refining': { name: 'Salvage Refining' },
  gunnery: { name: 'Gunnery' },
  'kinetic-gunnery': { name: 'Kinetic Gunnery' },
  'missile-launching': { name: 'Missile Launching' },
  'laser-cannon': { name: 'Laser Cannon' },
  'fire-control': { name: 'Fire Control' },
  'reload-drills': { name: 'Reload Drills' },
  'drone-warfare': { name: 'Drone Warfare' },
  'ammunition-condensing': { name: 'Ammunition Condensing' },
  'drone-servicing': { name: 'Drone Servicing' },
  'drone-strike': { name: 'Drone Strike' },
  'drone-durability': { name: 'Drone Durability' },
  'drone-reinforce': { name: 'Drone Reinforcement' },
  'drone-recovery': { name: 'Drone Recovery' },
  'drone-evasion': { name: 'Drone Evasion' },
  'shield-operation': { name: 'Shield Operation' },
  'shield-tuning': { name: 'Shield Tuning' },
  'energy-management': { name: 'Energy Management' },
  'hull-upgrades': { name: 'Hull Upgrades' },
  'armor-tuning': { name: 'Armor Tuning' },
  'repair-engineering': { name: 'Repair Engineering' },
  'hull-quick-repair': { name: 'Quick Hull Repair' },
  'station-protocol': { name: 'Station Protocol' },
  'ai-expert': { name: 'AI Core Operation' },
  'ai-core-dispatch': { name: 'AI Core Dispatch' },
  'accelerated-learning': { name: 'Accelerated Learning' },
  'ship-systems-engineering': { name: 'Ship Systems Engineering' },
  accounting: { name: 'Accounting' },
  'trade-negotiation': { name: 'Trade Negotiation' },
  'bounty-hunting': { name: 'Bounty Hunting' },
  marketing: { name: 'Marketing' },
  'source-sweeping': { name: 'Source Sweeping' },
  'secondhand-market': { name: 'Secondhand Market' },
  'signal-analysis': { name: 'Signal Analysis' },
  cartography: { name: 'Cartography' },
  'signal-filtering': { name: 'Signal Filtering' },
  'galactic-happenings': { name: 'Galactic Happenings' },
  'event-dividend': { name: 'Event Dividend' },
  'chart-archive': { name: 'Chart Archive' },
  'salvage-diving': { name: 'Salvage Diving' },
  'seizure-appraisal': { name: 'Seizure Appraisal' },
  'lowsec-survival': { name: 'Low-sec Survival' },
  'deep-space-logistics': { name: 'Deep Space Logistics' },
  'hauler-ops': { name: 'Hauler Operations' },
  compression: { name: 'Compression' },
  'hold-management': { name: 'Hold Management' },
}

/**
 * 残骸（26 = 13 组 × 普通/稀有 · `packages/core/src/wreckGroups.ts` 的组名派生）：
 * 中文侧名 = `组名` / `组名（稀有版）`，id = `wreck-<组key>` / `wreck-rare-<组key>`。
 * 英文按「<族> Wreck / Rare Wreck（<区>）」——区 = High-sec / Low-sec / Wormhole（与 §九 技能 `Low-sec Survival` 同口径）。
 */
export const EN_WRECKS: EnTable = {
  'wreck-a-hi': { name: 'Pirate Wreck (High-sec)' },
  'wreck-rare-a-hi': { name: 'Pirate Rare Wreck (High-sec)' },
  'wreck-b-hi': { name: 'Armed Scavenger Wreck (High-sec)' },
  'wreck-rare-b-hi': { name: 'Armed Scavenger Rare Wreck (High-sec)' },
  'wreck-d-hi': { name: 'Gravekeeper Wreck (High-sec)' },
  'wreck-rare-d-hi': { name: 'Gravekeeper Rare Wreck (High-sec)' },
  'wreck-a-lo': { name: 'Pirate Wreck (Low-sec)' },
  'wreck-rare-a-lo': { name: 'Pirate Rare Wreck (Low-sec)' },
  'wreck-c-lo': { name: 'Alien Wreck (Low-sec)' },
  'wreck-rare-c-lo': { name: 'Alien Rare Wreck (Low-sec)' },
  'wreck-d-lo': { name: 'Gravekeeper Wreck (Low-sec)' },
  'wreck-rare-d-lo': { name: 'Gravekeeper Rare Wreck (Low-sec)' },
  'wreck-e-lo': { name: 'Titan Megastructure Wreck (Low-sec)' },
  'wreck-rare-e-lo': { name: 'Titan Megastructure Rare Wreck (Low-sec)' },
  'wreck-g-lo': { name: 'Deadarmy Wreck (Low-sec)' },
  'wreck-rare-g-lo': { name: 'Deadarmy Rare Wreck (Low-sec)' },
  'wreck-a-wh': { name: 'Pirate Wreck (Wormhole)' },
  'wreck-rare-a-wh': { name: 'Pirate Rare Wreck (Wormhole)' },
  'wreck-c-wh': { name: 'Alien Wreck (Wormhole)' },
  'wreck-rare-c-wh': { name: 'Alien Rare Wreck (Wormhole)' },
  'wreck-d-wh': { name: 'Gravekeeper Wreck (Wormhole)' },
  'wreck-rare-d-wh': { name: 'Gravekeeper Rare Wreck (Wormhole)' },
  'wreck-e-wh': { name: 'Titan Megastructure Wreck (Wormhole)' },
  'wreck-rare-e-wh': { name: 'Titan Megastructure Rare Wreck (Wormhole)' },
  'wreck-g-wh': { name: 'Deadarmy Wreck (Wormhole)' },
  'wreck-rare-g-wh': { name: 'Deadarmy Rare Wreck (Wormhole)' },
}

/** 异常点（27 · `docs/glossary-en.md` §十：悬赏 / 遭遇战卡片名） */
export const EN_ANOMALIES: EnTable = {
  'ano-training': { name: 'Proving Grounds Eviction' },
  'ano-pirate-post': { name: 'Frontier Pirate Outpost' },
  'ano-abandoned-platform': { name: 'Occupied Port Warrant' },
  'ano-redring-raiders': { name: 'Red Tide Raider Fleet' },
  'ano-gravekeeper': { name: 'Graveyard Gravekeeper' },
  'ano-ghost-signal': { name: 'Ghost Ship Signal' },
  'ano-abyss-guard': { name: 'Abyss Gate Guard' },
  'ano-titan-wreck': { name: 'Titan Wreck Survey' },
  'ano-auro-raiders': { name: 'Auro Armed Wreck Group' },
  'ano-core-section': { name: 'Megastructure Core Survey' },
  'ano-starcore-boss': { name: 'Starcore Swarm' },
  'ano-cinder-siege': { name: 'Cinder Siege' },
  'ano-echo-haunt': { name: 'Echo Remnant' },
  'ano-nadir-static': { name: 'Nadir Static Blockade' },
  'ano-maw-hunt': { name: 'Maw Hunt Order' },
  'ano-vault-sentinel': { name: 'Vault Sentinel' },
  'ano-voidedge-warden': { name: 'Voidsea Warden' },
  'ano-harbor-escort': { name: 'New Harbor Convoy Escort' },
  'ano-shard-bandits': { name: 'Shardbelt Bandit Warrant' },
  'ano-lantern-saboteurs': { name: 'Beacon Hunter Bounty' },
  'ano-haze-ambush': { name: 'Haze Ambush Clearance' },
  'ano-mirage-hijackers': { name: 'Mirage Navigation Hijack' },
  'ano-chasm-aberrations': { name: 'Chasm Aberration Hunt' },
  'enc-pirate-1': { name: 'Roaming Pirate Skiff' },
  'enc-pirate-2': { name: 'Ambush Raider Squad' },
  'enc-pirate-3': { name: 'Fanatic Patrol Group' },
  'enc-pirate-4': { name: 'Deepspace Butcher Fleet' },
  // 虫洞敌卡（15，`hidden` ⇒ 不进悬赏目录，但战斗/虫洞页会显示；见 glossary §十一）
  'wh-pirate-scout': { name: 'Raider Detachment' },
  'wh-pirate-hunt': { name: 'Raider Hunt' },
  'wh-pirate-warband': { name: 'Pirate Warband' },
  'wh-alien-swarm': { name: 'Starcore Hunting Swarm' },
  'wh-alien-brood': { name: 'Spore Brood Tide' },
  'wh-alien-hive': { name: 'Maw Deep Hive' },
  'wh-grave-watch': { name: 'Gravekeeper Patrol' },
  'wh-grave-sentry': { name: 'Stasis Sentry Chain' },
  'wh-grave-throne': { name: 'Mausoleum Court' },
  'wh-titan-echo': { name: 'Titan Echo' },
  'wh-titan-missile': { name: 'Missile Echo' },
  'wh-titan-hulk': { name: 'Titan Onslaught' },
  'wh-exile-blockade': { name: 'Deadarmy Blockade' },
  'wh-exile-swarm': { name: 'Echo Swarm' },
  'wh-exile-line': { name: 'Remnant Battle Line' },
}

/**
 * 覆盖一层 **数组**目录（界面枚举用：`engine.ships` / `engine.modules` … 都是"原始数组过滤后"的只读表）。
 * 与 `overlayMap` 同口径：只改 `name` / `description`；一条都没命中时返回**原数组**。
 */
export function overlayList<T extends { id: string; name: string; description?: string }>(
  src: readonly T[],
  en: EnTable,
  locale: Locale,
): readonly T[] {
  if (locale === 'zh') return src
  let out: T[] | null = null
  for (let i = 0; i < src.length; i++) {
    const def = src[i]!
    const text = en[def.id]
    if (!text) continue
    out ??= [...src]
    out[i] = {
      ...def,
      ...(text.name !== undefined ? { name: text.name } : {}),
      ...(text.description !== undefined ? { description: text.description } : {}),
    }
  }
  return out ?? src
}

/**
 * 覆盖一层 Map 目录：**只改 `name` / `description`，其余字段与 id 一字不动**；
 * 表里查不到的 id 原样保留（写错的 id 由用例点名，不在这里静默吞掉）。
 * 一条都没命中时返回**原对象**（省一次拷贝，也让"没翻译"和"翻过"在引用上可分辨）。
 */
export function overlayMap<T extends { name: string; description?: string }>(
  src: ReadonlyMap<string, T>,
  en: EnTable,
  locale: Locale,
): ReadonlyMap<string, T> {
  if (locale === 'zh') return src
  let out: Map<string, T> | null = null
  for (const [id, text] of Object.entries(en)) {
    const def = src.get(id)
    if (!def) continue
    out ??= new Map(src)
    out.set(id, {
      ...def,
      ...(text.name !== undefined ? { name: text.name } : {}),
      ...(text.description !== undefined ? { description: text.description } : {}),
    })
  }
  return out ?? src
}

/**
 * 按语言覆盖运行上下文。
 * - `locale === 'zh'` ⇒ **原样返回同一个 ctx**（零拷贝、零行为变化：工具 / 测试 / 模拟读数逐字不变）；
 * - `locale === 'en'` ⇒ 逐表覆盖（本批只有舰船；后续批次在此追加 `modules / items / skills / …`）。
 */
/**
 * 物品目录的**合并覆盖表**：静态物品（86）＋ 派生残骸（26）。
 * 合成一次即可——`localizeCtx` 用同一张表覆盖 `ctx.items`（残骸在 `context.ts` 里是先登记、后覆盖的）。
 */
export const EN_ITEMS_ALL: EnTable = { ...EN_ITEMS, ...EN_WRECKS }

/**
 * 从舰船英文名取**舰级段**：含 `-class` 时取到该词为止（`Pioneer-class Mining Corvette` → `Pioneer-class`）；
 * 虫洞族舰名没有 `-class`（它们是敌舰模板名）⇒ 用整名。
 */
function shipClassSegment(enName: string): string {
  const parts = enName.split(' ')
  const i = parts.findIndex((p) => p.includes('-class'))
  return i >= 0 ? parts.slice(0, i + 1).join(' ') : enName
}

/**
 * **装备 / 物品蓝图**（派生，不另立表）：`<产物英文名> Blueprint`。
 * 依据：`BlueprintDef` 自带 `moduleId` / `itemId` ⇒ 直接取产物的英文名拼后缀，
 * 比逐条翻中文蓝图串更准（中文侧写的是「轻型炮台 MK1（动能）蓝图」，英文侧统一成 `Light Turret MK1 · Kinetic Blueprint`）。
 */
export const EN_BLUEPRINTS: EnTable = (() => {
  const out: Record<string, EnText> = {}
  for (const bp of BLUEPRINTS) {
    const product = bp.moduleId ? EN_MODULES[bp.moduleId]?.name : bp.itemId ? EN_ITEMS_ALL[bp.itemId]?.name : undefined
    if (product) out[bp.id] = { name: `${product} Blueprint` }
  }
  return out
})()

/** **舰船蓝图**（派生）：`<舰级段> Blueprint`（`ShipBlueprintDef.shipId` ⇒ 舰船英文名 ⇒ 取舰级段） */
export const EN_SHIP_BLUEPRINTS: EnTable = (() => {
  const out: Record<string, EnText> = {}
  for (const bp of SHIP_BLUEPRINTS) {
    const en = EN_SHIPS[bp.shipId]?.name
    if (en) out[bp.id] = { name: `${shipClassSegment(en)} Blueprint` }
  }
  return out
})()

/** 敌舰（25 · `docs/glossary-en.md` §十一；卡片把它**内嵌**在 `anomaly.ships[].ship` 里 ⇒ 见 `overlayCardFoes`） */
export const EN_FOE_SHIPS: EnTable = {
  'foe-pirate-skiff': { name: 'Pirate Skiff' },
  'foe-pirate-corvette': { name: 'Raider Frigate' },
  'foe-pirate-sniper': { name: 'Raider Sniper' },
  'foe-pirate-raider': { name: 'Raider EW Ship' },
  'foe-pirate-warlord': { name: 'Pirate Warlord' },
  'foe-scav-skiff': { name: 'Scavenger Skiff' },
  'foe-scav-armed': { name: 'Scavenger Gunship' },
  'foe-alien-rift-larva': { name: 'Aberrant Larva' },
  'foe-alien-starcore-larva': { name: 'Starcore Larva' },
  'foe-alien-starcore-adult': { name: 'Starcore Adult' },
  'foe-alien-maw': { name: 'Maw Behemoth' },
  'foe-alien-spore-hive': { name: 'Spore Hive Aberrant' },
  'foe-d-ghost': { name: 'Ghost Ship' },
  'foe-d-longship': { name: 'Gravekeeper Longship' },
  'foe-d-stasis': { name: 'Stasis Guard Ship' },
  'foe-d-throne': { name: 'Gravekeeper Throne Ship' },
  'foe-missile-hulk': { name: 'Missile Hulk' },
  'foe-titan-hulk': { name: 'Titan Hulk' },
  'foe-auro-hulk': { name: 'Auro Hulk' },
  'foe-core-section': { name: 'Core Section' },
  'foe-g-swarm-skiff': { name: 'Siege Remnant Skiff' },
  'foe-g-echo-remnant': { name: 'Echo Remnant Ship' },
  'foe-g-nadir-lock': { name: 'Nadir Blockade Ship' },
  'foe-g-exile-battleship': { name: 'Deadarmy Battleship' },
  'foe-g-remnant-tender': { name: 'Remnant Tender' },
}

/**
 * **卡片内嵌敌舰**的嵌套覆盖：`AnomalyDef.ships[].ship.name` 是**嵌在卡里**的（不是 ctx 的独立表），
 * 所以普通 `overlayMap` 够不着 ⇒ 单独走这一层。只改 `ship.name`，其余字段（血量倍率/波次/编成）一字不动。
 */
/** 单张卡片的敌舰覆盖：只改 `ship.name`；没命中返回 null（调用方据此决定是否新建容器） */
function cardFoesOf<T extends { ships?: readonly { ship: { id: string; name: string } }[] }>(
  def: T,
  en: EnTable,
): T | null {
  const slots = def.ships
  if (!slots || slots.length === 0) return null
  let changed = false
  const mapped = slots.map((slot) => {
    const text = en[slot.ship.id]
    if (text?.name === undefined) return slot
    changed = true
    return { ...slot, ship: { ...slot.ship, name: text.name } }
  })
  return changed ? { ...def, ships: mapped } : null
}

/** Map 版（`ctx.anomalies` 一类）：逐卡嵌套覆盖 */
export function overlayCardFoes<T extends { ships?: readonly { ship: { id: string; name: string } }[] }>(
  cards: ReadonlyMap<string, T>,
  en: EnTable,
  locale: Locale,
): ReadonlyMap<string, T> {
  if (locale === 'zh') return cards
  let out: Map<string, T> | null = null
  for (const [id, def] of cards) {
    const next = cardFoesOf(def, en)
    if (!next) continue
    out ??= new Map(cards)
    out.set(id, next)
  }
  return out ?? cards
}

/** 数组版（引擎目录 `ANOMALIES_FLAVORED` 一类）：逐卡嵌套覆盖 */
export function overlayCardFoesList<T extends { ships?: readonly { ship: { id: string; name: string } }[] }>(
  list: readonly T[],
  en: EnTable,
  locale: Locale,
): readonly T[] {
  if (locale === 'zh') return list
  let out: T[] | null = null
  for (let i = 0; i < list.length; i++) {
    const next = cardFoesOf(list[i]!, en)
    if (!next) continue
    out ??= [...list]
    out[i] = next
  }
  return out ?? list
}

/** 星系（20 · `docs/glossary-en.md` §五）。注意：星系名进 `ctx.galaxies`，矿带名进 `ctx.belts`，两张表分开。 */
export const EN_GALAXIES: EnTable = {
  'galaxy-hub': { name: 'Leviathan IV' },
  'galaxy-kor': { name: 'Kor Frontier' },
  'galaxy-dust': { name: 'Stardust Wastes' },
  'galaxy-redring': { name: 'Redring Corridor' },
  'galaxy-grave': { name: 'Darkstar Graveyard' },
  'galaxy-abyss': { name: 'Abyss Gate' },
  'galaxy-auro': { name: 'Auro Waste Ring' },
  'galaxy-starcore': { name: 'Starcore Labyrinth' },
  'galaxy-harbor': { name: 'New Harbor Corridor' },
  'galaxy-haze': { name: 'Hazebelt' },
  'galaxy-shard': { name: 'Shardbelt' },
  'galaxy-cinder': { name: 'Cinder Sector' },
  'galaxy-echo': { name: 'Echo Wastes' },
  'galaxy-lantern': { name: 'Lantern Passage' },
  'galaxy-chasm': { name: 'Chasm Deepbelt' },
  'galaxy-mirage': { name: 'Mirage System' },
  'galaxy-maw': { name: 'Star Maw' },
  'galaxy-vault': { name: 'Vault Necropolis' },
  'galaxy-nadir': { name: 'Nadir Quiet Zone' },
  'galaxy-voidedge': { name: 'Voidsea Edge' },
}

/** 矿带（17 · §五；**key 是矿带自己的 id**（`belt-*`），不是星系 id——星系名另见 `EN_GALAXIES`） */
export const EN_BELTS: EnTable = {
  'belt-fortune': { name: 'Ring of Plenty' },
  'belt-scorched': { name: 'Scorched Rift' },
  'belt-kernite': { name: 'Deepspace Crystal Belt' },
  'belt-sunshard': { name: 'Dawncrystal Belt' },
  'belt-gas-neon': { name: 'Neon Cloud Field' },
  'belt-glowstone': { name: 'Glowcloud Belt' },
  'belt-hemorphite': { name: 'Redring Crisis Belt' },
  'belt-crimsonite': { name: 'Mirage Cluster' },
  'belt-ice-marrow': { name: 'Frostmarrow Ice Ring' },
  'belt-fluxite': { name: 'Starcore Vein' },
  'belt-voidshard': { name: 'Voidcrystal Deepbelt' },
  'belt-ice-frost': { name: 'Bluefrost Ice Ring' },
  'belt-gas-ionstorm': { name: 'Ionstorm Cloud Field' },
  'belt-nebulite': { name: 'Starwraith Vein' },
  'belt-ice-darkstar': { name: 'Darkstar Ice Ring' },
  'belt-gas-phosphor': { name: 'Phosphor Haze Field' },
  'belt-gas-aurora': { name: 'Aurora Cloud Field' },
}

/** 站点（2 · 建站点；阶段名「奠基/完善/建成」嵌在站点定义里，用嵌套覆盖另处理） */
export const EN_STATIONS: EnTable = {
  'site-redring': { name: 'Redring Outpost' },
  'site-cinder': { name: 'Cinder Outpost' },
}

/** 势力与部门（13 · §六；通讯页的发件人/署名会用） */
export const EN_COMMS_FACTIONS: EnTable = {
  dshi: { name: 'Deep Space Industry Association' },
  'salvage-guild': { name: 'Salvage Guild' },
  archive: { name: 'The Archive' },
  'dept-nav-control': { name: 'Nav Control' },
  'dept-infra': { name: 'Infrastructure Dept' },
  'dept-survey': { name: 'Survey Office' },
  'dept-industry': { name: 'Industry Dept' },
  'dept-smelt': { name: 'Smelting Group' },
  'dept-training': { name: 'Training Office' },
  'dept-finance': { name: 'Finance Dept' },
  'dept-route-safety': { name: 'Route Safety' },
  'dept-recall': { name: 'Recall & Restart' },
  'dept-salvage-crew': { name: "Chen's Crew No.1" },
}

/** 旅行事件（8 · 译名表 §十三；`ctx.travelEvents` 是**数组** ⇒ 用 overlayList） */
export const EN_TRAVEL_EVENTS: EnTable = {
  'ev-derelict': { name: 'Drifting Container' },
  'ev-mineral-cloud': { name: 'Raw Material Debris Cloud' },
  'ev-aurora': { name: 'Warp Aurora' },
  'ev-scout': { name: 'Pirate Scout' },
  'ev-meteor': { name: 'Meteor Shower' },
  'ev-big-cargo': { name: 'Lost Association Container' },
  'ev-ore-patch': { name: 'Rich Ore Remnant' },
  'ev-signal': { name: 'Ancient Signal' },
}

/** 谜质科技（23 · 译名表 §十四；沿用既有术语：拆解 = Unbox · 残骸 = Wreck · 谐振 = Resonant） */
export const EN_MATTER_TECH: EnTable = {
  'mt-explore-turn': { name: 'Chrono Anchor' },
  'mt-explore-salvage': { name: 'Gravitic Crane' },
  'mt-explore-collect': { name: 'Enrichment Drill' },
  'mt-explore-hold': { name: 'Folding Hold' },
  'mt-explore-scan': { name: 'Resonant Signal Filter Array' },
  'mt-explore-speed': { name: 'Time Compression Matrix' },
  'mt-battle-shield': { name: 'Resonant Shield Array' },
  'mt-battle-armor': { name: 'Armor Realignment' },
  'mt-battle-hull': { name: 'Frame Reinforcement' },
  'mt-battle-hit': { name: 'Tracking Calibration' },
  'mt-battle-evasion': { name: 'Gyro Evasion' },
  'mt-battle-noise': { name: 'Signal Noise' },
  'mt-battle-range': { name: 'Rangefinding Extension' },
  'mt-battle-reload': { name: 'Reload Mechanism Optimization' },
  'mt-battle-damage': { name: 'Projectile Reinforcement' },
  'mt-battle-blind': { name: 'Blind Zone Suppression' },
  'mt-battle-threat-node': { name: 'Suppression Field Amplification' },
  'mt-battle-threat-boss': { name: 'Guardian Analysis' },
  'mt-battle-drone': { name: 'Resonant Recovery Net' },
  'mt-battle-repair': { name: 'Field Self-repair' },
  'mt-industry-unbox': { name: 'Container Unboxing' },
  'mt-industry-void': { name: 'Void Refining' },
  'mt-industry-wreck': { name: 'Wreck Analysis' },
}

export function localizeCtx(ctx: SimContext, locale: Locale): SimContext {
  if (locale === 'zh') return ctx
  return {
    ...ctx,
    ships: overlayMap(ctx.ships, EN_SHIPS, locale),
    modules: overlayMap(ctx.modules, EN_MODULES, locale),
    items: overlayMap(ctx.items, EN_ITEMS_ALL, locale),
    skills: overlayMap(ctx.skills, EN_SKILLS, locale),
    anomalies: overlayCardFoes(overlayMap(ctx.anomalies, EN_ANOMALIES, locale), EN_FOE_SHIPS, locale),
    blueprints: overlayMap(ctx.blueprints, EN_BLUEPRINTS, locale),
    shipBlueprints: overlayMap(ctx.shipBlueprints, EN_SHIP_BLUEPRINTS, locale),
    galaxies: overlayMap(ctx.galaxies, EN_GALAXIES, locale),
    belts: overlayMap(ctx.belts, EN_BELTS, locale),
    stations: overlayMap(ctx.stations, EN_STATIONS, locale),
    commsFactions: overlayMap(ctx.commsFactions, EN_COMMS_FACTIONS, locale),
    // matterTech 在 SimContext 里是可选字段（缺省 = 该档内容没装）⇒ 有才覆盖
    ...(ctx.matterTech ? { matterTech: overlayMap(ctx.matterTech, EN_MATTER_TECH, locale) } : {}),
    travelEvents: overlayList(ctx.travelEvents, EN_TRAVEL_EVENTS, locale),
  }
}
