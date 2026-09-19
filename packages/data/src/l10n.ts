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
): ReadonlyMap<string, T> {
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
export function localizeCtx(ctx: SimContext, locale: Locale): SimContext {
  if (locale === 'zh') return ctx
  return {
    ...ctx,
    ships: overlayMap(ctx.ships, EN_SHIPS),
  }
}
