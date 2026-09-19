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

export type Locale = 'zh' | 'en'

/** 一条覆盖：只许覆盖这两个字段（name / description），其余字段不许在此出现 */
export interface EnText {
  readonly name?: string
  readonly description?: string
}

export type EnTable = Readonly<Record<string, EnText>>

/** 舰船（43 · `docs/glossary-en.md` §四；虫洞族舰名不带 `-class`，与中文一致） */
export const EN_SHIPS: EnTable = {
  // ── 采矿 / 工业 / 货运
  sandcat: { name: 'Sandcat-class Mining Corvette' },
  burrower: { name: 'Burrower-class Mining Corvette' },
  whale: { name: 'Whaleswallow-class Mining Corvette' },
  pioneer: { name: 'Pioneer-class Mining Corvette' },
  'whale-king': { name: 'Whaleking-class Mining Corvette' },
  'sh-humpback': { name: 'Humpback-class Mining Ship' },
  'sh-bowhead': { name: 'Manta-class Heavy Freighter' },
  'sh-colossal': { name: 'Oarfish-class Flagship Freighter' },
  'sh-flyingfish': { name: 'Flyingfish-class Courier' },
  'sh-sailfish': { name: 'Sailfish-class Fast Freighter' },
  'sh-swordfish': { name: 'Swordfish-class Heavy Freighter' },
  // ── 武装舰
  'sh-falconet': { name: 'Skipjack-class Frigate' },
  'sh-shrike': { name: 'Mackerel-class Frigate' },
  'sh-tigershark': { name: 'Tigershark-class Armed Frigate' },
  'sh-mako': { name: 'Mako-class Destroyer' },
  'sh-whiteshark': { name: 'Whiteshark-class Gunboat' },
  'sh-swarm': { name: 'Barracuda-class Drone Frigate' },
  'sh-sentinel': { name: 'Kingfish-class Drone Carrier' },
  'sh-thresher': { name: 'Thresher-class Missile Cruiser' },
  'sh-electricray': { name: 'Electricray-class Laser Cruiser' },
  'sh-hammerhead': { name: 'Hammerhead-class Gunnery Cruiser' },
  'sh-bullshark': { name: 'Bullshark-class Assault Cruiser' },
  'sh-nautilus': { name: 'Nautilus-class Survey Cruiser' },
  // ── 重装 / 旗舰
  'sh-tortoise': { name: 'Tortoise-class Heavy Corvette' },
  'sh-hawksbill': { name: 'Hawksbill-class Heavy Cruiser' },
  'sh-xuanwu': { name: 'Leatherback-class Heavy Flagship' },
  'sh-megalodon': { name: 'Megalodon-class Battleship' },
  'sh-dunkleosteus': { name: 'Dunkleosteus-class Flagship' },
  // ── 虫洞族舰（敌舰模板名，不带 -class）
  'sh-wh-a-frigate': { name: 'Raider EW Frigate' },
  'sh-wh-a-destroyer': { name: 'Raider Gunboat' },
  'sh-wh-a-cruiser': { name: 'Raider Heavy Assault Cruiser' },
  'sh-wh-c-frigate': { name: 'Larva Interceptor' },
  'sh-wh-c-destroyer': { name: 'Carapace Interceptor' },
  'sh-wh-c-cruiser': { name: 'Hiveswarm Heavy Assault Cruiser' },
  'sh-wh-d-frigate': { name: 'Sentry EW Frigate' },
  'sh-wh-d-destroyer': { name: 'Tombwarden Command Ship' },
  'sh-wh-d-cruiser': { name: 'Mausoleum Cruiser' },
  'sh-wh-e-frigate': { name: 'Construct Torpedo Frigate' },
  'sh-wh-e-destroyer': { name: 'Hangar Drone Combat Ship' },
  'sh-wh-e-carrier': { name: 'Megastructure Drone Combat Ship' },
  'sh-wh-g-frigate': { name: 'Wraith Scout Frigate' },
  'sh-wh-g-destroyer': { name: 'Deadarmy Logistics Ship' },
  'sh-wh-g-cruiser': { name: 'Deadarmy Torpedo Cruiser' },
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

export function localizeCtx(ctx: SimContext, locale: Locale): SimContext {
  if (locale === 'zh') return ctx
  return {
    ...ctx,
    ships: overlayMap(ctx.ships, EN_SHIPS, locale),
    modules: overlayMap(ctx.modules, EN_MODULES, locale),
    items: overlayMap(ctx.items, EN_ITEMS_ALL, locale),
    skills: overlayMap(ctx.skills, EN_SKILLS, locale),
    anomalies: overlayMap(ctx.anomalies, EN_ANOMALIES, locale),
  }
}
