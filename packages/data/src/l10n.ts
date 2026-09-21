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
 * 装备（142 · `docs/glossary-en.md` §十二）—— **名称 + 说明**（说明逐条译自中文原文）。
 * 术语对齐：抗性上限 = `cap 90%` · 单发 = `single-shot` · 必中 = `always hits` · 近盲 = `blind zone` ·
 * 多装递减 = `stacks with diminishing returns` · 窝点/族专属 = `Lair-exclusive` / family-exclusive。
 */
export const EN_MODULES: EnTable = {
  // 采集 / 货舱
  'mod-miner-civ': { name: 'Civilian Mining Laser', description: '+10% yield. A station staple and the first upgrade a new pilot can afford.' },
  'mod-miner-1': { name: 'Reinforced Mining Laser MK1', description: '+20% cycle yield. The first self-built piece of industrial gear.' },
  'mod-miner-2': { name: 'Reinforced Mining Laser MK2', description: '+50% cycle yield. Twin resonant drill heads — the benchmark of deep-space industry.' },
  'mod-miner-3': { name: 'Precision Mining Laser MK3', description: '+80% yield. The peak of Association precision industry (buildable from its blueprint); 40 CPU is close to a small hull at full load.' },
  'mod-miner-proto': { name: 'Alien Prototype Mining Laser', description: '+110% yield. Alien technology of unknown origin, impossible to copy — not manufacturable.' },
  'mod-cargo-civ': { name: 'Civilian Cargo Expander', description: '+15% cargo capacity. Cheap range extension.' },
  'mod-cargo-1': { name: 'Cargo Expander MK1', description: '+30% cargo capacity and fewer trips back to unload.' },
  'mod-cargo-2': { name: 'Cargo Expander MK2', description: '+80% cargo capacity. Essential for long offline operations.' },
  'mod-cargo-3': { name: 'Folding Cargo Expander MK3', description: '+140% cargo capacity. A space-folding lining, buildable from the standard Association blueprint.' },
  'mod-cargo-proto': { name: 'Alien Prototype Cargo Hold', description: '+180% cargo capacity. Alien spatial technology, impossible to copy — not manufacturable.' },
  // 武器
  'mod-turret-civ': { name: 'Civilian Cannon', description: 'The Association constabulary standard light kinetic gun: fires kinetic ammo, 4.2 km effective range. Kinetic from the start — it handles default bounties.' },
  'mod-turret-kin-1': { name: 'Light Turret MK1 · Kinetic', description: 'Light rapid-fire kinetic gun: ×1.5 vs shields, ×0.75 vs armor.' },
  'mod-turret-kin-2': { name: 'Heavy Turret MK2 · Kinetic', description: 'Heavy kinetic gun with 5.7 km mid-to-long reach. Standard Association heavy (buildable from its blueprint) — the answer to mid-range suppression.' },
  'mod-turret-kin-3': { name: 'Siege Turret MK3 · Kinetic', description: 'Siege-grade kinetic cannon: 7.4 km, the Association standard among siege guns (buildable from its blueprint; 52 CPU of top-tier artillery).' },
  'mod-pd-e': { name: 'Point Defense Gun MK1', description: 'Kinetic point defense: short range, fast fire. Plenty of punch up close and no slouch against ships; only weapons with the anti-air trait can screen out enemy drone swarms.' },
  'mod-pd-e-2': { name: 'Point Defense Gun MK2', description: 'An uprated kinetic point defense: faster fire, heavier shots, still short-ranged — sharper both against ships at close quarters and against swarms.' },
  'mod-pd-e-3': { name: 'Point Defense Gun MK3', description: 'The top kinetic point defense: fire rate and shot weight pushed to the limit, range still that short in-your-face band — get close and it is the fiercest gun in the fight.' },
  'mod-laser-1': { name: 'Light Laser Cannon MK1', description: 'Light laser cannon: beams always hit and ignore the blind zone, power falls off with range, fires energy ammo.' },
  'mod-laser-2': { name: 'Heavy Laser Cannon MK2', description: 'Heavy laser cannon: an 8.2 km beam that always hits but loses noticeable power with range — the answer to steady mid-range output.' },
  'mod-laser-3': { name: 'Siege Laser Cannon MK3', description: 'Siege-grade laser cannon: a 10.5 km beam turret — steady firepower for formation assaults.' },
  'mod-laser-proto': { name: 'Alien Prototype Laser Cannon', description: 'An alien energy weapon that cannot be reverse-engineered: a 13 km beam — not manufacturable.' },
  'mod-missile-1': { name: 'Light Missile Launcher MK1', description: 'Light missile nest: fires explosive ammo (×1.5 vs armor, ×0.75 vs shields); 500 m blind zone.' },
  'mod-missile-2': { name: 'Heavy Missile Launcher MK2', description: 'Heavy missile nest: 11.8 km explosive bombardment — the nightmare of armored formations.' },
  'mod-missile-3': { name: 'Cruise Missile Launcher MK3', description: 'Cruise missile nest: 14.9 km of long-range ruin — the pre-emptive fire before large fleets engage.' },
  // 无人机件
  'mod-drone-rack-1': { name: 'Drone Deck Expansion MK1', description: 'External drone deck: +15 m³ drone bay (3 more scouts or 1 combat drone). Where drone fleets start.' },
  'mod-drone-rack-2': { name: 'Drone Deck Expansion MK2', description: 'External drone deck: +35 m³ drone bay. The expansion plan for medium drone formations.' },
  'mod-drone-rack-3': { name: 'Drone Deck Expansion MK3', description: 'Formation-grade external deck: +70 m³ drone bay.' },
  'mod-drone-tac-1': { name: 'Tactical Control Array MK1', description: '+12% single-shot damage for launched drones. The firepower core of drone builds.' },
  'mod-drone-tac-2': { name: 'Tactical Control Array MK2', description: '+25% single-shot damage for launched drones. With an electronic-warfare terminal behind them, drones bite harder.' },
  'mod-drone-tac-3': { name: 'Tactical Control Array MK3', description: '+40% single-shot damage for launched drones. The command core of drone-deck ships.' },
  'mod-drone-relay-1': { name: 'Drone Relay Antenna MK1', description: 'Guidance relay antenna: +20% range for launched drones. Gives close-in swarms a little more room to engage.' },
  'mod-drone-relay-2': { name: 'Drone Relay Antenna MK2', description: 'Guidance relay antenna: +45% range for launched drones. The range expansion for mid- to long-range drones.' },
  'mod-drone-relay-3': { name: 'Drone Relay Antenna MK3', description: 'Guidance relay antenna: +80% range for launched drones. Sentry drones can reach into laser-cannon bands.' },
  // 护盾 / 装甲
  'mod-shield-kin-1': { name: 'Shield Amplifier MK1 · Kinetic', description: '+20% kinetic resistance (cap 90%). Kinetic is the round the Association armed forces use most — default bounties all take it.' },
  'mod-shield-exp-1': { name: 'Shield Amplifier MK1 · Explosive', description: '+20% explosive resistance (cap 90%). Counters explosive rounds and torpedo-armed enemies.' },
  'mod-shield-pla-1': { name: 'Shield Amplifier MK1 · Energy', description: '+20% energy resistance (cap 90%). The tuning option against energy weapons.' },
  'mod-shield-kin-2': { name: 'Shield Amplifier MK2 · Kinetic', description: '+35% kinetic resistance (cap 90%). A second-generation tuner with ballistic prediction.' },
  'mod-shield-exp-2': { name: 'Shield Amplifier MK2 · Explosive', description: '+35% explosive resistance (cap 90%). A shield band optimized for explosive trajectories.' },
  'mod-shield-pla-2': { name: 'Shield Amplifier MK2 · Energy', description: '+35% energy resistance (cap 90%). A stable scheme for high-frequency energy shields.' },
  'mod-shield-kin-3': { name: 'Shield Amplifier MK3 · Kinetic', description: '+50% kinetic resistance (cap 90%). Flagship-grade ballistic interception array.' },
  'mod-shield-exp-3': { name: 'Shield Amplifier MK3 · Explosive', description: '+50% explosive resistance (cap 90%). A reinforced shield that can take an explosive barrage head-on.' },
  'mod-shield-pla-3': { name: 'Shield Amplifier MK3 · Energy', description: '+50% energy resistance (cap 90%). The shielding answer to the energy-weapon era.' },
  'mod-shield-ext-1': { name: 'Shield Extender MK1', description: '+15% shield capacity. The plain option when you want more shield and do not care which type.' },
  'mod-shield-ext-2': { name: 'Shield Extender MK2', description: '+35% shield capacity. An extender array that swallows more burst damage.' },
  'mod-shield-ext-3': { name: 'Shield Extender MK3', description: '+60% shield capacity. A giant shield generator fed by station-wide power.' },
  'mod-shieldchg-1': { name: 'Shield Recharger MK1', description: 'Pulse recharge every 30 s, restoring 24% of max shield.' },
  'mod-shieldchg-2': { name: 'Shield Recharger MK2', description: 'Pulse recharge every 30 s, restoring 40% of max shield.' },
  'mod-shieldchg-3': { name: 'Shield Recharger MK3', description: 'Pulse recharge every 30 s, restoring 64% of max shield.' },
  /* 护盾充能力场装置（2026-09-20 船长）：高槽 · 护盾族 —— 与上一条中槽「Shield Recharger」区分开：
     本件治**全队**（"Field"），冷却按件自带（10 s / 8 s）。 */
  'mod-shieldfield-2': { name: 'Shield Charge Field MK2', description: 'Deploys a field every 10 s, restoring 10% of each ship’s max shield to the whole fleet.' },
  'mod-shieldfield-3': { name: 'Shield Charge Field MK3', description: 'Deploys a field every 8 s, restoring 10% of each ship’s max shield to the whole fleet.' },
  'mod-armor-kin-1': { name: 'Armor Plating MK1 · Kinetic', description: '+25% kinetic resistance (cap 90%). Plating that counters kinetic ammo.' },
  'mod-armor-exp-1': { name: 'Armor Plating MK1 · Explosive', description: '+25% explosive resistance (cap 90%). Explosives hit armor at ×1.5 — this is the first line of defense.' },
  'mod-armor-pla-1': { name: 'Armor Plating MK1 · Energy', description: '+25% energy resistance (cap 90%). A heat-shielding scheme.' },
  'mod-armor-kin-2': { name: 'Armor Plating MK2 · Kinetic', description: '+40% kinetic resistance (cap 90%). Composite sandwich structure — a kinetic round\'s nightmare.' },
  'mod-armor-exp-2': { name: 'Armor Plating MK2 · Explosive', description: '+40% explosive resistance (cap 90%). Blast-lattice armor, the hardest bone a heavy gunner will chew.' },
  'mod-armor-pla-2': { name: 'Armor Plating MK2 · Energy', description: '+40% energy resistance (cap 90%). Layered ceramic heat barriers.' },
  'mod-armor-kin-3': { name: 'Armor Plating MK3 · Kinetic', description: '+55% kinetic resistance (cap 90%). Fortress-grade composite armor.' },
  'mod-armor-exp-3': { name: 'Armor Plating MK3 · Explosive', description: '+55% explosive resistance (cap 90%). A mobile fortress that stands up to explosive salvos.' },
  'mod-armor-pla-3': { name: 'Armor Plating MK3 · Energy', description: '+55% energy resistance (cap 90%). Ablative armor that can take energy fire head-on.' },
  'mod-armor-plate-1': { name: 'Armor Thickening Plate MK1', description: '+20% armor capacity. The classic stacking scheme: more thickness, no type preference.' },
  'mod-armor-plate-2': { name: 'Armor Thickening Plate MK2', description: '+45% armor capacity. A thicker sandwich layer and the backbone fitting of armored ships.' },
  'mod-armor-plate-3': { name: 'Armor Thickening Plate MK3', description: '+80% armor capacity. A composite armor layer cast by station heavy industry.' },
  // 推进 / 支援 / 维修 / 隐秘
  'mod-prop-1': { name: 'Vector Thruster MK1', description: 'Afterburner: +30% combat speed while lit, 60 s burn then 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.95. Close and break away faster; output is slightly less steady.' },
  'mod-prop-2': { name: 'Vector Thruster MK2', description: 'Afterburner: +60% combat speed while lit, 60 s burn then 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.88. Standard on agile ships, and the engine of kiting tactics.' },
  'mod-prop-3': { name: 'Vector Thruster MK3', description: 'Afterburner: +100% combat speed while lit, 60 s burn then 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.80. A short-burst ram engine — fast, but unsettled.' },
  'mod-mwd-1': { name: 'Micro Warp Drive MK1', description: 'Short-burst warp drive: +80% combat speed while lit for only 10 s, then a 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.80. Ten seconds is enough to grab a position — do not expect it to stay fast.' },
  'mod-mwd-2': { name: 'Micro Warp Drive MK2', description: 'Short-burst warp drive: +150% combat speed while lit for only 10 s, then a 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.75. In ten seconds put yourself out of reach, and let the hull carry the rest.' },
  'mod-mwd-3': { name: 'Micro Warp Drive MK3', description: 'Short-burst warp drive: +250% combat speed while lit for only 10 s, then a 60 s cooldown (ignites at the start). Cost: firing accuracy ×0.60 — the most violent ten seconds in the fight, and the least accurate.' },
  'mod-stab-kin-1': { name: 'Kinetic Stabilizer MK1', description: 'Kinetic weapon support: +6% single-shot damage for kinetic weapons.' },
  'mod-stab-kin-2': { name: 'Kinetic Stabilizer MK2', description: 'Kinetic weapon support: +10% single-shot damage for kinetic weapons.' },
  'mod-stab-kin-3': { name: 'Kinetic Stabilizer MK3', description: 'Kinetic weapon support: +15% single-shot damage for kinetic weapons.' },
  'mod-stab-exp-1': { name: 'Explosive Stabilizer MK1', description: 'Explosive weapon support: +6% single-shot damage for explosive weapons.' },
  'mod-stab-exp-2': { name: 'Explosive Stabilizer MK2', description: 'Explosive weapon support: +10% single-shot damage for explosive weapons.' },
  'mod-stab-exp-3': { name: 'Explosive Stabilizer MK3', description: 'Explosive weapon support: +15% single-shot damage for explosive weapons.' },
  'mod-stab-pla-1': { name: 'Plasma Stabilizer MK1', description: 'Plasma weapon support: +6% single-shot damage for energy weapons.' },
  'mod-stab-pla-2': { name: 'Plasma Stabilizer MK2', description: 'Plasma weapon support: +10% single-shot damage for energy weapons.' },
  'mod-stab-pla-3': { name: 'Plasma Stabilizer MK3', description: 'Plasma weapon support: +15% single-shot damage for energy weapons.' },
  'mod-rof-1': { name: 'Rate-of-Fire Computer MK1', description: 'Turret rate-of-fire support: reload interval −5%.' },
  'mod-rof-2': { name: 'Rate-of-Fire Computer MK2', description: 'Turret rate-of-fire support: reload interval −8%.' },
  'mod-rof-3': { name: 'Rate-of-Fire Computer MK3', description: 'Turret rate-of-fire support: reload interval −12%.' },
  'mod-warpcomp-2': { name: 'Warp Computer MK2', description: 'Navigation support: +20% warp speed — shortens interstellar travel only and changes nothing in combat maneuvering. Stacks with diminishing returns.' },
  'mod-warpcomp-3': { name: 'Warp Computer MK3', description: 'Navigation support: +35% warp speed — shortens interstellar travel only and changes nothing in combat maneuvering. Stacks with diminishing returns.' },
  'mod-track-1': { name: 'Tracking Array MK1', description: 'Tracking support: +8% turret accuracy overall.' },
  'mod-track-2': { name: 'Tracking Array MK2', description: 'Tracking support: +12% turret accuracy overall.' },
  'mod-track-3': { name: 'Tracking Array MK3', description: 'Tracking support: +16% turret accuracy overall.' },
  'mod-gyro-1': { name: 'Attitude Gyro MK1', description: 'Maneuvering support: incoming-hit gap cut by 10%.' },
  'mod-gyro-2': { name: 'Attitude Gyro MK2', description: 'Maneuvering support: incoming-hit gap cut by 15%.' },
  'mod-gyro-3': { name: 'Attitude Gyro MK3', description: 'Maneuvering support: incoming-hit gap cut by 20%.' },
  'mod-cpu-1': { name: 'Coprocessor MK1', description: 'Compute expansion card: fitting CPU cap +25. This module costs no CPU itself.' },
  'mod-cpu-2': { name: 'Coprocessor MK2', description: 'Dual-channel compute card: fitting CPU cap +35. Costs no CPU itself — the general-purpose unlock for the mid and late game.' },
  'mod-cpu-3': { name: 'Coprocessor MK3', description: 'Military compute stack: fitting CPU cap +45 (not manufacturable). Costs no CPU itself.' },
  'mod-salvager-1': { name: 'Salvager MK1', description: 'Wreck salvage: pulls 1 wreck every 10 s; the denser the field, the fatter the haul.' },
  'mod-salvager-2': { name: 'Salvager MK2', description: 'Wreck salvage: cycle shortened to 8 s.' },
  'mod-salvager-3': { name: 'Salvager MK3', description: 'Wreck salvage: cycle shortened to 6 s.' },
  'mod-hullrep-civ': { name: 'Civilian Hull Repair Unit', description: 'Mid-slot repair unit: restores 5 armor and 5 structure every 5 s in combat, spending 1 civilian repair kit per tick. A life-saver, not a match for enemy fire. Repair per tick scales with armor/structure capacity and Quick Hull Repair.' },
  'mod-hullrep-1': { name: 'Hull Repair Unit MK1', description: 'Mid-slot repair unit: restores 10 armor and 10 structure every 5 s in combat, spending 1 military repair kit per tick — a marked extension of life, though still not a match for enemy fire. Repair per tick scales with armor/structure capacity and Quick Hull Repair.' },
  'mod-hullrep-2': { name: 'Hull Repair Unit MK2', description: 'Mid-slot repair unit: restores 18 armor and 18 structure every 5 s in combat, spending 1 military repair kit per tick — the endurance card of a well-fitted cruiser or battleship. Repair per tick scales with armor/structure capacity and Quick Hull Repair.' },
  'mod-lock-1': { name: 'Target Lock Array MK1', description: 'Focuses the whole formation on the lead ship; formation damage +8%.' },
  'mod-lock-2': { name: 'Target Lock Array MK2', description: 'Focuses the whole formation on the lead ship; formation damage +12%.' },
  'mod-lock-3': { name: 'Target Lock Array MK3', description: 'Focuses the whole formation on the lead ship; formation damage +20%.' },
  'mod-stealth-2': { name: 'Stealth Module MK2', description: 'Stealth for 20 s before firing; disabled when used with any kind of thruster.' },
  'mod-stealth-3': { name: 'Stealth Module MK3', description: 'Stealth for 30 s before firing; disabled when used with any kind of thruster.' },
  // 窝点专属（lair）
  'mod-lair-turret-a': { name: 'Raider Gatling Cannon', description: 'Lair-exclusive: a captured, rebuilt multi-barrel kinetic gun — a gatling hose of fire at a rate close to a heavy turret, but with half the range of a siege turret and several times the ammo burn. Fiercest at grappling range.' },
  'mod-lair-missile-a': { name: 'Raider Missile Nest', description: 'Lair-exclusive: a short-range missile nest stripped off raiding boats — salvoes of explosive rounds in your face, with tracking that ignores range falloff and a blind zone of only 200 m. The range is so short it is a knife-fighting weapon; what it sells is volume once you are in close.' },
  'mod-lair-cargo-a': { name: 'Spoils Reinforcement Bay', description: 'Lair-exclusive: a captured, rebuilt compartment — cargo capacity +100%, with captured armor plates hung on the inner bulkheads (armor capacity +15%). Built for hauling loot and trading; limited combat value.' },
  'mod-lair-armor-c': { name: 'Bio Carapace Plate', description: '+10% damage reduction against all three types on the armor layer; self-repairs 6 armor every 5 s in combat (consumes no kits).' },
  'mod-lair-dc-c': { name: 'Bio Damage Control Chamber', description: '+25% damage reduction against all three types on the structure layer; self-repairs 4 structure every 5 s in combat (consumes no kits).' },
  'mod-lair-laser-c': { name: 'Acid Sprayer', description: 'Alien lair-exclusive: gland-pressurized acid spray — beam-grade, always hits, no blind zone. It trades rate of fire for shot weight: slow to reload, heavy on every shot. Range is only 2.8 km, so it has to be used up close.' },
  'mod-lair-shield-d': { name: 'Mausoleum Shield Array', description: '+30% damage reduction against all three types; no need to guess the enemy\'s ammo.' },
  'mod-lair-turret-d': { name: 'Gravekeeper Long Cannon', description: '100% accuracy at a 12 km extreme range (60% at the very end); extremely slow to reload and extremely heavy per shot.' },
  'mod-lair-armor-d': { name: 'Mausoleum Armor Layer', description: 'Gravekeeper lair-exclusive: mausoleum-grade composite heavy armor — armor capacity +110%, at the cost of −25% combat speed (multiple copies do not stack) and 42 CPU. Fitting it means one less heavy gun and a slower ship. Gravekeepers never needed to chase anyone.' },
  'mod-lair-turret-e': { name: 'Megastructure Wreck Cannon', description: 'Titan lair-exclusive: a main gun torn from a megastructure core section — one hammer blow every ten seconds with extreme single-shot power, at the cost of clumsy ballistics that miss more with range (nearly wasted at the band\'s end) and a base accuracy of only 70%. Explosive warheads crack armor hard but barely touch shields: the megastructure way of trading blows at medium range. Its construction is oddly simple, costing only 22 CPU.' },
  'mod-lair-hangar-e': { name: 'Deep Hangar', description: 'Titan lair-exclusive: a whole hangar deck deep in the megastructure hull — drone bay +95 m³ (19 more scouts, 9 combat drones or 4 siege drones). It can stock them and launch them, at a cost of 50 CPU; what really caps launches is still CPU bandwidth — the hangar only guarantees you carry enough.' },
  'mod-lair-frame-e': { name: 'Megastructure Frame', description: 'Titan lair-exclusive: a keel section cut whole from a megastructure — structure capacity +60% and armor capacity +30%. When shields and armor are punched through, this is the last stretch of HP. Megastructure constructs do not care about agility, only about lasting to the end.' },
  'mod-lair-drone-tac-g': { name: 'Squidwasp Swarm Control', description: 'Deadarmy lair-exclusive: a swarm console pulled off a wreck — +45% single-shot damage for launched drones, at only 32 CPU. Exiles have no new parts, only good hands.' },
  'mod-lair-drone-relay-g': { name: 'Exile Relay Mast', description: 'Deadarmy lair-exclusive: a relay array jury-rigged from scrap masts — +65% range for launched drones (Hummingbird 6,600 m / Redkite 7,425 m / Falcon 8,250 m / Thundergull 10,725 m). Only 34 CPU, leaving compute for elsewhere.' },
  // 虫洞族专属（mod-wh-*）
  'mod-wh-a-frag': { name: 'Raider Fragment Cannon', description: 'Fragment rounds that burst on their own: inside 7.3 km they scatter a cloud of explosive shrapnel with extreme single-shot power. The fragments ignore armor seams and add 50% kinetic damage (independent of the explosive ammo spent). The cost: accuracy only 0.80 and a 5.6 s reload.' },
  'mod-wh-a-hangar': { name: 'Raider Hangar', description: 'A hangar mezzanine welded from stolen cargo bulkheads: drone bay +30 m³ and launched drones cycle 8% faster. It carries more and launches faster for only 25 CPU.' },
  'mod-wh-a-prop': { name: 'Raider Afterburner', description: 'A drive section overclocked to glowing: +120% combat speed for only 18 CPU. The cost is extreme firing instability — accuracy ×0.65. Grab the loot and run is its proper use.' },
  'mod-wh-a-coat': { name: 'Raider Refraction Coating', description: 'A coating that lies to rangefinders: the incoming-hit gap is cut by a further 28%, at the cost of −15 to all resistances — shields, armor and structure all get more fragile. It saves the ship and the cargo, but do not count on it to tank.' },
  'mod-wh-a-scan': { name: 'Spoils Scan Array', description: 'A jury-rigged fire-control array: turret accuracy ×1.24 overall, at the cost of −15% weapon range — you see truer, but the enemy has to come closer.' },
  'mod-wh-a-shield': { name: 'Raider Shield Cage', description: 'Three stolen shield generators chained into a cage: shield capacity +80%, at the cost of −25% weapon range — the cage takes the space the mounts needed.' },
  'mod-wh-c-laser': { name: 'Bio Prism Beam', description: 'A corrosive beam from a living prism array: 8.6 km, always hits, heavy per shot and long-ranged for the family. Close-in work belongs to the family\'s Acid Sprayer; this piece covers the moments when the target wants to open the distance. The cost is a 5.6 s reload.' },
  'mod-wh-c-prism': { name: 'Carapace Prism Layer', description: 'Cuts a 30% gap into armor resistance against all three damage types.' },
  'mod-wh-c-pulse': { name: 'Bio Pulse Accelerator', description: 'Drives the loading chain with a living pulse: turret reload interval ÷1.06 and ship speed +10%, for 42 CPU. It shoots faster and runs faster.' },
  'mod-wh-c-missile': { name: 'Spore Missile Nest', description: 'Spore sacs that scatter on their own: 13.5 km explosive coverage with extreme single-shot power, blanketing every enemy ship at once (resolved per ship). Wide spread (accuracy 0.60) and a 7.6 s reload — its job is to cover the whole battlefield.' },
  'mod-wh-c-frame': { name: 'Chitin Frame Layer', description: 'Replaces the whole frame with a chitin composite: structure capacity +75% and ship speed +5% — a thicker shell that is also lighter. When shields and armor are punched through, this is the last stretch of HP.' },
  'mod-wh-d-turret': { name: 'Tombwarden Linked Cannon', description: 'The tombwarden\'s linked cannon: a 2.8 s cycle inside 5.4 km, throwing two extremely heavy shots per cycle. The long cannon calls out hard targets; this one clears the crowd that closes in.' },
  'mod-wh-d-shield': { name: 'Mausoleum Shield Core', description: 'A core taken from a mausoleum array: shield capacity +90%. It complements the family\'s three-type shield — one handles thickness, the other hardness.' },
  'mod-wh-d-lock': { name: 'Gravekeeper Death Knell', description: 'Focuses the whole formation on the lead ship; formation damage +30%.' },
  'mod-wh-d-laser': { name: 'Mausoleum Prism Cannon', description: 'A prism torn from the top of a mausoleum and turned into a gun barrel: a 12.5 km beam that always hits with extreme single-shot power, and a 6.8 s reload — the time spent aiming is its entire cost.' },
  'mod-wh-d-loader': { name: 'Gravekeeper Rapid Loader', description: 'A tireless mechanical loading arm: turret reload interval ÷1.18. The only weakness of a long always-hit cannon is slowness, and this piece fixes exactly that.' },
  'mod-wh-d-steady': { name: 'Mausoleum Ballistic Inscription', description: 'An inscription cut into the breech: +18% single-shot damage for both kinetic and energy weapons. Gravekeeper guns are either kinetic or energy, so it honors both.' },
  'mod-wh-e-dc': { name: 'Megastructure Damage Control Array', description: 'A megastructure construct\'s built-in damage-control network: +30% structure resistance to kinetic and explosive, structure +35%, for only 38 CPU. Megastructures are made to be hit rather than to hit back; this layer lets them take a second round.' },
  'mod-wh-e-tac': { name: 'Megastructure Control Tower', description: 'A tower-shaped drone command hub: +50% single-shot damage for launched drones. What hangar families lack is never numbers — it is making those numbers hurt.' },
  'mod-wh-e-cpu': { name: 'Megastructure Coprocessor', description: 'A megastructure construct\'s parallel compute core: fitting CPU cap +90, costing no CPU itself, at the price of +12% reload across the ship. The compute is borrowed, and rate of fire pays it back.' },
  'mod-wh-e-pd': { name: 'Megastructure Point Defense Array', description: 'A whole array of point defense: 2.5 km range, suppressing by rate of fire up close — the anti-air trait ×2, with heavy shots as well.' },
  'mod-wh-e-shield': { name: 'Megastructure Shield Matrix', description: 'A matrix shield emitter layer: +32% shield resistance to kinetic and energy while raising shield capacity by 42%, for 70 CPU — the megastructure family\'s first shield.' },
  'mod-wh-g-hangar': { name: 'Deadarmy Hive Dock', description: 'A hive converted from an abandoned nest into a dock: drone bay +110 m³. The deadarmy gives drones damage and range but never room to be carried — this is that piece.' },
  'mod-wh-g-fcs': { name: 'Deadarmy Fire Control', description: 'Fire-control wreckage salvaged from a sunken ship, still running its old parameters: turret accuracy ×1.12 overall plus +6% single-shot damage for all weapons. It remembers its previous owner\'s shooting habits.' },
  'mod-wh-g-ballistic': { name: 'Wraith Ballistic Corrector', description: 'A ballistic computer with no master: +22% single-shot damage for kinetic weapons and +22% kinetic weapon range, for 60 CPU. The deadarmy\'s guns are all salvaged kinetic pieces, so the corrector honors that family too.' },
  'mod-wh-g-hull': { name: 'Squidwasp Hull Layer', description: 'A structure layer recast from the family\'s own wreckage: cuts a 28% gap into structure resistance for all three types, +18% armor capacity, and +80% structure for this ship\'s drones. The deadarmy has no whole ships, only salvaged bones — and its salvaged drones are the same.' },
  'mod-wh-g-turret': { name: 'Deadarmy Wreck Cannon', description: 'Three wrecked guns rebuilt into one: more than double the single-shot damage of a Siege Turret MK3, with accuracy of only 0.75 — it has passed through too many hands, and the rifling wore out long ago.' },
  'mod-wh-g-prop': { name: 'Wraith Thruster', description: 'A drive section with no exhaust trail: +85% combat speed and no penalty to accuracy. The wraith way is to close in without a sound.' },
}

/**
 * 物品（86 · `docs/glossary-en.md` §八）—— **名称 + 说明**。
 * 说明逐条译自中文原文；谜质装置「占货仓 2×2 格，离开虫洞即失效（撤离成功则析出虫洞谜质）」等重复尾句
 * 统一复用一句英文（`T_WORM` / `T_WORM_SELF`），不再逐条重译。
 */
const T_WORM = ' Takes 2×2 cargo slots; inactive outside the wormhole (a successful extraction yields Wormhole Enigma).'
const T_WORM_SELF =
  ' Takes 2×2 cargo slots itself; inactive outside the wormhole (a successful extraction yields Wormhole Enigma).'

export const EN_ITEMS: EnTable = {
  // 原矿
  'ore-veldspar': { name: 'Peridotite', description: 'The most common low-grade ore, found all across the starter systems — your first real payday.' },
  'ore-scorched': { name: 'Gabbro', description: 'A dense ore wrapped in lava rock; a key source of Silvervein Supermetal and Crystalline Colloid.' },
  'ore-hemorphite': { name: 'Redring Ore', description: 'High-value ore inside the red rings: longer routes, richer returns.' },
  'ore-glowstone': { name: 'Glowcloud Ore', description: 'A dense, faintly glowing rock layer; the main carrier of Isotope Polycrystal — high-grade output from the ring-core fields.' },
  'ore-sunshard': { name: 'Dawnshard Crystal', description: 'Crystal ore whose facets catch the dawn; a rich seam of high-purity Isotope Polycrystal.' },
  'ore-voidshard': { name: 'Voidcrystal', description: 'Black crystal condensed in deep-space rifts; the mother ore of Darkiron Alloy.' },
  'ore-nebulite': { name: 'Starwraith Ore', description: 'A legendary ore found only in veins deep inside nebulae — one hold buys a ship.' },
  'ore-voidmother': { name: 'Voidmother Ore', description: 'Black mother-rock grown in deep-space rifts; refined into Void Crystal.' },
  // 精炼产物
  'min-tritanium': { name: 'Tritanium Alloy', description: 'The basic material of ship armor: plentiful and price-stable.' },
  'min-pyerite': { name: 'Silvervein Supermetal', description: 'A common material for structure and electronic components.' },
  'min-mexallon': { name: 'Crystalline Colloid', description: 'Material for high-end equipment and shield modules.' },
  'min-nocxium': { name: 'Heavy Tungsten Alloy', description: 'A rare material and the core of flagship-grade components.' },
  'min-isotope': { name: 'Isotope Polycrystal', description: 'The refining core of the Glowcloud and Dawncrystal strata: entry-level material for high-end industry.' },
  'min-starcore': { name: 'Starcore Crystal', description: 'Crystallized starcore marrow; required for MK3 equipment and flagship hull frames.' },
  'min-darkiron': { name: 'Darkiron Alloy', description: 'A heavy alloy only Voidcrystal and Darkstar Ice can refine — the mark of top-tier industry.' },
  'min-voidcrystal': { name: 'Void Crystal', description: 'The rarest material in the universe; only legendary manufacturing projects can afford it.' },
  // 气体 / 冰矿
  'gas-neon': { name: 'Neon Cloud Gas', description: 'A neon-helium cloud from low-gravity gas fields: easy to harvest, and a key source of Isotope Polycrystal.' },
  'gas-phosphor': { name: 'Phosphor Haze', description: 'Corrosive phosphor haze settled deep in the graveyards — a rare gas deposit of very high refining value.' },
  'gas-ionstorm': { name: 'Ionstorm Cloud', description: 'Pure Starcore Crystal condenses inside the raging ion stream — only those who dare enter get it.' },
  'gas-aurora': { name: 'Aurora Cloud', description: 'Aurora particle clouds; legend says a mix of Darkiron and Starcore settles within.' },
  'ice-frost': { name: 'Bluefrost Ice', description: 'Fragments of blue-white ice rings; the ice locks in high-purity Isotope Polycrystal.' },
  'ice-marrow': { name: 'Frostmarrow Ice', description: 'Ancient ice with marrow-like veining deep in the core; notable Starcore Crystal deposits.' },
  'ice-darkstar': { name: 'Darkstar Ice', description: 'Light-swallowing black ice crystal — a treasure found only deep in Darkstar Ice Rings.' },
  // 弹药
  'ammo-kinetic-l': { name: 'Kinetic Ammo', description: 'Kinetic ammo: solid high-velocity rounds, shield-breaker (×1.5 vs shields, ×0.75 vs armor).' },
  'ammo-explosive-l': { name: 'Explosive Ammo', description: 'Explosive ammo: missile-launcher rounds, armor-cracker (×1.5 vs armor, ×0.75 vs shields). Missiles ignore the blind zone and do not lose accuracy with range.' },
  'ammo-plasma-l': { name: 'Energy Ammo', description: 'Energy ammo: high-energy cells for laser cannons — beams always hit; ×1.25 vs shields, ×1 vs armor and hull.' },
  'ammo-kinetic-2': { name: 'Kinetic Ammo MK2', description: 'Kinetic ammo MK2: dense armor-piercing cores in solid high-velocity rounds, shield-breaker (×1.5 vs shields, ×0.75 vs armor). Advanced ammo for hard targets.' },
  'ammo-explosive-2': { name: 'Explosive Ammo MK2', description: 'Explosive ammo MK2: two-stage shaped-charge rounds for missile launchers, armor-cracker (×1.5 vs armor, ×0.75 vs shields). Missiles ignore the blind zone and do not lose accuracy with range.' },
  'ammo-plasma-2': { name: 'Energy Ammo MK2', description: 'Energy ammo MK2: high-density charged cells — beams always hit; ×1.25 vs shields, ×1 vs armor and hull. Advanced rounds for laser cannons.' },
  // 无人机
  'drone-scout': { name: 'Hummingbird Scout Drone', description: 'Light scout drone: kinetic bursts (shield-breaker). A light airframe — the highest evasion, the thinnest armor.' },
  'drone-assault': { name: 'Redkite Combat Drone', description: 'Light combat drone: explosive strikes (armor-cracker). Balanced stats — the workhorse of the swarm.' },
  'drone-heavy': { name: 'Falcon Siege Drone', description: 'Heavy siege drone: energy pulses (universal). Thick armor and heavy hits — the most HP, the lowest evasion.' },
  'drone-sentry': { name: 'Thundergull Sentry Drone', description: 'Sentry drone: a heavy energy battery with very long reach — but the farther the target, the harder the hit. A light airframe, about as survivable as a scout.' },
  'drone-exile-bee': { name: 'Squidwasp Drone', description: 'A scout drone the exiles pieced together from wreck hangars: double the punch of a standard scout, a lighter airframe, and cheaper to launch. The price is the thinnest three-layer HP — one hit and it is gone.' },
  'drone-wh-c-heavy': { name: 'Hiveguard Siege Drone', description: 'A living siege drone of the hive: spore-burst warheads crack armor; its three-layer HP is thicker than a standard siege drone and leans to carapace, and its armor and structure resistances are tougher — at the cost of being clumsier.' },
  'drone-wh-e-sentry': { name: 'Construct Sentry Drone', description: 'A long-needle sentry the megastructure assembles itself: kinetic needles break shields, with longer reach than a standard sentry, better accuracy, slower falloff and a slightly thicker frame — it shoots the farthest of the swarm.' },
  // 修理组件
  'repairkit-civ': { name: 'Civilian Repair Kit', description: 'Nano repair kit: a base 5 HP restored (structure and armor each scale with this value × capacity bonus × Quick Hull Repair — thicker plates and skills restore more). For emergencies in the field or before docking.' },
  // 零件（2026-09-20 零件体系：基础 7 直接可造 / 高级 7 需蓝图）
  'part-circuit': { name: 'Circuit Board', description: 'Basic electronic component: a general-purpose board pressed from supermetal and gel — the base layer of advanced parts and exclusive gear.' },
  'part-armor-plate': { name: 'Armor Plate', description: 'Basic structural component: tritanium forged into plate, the standard cladding of ships and heavy equipment.' },
  'part-frame': { name: 'Structural Frame', description: 'Basic structural component: a standardized load-bearing frame, the common member of hulls and station construction.' },
  'part-cable': { name: 'Superconducting Cable', description: 'Basic electronic component: low-loss superconducting wiring, the vessels of shield and energy systems.' },
  'part-coolant': { name: 'Coolant Duct', description: 'Basic heat component: tritanium-clad gel piping, standard issue for hot-running equipment.' },
  'part-gyro': { name: 'Gyro Stabilizer Mount', description: 'Basic mobility component: a heavy-tungsten steadying base, the skeleton of ship attitude systems.' },
  'part-lens': { name: 'Optical Lens Array', description: 'Basic optical component: gel ground into lenses, the sights of energy weapons and scanning gear.' },
  'part-drone-neural': { name: 'Drone Neural Unit', description: 'Advanced part: a swarm command unit sealed in biomimetic fiber — the thinking core of drones and smart equipment.' },
  'part-shield-gen': { name: 'Shield Generator Unit', description: 'Advanced part: a finished field-strength generator, the core of shield modules and flagship defense arrays.' },
  'part-jet-array': { name: 'Energy Jet Array', description: 'Advanced part: a focusing nozzle array, the high-energy terminal of the energy weapon line.' },
  'part-qchip': { name: 'Quantum Coprocessor Core', description: 'Advanced part: a quantum-state computing die, the source of fire-control and lock-on math.' },
  'part-keel': { name: 'Ship Keel Component', description: 'Advanced part: a starcore-reinforced large load member, the spine of exclusive ships and flagships.' },
  'part-fire-control': { name: 'Military Fire-Control Computer', description: 'Advanced part: a finished ballistic solver, the eyes and fingers of exclusive weapons.' },
  'part-grav-comp': { name: 'Graviton Compensator', description: 'Advanced part: a gravity-distortion compensator, the ultimate member of flagship-grade structures.' },
  'repairkit-mil': { name: 'Military Repair Kit', description: 'Military-grade nano repair kit: a base 10 HP × capacity bonus × Quick Hull Repair. Standard supply for long deep-space expeditions.' },
  // 谜质装置（Enigma Device）—— 尾句统一复用 T_WORM
  'mat-surveyor': { name: 'Deepspace Surveyor', description: 'A survey array condensed from Enigma: while it sits in your hold, scanning covers one extra ring.' + T_WORM },
  'mat-chrono': { name: 'Chrono Core', description: 'A sliver of time peeled out of Enigma: carried in the hold, it adds a stretch of turns to this run.' + T_WORM },
  'mat-crane': { name: 'Salvage Crane', description: 'An Enigma-driven crane arm: every salvage round pulls up one extra pile.' + T_WORM },
  'mat-drill': { name: 'Mining Drill', description: 'A drill bit ground from Enigma: every mining round digs out one extra pile of ore.' + T_WORM },
  'mat-nebula': { name: 'Nebula Disperser', description: 'A gust blown from Enigma: every scan disperses extra nearby nebulae.' + T_WORM },
  'mat-enricher': { name: 'Voidmother Enricher', description: 'An enrichment slot made of Enigma: veins yield more Voidmother Ore.' + T_WORM },
  'mat-expander': { name: 'Hold Expander', description: 'A folding bay held open by Enigma: the hold fits several more slots.' + T_WORM_SELF },
  'mat-suppressor': { name: 'Suppression Field', description: 'A suppression field spread by Enigma: node battles and guardian fights on this layer are lighter.' + T_WORM },
  'mat-boss-analyzer': { name: 'Guardian Analyzer', description: 'Guardian order of battle read from Enigma: the layer guardian is markedly less threatening.' + T_WORM },
  'mat-extract-cover': { name: 'Extraction Cover', description: 'A thin shell condensed from Enigma: only the shape remains; it grants no bonus.' + T_WORM },
  'mat-shield-res': { name: 'Shield Resonance Plate', description: "Shield resonance tuned by Enigma: shields gain resistance to the enemy's main damage type (shield layer only)." + T_WORM },
  'mat-armor-res': { name: 'Armor Reinforcement Plate', description: "An armor layer rearranged by Enigma: armor gains resistance to the enemy's main damage type (armor layer only)." + T_WORM },
  'mat-hull-res': { name: 'Hull Reinforcement Plate', description: "Enigma woven into the hull frame: structure gains resistance to the enemy's main damage type (structure layer only)." + T_WORM },
  'mat-tracker': { name: 'Tracking Array', description: 'A tracking array calibrated by Enigma: the formation hits more often.' + T_WORM },
  'mat-gyro': { name: 'Gyro Stabilizer', description: 'An Enigma gyro makes the hull harder to pin: formation evasion increases.' + T_WORM },
  'mat-jammer': { name: 'Jammer Emitter', description: 'Enigma noise covers your signature: enemies shoot less accurately.' + T_WORM },
  'mat-rangefinder': { name: 'Rangefinder Extender', description: 'A rangefinding array stretched by Enigma: all weapons reach farther.' + T_WORM },
  'mat-blindspot': { name: 'Blindspot Suppressor', description: 'Enigma scrambles enemy fire control at point-blank range: the damage share of their close-in shots drops.' + T_WORM },
  'mat-ammo-dmg': { name: 'Ammo Enhancer', description: 'Enigma coats every round: formation single-shot damage increases.' + T_WORM },
  'mat-reload': { name: 'Reload Accelerator', description: 'Enigma buys time for the loading mechanism: weapon reload cycles shorten.' + T_WORM },
  'mat-volley': { name: 'Volley Coordinator', description: 'Enigma takes over salvo assignment: once a salvo kills a ship, surplus fire immediately switches to the next.' + T_WORM },
  'mat-ammo-back': { name: 'Ammo Recovery Unit', description: 'Enigma fishes spent casings and scraps back after the fight: part of the ammo spent this battle is recovered.' + T_WORM },
  'mat-drone-net': { name: 'Drone Recovery Net', description: 'A recovery net woven from Enigma: more drones shot down by point defense are hauled back to the hangar.' + T_WORM },
  'mat-field-repair': { name: 'Field Repair Unit', description: 'Automatically patches armor and structure after exchanges; inactive outside the wormhole (yields Wormhole Enigma on extraction).' },
  'mat-wh-essence': { name: 'Wormhole Enigma', description: 'A strange material found inside wormholes, spent as research material; can also be sold to recyclers per piece. Cold-glowing crystals in a sealed case.' },
  // 货柜
  'box-relic-a': { name: 'Ruins Safe Container (Pirate)', description: 'A whole container dragged out of the ruins: a locked shell with its markings ground off. Only unboxing back at the station reveals what is inside. Takes 2×2 cargo slots.' },
  'box-relic-c': { name: 'Ruins Safe Container (Alien)', description: 'A container dragged out of the ruins: dried biological film clings to its shell. Only unboxing back at the station reveals what is inside. Takes 2×2 cargo slots.' },
  'box-relic-d': { name: 'Ruins Safe Container (Gravekeeper)', description: "A container dragged out of the ruins: the seal still bears the gravekeeper's mark. Only unboxing back at the station reveals what is inside. Takes 2×2 cargo slots." },
  'box-relic-e': { name: 'Ruins Safe Container (Titan)', description: "A container dragged out of the ruins: its shell is the megastructure's own alloy and the port is still on standby. Only unboxing back at the station reveals what is inside. Takes 2×2 cargo slots." },
  'box-relic-g': { name: 'Ruins Safe Container (Deadarmy)', description: 'A container dragged out of the ruins: the body was chewed by the swarm and welded back. Only unboxing back at the station reveals what is inside. Takes 2×2 cargo slots.' },
  'box-bp-shallow': { name: 'Blueprint Container (Shallow)', description: 'A long container dragged out of the ruins: a standard serial number on the shell and the port still warm. Only unboxing back at the station reveals which blueprint is inside. Takes 2×1 cargo slots.' },
  'box-bp-mid': { name: 'Blueprint Container (Mid)', description: 'A long container dragged out of the ruins: the serial number has been half ground away, and it is far heavier than the shallow kind. Takes 2×1 cargo slots.' },
  'box-bp-deep': { name: 'Blueprint Container (Deep)', description: "A long container dragged out of the ruins: the nameplate still carries its old owner's ship crest, and the seal is intact. Takes 2×1 cargo slots." },
  'box-valuables': { name: 'Valuables Container', description: 'A soft case covered in seals and tamper marks: luxury goods bound for auction. Only opening it shows what the case is worth.' },
  'box-military': { name: 'Military Supply Container', description: 'A standard arms crate with a unit number still on the seal. Unboxing yields a full set of top-grade equipment — weapons and components mixed.' },
  // 奢侈品
  'lux-1': { name: 'Starport Vintage', description: 'Vintage stock marked up double in the docking-bay lounge: which station it came from hardly matters — the year and the wax seal set the price.' },
  'lux-2': { name: 'Noble Spice', description: 'A spice that grows in only a few systems and is hard currency in noble kitchens — sold by the gram in moisture-proof tins.' },
  'lux-3': { name: 'Lost Artwork', description: 'An old-era original scattered by war: the auction house rules on authenticity, and whoever bids sets the price.' },
  'lux-4': { name: 'Aged Cigars', description: 'Hand-rolled cigars sealed in a humidified wooden box: what is really worth money is the hand-numbered slip at the bottom, not the leaf.' },
  'lux-5': { name: 'Exotic Textiles', description: 'A full length of cloth woven only on zero-gravity looms: the pattern shifts with the angle of light, and one bad cut can never be joined again.' },
  'lux-6': { name: 'Aromatic Wood Carving', description: 'A piece carved from a single block of aromatic wood, with only one chance at each cut — auction houses judge the blade work, not the timber.' },
  'lux-7': { name: 'Court Sheet Music', description: 'A hand-copied full score with the original margin notes still in place: collectors are bidding for those few pencil lines.' },
  'lux-8': { name: 'Ancient Balm', description: 'A balm blended to a long-lost formula; one jar lasts three uses — the formula is worth far more than the jar.' },
  'lux-9': { name: 'Original Star Chart', description: 'A hand-drawn star chart original, its ink marking several routes no longer navigable: voyage historians pay by the sheet.' },
  'lux-10': { name: 'Crown Diamond', description: 'The principal diamond from a collapsed royal vault, with full provenance papers — with papers or without, the price halves.' },
  // AI 核心
  'ai-core-gamma': { name: 'Gamma AI Core', description: 'A compute core pulled from a ruins console: the shell is scorched and the core still hums. Takes 1 cargo slot; docks into the core library after a successful extraction.' },
  'ai-core-beta': { name: 'Beta AI Core', description: 'A compute core from a ruins mainframe cabinet: the heat fins are intact, and the factory number has been deliberately ground off. Takes 1 cargo slot; docks into the core library after a successful extraction.' },
  'ai-core-alpha': { name: 'Alpha AI Core', description: 'The one enshrined deepest in the ruins: a single cold-cast alloy shell, cold to the touch. Takes 1 cargo slot; docks into the core library after a successful extraction.' },
}

/** 技能（79 · `docs/glossary-en.md` §九）—— **名称 + 说明**（说明逐条译自中文原文；`⟦⟧` 高亮标记照留） */
export const EN_SKILLS: EnTable = {
  'spaceship-command': { name: 'Spaceship Command', description: 'Basic handling training for every hull. Travel speed-up: each level shortens star-map travel time by a further ⟦2%⟧ (multiplies with the three navigation skills; applies to all ships).' },
  navigation: { name: 'Navigation', description: 'Faster route plotting and sublight maneuvering. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'warp-drive-operation': { name: 'Warp Drive Operation', description: 'Tuning and maintenance of warp drives. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'acceleration-control': { name: 'Acceleration Control', description: 'Acceleration and deceleration control in the warp entry and exit phases. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'mining-frigate': { name: 'Mining Frigate', description: 'Mining laser tuning and work-flow basics: each level shortens the mining cycle by ⟦3%⟧.' },
  'industrial-ops': { name: 'Industrial Ship Operations', description: 'Specialized piloting of the mining hull family: +⟦4%⟧ mining yield per level while flying a mining ship.' },
  'armed-ops': { name: 'Armed Ship Operations', description: 'Specialized piloting of armed hulls: +⟦3%⟧ single-shot damage per level for all weapons including the base cannon (max +⟦15%⟧; multiplies with Gunnery and weapon-family specializations).' },
  'armored-ops': { name: 'Armored Ship Operations', description: 'Specialized piloting of armored hulls: +⟦4%⟧ armor and structure capacity per level while flying an armored ship (max +⟦20%⟧; multiplies with Hull Upgrades and Armor Thickening Plates; shields unaffected). Thicker capacity also raises repair kit and hull repair unit output by the same ratio.' },
  'vector-maneuvering': { name: 'Vector Maneuvering', description: 'Vector nozzle handling: +⟦5%⟧ combat speed per level (max +⟦25%⟧; multiplies with thruster burn bonuses; star-map travel speed is unaffected).' },
  'evasion-maneuvering': { name: 'Evasive Maneuvering', description: 'Evasive maneuvering training: the chance of being hit drops by ⟦5%⟧ per level (at max about 75% of the unskilled value; multiplies with Attitude Gyro evasion bonuses).' },
  'targeting-integration': { name: 'Targeting Integration', description: '+⟦2%⟧ turret and missile launcher accuracy per level (max +⟦10%⟧; relative multiplication, stacking with Fire Control; lasers always hit and are unaffected).' },
  mining: { name: 'Mining', description: 'Core mining technique: +⟦6%⟧ cycle yield for ore, gas and ice (multiplies with Astrogeology and Deep Space Harvesting).' },
  'deep-space-harvesting': { name: 'Deep Space Harvesting', description: 'Rare resource harvesting: +⟦5%⟧ cycle yield for gas and ice (common ore unaffected).' },
  refining: { name: 'Refining', description: 'Refinery output multiplier: +⟦6%⟧ per level (base ⟦120%⟧; with no skill, refining nets about twenty percent; with Reprocessing maxed as well, ⟦165%⟧ in total).' },
  reprocessing: { name: 'Reprocessing', description: 'Further raises the refinery output multiplier: +⟦3%⟧ per level (with Refining maxed as well, ⟦165%⟧ in total).' },
  industry: { name: 'Industry', description: 'Core manufacturing theory: each level shortens blueprint build time by ⟦4%⟧ (multiplies with Batch Production).' },
  materials: { name: 'Materials', description: 'Refined manufacturing: each level cuts blueprint material cost by ⟦1.5%⟧ (max −⟦7.5%⟧; multiplies with Component Standardization).' },
  'industrial-automation': { name: 'Production Cadence', description: 'Line cadence optimization: refinery and assembler cycles shorten by ⟦5%⟧ per level (max −⟦25%⟧; applies to manual and AI-core operation alike, and multiplies with Core Smelting and Batch Production).' },
  'industrial-ai-cap-basic': { name: 'Industrial Automation Basics', description: 'Automated line basics (the foundation course of Industrial Automation): AI-core-driven station refineries, recyclers and manufacturing lines gain +⟦1⟧ industry-only work slot per level beyond the shared AI core cap (max +⟦5⟧; applies to station industry only and does not raise the AI auxiliary task cap; stacks with Industrial Automation).' },
  'industrial-ai-cap': { name: 'Industrial Automation', description: 'Automated line expansion: AI-core-driven station refineries, recyclers and manufacturing lines gain +⟦2⟧ industry-only work slots per level beyond the shared AI core cap (max +⟦10⟧; applies to station industry only and does not raise the AI auxiliary task cap; every slot still uses one physical AI core).' },
  'astro-geology': { name: 'Astrogeology', description: 'Advanced study of rock strata: a further +⟦4%⟧ yield for all mining per level (multiplies with Mining).' },
  'deep-hole-blasting': { name: 'Deep-hole Blasting', description: 'Blasting optimization in shallow belts: +⟦6%⟧ yield for low-grade ore (Peridotite / Gabbro / Redring Ore) per level.' },
  'rich-vein-prospecting': { name: 'Rich Vein Prospecting', description: 'Vein assessment and enrichment tracking: the chance to find a rich vein while mining is ×⟦1.2⟧ per level (base ⟦3%⟧ per minute; a find multiplies yield by ⟦3⟧ for the next 2 cycles).' },
  'core-smelting': { name: 'Core Smelting', description: 'Refinery temperature control and stirring: each level shortens the manual refining batch cycle by ⟦4%⟧ (AI-core operation is unaffected).' },
  'furnace-expansion': { name: 'Furnace Expansion', description: 'Refinery chamber rework: +⟦6%⟧ manual refining batch size per level (AI-core operation is unaffected).' },
  'batch-production': { name: 'Batch Production', description: 'Multi-slot assembly scheduling: blueprint build time drops a further ⟦3%⟧ per level (multiplies with Industry).' },
  'component-standardization': { name: 'Component Standardization', description: 'Standardized common components: blueprint material cost drops a further ⟦0.8%⟧ per level (multiplies with Materials).' },
  'ai-servicing': { name: 'Auxiliary Ship Servicing', description: 'Mining equipment servicing on AI auxiliaries: each level shortens the auxiliary mining cycle by ⟦3%⟧ (multiplies on top of AI core efficiency).' },
  'offline-ops': { name: 'Offline Operations', description: 'Unattended operation scheduling: +⟦20%⟧ offline settlement duration per level (8 hours base, 16 hours maxed).' },
  'unattended-dispatch': { name: 'Unattended Dispatching', description: 'Unattended operation coordination: +⟦40%⟧ offline settlement duration per level (8 hours base, 24 hours maxed; stacks with Offline Operations).' },
  'station-engineering': { name: 'Station Engineering', description: 'Outpost engineering standards: −⟦8%⟧ construction materials per level (max −⟦40%⟧).' },
  'salvage-recycling': { name: 'Salvage Recycling', description: 'Wreck reprocessing (refinery wreck breakdown) batch optimization: −⟦4%⟧ batch cycle per level (manual and AI-core operation alike).' },
  'salvage-rigging': { name: 'Salvage Rigging', description: 'Salvager maintenance and tuning: each level shortens the salvager cycle by ⟦3%⟧ (applies to the player ship and AI alike).' },
  'wreck-assaying': { name: 'Wreck Assaying', description: "Wreck valuation: the chance to find an intact hull while salvaging is ×⟦1.2⟧ per level — an intact hull no longer converts to volume but yields one complete piece of equipment from that formation's recycling pool on the spot (Low-sec space can yield higher-grade pieces)." },
  'salvage-refining': { name: 'Salvage Refining', description: 'Recovery refining: +⟦8%⟧ guaranteed raw material output from wreck recycling per level (max +40% in total).' },
  'part-forming': { name: 'Part Forming', description: 'Forming schedules for basic parts (circuit boards, armor plates, frames and more): basic part build time −⟦8%⟧ per level (max −⟦40%⟧).' },
  'precision-assembly': { name: 'Precision Assembly', description: 'Precision assembly of advanced parts (drone neural units, shield generators and more): advanced part build time −⟦8%⟧ per level (max −⟦40%⟧).' },
  gunnery: { name: 'Gunnery', description: 'Basic shipboard weapons training: +⟦5%⟧ real-time combat single-shot damage per level (applies to all three weapon forms and the base cannon; multiplies with family specialization skills).' },
  'kinetic-gunnery': { name: 'Kinetic Gunnery', description: 'Kinetic weapon (turret) specialization: +⟦5%⟧ single-shot damage per level (stacks multiplicatively with Gunnery).' },
  'missile-launching': { name: 'Missile Launching', description: 'Missile launcher specialization: +⟦5%⟧ single-shot damage for explosive ammo per level (stacks multiplicatively with Gunnery; tracking accuracy and the blind-zone safe range are unaffected).' },
  'laser-cannon': { name: 'Laser Cannon', description: 'Laser cannon specialization: +⟦5%⟧ single-shot damage for energy beams per level (stacks multiplicatively with Gunnery; the always-hit property is unaffected).' },
  'fire-control': { name: 'Fire Control', description: 'Fire-control computation: +⟦3%⟧ turret and missile launcher accuracy per level (relative multiplication; lasers always hit and are unaffected).' },
  'reload-drills': { name: 'Reload Drills', description: 'Loader crew training: −⟦4%⟧ reload time for turrets, missile launchers and laser cannons per level.' },
  'drone-warfare': { name: 'Drone Warfare', description: 'Drone combat coordination: +⟦5%⟧ drone single-shot damage per level (multiplies with tactical control modules; drones ignore Gunnery and weapon-family skills).' },
  'ammunition-condensing': { name: 'Ammunition Condensing', description: 'Magazine organization and load planning: +⟦8%⟧ pre-loaded ammo on departure per level (max +⟦40%⟧).' },
  'drone-servicing': { name: 'Drone Servicing', description: 'Deck servicing and re-launch optimization: −⟦4%⟧ drone reload time per level (Reload Drills covers only turrets, missile launchers and laser cannons; the two multiply independently).' },
  'drone-strike': { name: 'Drone Strike', description: 'Swarm strike tactics: a further +⟦4%⟧ drone single-shot damage per level (stacks multiplicatively with Drone Warfare and tactical control modules).' },
  'drone-durability': { name: 'Drone Durability', description: 'Reinforced frames and redundant wiring (basic tier): +⟦4%⟧ drone three-layer HP (shield / armor / structure) per level (max +⟦20%⟧, scaling the whole HP bar directly).' },
  'drone-reinforce': { name: 'Drone Reinforcement', description: 'High-strength frames and redundant structure (advanced tier): a further +⟦6%⟧ drone three-layer HP per level (max a further +⟦30%⟧, stacking multiplicatively with Drone Durability).' },
  'drone-recovery': { name: 'Drone Recovery', description: 'Wreck salvage and frame overhaul: +⟦6%⟧ recovery of damaged drones after a battle per level (base ⟦20%⟧ → ⟦50%⟧ maxed; recovered frames return to the bay and keep flying).' },
  'drone-evasion': { name: 'Drone Evasion', description: 'Swarm evasive training: +⟦2%⟧ drone evasion per level (max +⟦10%⟧, relative multiplication, evasion cap ⟦90%⟧; especially effective against point defense).' },
  'shield-operation': { name: 'Shield Operation', description: 'Shield maintenance and recharge planning: +⟦4%⟧ shield capacity per level (max +⟦20%⟧; multiplies with shield extender modules).' },
  'shield-tuning': { name: 'Shield Tuning', description: 'Shield resonance tuning: +⟦2%⟧ resistance to all types per level (cap ⟦90%⟧; stacks with shield amplifiers of the same kind, with diminishing returns from multiple sources).' },
  'energy-management': { name: 'Energy Management', description: 'Ship power feed tuning: +⟦3%⟧ laser cannon single-shot power per level (max +⟦15%⟧; stacks multiplicatively with Laser Cannon).' },
  'hull-upgrades': { name: 'Hull Upgrades', description: 'Hull structural reinforcement: +⟦4%⟧ armor and structure capacity per level (max +⟦20%⟧; multiplies with Armor Thickening Plates). Thicker capacity also raises repair kit and hull repair unit output by the same ratio.' },
  'armor-tuning': { name: 'Armor Tuning', description: 'Armor lattice micro-tuning: +⟦2%⟧ resistance to all types per level (cap ⟦90%⟧; stacks with armor plating of the same kind, with diminishing returns from multiple sources).' },
  'repair-engineering': { name: 'Repair Engineering', description: 'Ship repair craft: −⟦10%⟧ station repair cost per level (stacks multiplicatively with Station Protocol); also +⟦5%⟧ repair kit restoration per level (same effect as Quick Hull Repair, added per level; hull repair units count per tick as well).' },
  'hull-quick-repair': { name: 'Quick Hull Repair', description: 'Emergency patching: +⟦5%⟧ restoration when using repair kits per level (max +⟦25%⟧) — hull repair units count per tick in combat as well.' },
  'station-protocol': { name: 'Station Protocol', description: 'Station service negotiation: −⟦5%⟧ station repair cost per level (stacks multiplicatively with Repair Engineering).' },
  'ai-expert': { name: 'AI Core Operation', description: 'AI core interfacing and command framework: +⟦1⟧ simultaneously active AI core per level (AI auxiliary tasks and station refineries, recyclers and manufacturing lines share this cap).' },
  'ai-core-dispatch': { name: 'AI Core Dispatch', description: 'Multi-core load scheduling and coordination: +⟦2 percentage points⟧ efficiency per level for all AI-core-driven work (AI auxiliary tasks and station refineries, recyclers and manufacturing lines; added on top of the core tier, e.g. a basic core at 40% → ⟦50%⟧ maxed).' },
  'accelerated-learning': { name: 'Accelerated Learning', description: 'Neural circuit training: −⟦4%⟧ training time for all skills per level (max −⟦20%⟧).' },
  'ship-systems-engineering': { name: 'Ship Systems Engineering', description: 'Ship power and circuit layout: +⟦5%⟧ hull CPU per level (max +⟦25%⟧; raises only the total budget for fitting and drone launches, not the CPU cost of individual modules).' },
  accounting: { name: 'Accounting', description: 'Trade tax relief: −⟦8%⟧ trade tax on sales per level (stacks multiplicatively with Trade Negotiation).' },
  'trade-negotiation': { name: 'Trade Negotiation', description: 'Association channel negotiation: a further −⟦8%⟧ trade tax per level (stacks multiplicatively with Accounting).' },
  'bounty-hunting': { name: 'Bounty Hunting', description: 'Bounty assessment and Association channels: +⟦8%⟧ bounty payout per level (max +⟦40%⟧, multiplied on top of the random roll).' },
  marketing: { name: 'Marketing', description: 'Cargo presentation and channel sales: +⟦1.2%⟧ market sale settlement price per level (max +⟦6%⟧, multiplied with Association standing bonuses).' },
  'source-sweeping': { name: 'Source Sweeping', description: 'Supply-chain intelligence network: rare and limited market orders refresh ×⟦1.1⟧ per level (about ×⟦1.5⟧ maxed).' },
  'secondhand-market': { name: 'Secondhand Market', description: 'Secondhand market channels: −⟦2%⟧ supply price of rare market goods per level (max −⟦10%⟧).' },
  'signal-analysis': { name: 'Signal Analysis', description: 'Unknown signal interpretation and locking: −⟦8%⟧ local and wormhole scan window per level (max −⟦40%⟧).' },
  cartography: { name: 'Cartography', description: 'Route calibration and jump window optimization: −⟦6%⟧ local and wormhole scan window per level (max −⟦30%⟧; stacks multiplicatively with Signal Analysis and Signal Filtering).' },
  'signal-filtering': { name: 'Signal Filtering', description: 'Interference suppression and signal purification: a further −⟦6%⟧ local and wormhole scan window per level (stacks multiplicatively with Signal Analysis).' },
  'galactic-happenings': { name: 'Galactic Happenings', description: 'A nose for curiosities: −⟦8%⟧ interval between online random events per level (about sixty percent of the base at max); the chance of a random event on departure is ×⟦1.15⟧ per level; the wormhole scan window shortens by ⟦4%⟧ per level (max −⟦20%⟧).' },
  'event-dividend': { name: 'Event Dividend', description: 'Turning every coincidence into income: +⟦15%⟧ cash from random events per level; luck reaches into wormholes too — the chance of an empty location in the hole is relatively cut by ⟦4%⟧ per level (max −⟦20%⟧).' },
  'chart-archive': { name: 'Chart Archive', description: 'Deep-space charts and wormhole archives: +⟦2⟧ wormholes that can be kept on the star map per level (max +⟦10⟧, from 5 to 15).' },
  'salvage-diving': { name: 'Salvage Diving', description: 'Wreck salvage and loot collection: +⟦12%⟧ expedition loot volume and salvage yield per level (applies to the player ship and AI alike).' },
  'seizure-appraisal': { name: 'Seizure Appraisal', description: 'Loot appraisal and fencing channels: +⟦10%⟧ credits seized from Low-sec repulses and victories per level.' },
  'lowsec-survival': { name: 'Low-sec Survival', description: 'Staying alive in dangerous space: −⟦12%⟧ cap on Low-sec losses per level (max −⟦60%⟧, covering cargo and cash alike).' },
  'deep-space-logistics': { name: 'Deep Space Logistics', description: 'Deep-space logistics and hold planning: +⟦4%⟧ fleet-wide cargo capacity per level (max +⟦20%⟧; multiplies with cargo expanders and Hold Management).' },
  'hauler-ops': { name: 'Hauler Operations', description: 'Specialized piloting of the hauler family: +⟦5%⟧ cargo capacity per level while flying a hauler.' },
  compression: { name: 'Compression', description: 'Raw material compression: −⟦6%⟧ hold volume for ore, gas and ice per level (max −⟦30%⟧).' },
  'hold-management': { name: 'Hold Management', description: 'Hold planning and stowage: a further +⟦3%⟧ fleet-wide cargo capacity per level (stacks multiplicatively with Deep Space Logistics).' },
}

/**
 * 残骸（26 = 13 组 × 普通/稀有 · `packages/core/src/wreckGroups.ts` 的组名派生）：
 * 中文侧名 = `组名` / `组名（稀有版）`，id = `wreck-<组key>` / `wreck-rare-<组key>`。
 * 英文按「<族> Wreck / Rare Wreck（<区>）」——区 = High-sec / Low-sec / Wormhole（与 §九 技能 `Low-sec Survival` 同口径）。
 */
/**
 * 残骸（26 = 13 组 × 普通/稀有 · `packages/core/src/wreckGroups.ts` 的组名派生）。
 * 中文侧完全同构 ⇒ **名称与说明都按模板派生**（族名 + 区名两张小表，26 段不重复录入）：
 * - 普通：`<族>（<区>）编队的舰体残骸（按 m³ 计舱）：…出售应急，或经精炼炉「残骸回收」拆解…`
 * - 稀有：`<族>（<区>）窝点核心舱段的完好残骸（单件 30 m³）：…必给一件该敌族专属装备或特色装备…`
 */
const WRECK_FAMILY_EN: Readonly<Record<string, string>> = {
  a: 'Pirate',
  b: 'Armed Scavenger',
  c: 'Alien',
  d: 'Gravekeeper',
  e: 'Titan Megastructure',
  g: 'Deadarmy',
}
const WRECK_AREA_EN: Readonly<Record<string, string>> = { hi: 'High-sec', lo: 'Low-sec', wh: 'Wormhole' }

/** 残骸 id → { name, description }（组名/区分/稀有与否全从 id 解出，与中文表同构） */
function wreckEnText(id: string): EnText {
  const m = /^wreck-(rare-)?([a-g])-(hi|lo|wh)$/.exec(id)
  if (!m) throw new Error(`残骸 id 形态不符：${id}`)
  const rare = m[1] !== undefined
  const fam = WRECK_FAMILY_EN[m[2]!]!
  const area = WRECK_AREA_EN[m[3]!]!
  return {
    name: rare ? `${fam} Rare Wreck (${area})` : `${fam} Wreck (${area})`,
    description: rare
      ? `Intact wreck of a ${fam} (${area}) lair core section — 30 m³ per piece. Break it down in the recycler back at the station: beyond guaranteed raw materials it always yields one piece of that foe family's exclusive or themed equipment, plus a batch of high-grade materials.`
      : `${fam} (${area}) formation hull wreckage, measured by m³. Sell it at a station market for scrap in a pinch, or break it down with the refinery's Wreck Recycling — guaranteed raw materials plus a chance of themed loot; breaking it down pays more.`,
  }
}

const WRECK_IDS = [
  'wreck-a-hi',
  'wreck-rare-a-hi',
  'wreck-b-hi',
  'wreck-rare-b-hi',
  'wreck-d-hi',
  'wreck-rare-d-hi',
  'wreck-a-lo',
  'wreck-rare-a-lo',
  'wreck-c-lo',
  'wreck-rare-c-lo',
  'wreck-d-lo',
  'wreck-rare-d-lo',
  'wreck-e-lo',
  'wreck-rare-e-lo',
  'wreck-g-lo',
  'wreck-rare-g-lo',
  'wreck-a-wh',
  'wreck-rare-a-wh',
  'wreck-c-wh',
  'wreck-rare-c-wh',
  'wreck-d-wh',
  'wreck-rare-d-wh',
  'wreck-e-wh',
  'wreck-rare-e-wh',
  'wreck-g-wh',
  'wreck-rare-g-wh',
] as const

export const EN_WRECKS: EnTable = Object.fromEntries(WRECK_IDS.map((id) => [id, wreckEnText(id)]))

/** 异常点 / 敌卡（42 · `docs/glossary-en.md` §十/§十一）—— **名称 + 说明** */
export const EN_ANOMALIES: EnTable = {
  'ano-training': {
    name: 'Proving Grounds Eviction',
    description: "The Deep Space Industry Association's routine clearance order: scavengers have picked over exercise wrecks at the proving grounds for years, and the Association pays per eviction. A standing bounty that can be taken again and again — a new pilot's first long-term contract.",
  },
  'ano-pirate-post': {
    name: 'Frontier Pirate Outpost',
    description: 'A familiar face in the wanted lists: the outpost pirates of the Kor Frontier have raided starter trade routes for years. A standing bounty — win and it settles, and it can be taken again.',
  },
  'ano-abandoned-platform': {
    name: 'Occupied Port Warrant',
    description: 'A long-standing warrant: armed scavengers have squatted on an abandoned mining platform for years, and the Association pays to clear their firing positions.',
  },
  'ano-redring-raiders': {
    name: 'Red Tide Raider Fleet',
    description: 'A veteran raider fleet of the Redring Corridor whose warrant has hung on the Association board for five years — repel its main force to settle, and it can be taken again.',
  },
  'ano-gravekeeper': {
    name: 'Graveyard Gravekeeper',
    description: 'The gravekeeper fleet of the Darkstar Graveyard never rotates, and the Association never withdraws its warrant: repel them once, settle once.',
  },
  'ano-ghost-signal': {
    name: 'Ghost Ship Signal',
    description: 'A case left open a long time: the ghost ship appears and vanishes deep in the red rings. The Association pays a survey bounty for every successful contact — what it is, no one has said clearly to this day.',
  },
  'ano-abyss-guard': {
    name: 'Abyss Gate Guard',
    description: 'The Abyss Gate is manned year-round, and year-round it needs civilian firepower to share the defense. An Association standing bounty: settles per run, with standing granted only on the first win.',
  },
  'ano-titan-wreck': {
    name: 'Titan Wreck Survey',
    description: "An ancient titan wreck lies in the abyssal shipping lane, and the Association has long sought armed-escort surveys and clearance — repel the wreck's guard and the bounty is paid.",
  },
  'ano-auro-raiders': {
    name: 'Auro Armed Wreck Group',
    description: "Storms keep reactivating the armed wrecks of the Auro Waste Ring, so the Association's hunt order stays open: settles per run and can be taken again.",
  },
  'ano-core-section': {
    name: 'Megastructure Core Survey',
    description: 'At the deepest point of the abyssal lane stands an almost intact megastructure — its remaining automation still runs and its sentry swarm still patrols. The Association offers a standing bounty to anyone who can open it up.',
  },
  'ano-starcore-boss': {
    name: 'Starcore Swarm',
    description: 'Something is nesting deep in the Starcore Labyrinth. The Association lists it as a top-tier standing bounty: those who go in must count their lives on the way out.',
  },
  'ano-cinder-siege': {
    name: 'Cinder Siege',
    description: 'The defense line in the Cinder Sector never stops fighting, and the Association has long paid civilian firepower to reinforce it — repel one siege formation, settle one bounty.',
  },
  'ano-echo-haunt': {
    name: 'Echo Remnant',
    description: 'The remnant ships of the Echo Wastes keep "reviving", which the Association blames on leftover automation. A standing clearance order that settles per run.',
  },
  'ano-nadir-static': {
    name: 'Nadir Static Blockade',
    description: "The Nadir is a dead end and the deadarmy's last stronghold. The Association blockades the area year-round and pays for every clearance that breaks the line.",
  },
  'ano-maw-hunt': {
    name: 'Maw Hunt Order',
    description: 'The Star Maw has swallowed too many fleets. The Association pays for anything that weakens its garrison — a standing order that can be taken again.',
  },
  'ano-vault-sentinel': {
    name: 'Vault Sentinel',
    description: 'The gravekeeper fleet of the Vault Necropolis is the oldest armed force still in existence, and the Association lists it as the highest bounty in the sector — no one knows why they still patrol.',
  },
  'ano-voidedge-warden': {
    name: 'Voidsea Warden',
    description: 'The warden of the Voidsea Edge answers only the strong. The Association keeps this top-tier warrant open year-round, waiting for whoever can bring a battle report back alive.',
  },
  'ano-harbor-escort': {
    name: 'New Harbor Convoy Escort',
    description: 'Raids on the trade lanes of the New Harbor Corridor never stop. The Association pays for convoy escort and defense year-round: repel small raiding boats, settle per run — a new pilot\'s first standing contract.',
  },
  'ano-shard-bandits': {
    name: 'Shardbelt Bandit Warrant',
    description: 'In the crystal dust of the Shardbelt hides a band that specializes in robbing dawncrystal freighters. The warrant stays open and can be taken again.',
  },
  'ano-lantern-saboteurs': {
    name: 'Beacon Hunter Bounty',
    description: 'The beacon array of the Lantern Passage has been sabotaged repeatedly, and repairs are costly. The Association pays to hunt down the repeat offenders — this contract stays open.',
  },
  'ano-haze-ambush': {
    name: 'Haze Ambush Clearance',
    description: 'The ionized clouds of the Hazebelt are a natural ambush ground — a raider band has camped on the ring-core route for years. The Association issues a standing clearance order that settles per run.',
  },
  'ano-mirage-hijackers': {
    name: 'Mirage Navigation Hijack',
    description: "The Mirage's gravitational lens makes a natural ambush, and pirates use it to hijack straying merchantmen. The Association pays year-round to clear out these navigation hijackers.",
  },
  'ano-chasm-aberrations': {
    name: 'Chasm Aberration Hunt',
    description: 'Gravitational distortion in the Chasm Deepbelt breeds swarming aberrations that threaten the deep mine shafts. The Association lists them as a standing high-risk hunt order.',
  },
  'enc-pirate-1': {
    name: 'Roaming Pirate Skiff',
    description: 'Low-sec encounter template: a small roaming pirate group (hidden; not shown in the bounty board).',
  },
  'enc-pirate-2': {
    name: 'Ambush Raider Squad',
    description: 'Low-sec encounter template: a medium ambush squad (hidden).',
  },
  'enc-pirate-3': {
    name: 'Fanatic Patrol Group',
    description: 'Low-sec encounter template: a heavy fanatic formation (hidden).',
  },
  'enc-pirate-4': {
    name: 'Deepspace Butcher Fleet',
    description: 'Low-sec encounter template: a high-risk butcher fleet (hidden).',
  },
  // 虫洞敌卡（15，hidden ⇒ 不进悬赏目录，但战斗/虫洞页会显示）
  'wh-pirate-scout': {
    name: 'Raider Detachment',
    description: 'Wormhole encounter: a small raiding detachment (hidden card, spawned by the wormhole only).',
  },
  'wh-pirate-hunt': {
    name: 'Raider Hunt',
    description: 'Wormhole encounter: raider hunters covering each other, one near and one far (hidden card, spawned by the wormhole only).',
  },
  'wh-pirate-warband': {
    name: 'Pirate Warband',
    description: 'Wormhole encounter: a pirate warband with the warlord himself in the line (hidden card, spawned by the wormhole only).',
  },
  'wh-alien-swarm': {
    name: 'Starcore Hunting Swarm',
    description: 'Wormhole encounter: a hunting pack of starcore adults (hidden card, spawned by the wormhole only).',
  },
  'wh-alien-brood': {
    name: 'Spore Brood Tide',
    description: 'Wormhole encounter: spore aberrants leading starcore adults in (hidden card, spawned by the wormhole only).',
  },
  'wh-alien-hive': {
    name: 'Maw Deep Hive',
    description: 'Wormhole encounter: a deep hive where the maw behemoth lairs (hidden card, spawned by the wormhole only).',
  },
  'wh-grave-watch': {
    name: 'Gravekeeper Patrol',
    description: 'Wormhole encounter: a patrol formation left behind by the gravekeepers (hidden card, spawned by the wormhole only).',
  },
  'wh-grave-sentry': {
    name: 'Stasis Sentry Chain',
    description: 'Wormhole encounter: two stasis sentry links, one near and one far (hidden card, spawned by the wormhole only).',
  },
  'wh-grave-throne': {
    name: 'Mausoleum Court',
    description: 'Wormhole encounter: the throne guard at the deepest point of the mausoleum (hidden card, spawned by the wormhole only).',
  },
  'wh-titan-echo': {
    name: 'Titan Echo',
    description: 'Wormhole encounter: a megastructure wreck still discharging, with its sentry swarm (hidden card, spawned by the wormhole only).',
  },
  'wh-titan-missile': {
    name: 'Missile Echo',
    description: 'Wormhole encounter: a missile section still firing salvoes (hidden card, spawned by the wormhole only).',
  },
  'wh-titan-hulk': {
    name: 'Titan Onslaught',
    description: 'Wormhole encounter: a whole megastructure wreck section with its sentry swarm (hidden card, spawned by the wormhole only).',
  },
  'wh-exile-blockade': {
    name: 'Deadarmy Blockade',
    description: 'Wormhole encounter: a blockade squad of the deadarmy (hidden card, spawned by the wormhole only).',
  },
  'wh-exile-swarm': {
    name: 'Echo Swarm',
    description: 'Wormhole encounter: a swarm formed by two echo remnant ships (hidden card, spawned by the wormhole only).',
  },
  'wh-exile-line': {
    name: 'Remnant Battle Line',
    description: "Wormhole encounter: the deadarmy's last battle line with its swarm escort (hidden card, spawned by the wormhole only).",
  },
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
/**
 * **蓝图说明**（135 条 · 中文侧逐条手写、无模板 ⇒ 逐条译；名称仍按产物派生）。
 * 与中文同一条口径：说明只讲"这张图造什么、吃什么料/什么特性"，不写原因解释。
 */
const BP_DESC_EN: Readonly<Record<string, string>> = {
  'bp-miner-1': 'A starter blueprint: assemble your first mining laser from Tritanium Alloy and Silvervein Supermetal.',
  'bp-cargo-1': 'A cargo hold refit plan; Crystalline Colloid makes the sealing lining.',
  'bp-miner-2': 'Resonant drill head plans: a Crystalline Colloid resonance ring plus a Silvervein Supermetal heat sink — a milestone of mid-game industry.',
  'bp-cargo-2': 'Folding hold technology, built around the capacity a Heavy Tungsten Alloy frame provides.',
  'bp-pd-e': 'Point defense gun plans: short range, fast fire, and the only gun that can hit enemy drone swarms.',
  'bp-pd-e-2': 'Uprated point defense gun plans: faster fire, heavier shots, still short-ranged.',
  'bp-pd-e-3': 'Top-tier point defense gun plans: fire rate and shot weight pushed to the limit, range still that short band.',
  'bp-turret-1': 'Light kinetic gun plans that give a mining ship a proper gun of its own.',
  'bp-turret-2': 'Heavy kinetic gun plans with 5.7 km of reach — the go-to long-range suppression gun for any hull.',
  'bp-miner-civ': 'The most basic mining laser plans; slightly cheaper to build than buying off the market, and good for practice.',
  'bp-cargo-civ': 'A starter cargo refit plan: the classic Silvervein Supermetal and Crystalline Colloid recipe.',
  'bp-turret-civ': 'Constabulary-standard cannon plans that let a rookie mining ship look a pirate in the eye.',
  'bp-miner-3': 'Precision mining laser MK3 plans: an Isotope Polycrystal resonance chamber with Starcore Crystal bearings.',
  'bp-cargo-3': 'Folding hold MK3 plans; the spatial lining is die-cast from Starcore Crystal.',
  'bp-turret-3': 'Siege turret MK3 plans: a Darkiron barrel with a Starcore Crystal breech.',
  'bp-ammo-kinetic': 'Kinetic ammo plans: 120 rounds per batch; ×1.5 vs shields, ×0.75 vs armor.',
  'bp-ammo-explosive': 'Explosive ammo line plans: 120 rounds per batch; ×1.5 vs armor, ×0.75 vs shields.',
  'bp-ammo-plasma': 'Energy ammo plans: 120 rounds per batch; ×1.25 vs shields, ×1 vs armor and hull.',
  'bp-ammo-kinetic-2': 'Kinetic ammo MK2 plans: 120 rounds per batch; ×1.5 vs shields, ×0.75 vs armor.',
  'bp-ammo-explosive-2': 'Explosive ammo MK2 line plans: 120 rounds per batch; ×1.5 vs armor, ×0.75 vs shields.',
  'bp-ammo-plasma-2': 'Energy ammo MK2 line plans: 120 rounds per batch; ×1.25 vs shields, ×1 vs armor and hull.',
  'bp-repairkit-civ': 'Civilian repair kit plans: pressed nano repair compound, 5 kits per batch, base 5 HP.',
  'bp-repairkit-mil': 'Military repair kit plans: sealed high-density nano repair agent, 3 kits per batch, base 10 HP.',
  'bp-laser-1': 'An energy beam focusing chamber; lens coating and heat sink decide the beam purity.',
  'bp-laser-2': 'A reinforced energy beam focusing chamber: longer reach, heavier shots.',
  'bp-laser-3': 'The top-grade energy beam focusing chamber: range and penetration cap out the laser line.',
  'bp-missile-1': 'Missile nest and launch rails; the assembler handles guidance fin mounting automatically.',
  'bp-missile-2': 'Reinforced missile nest and launch rails: heavier rounds, longer reach.',
  'bp-missile-3': 'Top-grade missile nest and launch rails: range and single-shot power cap out the missile line.',
  'bp-drone-rack-1': 'A drone deck expansion section with racks, recovery net and power bus all in place.',
  'bp-drone-rack-2': 'An enlarged drone deck expansion section that carries one tier more drones.',
  'bp-drone-rack-3': 'The top-grade drone deck expansion: berths and power headroom both maxed.',
  'bp-drone-tac-1': 'The phased-array computing unit of a tactical control array, with its fire-control data link die-cast in one piece.',
  'bp-drone-tac-2': 'The reinforced phased-array computing unit of a tactical control array: faster and steadier control.',
  'bp-drone-tac-3': 'The top-grade phased-array computing unit: the fire-control data link maxed out.',
  'bp-drone-relay-1': 'The signal relay unit of a guidance relay antenna, amplifying drone command links.',
  'bp-drone-relay-2': 'A dual-band guidance relay antenna with interference filtering pressed into the relay unit.',
  'bp-drone-relay-3': 'A long-range phased-array relay antenna; drone commands can run over inter-ship links.',
  'bp-shield-kin-1': 'Shield generator coil plans (kinetic band tuning), with the magnetic envelope calibrated against ballistic impact.',
  'bp-shield-exp-1': 'Shield generator coil plans (explosive band tuning): shock fronts are torn apart by the phase difference in the deflection field.',
  'bp-shield-pla-1': 'Shield generator coil plans (energy band tuning): high-energy beams are refracted and defocused on the polar layer.',
  'bp-shield-kin-2': 'A kinetic shield amplifier: the magnetic envelope, calibrated against ballistic impact, one step thicker.',
  'bp-shield-exp-2': 'An explosive shield amplifier: shock fronts torn apart by deflection-field phase difference, one step thicker.',
  'bp-shield-pla-2': 'An energy shield amplifier: beams refracted and defocused on the polar layer, one step thicker.',
  'bp-shield-kin-3': 'A kinetic shield amplifier: magnetic envelope calibrated against ballistic impact, resistance maxed.',
  'bp-shield-exp-3': 'An explosive shield amplifier: shock fronts torn apart by deflection-field phase difference, resistance maxed.',
  'bp-shield-pla-3': 'An energy shield amplifier: beams refracted and defocused on the polar layer, resistance maxed.',
  'bp-shield-ext-1': 'A shield capacitor bay: extra storage cells paralleled into the generator bank.',
  'bp-shield-ext-2': 'An enlarged shield capacitor bay with one more parallel storage group.',
  'bp-shield-ext-3': 'The top-grade shield capacitor bay: storage cells and bus capacity both maxed.',
  'bp-shieldchg-1': 'Shield recharge circuit plans: rebuild the generator bank into a time-shared bus that can force a recharge cycle.',
  'bp-shieldchg-2': 'High-power shield recharge circuit plans: a dedicated recharge bus that doubles the shield restored per tick.',
  'bp-shieldchg-3': 'Capital-grade shield recharge circuit plans: one tick brings an empty shield back to fighting strength.',
  'bp-shieldfield-2': 'Shield charge field emitter plans: a wide-area emitter that recharges the whole fleet at once.',
  'bp-shieldfield-3': 'High-power shield charge field plans: a faster cycle lets the field recharge the fleet more often.',
  'bp-armor-kin-1': 'Kinetic-resistant armor plating: layered ceramic sandwiches break up armor-piercing warheads.',
  'bp-armor-exp-1': 'Explosive-resistant armor plating: a honeycomb backing plate vents blast pressure outboard.',
  'bp-armor-pla-1': 'Energy-resistant armor plating: an ablative coating carries beam heat away by vaporizing itself.',
  'bp-armor-kin-2': 'Kinetic-resistant armor plating: layered ceramic sandwiches break up armor-piercing warheads, one step thicker.',
  'bp-armor-exp-2': 'Explosive-resistant armor plating: the honeycomb backing vents blast pressure outboard, one step thicker.',
  'bp-armor-pla-2': 'Energy-resistant armor plating: the ablative coating carries beam heat away, one step thicker.',
  'bp-armor-kin-3': 'Kinetic-resistant armor plating: layered ceramic sandwiches break up armor-piercing warheads — protection caps out the plating line.',
  'bp-armor-exp-3': 'Explosive-resistant armor plating: the honeycomb backing vents blast pressure outboard — protection caps out the plating line.',
  'bp-armor-pla-3': 'Energy-resistant armor plating: the ablative coating carries beam heat away — protection caps out the plating line.',
  'bp-armor-plate-1': 'Composite armor slab: keel-grade plate that trades hold space for survival.',
  'bp-armor-plate-2': 'A thicker composite armor slab, keel-grade stock one step up.',
  'bp-armor-plate-3': 'The top-grade composite armor slab: the thickest layer on the ship, and the biggest hold cost.',
  'bp-prop-1': 'Vector nozzles and attitude control gear: turning no longer relies on the hull\'s attitude wheels alone.',
  'bp-prop-2': 'Afterburning vector nozzles and attitude gear: thrust and turning both improved.',
  'bp-prop-3': 'Top-grade vector nozzles and attitude gear: speed and agility both maxed.',
  'bp-mwd-1': 'Short-burst warp coils and a single-discharge assembly: ten seconds of displacement is enough to claim a position.',
  'bp-mwd-2': 'High-power warp coils and fast-discharge capacitors: in ten seconds the ship outruns anything a vector thruster can catch.',
  'bp-mwd-3': 'Military warp coils and a burst reactor: one ignition is a warp-grade displacement — ten seconds, then a minute of silence.',
  'bp-stab-kin-1': 'Kinetic turret recoil and compensation gear; the spread from sustained fire is squeezed to the minimum.',
  'bp-stab-kin-2': 'Kinetic turret recoil and compensation gear; the spread squeezed one step tighter.',
  'bp-stab-kin-3': 'Kinetic turret recoil and compensation gear; spread squeezed to the minimum in the line.',
  'bp-stab-exp-1': 'Explosive turret recoil and compensation gear: the torque of a nest salvo is absorbed by counterweights.',
  'bp-stab-exp-2': 'Explosive turret recoil and compensation gear: more salvo torque absorbed.',
  'bp-stab-exp-3': 'Explosive turret recoil and compensation gear: salvo torque almost entirely absorbed.',
  'bp-stab-pla-1': 'Energy turret recoil and compensation gear: capacitor pulse oscillation is damped out of the circuit.',
  'bp-stab-pla-2': 'Energy turret recoil and compensation gear: circuit damping one step up.',
  'bp-stab-pla-3': 'Energy turret recoil and compensation gear: circuit oscillation at its lowest in the line.',
  'bp-rof-1': 'Loading arm cam timing plans: the reload beat is far quicker than by hand.',
  'bp-rof-2': 'Reinforced loading arm cams: tighter timing, shorter cycle.',
  'bp-rof-3': 'Top-grade loading arm cams: the reload beat at the mechanical limit.',
  'bp-warpcomp-2': 'Warp field tuning computer: holds the field at a higher energy level for faster interstellar travel. Stacks with diminishing returns.',
  'bp-warpcomp-3': 'Top-grade warp field tuning computer: faster interstellar travel. Stacks with diminishing returns.',
  'bp-track-1': 'Sensor array and signal board: a locked target no longer slips off the fire-control screen.',
  'bp-track-2': 'Reinforced sensor array and signal board: locks faster and steadier.',
  'bp-track-3': 'Top-grade sensor array and signal board: lock speed and stability maxed.',
  'bp-gyro-1': 'Inertial platform and gimbal rings: attitude drift held to milliradians.',
  'bp-gyro-2': 'Reinforced inertial platform and gimbals: drift squeezed one step further.',
  'bp-gyro-3': 'Top-grade inertial platform and gimbals: the steadiest attitude reference in the line.',
  'bp-cpu-1': 'A low-slot compute expansion card that turns idle rack space into usable CPU.',
  'bp-cpu-2': 'Dual-channel compute expansion card: double the compute with no extra rack space.',
  'bp-salvager-1': 'Salvage grapples and cutting tools that turn scrap into recoverable material.',
  'bp-salvager-2': 'Reinforced salvage grapples and cutting tools: one tier more recovered per run.',
  'bp-salvager-3': 'Top-grade salvage grapples and cutting tools: the highest recovery per run in the line.',
  'bp-hullrep-civ': 'Nano repair arms and kit injection lines let armor and structure heal slowly in combat.',
  'bp-hullrep-1': 'Nano repair arms and kit injection lines let armor and structure heal themselves in combat.',
  'bp-hullrep-2': 'Top-grade nano repair arms and injection lines: restoration and frequency both maxed.',
  'bp-lock-1': 'Lock procedure and fire-control linkage, written up as a mass-producible drill for holding a target.',
  'bp-lock-2': 'Reinforced lock procedure: once bitten, a target finds it much harder to shake off.',
  'bp-lock-3': 'Top-grade lock procedure: spotting and biting happen almost in the same instant.',
  'bp-stealth-2': "Presses the whole hull's signature below background noise; the materials are easy to find — the masking procedure is the hard part.",
  'bp-stealth-3': "The top-grade masking procedure: long enough to cross a whole stretch under the enemy's nose, at the cost of nearly all your compute.",
  'bp-wh-a-frag': 'Raider fragment cannon: explosive main segment, kinetic secondary, 20 rounds per cycle.',
  'bp-wh-a-hangar': 'Raider hangar: enlarges the drone bay and speeds up the swarm cycle.',
  'bp-wh-a-prop': 'Raider afterburner: a big speed boost at the cost of accuracy.',
  'bp-wh-a-coat': 'Raider refraction coating: opens up the evasion gap at the cost of all resistances.',
  'bp-wh-a-scan': 'Spoils scan array: accuracy well up, range cut.',
  'bp-wh-a-shield': 'Raider shield cage: shield capacity well up, range cut.',
  'bp-wh-c-laser': 'Bio prism beam: an always-hit plasma beam with better range and falloff than its tier.',
  'bp-wh-c-prism': 'Carapace prism layer: raises armor resistance to kinetic, explosive and plasma together.',
  'bp-wh-c-pulse': 'Bio pulse accelerator: faster reload and a slight speed gain.',
  'bp-wh-c-missile': 'Spore missile nest: explosive warheads with wide spread, but one salvo covers every enemy.',
  'bp-wh-c-frame': 'Chitin frame layer: a large structure boost and a slight speed gain.',
  'bp-wh-d-turret': 'Tombwarden linked cannon: a rapid kinetic gun firing two shots per round, the fastest of its tier.',
  'bp-wh-d-shield': 'Mausoleum shield core: the top-tier core for shield capacity.',
  'bp-wh-d-lock': 'Gravekeeper death knell: damage against a locked target rises markedly.',
  'bp-wh-d-laser': 'Mausoleum prism cannon: an always-hit long-range plasma beam with the longest reach.',
  'bp-wh-d-loader': 'Gravekeeper rapid loader: cuts reload time sharply.',
  'bp-wh-d-steady': 'Mausoleum ballistic inscription: raises kinetic and plasma weapon damage together.',
  'bp-wh-e-dc': 'Megastructure damage control array: kinetic and explosive resistance plus structure strength together.',
  'bp-wh-e-tac': 'Megastructure control tower: a large boost to drone damage and structure strength.',
  'bp-wh-e-cpu': 'Megastructure coprocessor: compute unmatched in its tier, at the cost of slower reloads.',
  'bp-wh-e-pd': 'Megastructure point defense array: shortest range, fastest fire — built to intercept swarms.',
  'bp-wh-e-shield': 'Megastructure shield matrix: shield capacity with kinetic and plasma resistance together.',
  'bp-wh-g-hangar': 'Deadarmy hive dock: the largest berth capacity in the line.',
  'bp-wh-g-fcs': 'Deadarmy fire control: modest gains to both accuracy and damage.',
  'bp-wh-g-ballistic': 'Wraith ballistic corrector: raises kinetic weapon damage and range.',
  'bp-wh-g-hull': "Squidwasp hull layer: lifts all three resistances and structure, and makes this ship's drones tougher.",
  'bp-wh-g-turret': 'Deadarmy wreck cannon: the heaviest single-shot explosive gun, with mid-range reach and rate of fire.',
  'bp-wh-g-prop': 'Wraith thruster: a large speed boost.',
  'bp-lair-g-drone': 'One batch yields 50 Squidwasp drones: twice the punch of a standard scout, and the flightiest airframe.',
  'bp-wh-c-drone': 'One batch yields 50 Hiveguard siege drones: spore-burst warheads crack armor, and their three-layer HP is thicker than a standard siege drone.',
  // 2026-09-20 零件体系（并入 main）：零件蓝图说明（基础/高级两档各一句，同档逐条同文）
  'bp-part-circuit': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-armor-plate': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-frame': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-cable': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-coolant': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-gyro': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-lens': 'Basic part: buildable at the assembly unit right away, no blueprint needed.',
  'bp-part-drone-neural': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-shield-gen': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-jet-array': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-qchip': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-keel': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-fire-control': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-part-grav-comp': 'Advanced part: learn this blueprint first, then build it at the assembly unit.',
  'bp-wh-e-drone': 'One batch yields 50 Construct sentry drones: kinetic needles break shields, with longer reach and better accuracy than a standard sentry.',
}

export const EN_BLUEPRINTS: EnTable = (() => {
  const out: Record<string, EnText> = {}
  for (const bp of BLUEPRINTS) {
    const product = bp.moduleId ? EN_MODULES[bp.moduleId]?.name : bp.itemId ? EN_ITEMS_ALL[bp.itemId]?.name : undefined
    if (!product) continue
    const desc = BP_DESC_EN[bp.id]
    out[bp.id] = desc !== undefined ? { name: `${product} Blueprint`, description: desc } : { name: `${product} Blueprint` }
  }
  return out
})()

/**
 * **舰船蓝图说明**（45 条手译 + `sbp-once-*` 12 条按本体派生——中文侧一次性图纸与普通图纸**逐字同说明**）。
 * 数值（货舱/循环/产量）照抄中文原文，不做本地化换算（单位与千分位与英文侧一致）。
 */
const SBP_DESC_EN: Readonly<Record<string, string>> = {
  'sbp-pioneer': 'Mining corvette; 5,200 m³ hold, 38 units per 9 s cycle — a fifth more output than the Whaleswallow-class.',
  'sbp-whale-king': 'Mining corvette; 7,000 m³ hold, 58 units per 8 s cycle — the peak output of the mining family.',
  'sbp-humpback': 'Mining ship; 19,000 m³ hold, 140 units per 30 s cycle — the flagship of mining output.',
  'sbp-colossal': 'Flagship freighter; 108,000 m³ hold, 129 units per 33 s cycle — a mobile fortress.',
  'sbp-sandcat': 'Mining corvette; a T1 starter with an 800 m³ hold and 10 units per 12 s cycle.',
  'sbp-burrower': 'Mining corvette; a T1 starter with a 1,800 m³ hold and 18 units per 11 s cycle.',
  'sbp-whale': 'Mining corvette; 4,500 m³ hold, 34 units per 10 s cycle — the mining family\'s volume workhorse.',
  'sbp-bowhead': 'Heavy freighter; 26,000 m³ hold, 110 units per 36 s cycle — the backbone of stockpiling.',
  'sbp-falconet': 'Armed frigate; the fastest light-firepower platform at T1.',
  'sbp-shrike': 'Armed frigate; slightly more firepower than the Skipjack-class, at the cost of speed.',
  'sbp-tigershark': 'Armed frigate; a stronger firepower frame, and a familiar sight on deep-space escort duty.',
  'sbp-mako': 'Destroyer; 2,300 m³ hold, 15 units per 13 s cycle — balanced between firepower and capacity.',
  'sbp-whiteshark': 'Gunboat; 3,200 m³ hold, 18 units per 13 s cycle — the volume workhorse of the armed family.',
  'sbp-swarm': 'Drone frigate; launches swarms to back up its main guns.',
  'sbp-sentinel': 'Drone carrier; a 3,600 m³ hold with a roomy nest — its firepower comes from the swarm.',
  'sbp-thresher': 'Missile cruiser; 2,600 m³ hold — opens the fight with a missile salvo.',
  'sbp-electricray': 'Laser cruiser; 2,500 m³ hold — burns through shields on contact.',
  'sbp-hammerhead': 'Gunnery cruiser; 2,800 m³ hold — the core of a heavy kinetic broadside.',
  'sbp-bullshark': 'Assault cruiser; 3,000 m³ hold — thick shields and heavy guns, built to bite.',
  'sbp-nautilus': 'Survey cruiser; 6,600 m³ hold — joining a fleet widens scan range by one ring.',
  'sbp-tortoise': 'Light corvette; armor and structure far above its tier, paid for with speed and hold space.',
  'sbp-hawksbill': 'Heavy cruiser; 9,600 m³ hold, 22 units per 13 s cycle — a warehouse in thick shell.',
  'sbp-xuanwu': 'Heavy flagship; 15,200 m³ hold and the thickest three-layer HP — the apex of the heavy line.',
  'sbp-flyingfish': 'Courier; a 5,000 m³ hold at 430 m/s — built for short-haul express runs.',
  'sbp-sailfish': 'Fast freighter; 8,500 m³ hold, 18 units per 11 s cycle.',
  'sbp-swordfish': 'Heavy freighter; 14,000 m³ hold, 16 units per 12 s cycle.',
  'sbp-megalodon': 'Battleship; 4,000 m³ hold — a fire platform that dares to stand at the head of the formation.',
  'sbp-wh-a-frigate': 'Raider EW frigate; locking and resolution top its tier — it sees first and locks first.',
  'sbp-wh-a-destroyer': 'Raider gunboat; kinetic batteries give it solid frontal firepower.',
  'sbp-wh-a-cruiser': 'Raider heavy assault cruiser; kinetic firepower wide open behind a thicker carapace — built to crack hard targets.',
  'sbp-wh-c-frigate': 'Larva interceptor; impossibly fast, with almost no shields — a carapace holds it together.',
  'sbp-wh-c-destroyer': 'Carapace interceptor; speed and agility maxed, with armor and structure taking every hit.',
  'sbp-wh-c-cruiser': 'Hiveswarm heavy assault cruiser; energy main guns behind thick armor and shell — made for head-on collisions.',
  'sbp-wh-d-frigate': 'Sentry EW frigate; locking and resolution far above its tier — it spots the enemy for the whole fleet.',
  'sbp-wh-d-destroyer': "Tombwarden command ship; locking, resolution and drone nest all raised — the fleet's eyes and hub.",
  'sbp-wh-d-cruiser': 'Mausoleum cruiser; the thickest three-layer HP and the most gun mounts, holding the center of the line.',
  'sbp-wh-e-frigate': 'Construct torpedo frigate; explosive warheads crack armor and hit solidly.',
  'sbp-wh-e-destroyer': 'Hangar drone combat ship; a big nest and strong drones — a hangar that can fly.',
  'sbp-wh-e-carrier': 'Megastructure drone combat ship; the largest nest and the highest drone damage — launching is its main weapon.',
  'sbp-wh-g-frigate': 'Wraith scout frigate; a tiny signature and very high evasion — it sees the others first.',
  'sbp-wh-g-destroyer': 'Deadarmy logistics ship; the largest hold and nest, following the fleet to resupply and swap drones.',
  'sbp-wh-g-cruiser': 'Deadarmy torpedo cruiser; explosive warheads with solid accuracy, aimed at the armor of big targets.',
}

/** **舰船蓝图**（名称派生：`<舰级段> Blueprint`；说明查 `SBP_DESC_EN`，`sbp-once-*` 取本体同说明） */
export const EN_SHIP_BLUEPRINTS: EnTable = (() => {
  const out: Record<string, EnText> = {}
  for (const bp of SHIP_BLUEPRINTS) {
    const en = EN_SHIPS[bp.shipId]?.name
    if (!en) continue
    const onceBase = bp.id.startsWith('sbp-once-') ? `sbp-${bp.id.slice('sbp-once-'.length)}` : null
    const desc = SBP_DESC_EN[bp.id] ?? (onceBase !== null ? SBP_DESC_EN[onceBase] : undefined)
    out[bp.id] = desc !== undefined ? { name: `${shipClassSegment(en)} Blueprint`, description: desc } : { name: `${shipClassSegment(en)} Blueprint` }
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

/** 星系（20 · `docs/glossary-en.md` §五）—— **名称 + 说明**。星图节点进 `ctx.galaxies`，矿带名进 `ctx.belts`，两张表分开。 */
export const EN_GALAXIES: EnTable = {
  'galaxy-hub': { name: 'Leviathan IV', description: 'Home system: headquarters of the Deep Space Industry Association, and where every route begins.' },
  'galaxy-kor': { name: 'Kor Frontier', description: 'Remains of an early colony, where pirates often lie in ambush.' },
  'galaxy-dust': { name: 'Stardust Wastes', description: 'An abandoned mining district thick with stardust — a graveyard of old industrial platforms.' },
  'galaxy-redring': { name: 'Redring Corridor', description: 'A red ring spans the system: the home lair of raider fleets.' },
  'galaxy-grave': { name: 'Darkstar Graveyard', description: 'The graveyard of ancient fleets; the gravekeepers are said never to sleep.' },
  'galaxy-abyss': { name: 'Abyss Gate', description: 'An ancient jump gate stands here under heavy guard — no one who went through has come back to say what lies beyond.' },
  'galaxy-auro': { name: 'Auro Waste Ring', description: 'A ring of asteroid ruins where armed wrecks from an old war still roam.' },
  'galaxy-starcore': { name: 'Starcore Labyrinth', description: 'The labyrinth core of a dense nebula where navigators fail — only charts get you through.' },
  'galaxy-harbor': { name: 'New Harbor Corridor', description: 'A supply corridor on the outer ring of the home system, plied by merchant convoys and Association patrols.' },
  'galaxy-haze': { name: 'Hazebelt', description: 'Shrouded year-round in ionized haze, with half its old beacons out of repair.' },
  'galaxy-shard': { name: 'Shardbelt', description: 'A floating graveyard of giant shattered crystals that refract strange rainbows.' },
  'galaxy-cinder': { name: 'Cinder Sector', description: 'A dark ash belt left by an interstellar fire a century ago.' },
  'galaxy-echo': { name: 'Echo Wastes', description: 'Radio echoes repeat here; they say you can hear the last distress calls of sunken ships.' },
  'galaxy-lantern': { name: 'Lantern Passage', description: 'An ancient navigation beacon array, still working with no one to maintain it.' },
  'galaxy-chasm': { name: 'Chasm Deepbelt', description: 'A deep trench left where a planetary system was torn apart, riddled with gravity anomalies.' },
  'galaxy-mirage': { name: 'Mirage System', description: 'Strong gravitational lensing twists the stars here into mirages.' },
  'galaxy-maw': { name: 'Star Maw', description: 'A giant rift slowly swallowing starlight; the Association forbids going deep inside.' },
  'galaxy-vault': { name: 'Vault Necropolis', description: 'Dome shelters where an ancient civilization sealed away its fleet; the gravekeeper fleet still patrols them.' },
  'galaxy-nadir': { name: 'Nadir Quiet Zone', description: 'A dead-silent zone directly below the galactic plane where no body cares to linger.' },
  'galaxy-voidedge': { name: 'Voidsea Edge', description: 'Where navigable space meets the Voidsea — the end is right behind you.' },
}

/** 矿带（17 · §五；**key 是矿带自己的 id**（`belt-*`），不是星系 id——星系名另见 `EN_GALAXIES`） */
export const EN_BELTS: EnTable = {
  'belt-fortune': { name: 'Ring of Plenty', description: "The starter belt on the station's outer ring: safe, plentiful and never exhausted." },
  'belt-scorched': { name: 'Scorched Rift', description: 'A rift left by a shattered volcanic body, rich in Gabbro.' },
  'belt-kernite': { name: 'Deepspace Crystal Belt', description: 'A starter mixed belt where several ores coexist: now and then you dig up a little Redring Ore.' },
  'belt-sunshard': { name: 'Dawncrystal Belt', description: 'A crystal layer lit at just the right dawn angle — the ideal place to mine Dawnshard Crystal (requires standing 2).' },
  'belt-gas-neon': { name: 'Neon Cloud Field', description: 'A cluster of low-gravity gas fields — the first place you can harvest gas (requires standing 2).' },
  'belt-glowstone': { name: 'Glowcloud Belt', description: "A rich vein at the ring's center: high-purity Glowcloud Ore with occasional Dawnshard Crystal alongside (requires standing 3)." },
  'belt-hemorphite': { name: 'Redring Crisis Belt', description: 'A high-pressure seam deep in a pirate hub, where Redring Ore and Gabbro interleave (requires standing 3).' },
  'belt-crimsonite': { name: 'Mirage Cluster', description: 'A crystal cluster belt twisted out by gravitational lensing, where Dawnshard Crystal and Glowcloud Ore grow together (requires standing 5).' },
  'belt-ice-marrow': { name: 'Frostmarrow Ice Ring', description: 'An ancient ice ring with marrow-like veining and a key source of Starcore Crystal (requires standing 5).' },
  'belt-fluxite': { name: 'Starcore Vein', description: 'A double crystal vein in the labyrinth core, where Dawnshard Crystal and Glowcloud Ore grow together (requires standing 4).' },
  'belt-voidshard': { name: 'Voidcrystal Deepbelt', description: 'A black Voidcrystal seam in the deep-space rift belt (requires standing 7).' },
  'belt-ice-frost': { name: 'Bluefrost Ice Ring', description: 'A blue-white ice ring whose layers lock in high-purity Isotope Polycrystal (requires standing 6).' },
  'belt-gas-ionstorm': { name: 'Ionstorm Cloud Field', description: 'A raging ion stream field: a proving ground where reward and risk come together (requires standing 8).' },
  'belt-nebulite': { name: 'Starwraith Vein', description: 'A legendary vein deep in the nebula, reserved for decorated Association pilots (requires standing 11).' },
  'belt-ice-darkstar': { name: 'Darkstar Ice Ring', description: 'A light-swallowing black ice ring — the most demanding mining site in the universe (requires standing 11).' },
  'belt-gas-phosphor': { name: 'Phosphor Haze Field', description: 'Corrosive phosphor haze deep in the graveyard: a rare gas deposit of very high refining value (requires standing 9).' },
  'belt-gas-aurora': { name: 'Aurora Cloud Field', description: 'Aurora particle clouds above the Vault Necropolis — the highest-threshold mining site in the universe (requires standing 13).' },
}

/** 站点（2 · 建站点；阶段名「奠基/完善/建成」嵌在站点定义里，用嵌套覆盖另处理） */
export const EN_STATIONS: EnTable = {
  'site-redring': {
    name: 'Redring Outpost',
    description: 'The Redring Corridor is a hub of deep-space shipping, yet pirates hold it year-round. The Association Infrastructure Dept plans an outpost here: built in three stages from refined materials, and folded into the Association base network once complete.',
  },
  'site-cinder': {
    name: 'Cinder Outpost',
    description: 'A high-risk mining district deep in the Cinder Sector needs a staging station. The Infrastructure Dept commissions it in three stages from refined materials: the foundation is especially heavy on Tritanium Alloy, and later stages use rarer stock. Once complete it joins the Association base network.',
  },
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
  'mt-industry-ai': { name: 'Industrial Multi-core Dispatch' },
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
