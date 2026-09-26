/**
 * **语义色阶单点**（族色 / 物品大类 / 导航 / 图标 / 作业 / 伤害 / 角色）——2026-09-22 界面配色批。
 *
 * 口径：值一律是 **CSS 变量引用**（`rgb(var(--wui-tone-*))`）⇒ 主题切换纯 CSS 生效：
 *   ① 不需要 React 重渲染，也不会"切了主题还有一半图标是旧色"；
 *   ② 色值表在 `packages/ui/src/index.css`（`--wui-tone-*`，深空/亮白各一份）。
 *
 * ⚠ **必须放进 CSS 属性**（`style={{ stroke: tone }}` / 样式表）：SVG **呈现属性**（`fill="…"` / `stroke="…"`）
 *   **不认 `var()`** —— 写进属性会静默失效（渲染成默认黑），这是本批踩过的坑（`ui/Glyphs.tsx` 的 `Glyph` 已改走 style）。
 *
 * 本文件由 `tools/_tone-extract.ts` 从旧色表抽取生成过一次，此后即为**唯一维护点**（改色只改这里 + index.css 两块）。
 */

/**
 * 键 → **完整 CSS 颜色值**。
 * ⚠ 必须包 `rgb(...)`：色板 token 存的是**空格三元组**（`--wui-tone-ore: 94 230 200;`），
 *   裸写 `var(--wui-tone-ore)` 当色值是**非法声明**（整条失效、描边消失）——
 *   2026-09-22 船长报障「各种 svg 图标都失效了」的真因就是这里：本函数第一版少了这层 `rgb()`。
 */
export const toneVar = (name: string): string => 'rgb(var(--wui-tone-' + name + '))'

/** TONES（83 条） */
export const TONES: Record<string, string> = {
  ore: toneVar('ore'),
  mineral: toneVar('mineral'),
  gas: toneVar('gas'),
  ice: toneVar('ice'),
  ammo: toneVar('ammo'),
  drone: toneVar('drone'),
  wreck: toneVar('wreck'),
  kit: toneVar('kit'),
  fragment: toneVar('fragment'),
  part: toneVar('part'),
  'part-basic': toneVar('part-basic'),
  'part-advanced': toneVar('part-advanced'),
  container: toneVar('container'),
  matter: toneVar('matter'),
  essence: toneVar('essence'),
  luxury: toneVar('luxury'),
  aicore: toneVar('aicore'),
  // 2026-09-26 黑匣独立成档（船长报障「仓库内查看不到」）：色调 = 品红族，与 fragment（紫）/gas（淡紫）可分
  blackbox: toneVar('blackbox'),
  'box-relic': toneVar('box-relic'),
  'box-relic-a': toneVar('box-relic-a'),
  'box-relic-c': toneVar('box-relic-c'),
  'box-relic-d': toneVar('box-relic-d'),
  'box-relic-e': toneVar('box-relic-e'),
  'box-relic-g': toneVar('box-relic-g'),
  'box-bp': toneVar('box-bp'),
  'box-bp-shallow': toneVar('box-bp-shallow'),
  'box-bp-mid': toneVar('box-bp-mid'),
  'box-bp-deep': toneVar('box-bp-deep'),
  'box-valuables': toneVar('box-valuables'),
  'box-military': toneVar('box-military'),
  'ai-core': toneVar('ai-core'),
  'ai-core-gamma': toneVar('ai-core-gamma'),
  'ai-core-beta': toneVar('ai-core-beta'),
  'ai-core-alpha': toneVar('ai-core-alpha'),
  'mat-surveyor': toneVar('mat-surveyor'),
  'mat-chrono': toneVar('mat-chrono'),
  'mat-nebula': toneVar('mat-nebula'),
  'mat-expander': toneVar('mat-expander'),
  'mat-crane': toneVar('mat-crane'),
  'mat-drill': toneVar('mat-drill'),
  'mat-enricher': toneVar('mat-enricher'),
  'mat-suppressor': toneVar('mat-suppressor'),
  'mat-boss-analyzer': toneVar('mat-boss-analyzer'),
  'mat-extract-cover': toneVar('mat-extract-cover'),
  'mat-shield-res': toneVar('mat-shield-res'),
  'mat-armor-res': toneVar('mat-armor-res'),
  'mat-hull-res': toneVar('mat-hull-res'),
  'mat-tracker': toneVar('mat-tracker'),
  'mat-gyro': toneVar('mat-gyro'),
  'mat-jammer': toneVar('mat-jammer'),
  'mat-rangefinder': toneVar('mat-rangefinder'),
  'mat-blindspot': toneVar('mat-blindspot'),
  'mat-ammo-dmg': toneVar('mat-ammo-dmg'),
  'mat-reload': toneVar('mat-reload'),
  'mat-volley': toneVar('mat-volley'),
  'mat-ammo-back': toneVar('mat-ammo-back'),
  'mat-drone-net': toneVar('mat-drone-net'),
  'mat-field-repair': toneVar('mat-field-repair'),
  miner: toneVar('miner'),
  cargo: toneVar('cargo'),
  turret: toneVar('turret'),
  missile: toneVar('missile'),
  laser: toneVar('laser'),
  shield: toneVar('shield'),
  'shield-field': toneVar('shield-field'),
  armor: toneVar('armor'),
  propulsion: toneVar('propulsion'),
  'drone-rack': toneVar('drone-rack'),
  'drone-tac': toneVar('drone-tac'),
  'drone-relay': toneVar('drone-relay'),
  support: toneVar('support'),
  cpu: toneVar('cpu'),
  /* 2026-09-26 舰船插件（船长令）：复用 `target-lock` 那一档色调 —— 同属"外挂装置"语感，
     且**不新造 CSS 变量**（主题表里没有 `--wui-tone-plug`，新造要六套主题各补一份，得不偿失）。 */
  plug: toneVar('target-lock'),
  salvager: toneVar('salvager'),
  'target-lock': toneVar('target-lock'),
  industrial: toneVar('industrial'),
  armed: toneVar('armed'),
  armored: toneVar('armored'),
  hauler: toneVar('hauler'),
  blueprint: toneVar('blueprint'),
  // l10n-keep：下面五条是**图形键**（`group-<技能大类中文名>`，与 `Glyphs.tsx` 的 SHAPES 键同源、
  // 也不是玩家可见文案 —— 图标按键取形/取色，界面上的分类名另走 `labelsText.skillGroupText()`）
  'group-舰船': toneVar('group-ship'),
  'group-工业': toneVar('group-industry'),
  'group-战斗': toneVar('group-combat'),
  'group-工程': toneVar('group-engineering'),
  'group-贸易': toneVar('group-trade'),
}

/** NAV_TONES（17 条） */
export const NAV_TONES: Record<string, string> = {
  'nav-map': toneVar('nav-map'),
  'nav-ship': toneVar('nav-ship'),
  'nav-fit': toneVar('nav-fit'),
  'nav-items': toneVar('nav-items'),
  'nav-market': toneVar('nav-market'),
  'nav-industry': toneVar('nav-industry'),
  'nav-skills': toneVar('nav-skills'),
  'nav-mail': toneVar('nav-mail'),
  'faction-octopus': toneVar('faction-octopus'),
  'nav-mine': toneVar('nav-mine'),
  'nav-bounty': toneVar('nav-bounty'),
  'nav-salvage': toneVar('nav-salvage'),
  'nav-haul': toneVar('nav-haul'),
  'nav-task': toneVar('nav-task'),
  'nav-ai': toneVar('nav-ai'),
  'nav-shop': toneVar('nav-shop'),
  'nav-wormhole': toneVar('nav-wormhole'),
}

/** ICO_TONES（17 条） */
export const ICO_TONES: Record<string, string> = {
  'fam-a': toneVar('fam-a'),
  'fam-c': toneVar('fam-c'),
  'fam-d': toneVar('fam-d'),
  'fam-e': toneVar('fam-e'),
  'fam-g': toneVar('fam-g'),
  'fam-h': toneVar('fam-h'),
  'ico-home': toneVar('ico-home'),
  'ico-lock': toneVar('ico-lock'),
  'ico-clock': toneVar('ico-clock'),
  'ico-loop': toneVar('ico-loop'),
  'ico-flag': toneVar('ico-flag'),
  'ico-star': toneVar('ico-star'),
  'ico-scan': toneVar('ico-scan'),
  'ico-swap': toneVar('ico-swap'),
  'ico-cross': toneVar('ico-cross'),
  'ico-crane': toneVar('ico-crane'),
  'ico-antenna': toneVar('ico-antenna'),
  'ico-tact': toneVar('ico-tact'),
}

/**
 * **取色调（跨表兜底）**（2026-09-26 修 · 船长报障「**手册内的势力都是一个颜色的**」）。
 *
 * 症状与真因：手册的卡片统一走 `toneOf(glyph)` 取色，而 `toneOf()` **只查 `TONES`**（物品/装备/分组那 83 条）。
 * 图标键落在 `ICO_TONES`（`fam-*` 族徽 / `ico-*`）或 `NAV_TONES`（`nav-*`）的卡片就会**静默取到兜底灰**：
 *   · 势力图鉴六张势力卡的 glyph = 族徽 `fam-a/c/d/e/g/h` ⇒ **六张卡同一个灰色**（就是船长看到的那样）；
 *   · 势力详情里的敌人卡 = `ico-tact` ⇒ 同灰；
 *   · 左上角族徽角标的内联色 = `toneOf('fam-x')` ⇒ 也灰（还**压掉**了 `.app-map-famchip.is-fam-X` 的类色）。
 *
 * 本函数按 **TONES → ICO_TONES → NAV_TONES** 顺次查，三张表都没有才回落 `--wui-dim`：
 * 对物品/装备键的行为与 `toneOf()` **逐字一致**（`TONES` 仍是第一顺位），只是不再让另外两张表的键掉进灰兜底。
 * 族色本身仍是单点：`FOE_ACCENT`（见下）＝ `toneVar('A'..'H')`，与星图族标签、战场敌舰同源。
 */
export function toneOfAny(key: string | undefined): string {
  if (!key) return 'rgb(var(--wui-dim))'
  return TONES[key] ?? ICO_TONES[key] ?? NAV_TONES[key] ?? 'rgb(var(--wui-dim))'
}

/** FOE_ACCENT（8 条；H = 墨潮帮 · 2026-09-24 新增，**仍是红色系**（船长令）但比 A 族深/暗一档） */
export const FOE_ACCENT: Record<string, string> = {
  A: toneVar('A'),
  B: toneVar('B'),
  C: toneVar('C'),
  D: toneVar('D'),
  E: toneVar('E'),
  F: toneVar('F'),
  G: toneVar('G'),
  // H 族（墨潮帮）：与 A 同为红（船长「依旧红色色系最好」），靠**更深更沉**区分
  H: toneVar('H'),
}

/** WORK_ACCENT（4 条） */
export const WORK_ACCENT: Record<string, string> = {
  'work-mine': toneVar('work-mine'),
  'work-salvage': toneVar('work-salvage'),
  'work-scan': toneVar('work-scan'),
  'work-haul': toneVar('work-haul'),
}

/** DMG_COLOR（3 条） */
export const DMG_COLOR: Record<string, string> = {
  kinetic: toneVar('kinetic'),
  explosive: toneVar('explosive'),
  plasma: toneVar('plasma'),
}

/** ROLE_ACCENT（4 条） */
export const ROLE_ACCENT: Record<string, string> = {
  industrial: toneVar('industrial'),
  armed: toneVar('armed'),
  armored: toneVar('armored'),
  hauler: toneVar('hauler'),
}

/** SCALARS（1 条） */
export const SCALARS: Record<string, string> = {
  RARE_WRECK_TONE: toneVar('rare-wreck-tone'),
}

/**
 * **补齐 token**（2026-09-22 第二遍：把 TSX 里剩下的内联色也收进色表）——
 * 战斗画面（血条层次 / 敌舰名 / 残骸灰）、无人机描边、物质科技页页签、谜质紫罗兰档。
 * 与 `packages/ui/src/index.css` 里的同名 `--wui-tone-*` 一一对应（深空/亮白各一份）。
 */
export const UI_TONES = {
  droneSky: toneVar('drone-sky'),
  dronePeach: toneVar('drone-peach'),
  droneCyan: toneVar('drone-cyan'),
  droneGray: toneVar('drone-gray'),
  foeNameMain: toneVar('foe-name-main'),
  foeName: toneVar('foe-name'),
  hpShield: toneVar('hp-shield'),
  hpArmor: toneVar('hp-armor'),
  hpHull: toneVar('hp-hull'),
  matExplore: toneVar('mat-explore'),
  matBattle: toneVar('mat-battle'),
  matIndustry: toneVar('mat-industry'),
  essenceViolet: toneVar('essence-violet'),
  corpse: toneVar('corpse'),
}