import type { MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { DOMAIN_ALL, DOMAIN_ITEM, DOMAIN_SHIP, MARKET_DOMAIN_TABS, rackDimKeyOf, marketDomainPasses } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { kindTextOfItem, rackText } from '../../ui/labelsText'

/**
 * 一级领域的中文名 —— **改读单点表 `MARKET_DOMAIN_TABS`**。
 *
 * **2026-10-01 船长令**：「能否将仓库物品的筛选分类和市场的筛选分类同步」⇒ 追问后裁定
 * 「**以市场为准，三处都改，层级按市场来**」⇒ 档位顺序与中文名一起搬进 `ui/itemSubs.ts` 的
 * 市场是唯一同时展示物品与舰船的页面；其他页面按自己的领域直接显示分类。
 *
 * 沿革（今天的档位是下面这些裁定累积出来的；原表体随本批搬走，注释留档）：
 * · 2026-09-16「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」⇒ `item` 中文名由「物品」改「货物」；
 * · 2026-09-16「**将货柜添加到市场的分类里，和货物同级**」⇒ 货柜从货物里剔出、独立成一级类型；
 * · 2026-09-11「应该将消耗品独立出来」⇒ 消耗品独立成一级类型；
 * · 2026-09-10「类型筛选移除装备，改为高 / 中 / 低槽三个类型」⇒ 装备按槽拆三档（中文名走 `RACK_LABELS` 单点）；
 * · 2026-09-26「**市场内黑匣单独一个分类，不要挪到「货物」**」⇒ 黑匣独立成一级类型。
 *
 * ⚠ 原先那句「这只是市场下拉的显示名，导航页「物品」与手册「物品图鉴」走各自的单点，未随本改」
 * **已随本批作废**——那三处现在读同一张表了。
 */
export type KindFilter = typeof DOMAIN_ALL | typeof DOMAIN_ITEM | typeof DOMAIN_SHIP

export const KIND_OPTIONS: readonly KindFilter[] = [DOMAIN_ALL, ...MARKET_DOMAIN_TABS.map((t) => t.key as KindFilter)]

/* 类型子分类表已抽到 ui/itemSubs.ts（市场页与手册图鉴共用同一套口径） */
/** 目录条目对应的物品定义（item 类才查物品表） */
function itemDefOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef) {
  return good.kind === 'item' ? ctx.items.get(good.refId) : undefined
}

/** 行/悬停的分类文案：残骸类物品单独显示「残骸」（2026-09-08 船长定），
 * 装备按**归属档**显示（高槽装备 / 中槽装备 / 低槽装备 / **舰船插件**；2026-09-10 船长：类型按槽类拆分后行内同步），
 * 其余物品走 itemKindText 单点（2026-09-10：无人机 → 无人机 · 侦察机，子属性并入种类）
 *
 * ⚠ **2026-10-01 修**：原先这里读 core `rackOf()`，而插件数据为过体检契约声明了 `rack: 'low'`
 * ⇒ 插件行内显示成「低槽装备」，可点「低槽装备」筛选它**又不出现**（判定单点 `rackDimKeyOf` 认的是
 * `'plug'`）——显示与筛选两套尺。现与判定同尺走 `rackDimKeyOf`。 */
export function kindTextOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef): string {
  const it = itemDefOf(ctx, good)
  if (it) return it.kind === 'wreck' ? tr("ui.MarketPage.009") : kindTextOfItem(it)
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    return mod ? rackText(rackDimKeyOf(mod)) : tr('ui.MarketPage.178')
  }
  if (good.kind === 'ship') return tr('ui.App.002')
  if (good.kind === 'blueprint') return tr('ui.MarketPage.004')
  if (good.kind === 'aicore') return tr('ui.MarketPage.008')
  return good.kind
}

/**
 * 类型过滤判定（**甲组·判定单点**，船长 2026-09-19「六条基线」之⑥）：物品 / 装备两域一律走
 * `ui/itemSubs.ts` 的**唯一入口** `itemBucketPasses`——原先本函数自己写了一整套
 * （残骸 / 槽类 / 消耗品 / 货柜 / 货物的剔除规则），与物品页仓库、手册图鉴各写一份 ⇒ 已收敛。
 * 本函数现在只保留**市场特有**的部分：舰船 / 蓝图 / AI 核心三种商品按自身 `kind` 同字面判定。
 *
 * ⚠ `kind === 'module'` 已不在类型下拉里，但仍保留判定（`subPasses` 与旧调用方兼容）。
 */
export function domainPasses(ctx: PageProps['engine']['ctx'], good: MarketGoodDef, domain: KindFilter, sub: string): boolean {
  return marketDomainPasses(ctx, good, domain, sub)
}
