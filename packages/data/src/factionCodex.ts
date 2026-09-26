/**
 * **势力图鉴的内容登记表（单一来源）**（2026-09-26 船长：「**敌族图鉴单独列出吧，放在蓝图图鉴下方，
 * 叫『势力图鉴』**……**玩家能在敌族图鉴里查看该势力的专属装备和舰船**」）。
 *
 * 这里回答三个问题，界面只读这一份：
 *  1. **收录哪些势力** —— A 海盗 · C 异形 · D 守墓 · E 泰坦 · G 亡军 · H 墨潮帮
 *     （**B 武装拾荒者不收**：船长 2026-09-25 明示；F 制式巡逻**已废弃**，WORMHOLE_FAMILY_ETHNIC 里也没有）；
 *  2. **每族的专属内容**是哪几件（装备 / 舰船 / 图纸）——**逐条注明依据**，见各族行的注释；
 *  3. **每族的敌人**舰级从哪来 —— `foe-ships.ts` 的 `FOE_SHIPS` 按 `FoeShipDef.family` **现算**，
 *     本表**不重列**（避免两处清单漂移）。
 *
 * ⚠ **两张来源不同的清单**（别混）：
 *  - **窝点专属件**（`mod-lair-*` / `drone-exile-bee` / `bp-lair-g-drone`）的族归属在 **core `FOE_LAIR_GEAR`**
 *    有权威表（`Record<FoeFamily, readonly string[]>`）⇒ 本表**引用它**，不另写一份；
 *  - **虫洞专属件与专属舰**（`mod-wh-*` / `sh-wh-*`）在数据侧**没有族字段**（只有 id 前缀与段落注释）
 *    ⇒ 本表就是它们的**族归属登记处**；判据 = id 前缀 ＋ `modules.ts` / `ships.ts` 的段落注释。
 *    护栏 = `content:check` 的「势力专属登记契约」（每个 `mod-wh-*` / `sh-wh-*` 必须**恰好**落在一族里，
 *    未登记 / 重复登记一律报红）。
 *
 * ⚠ **图纸**（船长 2026-09-26 选定「甲：列出来并标注『图纸』类别」）：本表把族专属图纸一并登记
 *   ——装备图纸 = 一次性 `bp-wh-*` / `bp-lair-*`（`singleUse: true`，与 `mod-wh-*` 同名同族）；
 *  舰船图纸 = `sbp-wh-*`（与 `sh-wh-*` 同名同族）。界面按 `bp-` / `sbp-` 前缀渲染「图纸」徽标。
 */
import type { FoeFamily } from '@whale/core'

/** 图鉴里的势力条目 */
export interface FactionCodexEntry {
  /** 族字母（＝ `FoeShipDef.family` 的取值域，界面取敌人与进度都用它） */
  family: FoeFamily
  /** 势力名（玩家可见全称）的文案 id —— 复用 `ui.Handbook.326/337/348/359/370/381`（手册本就有） */
  nameId: string
  /** 徽记（`ui/Glyphs.tsx` 的图标名；族徽与敌情悬停同一套 `fam-*`） */
  glyph: string
  /** **虫洞专属装备**（我方件；`mod-wh-<族>-*`） */
  modules: readonly string[]
  /** **专属舰船**（我方舰；`sh-wh-<族>-*`） */
  ships: readonly string[]
  /** **族专属图纸**（装备一次性图纸 `bp-wh-*` / `bp-lair-*` ＋ 舰船图纸 `sbp-wh-*`） */
  blueprints: readonly string[]
}

/**
 * 势力图鉴的**收录顺序**（＝界面卡片顺序；与敌情悬停的 `WORMHOLE_FAMILY_ORDER`（A/C/D/E/G）一致，
 * H 排在末尾 —— 它是 2026-09-24 起新接入的第六个势力）。
 */
export const FACTION_CODEX_ORDER: readonly FoeFamily[] = ['A', 'C', 'D', 'E', 'G', 'H']

export const FACTION_CODEX: Record<string, FactionCodexEntry> = {
  /* ── A 海盗（Pirate）──
     依据：`modules.ts` 段注释「A 族（海盗 · 掠夺：大货舱 / 快 / 中近程）」下的六件；
     窝点三件见 core `FOE_LAIR_GEAR.A`；舰船 = `sh-wh-a-*` 三艘（掠袭电子舰 / 掠袭炮舰 / 掠袭重型突击巡洋舰） */
  A: {
    family: 'A',
    nameId: 'ui.Handbook.326', // 海盗舰系（每族 9 格的起始格）
    glyph: 'fam-a',
    modules: ['mod-wh-a-coat', 'mod-wh-a-frag', 'mod-wh-a-hangar', 'mod-wh-a-prop', 'mod-wh-a-scan', 'mod-wh-a-shield'],
    ships: ['sh-wh-a-frigate', 'sh-wh-a-destroyer', 'sh-wh-a-cruiser'],
    blueprints: ['bp-wh-a-coat', 'bp-wh-a-frag', 'bp-wh-a-hangar', 'bp-wh-a-prop', 'bp-wh-a-scan', 'bp-wh-a-shield',
      'sbp-wh-a-frigate', 'sbp-wh-a-destroyer', 'sbp-wh-a-cruiser'],
  },
  /* ── C 异形生物（Aberrant）──
     依据：`modules.ts`「C 族」段五件（生体棱镜束 / 骨架 / 导弹 / 脉冲 / 激光）；窝点三件见 `FOE_LAIR_GEAR.C`；
     另有一次性的**巢卫攻坚无人机图纸** `bp-wh-c-drone`（产物 `drone-wh-c-heavy`，属 C 族专属无人机） */
  C: {
    family: 'C',
    nameId: 'ui.Handbook.335', // 异形生物
    glyph: 'fam-c',
    // `drone-wh-c-heavy` = 巢卫攻坚无人机（C 族专属消耗品；一次性图纸 `bp-wh-c-drone` 见 blueprints）
    modules: ['mod-wh-c-frame', 'mod-wh-c-laser', 'mod-wh-c-missile', 'mod-wh-c-prism', 'mod-wh-c-pulse', 'drone-wh-c-heavy'],
    ships: ['sh-wh-c-frigate', 'sh-wh-c-destroyer', 'sh-wh-c-cruiser'],
    blueprints: ['bp-wh-c-frame', 'bp-wh-c-laser', 'bp-wh-c-missile', 'bp-wh-c-prism', 'bp-wh-c-pulse', 'bp-wh-c-drone',
      'sbp-wh-c-frigate', 'sbp-wh-c-destroyer', 'sbp-wh-c-cruiser'],
  },
  /* ── D 守墓古舰（Gravekeeper）──
     依据：`modules.ts`「D 族」段六件（陵卫连装炮 / 陵墓护盾芯 / 守墓者丧钟 / 陵寝棱镜炮 /
     守墓者速装填机 / 陵墓弹道铭文）；窝点三件见 `FOE_LAIR_GEAR.D`（**最强敌族**） */
  D: {
    family: 'D',
    nameId: 'ui.Handbook.344', // 守墓古舰
    glyph: 'fam-d',
    modules: ['mod-wh-d-laser', 'mod-wh-d-loader', 'mod-wh-d-lock', 'mod-wh-d-shield', 'mod-wh-d-steady', 'mod-wh-d-turret'],
    ships: ['sh-wh-d-frigate', 'sh-wh-d-destroyer', 'sh-wh-d-cruiser'],
    blueprints: ['bp-wh-d-laser', 'bp-wh-d-loader', 'bp-wh-d-lock', 'bp-wh-d-shield', 'bp-wh-d-steady', 'bp-wh-d-turret',
      'sbp-wh-d-frigate', 'sbp-wh-d-destroyer', 'sbp-wh-d-cruiser'],
  },
  /* ── E 泰坦巨构（Titan）──
     依据：`modules.ts`「E 族」段五件（巨构损管阵列 / 导控塔 / 协处理器 / 近防阵列 / 护盾矩阵）；
     窝点三件见 `FOE_LAIR_GEAR.E`（巨构残骸炮 / 深层机库 / 巨构骨架）；
     另有一次性的**构件哨戒无人机图纸** `bp-wh-e-drone`（产物 `drone-wh-e-sentry`） */
  E: {
    family: 'E',
    nameId: 'ui.Handbook.353', // 泰坦巨构
    glyph: 'fam-e',
    // `drone-wh-e-sentry` = 构件哨戒无人机（E 族专属消耗品；一次性图纸 `bp-wh-e-drone` 见 blueprints）
    modules: ['mod-wh-e-cpu', 'mod-wh-e-dc', 'mod-wh-e-pd', 'mod-wh-e-shield', 'mod-wh-e-tac', 'drone-wh-e-sentry'],
    ships: ['sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier'],
    blueprints: ['bp-wh-e-cpu', 'bp-wh-e-dc', 'bp-wh-e-pd', 'bp-wh-e-shield', 'bp-wh-e-tac', 'bp-wh-e-drone',
      'sbp-wh-e-frigate', 'sbp-wh-e-destroyer', 'sbp-wh-e-carrier'],
  },
  /* ── G 鱿烬亡军（Deadarmy）──
     依据：`modules.ts`「G 族」段六件（幽灵弹道校正器 / 亡军火控 / 亡军蜂巢坞 / 鱿蜂结构层 /
     亡军残炮 / 幽灵推进器）；窝点三件见 `FOE_LAIR_GEAR.G`（含**鱿蜂无人机** `drone-exile-bee`
     与其一次性图纸 `bp-lair-g-drone`——已登记在该表里，故此处不重列 `bp-lair-g-drone`） */
  G: {
    family: 'G',
    nameId: 'ui.Handbook.362', // 鱿烬亡军
    glyph: 'fam-g',
    // `drone-exile-bee` = 鱿蜂无人机（G 族窝点链产物；一次性图纸 `bp-lair-g-drone` 在 core `FOE_LAIR_GEAR.G` 名下单列）
    modules: ['mod-wh-g-ballistic', 'mod-wh-g-fcs', 'mod-wh-g-hangar', 'mod-wh-g-hull', 'mod-wh-g-prop', 'mod-wh-g-turret', 'drone-exile-bee'],
    ships: ['sh-wh-g-frigate', 'sh-wh-g-destroyer', 'sh-wh-g-cruiser'],
    blueprints: ['bp-wh-g-ballistic', 'bp-wh-g-fcs', 'bp-wh-g-hangar', 'bp-wh-g-hull', 'bp-wh-g-prop', 'bp-wh-g-turret',
      'sbp-wh-g-frigate', 'sbp-wh-g-destroyer', 'sbp-wh-g-cruiser'],
  },
  /* ── H 墨潮帮（Ink Tide）──
     依据：2026-09-26 势力装备批 —— **两件模块**（墨潮电子舱 `mod-lair-ecm-h` / 墨潮捕获网 `mod-lair-web-h`，
     均在 core `FOE_LAIR_GEAR.H`）＋ **专属无人机**（墨潮重袭无人机 `drone-ink-heavy`，`exclusive: true`）。
     ⚠ **H 没有专属舰船**（数据侧无 `sh-wh-h-*`）⇒ 界面按船长 2026-09-26 选定（甲案）在该栏明写「暂无专属舰船」。
     ⚠ 两件模块与无人机都是窝点/残骸链产物、**无蓝图**（`exclusive`：无图纸、不上市场）⇒ 图纸一栏为空。 */
  H: {
    family: 'H',
    nameId: 'ui.Handbook.371', // 墨潮帮
    glyph: 'fam-h',
    // `drone-ink-heavy` = 墨潮重袭无人机（H 族专属消耗品，残骸链一次 ×10 架）
    modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'],
    ships: [],
    blueprints: [],
  },
}

/** 图鉴收录的势力数（界面副行「已遭遇 N/M」的分母按**族**算；见 `factionSeenCounts`） */
export const FACTION_CODEX_COUNT = FACTION_CODEX_ORDER.length

/* ═══════════ 界面值（单一来源：界面只读这里，不再自己算） ═══════════ */

/** 图鉴里该族的一条敌人（未遭遇的只带 `seen:false`，**名字由界面按占位规则决定**） */
export interface FactionEnemy {
  id: string
  /** 是否遭遇过（＝ `state.foeShipSeen[id] === true`；2026-09-26 起由开战那一刻记账） */
  seen: boolean
}

/** 图鉴卡片的完整值（界面 `GridCell.raw` 就存它） */
export interface FactionCard {
  family: FoeFamily
  /** 势力名文案 id（`ui.Handbook.*`；界面按当前语言取词） */
  nameId: string
  glyph: string
  /** 该族**是否已解锁**（＝该族任一舰级遇过；船长 2026-09-26 裁定②：遇过任一舰 ⇒ 该族专属全开） */
  unlocked: boolean
  /** 已遭遇的舰级数 / 该族舰级总数 */
  seenCount: number
  totalCount: number
  /** 该族敌人（顺序 = `FOE_SHIPS` 表内顺序，稳定） */
  enemies: FactionEnemy[]
  /** 该族专属内容（已解锁时可展示；未解锁时界面不展示明细） */
  modules: readonly string[]
  ships: readonly string[]
  blueprints: readonly string[]
}

/**
 * **按当前档的遭遇记录装配六张卡片**（界面唯一入口）。
 *
 * `foeShipSeen` 的键就是敌舰**舰级 id**（`combat.noteFoeShipsSeen` 写入）⇒ 与 `FOE_SHIPS` 的 id 同域，
 * 直接查表即可；**老档没有该字段 ⇒ 全部未遇**（零迁移，符合"新图鉴从零解锁"的预期）。
 */
export function buildFactionCards(
  foeShips: readonly { id: string; family: FoeFamily }[],
  foeShipSeen: Readonly<Record<string, true>> | undefined,
): FactionCard[] {
  return FACTION_CODEX_ORDER.map((family) => {
    const entry = FACTION_CODEX[family]!
    const enemies: FactionEnemy[] = foeShips
      .filter((s) => s.family === family)
      .map((s) => ({ id: s.id, seen: foeShipSeen?.[s.id] === true }))
    const seenCount = enemies.filter((e) => e.seen).length
    return {
      family,
      nameId: entry.nameId,
      glyph: entry.glyph,
      unlocked: seenCount > 0,
      seenCount,
      totalCount: enemies.length,
      enemies,
      modules: entry.modules,
      ships: entry.ships,
      blueprints: entry.blueprints,
    }
  })
}

/** 反查：某件族专属物品（装备/舰/图纸 id）属于哪一族 —— 契约与界面共用 */
export function factionOfExclusive(id: string): FoeFamily | null {
  for (const family of FACTION_CODEX_ORDER) {
    const e = FACTION_CODEX[family]!
    if (e.modules.includes(id) || e.ships.includes(id) || e.blueprints.includes(id)) return family
  }
  return null
}

