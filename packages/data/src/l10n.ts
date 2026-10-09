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
import type { FoeMountId, MatterTechNodeDef, SimContext, StationSiteDef, TravelEventDef } from '@whale/core'
// 2026-09-26：残骸英文区名改读组表（`wreckGroupOfItemId` ⇒ `region`），不再按 id 后缀解
import { WRECK_GROUPS, resolveFoeMounts, wreckGroupOfItemId } from '@whale/core'
import { BLUEPRINTS } from './blueprints'
import { SHIP_BLUEPRINTS } from './shipBlueprints'
import { L10N, l10nEntryText } from './l10n/table'

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
    // ⟪文案调整 2026-09-30⟫ 与 zh 同步改名（原名「Sandcat-class」，中文原「沙猫级」）
    name: 'Krill-class Mining Corvette',
    description: 'The starter mining boat: basic hold and a single mining laser. Your first ship — and, for now, your only one.',
  },
  burrower: {
    // ⟪文案调整 2026-09-30⟫ 与 zh 同步改名（原名「Burrower-class」，中文原「掘洞级」）
    name: 'Sandeel-class Mining Corvette',
    description: 'A larger hold and twin mining lasers — nearly double the output. The mark of graduating from the starter grounds.',
  },
  whale: {
    name: 'Whaleswallow-class Mining Corvette',
    description: 'A deep-space industrial beast: four mining lasers strip half an asteroid in one pass. The name fits.',
  },
  pioneer: {
    // ⟪文案调整 2026-09-30⟫ 与 zh 同步改名（原名「Pioneer-class」，中文原「开拓级」）
    name: 'Narwhal-class Mining Corvette',
    description: "The Association shipyard's custom boat: not for sale — build it on your own pad from raw materials. A step faster than the Whaleswallow-class.",
  },
  'whale-king': {
    name: 'Whaleking-class Mining Corvette',
    // ⟪文案调整 2026-09-30⟫ 与 zh 同步补定位句（船长令「鲸王添加适合路途短的挖掘」）
    description: 'The peak of deep-space industry: double the Whaleswallow-class output. A heavy-tungsten devourer, and the longest-term material goal in the game; a tight hold and a fast fill, built for short-haul belts.',
  },
  'sh-humpback': {
    name: 'Humpback-class Mining Ship',
    // ⟪文案调整 2026-09-30⟫ 与 zh 同步补定位句（船长令「给座头鲸添加说明，适合遥远星系挖掘」）
    description: 'The third-generation Leviathan mining ship: a freighter-grade hold with another step up in output; built for belts in distant systems.',
  },
  'sh-bowhead': {
    name: 'Manta-class Heavy Freighter',
    description: 'A heavy freighter assembled by the Leviathan yards: over 26,000 m³ of hold — the backbone of offline stockpiling and long hauls.',
  },
  'sh-manatee': {
    name: 'Manatee-class Freighter',
    description: 'A Leviathan freighter with a large cargo hold and fittings for defense and field work, suited to bulk transport.',
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
    // ⟪文案调整2026-10-06⟫ 扫描半径为新旧探索共享效果。
    description: 'An Association survey cruiser: joining an exploration fleet widens scan range inside the space by one ring (multiple ships stack).',
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
    name: 'Leatherback-class Heavy Battleship',
    description: 'The apex of the heavy line: said to be forged from the rocky shell of an entire asteroid.',
  },
  'sh-megalodon': {
    name: 'Megalodon-class Battleship',
    description: 'A battleship named for a prehistoric giant: a front-line damage sponge and fire platform. Three thick HP layers and generous fitting space let it stand at the head of the formation — at the cost of slow turns and slow starts.',
  },
  // 2026-09-26 新增两艘官方战列舰（船长令）——虎鲸级 = 设定里的"战列巡洋舰"（不可见说法）
  'sh-orca': {
    name: 'Orca-class Command Ship',
    description: 'A command ship: the hull that pulls a formation into one fist. Speed is what it lives on; fitting space, HP and hold all sit one notch below a battleship.',
  },
  'sh-helicoprion': {
    name: 'Helicoprion-class Armored Battleship',
    description: 'An armored battleship named for a prehistoric saw-toothed shark: armor thick enough to eat the first salvo, with the speed to keep up with the formation — at the cost of a small hold and few mid slots.',
  },
  'sh-dunkleosteus': {
    name: 'Dunkleosteus-class Flagship',
    description: "The fleet's apex: damage soaking, firepower and fitting space all above its generation — as are its price and build time. It sets the pace of the whole formation: when it is slow, everyone waits.",
  },
  // ── 虫洞族舰（敌舰模板名，不带 -class）
  'sh-wh-a-frigate': {
    name: 'Raider EW Frigate',
    // ⟪文案调整2026-10-06⟫ 扫描半径为新旧探索共享效果。
    description: 'A pirate electronic-warfare boat: strong in fire control and evasion — it locks first, hits first, and is harder to pin. Joining an exploration fleet widens scan range inside the space by one ring (multiple ships stack).',
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
    // ⟪文案调整2026-10-06⟫ 扫描半径为新旧探索共享效果。
    description: 'A mausoleum electronic sentry: thick shields over thin armor, with fire control and evasion both raised to open fire before the fleet. Joining an exploration fleet widens scan range inside the space by one ring (multiple ships stack).',
  },
  'sh-wh-d-destroyer': {
    name: 'Tombwarden Command Ship',
    description: "A mausoleum command ship: shield-heavy, and it adds 20% to the whole formation's single-shot damage — multiple command ships take the highest only, no stacking. The price is thin armor and hull: once the shield drops, it is fragile.",
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
    // ⟪文案调整2026-10-06⟫ 扫描半径为新旧探索共享效果。
    description: 'A deadarmy scout: very high evasion with solid fire control. Joining an exploration fleet widens scan range inside the space by one ring (multiple ships stack) — it is the one that sees the others first.',
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
  'mod-drone-launch-1': { name: l10nEntryText(L10N['mod.launchCalibration.001']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
  'mod-drone-launch-2': { name: l10nEntryText(L10N['mod.launchCalibration.002']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
  'mod-drone-launch-3': { name: l10nEntryText(L10N['mod.launchCalibration.003']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
  'mod-laser-calibration-2': { name: l10nEntryText(L10N['mod.launchCalibration.004']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.007']!, 'en') },
  'mod-laser-calibration-3': { name: l10nEntryText(L10N['mod.launchCalibration.005']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.007']!, 'en') },
  /* 舰船插件（2026-09-26 船长令）：装上去拆不下来的固定件，走独立插件槽。
     ⚠ 英文名要与 `docs/glossary-en.md` 的命名规则一致（直译优先、档位照抄）；本批为初稿。 */
  'plug-shield-plate': { name: 'Shield Reinforcement Plate', description: L10N['mod.copy.097']!.en },
  'plug-armor-plate': { name: 'Armor Reinforcement Plate', description: L10N['mod.copy.098']!.en },
  'plug-hull-plate': { name: 'Hull Reinforcement Plate', description: L10N['mod.copy.099']!.en },
  'plug-mid-bay': { name: 'Mid Bay Plug', description: L10N['mod.copy.100']!.en },
  'plug-low-bay': { name: 'Low Bay Plug', description: L10N['mod.copy.101']!.en },
  'plug-cpu-core': { name: 'Coprocessor Plug', description: L10N['mod.copy.102']!.en },
  'plug-firepower': { name: 'Firepower Plug', description: L10N['mod.copy.103']!.en },
  'plug-sight': { name: 'Sight Plug', description: L10N['mod.copy.104']!.en },
  'plug-thruster': { name: 'Thruster Plug', description: L10N['mod.copy.106']!.en },
  'plug-rangefinder': { name: 'Range Plug', description: L10N['mod.copy.105']!.en },
  'plug-target-beacon': { name: 'Target Beacon Plug', description: L10N['mod.copy.107']!.en },
  'plug-concealment': { name: 'Concealment Plug', description: L10N['mod.copy.108']!.en },

  /* 损伤管制装置线（2026-09-25 船长令：低槽 · 结构三系减伤 +30/40/50 ＋ 每场一次"结构锁定 1 秒"）
     ⚠ 模块英文必须写在本表（`EN_MODULES`）——写进 `EN_ITEMS` 的话覆盖层查不到（`l10n-overlay` 用例会红）。 */
  'mod-dc-1': { name: 'Damage Control Unit MK1', description: L10N['mod.copy.031']!.en },
  'mod-dc-2': { name: 'Damage Control Unit MK2', description: L10N['mod.copy.031']!.en },
  'mod-dc-3': { name: 'Damage Control Unit MK3', description: L10N['mod.copy.031']!.en },
  // 采集 / 货舱
  // ⟪文案调整2026-10-06⟫ 旧来源说明取新表项，不重写历史正文。
  'mod-miner-civ': { name: 'Civilian Mining Laser', description: L10N['mod.signalSpace.001']!.en },
  'mod-miner-1': { name: 'Reinforced Mining Laser MK1', description: L10N['mod.signalSpace.001']!.en },
  'mod-miner-2': { name: 'Reinforced Mining Laser MK2', description: L10N['mod.signalSpace.001']!.en },
  'mod-miner-3': { name: 'Precision Mining Laser MK3', description: L10N['mod.signalSpace.001']!.en },
  'mod-miner-proto': { name: 'Alien Prototype Mining Laser', description: L10N['mod.signalSpace.002']!.en },
  'mod-cargo-civ': { name: 'Civilian Cargo Expander', description: L10N['mod.copy.003']!.en },
  'mod-cargo-1': { name: 'Cargo Expander MK1', description: L10N['mod.copy.003']!.en },
  'mod-cargo-2': { name: 'Cargo Expander MK2', description: L10N['mod.copy.003']!.en },
  'mod-cargo-3': { name: 'Folding Cargo Expander MK3', description: L10N['mod.copy.003']!.en },
  'mod-cargo-proto': { name: 'Alien Prototype Cargo Hold', description: L10N['mod.copy.004']!.en },
  // 武器
  'mod-turret-civ': { name: 'Civilian Cannon', description: L10N['mod.copy.005']!.en },
  'mod-turret-kin-1': { name: 'Light Turret MK1 · Kinetic', description: L10N['mod.copy.006']!.en },
  'mod-turret-kin-2': { name: 'Heavy Turret MK2 · Kinetic', description: L10N['mod.copy.007']!.en },
  'mod-turret-kin-3': { name: 'Siege Turret MK3 · Kinetic', description: L10N['mod.copy.008']!.en },
  'mod-pd-e': { name: 'Point Defense Gun MK1', description: L10N['mod.copy.009']!.en },
  'mod-pd-e-2': { name: 'Point Defense Gun MK2', description: L10N['mod.copy.009']!.en },
  'mod-pd-e-3': { name: 'Point Defense Gun MK3', description: L10N['mod.copy.009']!.en },
  'mod-laser-1': { name: 'Light Laser Cannon MK1', description: L10N['mod.copy.010']!.en },
  'mod-laser-2': { name: 'Heavy Laser Cannon MK2', description: L10N['mod.copy.011']!.en },
  'mod-laser-3': { name: 'Siege Laser Cannon MK3', description: L10N['mod.copy.012']!.en },
  'mod-laser-proto': { name: 'Alien Prototype Laser Cannon', description: L10N['mod.copy.013']!.en },
  'mod-missile-1': { name: 'Light Missile Launcher MK1', description: L10N['mod.copy.014']!.en },
  'mod-missile-2': { name: 'Heavy Missile Launcher MK2', description: L10N['mod.copy.015']!.en },
  'mod-missile-3': { name: 'Cruise Missile Launcher MK3', description: L10N['mod.copy.016']!.en },
  // 无人机件
  'mod-drone-rack-1': { name: 'Drone Deck Expansion MK1', description: L10N['mod.copy.017']!.en },
  'mod-drone-rack-2': { name: 'Drone Deck Expansion MK2', description: L10N['mod.copy.017']!.en },
  'mod-drone-rack-3': { name: 'Drone Deck Expansion MK3', description: L10N['mod.copy.017']!.en },
  'mod-drone-tac-1': { name: 'Tactical Control Array MK1', description: L10N['mod.copy.018']!.en },
  'mod-drone-tac-2': { name: 'Tactical Control Array MK2', description: L10N['mod.copy.018']!.en },
  'mod-drone-tac-3': { name: 'Tactical Control Array MK3', description: L10N['mod.copy.018']!.en },
  'mod-drone-relay-1': { name: 'Drone Relay Antenna MK1', description: L10N['mod.copy.019']!.en },
  'mod-drone-relay-2': { name: 'Drone Relay Antenna MK2', description: L10N['mod.copy.019']!.en },
  'mod-drone-relay-3': { name: 'Drone Relay Antenna MK3', description: L10N['mod.copy.019']!.en },
  // 无人机储备甲板（2026-09-27 船长令）：说明文案不手写周期数字（数值由界面参数行给）
  'mod-drone-deck-1': { name: 'Drone Reserve Deck MK1', description: L10N['mod.copy.021']!.en },
  'mod-drone-deck-2': { name: 'Drone Reserve Deck MK2', description: L10N['mod.copy.021']!.en },
  'mod-drone-deck-3': { name: 'Drone Reserve Deck MK3', description: L10N['mod.copy.021']!.en },
  'mod-drone-shield-2': { name: 'Drone Shield Projector MK2', description: L10N['mod.copy.020']!.en },
  'mod-drone-shield-3': { name: 'Drone Shield Projector MK3', description: L10N['mod.copy.020']!.en },
  // 护盾 / 装甲
  'mod-shield-kin-1': { name: 'Shield Amplifier MK1 · Kinetic', description: L10N['mod.copy.022']!.en },
  'mod-shield-exp-1': { name: 'Shield Amplifier MK1 · Explosive', description: L10N['mod.copy.023']!.en },
  'mod-shield-pla-1': { name: 'Shield Amplifier MK1 · Energy', description: L10N['mod.copy.024']!.en },
  'mod-shield-kin-2': { name: 'Shield Amplifier MK2 · Kinetic', description: L10N['mod.copy.022']!.en },
  'mod-shield-exp-2': { name: 'Shield Amplifier MK2 · Explosive', description: L10N['mod.copy.023']!.en },
  'mod-shield-pla-2': { name: 'Shield Amplifier MK2 · Energy', description: L10N['mod.copy.024']!.en },
  'mod-shield-kin-3': { name: 'Shield Amplifier MK3 · Kinetic', description: L10N['mod.copy.022']!.en },
  'mod-shield-exp-3': { name: 'Shield Amplifier MK3 · Explosive', description: L10N['mod.copy.023']!.en },
  'mod-shield-pla-3': { name: 'Shield Amplifier MK3 · Energy', description: L10N['mod.copy.024']!.en },
  'mod-shield-ext-1': { name: 'Shield Extender MK1', description: L10N['mod.copy.025']!.en },
  'mod-shield-ext-2': { name: 'Shield Extender MK2', description: L10N['mod.copy.025']!.en },
  'mod-shield-ext-3': { name: 'Shield Extender MK3', description: L10N['mod.copy.025']!.en },
  'mod-shieldchg-1': { name: 'Shield Recharger MK1', description: L10N['mod.copy.026']!.en },
  'mod-shieldchg-2': { name: 'Shield Recharger MK2', description: L10N['mod.copy.026']!.en },
  'mod-shieldchg-3': { name: 'Shield Recharger MK3', description: L10N['mod.copy.026']!.en },
  /* 护盾充能力场装置（2026-09-20 船长）：高槽 · 护盾族 —— 与上一条中槽「Shield Recharger」区分开：
     2026-10-07：本件只治其他舰船、按需消耗自身护盾，冷却按件自带。
     ⟪2026-09-25 船长令⟫ 恢复量改按**本舰（装件舰）的护盾量**算（旧 "each ship's max shield" 作废）。 */
  'mod-shieldfield-2': { name: 'Shield Charge Field MK2', description: L10N['mod.copy.027']!.en },
  'mod-shieldfield-3': { name: 'Shield Charge Field MK3', description: L10N['mod.copy.027']!.en },
  'mod-armor-kin-1': { name: 'Armor Plating MK1 · Kinetic', description: L10N['mod.copy.028']!.en },
  'mod-armor-exp-1': { name: 'Armor Plating MK1 · Explosive', description: L10N['mod.copy.029']!.en },
  'mod-armor-pla-1': { name: 'Armor Plating MK1 · Energy', description: L10N['mod.copy.030']!.en },
  'mod-armor-kin-2': { name: 'Armor Plating MK2 · Kinetic', description: L10N['mod.copy.028']!.en },
  'mod-armor-exp-2': { name: 'Armor Plating MK2 · Explosive', description: L10N['mod.copy.029']!.en },
  'mod-armor-pla-2': { name: 'Armor Plating MK2 · Energy', description: L10N['mod.copy.030']!.en },
  'mod-armor-kin-3': { name: 'Armor Plating MK3 · Kinetic', description: L10N['mod.copy.028']!.en },
  'mod-armor-exp-3': { name: 'Armor Plating MK3 · Explosive', description: L10N['mod.copy.029']!.en },
  'mod-armor-pla-3': { name: 'Armor Plating MK3 · Energy', description: L10N['mod.copy.030']!.en },
  'mod-armor-plate-1': { name: 'Armor Thickening Plate MK1', description: L10N['mod.copy.032']!.en },
  'mod-armor-plate-2': { name: 'Armor Thickening Plate MK2', description: L10N['mod.copy.032']!.en },
  'mod-armor-plate-3': { name: 'Armor Thickening Plate MK3', description: L10N['mod.copy.032']!.en },
  // 推进 / 支援 / 维修 / 隐秘
  'mod-prop-1': { name: 'Vector Thruster MK1', description: L10N['mod.copy.033']!.en },
  'mod-prop-2': { name: 'Vector Thruster MK2', description: L10N['mod.copy.033']!.en },
  'mod-prop-3': { name: 'Vector Thruster MK3', description: L10N['mod.copy.033']!.en },
  'mod-mwd-1': { name: 'Micro Warp Drive MK1', description: L10N['mod.copy.034']!.en },
  'mod-mwd-2': { name: 'Micro Warp Drive MK2', description: L10N['mod.copy.034']!.en },
  'mod-mwd-3': { name: 'Micro Warp Drive MK3', description: L10N['mod.copy.034']!.en },
  'mod-stab-kin-1': { name: 'Kinetic Stabilizer MK1', description: L10N['mod.copy.035']!.en },
  'mod-stab-kin-2': { name: 'Kinetic Stabilizer MK2', description: L10N['mod.copy.035']!.en },
  'mod-stab-kin-3': { name: 'Kinetic Stabilizer MK3', description: L10N['mod.copy.035']!.en },
  'mod-stab-exp-1': { name: 'Explosive Stabilizer MK1', description: L10N['mod.copy.036']!.en },
  'mod-stab-exp-2': { name: 'Explosive Stabilizer MK2', description: L10N['mod.copy.036']!.en },
  'mod-stab-exp-3': { name: 'Explosive Stabilizer MK3', description: L10N['mod.copy.036']!.en },
  'mod-stab-pla-1': { name: 'Plasma Stabilizer MK1', description: L10N['mod.copy.037']!.en },
  'mod-stab-pla-2': { name: 'Plasma Stabilizer MK2', description: L10N['mod.copy.037']!.en },
  'mod-stab-pla-3': { name: 'Plasma Stabilizer MK3', description: L10N['mod.copy.037']!.en },
  'mod-rof-1': { name: 'Rate-of-Fire Computer MK1', description: L10N['mod.copy.038']!.en },
  'mod-rof-2': { name: 'Rate-of-Fire Computer MK2', description: L10N['mod.copy.038']!.en },
  'mod-rof-3': { name: 'Rate-of-Fire Computer MK3', description: L10N['mod.copy.038']!.en },
  'mod-warpcomp-2': { name: 'Warp Computer MK2', description: L10N['mod.copy.039']!.en },
  'mod-warpcomp-3': { name: 'Warp Computer MK3', description: L10N['mod.copy.039']!.en },
  'mod-track-1': { name: 'Tracking Array MK1', description: L10N['mod.copy.040']!.en },
  'mod-track-2': { name: 'Tracking Array MK2', description: L10N['mod.copy.040']!.en },
  'mod-track-3': { name: 'Tracking Array MK3', description: L10N['mod.copy.040']!.en },
  'mod-gyro-1': { name: 'Attitude Gyro MK1', description: L10N['mod.copy.041']!.en },
  'mod-gyro-2': { name: 'Attitude Gyro MK2', description: L10N['mod.copy.041']!.en },
  'mod-gyro-3': { name: 'Attitude Gyro MK3', description: L10N['mod.copy.041']!.en },
  'mod-cpu-1': { name: 'Coprocessor MK1', description: L10N['mod.copy.042']!.en },
  'mod-cpu-2': { name: 'Coprocessor MK2', description: L10N['mod.copy.042']!.en },
  'mod-cpu-3': { name: 'Coprocessor MK3', description: L10N['mod.copy.043']!.en },
  // ⟪文案调整2026-10-06⟫ 旧来源说明取新表项，不重写历史正文。
  'mod-salvager-1': { name: 'Salvager MK1', description: L10N['mod.signalSpace.003']!.en },
  'mod-salvager-2': { name: 'Salvager MK2', description: L10N['mod.signalSpace.003']!.en },
  'mod-salvager-3': { name: 'Salvager MK3', description: L10N['mod.signalSpace.003']!.en },
  'mod-hullrep-civ': { name: 'Civilian Hull Repair Unit', description: L10N['mod.copy.045']!.en },
  'mod-hullrep-1': { name: 'Hull Repair Unit MK1', description: L10N['mod.copy.046']!.en },
  'mod-hullrep-2': { name: 'Hull Repair Unit MK2', description: L10N['mod.copy.046']!.en },
  'mod-lock-1': { name: 'Target Lock Array MK1', description: L10N['mod.copy.047']!.en },
  'mod-lock-2': { name: 'Target Lock Array MK2', description: L10N['mod.copy.047']!.en },
  'mod-lock-3': { name: 'Target Lock Array MK3', description: L10N['mod.copy.047']!.en },
  'mod-stealth-2': { name: 'Stealth Module MK2', description: L10N['mod.copy.048']!.en },
  'mod-stealth-3': { name: 'Stealth Module MK3', description: L10N['mod.copy.048']!.en },
  // 窝点专属（lair）
  'mod-lair-turret-a': { name: 'Raider Gatling Cannon', description: L10N['mod.copy.049']!.en },
  'mod-lair-missile-a': { name: 'Raider Missile Nest', description: L10N['mod.copy.050']!.en },
  'mod-lair-cargo-a': { name: 'Spoils Reinforcement Bay', description: L10N['mod.copy.051']!.en },
  'mod-lair-armor-c': { name: 'Bio Carapace Plate', description: L10N['mod.copy.052']!.en },
  'mod-lair-dc-c': { name: 'Bio Damage Control Chamber', description: L10N['mod.copy.053']!.en },
  'mod-lair-laser-c': { name: 'Acid Sprayer', description: L10N['mod.copy.054']!.en },
  'mod-lair-shield-d': { name: 'Mausoleum Shield Array', description: L10N['mod.copy.055']!.en },
  'mod-lair-turret-d': { name: 'Gravekeeper Long Cannon', description: L10N['mod.copy.056']!.en },
  'mod-lair-armor-d': { name: 'Mausoleum Armor Layer', description: L10N['mod.copy.057']!.en },
  'mod-lair-turret-e': { name: 'Megastructure Wreck Cannon', description: L10N['mod.copy.058']!.en },
  'mod-lair-hangar-e': { name: 'Deep Hangar', description: L10N['mod.copy.059']!.en },
  'mod-lair-frame-e': { name: 'Megastructure Frame', description: L10N['mod.copy.060']!.en },
  'mod-lair-drone-tac-g': { name: 'Squidwasp Swarm Control', description: L10N['mod.copy.061']!.en },
  'mod-lair-drone-relay-g': { name: 'Exile Relay Mast', description: L10N['mod.copy.062']!.en },
  // H 族（墨潮帮）势力装备（2026-09-26 船长定：射程压制 · 捕获网 · 重袭机）
  'mod-lair-ecm-h': { name: 'Ink Tide EW Pod', description: L10N['mod.copy.063']!.en },
  'mod-lair-web-h': { name: 'Ink Tide Capture Web', description: L10N['mod.copy.064']!.en },
  // **R 族（光环）势力特色装备**（船长 2026-10-01 令）：叠光激光炮 + 跃迁规避装置；⟪2026-10-02⟫ 再加 三叉戟光束炮（Trident Beam Cannon）+ PD激光（PD Laser）—— **四件**同出「光环稀有残骸的高级箱专属池」（与 AI 核心同一个池子）。
  'mod-lair-laser-r': { name: 'Overlay Laser Cannon', description: L10N['mod.copy.065']!.en },
  'mod-lair-blink-r': { name: 'Blink Evasion Drive', description: L10N['mod.copy.066']!.en },
  'mod-lair-beam-r': { name: 'Trident Beam Cannon', description: L10N['mod.copy.067']!.en },
  'mod-lair-pd-r': { name: 'PD Laser', description: L10N['mod.copy.068']!.en },
  // 虫洞族专属（mod-wh-*）
  'mod-wh-a-frag': { name: 'Raider Fragment Cannon', description: L10N['mod.copy.069']!.en },
  'mod-wh-a-hangar': { name: 'Raider Hangar', description: L10N['mod.copy.070']!.en },
  'mod-wh-a-prop': { name: 'Raider Afterburner', description: L10N['mod.copy.071']!.en },
  'mod-wh-a-coat': { name: 'Raider Refraction Coating', description: L10N['mod.copy.072']!.en },
  'mod-wh-a-scan': { name: 'Spoils Scan Array', description: L10N['mod.copy.073']!.en },
  'mod-wh-a-shield': { name: 'Raider Shield Cage', description: L10N['mod.copy.074']!.en },
  'mod-wh-c-laser': { name: 'Bio Prism Beam', description: L10N['mod.copy.075']!.en },
  'mod-wh-c-prism': { name: 'Carapace Prism Layer', description: L10N['mod.copy.076']!.en },
  'mod-wh-c-pulse': { name: 'Bio Pulse Accelerator', description: L10N['mod.copy.077']!.en },
  'mod-wh-c-missile': { name: 'Spore Missile Nest', description: L10N['mod.copy.078']!.en },
  'mod-wh-c-frame': { name: 'Chitin Frame Layer', description: L10N['mod.copy.079']!.en },
  'mod-wh-d-turret': { name: 'Tombwarden Linked Cannon', description: L10N['mod.copy.080']!.en },
  'mod-wh-d-shield': { name: 'Mausoleum Shield Core', description: L10N['mod.copy.081']!.en },
  'mod-wh-d-lock': { name: 'Gravekeeper Death Knell', description: L10N['mod.copy.082']!.en },
  'mod-wh-d-laser': { name: 'Mausoleum Prism Cannon', description: L10N['mod.copy.083']!.en },
  'mod-wh-d-loader': { name: 'Gravekeeper Rapid Loader', description: L10N['mod.copy.084']!.en },
  'mod-wh-d-steady': { name: 'Mausoleum Ballistic Inscription', description: L10N['mod.copy.085']!.en },
  'mod-wh-e-dc': { name: 'Megastructure Damage Control Array', description: L10N['mod.copy.086']!.en },
  'mod-wh-e-tac': { name: 'Megastructure Control Tower', description: L10N['mod.copy.087']!.en },
  'mod-wh-e-cpu': { name: 'Megastructure Coprocessor', description: L10N['mod.copy.088']!.en },
  'mod-wh-e-pd': { name: 'Megastructure Point Defense Array', description: L10N['mod.copy.089']!.en },
  'mod-wh-e-shield': { name: 'Megastructure Shield Matrix', description: L10N['mod.copy.090']!.en },
  'mod-wh-g-hangar': { name: 'Deadarmy Hive Dock', description: L10N['mod.copy.091']!.en },
  'mod-wh-g-fcs': { name: 'Deadarmy Fire Control', description: L10N['mod.copy.092']!.en },
  'mod-wh-g-ballistic': { name: 'Wraith Ballistic Corrector', description: L10N['mod.copy.093']!.en },
  'mod-wh-g-hull': { name: 'Squidwasp Hull Layer', description: L10N['mod.copy.094']!.en },
  'mod-wh-g-turret': { name: 'Deadarmy Wreck Cannon', description: L10N['mod.copy.095']!.en },
  'mod-wh-g-prop': { name: 'Wraith Thruster', description: L10N['mod.copy.096']!.en },
}

/**
 * 物品英文名称保持冻结译名；说明与中文共用唯一表 id。
 */
export const EN_ITEMS: EnTable = {
  'drone-jawclaw': {
    name: l10nEntryText(L10N['item.jawclaw.001']!, 'en'),
    description: l10nEntryText(L10N['item.jawclaw.002']!, 'en'),
  },
  // 原矿
  'ore-veldspar': { name: 'Peridotite', description: L10N['item.copy.001']!.en },
  'ore-scorched': { name: 'Gabbro', description: L10N['item.copy.002']!.en },
  'ore-hemorphite': { name: 'Redring Ore', description: L10N['item.copy.003']!.en },
  'ore-glowstone': { name: 'Glowcloud Ore', description: L10N['item.copy.004']!.en },
  'ore-sunshard': { name: 'Dawnshard Crystal', description: L10N['item.copy.005']!.en },
  'ore-voidshard': { name: 'Voidcrystal', description: L10N['item.copy.006']!.en },
  'ore-nebulite': { name: 'Starwraith Ore', description: L10N['item.copy.007']!.en },
  // ⟪文案调整2026-10-06⟫ 旧来源说明取新表项，不重写历史正文。
  'ore-voidmother': { name: 'Voidmother Ore', description: L10N['item.signalSpace.001']!.en },
  // 精炼产物
  'min-tritanium': { name: 'Tritanium Alloy', description: L10N['item.copy.009']!.en },
  'min-pyerite': { name: 'Silvervein Supermetal', description: L10N['item.copy.010']!.en },
  'min-mexallon': { name: 'Crystalline Colloid', description: L10N['item.copy.011']!.en },
  'min-nocxium': { name: 'Heavy Tungsten Alloy', description: L10N['item.copy.012']!.en },
  'min-isotope': { name: 'Isotope Polycrystal', description: L10N['item.copy.013']!.en },
  'min-starcore': { name: 'Starcore Crystal', description: L10N['item.copy.014']!.en },
  'min-darkiron': { name: 'Darkiron Alloy', description: L10N['item.copy.015']!.en },
  'min-voidcrystal': { name: 'Void Crystal', description: L10N['item.copy.016']!.en },
  // 跃迁燃料链三件套（2026-09-29 船长令）：星云 → 折跃等离子 · 冰 → 低温跃迁浆 · 高阶气/冰 → 曲率凝析物
  'min-jumplasma': { name: 'Jump Plasma', description: L10N['item.copy.017']!.en },
  'min-cryoslurry': { name: 'Cryo Jump Slurry', description: L10N['item.copy.018']!.en },
  'min-curvature': { name: 'Curvature Condensate', description: L10N['item.copy.019']!.en },
  // 气体 / 冰矿
  'gas-neon': { name: 'Neon Cloud Gas', description: L10N['item.copy.034']!.en },
  'gas-phosphor': { name: 'Phosphor Haze', description: L10N['item.copy.035']!.en },
  'gas-ionstorm': { name: 'Ionstorm Cloud', description: L10N['item.copy.036']!.en },
  'gas-aurora': { name: 'Aurora Cloud', description: L10N['item.copy.037']!.en },
  'ice-frost': { name: 'Bluefrost Ice', description: L10N['item.copy.038']!.en },
  'ice-marrow': { name: 'Frostmarrow Ice', description: L10N['item.copy.039']!.en },
  'ice-darkstar': { name: 'Darkstar Ice', description: L10N['item.copy.040']!.en },
  // 弹药
  'ammo-kinetic-l': { name: 'Kinetic Ammo', description: L10N['item.copy.041']!.en },
  'ammo-explosive-l': { name: 'Explosive Ammo', description: L10N['item.copy.042']!.en },
  'ammo-plasma-l': { name: 'Energy Ammo', description: L10N['item.copy.043']!.en },
  'ammo-kinetic-2': { name: 'Kinetic Ammo MK2', description: L10N['item.copy.044']!.en },
  'ammo-explosive-2': { name: 'Explosive Ammo MK2', description: L10N['item.copy.045']!.en },
  'ammo-plasma-2': { name: 'Energy Ammo MK2', description: L10N['item.copy.046']!.en },
  'ammo-kinetic-3': { name: 'Kinetic Ammo MK3', description: L10N['item.ammoMk3.001']!.en },
  'ammo-explosive-3': { name: 'Explosive Ammo MK3', description: L10N['item.ammoMk3.002']!.en },
  'ammo-plasma-3': { name: 'Energy Ammo MK3', description: L10N['item.ammoMk3.003']!.en },
  // 无人机
  'drone-scout': { name: 'Hummingbird Scout Drone', description: L10N['item.copy.047']!.en },
  'drone-assault': { name: 'Redkite Combat Drone', description: L10N['item.copy.048']!.en },
  'drone-heavy': { name: 'Falcon Siege Drone', description: L10N['item.copy.049']!.en },
  'drone-sentry': { name: 'Thundergull Sentry Drone', description: L10N['item.copy.050']!.en },
  'drone-exile-bee': { name: 'Squidwasp Drone', description: L10N['item.copy.051']!.en },
  'drone-wh-c-heavy': { name: 'Hiveguard Siege Drone', description: L10N['item.copy.052']!.en },
  'drone-wh-e-sentry': { name: 'Construct Sentry Drone', description: L10N['item.copy.053']!.en },
  // H 族（墨潮帮）专属机型（2026-09-26 船长定：重袭机 = 攻坚机）
  'drone-ink-heavy': { name: 'Ink Tide Striker Drone', description: L10N['item.copy.054']!.en },
  // 修理组件
  'repairkit-civ': { name: 'Civilian Repair Kit', description: L10N['item.copy.055']!.en },
  // 道具（2026-09-29 跃迁燃料批）：超空间折跃燃料 —— 实验室合成、按原返航秒数消耗
  // 2026-09-30 船长令：体积 1 m³/单位 ＋ 普通舰船货仓无法装入（说明同步补规格）
  'jump-fuel': { name: 'Hyperspace Jump Fuel', description: L10N['item.copy.109']!.en },
  // 实验室后续内容（2026-09-30 船长令「信号发射器和技能加速剂」）：施工期 unreleased，英文先就位
  // ⟪文案调整 2026-09-30⟫ 与中文同步补两条真规则：母港/已建成副站点不着 · 高安启动付 10 点声望
  'invasion-beacon': { name: 'Signal Beacon', description: L10N['item.copy.110']!.en },
  // ⟪文案调整 2026-10-02⟫ 与中文同批：使用去处补上技能页「技能加速」（三处同源；`Skill Boost` 取 `ui.boost.001` 的冻结译名）
  // ⟪文案调整 2026-10-09⟫ 新说明待译时走共享回退，不继续显示旧英文禁用规则。
  'synaptic-accelerant': { name: 'Synaptic Accelerant', description: l10nEntryText(L10N['item.synaptic.001']!, 'en') },
  'deep-space-probe': { name: L10N['ui.stellar.001']!.en, description: L10N['ui.stellar.002']!.en },
  // 零件（2026-09-20 零件体系：基础 7 直接可造 / 高级 7 需蓝图）
  'part-circuit': { name: 'Circuit Board', description: L10N['item.copy.020']!.en },
  'part-armor-plate': { name: 'Armor Plate', description: L10N['item.copy.021']!.en },
  'part-frame': { name: 'Structural Frame', description: L10N['item.copy.022']!.en },
  'part-cable': { name: 'Superconducting Cable', description: L10N['item.copy.023']!.en },
  'part-coolant': { name: 'Coolant Duct', description: L10N['item.copy.024']!.en },
  'part-gyro': { name: 'Gyro Stabilizer Mount', description: L10N['item.copy.025']!.en },
  'part-lens': { name: 'Optical Lens Array', description: L10N['item.copy.026']!.en },
  'part-drone-neural': { name: 'Drone Neural Unit', description: L10N['item.copy.027']!.en },
  'part-shield-gen': { name: 'Shield Generator Unit', description: L10N['item.copy.028']!.en },
  'part-jet-array': { name: 'Energy Jet Array', description: L10N['item.copy.029']!.en },
  'part-qchip': { name: 'Quantum Coprocessor Core', description: L10N['item.copy.030']!.en },
  'part-keel': { name: 'Ship Keel Component', description: L10N['item.copy.031']!.en },
  'part-fire-control': { name: 'Military Fire-Control Computer', description: L10N['item.copy.032']!.en },
  'part-grav-comp': { name: 'Graviton Compensator', description: L10N['item.copy.033']!.en },
  'repairkit-mil': { name: 'Military Repair Kit', description: L10N['item.copy.056']!.en },
  /* 损管修理组件（2026-09-25 船长令：损伤管制装置启动时消耗的那一种，与民用/军用修理组件同族） */
  'repairkit-dc': { name: 'Damage Control Repair Kit', description: L10N['item.copy.057']!.en },
  // 谜质装置（Enigma Device）—— 尾句统一复用 T_WORM
  // ⟪文案调整2026-10-06⟫ 析出产物改名信号谜质，说明仍读唯一表。
  'mat-surveyor': { name: 'Deepspace Surveyor', description: L10N['item.signalSpace.002']!.en },
  'mat-chrono': { name: 'Chrono Core', description: L10N['item.signalSpace.003']!.en },
  'mat-crane': { name: 'Salvage Crane', description: L10N['item.signalSpace.004']!.en },
  'mat-drill': { name: 'Mining Drill', description: L10N['item.signalSpace.005']!.en },
  'mat-nebula': { name: 'Nebula Disperser', description: L10N['item.signalSpace.006']!.en },
  'mat-enricher': { name: 'Voidmother Enricher', description: L10N['item.signalSpace.007']!.en },
  'mat-expander': { name: 'Hold Expander', description: L10N['item.signalSpace.008']!.en },
  'mat-suppressor': { name: 'Suppression Field', description: L10N['item.signalSpace.009']!.en },
  'mat-boss-analyzer': { name: 'Guardian Analyzer', description: L10N['item.signalSpace.010']!.en },
  'mat-extract-cover': { name: 'Extraction Cover', description: L10N['item.signalSpace.011']!.en },
  'mat-shield-res': { name: 'Shield Resonance Plate', description: L10N['item.signalSpace.012']!.en },
  'mat-armor-res': { name: 'Armor Reinforcement Plate', description: L10N['item.signalSpace.013']!.en },
  'mat-hull-res': { name: 'Hull Reinforcement Plate', description: L10N['item.signalSpace.014']!.en },
  'mat-tracker': { name: 'Tracking Array', description: L10N['item.signalSpace.015']!.en },
  'mat-gyro': { name: 'Gyro Stabilizer', description: L10N['item.signalSpace.016']!.en },
  'mat-jammer': { name: 'Jammer Emitter', description: L10N['item.signalSpace.017']!.en },
  'mat-rangefinder': { name: 'Rangefinder Extender', description: L10N['item.signalSpace.018']!.en },
  'mat-blindspot': { name: 'Blindspot Suppressor', description: L10N['item.signalSpace.019']!.en },
  'mat-ammo-dmg': { name: 'Ammo Enhancer', description: L10N['item.signalSpace.020']!.en },
  'mat-reload': { name: 'Reload Accelerator', description: L10N['item.signalSpace.021']!.en },
  'mat-volley': { name: 'Volley Coordinator', description: L10N['item.signalSpace.022']!.en },
  'mat-ammo-back': { name: 'Ammo Recovery Unit', description: L10N['item.signalSpace.023']!.en },
  'mat-drone-net': { name: 'Drone Recovery Net', description: L10N['item.signalSpace.024']!.en },
  'mat-field-repair': { name: 'Field Repair Unit', description: L10N['item.signalSpace.025']!.en },
  // ⟪文案调整2026-10-06⟫ 仅改既有资产译名，物品标识不动。
  'mat-wh-essence': { name: 'Signal Enigma', description: L10N['item.copy.090']!.en },
  // 入侵旗舰黑匣（2026-09-25 船长「先做壳」）：只做壳 ⇒ 可存/可回收/可售，用途留待改装件那批
  'blackbox-universal': { name: 'Universal Black Box', description: L10N['item.copy.108']!.en },
  'blackbox-h': { name: 'Ink Tide Flagship Black Box', description: L10N['item.copy.106']!.en },
  // 光环旗舰黑匣（2026-10-02 船长令「甲」：一件族一件匣）——与墨潮那件同构，只换族名与外壳
  'blackbox-r': { name: 'Corona Flagship Black Box', description: L10N['item.copy.107']!.en },
  'blackbox-c': { name: L10N['item.alien.002']!.en, description: L10N['item.alien.003']!.en },
  // 货柜
  'box-relic-a': { name: 'Ruins Safe Container (Pirate)', description: L10N['item.copy.058']!.en },
  'box-relic-c': { name: 'Ruins Safe Container (Alien)', description: L10N['item.copy.059']!.en },
  'box-relic-d': { name: 'Ruins Safe Container (Gravekeeper)', description: L10N['item.copy.060']!.en },
  'box-relic-e': { name: 'Ruins Safe Container (Titan)', description: L10N['item.copy.061']!.en },
  'box-relic-g': { name: 'Ruins Safe Container (Deadarmy)', description: L10N['item.copy.062']!.en },
  'box-bp-shallow': { name: 'Blueprint Container (Shallow)', description: L10N['item.copy.063']!.en },
  'box-bp-mid': { name: 'Blueprint Container (Mid)', description: L10N['item.copy.064']!.en },
  'box-bp-deep': { name: 'Blueprint Container (Deep)', description: L10N['item.copy.065']!.en },
  'box-valuables': { name: 'Valuables Container', description: L10N['item.copy.101']!.en },
  'box-military': { name: 'Military Supply Container', description: L10N['item.copy.102']!.en },
  // 奢侈品
  'lux-1': { name: 'Starport Vintage', description: L10N['item.copy.091']!.en },
  'lux-2': { name: 'Noble Spice', description: L10N['item.copy.092']!.en },
  'lux-3': { name: 'Lost Artwork', description: L10N['item.copy.093']!.en },
  'lux-4': { name: 'Aged Cigars', description: L10N['item.copy.094']!.en },
  'lux-5': { name: 'Exotic Textiles', description: L10N['item.copy.095']!.en },
  'lux-6': { name: 'Aromatic Wood Carving', description: L10N['item.copy.096']!.en },
  'lux-7': { name: 'Court Sheet Music', description: L10N['item.copy.097']!.en },
  'lux-8': { name: 'Ancient Balm', description: L10N['item.copy.098']!.en },
  'lux-9': { name: 'Original Star Chart', description: L10N['item.copy.099']!.en },
  'lux-10': { name: 'Crown Diamond', description: L10N['item.copy.100']!.en },
  // AI 核心
  'ai-core-gamma': { name: 'Gamma AI Core', description: L10N['item.copy.103']!.en },
  'ai-core-beta': { name: 'Beta AI Core', description: L10N['item.copy.104']!.en },
  'ai-core-alpha': { name: 'Alpha AI Core', description: L10N['item.copy.105']!.en },
}

/** 技能（79 · `docs/glossary-en.md` §九）—— **名称 + 说明**（说明逐条译自中文原文；`⟦⟧` 高亮标记照留） */
export const EN_SKILLS: EnTable = {
  'deep-space-probing': { name: 'Deep Space Probing', description: 'Reduces the stellar system search cycle by ⟦6%⟧ per level, additive with Advanced Deep Space Probing.' },
  'advanced-deep-space-probing': { name: 'Advanced Deep Space Probing', description: 'Further reduces the stellar system search cycle by ⟦4%⟧ per level, additive with Deep Space Probing.' },
  'stellar-archive': { name: 'Stellar Archive', description: 'Adds ⟦2⟧ candidate stellar system slots per level.' },
  'probe-assembly': { name: 'Probe Assembly Engineering', description: 'Reduces Deep Space Probe material requirements by ⟦4%⟧ per level, stacking multiplicatively with Materials and Component Standardization.' },
  'hull-salvage-engineering': { name: 'Hull Salvage Engineering', description: 'Increases whole-ship recovery from player ship wrecks by ⟦5⟧ percentage points per level, additive with Advanced Hull Salvage Engineering.' },
  'advanced-hull-salvage-engineering': { name: 'Advanced Hull Salvage Engineering', description: 'Further increases whole-ship recovery from player ship wrecks by ⟦4⟧ percentage points per level, additive with Hull Salvage Engineering.' },
  'wreck-equipment-preservation': { name: 'Equipment Preservation Engineering', description: 'On successful player ship recovery, increases ordinary equipment preservation by ⟦4⟧ percentage points per level, from ⟦80%⟧ to ⟦100%⟧ at maximum level; drones are unaffected.' },
  'spaceship-command': { name: 'Spaceship Command', description: 'Basic handling training for every hull. Travel speed-up: each level shortens star-map travel time by a further ⟦2%⟧ (multiplies with the three navigation skills; applies to all ships).' },
  navigation: { name: 'Navigation', description: 'Faster route plotting and sublight maneuvering. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'warp-drive-operation': { name: 'Warp Drive Operation', description: 'Tuning and maintenance of warp drives. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'acceleration-control': { name: 'Acceleration Control', description: 'Acceleration and deceleration control in the warp entry and exit phases. Travel speed-up: each level shortens star-map travel time by ⟦4%⟧ (multiplies with skills of the same kind).' },
  'mining-frigate': { name: 'Mining Ship Basics', description: 'Mining laser tuning and work-flow basics: each level shortens the mining cycle by ⟦3%⟧.' },
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
  'industrial-automation': { name: 'Production Cadence', description: 'Line cadence optimization: refinery, assembler and laboratory cycles shorten by ⟦5%⟧ per level (max −⟦25%⟧; applies to manual and AI-core operation alike, and multiplies with Core Smelting and Batch Production).' },
  // 2026-09-30 船长令（上限批）：实验室书四条 —— 燃料上限 ×2 · 燃料节拍 ×1 · 燃料收率 ×1
  'fuel-tank-structure': { name: 'Fuel Tank Structure', description: 'Fuel tank structural rework: fuel warehouse capacity +⟦10%⟧ per level (max +⟦50%⟧).' },
  'orbital-fuel-depot': { name: 'Orbital Fuel Depot', description: 'Orbital depot expansion: fuel warehouse capacity rises by a further +⟦10%⟧ per level (a further +⟦50%⟧ at max; multiplies with Fuel Tank Structure).' },
  'fuel-catalytic-cracking': { name: 'Catalytic Cracking', description: 'Catalytic cracking process: fuel synthesis cycles shorten by ⟦4%⟧ per level (max −⟦20%⟧; multiplies with Production Cadence and applies to fuel recipes only).' },
  'fuel-yield-engineering': { name: 'Yield Engineering', description: 'Synthesis yield optimization: fuel output per batch +⟦6%⟧ per level (max +⟦30%⟧; fuel recipes only).' },
  'industrial-ai-cap-basic': { name: 'Industrial Automation Basics', description: 'Automated line basics: AI-core-driven station refineries, recyclers and manufacturing lines gain +⟦1⟧ industry-only work slot per level beyond the shared AI core cap (max +⟦5⟧; applies to station industry only and does not raise the AI auxiliary task cap; stacks with Industrial Automation).' },
  'industrial-ai-cap': { name: 'Industrial Automation', description: 'Automated line expansion: AI-core-driven station refineries, recyclers and manufacturing lines gain +⟦2⟧ industry-only work slots per level beyond the shared AI core cap (max +⟦10⟧; applies to station industry only and does not raise the AI auxiliary task cap; every slot still uses one physical AI core).' },
  'industrial-ai-cap-integration': { name: 'Integrated Industrial Automation', description: 'Automated line integration: AI-core-driven station refineries, recyclers and manufacturing lines gain +⟦2⟧ further industry-only work slots per level beyond the shared AI core cap (a further +⟦10⟧ at max; applies to station industry only and does not raise the AI auxiliary task cap; every slot still uses one physical AI core).' },
  'astro-geology': { name: 'Astrogeology', description: 'Advanced study of rock strata: a further +⟦4%⟧ yield for all mining per level (multiplies with Mining).' },
  'deep-hole-blasting': { name: 'Deep-hole Blasting', description: 'Blasting optimization in shallow belts: +⟦6%⟧ yield for low-grade ore (Peridotite / Gabbro / Redring Ore) per level.' },
  'rich-vein-prospecting': { name: 'Rich Vein Prospecting', description: 'Vein assessment and enrichment tracking: the chance to find a rich vein while mining is ×⟦1.2⟧ per level (base ⟦3%⟧ per minute; a find multiplies yield by ⟦3⟧ for the next 2 cycles).' },
  'core-smelting': { name: 'Core Smelting', description: 'Refinery temperature control and stirring: each level shortens a refining batch cycle by ⟦4%⟧ (applies to manual and AI-core operation alike).' },
  'furnace-pressure': { name: 'Furnace Pressure Regulation', description: 'Refinery pressure regulation: each level shortens a refinery batch cycle by a further ⟦4%⟧ (a further −⟦20%⟧ at max; applies to manual and AI-core operation alike, and multiplies with Core Smelting, Furnace Precision and Production Cadence).' },
  'furnace-expansion': { name: 'Furnace Expansion', description: 'Refinery chamber rework: +⟦6%⟧ refining batch size per level (applies to manual and AI-core operation alike).' },
  // 2026-09-22 船长令新增六条（精炼 T4 / 制造 T5 / 舰种操作 T4-T5）
  'furnace-precision': { name: 'Furnace Precision', description: 'Furnace temperature trimming and thermal control: each level shortens a refinery batch cycle by a further ⟦3%⟧ (max −⟦15%⟧; applies to manual and AI-core operation alike, and multiplies with Core Smelting, Furnace Pressure Regulation and Production Cadence).' },
  'parts-line': { name: 'Parts Line', description: 'Dedicated parts line scheduling: each level shortens the build time of part blueprints by a further ⟦4%⟧ (max −⟦20%⟧; multiplies with Industry and Batch Production; other blueprints are unaffected).' },
  'frigate-ops': { name: 'Frigate Operation', description: 'Frigate specialization: while piloting a frigate, evasion rises by ⟦2⟧ percentage points per level (max +⟦10⟧ points; multiplies with Evasive Maneuvering and attitude gyros).' },
  'destroyer-ops': { name: 'Destroyer Operation', description: 'Destroyer specialization: while piloting a destroyer, per-shot damage rises by ⟦5%⟧ per level (max +⟦25%⟧) and hit chance by ⟦2⟧ percentage points per level (max +⟦10⟧ points; multiplies with Gunnery and weapon-family specializations).' },
  'cruiser-ops': { name: 'Cruiser Operation', description: 'Cruiser specialization: while piloting a cruiser, per-shot damage rises by ⟦3%⟧ per level (max +⟦15%⟧) and existing resistances gain a further ⟦2%⟧ per level (max ×⟦1.1⟧, e.g. 25% → 27.5%; layers without resistances are unaffected, capped at 90%).' },
  'battleship-ops': { name: 'Battleship Operation', description: 'Battleship specialization: while piloting a battleship, shield, armor and hull capacity rise by ⟦3%⟧ per level (max +⟦15%⟧) and existing resistances gain a further ⟦2%⟧ per level (max ×⟦1.1⟧; layers without resistances are unaffected, capped at 90%).' },
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
  'station-protocol': { name: 'Station Repair Protocol', description: 'Station service negotiation: −⟦5%⟧ station repair cost per level (stacks multiplicatively with Repair Engineering).' },
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
  // ⟪文案调整2026-10-06⟫ 扫描、空白地点与坐标库存同步中文；技能名与数字不动。
  'signal-analysis': { name: 'Signal Analysis', description: 'Unknown signal interpretation and locking: −⟦8%⟧ local and Signal Space scan window per level (max −⟦40%⟧).' },
  cartography: { name: 'Cartography', description: 'Route calibration and jump window optimization: −⟦6%⟧ local and Signal Space scan window per level (max −⟦30%⟧; stacks multiplicatively with Signal Analysis and Signal Filtering).' },
  'signal-filtering': { name: 'Signal Filtering', description: 'Interference suppression and signal purification: a further −⟦6%⟧ local and Signal Space scan window per level (stacks multiplicatively with Signal Analysis).' },
  'galactic-happenings': { name: 'Galactic Happenings', description: 'A nose for curiosities: −⟦8%⟧ interval between online random events per level (about sixty percent of the base at max); the chance of a random event on departure is ×⟦1.15⟧ per level; the Signal Space scan window shortens by ⟦4%⟧ per level (max −⟦20%⟧).' },
  'event-dividend': { name: 'Event Dividend', description: 'Turning every coincidence into income: +⟦15%⟧ cash from random events per level; luck reaches into Signal Spaces too — the chance of an empty location inside the space is relatively cut by ⟦4%⟧ per level (max −⟦20%⟧).' },
  'chart-archive': { name: 'Chart Archive', description: 'Deep-space charts and Signal Space archives: +⟦2⟧ Signal Space coordinates that can be kept on the star map per level (max +⟦10⟧, from 5 to 15).' },
  'salvage-diving': { name: 'Salvage Diving', description: 'Wreck salvage and loot collection: +⟦12%⟧ expedition loot volume and salvage yield per level (applies to the player ship and AI alike).' },
  'seizure-appraisal': { name: 'Seizure Appraisal', description: 'Loot appraisal and fencing channels: +⟦10%⟧ credits seized from Low-sec repulses and victories per level.' },
  'lowsec-survival': { name: 'Low-sec Survival', description: 'Staying alive in dangerous space: −⟦12%⟧ cap on cargo seized in Low-sec per level (max −⟦60%⟧).' },
  'deep-space-logistics': { name: 'Deep Space Logistics', description: 'Deep-space logistics and hold planning: +⟦4%⟧ fleet-wide cargo capacity per level (max +⟦20%⟧; multiplies with cargo expanders and Hold Management).' },
  'hauler-ops': { name: 'Hauler Operations', description: 'Specialized piloting of the hauler family: +⟦5%⟧ cargo capacity per level while flying a hauler.' },
  compression: { name: 'Compression', description: 'Raw material compression: −⟦6%⟧ hold volume for ore, gas and ice per level (max −⟦30%⟧).' },
  'hold-management': { name: 'Hold Management', description: 'Hold planning and stowage: a further +⟦3%⟧ fleet-wide cargo capacity per level (stacks multiplicatively with Deep Space Logistics).' },
  /* ── 2026-09-27 船长令（R4/R5 上位技能批）：18 条上位的英文（⟦⟧ 数量与中文一致）── */
  'furnace-amplification': { name: 'Further rework of the refinery chamber', description: '+⟦4%⟧ refining batch size per level (a further +⟦20%⟧ at max; multiplies with Furnace Expansion).' },
  'furnace-reconfiguration': { name: 'Refinery chamber reconfiguration', description: '+⟦2%⟧ refining batch size per level (a further +⟦10%⟧ at max; multiplies with Furnace Expansion and the further chamber rework).' },
  'furnace-thermal-control': { name: 'Constant-temperature furnace control', description: '−⟦1.5%⟧ refining batch cycle per level (a further −⟦7.5%⟧ at max; multiplies with Furnace Precision).' },
  'smelting-mastery': { name: 'Further refinery output multiplier', description: '+⟦1%⟧ per level (a further +⟦5%⟧ at max; added into the refinery output multiplier alongside Reprocessing).' },
  'part-forming-integration': { name: 'Integrated forming scheduling', description: 'basic part build time −⟦2.5%⟧ per level (a further −⟦12.5%⟧ at max; multiplies with Part Forming).' },
  'precision-assembly-integration': { name: 'Integrated precision assembly', description: 'advanced part build time −⟦2.5%⟧ per level (a further −⟦12.5%⟧ at max; multiplies with Precision Assembly).' },
  'industry-integration': { name: 'Integrated multi-line scheduling', description: '−⟦1.5%⟧ blueprint build time per level (a further −⟦7.5%⟧ at max; multiplies with Industry).' },
  'salvager-overclock': { name: 'Overclocked salvager operation', description: '−⟦1%⟧ salvager cycle per level (a further −⟦5%⟧ at max; multiplies with Salvage Rigging).' },
  'wreck-refining': { name: 'Further reprocessing of wreck salvage', description: '+⟦2.5%⟧ guaranteed raw material output per level (a further +⟦12.5%⟧ at max; multiplies with Salvage Refining).' },
  'salvage-recycling-integration': { name: 'Integrated wreck recycling line', description: '−⟦1.5%⟧ recycling batch cycle per level (a further −⟦7.5%⟧ at max; multiplies with Salvage Recycling).' },
  'ai-servicing-integration': { name: 'Integrated servicing of AI auxiliary mining gear', description: '−⟦1%⟧ auxiliary mining cycle per level (a further −⟦5%⟧ at max; multiplies with Auxiliary Ship Servicing).' },
  'advanced-gunnery': { name: 'Advanced shipboard weapons training', description: '+⟦1.5%⟧ real-time single-shot damage per level (a further +⟦7.5%⟧ at max; multiplies with Gunnery).' },
  'kinetic-ballistics': { name: 'Kinetic ballistic computation', description: '+⟦1.5%⟧ kinetic weapon single-shot damage per level (a further +⟦7.5%⟧ at max; multiplies with Kinetic Gunnery).' },
  'missile-guidance': { name: 'Missile guidance correction', description: '+⟦1.5%⟧ explosive ammo single-shot damage per level (a further +⟦7.5%⟧ at max; multiplies with Missile Launching).' },
  'beam-focusing': { name: 'Beam focusing and shaping', description: '+⟦1.5%⟧ energy beam single-shot damage per level (a further +⟦7.5%⟧ at max; multiplies with Laser Cannon).' },
  'fire-control-integration': { name: 'Integrated fire-control and targeting solution', description: '+⟦1%⟧ turret and missile launcher accuracy per level (a further +⟦5%⟧ at max; multiplies with Fire Control).' },
  'rapid-reload': { name: 'Rapid reload drills', description: '−⟦1.5%⟧ reload time for turrets, missile launchers and laser cannons per level (a further −⟦7.5%⟧ at max; multiplies with Reload Drills).' },
  'drone-servicing-integration': { name: 'Integrated deck servicing', description: '−⟦1.5%⟧ drone reload time per level (a further −⟦7.5%⟧ at max; multiplies with Drone Servicing).' },
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
  // H 族（墨潮帮 · 2026-09-24 船长定名「The Ink Tide」）：A 族海盗的变种/叛出分支
  h: 'Ink Tide',
  // R 族（光环 · 2026-10-01 船长令「是新势力：余晖」）：参考远行星号 Remnants 的全无人 AI 舰队残余。
  // 英文名 = **Corona Systems**（Corona = 日冕/"光环"的天文学对应词）。
  // 🔴 **2026-10-01 船长改判**：「**这个势力不能真叫余晖（有侵权嫌疑），改名叫光环科技。**」
  // ⇒ 中文族名/短名/舰名/卡名/残骸名一律改「光环」；英文由原提案 Afterglow 改为 **Corona Systems**
  //   （不取 Halo：Halo 是微软的著名游戏 IP，避嫌要避彻底）。
  r: 'Corona Systems',
}
const WRECK_AREA_EN: Readonly<Record<string, string>> = {
  hi: 'High-sec',
  lo: 'Low-sec',
  // ⟪文案调整2026-10-06⟫ 动态残骸名称与说明共用新来源名。
  wh: 'Signal Space',
  // 2026-09-26 船长令「H族残骸不分高安低安，统一为入侵残骸（新增一个类别）」⇒ 区名多一档
  inv: 'Invasion',
}

/**
 * 残骸 id → { name, description }（组名/区分/稀有与否全从 id 解出，与中文表同构）。
 *
 * ⚠ **2026-09-26 起区名读组表**：原先按 id 后缀 `(hi|lo|wh)` 解区名，而船长同日把 H 组的地区改成
 * 新类别 `inv`（组 key 故意仍为 `h-hi`——物品 id 已进玩家档，不改）⇒ 后缀不再是区名的可靠来源。
 * 改成反查 `WRECK_GROUP_BY_KEY` 的 `region`（与中文侧 `wreckItemDefOf(组)` 同源）。
 */
function wreckEnText(id: string): EnText {
  const m = /^wreck-(rare-)?(.+)$/.exec(id)
  if (!m) throw new Error(`残骸 id 形态不符：${id}`)
  const rare = m[1] !== undefined
  const group = wreckGroupOfItemId(id)
  if (!group) throw new Error(`残骸 id 不在任何组里：${id}`)
  const fam = WRECK_FAMILY_EN[group.family.toLowerCase()]!
  const area = WRECK_AREA_EN[group.region]!
  return {
    name: rare ? `${fam} Rare Wreck (${area})` : `${fam} Wreck (${area})`,
    description: rare
      ? `Intact wreck of a ${fam} (${area}) lair core section — 30 m³ per piece. Break it down in the recycler back at the station: beyond guaranteed raw materials it always yields one piece of that foe family's exclusive or themed equipment, plus a batch of high-grade materials.`
      : `${fam} (${area}) formation hull wreckage, measured by m³. Sell it at a station market for scrap in a pinch, or break it down with the refinery's Wreck Recycling — guaranteed raw materials plus a chance of themed loot; breaking it down pays more.`,
  }
}

const WRECK_IDS = [
  'wreck-c-inv', 'wreck-rare-c-inv',
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
  // H 族（墨潮帮）第 14 组（2026-09-26 船长令「统一为入侵残骸（新增一个类别）」）：'h-hi' —— 入侵族的**入侵类**残骸组
  // （组 key 故意保留 `h-hi`：物品 id `wreck-h-hi` 已进玩家档；英文区名走 `WRECK_AREA_EN.inv = 'Invasion'`）
  // （旧 'h-wh' 已退役：它此前没有任何产出路径，任何存档都不可能持有 ⇒ 改名零迁移）
  'wreck-h-hi',
  'wreck-rare-h-hi',
  // R 族（光环）第 15 组（2026-10-01 船长令「是新势力：余晖」）：'r-inv' —— 第二个**入侵类**残骸组
  // （与 H 族同构：一次到位、无历史包袱 ⇒ 组 key 就叫 `r-inv`，不像 H 那样保留旧的 `h-hi`）
  'wreck-r-inv',
  'wreck-rare-r-inv',
] as const

export const EN_WRECKS: EnTable = Object.fromEntries(WRECK_IDS.map((id) => [id, wreckEnText(id)]))

/**
 * **蓝图碎片**（**2026-09-30 加** · 英文界面残留批 5）。
 *
 * 为什么单列：碎片物品**不在静态物品表里**——它由 `core/salvage.ts` 的 `fragmentItemDefOf(moduleId, moduleName)`
 * **按目标装备现场生成**（`frag-<装备 id>`）。名字是**拼**出来的（`${moduleName}蓝图碎片`），
 * 所以 `EN_ITEMS` 那种按 id 覆盖的写法够不着 ⇒ 落成"两句模板 + 调用方喂已本地化的装备名"。
 * ⚠ 装备名由 `context.ts` 传**覆盖后**的那份（英文界面下就是英文名）⇒ 拼出来整句同语言。
 */
export const EN_FRAGMENT: Readonly<{ name: string; description: string }> = {
  name: '{p1} Blueprint Fragment',
  description:
    'A blueprint fragment recovered by reverse-engineering wrecks: collect {p1} of them, then hit "Reverse-engineer" in the Blueprint Fragments group on the Items page to turn them into a permanent blueprint for that module (docking at a station required). The same blueprint will not drop fragments twice before it is complete — once you own the blueprint they stop appearing.',
}

/**
 * **残骸组的三处文案**（**2026-09-29 加** · 英文界面残留中文清理批 2）：
 * `WRECK_GROUPS` 的 `name` / `rareName` / `note` —— 星图「残骸打捞」页那几行
 * （`武装拾荒者残骸（高安）：钛钢结构料为主…`）走的就是它们，此前**整段中文**。
 *
 * ⚠ **族名与区名复用残骸物品那两张小表**（`WRECK_FAMILY_EN` / `WRECK_AREA_EN`）——
 * 同一个族/区在"残骸物品名"与"残骸组名"里**必须同一个词**，各写一张迟早漂
 * （物品那边已经是 `Pirate Wreck (High-sec)` 这套）。
 * `note` 与 `name` 不同：它是一句**成分说明**，按组逐条写（8 族 × 成分不同）。
 *
 * `name` / `rareName` 由 `wreckGroupEnName()` 按 `<族> Wreck (<区>)` / `<族> Rare Wreck (<区>)` 派生
 * —— 与 `wreckEnText` 的普通/稀有**同一套模板**，两处不会说出两种残骸名。
 */
const WRECK_GROUP_NOTE_EN: Readonly<Record<string, string>> = {
  'a-hi': 'Tritanium structure stock, with Silvervein armour plate and Crystalline Colloid',
  'b-hi': 'Tritanium structure stock, with Silvervein and Crystalline Colloid',
  'd-hi': 'Starcore Crystal marrow stock and Heavy Tungsten Alloy plate',
  'a-lo': 'Rich in Isotope Polycrystal',
  'c-lo': 'Mostly Starcore Crystal marrow, with Heavy Tungsten and Darkiron Alloy',
  'd-lo': 'Darkiron Alloy fragments and Isotope Polycrystal',
  'e-lo': 'Starcore Crystal and Isotope Polycrystal from megastructure fragments',
  'g-lo': 'Mostly Darkiron Alloy and Isotope Polycrystal, with structure and armour stock',
  'h-hi': 'Mostly Starcore Crystal and Heavy Tungsten Alloy, with structure stock',
  // R 族（光环 · 2026-10-01）：与 H 族同池同价位（组池 = D 高安组那套：钛钢 40 · 星髓晶 34 · 重钨合金 26）
  'r-inv': 'Mostly Starcore Crystal and Heavy Tungsten Alloy, with structure stock',
}

/** 组名（普通 / 稀有）按族名 + 区名派生 —— 与 `wreckEnText` 同源 */
function wreckGroupEnName(key: string, rare: boolean): string {
  const group = WRECK_GROUPS.find((g) => g.key === key)
  if (!group) throw new Error(`残骸组 key 不存在：${key}`)
  const fam = WRECK_FAMILY_EN[group.family.toLowerCase()]!
  const area = WRECK_AREA_EN[group.region]!
  return `${fam}${rare ? ' Rare' : ''} Wreck (${area})`
}

export const EN_WRECK_GROUPS: Readonly<Record<string, { name: string; rareName: string; note?: string }>> =
  Object.fromEntries(
    WRECK_GROUPS.map((g) => [
      g.key,
      {
        name: wreckGroupEnName(g.key, false),
        rareName: wreckGroupEnName(g.key, true),
        ...(WRECK_GROUP_NOTE_EN[g.key] !== undefined
          ? { note: `${wreckGroupEnName(g.key, false)}: ${WRECK_GROUP_NOTE_EN[g.key]}` }
          : {}),
      },
    ]),
  )

/**
 * **按"组 key"取当前语言的那三处文案**（渲染层直接用）。
 *
 * 为什么按 key 而不是按对象：`group.note` 会被 core 的 `recycleProfileOf` **拷进 profile**
 * （`salvage.ts`），于是工业页/星图两处渲染点手里都有的是**中文原串** —— 按 key 反查最省事，
 * 也不必让 core 认识语言。
 *
 * ⚠ 与 `EN_WRECK_GROUPS` **同一个真相源**（两处各写一份必然漂）；查不到组或没配英文 ⇒ 返回 undefined。
 */
export function wreckGroupText(
  key: string,
  locale: Locale,
  field: 'name' | 'rareName' | 'note',
): string | undefined {
  if (locale === 'zh') return undefined // 中文侧就叫调用方用原串（零拷贝、逐字不变）
  return EN_WRECK_GROUPS[key]?.[field]
}

/**
 * **残骸组的嵌套覆盖**（`name` / `rareName` / `note` 三处，`overlayMap` 够不着后两个）。
 * 一条都没命中时返回**原数组**（与 `overlayList` 同款：省一次拷贝，也让"没翻译"可分辨）。
 */
export function overlayWreckGroups<T extends { key: string; name: string; rareName: string; note: string }>(
  src: readonly T[],
  locale: Locale,
): readonly T[] {
  if (locale === 'zh') return src
  let out: T[] | null = null
  for (let i = 0; i < src.length; i++) {
    const g = src[i]!
    const en = EN_WRECK_GROUPS[g.key]
    if (en === undefined) continue
    out ??= [...src]
    out[i] = { ...g, name: en.name, rareName: en.rareName, ...(en.note !== undefined ? { note: en.note } : {}) }
  }
  return out ?? src
}

/** 异常点 / 敌卡（42 · `docs/glossary-en.md` §十/§十一）—— **名称 + 说明** */
export const EN_ANOMALIES: EnTable = {
  'alien-vanguard': { name: L10N['ano.alien.001']!.en, description: L10N['ano.alien.005']!.en },
  'alien-escort': { name: L10N['ano.alien.002']!.en, description: L10N['ano.alien.005']!.en },
  'alien-main': { name: L10N['ano.alien.003']!.en, description: L10N['ano.alien.005']!.en },
  'alien-broodmother': { name: L10N['ano.alien.004']!.en, description: L10N['ano.alien.005']!.en },
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
  // ⟪文案调整2026-10-06⟫ 新实验趟也克隆这些说明，来源泛称空间内探索。
  'wh-pirate-scout': {
    name: 'Raider Detachment',
    description: 'Encounter inside the space: a small raiding detachment (hidden card, encountered during space exploration only).',
  },
  'wh-pirate-hunt': {
    name: 'Raider Hunt',
    description: 'Encounter inside the space: raider hunters covering each other, one near and one far (hidden card, encountered during space exploration only).',
  },
  'wh-pirate-warband': {
    name: 'Pirate Warband',
    description: 'Encounter inside the space: a pirate warband with the warlord himself in the line (hidden card, encountered during space exploration only).',
  },
  'wh-alien-swarm': {
    name: 'Starcore Hunting Swarm',
    description: 'Encounter inside the space: a hunting pack of starcore adults (hidden card, encountered during space exploration only).',
  },
  'wh-alien-brood': {
    name: 'Spore Brood Tide',
    description: 'Encounter inside the space: spore aberrants leading starcore adults in (hidden card, encountered during space exploration only).',
  },
  'wh-alien-hive': {
    name: 'Maw Deep Hive',
    description: 'Encounter inside the space: a deep hive where the maw behemoth lairs (hidden card, encountered during space exploration only).',
  },
  'wh-grave-watch': {
    name: 'Gravekeeper Patrol',
    description: 'Encounter inside the space: a patrol formation left behind by the gravekeepers (hidden card, encountered during space exploration only).',
  },
  'wh-grave-sentry': {
    name: 'Stasis Sentry Chain',
    description: 'Encounter inside the space: two stasis sentry links, one near and one far (hidden card, encountered during space exploration only).',
  },
  'wh-grave-throne': {
    name: 'Mausoleum Court',
    description: 'Encounter inside the space: the throne guard at the deepest point of the mausoleum (hidden card, encountered during space exploration only).',
  },
  'wh-titan-echo': {
    name: 'Titan Echo',
    description: 'Encounter inside the space: a megastructure wreck still discharging, with its sentry swarm (hidden card, encountered during space exploration only).',
  },
  'wh-titan-missile': {
    name: 'Missile Echo',
    description: 'Encounter inside the space: a missile section still firing salvoes (hidden card, encountered during space exploration only).',
  },
  'wh-titan-hulk': {
    name: 'Titan Onslaught',
    description: 'Encounter inside the space: a whole megastructure wreck section with its sentry swarm (hidden card, encountered during space exploration only).',
  },
  'wh-exile-blockade': {
    name: 'Deadarmy Blockade',
    description: 'Encounter inside the space: a blockade squad of the deadarmy (hidden card, encountered during space exploration only).',
  },
  'wh-exile-swarm': {
    name: 'Echo Swarm',
    description: 'Encounter inside the space: a swarm formed by two echo remnant ships (hidden card, encountered during space exploration only).',
  },
  'wh-exile-line': {
    name: 'Remnant Battle Line',
    description: "Encounter inside the space: the deadarmy's last battle line with its swarm escort (hidden card, encountered during space exploration only).",
  },
  // H 族（墨潮帮）· 周末入侵的四张独立敌卡（2026-09-24 船长逐条给定编成）
  'ink-harass': {
    name: 'Ink Tide Harassment Fleet',
    description: 'Weekend incursion: a harassment fleet of the Ink Tide (hidden card, spawned by the incursion event only).',
  },
  'ink-raid': {
    name: 'Ink Tide Raid Fleet',
    description: 'Weekend incursion: a raid fleet of the Ink Tide (hidden card, spawned by the incursion event only).',
  },
  'ink-main': {
    name: 'Ink Tide Main Fleet',
    description: 'Weekend incursion: the main fleet of the Ink Tide (hidden card, spawned by the incursion event only).',
  },
  'ink-flagship': {
    name: 'Ink Tide Flagship Group',
    description: 'Weekend incursion: the Ink Tide flagship group (hidden card, spawned by the incursion event only).',
  },
  // R 族（光环）· 周末入侵的四张独立敌卡（2026-10-01 船长令建族 · 编成与 H 族同构）
  'corona-drift': {
    name: 'Corona Drift Swarm',
    description: 'Weekend incursion: a drifting swarm of Corona Systems (hidden card, spawned by the incursion event only).',
  },
  'corona-split': {
    name: 'Corona Split Swarm',
    description: 'Weekend incursion: a split swarm of Corona Systems (hidden card, spawned by the incursion event only).',
  },
  'corona-converge': {
    name: 'Corona Converge Swarm',
    description: 'Weekend incursion: a converging swarm of Corona Systems (hidden card, spawned by the incursion event only).',
  },
  'corona-nexus': {
    name: 'Corona Nexus Guard',
    description: 'Weekend incursion: the Corona Systems nexus guard (hidden card, spawned by the incursion event only).',
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
 * 从舰船英文名取**舰级段**：含 `-class` 时取到该词为止（`Narwhal-class Mining Corvette` → `Narwhal-class`）；
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
 *
 * ⟪文案调整 2026-10-02⟫ 12 张 `bp-plug-*`（舰船插件图纸）：`requires an Ink Tide flagship black box.`
 * → `requires any black box.` —— 依据 = **船长 2026-10-02 令「甲」**（一件族一件匣）＋ 2026-09-27 原话
 * 「现有的舰船插件蓝图都只要使用任意类型黑匣就可以制作」。中文侧同批改（`blueprints.ts`）。
 */
const BP_DESC_EN: Readonly<Record<string, string>> = {
  'bp-deep-space-probe': L10N['ui.stellar.004']!.en,
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
  'bp-ammo-kinetic-3': L10N['bp.ammoMk3.001']!.en,
  'bp-ammo-explosive-3': L10N['bp.ammoMk3.002']!.en,
  'bp-ammo-plasma-3': L10N['bp.ammoMk3.003']!.en,
  'bp-repairkit-civ': 'Civilian repair kit plans: pressed nano repair compound, 5 kits per batch, base 5 HP.',
  'bp-repairkit-mil': 'Military repair kit plans: sealed high-density nano repair agent, 3 kits per batch, base 10 HP.',
  'bp-repairkit-dc': 'Damage control repair kit plans: sealed emergency damage-control compound, 3 kits per batch.',
  'bp-dc-1': 'Damage control plans: a resistance lining and an emergency lock valve that holds a ship together the first time its structure runs out.',
  'bp-dc-2': 'Damage control plans: a thicker resistance lining and twin emergency lock valves.',
  'bp-dc-3': 'Damage control plans: fortress-grade resistance lining and a full-ship emergency lock manifold.',
  // 制式无人机永久图纸（2026-09-26 船长令）：四条永久 · 100 架/批（机型译名与 `EN_ITEMS` 的无人机条目同源）
  'bp-drone-scout': 'Hummingbird Scout Drone plans: 100 drones per batch; kinetic bursts, the highest evasion and the thinnest armor.',
  'bp-drone-assault': 'Redkite Combat Drone plans: 100 drones per batch; explosive strikes, the balanced workhorse of the swarm.',
  'bp-drone-heavy': 'Falcon Siege Drone plans: 100 drones per batch; energy pulses, the most HP and the lowest evasion.',
  'bp-drone-sentry': 'Thundergull Sentry Drone plans: 100 drones per batch; a heavy energy battery with very long reach and hits that fall off with distance.',
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
  'bp-drone-deck-1': 'Section plans for a reserve hangar bay: spare airframe racks, a supply rail and the reset control loop.',
  'bp-drone-deck-2': 'Section plans for a larger reserve hangar bay: twin rack rows and a faster reset control loop.',
  'bp-drone-deck-3': 'Section plans for a squadron-scale reserve hangar bay: racks for the whole wing and a fast reset control loop.',
  'bp-drone-shield-2': 'Phased resonant cavities and projection plates for a shield array: lays a shield field over every launched drone.',
  'bp-drone-shield-3': 'Triple projection plates and self-calibrating cavities: merges the whole drone wing into one shield layer.',
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
  // ⟪文案调整 2026-10-07⟫ 图纸英文与产物机制说明共用唯一表。
  'bp-shieldfield-2': L10N['mod.copy.027']!.en,
  'bp-shieldfield-3': L10N['mod.copy.027']!.en,
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
  // ⟪文案调整 2026-10-08⟫
  'bp-wh-a-hangar': 'Raider hangar: enlarges the drone bay and reduces initial launch delays.',
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
  'bp-wh-e-tac': 'Megastructure control tower: raises drone damage and makes the swarm harder for the enemy to hit.',
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
  /* 舰船插件图纸 12 张（2026-09-26 船长令）：说明同款，只差产物名（名称由 `EN_MODULES` 派生） */
  'bp-plug-shield-plate': 'Ship plug blueprint: requires any black box.',
  'bp-plug-armor-plate': 'Ship plug blueprint: requires any black box.',
  'bp-plug-hull-plate': 'Ship plug blueprint: requires any black box.',
  'bp-plug-mid-bay': 'Ship plug blueprint: requires any black box.',
  'bp-plug-low-bay': 'Ship plug blueprint: requires any black box.',
  'bp-plug-cpu-core': 'Ship plug blueprint: requires any black box.',
  'bp-plug-firepower': 'Ship plug blueprint: requires any black box.',
  'bp-plug-sight': 'Ship plug blueprint: requires any black box.',
  'bp-plug-thruster': 'Ship plug blueprint: requires any black box.',
  'bp-plug-rangefinder': 'Ship plug blueprint: requires any black box.',
  'bp-plug-target-beacon': 'Ship plug blueprint: requires any black box.',
  'bp-plug-concealment': 'Ship plug blueprint: requires any black box.',
}

export const EN_BLUEPRINTS: EnTable = (() => {
  // 船长2026-10-09确认中文名称/说明，英文未准备时回退中文，不自动生成新译名。
  const out: Record<string, EnText> = {
    'bp-drone-launch-1': { name: l10nEntryText(L10N['bp.launchCalibration.001']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
    'bp-drone-launch-2': { name: l10nEntryText(L10N['bp.launchCalibration.002']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
    'bp-drone-launch-3': { name: l10nEntryText(L10N['bp.launchCalibration.003']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.006']!, 'en') },
    'bp-laser-calibration-2': { name: l10nEntryText(L10N['bp.launchCalibration.004']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.007']!, 'en') },
    'bp-laser-calibration-3': { name: l10nEntryText(L10N['bp.launchCalibration.005']!, 'en'), description: l10nEntryText(L10N['mod.launchCalibration.007']!, 'en') },
    'bp-faction-drone-bee': { name: l10nEntryText(L10N['bp.factionDrone.001']!, 'en'), description: l10nEntryText(L10N['bp.factionDrone.006']!, 'en') },
    'bp-faction-drone-hiveguard': { name: l10nEntryText(L10N['bp.factionDrone.002']!, 'en'), description: l10nEntryText(L10N['bp.factionDrone.007']!, 'en') },
    'bp-faction-drone-construct': { name: l10nEntryText(L10N['bp.factionDrone.003']!, 'en'), description: l10nEntryText(L10N['bp.factionDrone.008']!, 'en') },
    'bp-faction-drone-ink': { name: l10nEntryText(L10N['bp.factionDrone.004']!, 'en'), description: l10nEntryText(L10N['bp.factionDrone.009']!, 'en') },
    'bp-faction-drone-jawclaw': { name: l10nEntryText(L10N['bp.factionDrone.005']!, 'en'), description: l10nEntryText(L10N['bp.factionDrone.010']!, 'en') },
  }
  for (const bp of BLUEPRINTS) {
    if (out[bp.id]) continue
    const product = bp.moduleId ? EN_MODULES[bp.moduleId]?.name : bp.itemId ? EN_ITEMS_ALL[bp.itemId]?.name : undefined
    if (!product) continue
    const desc = BP_DESC_EN[bp.id]
    const name = bp.id === 'bp-deep-space-probe' ? L10N['ui.stellar.003']!.en : `${product} Blueprint`
    out[bp.id] = desc !== undefined ? { name, description: desc } : { name }
  }
  return out
})()

/**
 * **舰船蓝图说明**（45 条手译 + `sbp-once-*` 12 条按本体派生——中文侧一次性图纸与普通图纸**逐字同说明**）。
 * 数值（货舱/循环/产量）照抄中文原文，不做本地化换算（单位与千分位与英文侧一致）。
 */
const SBP_DESC_EN: Readonly<Record<string, string>> = {
  'sbp-manatee': 'A Leviathan freighter with a large cargo hold and fittings for defense and field work, suited to bulk transport.',
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
  'sbp-nautilus': 'Survey cruiser; 5,600 m³ hold — joining a fleet widens scan range by one ring.',
  'sbp-tortoise': 'Light corvette; armor and structure far above its tier, paid for with speed and hold space.',
  'sbp-hawksbill': 'Heavy cruiser; 9,600 m³ hold, 22 units per 13 s cycle — a warehouse in thick shell.',
  'sbp-xuanwu': 'Heavy flagship; 15,200 m³ hold and the thickest three-layer HP — the apex of the heavy line.',
  'sbp-flyingfish': 'Courier; a 5,000 m³ hold at 430 m/s — built for short-haul express runs.',
  'sbp-sailfish': 'Fast freighter; 8,500 m³ hold, 18 units per 11 s cycle.',
  'sbp-swordfish': 'Heavy freighter; 14,000 m³ hold, 16 units per 12 s cycle.',
  'sbp-megalodon': 'Battleship; 4,000 m³ hold — a fire platform that dares to stand at the head of the formation.',
  // 2026-09-26 新增两艘（虎鲸级 = 战巡 / 旋齿鲨级 = 装甲战列舰）
  'sbp-orca': 'Command ship; 4,700 m³ hold — speed is what it lives on.',
  'sbp-helicoprion': 'Armored battleship; 3,600 m³ hold, with armor thick enough to eat the first salvo.',
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
  'foe-alien-acid-burster': { name: L10N['ship.alien.001']!.en },
  'foe-alien-brood-worker': { name: L10N['ship.alien.002']!.en },
  'foe-alien-hiveback': { name: L10N['ship.alien.003']!.en },
  'foe-alien-broodmother': { name: L10N['ship.alien.004']!.en },
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
  // H 族（墨潮帮 · The Ink Tide · 2026-09-24 船长定名）：五档壳体 —— 船长当日细化后的现行名
  'foe-h-ink-jammer': { name: 'Ink Tide Jammer' },
  'foe-h-ink-corvette': { name: 'Ink Tide Assault Ship' },
  'foe-h-ink-torpedo': { name: 'Ink Tide Torpedo Ship' },
  'foe-h-ink-battlecruiser': { name: 'Ink Tide Battlecruiser' },
  'foe-h-ink-flagship': { name: 'Ink Tide Invasion Carrier' },
  // R 族（光环 · Corona Systems · 2026-10-01 船长令建族 · 船长选「甲：照提案」批定自创舰名）
  // 舰名一律**自创**（"光现象/残响"意象）—— 参考对象的舰名不照抄；英文 = 族名 + 光现象词
  'foe-r-corona-glint': { name: 'Corona Glint' },
  'foe-r-corona-echo': { name: 'Corona Echo' },
  'foe-r-corona-overlay': { name: 'Corona Overlay' },
  'foe-r-corona-dusk': { name: 'Corona Dusk' },
  'foe-r-corona-nexus': { name: 'Corona Nexus' },
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
    const ship = slot.ship as typeof slot.ship & { drones?: readonly import('@whale/core').FoeDroneSlot[] }
    const drones = ship.drones?.map(ds => ds.drone.id === 'foe-drone-c-jawclaw' ? { ...ds, drone: { ...ds.drone, name: L10N['item.alien.001']!.en } } : ds)
    return { ...slot, ship: { ...ship, name: text.name, ...(drones ? { drones } : {}) } }
  })
  return changed ? { ...def, ships: mapped } : null
}

/**
 * **卡片条目上的「敌方挂载件」名按语言覆盖**（2026-09-24 加 · 船长「给G族添加挂载件：船体修理装置」批）。
 *
 * 为什么要单开一层：挂载件的**目录表在 core**（`FOE_MOUNTS`，因为建档路径拿不到 `ctx`，见 `core/foeMounts.ts`
 * 头注），拿不到 data 包的译名表；但 `Id` 与**双语名对**（`resolveFoeMounts(...).namePairs`）
 * 都在 core 里现成 ⇒ 这里按 `slot.mounts ?? ship.mounts`（**与引擎同一条优先级**）把该条目的
 * `mounts` **换成那一侧的名字数组**。
 *
 * ⚠ **只换"名字数组"、不动 `mounts` 的判据**：引擎侧读的是**卡定义本身**
 * （`createFoeSpecsFromShips` 用 `u.slot.mounts ?? ship.mounts`），本层产出的是**界面用的副本**
 * （`localizeCtx` 的 `anomalies` 覆盖）⇒ 改语言不会改战斗行为（与 `cardFoesOf` 同款）。
 * ⚠ 没有英文名的件**回退中文名**（core 目录里 `en` 缺省 ⇒ 两项都是中文）——既有八件现状，待补。
 */
function cardFoeMountsOf<T extends { ships?: readonly { ship: { mounts?: readonly FoeMountId[] }; mounts?: readonly FoeMountId[] }[] }>(
  def: T,
  locale: Locale,
): T | null {
  if (locale === 'zh') return null
  const slots = def.ships
  if (!slots || slots.length === 0) return null
  let changed = false
  const mapped = slots.map((slot) => {
    // **与引擎同一条优先级**：条目 `mounts` ?? 舰级 `ship.mounts`（条目**替换**舰级，不是叠加）
    const ids = slot.mounts ?? slot.ship.mounts
    if (!ids || ids.length === 0) return slot
    // ⚠ **不改 `mounts`**：引擎在建档时读它（`createFoeSpecsFromShips`）且只认 id；
    // 这里只**附一份双语名对**（与 `mounts` 下标对齐），显示层按语言挑一列 ⇒ 语言切换不动战斗行为。
    changed = true
    return { ...slot, foeMountNamePairs: resolveFoeMounts(ids).namePairs }
  })
  return changed ? { ...def, ships: mapped } : null
}

/** Map 版（`ctx.anomalies` 一类）：逐卡嵌套覆盖 */
export function overlayCardFoes<T extends { ships?: readonly { ship: { id: string; name: string; mounts?: readonly FoeMountId[] }; mounts?: readonly FoeMountId[] }[] }>(
  cards: ReadonlyMap<string, T>,
  en: EnTable,
  locale: Locale,
): ReadonlyMap<string, T> {
  if (locale === 'zh') return cards
  let out: Map<string, T> | null = null
  for (const [id, def] of cards) {
    // 两层叠加：先换舰名（英文表），再换该条目上的**挂载件名**（core 目录的双语名对）
    const named = cardFoesOf(def, en) ?? def
    const next = cardFoeMountsOf(named, locale) ?? (named === def ? null : named)
    if (!next) continue
    out ??= new Map(cards)
    out.set(id, next)
  }
  return out ?? cards
}

/** 数组版（引擎目录 `ANOMALIES_FLAVORED` 一类）：逐卡嵌套覆盖 */
export function overlayCardFoesList<T extends { ships?: readonly { ship: { id: string; name: string; mounts?: readonly FoeMountId[] }; mounts?: readonly FoeMountId[] }[] }>(
  list: readonly T[],
  en: EnTable,
  locale: Locale,
): readonly T[] {
  if (locale === 'zh') return list
  let out: T[] | null = null
  for (let i = 0; i < list.length; i++) {
    const def = list[i]!
    const named = cardFoesOf(def, en) ?? def
    const next = cardFoeMountsOf(named, locale) ?? (named === def ? null : named)
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

/**
 * **建站阶段名**（**2026-09-29 加** · 英文界面残留中文清理批 1）。
 *
 * 为什么单列一张按 zh 名查的表：阶段名**嵌在站点定义的 `tiers[].name` 里**（`stations.ts` 每档一个
 * `奠基/完善/建成`），而 `overlayMap` 只认顶层的 `name` / `description` —— 够不着嵌在数组里的那层
 * （同一个原因见 `overlayMatterTech` 的头注）。`unlockDesc` 同理（那也是一句玩家可见说明）。
 */
export const EN_STATION_TIERS: Readonly<Record<string, { name: string; unlockDesc?: string }>> = {
  奠基: { name: 'Foundation', unlockDesc: 'Construction underway: groundwork and main frame (station services open once it is fully built)' },
  完善: { name: 'Fitting-out', unlockDesc: 'Construction underway: equipment installation and system checks (station services open once it is fully built)' },
  建成: { name: 'Commissioning', unlockDesc: 'Outpost complete: joins the station network — berths, unloading, repair, resupply, ship switching and all in-station services open' },
}

/**
 * 按期号取**当前语言的阶段名**（渲染层直接用；查不到英文覆盖就保留中文）。
 * ⚠ 与 `localizeCtx` 的那份覆盖**同一个真相源**（`EN_STATION_TIERS`）——两处各写一份必然漂。
 */
export function stationTierText(
  tier: { name: string },
  locale: Locale,
  field: 'name' | 'unlockDesc' = 'name',
): string | undefined {
  if (locale === 'zh') return field === 'name' ? tier.name : undefined
  const hit = EN_STATION_TIERS[tier.name]
  if (hit === undefined) return field === 'name' ? tier.name : undefined
  return field === 'name' ? hit.name : hit.unlockDesc
}

/**
 * **建站点的嵌套覆盖**：顶层走 `overlayMap` 那套，`tiers[].name` / `tiers[].unlockDesc` 另外接一层。
 * 一条都没命中时返回**原对象**（与 `overlayMap` 同款：省一次拷贝，也让"没翻译"可分辨）。
 */
function overlayStations(
  src: ReadonlyMap<string, StationSiteDef>,
  en: EnTable,
  locale: Locale,
): ReadonlyMap<string, StationSiteDef> {
  if (locale === 'zh') return src
  let out: Map<string, StationSiteDef> | null = null
  for (const [id, def] of src) {
    const text = en[id]
    const tiers = def.tiers.map((t) => {
      const hit = EN_STATION_TIERS[t.name]
      if (hit === undefined) return t
      return {
        ...t,
        name: hit.name,
        ...(hit.unlockDesc !== undefined ? { unlockDesc: hit.unlockDesc } : {}),
      }
    })
    if (text === undefined && tiers.every((t, i) => t === def.tiers[i])) continue
    out ??= new Map(src)
    out.set(id, {
      ...def,
      ...(text?.name !== undefined ? { name: text.name } : {}),
      ...(text?.description !== undefined ? { description: text.description } : {}),
      tiers,
    })
  }
  return out ?? src
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
  // 2026-09-30 船长令：实验室首访通讯的发件方（非官方 · 黑市）
  'black-market': { name: 'Black Market' },
  'dept-contraband': { name: 'Contraband Desk' },
}

/**
 * 旅行事件（8 · 译名表 §十三；`ctx.travelEvents` 是**数组** ⇒ 用 `overlayTravelEvents`）。
 *
 * **2026-10-02 补 `text`**（远征批）：正文原先只有中文 ⇒ 英文界面下事件日志整句中文。
 * 中文原串一字未改（`travelEvents.ts`），这里只补英文正文。
 */
export const EN_TRAVEL_EVENTS: Readonly<Record<string, { name: string; text: string }>> = {
  'ev-derelict': {
    name: 'Drifting Container',
    text: 'The fleet found a drifting container on the route and towed it back to the station, where stripping it down earned a bounty',
  },
  'ev-mineral-cloud': {
    name: 'Raw Material Debris Cloud',
    text: 'A cloud of blast-scattered ore dust blocked the route; the fleet swept all of it into the hold on the way through',
  },
  'ev-aurora': {
    name: 'Warp Aurora',
    text: 'Auroras surged inside the warp corridor and every ship’s sensors logged the light show — the trip lost no time over it',
  },
  'ev-scout': {
    name: 'Pirate Scout',
    text: 'A pirate scout trailed the fleet at a distance: it never opened fire, but your route has been noted',
  },
  'ev-meteor': {
    name: 'Meteor Shower',
    text: 'A dense meteor shower skimmed the shields like a free fireworks show',
  },
  'ev-big-cargo': {
    name: 'Lost Association Container',
    text: 'A giant container marked “Association property — lost” drifted beside the route; hauling it back earns a recovery bounty',
  },
  'ev-ore-patch': {
    name: 'Rich Ore Remnant',
    text: 'A forgotten rich ore vein sat embedded in the rock, and the miners took a load of high-grade material off it',
  },
  'ev-signal': {
    name: 'Ancient Signal',
    text: 'The radar caught an ancient signal, and the Association archives will pay for a clean recording',
  },
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
  // 2026-09-30 船长令：精炼提速两支 ＋ T5 层首批
  'mt-industry-refine-speed': { name: 'Void Refining Acceleration' },
  'mt-industry-refine-integration': { name: 'Void Refining Integration' },
  'mt-industry-void-drip': { name: 'Void Ore Siphon' },
  'mt-industry-fuel-advanced': { name: 'High-density Fuel Recipe' },
}

/**
 * **谜质科技 · 节点说明（`note`）的英文**（2026-09-26 三号补 · roadmap 交接项 L1）。
 *
 * ⚠ **为什么另起一张表**：`overlayMap` 只覆盖 `name` / `description`（见其头注），
 * 而谜质节点的说明字段叫 **`note`** ⇒ 原先 `EN_MATTER_TECH` 只有名字、说明在英文界面下一直是中文
 * （既有缺口，非新增）。这里按节点 **id** 逐条补 `note`，由 `overlayMatterTech()` 应用
 * —— 即 roadmap L1 推荐的那条路（id 映射，与 §十一之三 对齐），数据侧 `MatterTechNodeDef` 一字不动。
 *
 * 口径：① 逐条译自中文原文，**数字与百分比照抄**（5% / 20% / 500 米这类规格不许改写）；
 * ② 术语走 `docs/glossary-en.md`（虫洞 = Wormhole · 打捞器 = Salvager · 采集器 = Mining Laser ·
 * 时序核心 = Chrono Core · 虚空母矿 = Void Ore）；③ 不写原因解释。
 */
export const EN_MATTER_TECH_NOTES: Readonly<Record<string, string>> = {
  // ⟪文案调整2026-10-06⟫ 共享探索与战斗效果泛称空间内；旧扫描入口单独改名。
  'mt-explore-turn': 'Each level raises the maximum turn count for exploration inside the space by 10 (a permanent bonus; it adds to any Chrono Core carried into the run).',
  'mt-explore-salvage': 'Each level raises salvager efficiency by 20%: every salvage run pulls extra piles in proportion (each full 100% is one guaranteed extra pile, the remainder by chance).',
  'mt-explore-collect': 'Each level raises mining laser efficiency by 20%: every mining cycle takes extra piles in proportion (each full 100% is one guaranteed extra pile, the remainder by chance).',
  // ⟪文案调整2026-10-06⟫ 新旧共享说明同步中文，不限定为仅信号空间有效。
  'mt-explore-hold': 'Each level adds 4 effective slots to the hold inside the space.',
  'mt-explore-scan': 'Each level shortens the scan interval of “Scan for Signal Spaces” by 5% (multiplied with the skill chain).',
  'mt-explore-speed': 'Unlocks battle speed multiplier inside the space: level 1 ×2, level 2 ×4 (switch back to ×1 at any time during a fight).',
  'mt-battle-shield': 'Each level cuts the shield layer’s resistance gap against the enemy’s main damage type by 5% (battles inside the space only).',
  'mt-battle-armor': 'Each level cuts the armor layer’s resistance gap against the enemy’s main damage type by 5% (battles inside the space only).',
  'mt-battle-hull': 'Each level cuts the hull layer’s resistance gap against the enemy’s main damage type by 5% (battles inside the space only; requires Resonant Shield Array and Armor Realignment at level 1 each).',
  'mt-battle-hit': 'Each level raises our accuracy by 1% (battles inside the space only).',
  'mt-battle-evasion': 'Each level raises our evasion by 1% (battles inside the space only).',
  'mt-battle-noise': 'Each level lowers enemy accuracy by 1% (battles inside the space only).',
  'mt-battle-range': 'Each level raises the range of all our weapons by 4% (battles inside the space only).',
  'mt-battle-reload': 'Each level shortens our weapon reload cycle by 3% (battles inside the space only).',
  'mt-battle-damage': 'Each level raises our damage per shot by 3% (battles inside the space only).',
  'mt-battle-blind': 'Each level lowers the damage the enemy deals inside its blind zone by 5% (battles inside the space only).',
  'mt-battle-threat-node': 'Each level lowers enemy threat in node battles inside the space by 3%.',
  'mt-battle-threat-boss': 'Each level lowers the threat of the guardian at the end of a layer inside the space by 3%.',
  'mt-battle-drone': 'Each level raises the recovery rate of drones shot down by 5% (battles inside the space only).',
  'mt-battle-repair': 'Each level restores 10% of armor and hull after a battle ends (battles inside the space only).',
  'mt-industry-unbox': 'Each level shortens the container unboxing cycle by 25%.',
  'mt-industry-void': 'Each level raises the Void Crystal yield from refining Void Ore by 10%.',
  'mt-industry-wreck': 'Each level raises the guaranteed raw material output of wreck recovery by 5%.',
  'mt-industry-ai': 'Each level raises the AI-only berth cap for on-station industry by 1 (up to +5 at max level; each berth still occupies one physical core).',
  // 2026-09-30 船长令：精炼提速两支 ＋ T5 层首批
  'mt-industry-refine-speed': 'Each level shortens the refining cycle of Void Ore by 10%.',
  'mt-industry-refine-integration': 'Each level shortens the refining cycle of Void Ore by a further 5%.',
  'mt-industry-void-drip': 'Each level grants 200 Void Ore per hour automatically (600 per hour at max level; offline time counts).',
  'mt-industry-fuel-advanced': 'Unlocks the laboratory recipe "Condensed Jump Fuel": 600 units per batch, less Void Crystal and a higher total material cost.',
}

/**
 * **谜质科技节点的英文覆盖**：`name` 走 `EN_MATTER_TECH`（译名表 §十四），
 * **`note` 走 `EN_MATTER_TECH_NOTES`**（2026-09-26 补 · L1）。
 *
 * 为什么不能顺手用 `overlayMap`：它只认 `name` / `description` 两个字段（见其头注），
 * 而节点的说明字段是 `note` ⇒ 直接调 `overlayMap` 会让说明在英文界面下仍是中文。
 * 两者都走**按 id 查表**，查不到的一律保留原文（新增节点漏登记时看得见中文，不会静默变空）。
 *
 * ⚠ `ctx.matterTech` 的类型是 `ReadonlyMap`（见 `SimContext`）⇒ 按 Map 覆盖；
 * 一条都没命中时返回**原对象**（与 `overlayMap` 同款：省一次拷贝，也让"没翻译"可分辨）。
 */
function overlayMatterTech(
  src: ReadonlyMap<string, MatterTechNodeDef>,
  en: EnTable,
  notes: Readonly<Record<string, string>>,
  locale: Locale,
): ReadonlyMap<string, MatterTechNodeDef> {
  if (locale === 'zh') return src
  let out: Map<string, MatterTechNodeDef> | null = null
  for (const [key, def] of src) {
    const name = en[def.id]?.name
    const note = notes[def.id]
    if (name === undefined && note === undefined) continue
    out ??= new Map(src)
    out.set(key, {
      ...def,
      ...(name !== undefined ? { name } : {}),
      ...(note !== undefined ? { note } : {}),
    })
  }
  return out ?? src
}

/**
 * **途中事件（远征）的英文覆盖**（**2026-10-02 加** · 远征批）。
 *
 * 为什么不能用 `overlayList`：它只认 `name` / `description`，而事件的**正文**字段是 `text`
 * （`TravelEventDef.text`，触发后写进日志的那句话）⇒ 直接调 `overlayList` 会让英文界面下的
 * 事件日志整句仍是中文（实测：`core.expedition.038/039` 的 `{p1}` 就是它）。
 * 与 `overlayMatterTech` 同款：按 id 查表，查不到的**保留原文**（漏登记时看得见中文，不会静默变空）。
 */
function overlayTravelEvents(
  src: readonly TravelEventDef[],
  en: Readonly<Record<string, { name?: string; text?: string }>>,
  locale: Locale,
): readonly TravelEventDef[] {
  if (locale === 'zh') return src
  let out: TravelEventDef[] | null = null
  for (let i = 0; i < src.length; i++) {
    const def = src[i]!
    const row = en[def.id]
    if (row === undefined || (row.name === undefined && row.text === undefined)) continue
    out ??= [...src]
    out[i] = {
      ...def,
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...(row.text !== undefined ? { text: row.text } : {}),
    }
  }
  return out ?? src
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
    ...(ctx.foeShips ? { foeShips: overlayMap(ctx.foeShips, EN_FOE_SHIPS, locale) } : {}),
    blueprints: overlayMap(ctx.blueprints, EN_BLUEPRINTS, locale),
    shipBlueprints: overlayMap(ctx.shipBlueprints, EN_SHIP_BLUEPRINTS, locale),
    galaxies: overlayMap(ctx.galaxies, EN_GALAXIES, locale),
    belts: overlayMap(ctx.belts, EN_BELTS, locale),
    stations: overlayStations(ctx.stations, EN_STATIONS, locale),
    commsFactions: overlayMap(ctx.commsFactions, EN_COMMS_FACTIONS, locale),
    // matterTech 在 SimContext 里是可选字段（缺省 = 该档内容没装）⇒ 有才覆盖
    // ⚠ 不用 `overlayMap`：节点的说明字段是 `note`（不是 `description`）⇒ 走专用覆盖
    ...(ctx.matterTech ? { matterTech: overlayMatterTech(ctx.matterTech, EN_MATTER_TECH, EN_MATTER_TECH_NOTES, locale) } : {}),
    // ⚠ 不用 `overlayList`：事件的**正文**字段是 `text`（不是 `description`）⇒ 走专用覆盖
    travelEvents: overlayTravelEvents(ctx.travelEvents, EN_TRAVEL_EVENTS, locale),
  }
}
